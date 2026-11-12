const express = require('express');
const cors = require('cors');
const crypto = require('node:crypto');
const path = require('node:path');
const { createDatabase, LOCATIONS } = require('./db');
const { appendBlock, verifyChain } = require('./blockchain');

const round = value => Math.round(value * 100) / 100;
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };

// Road-distance estimates use great-circle kilometres with a disclosed 1.25 road factor.
function distanceBetween(origin, destination) {
  const radians = degrees => degrees * Math.PI / 180;
  const deltaLat = radians(destination.lat - origin.lat);
  const deltaLng = radians(destination.lng - origin.lng);
  const haversine = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(origin.lat)) * Math.cos(radians(destination.lat)) * Math.sin(deltaLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)) * 1.25;
}

function buildRoute(batteries, carrier, recycler) {
  const groups = new Map();
  batteries.forEach(battery => {
    const key = `${battery.listed_by}:${battery.lat}:${battery.lng}`;
    if (!groups.has(key)) groups.set(key, { type: 'pickup', organization: battery.listed_by, city: battery.current_location,
      lat: battery.lat,lng: battery.lng,battery_vins: [],chemistries: [],hazard_class: 'UN 3480 / Class 9A',
      instructions: 'Scan VINs, inspect intact pack enclosures and secure in UN-approved fireproof containers.' });
    groups.get(key).battery_vins.push(battery.battery_vin);
    if (!groups.get(key).chemistries.includes(battery.chemistry)) groups.get(key).chemistries.push(battery.chemistry);
  });
  let current = carrier;
  let batched = 0;
  const remaining = [...groups.values()];
  const stops = [];
  while (remaining.length) {
    remaining.sort((first, second) => distanceBetween(current, first) - distanceBetween(current, second));
    const next = remaining.shift();
    batched += distanceBetween(current, next);
    stops.push(next);
    current = next;
  }
  batched += distanceBetween(current, recycler);
  const baseline = batteries.reduce((sum, battery) => sum + distanceBetween(carrier, battery) + distanceBetween(battery, recycler), 0);
  stops.push({ type: 'dropoff',organization: recycler.organization,city: recycler.city,lat: recycler.lat,lng: recycler.lng,
    battery_vins: batteries.map(battery => battery.battery_vin),instructions: 'Unloading bay H2. Weigh containers, scan all VINs and obtain plant supervisor handover.' });
  const total = round(batched);
  const direct = round(baseline);
  return { stops, total_distance_km: total, baseline_unbatched_km: direct, fuel_energy_saved_pct: round((direct - total) / direct * 100) };
}

function recoveryFor(battery) {
  const factors = battery.chemistry === 'NMC' ? { lithium: 0.12, cobalt: 0.15, nickel: 0.65 } : { lithium: 0.10, cobalt: 0, nickel: 0 };
  const lithium_kg = round(battery.capacity_kwh * factors.lithium);
  const cobalt_kg = round(battery.capacity_kwh * factors.cobalt);
  const nickel_kg = round(battery.capacity_kwh * factors.nickel);
  return { lithium_kg,cobalt_kg,nickel_kg,co2e_saved_kg: round((lithium_kg+cobalt_kg+nickel_kg)*18),methodology: 'Prototype recovery factors per kWh; 18 kg CO2e avoided per kg of recovered metal.' };
}

