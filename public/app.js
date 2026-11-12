const roles = {
  admin: { name:'Control tower',label:'CONTROL TOWER',views:[['overview','Overview','layout-dashboard'],['fleet','Battery passports','battery-charging'],['bids','Bid management','handshake'],['enforcement','Compliance','shield-alert'],['ledger','Blockchain ledger','blocks'],['revenue','Platform revenue','chart-no-axes-combined']] },
  oem: { name:'OEM portal',label:'MANUFACTURER',views:[['overview','Fleet overview','layout-dashboard'],['mint','Mint passports','scan-line'],['fleet','Lifecycle tracking','battery-charging']] },
  service_centre: { name:'Service centre',label:'SERVICE OPERATIONS',views:[['overview','Diagnostics & intake','activity'],['inventory','Posted inventory','package-search'],['bids','Incoming bids','handshake']] },
  recycler: { name:'Recycler portal',label:'RECOVERY OPERATIONS',views:[['overview','Battery marketplace','store'],['bids','My bids','handshake'],['intake','Plant intake','container'],['certificates','Recovery certificates','badge-check']] },
  logistics: { name:'Logistics portal',label:'TRANSPORT OPERATIONS',views:[['overview','Routes & dispatch','route'],['pickups','Pending pickups','package-check']] }
};
let state;
let role = localStorage.getItem('voltloop-role') || 'admin';
if (!roles[role]) role='admin';
let view = 'overview';
let actorId;
let routeId;
let filter = '';
let chemistryFilter = 'ALL';
let statusFilter = 'ALL';
let simulateAccept = false;
let busy = false;
let toastTimer;
let loadVersion = 0;
const icon = name => `<i data-lucide="${name}"></i>`;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,character=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]);
const euro = value => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(value || 0);
const num = (value,digits=0) => new Intl.NumberFormat('en-IE',{maximumFractionDigits:digits}).format(value || 0);
const date = value => new Date(value).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
const actor = () => state.users.find(user=>user.id===actorId);
const fleet = () => role==='oem' ? state.batteries.filter(battery=>battery.oem_org===actor().organization) : state.batteries;
const batteryByVin = vin => state.batteries.find(battery=>battery.battery_vin===vin);
const icons = () => { if (window.lucide) window.lucide.createIcons(); };
const statusNames = { ACTIVE:'Active',AVAILABLE_FOR_RECYCLING:'Listed for recycling',SECOND_LIFE:'Second life',BID_ACCEPTED:'Bid accepted',IN_TRANSIT:'In transit',RECYCLED:'Recycled',OVERDUE_ALERT:'Overdue alert',PENDING:'Pending',ACCEPTED:'Accepted',REJECTED:'Rejected',PLANNED:'Planned',DELIVERED:'Delivered' };
function badge(status) {
  const color = ['ACTIVE','RECYCLED','DELIVERED','ACCEPTED','SECOND_LIFE'].includes(status)?'green':['AVAILABLE_FOR_RECYCLING','IN_TRANSIT','BID_ACCEPTED'].includes(status)?'cyan':status==='OVERDUE_ALERT'?'red':'black';
  return `<span class="badge ${color}">${['ACTIVE','RECYCLED','DELIVERED'].includes(status)?'<span class="live-dot" style="background:currentColor;width:4px;height:4px"></span>':''}${statusNames[status] || escapeHtml(status)}</span>`;
}
const visibleStatus = battery => battery.status==='IN_TRANSIT' && battery.route_status==='DELIVERED' ? 'DELIVERED' : battery.status;
const button = (label,action,style='primary',extra='',symbol='arrow-up-right') => `<button class="button ${style}" data-action="${action}" ${extra}>${icon(symbol)}${label}</button>`;
const empty = (message,symbol='inbox') => `<div class="empty-state">${icon(symbol)}${message}</div>`;
const section = (title,body,subtitle='',action='') => `<section class="section"><div class="section-header"><div><h2>${title}</h2>${subtitle?`<span class="eyebrow">${subtitle}</span>`:''}</div>${action}</div>${body}</section>`;
function heading(title,subtitle,actions='',eyebrow='EUROPEAN BATTERY ECOSYSTEM') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function kpi(label,value,note,symbol,dark=false) {
  return `<article class="kpi-card ${dark?'dark':''}"><div class="kpi-top"><span>${label}</span>${icon(symbol)}</div><div class="kpi-value">${value}</div><div class="kpi-bottom">${icon(dark?'leaf':'arrow-up-right')}${note}</div></article>`;
}
function toast(message,error=false) {
  const element=document.getElementById('toast');
  element.textContent=message;
  element.className=`visible ${error?'error':''}`;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>element.className='',5000);
}
async function api(url,body) {
  const response=await fetch(url,{ method:body?'POST':'GET',headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify({actor_id:actorId,...body})}:{}) });
  const data=await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function load() {
  // Ignore stale snapshots when a presenter switches portals during an API refresh.
  const version=++loadVersion;
  const next=await api('/api/state');
  if(version!==loadVersion)return;
  state=next;
  const selected=Number(localStorage.getItem(`voltloop-actor-${role}`));
  if (!state.users.some(user=>user.id===actorId && user.role===role)) actorId=state.users.find(user=>user.id===selected && user.role===role)?.id || state.users.find(user=>user.role===role).id;
  render();
  document.getElementById('sync-time').textContent=`Last synced ${new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`;
}
function render() {
  const config=roles[role];
  document.querySelectorAll('[data-role]').forEach(element=>{const active=element.dataset.role===role;element.classList.toggle('active',active);element.setAttribute('aria-pressed',String(active));});
  document.getElementById('portal-label').textContent=config.label;
  document.getElementById('breadcrumb').textContent=config.name;
  document.getElementById('breadcrumb-view').textContent=config.views.find(item=>item[0]===view)?.[1] || 'Overview';
  document.getElementById('sidebar-nav').innerHTML=config.views.map(([id,label,symbol])=>`<button class="nav-link ${id===view?'active':''}" data-view="${id}" ${id===view?'aria-current="page"':''}>${icon(symbol)}${label}${id==='enforcement'?`<span class="nav-count">${state.batteries.filter(battery=>battery.status==='OVERDUE_ALERT'&&!battery.enforcement_sent).length}</span>`:''}</button>`).join('');
  document.getElementById('organization').innerHTML=state.users.filter(user=>user.role===role).map(user=>`<option value="${user.id}" ${user.id===actorId?'selected':''}>${escapeHtml(user.organization)}</option>`).join('');
  document.getElementById('avatar').textContent=actor().name.split(' ').map(part=>part[0]).join('');
  const renderers={admin:renderAdmin,oem:renderOEM,service_centre:renderService,recycler:renderRecycler,logistics:renderLogistics};
  document.getElementById('app').innerHTML=`<div class="fade-in">${!state.integrity.valid?`<div class="inline-warning">${icon('shield-alert')} Ledger integrity breach. Lifecycle writes are paused until the demo ledger is restored.</div>`:''}${renderers[role]()}</div>`;
  icons();
}
function searchToolbar(placeholder='Search battery VIN, organization or city',withStatus=true) {
  return `<div class="toolbar"><div class="filters"><label class="search-field">${icon('search')}<input class="input" id="search" type="search" placeholder="${placeholder}" aria-label="${placeholder}" value="${escapeHtml(filter)}"></label><select class="input" id="chemistry-filter" aria-label="Filter chemistry">${['ALL','NMC','LFP'].map(option=>`<option value="${option}" ${option===chemistryFilter?'selected':''}>${option==='ALL'?'All chemistries':option}</option>`).join('')}</select>${withStatus?`<select class="input" id="status-filter" aria-label="Filter lifecycle status">${['ALL',...Object.keys(statusNames).slice(0,7)].map(option=>`<option value="${option}" ${option===statusFilter?'selected':''}>${option==='ALL'?'All statuses':statusNames[option]}</option>`).join('')}</select>`:''}</div>${role==='recycler'&&view==='overview'?`<label class="toggle-label"><input id="simulate-accept" type="checkbox" ${simulateAccept?'checked':''}>Simulate admin acceptance</label>`:''}</div>`;
}
function filtered(batteries) {
  return batteries.filter(battery=>(chemistryFilter==='ALL'||battery.chemistry===chemistryFilter)&&(statusFilter==='ALL'||battery.status===statusFilter)&&`${battery.battery_vin} ${battery.oem_org} ${battery.current_location} ${battery.listed_by || ''}`.toLowerCase().includes(filter.toLowerCase()));
}
function batteryTable(batteries,action='history') {
  if(!batteries.length)return empty('No batteries match this view.','battery');
  return `<div class="table-scroll"><table><thead><tr><th>BATTERY VIN</th><th>CHEMISTRY / CAPACITY</th><th>STATE OF HEALTH</th><th>CURRENT LOCATION</th><th>LIFECYCLE STATUS</th><th></th></tr></thead><tbody>${batteries.map(battery=>`<tr><td><span class="mono">${escapeHtml(battery.battery_vin)}</span><small>${escapeHtml(battery.oem_org)}</small></td><td><span class="badge outline">${battery.chemistry}</span> <span class="muted">${battery.capacity_kwh} kWh</span></td><td><div class="soh-wrap"><span>${battery.soh_percent}%</span><span class="progress-track"><span style="width:${battery.soh_percent}%"></span></span></div></td><td>${escapeHtml(battery.current_location)}<small>${escapeHtml(battery.listed_by || 'OEM fleet')}</small></td><td>${badge(visibleStatus(battery))}</td><td>${action==='recover'?button('Log metal recovery','recover','small primary',`data-vin="${battery.battery_vin}"`,'recycle'):button('View history','history','small',`data-vin="${battery.battery_vin}"`,'fingerprint')}</td></tr>`).join('')}</tbody></table></div>`;
}
function fleetPage(title='Battery passports') {
  return heading(title,`${fleet().length} digital passports across the circular value chain`,button('Export inventory','export','', '', 'download'))+searchToolbar()+section('Lifecycle fleet',`<div id="filter-results">${batteryTable(filtered(fleet()))}</div>`,'Immutable identity. Continuous traceability.');
}
function routeMap(routes=state.routes) {
  const cities={Antwerp:[95,52],Cologne:[194,76],Frankfurt:[272,102],Stuttgart:[277,160],Munich:[405,162],Gothenburg:[409,30]};
  const lines=routes.slice(0,4).map((route,index)=>{
    const points=route.stops.map(stop=>cities[stop.city]).filter(Boolean);
    return `<polyline data-map-route="${route.id}" tabindex="0" role="button" aria-label="Inspect route ${escapeHtml(route.route_code)}" points="${points.map(point=>point.join(',')).join(' ')}" fill="none" stroke="${index%2?'#A3E635':'#06B6D4'}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="${route.status==='PLANNED'?'5 4':'none'}" opacity=".85"><title>${escapeHtml(route.route_code)}: ${route.total_distance_km} km</title></polyline>`;
  }).join('');
  return `<svg class="route-map" viewBox="0 0 500 205" role="img" aria-label="European route network connecting Antwerp, Cologne, Frankfurt, Stuttgart and Munich"><defs><pattern id="map-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#dfe8e1" stroke-width=".5"/></pattern></defs><rect width="500" height="205" fill="url(#map-grid)"/><path d="M35 0L61 33 46 60 72 89 69 130 100 143 131 175 160 176 188 204M166 0L165 36 202 47 208 83 230 94 229 124 259 139 266 177 307 192M295 0L315 47 339 59 331 91 353 107 349 138 368 164 375 205M455 0L442 44 464 83 433 108 457 150 442 183" fill="none" stroke="#d5e1d6" stroke-width="1"/><path d="M192 0Q201 40 187 77T224 132Q240 163 220 205" fill="none" stroke="#d2eaf0" stroke-width="5"/><text x="80" y="25" style="font-size:8px;fill:#95a197">BELGIUM</text><text x="287" y="48" style="font-size:8px;fill:#95a197">GERMANY</text><text x="388" y="197" style="font-size:8px;fill:#95a197">AUSTRIA</text>${lines}${Object.entries(cities).map(([city,[horizontal,vertical]])=>`<circle cx="${horizontal}" cy="${vertical}" r="5" fill="white" stroke="${['Cologne','Antwerp'].includes(city)?'#83b637':'#06B6D4'}" stroke-width="2"/><text class="city-label" x="${horizontal+10}" y="${vertical+4}">${city}</text>`).join('')}<text x="12" y="193" style="font-size:7px">SCHEMATIC NETWORK / NOT TO SCALE</text></svg>`;
}
function lifecycleChart() {
  const categories=[['ACTIVE','Active fleet','#090D16'],['AVAILABLE_FOR_RECYCLING','Recycling marketplace','#06B6D4'],['BID_ACCEPTED','Awaiting collection','#7dd7e5'],['IN_TRANSIT','In transit','#BEF264'],['RECYCLED','Recovered / second life','#8ea567'],['OVERDUE_ALERT','Compliance alerts','#db7285']];
  const counts=categories.map(([status])=>state.batteries.filter(battery=>battery.status===status||(status==='RECYCLED'&&battery.status==='SECOND_LIFE')).length);
  let offset=0;
  const total=state.batteries.length;
  const arcs=categories.map((category,index)=>{
    const percentage=counts[index]/total*100;
    const circle=`<circle cx="50" cy="50" r="40" fill="none" stroke="${category[2]}" stroke-width="10" pathLength="100" stroke-dasharray="${percentage} ${100-percentage}" stroke-dashoffset="${-offset}"/>`;
    offset+=percentage;return circle;
  }).join('');
  return `<div class="fleet-overview"><div class="donut"><svg viewBox="0 0 100 100" aria-label="Battery lifecycle distribution" role="img">${arcs}</svg><div class="donut-centre"><strong>${total}</strong><span>total passports</span></div></div><div>${categories.map((category,index)=>`<div class="legend-row"><span class="legend-dot" style="background:${category[2]}"></span>${category[1]}<strong>${counts[index]}</strong></div>`).join('')}</div></div><div class="section-summary"><span>Passports secured on the ledger</span><strong>${state.integrity.valid?'100% verified':'Integrity alert'}</strong></div>`;
}
function renderAdmin() {
  if(view==='fleet')return fleetPage();
  if(view==='ledger')return ledgerPage();
  if(view==='bids')return bidsPage();
  if(view==='enforcement')return enforcementPage();
  if(view==='revenue')return revenuePage();
  const metrics=state.kpis;
  const activeRoutes=state.routes.filter(route=>route.status!=='DELIVERED');
  return heading('Ecosystem overview','A live pulse on Europe’s circular battery network.',button('Export report','export','', '', 'download')+button('Verify chain','verify','primary','','shield-check'),'CONTROL TOWER / LIVE OPERATIONS')+
    `<div class="kpi-grid">${kpi('Total passports minted',num(metrics.passports),'Across <strong>2 OEM partners</strong>','scan-line')}${kpi('Platform revenue',euro(metrics.revenue_eur),'SaaS + minting + brokerage','wallet')}${kpi('CO₂e avoided',`${num(metrics.co2e_avoided_tonnes,2)}<small>tonnes</small>`,'Certified metal recovery','leaf',true)}${kpi('Active batched routes',String(metrics.active_routes),`<strong>${num(metrics.distance_saved_km,1)} km</strong> consolidated savings`,'route')}</div>`+
    `<div class="content-grid">${section('Battery lifecycle',lifecycleChart(),'Fleet distribution across every stage',`<button class="text-button" data-view="fleet">All passports ${icon('arrow-up-right')}</button>`)}${section('Connected circular network',routeMap(activeRoutes)+`<div class="map-caption"><span><b class="map-key"></b> Planned route</span><span><b class="map-key lime"></b> In transit</span><span>${icon('map-pin')} 6 EU cities</span></div>`+activeRoutes.slice(0,2).map(route=>`<div class="route-mini"><div class="route-mini-icon">${icon('truck')}</div><div class="route-mini-content"><strong>${escapeHtml(route.route_code)} ${badge(route.status)}</strong><p>${route.stops.filter(stop=>stop.type==='pickup').map(stop=>escapeHtml(stop.city)).join(' → ')} → ${escapeHtml(route.stops.at(-1).city)}</p></div><span class="route-mini-saving">−${route.fuel_energy_saved_pct}%</span></div>`).join(''),'Consolidated pickups. Less distance. Lower impact.')}</div>`+
    `<div class="activity-layout">${section('Latest ledger activity',state.ledger.slice(0,5).map(block=>`<div class="activity-row"><span class="activity-icon">${icon(block.event_type.includes('BID')?'handshake':block.event_type.includes('ROUTE')?'route':'fingerprint')}</span><div class="activity-info"><strong>${escapeHtml(block.event_type.replaceAll('_',' ').toLowerCase().replace(/^./,character=>character.toUpperCase()))}</strong><p><span class="mono">${escapeHtml(block.battery_vin)}</span> · ${escapeHtml(block.actor_org)}</p></div><span class="activity-time">${date(block.timestamp)}</span></div>`).join(''),'Latest cryptographically linked events',`<button class="text-button" data-view="ledger">Explore ledger ${icon('arrow-up-right')}</button>`)}${section('Compliance watch',enforcementContent(true),'EU battery regulation 2023/1542',`<span class="badge ${state.batteries.some(battery=>battery.status==='OVERDUE_ALERT'&&!battery.enforcement_sent)?'red':'green'}">${state.batteries.filter(battery=>battery.status==='OVERDUE_ALERT'&&!battery.enforcement_sent).length} open alert</span>`)}</div>`;
}
function renderOEM() {
  if(view==='fleet')return fleetPage('Lifecycle tracking');
  if(view==='mint')return mintPage();
  const owned=fleet();
  return heading('Your battery fleet',escapeHtml(actor().organization)+' · Digital identity from factory to recovery',button('Mint new passports','go-mint','primary','','scan-line'),'MANUFACTURER / DIGITAL PASSPORTS')+`<div class="kpi-grid">${kpi('Digital passports',owned.length,'Minted and ledger-linked','battery-charging')}${kpi('Active in fleet',owned.filter(battery=>battery.status==='ACTIVE').length,'In-vehicle operation','activity')}${kpi('Average fleet SoH',`${num(owned.reduce((sum,battery)=>sum+battery.soh_percent,0)/owned.length,1)}<small>%</small>`,'Latest service diagnostics','heart-pulse',true)}${kpi('Circular transitions',owned.filter(battery=>battery.status!=='ACTIVE').length,'Recycling and second life','recycle')}</div>`+searchToolbar()+section('Lifecycle fleet',`<div id="filter-results">${batteryTable(filtered(owned))}</div>`,'Every passport. One continuous chain of custody.');
}
function mintPage() {
  return heading('Mint battery passports',escapeHtml(actor().organization)+' · New factory batch',button('View fleet','go-fleet','','','arrow-right'),'MANUFACTURER / PASSPORT MINTING')+`<div class="mint-layout"><form id="mint-form" class="form-section"><h2 style="margin-bottom:22px">Factory batch details</h2><div class="form-grid"><label class="field"><span class="field-label">Battery chemistry</span><select name="chemistry" class="input"><option>NMC</option><option>LFP</option></select></label><label class="field"><span class="field-label">Capacity (kWh)</span><input name="capacity" type="number" min="10" max="250" step="0.1" value="82" required class="input"></label><label class="field"><span class="field-label">Batch count</span><input name="batch" type="number" min="1" max="5" value="1" required class="input"><span class="field-hint">1–5 passports per batch</span></label><label class="field"><span class="field-label">Factory location</span><select name="location" class="input">${Object.keys(state.locations).map(city=>`<option ${actor().city===city?'selected':''}>${city}</option>`).join('')}</select></label></div><div class="form-actions"><button class="button primary" type="submit">${icon('scan-line')}Mint Passport on Blockchain</button><span class="fee-callout">Batch fee: <strong id="mint-fee">€2.00</strong></span></div></form><div class="passport-preview"><span class="eyebrow">VOLTLOOP DIGITAL BATTERY PASSPORT</span><h3>${escapeHtml(actor().organization)}</h3><div class="passport-art">${icon('battery-charging')}</div><div class="preview-row"><span>NETWORK</span><strong>EU / SHA-256</strong></div><div class="preview-row"><span>MINTING FEE</span><strong>€2.00 / PASSPORT</strong></div></div></div>`+section('Recently minted passports',batteryTable(fleet().slice(-5).reverse()));
}
function renderService() {
  if(view==='bids')return bidsPage();
  if(view==='inventory')return inventoryPage();
  const eligible=state.batteries.filter(battery=>['ACTIVE','SECOND_LIFE','OVERDUE_ALERT','AVAILABLE_FOR_RECYCLING'].includes(battery.status)&&(battery.status!=='AVAILABLE_FOR_RECYCLING'||battery.listed_by===actor().organization));
  const battery=eligible[0];
  return heading('Diagnostics & intake',`${escapeHtml(actor().organization)} · ${escapeHtml(actor().city)}`,'','SERVICE CENTRE / BATTERY TRIAGE')+`<div class="diagnostic-layout"><form id="diagnostic-form" class="form-section"><h2 style="margin-bottom:22px">Battery diagnostic</h2><label class="field"><span class="field-label">Battery passport</span><select name="vin" id="diagnostic-vin" class="input">${eligible.map(item=>`<option value="${item.battery_vin}">${item.battery_vin} · ${item.chemistry} · ${item.current_location}</option>`).join('')}</select></label>${battery?`<div class="range-value"><span id="soh-value">${battery.soh_percent}</span><small>% SoH</small></div><input id="soh-slider" name="soh" type="range" min="0" max="100" value="${battery.soh_percent}" aria-label="State of health percentage"><div class="range-scale"><span>0% · End of life</span><span>75% threshold</span><span>100%</span></div><div style="margin-top:25px"><span class="field-label">Physical safety condition</span><div class="safety-options"><label class="radio-option"><input type="radio" name="safety" value="Intact" ${battery.safety_condition==='Intact'?'checked':''}>Intact</label><label class="radio-option"><input type="radio" name="safety" value="Damaged / Thermal Risk" ${battery.safety_condition!=='Intact'?'checked':''}>Damaged / Thermal Risk</label></div></div><div id="routing-result" class="routing-result"></div><div class="form-actions"><button name="action" value="recycle" id="recycle-button" class="button primary" type="submit">${icon('recycle')}Post Battery for Recycling</button><button name="action" value="second_life" id="second-life-button" class="button" type="submit">${icon('battery-full')}Route to Second-Life Storage</button></div>`:empty('No batteries available for intake.')}</form>${section('Centre inventory',inventoryContent(),'Current listings and accepted recycler offers')}</div>`+section('Intake-ready passports',batteryTable(eligible.slice(0,6)));
}
function inventoryContent() {
  const listed=state.batteries.filter(battery=>battery.listed_by===actor().organization);
  return listed.length?`<div class="table-scroll"><table><thead><tr><th>BATTERY VIN</th><th>BIDS / RECYCLER</th><th>STATUS</th></tr></thead><tbody>${listed.map(battery=>`<tr><td><span class="mono">${battery.battery_vin}</span><small>${battery.chemistry} · ${battery.capacity_kwh} kWh · ${battery.soh_percent}% SoH</small></td><td>${battery.winning_recycler?escapeHtml(battery.winning_recycler):`${state.bids.filter(bid=>bid.battery_vin===battery.battery_vin&&bid.status==='PENDING').length} pending bids`}</td><td>${badge(visibleStatus(battery))}</td></tr>`).join('')}</tbody></table></div>`:empty('No batteries posted by this service centre.','package');
}
function inventoryPage() { return heading('Posted inventory',escapeHtml(actor().organization)+' · Listings, bids and collection status')+section('Centre inventory',inventoryContent()); }
function renderRecycler() {
  if(view==='bids')return bidsPage();
  if(view==='intake')return intakePage();
  if(view==='certificates')return certificatesPage();
  const available=state.batteries.filter(battery=>battery.status==='AVAILABLE_FOR_RECYCLING');
  return heading('Battery marketplace','Verified end-of-life batteries, ready for a new material cycle.','','RECYCLER / CIRCULAR MARKETPLACE')+`<div class="kpi-grid">${kpi('Available batteries',available.length,'From verified service centres','battery-medium')}${kpi('My pending bids',state.bids.filter(bid=>bid.recycler_org===actor().organization&&bid.status==='PENDING').length,'10% brokerage on acceptance','handshake')}${kpi('Recoverable value',euro(available.reduce((sum,battery)=>sum+battery.mineral_value_eur,0)),'Estimated mineral value','gem',true)}${kpi('Awaiting plant intake',state.batteries.filter(battery=>battery.winning_recycler===actor().organization&&battery.delivered_at&&battery.status==='IN_TRANSIT').length,'Delivered to your plant','container')}</div>`+searchToolbar('Search VIN or pickup city',false)+`<div id="filter-results">${marketCards(filtered(available))}</div>`;
}
function marketCards(batteries) {
  if(!batteries.length)return empty('No available batteries match your filters.','store');
  return `<div class="market-grid">${batteries.map(battery=>{
    const existing=state.bids.find(bid=>bid.battery_vin===battery.battery_vin&&bid.recycler_org===actor().organization&&bid.status==='PENDING');
    return `<article class="battery-card"><div class="battery-card-top">${icon('battery-medium')}<span class="badge ${battery.safety_condition==='Intact'?'green':'red'}">${battery.safety_condition==='Intact'?'Verified passport':'Thermal risk'}</span></div><div class="battery-card-body"><h3>${battery.battery_vin}</h3><div class="city">${icon('map-pin')}${escapeHtml(battery.current_location)} · ${escapeHtml(battery.listed_by)}</div><div class="battery-specs"><div><span>CHEMISTRY</span><strong>${battery.chemistry}</strong></div><div><span>CAPACITY</span><strong>${battery.capacity_kwh} kWh</strong></div><div><span>HEALTH</span><strong>${battery.soh_percent}%</strong></div></div><div class="battery-value"><span>Est. recoverable mineral value</span><strong>${euro(battery.mineral_value_eur)}</strong></div><div class="battery-card-actions">${existing?`<button class="button" disabled>${icon('clock-3')}Bid pending · ${euro(existing.bid_amount_eur)}</button>`:button('Place bid','bid','primary',`data-vin="${battery.battery_vin}"`,'handshake')}<button class="icon-button" data-action="history" data-vin="${battery.battery_vin}" title="View blockchain history" aria-label="View history for ${battery.battery_vin}">${icon('fingerprint')}</button></div></div></article>`;
  }).join('')}</div>`;
}
function bidsPage() {
  const bids=state.bids.filter(bid=>role==='recycler'?bid.recycler_org===actor().organization:role==='service_centre'?batteryByVin(bid.battery_vin).listed_by===actor().organization:role==='oem'?batteryByVin(bid.battery_vin).oem_org===actor().organization:true);
  return heading(role==='recycler'?'My marketplace bids':'Bid management',`${bids.filter(bid=>bid.status==='PENDING').length} pending offers · 10% brokerage on accepted bids`)+section('Recycler offers',bids.length?`<div class="table-scroll"><table><thead><tr><th>BATTERY VIN</th><th>RECYCLER</th><th>BID AMOUNT</th><th>VOLTLOOP FEE</th><th>STATUS</th><th></th></tr></thead><tbody>${bids.map(bid=>`<tr><td><span class="mono">${bid.battery_vin}</span><small>${date(bid.created_at)}</small></td><td>${escapeHtml(bid.recycler_org)}</td><td>${euro(bid.bid_amount_eur)}</td><td>${euro(bid.brokerage_fee_eur)}</td><td>${badge(bid.status)}</td><td>${role!=='recycler'&&bid.status==='PENDING'?button('Accept bid','accept-bid','small primary',`data-id="${bid.id}"`,'check'):button('View passport','history','small',`data-vin="${bid.battery_vin}"`,'fingerprint')}</td></tr>`).join('')}</tbody></table></div>`:empty('No bids for this organization.','handshake'));
}
function intakePage() {
  const delivered=state.batteries.filter(battery=>battery.winning_recycler===actor().organization&&battery.delivered_at&&battery.status==='IN_TRANSIT');
  const incoming=state.batteries.filter(battery=>battery.winning_recycler===actor().organization&&!battery.delivered_at&&['IN_TRANSIT','BID_ACCEPTED'].includes(battery.status));
  return heading('Plant intake & recovery',escapeHtml(actor().organization)+' · '+escapeHtml(actor().city),'','RECYCLER / MATERIAL RECOVERY')+section('Delivered · ready for certification',batteryTable(delivered,'recover'),`${delivered.length} packs awaiting metal recovery`)+`<div style="margin-top:27px">${section('Incoming shipments',batteryTable(incoming),'Accepted and in-transit batteries')}</div>`;
}
function certificatesPage() {
  const certified=state.batteries.filter(battery=>battery.winning_recycler===actor().organization&&battery.status==='RECYCLED');
  return heading('Recovery certificates',escapeHtml(actor().organization)+' · Blockchain-certified recovered metals')+section('Certified recovery',certified.length?`<div class="table-scroll"><table><thead><tr><th>BATTERY VIN</th><th>LITHIUM</th><th>COBALT</th><th>NICKEL</th><th>CO₂e AVOIDED</th><th></th></tr></thead><tbody>${certified.map(battery=>`<tr><td><span class="mono">${battery.battery_vin}</span><small>${battery.recovery.certificate_id}</small></td><td>${battery.recovery.lithium_kg} kg</td><td>${battery.recovery.cobalt_kg} kg</td><td>${battery.recovery.nickel_kg} kg</td><td><span class="badge green">${num(battery.recovery.co2e_saved_kg,2)} kg</span></td><td>${button('Certificate','certificate','small',`data-vin="${battery.battery_vin}"`,'badge-check')}</td></tr>`).join('')}</tbody></table></div>`:empty('No recovery certificates yet. Complete a delivered battery’s recovery to certify its metals.','badge-check'));
}
function renderLogistics() {
  if(view==='pickups')return heading('Pending pickups','Accepted batteries awaiting route assignment')+section('Pickup queue',batteryTable(state.batteries.filter(battery=>battery.status==='BID_ACCEPTED'&&!battery.assigned_route_id)));
  const routes=state.routes.filter(route=>route.carrier_org===actor().organization);
  if(!routes.some(route=>route.id===routeId))routeId=routes[0]?.id;
  const selected=routes.find(route=>route.id===routeId);
  const blocked=state.batteries.filter(battery=>battery.status==='BID_ACCEPTED'&&!battery.assigned_route_id&&battery.safety_condition!=='Intact').length;
  return heading('Routes & dispatch','Consolidated collections. ADR-compliant delivery.',button('Optimize & Batch Pending Pickups','optimize','primary','','route'),'LOGISTICS / SMART CONSOLIDATION')+`${blocked?`<div class="inline-warning">${blocked} thermal-risk pack(s) excluded from standard batching. Specialist ADR transport assessment required.</div>`:''}`+
    `<div class="kpi-grid">${kpi('Pending pickups',state.batteries.filter(battery=>battery.status==='BID_ACCEPTED'&&!battery.assigned_route_id).length,'Ready for batch planning','package-check')}${kpi('Active routes',routes.filter(route=>route.status!=='DELIVERED').length,'Planned and in transit','truck')}${kpi('Distance saved',`${num(routes.reduce((sum,route)=>sum+route.distance_saved_km,0),1)}<small>km</small>`,'Versus individual direct trips','leaf',true)}${kpi('Delivered truckloads',routes.filter(route=>route.status==='DELIVERED').length,'Signed plant handovers','container')}</div>`+`<div class="route-list"><div class="route-selectors">${routes.map(route=>`<button class="route-picker ${route.id===routeId?'active':''}" data-route="${route.id}"><div class="route-picker-top"><strong>${route.route_code}</strong>${badge(route.status)}</div><p>${escapeHtml(route.destination_recycler)}</p><small>${route.stops.filter(stop=>stop.type==='pickup').length} pickup stops · ${route.stops.at(-1).battery_vins.length} battery packs</small><div class="route-saving"><span>${num(route.total_distance_km,1)} km batched</span><strong>−${route.fuel_energy_saved_pct}% energy</strong></div></button>`).join('')}</div><div id="route-detail">${selected?routeDetails(selected):empty('Accept recycler bids to generate a pickup route.','route')}</div></div>`;
}
function routeDetails(route) {
  return `<section class="route-details"><div class="section-header"><div><h2>${route.route_code}</h2><span class="eyebrow">${route.truck_type}</span></div>${badge(route.status)}</div>${routeMap([route])}<div class="distance-grid"><div class="distance-item"><span>INDIVIDUAL DIRECT TRIPS</span><strong>${num(route.baseline_unbatched_km,1)} <small>km</small></strong></div><div class="distance-item"><span>OPTIMIZED BATCHED ROUTE</span><strong>${num(route.total_distance_km,1)} <small>km</small></strong></div><div class="distance-item saving"><span>DISTANCE SAVED</span><strong>${num(route.distance_saved_km,1)} <small>km</small></strong></div></div><div class="saving-band"><span>${icon('leaf')} Fuel / energy burn reduced</span><strong>${route.fuel_energy_saved_pct}%</strong></div><div class="manifest"><h3 style="margin-bottom:20px">Collection & delivery manifest</h3>${route.stops.map((stop,index)=>`<div class="stop"><span class="stop-number">${stop.type==='dropoff'?icon('flag'):index+1}</span><span class="eyebrow">${stop.type==='dropoff'?'FINAL DROPOFF':`STOP ${index+1} / PICKUP`} · ${escapeHtml(stop.city)}</span><h3>${escapeHtml(stop.organization)}</h3><div class="vin-tags">${stop.battery_vins.map(vin=>`<span class="badge hash">${vin}</span>`).join('')}</div><p>${stop.type==='pickup'?`${stop.chemistries.join(' / ')} · ${stop.hazard_class}<br>`:''}${escapeHtml(stop.instructions)}</p></div>`).join('')}</div><div class="adr-panel"><div class="adr-title">${icon('shield-check')}ADR dangerous goods safety gate</div>${['UN-Approved Fireproof Containers Loaded','Class 9A Lithium Hazard Placards Mounted','Driver ADR License Verified'].map((label,index)=>`<label class="check-row"><input class="adr-check" data-index="${index}" type="checkbox" ${route.adr_checklist[index]?'checked':''} ${route.status!=='PLANNED'?'disabled':''}>${label}</label>`).join('')}<div class="adr-actions">${route.status==='PLANNED'?button('Dispatch Electric Truck','dispatch','primary',`data-id="${route.id}" ${route.adr_checklist.every(Boolean)?'':'disabled'}`,'truck'):route.status==='IN_TRANSIT'?button('Complete Delivery','deliver','primary',`data-id="${route.id}" ${route.adr_checklist_completed?'':'disabled'}`,'package-check'):`<span class="badge green">${icon('check-check')}Delivered · handover recorded</span>`}</div></div><p class="section-note">Distance model: great-circle distance × 1.25 road factor. Both scenarios start at the carrier’s depot and end at the plant; return legs excluded. Energy reduction assumes equal energy use per kilometre. Prototype estimate, not live road navigation.</p></section>`;
}
function integrityBanner() {
  return `<div class="verification-banner ${state.integrity.valid?'':'bad'}">${icon(state.integrity.valid?'shield-check':'shield-alert')}<div><strong>${state.integrity.valid?'Ledger integrity verified':'Unauthorized edit detected'}</strong><small>${escapeHtml(state.integrity.message)}</small></div></div>`;
}
function ledgerPage() {
  return heading('Blockchain ledger',`${state.ledger.length} linked blocks · SHA-256 cryptographic audit trail`,button('Verify Chain Integrity','verify','primary','','shield-check')+button(state.integrity.valid?'Simulate Tamper Attack':'Restore Demo Ledger',state.integrity.valid?'tamper':'restore',state.integrity.valid?'danger':'','','flask-conical'),'CONTROL TOWER / LEDGER AUDIT')+integrityBanner()+section('Immutable event explorer',`<div class="table-scroll"><table><thead><tr><th>BLOCK #</th><th>TIMESTAMP</th><th>BATTERY VIN</th><th>EVENT / ACTOR</th><th>PREVIOUS HASH</th><th>CURRENT HASH</th><th></th></tr></thead><tbody>${state.ledger.map(block=>`<tr><td><span class="ledger-number">#${block.block_index}</span></td><td>${date(block.timestamp)}</td><td><span class="mono">${block.battery_vin}</span></td><td><span class="badge black">${block.event_type}</span><small>${escapeHtml(block.actor_org)}</small></td><td><span class="mono muted" title="${block.previous_hash}">${block.previous_hash.slice(0,12)}…</span></td><td><span class="badge hash" title="${block.current_hash}">${block.current_hash.slice(0,14)}…</span></td><td><button class="icon-button" title="Inspect full block" aria-label="Inspect block ${block.block_index}" data-action="block" data-id="${block.block_index}">${icon('expand')}</button></td></tr>`).join('')}</tbody></table></div><div class="pagination-note">${state.ledger.length} blocks · newest first · local tamper-evident ledger</div>`);
}
function enforcementContent(compact=false) {
  const overdue=state.batteries.filter(battery=>battery.status==='OVERDUE_ALERT');
  return overdue.length?overdue.map(battery=>`<div class="alert-panel" style="margin-bottom:15px"><div class="alert-top"><h3>${battery.enforcement_sent?'Notice recorded':'End-of-life scan overdue'}</h3>${badge(battery.enforcement_sent?'ACCEPTED':'OVERDUE_ALERT')}</div><span class="mono">${battery.battery_vin}</span><p>${escapeHtml(battery.oem_org)} · ${escapeHtml(battery.current_location)}<br>47 days past collection deadline. No recycling scan recorded.</p>${battery.enforcement_sent?'<span class="badge green">Regulator fine notice sent · €250 fee</span>':button('Send Regulator Fine Notice','enforce','small danger',`data-vin="${battery.battery_vin}"`,'send')}</div>`).join('')+`<div class="compliance-stat"><span>Enforcement fee share</span><strong>10% of €2,500 notice</strong></div>`:empty('All passports are compliant.','shield-check');
}
function enforcementPage() {return heading('Government enforcement','End-of-life battery VINs without a recycling scan','','CONTROL TOWER / ECOSYSTEM GOVERNANCE')+section('Battery VIN enforcement queue',enforcementContent());}
function revenuePage() {
  const categories={SAAS:'Ecosystem SaaS subscriptions',PASSPORT:'Digital passports · €2 per mint',BROKERAGE:'Marketplace brokerage · 10%',ENFORCEMENT:'Enforcement notices · 10% fee share'};
  return heading('Platform revenue','Recorded subscription, minting, brokerage and enforcement fees',button('Export report','export','','','download'))+section('Revenue breakdown',Object.entries(categories).map(([key,label])=>`<div class="revenue-row"><span>${label}</span><strong>${euro(state.kpis.revenue_breakdown[key])}</strong></div>`).join('')+`<div class="revenue-row revenue-total"><span>Total recorded revenue</span><strong>${euro(state.kpis.revenue_eur)}</strong></div>`);
}
function showModal(title,body,eyebrow='DIGITAL BATTERY PASSPORT') {
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-eyebrow').textContent=eyebrow;
  document.getElementById('modal-body').innerHTML=body;
  const modal=document.getElementById('modal');
  if(!modal.open)modal.showModal();
  icons();
}
function blockDetails(block) {
  let payload;
  try{payload=JSON.stringify(JSON.parse(block.details),null,2);}catch{payload=block.details;}
  return `<article class="history-block"><div class="history-block-top"><span class="badge cyan">#${block.block_index} · ${escapeHtml(block.event_type)}</span><span class="muted">${date(block.timestamp)}</span></div><p>${escapeHtml(block.actor_org)} · ${escapeHtml(block.actor_role)}</p><pre>${escapeHtml(payload)}</pre><div class="full-hash"><span class="hash-label">PREVIOUS</span>${block.previous_hash}</div><div class="full-hash"><span class="hash-label">SHA-256</span>${block.current_hash}</div></article>`;
}
async function history(vin) {
  const battery=batteryByVin(vin);
  const blocks=await api(`/api/batteries/${encodeURIComponent(vin)}/history`);
  showModal(vin,`<dl class="info-list"><div><dt>Manufacturer</dt><dd>${escapeHtml(battery.oem_org)}</dd></div><div><dt>Lifecycle status</dt><dd>${badge(visibleStatus(battery))}</dd></div><div><dt>Battery specification</dt><dd>${battery.chemistry} · ${battery.capacity_kwh} kWh</dd></div><div><dt>Last diagnostic</dt><dd>${battery.soh_percent}% SoH · ${escapeHtml(battery.safety_condition)}</dd></div></dl><h3>${blocks.length} cryptographic lifecycle blocks</h3>${blocks.map(blockDetails).join('')}`);
}
function bidModal(vin) {
  const battery=batteryByVin(vin);
  showModal('Place recycler bid',`<form id="bid-form" data-vin="${vin}"><dl class="info-list"><div><dt>Battery VIN</dt><dd class="mono">${vin}</dd></div><div><dt>Pickup</dt><dd>${escapeHtml(battery.current_location)}</dd></div></dl><label class="field"><span class="field-label">Bid amount (€)</span><input name="amount" id="bid-amount" type="number" min="1" max="1000000" step="0.01" value="${Math.round(battery.mineral_value_eur*.75)}" class="input" required autofocus></label><div class="modal-fee"><span>VoltLoop brokerage commission (10%)</span><strong id="bid-fee">${euro(Math.round(battery.mineral_value_eur*.75)*.1)}</strong></div><label class="toggle-label"><input name="simulate" type="checkbox" ${simulateAccept?'checked':''}>Simulate OEM / Admin bid acceptance</label>${battery.safety_condition!=='Intact'?'<p class="modal-error">Thermal-risk pack: specialist transport required. Excluded from standard electric truck routes.</p>':''}<p class="modal-error" id="form-error" role="alert"></p><div class="modal-footer"><button class="button" type="button" data-action="close-modal">Cancel</button><button class="button primary" type="submit">${icon('handshake')}Submit bid</button></div></form>`,'RECYCLER / MARKETPLACE OFFER');
}
function recoveryDetails(recovery) {
  return `<div class="recovery-grid">${[['Lithium',recovery.lithium_kg],['Cobalt',recovery.cobalt_kg],['Nickel',recovery.nickel_kg]].map(([label,amount])=>`<div class="recovery-stat"><span>${label}</span><strong>${amount} <small>kg</small></strong></div>`).join('')}</div><div class="certificate"><strong>${num(recovery.co2e_saved_kg,2)} kg CO₂e avoided</strong><p>18 kg CO₂e per kg of recovered metal</p>${recovery.certificate_id?`<p class="mono">${recovery.certificate_id}</p>`:''}</div><p class="section-note">Prototype estimates: NMC yields 0.12 kg Li, 0.15 kg Co, 0.65 kg Ni per kWh; LFP yields 0.10 kg Li per kWh and no Co or Ni. Not a measured industrial recovery certificate.</p>`;
}
function recoverModal(vin) {
  const battery=batteryByVin(vin);
  const factors=battery.chemistry==='NMC'?[.12,.15,.65]:[.10,0,0];
  const metals=factors.map(factor=>Math.round(battery.capacity_kwh*factor*100)/100);
  const recovery={lithium_kg:metals[0],cobalt_kg:metals[1],nickel_kg:metals[2],co2e_saved_kg:Math.round(metals.reduce((sum,amount)=>sum+amount,0)*18*100)/100};
  showModal('Certify metal recovery',`<p class="mono">${vin} · ${battery.chemistry} · ${battery.capacity_kwh} kWh</p>${recoveryDetails(recovery)}<div class="modal-footer">${button('Log Metal Recovery on Blockchain','confirm-recover','primary',`data-vin="${vin}"`,'badge-check')}</div>`,'RECYCLER / RECOVERY CERTIFICATION');
}
function updateDiagnostic() {
  const form=document.getElementById('diagnostic-form');
  if(!form||!form.elements.soh)return;
  const soh=Number(form.elements.soh.value);
  const damaged=form.elements.safety.value!=='Intact';
  document.getElementById('soh-value').textContent=soh;
  document.getElementById('recycle-button').disabled=soh>=75;
  document.getElementById('second-life-button').disabled=soh<75||damaged;
  const result=document.getElementById('routing-result');
  result.classList.toggle('risk',damaged);
  result.innerHTML=`${icon(damaged?'shield-alert':soh<75?'recycle':'battery-full')}${damaged?'Thermal risk · specialist transport required':soh<75?'Below 75% SoH · eligible for recycling marketplace':'75% SoH or higher · eligible for second-life storage'}`;
  icons();
}
function updateFilters() {
  const container=document.getElementById('filter-results');
  if(!container)return;
  const batteries=role==='recycler'?state.batteries.filter(battery=>battery.status==='AVAILABLE_FOR_RECYCLING'):fleet();
  container.innerHTML=role==='recycler'?marketCards(filtered(batteries)):batteryTable(filtered(batteries));
  icons();
}
function exportCsv() {
  const rows=[['Battery VIN','OEM','Chemistry','Capacity kWh','SoH %','Location','Status','Current hash'],...fleet().map(battery=>[battery.battery_vin,battery.oem_org,battery.chemistry,battery.capacity_kwh,battery.soh_percent,battery.current_location,visibleStatus(battery),battery.current_hash])];
  const csv=rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const link=document.createElement('a');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  link.href=url;link.download=`voltloop-${role}-inventory.csv`;link.click();URL.revokeObjectURL(url);
  toast('Inventory report exported.');
}
async function perform(url,body,message,close=true) {
  const result=await api(url,body);
  if(close)document.getElementById('modal').close();
  await load();
  toast(message);
  return result;
}
document.addEventListener('click',async event=>{
  const mapLine=event.target.closest('[data-map-route]');
  if(mapLine){
    const route=state.routes.find(item=>item.id===Number(mapLine.dataset.mapRoute));
    if(role==='logistics'&&view==='overview'&&!document.getElementById('modal').open){routeId=route.id;render();}
    else showModal(route.route_code,`<div class="info-list"><div><span class="field-label">Carrier</span>${escapeHtml(route.carrier_org)}</div><div><span class="field-label">Route status</span>${badge(route.status)}</div></div><div class="saving-band"><span>${num(route.distance_saved_km,1)} km saved</span><strong>${route.fuel_energy_saved_pct}% energy reduction</strong></div><div class="manifest">${route.stops.map((stop,index)=>`<div class="stop"><span class="stop-number">${index+1}</span><h3>${escapeHtml(stop.organization)} · ${escapeHtml(stop.city)}</h3><div class="vin-tags">${stop.battery_vins.map(vin=>`<span class="badge hash">${vin}</span>`).join('')}</div><p>${escapeHtml(stop.instructions)}</p></div>`).join('')}</div>`,'LOGISTICS / ROUTE INSPECTION');
    return;
  }
  const target=event.target.closest('button');
  if(!target)return;
  if(target.dataset.role){role=target.dataset.role;localStorage.setItem('voltloop-role',role);view='overview';actorId=undefined;filter='';chemistryFilter='ALL';statusFilter='ALL';document.getElementById('modal').close();await load().catch(error=>toast(error.message,true));updateDiagnostic();return;}
  if(target.dataset.view){view=target.dataset.view;filter='';chemistryFilter='ALL';statusFilter='ALL';render();updateDiagnostic();return;}
  if(target.dataset.route){routeId=Number(target.dataset.route);render();return;}
  const action=target.dataset.action;
  if(!action)return;
  if(action==='close-modal'){document.getElementById('modal').close();return;}
  if(action==='export'){exportCsv();return;}
  if(action==='go-mint'||action==='go-fleet'){view=action==='go-mint'?'mint':'fleet';render();return;}
  if(busy)return;
  busy=true;target.disabled=true;
  try{
    const vin=target.dataset.vin;
    const id=target.dataset.id;
    if(action==='refresh'){await load();updateDiagnostic();toast('Workspace is up to date.');}
    if(action==='history')await history(vin);
    if(action==='bid')bidModal(vin);
    if(action==='block')showModal(`Block #${id}`,blockDetails(state.ledger.find(block=>block.block_index===Number(id))),'BLOCKCHAIN / FULL BLOCK');
    if(action==='certificate')showModal(batteryByVin(vin).recovery.certificate_id,recoveryDetails(batteryByVin(vin).recovery),'CERTIFIED MATERIAL RECOVERY');
    if(action==='accept-bid')await perform(`/api/bids/${id}/accept`,{},'Bid accepted. Battery is ready for logistics batching.');
    if(action==='optimize')await perform('/api/routes/optimize',{},'Pickup routes optimized and assigned.');
    if(action==='dispatch')await perform(`/api/routes/${id}/dispatch`,{},'ADR verified. Electric truck dispatched.');
    if(action==='deliver')await perform(`/api/routes/${id}/deliver`,{},'Delivery completed. Plant intake is ready.');
    if(action==='recover')recoverModal(vin);
    if(action==='confirm-recover')await perform(`/api/batteries/${vin}/recover`,{},'Metal recovery certified on the blockchain.');
    if(action==='enforce'){const result=await perform(`/api/batteries/${vin}/enforce`,{},'Regulator notice recorded.');toast(`Demo fine: ${euro(result.fine_eur)}. VoltLoop fee: ${euro(result.enforcement_fee_eur)}.`);}
    if(['verify','tamper','restore'].includes(action)){
      const result=await api(`/api/ledger/${action}`,{});
      await load();
      if(action==='verify'&&view!=='ledger'){showModal('Chain integrity audit',integrityBanner()+`<p class="muted">${result.checked} blocks recomputed against their SHA-256 hashes.</p>`,'CONTROL TOWER / AUDIT RESULT');}
      toast(result.message,!result.valid);
    }
  }catch(error){toast(error.message,true);}finally{busy=false;target.disabled=false;}
});
document.addEventListener('keydown',event=>{
  if(event.target.matches('[data-map-route]')&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search'){filter=event.target.value;updateFilters();}
  if(event.target.id==='soh-slider')updateDiagnostic();
  if(event.target.id==='bid-amount')document.getElementById('bid-fee').textContent=euro(Number(event.target.value)*.1);
  if(event.target.form?.id==='mint-form'&&event.target.name==='batch')document.getElementById('mint-fee').textContent=euro(Number(event.target.value)*2);
});
document.addEventListener('change',async event=>{
  const target=event.target;
  if(target.id==='organization'){actorId=Number(target.value);localStorage.setItem(`voltloop-actor-${role}`,actorId);render();updateDiagnostic();}
  if(target.id==='chemistry-filter'){chemistryFilter=target.value;updateFilters();}
  if(target.id==='status-filter'){statusFilter=target.value;updateFilters();}
  if(target.id==='simulate-accept')simulateAccept=target.checked;
  if(target.id==='diagnostic-vin'){
    const battery=batteryByVin(target.value);
    const form=target.form;
    form.elements.soh.value=battery.soh_percent;
    form.elements.safety.value=battery.safety_condition;
    updateDiagnostic();
  }
  if(target.name==='safety')updateDiagnostic();
  if(target.classList.contains('adr-check')){
    const checks=[...document.querySelectorAll('.adr-check')];
    checks.forEach(check=>check.disabled=true);
    try{
      const checklist=checks.map(check=>check.checked);
      await api(`/api/routes/${routeId}/checklist`,{checklist});
      const route=state.routes.find(item=>item.id===routeId);
      route.adr_checklist=checklist;route.adr_checklist_completed=checklist.every(Boolean)?1:0;
      document.getElementById('route-detail').innerHTML=routeDetails(route);icons();
    }catch(error){toast(error.message,true);await load();}
  }
});
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['mint-form','diagnostic-form','bid-form'].includes(form.id))return;
  event.preventDefault();if(busy)return;busy=true;
  const submit=event.submitter;submit.disabled=true;
  try{
    if(form.id==='mint-form'){
      const result=await perform('/api/passports',{chemistry:form.elements.chemistry.value,capacity_kwh:Number(form.elements.capacity.value),batch_count:Number(form.elements.batch.value),factory_location:form.elements.location.value},'Passports minted.');
      toast(`${result.battery_vins.length} passport(s) minted · ${euro(result.minting_fee_eur)} fee recorded.`);
    }
    if(form.id==='diagnostic-form'){
      const result=await perform(`/api/batteries/${form.elements.vin.value}/diagnostic`,{soh_percent:Number(form.elements.soh.value),safety_condition:form.elements.safety.value,action:submit.value},'Diagnostic saved and lifecycle updated.');
      updateDiagnostic();toast(result.status==='SECOND_LIFE'?'Battery routed to second-life storage.':'Battery posted for recycling.');
    }
    if(form.id==='bid-form')await perform('/api/bids',{battery_vin:form.dataset.vin,bid_amount_eur:Number(form.elements.amount.value),simulate_accept:form.elements.simulate.checked},form.elements.simulate.checked?'Bid accepted in demo mode. Ready for pickup.':'Bid submitted to marketplace.');
  }catch(error){if(document.getElementById('form-error'))document.getElementById('form-error').textContent=error.message;else toast(error.message,true);}finally{busy=false;submit.disabled=false;}
});
document.getElementById('modal').addEventListener('click',event=>{if(event.target===event.currentTarget){const bounds=event.currentTarget.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)event.currentTarget.close();}});
load().then(updateDiagnostic).catch(error=>{document.getElementById('app').innerHTML=empty(`Connection unavailable: ${escapeHtml(error.message)}<br>${button('Retry connection','refresh','','','refresh-cw')}`,'wifi-off');icons();});