const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('../db');
const { createApp,buildRoute,recoveryFor } = require('../server');
const { verifyChain } = require('../blockchain');

test('seeded database and full five-role circular workflow',async () => {
  const db = createDatabase(':memory:');
  const app = createApp(db);
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const post = async (url,body,status=200) => {
    const response = await fetch(base+url,{ method: 'POST',headers: { 'Content-Type':'application/json' },body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status,status,JSON.stringify(data));
    return data;
  };
  try {
    const state = await (await fetch(base+'/api/state')).json();
    assert.equal(state.users.length,9);
    assert.equal(state.batteries.length,12);
    assert.ok(state.ledger.length>20);
    assert.equal(state.integrity.valid,true);
    const mint = await post('/api/passports',{ actor_id:2,chemistry:'NMC',capacity_kwh:80,batch_count:2,factory_location:'Munich' });
    assert.equal(mint.minting_fee_eur,4);
    await post('/api/passports',{ actor_id:4,chemistry:'NMC',capacity_kwh:80,batch_count:1,factory_location:'Munich' },403);
    await post('/api/passports',{ actor_id:2,chemistry:'NMC',capacity_kwh:80,batch_count:1.5,factory_location:'Munich' },400);
    const vin = mint.battery_vins[0];
    await post(`/api/batteries/${vin}/diagnostic`,{ actor_id:4,soh_percent:90,safety_condition:'Intact',action:'recycle' },400);
    await post(`/api/batteries/${mint.battery_vins[1]}/diagnostic`,{ actor_id:5,soh_percent:85,safety_condition:'Intact',action:'second_life' });
    await post(`/api/batteries/${vin}/diagnostic`,{ actor_id:4,soh_percent:60,safety_condition:'Intact',action:'recycle' });
    await post(`/api/batteries/${mint.battery_vins[1]}/diagnostic`,{ actor_id:5,soh_percent:61,safety_condition:'Intact',action:'recycle' });
    const bid = await post('/api/bids',{ actor_id:7,battery_vin:vin,bid_amount_eur:1500,simulate_accept:true });
    assert.equal(bid.brokerage_fee_eur,150);
    const pending = await post('/api/bids',{ actor_id:7,battery_vin:mint.battery_vins[1],bid_amount_eur:1200 });
    await post(`/api/bids/${pending.bid_id}/accept`,{ actor_id:4 },403);
    await post(`/api/bids/${pending.bid_id}/accept`,{ actor_id:5 });
    await post(`/api/bids/${bid.bid_id}/accept`,{ actor_id:1 },409);
    const optimized = await post('/api/routes/optimize',{ actor_id:9 });
    assert.equal(optimized.route_ids.length,1);
    const routeId = optimized.route_ids[0];
    const route = db.prepare('SELECT * FROM logistics_routes WHERE id=?').get(routeId);
    assert.deepEqual(JSON.parse(route.adr_checklist_json),[false,false,false]);
    assert.equal(JSON.parse(route.stops_json).filter(stop=>stop.type==='pickup').length,2);
    assert.ok(route.baseline_unbatched_km>route.total_distance_km);
    await post(`/api/routes/${routeId}/dispatch`,{ actor_id:9 },409);
    await post(`/api/routes/${routeId}/checklist`,{ actor_id:9,checklist:[true,true,true] });
    await post(`/api/routes/${routeId}/dispatch`,{ actor_id:9 });
    await post(`/api/batteries/${vin}/recover`,{ actor_id:7 },409);
    await post(`/api/routes/${routeId}/deliver`,{ actor_id:9 });
    await post(`/api/batteries/${vin}/recover`,{ actor_id:8 },403);
    const recovered = await post(`/api/batteries/${vin}/recover`,{ actor_id:7 });
    assert.equal(recovered.recovery.co2e_saved_kg,1324.8);
    await post(`/api/batteries/${vin}/recover`,{ actor_id:7 },409);
    const notice = await post('/api/batteries/VL-EU-2026-0012/enforce',{ actor_id:1 });
    assert.equal(notice.enforcement_fee_eur,250);
    await post('/api/batteries/VL-EU-2026-0012/enforce',{ actor_id:1 },409);
    assert.equal((await post('/api/ledger/verify',{ actor_id:1 })).valid,true);
    assert.equal((await post('/api/ledger/tamper',{ actor_id:1 })).valid,false);
    await post('/api/passports',{ actor_id:2,chemistry:'LFP',capacity_kwh:64,batch_count:1,factory_location:'Munich' },409);
    assert.equal((await post('/api/ledger/restore',{ actor_id:1 })).valid,true);
    assert.equal(verifyChain(db).valid,true);
    const final = await (await fetch(base+'/api/state')).json();
    assert.equal(final.kpis.revenue_breakdown.PASSPORT,28);
    assert.equal(final.kpis.revenue_breakdown.BROKERAGE,722);
    assert.equal(final.kpis.revenue_breakdown.ENFORCEMENT,250);
  } finally {
    app.locals.restoreDemo();
    await new Promise(resolve=>server.close(resolve));
    db.close();
  }
});

test('LFP recovery has no cobalt or nickel and one-pack routes have no artificial savings',() => {
  const recovery = recoveryFor({ chemistry:'LFP',capacity_kwh:60 });
  assert.equal(recovery.cobalt_kg,0);
  assert.equal(recovery.nickel_kg,0);
  const route = buildRoute([{ battery_vin:'TEST',listed_by:'Centre',current_location:'Stuttgart',lat:48.7758,lng:9.1829,chemistry:'LFP' }],
    { lat:50.1109,lng:8.6821 },{ organization:'Plant',city:'Cologne',lat:50.9375,lng:6.9603 });
  assert.equal(route.total_distance_km,route.baseline_unbatched_km);
  assert.equal(route.fuel_energy_saved_pct,0);
});