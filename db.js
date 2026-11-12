const Database = require('better-sqlite3');
const path = require('node:path');
const { appendBlock } = require('./blockchain');

const LOCATIONS = {
  Stuttgart: { city: 'Stuttgart', lat: 48.7758, lng: 9.1829 },
  Munich: { city: 'Munich', lat: 48.1351, lng: 11.5820 },
  Frankfurt: { city: 'Frankfurt', lat: 50.1109, lng: 8.6821 },
  Cologne: { city: 'Cologne', lat: 50.9375, lng: 6.9603 },
  Antwerp: { city: 'Antwerp', lat: 51.2194, lng: 4.4025 },
  Gothenburg: { city: 'Gothenburg', lat: 57.7089, lng: 11.9746 }
};

function createDatabase(filename = path.join(__dirname, 'voltloop.db')) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','oem','service_centre','recycler','logistics')),
      organization TEXT NOT NULL UNIQUE, city TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS logistics_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, route_code TEXT NOT NULL UNIQUE, carrier_org TEXT NOT NULL,
      truck_type TEXT NOT NULL, stops_json TEXT NOT NULL, destination_recycler TEXT NOT NULL,
      total_distance_km REAL NOT NULL, baseline_unbatched_km REAL NOT NULL, fuel_energy_saved_pct REAL NOT NULL,
      adr_checklist_completed INTEGER NOT NULL DEFAULT 0, adr_checklist_json TEXT NOT NULL DEFAULT '[false,false,false]',
      status TEXT NOT NULL CHECK(status IN ('PLANNED','IN_TRANSIT','DELIVERED'))
    );
    CREATE TABLE IF NOT EXISTS batteries (
      battery_vin TEXT PRIMARY KEY, oem_org TEXT NOT NULL, chemistry TEXT NOT NULL CHECK(chemistry IN ('NMC','LFP')),
      capacity_kwh REAL NOT NULL, manufacture_date TEXT NOT NULL, soh_percent REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','AVAILABLE_FOR_RECYCLING','SECOND_LIFE','BID_ACCEPTED','IN_TRANSIT','RECYCLED','OVERDUE_ALERT')),
      current_location TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, winning_recycler TEXT,
      assigned_route_id INTEGER REFERENCES logistics_routes(id), current_hash TEXT NOT NULL DEFAULT '',
      safety_condition TEXT NOT NULL DEFAULT 'Intact', listed_by TEXT, delivered_at TEXT,
      recovery_json TEXT, enforcement_sent INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS blockchain_ledger (
      block_index INTEGER PRIMARY KEY, timestamp TEXT NOT NULL, battery_vin TEXT NOT NULL, event_type TEXT NOT NULL,
      actor_role TEXT NOT NULL, actor_org TEXT NOT NULL, details TEXT NOT NULL, previous_hash TEXT NOT NULL, current_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_vin ON blockchain_ledger(battery_vin, block_index);
    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT, battery_vin TEXT NOT NULL REFERENCES batteries(battery_vin),
      recycler_org TEXT NOT NULL, bid_amount_eur REAL NOT NULL CHECK(bid_amount_eur > 0), brokerage_fee_eur REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING','ACCEPTED','REJECTED')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenue_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, amount_eur REAL NOT NULL, reference TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!db.prepare('SELECT COUNT(*) AS count FROM users').get().count) db.transaction(() => seed(db))();
  return db;
}

function seed(db) {
  const users = [
    ['Elena Fischer','admin','EU Compliance Admin','Frankfurt'],
    ['Lukas Weber','oem','Bavaria Motors EV','Munich'],
    ['Freja Lind','oem','NordicAuto','Gothenburg'],
    ['Jonas Keller','service_centre','Stuttgart EV Hub','Stuttgart'],
    ['Anna Braun','service_centre','Munich Service Depot','Munich'],
    ['Felix Roth','service_centre','Frankfurt Battery Care','Frankfurt'],
    ['Marie Hoffmann','recycler','Rhineland HydroMetal','Cologne'],
    ['Thomas De Smet','recycler','Antwerp GreenRefine','Antwerp'],
    ['Sofia Laurent','logistics','EuroVolt ADR Freight','Frankfurt']
  ];
  users.forEach(([name, role, organization, city], index) => {
    const location = LOCATIONS[city];
    db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?)').run(index + 1, name, role, organization, city, location.lat, location.lng);
  });
  appendBlock(db, { event_type: 'GENESIS', actor_role: 'admin', actor_org: 'EU Compliance Admin',
    details: { network: 'VoltLoop EU', protocol: 'SHA-256 linked ledger', version: 1 }, timestamp: '2026-01-01T09:00:00.000Z' });
  const inventory = [
    ['NMC',82,96,'ACTIVE','Munich'], ['LFP',64,93,'ACTIVE','Gothenburg'], ['NMC',100,89,'ACTIVE','Stuttgart'],
    ['NMC',82,62,'AVAILABLE_FOR_RECYCLING','Stuttgart'], ['LFP',64,68,'AVAILABLE_FOR_RECYCLING','Munich'],
    ['NMC',90,54,'AVAILABLE_FOR_RECYCLING','Frankfurt'], ['NMC',75,71,'AVAILABLE_FOR_RECYCLING','Stuttgart'],
    ['NMC',82,59,'BID_ACCEPTED','Stuttgart'], ['LFP',72,63,'BID_ACCEPTED','Munich'],
    ['NMC',95,48,'IN_TRANSIT','Frankfurt'], ['LFP',60,51,'IN_TRANSIT','Stuttgart'],
    ['NMC',85,39,'OVERDUE_ALERT','Frankfurt']
  ];
  inventory.forEach(([chemistry, capacity, soh, status, city], index) => {
    const batteryVin = `VL-EU-2026-${String(index + 1).padStart(4, '0')}`;
    const oem = index % 3 === 1 ? 'NordicAuto' : 'Bavaria Motors EV';
    const location = LOCATIONS[city];
    const centre = users.find(user => user[1] === 'service_centre' && user[3] === city);
    const listing = status !== 'ACTIVE' ? centre[2] : null;
    const winner = ['BID_ACCEPTED','IN_TRANSIT'].includes(status) ? 'Rhineland HydroMetal' : null;
    db.prepare(`INSERT INTO batteries (battery_vin,oem_org,chemistry,capacity_kwh,manufacture_date,soh_percent,status,current_location,lat,lng,winning_recycler,listed_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(batteryVin, oem, chemistry, capacity, `2021-${String(index % 9 + 1).padStart(2,'0')}-15`, soh, status, city, location.lat, location.lng, winner, listing);
    const history = (event_type, actor_role, actor_org, details, day) => appendBlock(db, {
      battery_vin: batteryVin, event_type, actor_role, actor_org, details,
      timestamp: `2026-10-${String(day).padStart(2,'0')}T10:${String(index).padStart(2,'0')}:00.000Z`
    });
    history('PASSPORT_MINTED','oem',oem,{ chemistry, capacity_kwh: capacity, minting_fee_eur: 2 },1);
    history('COMMISSIONED','oem',oem,{ fleet: 'European commercial EV fleet', soh_percent: 100 },3);
    history('DIAGNOSTIC_RECORDED',centre ? 'service_centre' : 'oem',centre ? centre[2] : oem,{ soh_percent: soh, safety_condition: 'Intact' },15);
    if (status !== 'ACTIVE') history('POSTED_FOR_RECYCLING','service_centre',listing,{ city, soh_percent: soh },16);
    if (winner) {
      const amount = index === 8 || index === 10 ? 780 : 1480;
      const result = db.prepare('INSERT INTO bids (battery_vin,recycler_org,bid_amount_eur,brokerage_fee_eur,status,created_at) VALUES (?,?,?,?,?,?)')
        .run(batteryVin,winner,amount,amount * 0.1,'ACCEPTED','2026-10-19T09:00:00.000Z');
      history('BID_ACCEPTED','admin','EU Compliance Admin',{ bid_id: result.lastInsertRowid, bid_amount_eur: amount, brokerage_fee_eur: amount * 0.1 },19);
      db.prepare('INSERT INTO revenue_entries (category,amount_eur,reference) VALUES (?,?,?)').run('BROKERAGE',amount * 0.1,batteryVin);
    }
    if (status === 'OVERDUE_ALERT') history('END_OF_LIFE_OVERDUE','admin','EU Compliance Admin',{ overdue_days: 47, compliance_reference: 'EU 2023/1542' },20);
  });
  const pending = [[4,'Rhineland HydroMetal',1520],[4,'Antwerp GreenRefine',1610],[5,'Antwerp GreenRefine',840],[6,'Rhineland HydroMetal',1740]];
  pending.forEach(([index,org,amount]) => {
    const vin = `VL-EU-2026-${String(index).padStart(4,'0')}`;
    const result = db.prepare('INSERT INTO bids (battery_vin,recycler_org,bid_amount_eur,brokerage_fee_eur,status,created_at) VALUES (?,?,?,?,?,?)').run(vin,org,amount,amount * 0.1,'PENDING','2026-10-21T09:00:00.000Z');
    appendBlock(db,{ battery_vin: vin, event_type: 'BID_SUBMITTED',actor_role: 'recycler',actor_org: org,details: { bid_id: result.lastInsertRowid, bid_amount_eur: amount } });
  });
  const routeStops = (indices) => {
    const stops = indices.map(index => {
      const battery = db.prepare('SELECT * FROM batteries WHERE battery_vin = ?').get(`VL-EU-2026-${String(index).padStart(4,'0')}`);
      return { type: 'pickup', organization: battery.listed_by, city: battery.current_location, lat: battery.lat, lng: battery.lng,
        battery_vins: [battery.battery_vin], chemistries: [battery.chemistry], hazard_class: 'UN 3480 / Class 9A', instructions: 'Scan passport; inspect enclosure; secure in UN-approved container.' };
    });
    stops.push({ type: 'dropoff',organization: 'Rhineland HydroMetal',...LOCATIONS.Cologne,
      battery_vins: indices.map(index => `VL-EU-2026-${String(index).padStart(4,'0')}`),instructions: 'Bay H2. Weigh sealed containers and scan handover with plant supervisor.' });
    return stops;
  };
  [[1,[8,9], 'PLANNED',680.4,948.8],[2,[10,11], 'IN_TRANSIT',402.8,586.4]].forEach(([id,indices,status,distance,baseline]) => {
    const checklist = status === 'IN_TRANSIT' ? [true,true,true] : [false,false,false];
    db.prepare(`INSERT INTO logistics_routes (id,route_code,carrier_org,truck_type,stops_json,destination_recycler,total_distance_km,baseline_unbatched_km,fuel_energy_saved_pct,adr_checklist_completed,adr_checklist_json,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,`VL-ADR-2026-00${id}`,'EuroVolt ADR Freight','ADR Class-9A Electric Heavy Truck',JSON.stringify(routeStops(indices)),'Rhineland HydroMetal',distance,baseline,Number(((baseline-distance)/baseline*100).toFixed(2)),status === 'IN_TRANSIT' ? 1 : 0,JSON.stringify(checklist),status);
    indices.forEach(index => {
      const vin = `VL-EU-2026-${String(index).padStart(4,'0')}`;
      db.prepare('UPDATE batteries SET assigned_route_id = ? WHERE battery_vin = ?').run(id,vin);
      appendBlock(db,{ battery_vin: vin,event_type: 'ROUTE_ASSIGNED',actor_role: 'logistics',actor_org: 'EuroVolt ADR Freight',details: { route_id: id, batched: true } });
      if (status === 'IN_TRANSIT') appendBlock(db,{ battery_vin: vin,event_type: 'TRUCK_DISPATCHED',actor_role: 'logistics',actor_org: 'EuroVolt ADR Freight',details: { route_id: id, adr_verified: true } });
    });
  });
  db.prepare('INSERT INTO revenue_entries (category,amount_eur,reference) VALUES (?,?,?)').run('PASSPORT',24,'Seeded fleet: 12 passports');
  db.prepare('INSERT INTO revenue_entries (category,amount_eur,reference) VALUES (?,?,?)').run('SAAS',2400,'November ecosystem subscriptions');
}

module.exports = { createDatabase, LOCATIONS };