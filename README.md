# VoltLoop

A runnable B2B circular battery marketplace prototype with five instant-switch demo portals, a local SQLite database, and a SHA-256 tamper-evident ledger. No frontend build step.

## Run in 3 steps

1. Open a terminal in this folder with Node.js 18+ and npm available (Node.js 22 LTS recommended). On this Windows workspace, use WSL: `wsl`, then `cd /mnt/c/Users/RAMSR/Documents/Personal/pp/VoltLoop/DemoProject`.
2. Install dependencies: `npm install`.
3. Start the app: `npm start`. Open **http://localhost:3000**.

The first startup automatically creates `voltloop.db`, 9 organizations, 12 batteries, 60+ linked history blocks, 4 pending marketplace offers, accepted historical bids, and 2 consolidated routes. All actions persist locally. `PORT=3001 npm start` selects another port. Do not share `node_modules` between Windows and WSL; SQLite's native binary must match the runtime platform.

## Present the circular workflow

- **Admin** opens on the ecosystem control tower. Audit the ledger, inspect passport history, accept pending offers, or send the seeded overdue passport a demo fine notice (€2,500 fine, €250 platform fee).
- **OEM**: choose an organization in the header, open **Mint passports**, and mint a 1–5 battery batch. Each passport records a €2 minting fee.
- **Service Centre**: select a passport, set SoH below 75%, and post it for recycling. Intact packs with SoH at least 75% can instead enter second-life storage. Damaged packs are flagged for specialist transport and never enter the standard truck batch.
- **Recycler**: bid on a listed battery. Turn on **Simulate admin acceptance** for an immediate handoff, or accept the offer in Admin or the listing Service Centre's **Bid management** view. The other Recycler is selectable in the header. Brokerage is recorded only when a bid is accepted.
- **Logistics Provider**: optimize unassigned accepted packs, inspect grouped pickup VINs and final plant unloading instructions, complete all three ADR checks, dispatch, then complete delivery. Two seeded multi-stop routes are already available.
- **Recycler**: open **Plant intake** and log metal recovery after delivery. Certificates record recovered Li/Co/Ni and avoided CO2e, and mark the battery recycled. Admin KPIs update immediately when switching back.
- **Admin / Blockchain ledger**: verify integrity, simulate a payload edit, observe the failed block and paused writes, then **Restore Demo Ledger**. Normal shutdown restores an active simulation; restore before force-killing the process.

## Implementation

| File | Responsibility |
| --- | --- |
| `server.js` | Express API, role/ownership checks, transaction boundaries, nearest-neighbor routing, recovery and enforcement |
| `db.js` | SQLite schema, indexes, realistic seeded organizations and lifecycle histories |
| `blockchain.js` | SHA-256 block creation, contiguous-chain/link validation, head checkpoint and passport pointer checks |
| `public/index.html` | SPA shell, persistent role switcher, Tailwind and Lucide CDN integrations |
| `public/app.js` | Organization state, interactive views, diagnostics, bids, route checklists, passport and certificate modals |
| `public/styles.css` | Responsive industrial Black / White / Cyan / Light Yellow-Green design system |

Run `npm test` for native Node tests covering chain corruption and the complete mint → diagnostic → listing → bidding → batching → ADR dispatch → delivery → recovery flow, fee totals and invalid/unauthorized transitions. Tests use in-memory SQLite and do not modify demo data.

## API

`GET /api/state` returns the network snapshot and KPIs. `GET /api/batteries/:vin/history` returns a passport's full chain history. POST actions take JSON containing the selected `actor_id`:

- `/api/passports`: `chemistry`, `capacity_kwh`, `batch_count`, `factory_location`
- `/api/batteries/:vin/diagnostic`: `soh_percent`, `safety_condition`, `action` (`recycle`, `second_life`, `diagnostic`)
- `/api/bids`: `battery_vin`, `bid_amount_eur`, optional `simulate_accept`
- `/api/bids/:id/accept`
- `/api/routes/optimize`
- `/api/routes/:id/checklist`: `checklist` (three booleans)
- `/api/routes/:id/dispatch`, `/api/routes/:id/deliver`
- `/api/batteries/:vin/recover`, `/api/batteries/:vin/enforce`
- `/api/ledger/verify`, `/api/ledger/tamper`, `/api/ledger/restore`

## Prototype boundaries

- This is a demo, **not production authentication or a decentralized blockchain**. Role switching and acceptance simulation are intentionally frictionless; actor IDs can be spoofed. No wallets, payments, regulator emails, or external compliance services are called. Do not expose the server publicly.
- Ledger hashes commit the block index, previous hash, timestamp, battery VIN, event type, actor role/organization, and serialized payload. The local head checkpoint detects truncation, but a database administrator who rewrites both the entire chain and checkpoint can defeat this model. Production needs external signed anchoring, access controls, and durable audit storage.
- `DELIVERED` belongs to a logistics route. A delivered battery remains `IN_TRANSIT` in the requested battery enum until recovery; its `delivered_at` and delivered route unlock plant intake. The UI labels it **Delivered**.
- Route distances are reproducible estimates using great-circle coordinates × 1.25, not live roads. Both scenarios include depot → pickup(s) → recycler, excluding return legs. Energy savings assume constant consumption per km; single-pack routes correctly show zero savings. Seeded route distances are illustrative historical manifests.
- Recovery estimates per kWh: NMC = 0.12 kg lithium, 0.15 kg cobalt, 0.65 kg nickel; LFP = 0.10 kg lithium and zero cobalt/nickel. Avoided emissions = 18 kg CO2e per kg recovered metal. These are demonstration factors, not independently certified measurements. The initial fleet has no recycled packs, so certified CO2e starts at zero.
- Revenue starts with €2,400 seeded monthly subscriptions, €24 passport fees and €452 accepted-bid brokerage. New actions record actual demo fees in a separate revenue table. Enforcement is a fixed illustrative fine and 10% cut, not legal advice.
- Tailwind, Lucide, Google Fonts and the EV photo require internet. Local CSS supplies the full layout even if Tailwind is unavailable. Lucide icons and the photo require their CDNs.
- To reset: stop the server, remove only `voltloop.db`, `voltloop.db-wal`, and `voltloop.db-shm`, then restart. The rich seed is recreated automatically.