function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));
  let tamperBackup = null;
  const users = () => db.prepare('SELECT * FROM users ORDER BY id').all();
  const batteries = () => db.prepare(`SELECT b.*,r.status AS route_status FROM batteries b LEFT JOIN logistics_routes r ON r.id=b.assigned_route_id ORDER BY b.battery_vin`).all().map(battery => ({ ...battery,
    recovery: battery.recovery_json ? JSON.parse(battery.recovery_json) : null,
    mineral_value_eur: round(battery.capacity_kwh * (battery.chemistry === 'NMC' ? 25 : 13)) }));
  const routes = () => db.prepare('SELECT * FROM logistics_routes ORDER BY id DESC').all().map(route => ({ ...route,
    stops: JSON.parse(route.stops_json),adr_checklist: JSON.parse(route.adr_checklist_json).length===3 ? JSON.parse(route.adr_checklist_json) : [false,false,false],distance_saved_km: round(route.baseline_unbatched_km-route.total_distance_km) }));
  const getBattery = vin => db.prepare('SELECT * FROM batteries WHERE battery_vin = ?').get(vin) || fail('Battery passport not found.',404);
  const getRoute = id => db.prepare('SELECT * FROM logistics_routes WHERE id = ?').get(id) || fail('Route not found.',404);
  const number = (value, min, max, label) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}.`);
    return value;
  };
  const actor = (req, roles) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.body.actor_id || req.headers['x-actor-id'] || 0));
    if (!user || !roles.includes(user.role)) fail('This action is not available to the selected demo role.',403);
    return user;
  };
  const event = (battery, type, user, details) => appendBlock(db,{ battery_vin: battery.battery_vin,event_type: type,actor_role: user.role,actor_org: user.organization,details });
  const revenue = (category, amount, reference) => db.prepare('INSERT INTO revenue_entries (category,amount_eur,reference) VALUES (?,?,?)').run(category,round(amount),reference);
  const mutate = handler => (req,res,next) => {
    try {
      const integrity = verifyChain(db);
      if (!integrity.valid) fail('Writes paused: restore the demo ledger and verify integrity first.',409);
      const result = db.transaction(() => handler(req))();
      res.json(result || { success: true });
    } catch (error) { next(error); }
  };
  const acceptBid = (bidId, user) => {
    const bid = db.prepare('SELECT * FROM bids WHERE id = ?').get(bidId) || fail('Bid not found.',404);
    const battery = getBattery(bid.battery_vin);
    if (battery.status !== 'AVAILABLE_FOR_RECYCLING' || bid.status !== 'PENDING') fail('This battery or bid is no longer available.',409);
    if (user.role === 'service_centre' && battery.listed_by !== user.organization) fail('Only the listing centre can accept this bid.',403);
    if (user.role === 'oem' && battery.oem_org !== user.organization) fail('This passport belongs to another OEM.',403);
    db.prepare("UPDATE bids SET status = CASE WHEN id = ? THEN 'ACCEPTED' ELSE 'REJECTED' END WHERE battery_vin = ? AND status = 'PENDING'").run(bid.id,battery.battery_vin);
    db.prepare("UPDATE batteries SET status='BID_ACCEPTED',winning_recycler=? WHERE battery_vin=?").run(bid.recycler_org,battery.battery_vin);
    revenue('BROKERAGE',bid.brokerage_fee_eur,battery.battery_vin);
    event(battery,'BID_ACCEPTED',user,{ bid_id: bid.id,recycler: bid.recycler_org,bid_amount_eur: bid.bid_amount_eur,brokerage_fee_eur: bid.brokerage_fee_eur });
    return bid;
  };

  app.get('/api/state',(req,res) => {
    const fleet = batteries();
    const routeList = routes();
    const fees = db.prepare('SELECT category,SUM(amount_eur) AS amount FROM revenue_entries GROUP BY category').all();
    const revenueBreakdown = Object.fromEntries(fees.map(fee => [fee.category,round(fee.amount)]));
    res.json({ users: users(),batteries: fleet,bids: db.prepare('SELECT * FROM bids ORDER BY id DESC').all(),routes: routeList,
      ledger: db.prepare('SELECT * FROM blockchain_ledger ORDER BY block_index DESC').all(),integrity: verifyChain(db),
      kpis: { passports: fleet.length,revenue_eur: round(fees.reduce((sum,fee)=>sum+fee.amount,0)),revenue_breakdown: revenueBreakdown,
        co2e_avoided_tonnes: round(fleet.reduce((sum,battery)=>sum+(battery.recovery?.co2e_saved_kg || 0),0)/1000),
        active_routes: routeList.filter(route=>route.status!=='DELIVERED').length,
        distance_saved_km: round(routeList.reduce((sum,route)=>sum+route.distance_saved_km,0)) },locations: LOCATIONS });
  });
  app.get('/api/batteries/:vin/history',(req,res) => {
    getBattery(req.params.vin);
    res.json(db.prepare('SELECT * FROM blockchain_ledger WHERE battery_vin=? ORDER BY block_index').all(req.params.vin));
  });
  app.post('/api/passports',mutate(req => {
    const user = actor(req,['oem']);
    const { chemistry,capacity_kwh,batch_count,factory_location } = req.body;
    if (!['NMC','LFP'].includes(chemistry)) fail('Select NMC or LFP chemistry.');
    number(capacity_kwh,10,250,'Capacity');
    number(batch_count,1,5,'Batch count');
    if (!Number.isInteger(batch_count)) fail('Batch count must be a whole number.');
    const location = LOCATIONS[factory_location] || fail('Select a supported factory location.');
    const created = [];
    for (let index=0;index<batch_count;index++) {
      const vin = `VL-EU-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      db.prepare(`INSERT INTO batteries (battery_vin,oem_org,chemistry,capacity_kwh,manufacture_date,soh_percent,status,current_location,lat,lng)
        VALUES (?,?,?,?,?,100,'ACTIVE',?,?,?)`).run(vin,user.organization,chemistry,capacity_kwh,new Date().toISOString().slice(0,10),location.city,location.lat,location.lng);
      const battery = getBattery(vin);
      event(battery,'PASSPORT_MINTED',user,{ chemistry,capacity_kwh,factory_location,minting_fee_eur: 2 });
      revenue('PASSPORT',2,vin);
      created.push(vin);
    }
    return { success: true,battery_vins: created,minting_fee_eur: batch_count*2 };
  }));
  app.post('/api/batteries/:vin/diagnostic',mutate(req => {
    const user = actor(req,['service_centre']);
    const battery = getBattery(req.params.vin);
    if (!['ACTIVE','SECOND_LIFE','OVERDUE_ALERT','AVAILABLE_FOR_RECYCLING'].includes(battery.status)) fail('Battery is already committed to a logistics or recovery workflow.',409);
    if (battery.listed_by && battery.listed_by!==user.organization && battery.status==='AVAILABLE_FOR_RECYCLING') fail('Battery is listed by another service centre.',403);
    const { soh_percent,safety_condition,action } = req.body;
    number(soh_percent,0,100,'State of health');
    if (!['Intact','Damaged / Thermal Risk'].includes(safety_condition)) fail('Select a safety condition.');
    if (!['recycle','second_life','diagnostic'].includes(action)) fail('Unknown diagnostic action.');
    if (action==='recycle' && soh_percent>=75) fail('Recycling listing requires SoH below 75%.');
    if (action==='second_life' && (soh_percent<75 || safety_condition!=='Intact')) fail('Second-life storage requires SoH of at least 75% and an intact battery.');
    const status = action==='recycle' ? 'AVAILABLE_FOR_RECYCLING' : action==='second_life' ? 'SECOND_LIFE' : battery.status;
    if (battery.status==='AVAILABLE_FOR_RECYCLING' && action==='diagnostic') fail('Relist inventory explicitly when changing listed diagnostics.');
    db.prepare('UPDATE batteries SET soh_percent=?,safety_condition=?,status=?,current_location=?,lat=?,lng=?,listed_by=? WHERE battery_vin=?')
      .run(soh_percent,safety_condition,status,user.city,user.lat,user.lng,action==='recycle'?user.organization:action==='second_life'?null:battery.listed_by,battery.battery_vin);
    db.prepare("UPDATE bids SET status='REJECTED' WHERE battery_vin=? AND status='PENDING'").run(battery.battery_vin);
    event(battery,'DIAGNOSTIC_RECORDED',user,{ soh_percent,safety_condition });
    if (action!=='diagnostic') event(battery,action==='recycle'?'POSTED_FOR_RECYCLING':'SECOND_LIFE_ROUTED',user,{ soh_percent,safety_condition,city: user.city });
    return { success: true,status };
  }));
  app.post('/api/bids',mutate(req => {
    const user = actor(req,['recycler']);
    const battery = getBattery(req.body.battery_vin);
    if (battery.status!=='AVAILABLE_FOR_RECYCLING') fail('Battery is no longer available.',409);
    const amount = round(number(req.body.bid_amount_eur,1,1000000,'Bid amount'));
    if (db.prepare("SELECT id FROM bids WHERE battery_vin=? AND recycler_org=? AND status='PENDING'").get(battery.battery_vin,user.organization)) fail('You already have a pending bid on this battery.',409);
    if (req.body.simulate_accept!==undefined && typeof req.body.simulate_accept!=='boolean') fail('Invalid acceptance toggle.');
    const result = db.prepare('INSERT INTO bids (battery_vin,recycler_org,bid_amount_eur,brokerage_fee_eur,status,created_at) VALUES (?,?,?,?,?,?)')
      .run(battery.battery_vin,user.organization,amount,round(amount*0.1),'PENDING',new Date().toISOString());
    event(battery,'BID_SUBMITTED',user,{ bid_id: result.lastInsertRowid,bid_amount_eur: amount,brokerage_fee_eur: round(amount*0.1) });
    if (req.body.simulate_accept) acceptBid(result.lastInsertRowid,users().find(person=>person.role==='admin'));
    return { success: true,bid_id: result.lastInsertRowid,brokerage_fee_eur: round(amount*0.1),accepted: !!req.body.simulate_accept };
  }));
  app.post('/api/bids/:id/accept',mutate(req => { const user = actor(req,['admin','service_centre','oem']); acceptBid(Number(req.params.id),user); return { success: true }; }));
  app.post('/api/routes/optimize',mutate(req => {
    const user = actor(req,['logistics']);
    const pending = db.prepare("SELECT * FROM batteries WHERE status='BID_ACCEPTED' AND assigned_route_id IS NULL AND safety_condition='Intact' ORDER BY battery_vin").all();
    if (!pending.length) fail('No unassigned intact batteries awaiting pickup. Accept a marketplace bid first.');
    const destinations = [...new Set(pending.map(battery=>battery.winning_recycler))];
    const created = [];
    destinations.forEach(destination => {
      const recycler = users().find(person=>person.organization===destination && person.role==='recycler') || fail('Recycler destination not found.');
      const fleet = pending.filter(battery=>battery.winning_recycler===destination);
      const route = buildRoute(fleet,user,recycler);
      const code = `VL-ADR-${new Date().getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const result = db.prepare(`INSERT INTO logistics_routes (route_code,carrier_org,truck_type,stops_json,destination_recycler,total_distance_km,baseline_unbatched_km,fuel_energy_saved_pct,adr_checklist_json,status)
        VALUES (?,?,?,?,?,?,?,?,'[false,false,false]','PLANNED')`).run(code,user.organization,'ADR Class-9A Electric Heavy Truck',JSON.stringify(route.stops),destination,route.total_distance_km,route.baseline_unbatched_km,route.fuel_energy_saved_pct);
      fleet.forEach(battery => {
        db.prepare('UPDATE batteries SET assigned_route_id=? WHERE battery_vin=?').run(result.lastInsertRowid,battery.battery_vin);
        event(battery,'ROUTE_ASSIGNED',user,{ route_id: result.lastInsertRowid,route_code: code,...route });
      });
      created.push(result.lastInsertRowid);
    });
    return { success: true,route_ids: created };
  }));
  app.post('/api/routes/:id/checklist',mutate(req => {
    const user = actor(req,['logistics']);
    const route = getRoute(req.params.id);
    if (route.carrier_org!==user.organization) fail('Route belongs to another carrier.',403);
    if (route.status!=='PLANNED') fail('The signed ADR checklist is locked after dispatch.',409);
    const checklist = req.body.checklist;
    if (!Array.isArray(checklist) || checklist.length!==3 || checklist.some(item=>typeof item!=='boolean')) fail('Provide all three ADR safety checks.');
    db.prepare('UPDATE logistics_routes SET adr_checklist_json=?,adr_checklist_completed=? WHERE id=?').run(JSON.stringify(checklist),checklist.every(Boolean)?1:0,route.id);
    return { success: true };
  }));
  app.post('/api/routes/:id/:action',mutate(req => {
    const user = actor(req,['logistics']);
    const route = getRoute(req.params.id);
    if (route.carrier_org!==user.organization) fail('Route belongs to another carrier.',403);
    const action = req.params.action;
    if (!['dispatch','deliver'].includes(action)) fail('Unknown route action.',404);
    if (!route.adr_checklist_completed) fail('Complete all three ADR checks before moving the truck.',409);
    if ((action==='dispatch' && route.status!=='PLANNED') || (action==='deliver' && route.status!=='IN_TRANSIT')) fail('Invalid route state transition.',409);
    const fleet = db.prepare('SELECT * FROM batteries WHERE assigned_route_id=?').all(route.id);
    if (fleet.some(battery=>battery.safety_condition!=='Intact')) fail('Thermal-risk batteries require a specialist ADR plan and cannot use this standard truck.',409);
    const destination = users().find(person=>person.organization===route.destination_recycler);
    const timestamp = new Date().toISOString();
    db.prepare('UPDATE logistics_routes SET status=? WHERE id=?').run(action==='dispatch'?'IN_TRANSIT':'DELIVERED',route.id);
    fleet.forEach(battery => {
      db.prepare("UPDATE batteries SET status='IN_TRANSIT',current_location=?,lat=?,lng=?,delivered_at=? WHERE battery_vin=?")
        .run(action==='deliver'?destination.city:`On route ${route.route_code}`,action==='deliver'?destination.lat:battery.lat,action==='deliver'?destination.lng:battery.lng,action==='deliver'?timestamp:null,battery.battery_vin);
      event(battery,action==='dispatch'?'TRUCK_DISPATCHED':'DELIVERED_TO_RECYCLER',user,{ route_id: route.id,adr_verified: true,destination: destination.organization });
    });
    return { success: true };
  }));
  app.post('/api/batteries/:vin/recover',mutate(req => {
    const user = actor(req,['recycler']);
    const battery = getBattery(req.params.vin);
    if (battery.winning_recycler!==user.organization) fail('This battery is assigned to a different plant.',403);
    if (battery.status!=='IN_TRANSIT' || !battery.delivered_at || getRoute(battery.assigned_route_id).status!=='DELIVERED') fail('Recovery requires a completed plant delivery.',409);
    const recovery = { ...recoveryFor(battery),certificate_id: `VL-REC-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,certified_at: new Date().toISOString(),plant: user.organization };
    db.prepare("UPDATE batteries SET status='RECYCLED',recovery_json=? WHERE battery_vin=?").run(JSON.stringify(recovery),battery.battery_vin);
    event(battery,'METAL_RECOVERY_CERTIFIED',user,recovery);
    return { success: true,recovery };
  }));
  app.post('/api/batteries/:vin/enforce',mutate(req => {
    const user = actor(req,['admin']);
    const battery = getBattery(req.params.vin);
    if (battery.status!=='OVERDUE_ALERT' || battery.enforcement_sent) fail('No outstanding enforcement notice for this passport.',409);
    const fine = 2500;
    const fee = fine*0.1;
    db.prepare('UPDATE batteries SET enforcement_sent=1 WHERE battery_vin=?').run(battery.battery_vin);
    revenue('ENFORCEMENT',fee,battery.battery_vin);
    event(battery,'REGULATOR_FINE_NOTICE_SENT',user,{ fine_eur: fine,enforcement_fee_eur: fee,fee_rate: 0.1,regulation: 'EU 2023/1542',demo_notice: true });
    return { success: true,fine_eur: fine,enforcement_fee_eur: fee };
  }));
  app.post('/api/ledger/verify',(req,res) => { actor(req,['admin']); res.json(verifyChain(db)); });
  app.post('/api/ledger/tamper',(req,res) => {
    actor(req,['admin']);
    if (tamperBackup) fail('A tamper simulation is already active.',409);
    const block = db.prepare("SELECT * FROM blockchain_ledger WHERE event_type='PASSPORT_MINTED' ORDER BY block_index LIMIT 1").get();
    tamperBackup = { block_index: block.block_index,details: block.details };
    db.prepare('UPDATE blockchain_ledger SET details=? WHERE block_index=?').run(JSON.stringify({ unauthorized_edit: true,capacity_kwh: 9999 }),block.block_index);
    res.json(verifyChain(db));
  });
  app.post('/api/ledger/restore',(req,res) => {
    actor(req,['admin']);
    if (tamperBackup) {
      db.prepare('UPDATE blockchain_ledger SET details=? WHERE block_index=?').run(tamperBackup.details,tamperBackup.block_index);
      tamperBackup = null;
    }
    res.json(verifyChain(db));
  });
  app.use('/api',(req,res)=>res.status(404).json({ error: 'API endpoint not found.' }));
  app.use(express.static(path.join(__dirname,'public')));
  app.use((error,req,res,next) => {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'An unexpected server error occurred.' });
  });
  const restoreDemo = () => {
    if (tamperBackup) db.prepare('UPDATE blockchain_ledger SET details=? WHERE block_index=?').run(tamperBackup.details,tamperBackup.block_index);
  };
  app.locals.restoreDemo = restoreDemo;
  return app;
}

if (require.main===module) {
  const db = createDatabase();
  const app = createApp(db);
  const port = process.env.PORT || 3000;
  const server = app.listen(port,'0.0.0.0',()=>console.log(`VoltLoop running at http://localhost:${port}`));
  const shutdown = () => { app.locals.restoreDemo(); server.close(()=>{ db.close(); process.exit(0); }); };
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
}

module.exports = { createApp,buildRoute,distanceBetween,recoveryFor };