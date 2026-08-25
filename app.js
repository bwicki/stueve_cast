// ---- StueveCast application: screens, map, time slider, models, rendering pipeline ----
// Loaded last; relies on the globals from core.js, info.js, analytics.js,
// draw.js, models.js and openmeteo.js (classic scripts sharing one scope,
// the same way the single-file S2 tool worked).

const APP_VERSION = 'v0.9.0 (2026-08-25)';
const SESSION_KEY = 'sc_session_v1';
const SETTINGS_KEY = 'sc_settings_v1';
const FAV_KEY = 'sc_favorites_v1';
const $ = id => document.getElementById(id);

// ---------- persistence helpers ----------
function lsGet(k, fallback){ try{ const v = localStorage.getItem(k); return v==null ? fallback : JSON.parse(v); }catch(e){ return fallback; } }
function lsSet(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

// ---------- settings (persisted display preferences) ----------
const SETTINGS_FIELDS = ['diagramType','altitudeUnit','speedUnit','windDisplayMode','showThetaE','cloudThreshold',
  'showLevelDots','transitionAltFt','transitionAltConfirmed','speedPanelWidth'];
let playSpeed = 1; // slider steps per second while playing
function saveSettings(){
  const o = {};
  SETTINGS_FIELDS.forEach(f=>o[f]=state[f]);
  o.theme = document.documentElement.dataset.theme || '';
  o.playSpeed = playSpeed;
  o.apiKey = state.apiKey || '';
  o.inspectLock = !!state.inspectLock;
  lsSet(SETTINGS_KEY, o);
}
function loadSettings(){
  const o = lsGet(SETTINGS_KEY, null);
  if(!o) return;
  SETTINGS_FIELDS.forEach(f=>{ if(o[f]!==undefined) state[f]=o[f]; });
  if(o.theme!==undefined) document.documentElement.dataset.theme = o.theme;
  if(o.playSpeed) playSpeed = o.playSpeed;
  if(o.apiKey) state.apiKey = o.apiKey;
  state.inspectLock = !!o.inspectLock;
}

// ---------- time helpers (location time zone) ----------
function tzOffsetMs(utcMs, timeZone){
  try{
    const f = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle:'h23', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric'});
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach(x=>{ if(x.type!=='literal') p[x.type]=parseInt(x.value,10); });
    const asUtc = Date.UTC(p.year, p.month-1, p.day, p.hour===24?0:p.hour, p.minute, p.second);
    return asUtc - utcMs;
  }catch(e){
    return (state.location && state.location.utcOffsetSec ? state.location.utcOffsetSec*1000 : 0);
  }
}
function locTz(){ return (state.location && state.location.timezone) || null; }
// wall-clock components in the location's zone for a UTC ms timestamp
function localParts(utcMs){
  const off = tzOffsetMs(utcMs, locTz()||'UTC');
  const d = new Date(utcMs + off);
  return {y:d.getUTCFullYear(), m:d.getUTCMonth(), d:d.getUTCDate(), h:d.getUTCHours(), min:d.getUTCMinutes(), dow:d.getUTCDay(), off};
}
function zonedToUtcMs(y, m, d, h){
  let guess = Date.UTC(y, m, d, h);
  const tz = locTz()||'UTC';
  guess -= tzOffsetMs(guess, tz);
  guess = Date.UTC(y, m, d, h) - tzOffsetMs(guess, tz);
  return guess;
}
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtLocal(utcMs, withDate){
  const p = localParts(utcMs);
  const hh = String(p.h).padStart(2,'0'), mm = String(p.min).padStart(2,'0');
  const abbr = (state.location && state.location.tzAbbr) ? ' '+state.location.tzAbbr : '';
  return withDate ? `${DOW[p.dow]} ${p.d} ${MON[p.m]} ${hh}:${mm}${abbr}` : `${DOW[p.dow]} ${hh}:${mm}${abbr}`;
}
function fmtUtc(utcMs){
  const d = new Date(utcMs);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;
}
function fmtUtcDate(utcMs){
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${fmtUtc(utcMs)}`;
}

// ---------- screens ----------
function showScreen(name){
  ['location','models','profile'].forEach(s=>{
    const el = $('screen-'+s);
    el.classList.toggle('active', s===name);
  });
  document.body.dataset.screen = name;
  if(name==='location' && PICK_MAP){ setTimeout(()=>PICK_MAP.invalidateSize(), 50); }
  if(name==='profile' && state.rows){ setTimeout(()=>redrawAll(), 30); }
  window.scrollTo(0,0);
}

// ---------- location screen ----------
let PICK_MAP = null, GPS_MARKER = null, moveTimer = null, searchTimer = null;
let targetTimeMs = null; // selected valid time (UTC ms)

function initMap(){
  const loc = state.location || {lat: 47.3769, lon: 8.5417};
  PICK_MAP = L.map('pickMap', {zoomControl: true, attributionControl: true}).setView([loc.lat, loc.lon], state.location ? 11 : 8);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom: 17, subdomains:'abc', attribution: 'Map data &copy; OpenStreetMap contributors, SRTM · Style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'});
  const base = lsGet('sc_baselayer', 'topo')==='osm' ? osm : topo;
  base.addTo(PICK_MAP);
  L.control.layers({'OpenTopoMap': topo, 'OpenStreetMap': osm}, null, {position:'topright'}).addTo(PICK_MAP);
  PICK_MAP.on('baselayerchange', e=>lsSet('sc_baselayer', e.name==='OpenStreetMap' ? 'osm' : 'topo'));
  PICK_MAP.on('moveend', ()=>{
    const c = PICK_MAP.getCenter();
    setPickedPoint(c.lat, c.lng, null, {silent: true});
    clearTimeout(moveTimer);
    moveTimer = setTimeout(()=>resolvePoint(c.lat, c.lng), 650);
  });
  const c = PICK_MAP.getCenter();
  if(state.location) updatePlaceCard(); else { setPickedPoint(c.lat, c.lng, null, {silent:true}); resolvePoint(c.lat, c.lng); }
}

function setPickedPoint(lat, lon, name, opts){
  opts = opts || {};
  const prev = state.location || {};
  const moved = !prev.lat || Math.abs(prev.lat-lat)>2e-4 || Math.abs(prev.lon-lon)>2e-4;
  state.location = Object.assign({}, prev, {lat, lon});
  if(name) state.location.name = name;
  else if(moved && !opts.keepName) state.location.name = null;
  if(moved){ state.location.elevation = null; state.location.timezone = prev.timezone; }
  updatePlaceCard();
}

let resolveSeq = 0;
async function resolvePoint(lat, lon){
  const seq = ++resolveSeq;
  $('placeStatus').textContent = 'looking up elevation and place name…';
  try{
    const [info, name] = await Promise.all([
      OpenMeteo.locationInfo(lat, lon).catch(()=>null),
      state.location && state.location.name ? Promise.resolve(state.location.name) : OpenMeteo.reverseGeocode(lat, lon).catch(()=>null),
    ]);
    if(seq !== resolveSeq) return;
    if(info){ Object.assign(state.location, {elevation: info.elevation, timezone: info.timezone, utcOffsetSec: info.utcOffsetSec, tzAbbr: info.tzAbbr}); }
    if(name) state.location.name = name;
    $('placeStatus').textContent = info ? '' : 'elevation lookup failed (offline?)';
  }catch(e){
    if(seq === resolveSeq) $('placeStatus').textContent = 'lookup failed';
  }
  updatePlaceCard();
  renderTimePicker();
  if(document.body.dataset.screen === 'profile' && state.timeline) renderProfile();
  else if(document.body.dataset.screen === 'models') renderModelList();
}

function fmtCoord(lat, lon){
  return `${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'} · ${Math.abs(lon).toFixed(4)}° ${lon>=0?'E':'W'}`;
}
function updatePlaceCard(){
  const l = state.location; if(!l) return;
  $('placeName').textContent = l.name || 'Map centre';
  $('placeCoords').textContent = fmtCoord(l.lat, l.lon) + (l.elevation!=null ? ` · ${Math.round(l.elevation)} m AMSL` : '');
  const fav = favorites().some(f=>Math.abs(f.lat-l.lat)<1e-4 && Math.abs(f.lon-l.lon)<1e-4);
  $('favBtn').textContent = fav ? '★ Saved' : '☆ Save place';
}

function favorites(){ return lsGet(FAV_KEY, []); }
function renderFavorites(){
  const list = favorites();
  const wrap = $('favList');
  wrap.innerHTML = list.map((f,i)=>`<button class="chip" data-fav="${i}" title="${fmtCoord(f.lat,f.lon)}">${escapeHtml(f.name)}</button>`).join('');
  wrap.style.display = list.length ? 'flex' : 'none';
}
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function goToPlace(lat, lon, name, zoom){
  if(name) state.location = Object.assign(state.location||{}, {name});
  setPickedPoint(lat, lon, name, {keepName: !!name});
  PICK_MAP.setView([lat, lon], zoom || 12);
}

// search
async function runSearch(q){
  const box = $('searchResults');
  if(!q || q.length < 2){ box.style.display='none'; return; }
  try{
    const res = await OpenMeteo.geocode(q);
    if(!res.length){ box.innerHTML = '<div class="sr-empty">No places found</div>'; box.style.display='block'; return; }
    box.innerHTML = res.map((r,i)=>`<button class="sr-item" data-i="${i}"><span>${escapeHtml(r.name)}</span><span class="sr-sub">${escapeHtml(r.admin)}${r.elevation!=null?' · '+Math.round(r.elevation)+' m':''}</span></button>`).join('');
    box.style.display='block';
    box.querySelectorAll('.sr-item').forEach(b=>b.addEventListener('click', ()=>{
      const r = res[parseInt(b.dataset.i,10)];
      box.style.display='none';
      $('searchInput').value = r.name;
      state.location = Object.assign(state.location||{}, {timezone: r.timezone});
      goToPlace(r.lat, r.lon, r.admin ? `${r.name}, ${r.admin.split(',')[0]}` : r.name, 12);
    }));
  }catch(e){
    box.innerHTML = '<div class="sr-empty">Search failed (offline?)</div>'; box.style.display='block';
  }
}

function locateMe(){
  if(!navigator.geolocation){ alert('Geolocation is not available in this browser.'); return; }
  const btn = $('gpsBtn'); btn.classList.add('geo-spin');
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.classList.remove('geo-spin');
    const {latitude:lat, longitude:lon} = pos.coords;
    if(GPS_MARKER) GPS_MARKER.setLatLng([lat,lon]); else GPS_MARKER = L.circleMarker([lat,lon], {radius:7, color:'#3fa9ff', weight:2, fillColor:'#3fa9ff', fillOpacity:.4}).addTo(PICK_MAP);
    state.location = Object.assign(state.location||{}, {name: null});
    goToPlace(lat, lon, null, 13);
  }, err=>{
    btn.classList.remove('geo-spin');
    alert('Position not available: '+err.message);
  }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 60000});
}

// ---------- time picker (location screen) ----------
function defaultTargetTime(){
  const now = Date.now();
  return Math.ceil(now/3600e3)*3600e3; // next full hour
}
function renderTimePicker(){
  if(targetTimeMs==null) targetTimeMs = defaultTargetTime();
  const now = Date.now();
  const days = $('dayChips');
  const p = localParts(targetTimeMs);
  const todayP = localParts(now);
  let html = '';
  const maxDays = Math.ceil(TIMELINE_HOURS/24);
  for(let d=0; d<=maxDays; d++){
    const dayMs = zonedToUtcMs(todayP.y, todayP.m, todayP.d + d, 12);
    const dp = localParts(dayMs);
    const sel = dp.y===p.y && dp.m===p.m && dp.d===p.d;
    html += `<button class="chip${sel?' sel':''}" data-day="${d}">${d===0?'Today':DOW[dp.dow]+' '+dp.d}</button>`;
  }
  days.innerHTML = html;
  days.querySelectorAll('button').forEach(b=>b.addEventListener('click', ()=>{
    const d = parseInt(b.dataset.day,10);
    const cur = localParts(targetTimeMs);
    let ms = zonedToUtcMs(todayP.y, todayP.m, todayP.d + d, cur.h);
    if(ms < now) ms = defaultTargetTime();
    targetTimeMs = ms;
    renderTimePicker();
  }));
  const sel = days.querySelector('.sel'); if(sel) sel.scrollIntoView({block:'nearest', inline:'center'});
  $('hourSlider').value = String(p.h);
  $('hourLabel').textContent = `${String(p.h).padStart(2,'0')}:00`;
  const lead = (targetTimeMs-now)/3600e3;
  $('timeSummary').textContent = `${fmtLocal(targetTimeMs, true)} · ${fmtUtcDate(targetTimeMs)} · ${lead<1 ? 'now' : 'now +'+Math.round(lead)+' h'}`;
}
function onHourSlider(){
  const h = parseInt($('hourSlider').value,10);
  const cur = localParts(targetTimeMs);
  let ms = zonedToUtcMs(cur.y, cur.m, cur.d, h);
  if(ms < Date.now()-3600e3) ms = defaultTargetTime();
  targetTimeMs = ms;
  renderTimePicker();
}

// ---------- models screen ----------
function renderModelList(){
  const l = state.location;
  const now = new Date();
  const target = new Date(targetTimeMs);
  const rows = MODEL_CATALOG.map(m=>({m, app: modelApplicability(m, l.lat, l.lon, target, now)}));
  const okCount = rows.filter(r=>r.app.ok).length;
  $('modelSummary').textContent = `${okCount} of ${rows.length} models cover ${l.name || 'this point'} at ${fmtLocal(targetTimeMs, true)}`;
  const def = pickDefaultModel(l.lat, l.lon, target, now);
  // keep previous selection where still applicable, otherwise use the default
  let selected = (state.selectedModels||[]).filter(k=>rows.some(r=>r.m.key===k && r.app.ok));
  if(!selected.length && def) selected = [def.key];
  state.selectedModels = selected;
  const cachedLevels = k => { try{ const c = JSON.parse(localStorage.getItem('sc_vars_v1_'+k)||'null'); return c && c.levels ? c.levels.length : null; }catch(e){ return null; } };
  $('modelList').innerHTML = rows.map(({m, app})=>{
    const checked = selected.includes(m.key);
    const nLev = m.levels ? (cachedLevels(m.key) || LEVEL_SETS[m.levels].length) : 0;
    const until = app.ok ? fmtLocal(estimateModelValidUntil(m, now).getTime(), true) : '';
    const isDef = def && def.key===m.key;
    return `<label class="model-row${app.ok?'':' off'}">
      <input type="checkbox" data-model="${m.key}" ${checked?'checked':''} ${app.ok?'':'disabled'}>
      <span class="mr-body">
        <span class="mr-name">${m.label}${isDef?' <span class="badge">default</span>':''}${checked && state.primaryModel===m.key?' <span class="badge alt">primary</span>':''}</span>
        <span class="mr-meta">${m.provider} · ${m.gridKm} km · ${m.levels ? nLev+' levels' : 'no vertical data'}${m.note && app.ok ? ' · '+m.note : ''}</span>
        <span class="mr-meta">${app.ok ? formatRunLabel(m, now)+' · to '+until : app.reason}</span>
      </span>
    </label>`;
  }).join('');
  $('modelList').querySelectorAll('input[type=checkbox]').forEach(cb=>cb.addEventListener('change', ()=>{
    const key = cb.dataset.model;
    let sel = state.selectedModels.slice();
    if(cb.checked){ if(!sel.includes(key)) sel.push(key); }
    else sel = sel.filter(k=>k!==key);
    if(sel.length > MAX_COMPARE+1){ cb.checked = false; alert(`Up to ${MAX_COMPARE+1} models can be shown at once (one primary + ${MAX_COMPARE} comparisons).`); return; }
    // keep catalog order
    state.selectedModels = MODEL_CATALOG.map(x=>x.key).filter(k=>sel.includes(k));
    $('showProfileBtn').disabled = !state.selectedModels.length;
  }));
  $('showProfileBtn').disabled = !state.selectedModels.length;
}

// ---------- profile: loading and timeline ----------
function setLoading(on, msg){
  const ov = $('loadingOverlay');
  ov.style.display = on ? 'flex' : 'none';
  if(msg!=null) $('loadingMsg').textContent = msg;
}
function modelStale(md){
  const l = state.location;
  return !md || Math.abs(md.lat-l.lat)>1e-4 || Math.abs(md.lon-l.lon)>1e-4 || (Date.now()-md.fetchedAt) > 3*3600e3;
}
async function loadProfile(opts){
  opts = opts || {};
  const l = state.location;
  showScreen('profile');
  setLoading(true, 'Loading model data…');
  $('profileNotice').style.display = 'none';
  const errors = [];
  for(const key of state.selectedModels){
    const meta = MODEL_BY_KEY[key];
    if(!meta) continue;
    if(!opts.force && !modelStale(state.modelData[key])) continue;
    try{
      state.modelData[key] = await OpenMeteo.fetchModel(meta, l.lat, l.lon, msg=>setLoading(true, msg));
    }catch(e){
      console.error(e);
      errors.push(`${meta.label}: ${e.message}`);
      delete state.modelData[key];
    }
  }
  state.selectedModels.forEach(k=>{
    const md = state.modelData[k];
    if(md && md.validRange[0] < 0){ errors.push(`${md.meta.label}: no data at this location`); delete state.modelData[k]; }
  });
  const have = state.selectedModels.filter(k=>state.modelData[k]);
  if(!have.length){
    setLoading(false);
    showNotice('No model data could be loaded. '+(navigator.onLine ? errors.join(' · ') : 'You appear to be offline and no cached profile exists for this location.'), true);
    return;
  }
  if(errors.length) showNotice('Some models failed: '+errors.join(' · '), false);
  // timeline: hour 0 = earliest t0 of the loaded models (today 00 UTC)
  const t0 = Math.min(...have.map(k=>state.modelData[k].t0));
  have.forEach(k=>{ state.modelData[k].offset = Math.round((state.modelData[k].t0 - t0)/3600); });
  state.timeline = {t0, hours: TIMELINE_HOURS + 24};
  if(!state.primaryModel || !have.includes(state.primaryModel)) state.primaryModel = have[0];
  let idx = Math.round((targetTimeMs/1000 - t0)/3600);
  const nowIdx = Math.floor((Date.now()/1000 - t0)/3600);
  const maxIdx = Math.max(...have.map(k=>state.modelData[k].validRange[1]+state.modelData[k].offset));
  const minIdx = Math.min(Math.max(0, nowIdx), maxIdx);
  idx = Math.max(minIdx, Math.min(maxIdx, idx));
  state.timeIdx = idx;
  const sl = $('timeSlider'); sl.min = String(minIdx); sl.max = String(maxIdx); sl.value = String(idx);
  // Phones: start with the lower ~45 % of the column (roughly the troposphere
  // below 10 km) so the boundary layer is readable; the zoom sliders, pinch
  // or ⟲ restore the full column.
  if(!state.zoomTouched && window.innerWidth < 640 && state.viewMaxPct === 1000){
    state.viewMaxPct = 450; $('altRangeMax').value = '450';
  }
  setLoading(false);
  saveSession();
  renderProfile();
}
function showNotice(text, isError){
  const n = $('profileNotice');
  n.textContent = text; n.style.display = 'block';
  n.classList.toggle('error', !!isError);
}

// ---------- profile rendering ----------
function currentTimeMs(){ return (state.timeline.t0 + state.timeIdx*3600)*1000; }
function modelsWithData(){ return state.selectedModels.filter(k=>state.modelData[k] && OpenMeteo.hasDataAt(state.modelData[k], state.timeIdx)); }

function renderProfile(){
  if(!state.timeline) return;
  const avail = modelsWithData();
  const notice = $('profileNotice');
  if(!avail.length){
    state.rows = null;
    showNotice('No selected model covers this hour. Move the slider back or add a longer-range model.', false);
    $('dataView').style.visibility = 'hidden';
    updateTimeLabels();
    renderReadout(null);
    return;
  }
  $('dataView').style.visibility = 'visible';
  let primary = state.primaryModel;
  if(!avail.includes(primary)){
    primary = avail[0];
    showNotice(`${MODEL_BY_KEY[state.primaryModel].label} has no data for this hour — showing ${MODEL_BY_KEY[primary].label} instead.`, false);
  } else if(notice.style.display==='block' && !notice.classList.contains('error') && notice.dataset.sticky!=='1'){
    notice.style.display = 'none';
  }
  const md = state.modelData[primary];
  const rows = OpenMeteo.buildRows(md, state.timeIdx);
  if(!rows){ showNotice('Model profile incomplete for this hour.', false); return; }
  state.rows = rows;
  state.compareFlights = avail.filter(k=>k!==primary).slice(0, MAX_COMPARE).map(k=>{
    const r = OpenMeteo.buildRows(state.modelData[k], state.timeIdx);
    return r ? {rows: r, source: MODEL_BY_KEY[k].label, key: k} : null;
  }).filter(Boolean);
  renderProfileFacts(md, primary);
  renderThermo(rows);
  renderLegend();
  updateVerticalVelocityLabel(md);
  redrawAll();
  updateTimeLabels();
  renderReadout(md);
  renderModelChips(avail, primary);
  updateTaEditLink();
  if(state.altitudeUnit === 'fl' && !state.transitionAltConfirmed) openTaModal('fl');
}
function redrawAll(){
  if(!state.rows) return;
  const hasWind = activeWindRows(state.rows).length >= 2;
  const hasW = state.rows.filter(r=>r[10]!=null).length >= 5;
  $('hodoCard').style.display = hasWind ? 'block' : 'none';
  $('riseCard').style.display = hasW ? 'block' : 'none';
  $('thetaECard').style.display = state.rows.length >= 5 ? 'block' : 'none';
  draw(state.rows);
  drawHodograph(getZoomedRows());
  drawMiniProfile('riseCanvas','riseCard', getZoomedRows(), r=>r[10], '#e0a83f', 2);
  drawMiniProfile('thetaECanvas','thetaECard', getZoomedRows(), r=>thetaE(r[3], r[5], r[2]), '#c76bd1', 0);
}
function updateVerticalVelocityLabel(md){
  const unit = (md.units && (md.units['vertical_velocity_500hPa'] || md.units['vertical_velocity_700hPa'])) || '';
  $('riseTitle').textContent = `Vertical velocity (model${unit?', '+unit:''})`;
}

function renderProfileFacts(md, key){
  const m = md.meta, l = state.location;
  const run = estimateModelRun(m);
  const top = state.rows[state.rows.length-1];
  const lvlCount = state.rows.filter(r=>r[12]!=='agl').length;
  const age = Math.round((Date.now()-md.fetchedAt)/60000);
  const cached = (md.t0*1000) < Date.now()-36*3600e3;
  const items = [
    ['Model', `${m.label} · ${m.provider}`],
    ['Run (estimated)', `${String(run.getUTCHours()).padStart(2,'0')}Z ${run.getUTCDate()} ${MON[run.getUTCMonth()]} · ${m.cycleH}-hourly`],
    ['Grid spacing', `${m.gridKm} km`],
    ['Profile levels', `${lvlCount} · top ${Math.round(top[2])} hPa`],
    ['Model ground', `${md.elevation!=null ? Math.round(md.elevation)+' m' : 'n/a'}${l.elevation!=null ? ' · site '+Math.round(l.elevation)+' m' : ''}`],
    ['Valid time', `${fmtLocal(currentTimeMs(), true)} · ${fmtUtc(currentTimeMs())}`],
    ['Data fetched', age<1 ? 'just now' : (age<90 ? age+' min ago' : Math.round(age/60)+' h ago')+(cached?' · cached':'')],
    ['Comparison models', state.compareFlights.length ? state.compareFlights.map(c=>c.source).join(', ') : 'none'],
  ];
  $('statStrip').innerHTML = items.map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('subtitle').textContent = `${l.name || fmtCoord(l.lat,l.lon)} · ${fmtLocal(currentTimeMs(), true)} · ${m.label} · ${APP_VERSION}`;
  $('profileTitle').textContent = `${l.name || 'Profile'} · ${fmtLocal(currentTimeMs(), false)}`;
}

function renderModelChips(avail, primary){
  const wrap = $('modelChips');
  wrap.innerHTML = state.selectedModels.map(k=>{
    const m = MODEL_BY_KEY[k];
    const has = avail.includes(k);
    const ci = state.compareFlights.findIndex(c=>c.key===k);
    const color = k===primary ? 'var(--amber)' : (ci>=0 ? COMPARE_COLORS[ci].temp : 'var(--text-dim)');
    return `<button class="chip model-chip${k===primary?' primary':''}${has?'':' nodata'}" data-model="${k}" style="border-color:${color};${k===primary?'':'color:'+color}" title="${has?'tap to make primary':'no data at this hour'}">${m.label}</button>`;
  }).join('') + `<button class="chip" id="chipAdd" title="Change models">＋</button>`;
  wrap.querySelectorAll('.model-chip').forEach(b=>b.addEventListener('click', ()=>{
    const k = b.dataset.model;
    if(!modelsWithData().includes(k)) return;
    state.primaryModel = k; saveSession(); renderProfile();
  }));
  $('chipAdd').addEventListener('click', ()=>{ renderModelList(); showScreen('models'); });
}

function updateTimeLabels(){
  const ms = currentTimeMs();
  $('timeLabel').textContent = fmtLocal(ms, true);
  $('timeLabelUtc').textContent = fmtUtcDate(ms);
  $('timeSlider').value = String(state.timeIdx);
  const t0 = state.timeline.t0;
  const lead = (ms - Date.now())/3600e3;
  $('timeLead').textContent = lead<0.5 ? 'now' : `+${Math.round(lead)} h`;
  // tick marks: midnight (local) positions along the slider
  const sl = $('timeSlider'), min = parseInt(sl.min,10), max = parseInt(sl.max,10);
  const ticks = $('timeTicks'); let html = '';
  const midnights = [];
  for(let i=min;i<=max;i++){ const p = localParts((t0+i*3600)*1000); if(p.h===0) midnights.push({i, dow:p.dow}); }
  const every = midnights.length > 12 ? 3 : (midnights.length > 7 ? 2 : 1);
  midnights.forEach((m,k)=>{
    const x = (m.i-min)/(max-min||1)*100;
    html += `<span style="left:${x.toFixed(2)}%"><i></i>${k%every===0 ? DOW[m.dow] : ''}</span>`;
  });
  ticks.innerHTML = html;
}

function renderReadout(md){
  const el = $('scrubberReadout');
  if(!md){ el.innerHTML=''; return; }
  const s = OpenMeteo.surfaceAt(md, state.timeIdx) || {};
  const f1 = (v,d)=> v==null ? '—' : (Math.round(v*Math.pow(10,d||0))/Math.pow(10,d||0)).toFixed(d||0);
  const spd = v => v==null ? '—' : formatSpeed(v).toFixed(0)+' '+speedUnitLabel();
  const items = [
    ['2 m temp / dew point', `${f1(s.temperature_2m,1)} / ${f1(s.dew_point_2m,1)} °C`],
    ['10 m wind', s.wind_speed_10m!=null ? `${spd(s.wind_speed_10m)} / ${f1(s.wind_direction_10m)}°${s.wind_gusts_10m!=null?' · gusts '+spd(s.wind_gusts_10m):''}` : '—'],
    ['Cloud cover (model)', s.cloud_cover!=null ? `${f1(s.cloud_cover)} %${s.cloud_cover_low!=null?' · L/M/H '+f1(s.cloud_cover_low)+'/'+f1(s.cloud_cover_mid)+'/'+f1(s.cloud_cover_high):''}` : '—'],
    ['Precipitation', s.precipitation!=null ? `${f1(s.precipitation,1)} mm/h` : '—'],
    ['Surface / MSL pressure', `${f1(s.surface_pressure)} / ${f1(s.pressure_msl)} hPa`],
    ['CAPE / CIN (model)', s.cape!=null ? `${f1(s.cape)}${s.convective_inhibition!=null?' / '+f1(s.convective_inhibition):''} J/kg` : '—'],
    ['Lifted index (model)', s.lifted_index!=null ? `${s.lifted_index>0?'+':''}${f1(s.lifted_index,1)} °C` : '—'],
    ['Freezing level (model)', s.freezing_level_height!=null ? formatAltitude(s.freezing_level_height, state.rows ? state.rows[0][1] : 0) : '—'],
    ['Boundary layer (model)', s.boundary_layer_height!=null ? `${f1(s.boundary_layer_height)} m AGL` : '—'],
  ];
  el.innerHTML = items.map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
}

// ---------- time slider + playback ----------
let playTimer = null, renderPending = false;
function setTimeIdx(idx){
  const sl = $('timeSlider');
  idx = Math.max(parseInt(sl.min,10), Math.min(parseInt(sl.max,10), idx));
  if(idx === state.timeIdx) return;
  state.timeIdx = idx;
  if(!renderPending){
    renderPending = true;
    requestAnimationFrame(()=>{ renderPending = false; renderProfile(); });
  }
}
function togglePlay(){
  if(playTimer){ clearInterval(playTimer); playTimer = null; $('playBtn').textContent = '▶'; return; }
  $('playBtn').textContent = '❚❚';
  playTimer = setInterval(()=>{
    const sl = $('timeSlider');
    if(state.timeIdx >= parseInt(sl.max,10)){ togglePlay(); return; }
    setTimeIdx(state.timeIdx+1);
  }, Math.round(1000/playSpeed));
}

// ---------- altitude zoom sliders (S2) ----------
function handleAltRangeInput(){
  state.zoomTouched = true;
  let lo = parseFloat($('altRangeMin').value), hi = parseFloat($('altRangeMax').value);
  if(hi - lo < 40){
    if(document.activeElement === $('altRangeMin')) lo = hi - 40; else hi = lo + 40;
    $('altRangeMin').value = String(lo); $('altRangeMax').value = String(hi);
  }
  state.viewMinPct = Math.max(0, lo); state.viewMaxPct = Math.min(1000, hi);
  updateAltRangeFill();
  redrawAll();
}
function updateAltRangeFill(){
  const track = $('altRangeTrack'), fill = $('altRangeFill');
  if(!track || !fill) return;
  const h = track.clientHeight; if(!h) return;
  const lo = state.viewMinPct||0, hi = state.viewMaxPct!=null ? state.viewMaxPct : 1000;
  fill.style.bottom = (h*(lo/1000))+'px';
  fill.style.top = (h*(1-hi/1000))+'px';
}
function resetAltRange(){
  state.zoomTouched = true;
  state.viewMinPct = 0; state.viewMaxPct = 1000;
  $('altRangeMin').value = '0'; $('altRangeMax').value = '1000';
  updateAltRangeFill(); redrawAll();
}

// ---------- touch interaction on the main chart ----------
function setupChartTouch(){
  const wrap = $('chartWrap');
  const c = canvas;
  let pointers = new Map();
  let pressTimer = null, inspecting = false, startPt = null, pinch = null;
  function pos(e){ const r = c.getBoundingClientRect(); return {x: e.clientX-r.left, y: e.clientY-r.top}; }
  function endInspect(){ inspecting = false; window.SC_TOUCH_ACTIVE = false; }
  c.addEventListener('pointerdown', e=>{
    if(e.pointerType==='mouse') return;
    pointers.set(e.pointerId, pos(e));
    if(pointers.size===2){
      clearTimeout(pressTimer); endInspect(); chartInspectEnd();
      const [a,b] = Array.from(pointers.values());
      pinch = {y1:a.y, y2:b.y, lo: state.viewMinPct||0, hi: state.viewMaxPct!=null?state.viewMaxPct:1000};
      return;
    }
    startPt = pos(e);
    chartInspectEnd();
    if(state.inspectLock){ inspecting = true; window.SC_TOUCH_ACTIVE = true; chartInspectAt(startPt.x, startPt.y); return; }
    pressTimer = setTimeout(()=>{ inspecting = true; window.SC_TOUCH_ACTIVE = true; chartInspectAt(startPt.x, startPt.y); if(navigator.vibrate) navigator.vibrate(8); }, 320);
  });
  c.addEventListener('pointermove', e=>{
    if(e.pointerType==='mouse') return;
    if(!pointers.has(e.pointerId)) return;
    const p = pos(e); pointers.set(e.pointerId, p);
    if(pinch && pointers.size===2){
      if(!PLOT) return;
      const [a,b] = Array.from(pointers.values());
      const {pad, plotH} = PLOT;
      const f = y => 1 - (y-pad.top)/plotH;
      const P1 = pinch.lo + f(pinch.y1)*(pinch.hi-pinch.lo), P2 = pinch.lo + f(pinch.y2)*(pinch.hi-pinch.lo);
      const f1 = f(a.y), f2 = f(b.y);
      if(Math.abs(f1-f2) < 0.02) return;
      let range = (P1-P2)/(f1-f2);
      range = Math.max(40, Math.min(1000, Math.abs(range)));
      let lo = Math.min(P1,P2) - Math.min(f1,f2)*range;
      lo = Math.max(0, Math.min(1000-range, lo));
      state.zoomTouched = true;
      state.viewMinPct = lo; state.viewMaxPct = lo+range;
      $('altRangeMin').value = String(Math.round(lo)); $('altRangeMax').value = String(Math.round(lo+range));
      updateAltRangeFill(); redrawAll();
      return;
    }
    if(inspecting){ chartInspectAt(p.x, p.y); return; }
    if(startPt && Math.hypot(p.x-startPt.x, p.y-startPt.y) > 10){ clearTimeout(pressTimer); }
  });
  function up(e){
    if(e.pointerType==='mouse') return;
    pointers.delete(e.pointerId);
    clearTimeout(pressTimer);
    if(pointers.size < 2) pinch = null;
    if(inspecting){ endInspect(); /* keep the last readout visible until the next touch */ }
  }
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  // block page scrolling while a touch inspect or pinch is in progress
  c.addEventListener('touchmove', e=>{ if(inspecting || pinch) e.preventDefault(); }, {passive:false});
  c.addEventListener('touchstart', e=>{ if(state.inspectLock || e.touches.length===2) e.preventDefault(); }, {passive:false});
  // secondary panels: touch = hover
  ['hodoCanvas','riseCanvas','thetaECanvas'].forEach(id=>{
    const el = $(id);
    el.addEventListener('pointerdown', e=>{ if(e.pointerType!=='mouse'){ el.dispatchEvent(new MouseEvent('mousemove', {clientX:e.clientX, clientY:e.clientY, bubbles:true})); } });
    el.addEventListener('pointermove', e=>{ if(e.pointerType!=='mouse' && e.buttons){ el.dispatchEvent(new MouseEvent('mousemove', {clientX:e.clientX, clientY:e.clientY, bubbles:true})); } });
  });
  applyInspectLock();
}
function applyInspectLock(){
  const on = !!state.inspectLock;
  $('inspectLockBtn').classList.toggle('on', on);
  canvas.style.touchAction = on ? 'none' : 'pan-y';
}

// ---------- wind-speed panel resize handle (pointer events, touch-friendly) ----------
function setupWindHandle(){
  const handle = $('windPanelHandle');
  let dragging = false, startX = 0, startWidth = 72;
  handle.addEventListener('pointerdown', e=>{
    dragging = true; startX = e.clientX;
    startWidth = state.speedPanelWidth || (PLOT ? PLOT.speedW : 72);
    handle.setPointerCapture(e.pointerId);
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e=>{
    if(!dragging) return;
    // dragging left (toward the main plot) widens the wind-speed panel
    const delta = startX - e.clientX;
    const maxW = PLOT ? Math.max(60, PLOT.cssWidth - PLOT.pad.left - 120) : 340;
    state.speedPanelWidth = Math.max(36, Math.min(maxW, startWidth + delta));
    draw(state.rows);
  });
  const end = ()=>{ if(dragging){ dragging = false; document.body.style.userSelect = ''; saveSettings(); } };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', ()=>{ state.speedPanelWidth = null; saveSettings(); draw(state.rows); });
}

// ---------- settings sheet ----------
function openSettings(on){
  $('settingsSheet').classList.toggle('open', on);
  $('settingsBackdrop').style.display = on ? 'block' : 'none';
  if(on) syncSettingsControls();
}
function syncSettingsControls(){
  $('diagramTypeSelect').value = state.diagramType;
  $('altitudeUnitSelect').value = state.altitudeUnit;
  $('speedUnitSelect').value = state.speedUnit;
  $('windDisplayModeSelect').value = state.windDisplayMode;
  $('thetaEToggleBtn').textContent = state.showThetaE ? 'On' : 'Off';
  $('levelDotsBtn').textContent = state.showLevelDots===false ? 'Off' : 'On';
  $('cloudThreshInput').value = String(state.cloudThreshold);
  $('playSpeedSelect').value = String(playSpeed);
  $('apiKeyInput').value = state.apiKey || '';
  $('callsToday').textContent = `Open-Meteo requests today: ${OpenMeteo.callsToday()}`;
  $('themeBtn').textContent = document.documentElement.dataset.theme==='light' ? '🌗 Switch to dark' : '🌗 Switch to light';
  updateTaEditLink();
}
function bindSettings(){
  $('settingsBtn').addEventListener('click', ()=>openSettings(true));
  $('settingsClose').addEventListener('click', ()=>openSettings(false));
  $('settingsBackdrop').addEventListener('click', ()=>openSettings(false));
  $('diagramTypeSelect').addEventListener('change', e=>{ state.diagramType = e.target.value; saveSettings(); renderProfile(); });
  $('altitudeUnitSelect').addEventListener('change', e=>{
    const v = e.target.value;
    if(v==='fl' && !state.transitionAltConfirmed){ openTaModal('fl'); return; }
    state.altitudeUnit = v; saveSettings(); updateTaEditLink(); renderProfile();
  });
  $('speedUnitSelect').addEventListener('change', e=>{ state.speedUnit = e.target.value; saveSettings(); renderProfile(); });
  $('windDisplayModeSelect').addEventListener('change', e=>{ state.windDisplayMode = e.target.value; saveSettings(); draw(state.rows); });
  $('thetaEToggleBtn').addEventListener('click', ()=>{ state.showThetaE = !state.showThetaE; syncSettingsControls(); saveSettings(); draw(state.rows); });
  $('levelDotsBtn').addEventListener('click', ()=>{ state.showLevelDots = state.showLevelDots===false; syncSettingsControls(); saveSettings(); draw(state.rows); });
  $('cloudThreshInput').addEventListener('input', e=>{ const v = parseFloat(e.target.value); if(isFinite(v) && v>=0 && v<=100){ state.cloudThreshold = v; saveSettings(); draw(state.rows); renderLegend(); } });
  $('playSpeedSelect').addEventListener('change', e=>{ playSpeed = parseFloat(e.target.value)||1; saveSettings(); if(playTimer){ togglePlay(); togglePlay(); } });
  $('apiKeyInput').addEventListener('change', e=>{ state.apiKey = e.target.value.trim() || null; saveSettings(); });
  $('themeBtn').addEventListener('click', ()=>{
    document.documentElement.dataset.theme = document.documentElement.dataset.theme==='light' ? '' : 'light';
    saveSettings(); syncSettingsControls(); redrawAll();
  });
  $('resetConfigBtn').addEventListener('click', ()=>{
    Object.assign(state, {diagramType:'stuve', altitudeUnit:'amsl', speedUnit:'kmh', windDisplayMode:'barb', showThetaE:false,
      cloudThreshold:85, showLevelDots:true, transitionAltFt:null, transitionAltConfirmed:false, speedPanelWidth:null});
    playSpeed = 1; saveSettings(); syncSettingsControls(); renderProfile();
  });
  $('refreshBtn').addEventListener('click', ()=>{ openSettings(false); loadProfile({force:true}); });
  $('aboutBtn').addEventListener('click', ()=>{ openSettings(false); $('aboutOverlay').style.display='flex'; });
  $('aboutClose').addEventListener('click', ()=>{ $('aboutOverlay').style.display='none'; });
  $('aboutOverlay').addEventListener('click', e=>{ if(e.target.id==='aboutOverlay') $('aboutOverlay').style.display='none'; });
  $('inspectLockBtn').addEventListener('click', ()=>{ state.inspectLock = !state.inspectLock; applyInspectLock(); saveSettings(); });
}

// ---------- transition altitude modal (S2) ----------
function updateTaEditLink(){
  const link = $('taEditLink');
  if(state.altitudeUnit === 'fl' && state.transitionAltFt){ link.style.display = 'inline'; $('taEditLinkValue').textContent = state.transitionAltFt; }
  else link.style.display = 'none';
}
function openTaModal(pendingUnit){
  const groundAltM = state.rows && state.rows[0] ? state.rows[0][1] : (state.location ? state.location.elevation : null);
  $('taInput').value = state.transitionAltFt || estimateTransitionAltFt(groundAltM);
  $('taModalOverlay').dataset.pendingUnit = pendingUnit || 'fl';
  $('taModalOverlay').style.display = 'flex';
}
function bindTaModal(){
  $('taEditLink').addEventListener('click', ()=>openTaModal('fl'));
  $('taConfirmBtn').addEventListener('click', ()=>{
    const v = parseInt($('taInput').value, 10);
    state.transitionAltFt = isFinite(v) && v>=0 ? v : 5000;
    state.transitionAltConfirmed = true;
    state.altitudeUnit = $('taModalOverlay').dataset.pendingUnit || 'fl';
    $('altitudeUnitSelect').value = state.altitudeUnit;
    $('taModalOverlay').style.display = 'none';
    saveSettings(); updateTaEditLink(); renderProfile();
  });
  $('taCancelBtn').addEventListener('click', ()=>{
    state.altitudeUnit = 'amsl'; $('altitudeUnitSelect').value = 'amsl';
    $('taModalOverlay').style.display = 'none';
    saveSettings(); updateTaEditLink(); renderProfile();
  });
}

// ---------- export, share, print ----------
function exportChartPng(){
  if(!state.rows) return;
  const dpr = window.devicePixelRatio || 1;
  const headerH = 34;
  const out = document.createElement('canvas');
  out.width = canvas.width; out.height = canvas.height + headerH*dpr;
  const octx = out.getContext('2d');
  const light = document.documentElement.dataset.theme==='light';
  octx.fillStyle = light ? '#ffffff' : '#0e1420';
  octx.fillRect(0,0,out.width,out.height);
  octx.setTransform(dpr,0,0,dpr,0,0);
  octx.fillStyle = light ? '#2a323e' : '#cfd8e3';
  octx.font = 'bold 13px IBM Plex Mono, monospace'; octx.textBaseline='top';
  octx.fillText('StueveCast · '+$('subtitle').textContent, 10, 8);
  octx.setTransform(1,0,0,1,0,0);
  octx.drawImage(canvas, 0, headerH*dpr);
  const name = `stuevecast_${(state.location.name||'profile').replace(/[^a-z0-9]+/gi,'_')}_${fmtUtcDate(currentTimeMs()).replace(/[^0-9]+/g,'-')}.png`;
  out.toBlob(async blob=>{
    const file = new File([blob], name, {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], title:'StueveCast profile'}); return; }catch(e){ if(e.name==='AbortError') return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 5000);
  }, 'image/png');
}
function buildShareUrl(){
  const l = state.location;
  const params = new URLSearchParams();
  params.set('loc', `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`);
  if(l.name) params.set('name', l.name);
  params.set('t', new Date(currentTimeMs()).toISOString().slice(0,13)+'Z');
  params.set('models', state.selectedModels.join(','));
  if(state.primaryModel) params.set('p', state.primaryModel);
  return location.origin + location.pathname + '#' + params.toString();
}
async function shareProfile(){
  if(!state.timeline) return;
  const url = buildShareUrl();
  const text = `StueveCast — ${state.location.name || fmtCoord(state.location.lat, state.location.lon)}, ${fmtLocal(currentTimeMs(), true)}`;
  if(navigator.share){
    try{ await navigator.share({title:'StueveCast profile', text, url}); return; }catch(e){ if(e.name==='AbortError') return; }
  }
  $('shareUrl').value = url;
  $('shareQr').innerHTML = '';
  try{ new QRCode($('shareQr'), {text: url, width: 128, height: 128}); }catch(e){}
  $('shareOverlay').style.display = 'flex';
}
function parseHash(){
  if(!location.hash || location.hash.length < 2) return null;
  try{
    const p = new URLSearchParams(location.hash.slice(1));
    const loc = (p.get('loc')||'').split(',').map(Number);
    if(loc.length!==2 || !isFinite(loc[0]) || !isFinite(loc[1])) return null;
    return {lat: loc[0], lon: loc[1], name: p.get('name')||null, t: p.get('t') ? Date.parse(p.get('t').replace('Z',':00:00Z')) : null,
            models: (p.get('models')||'').split(',').filter(k=>MODEL_BY_KEY[k]), primary: p.get('p')||null};
  }catch(e){ return null; }
}
let _preprintTheme = null;
function bindPrint(){
  $('printBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='flex'; });
  $('printCancelBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; });
  $('printWithPanelsBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; proceedToPrint(true); });
  $('printWithoutPanelsBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; proceedToPrint(false); });
  window.addEventListener('beforeprint', ()=>{
    _preprintTheme = document.documentElement.dataset.theme || '';
    document.documentElement.dataset.theme = 'light';
    printMode = true;
    if(state.rows) redrawAll();
  });
  window.addEventListener('afterprint', ()=>{
    document.documentElement.classList.remove('print-no-panels');
    document.documentElement.dataset.theme = _preprintTheme || '';
    printMode = false;
    if(state.rows) redrawAll();
  });
}
function proceedToPrint(withPanels){
  state.printWithPanels = withPanels;
  document.documentElement.classList.toggle('print-no-panels', !withPanels);
  $('printLink').textContent = buildShareUrl();
  window.print();
}

// ---------- session ----------
function saveSession(){
  lsSet(SESSION_KEY, {location: state.location, targetTimeMs, selectedModels: state.selectedModels, primaryModel: state.primaryModel});
}
function restoreSession(){
  const s = lsGet(SESSION_KEY, null);
  if(!s || !s.location) return false;
  state.location = s.location; targetTimeMs = s.targetTimeMs;
  state.selectedModels = (s.selectedModels||[]).filter(k=>MODEL_BY_KEY[k]);
  state.primaryModel = s.primaryModel;
  if(!targetTimeMs || targetTimeMs < Date.now()-3600e3) targetTimeMs = defaultTargetTime();
  return true;
}

// ---------- keyboard ----------
function bindKeyboard(){
  document.addEventListener('keydown', e=>{
    if(e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    if(document.body.dataset.screen !== 'profile' || !state.timeline) return;
    const k = e.key;
    if(k==='ArrowRight'){ setTimeIdx(state.timeIdx+1); e.preventDefault(); }
    else if(k==='ArrowLeft'){ setTimeIdx(state.timeIdx-1); e.preventDefault(); }
    else if(k===' '){ togglePlay(); e.preventDefault(); }
    else if(k==='p' || k==='P'){ $('printBtn').click(); }
    else if(k==='t' || k==='T'){ $('themeBtn').click(); }
    else if(k==='l' || k==='L'){ shareProfile(); }
    else if(k==='e' || k==='E'){ exportChartPng(); }
  });
}

// ---------- service worker ----------
function registerSw(){
  if(!('serviceWorker' in navigator)) return;
  if(location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  navigator.serviceWorker.register('sw.js').catch(err=>console.warn('SW registration failed', err));
}

// ---------- init ----------
(function init(){
  loadSettings();
  $('versionStamp').textContent = APP_VERSION;
  const hash = parseHash();
  const restored = restoreSession();
  if(hash){
    state.location = Object.assign(state.location && Math.abs(state.location.lat-hash.lat)<1e-4 && Math.abs(state.location.lon-hash.lon)<1e-4 ? state.location : {}, {lat: hash.lat, lon: hash.lon, name: hash.name || (state.location||{}).name || null});
    if(hash.models.length) state.selectedModels = hash.models;
    if(hash.primary) state.primaryModel = hash.primary;
    targetTimeMs = hash.t && hash.t > Date.now()-3600e3 ? hash.t : defaultTargetTime();
  }
  if(!targetTimeMs) targetTimeMs = defaultTargetTime();

  initMap();
  renderFavorites();
  renderTimePicker();
  bindSettings(); bindTaModal(); bindPrint(); bindKeyboard();
  setupChartTouch(); setupWindHandle();

  // location screen controls
  $('searchInput').addEventListener('input', e=>{ clearTimeout(searchTimer); const q = e.target.value.trim(); searchTimer = setTimeout(()=>runSearch(q), 350); });
  $('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ clearTimeout(searchTimer); runSearch(e.target.value.trim()); } if(e.key==='Escape'){ $('searchResults').style.display='none'; } });
  document.addEventListener('click', e=>{ if(!e.target.closest('#searchWrap')) $('searchResults').style.display='none'; });
  $('gpsBtn').addEventListener('click', locateMe);
  $('favBtn').addEventListener('click', ()=>{
    const l = state.location; if(!l) return;
    let list = favorites();
    const i = list.findIndex(f=>Math.abs(f.lat-l.lat)<1e-4 && Math.abs(f.lon-l.lon)<1e-4);
    if(i>=0) list.splice(i,1);
    else {
      const name = prompt('Name for this place', l.name || fmtCoord(l.lat,l.lon));
      if(name==null) return;
      list.push({name: name.trim() || fmtCoord(l.lat,l.lon), lat: l.lat, lon: l.lon});
    }
    lsSet(FAV_KEY, list); renderFavorites(); updatePlaceCard();
  });
  $('favList').addEventListener('click', e=>{
    const b = e.target.closest('[data-fav]'); if(!b) return;
    const f = favorites()[parseInt(b.dataset.fav,10)]; if(!f) return;
    goToPlace(f.lat, f.lon, f.name, 12);
  });
  $('hourSlider').addEventListener('input', onHourSlider);
  $('chooseModelsBtn').addEventListener('click', ()=>{
    if(!state.location){ alert('Pick a location first.'); return; }
    if(!state.location.timezone){ resolvePoint(state.location.lat, state.location.lon); }
    saveSession(); renderModelList(); showScreen('models');
  });
  $('lastProfileBtn').addEventListener('click', ()=>{ if(state.selectedModels.length) loadProfile(); else { renderModelList(); showScreen('models'); } });
  $('lastProfileBtn').style.display = restored && state.selectedModels.length ? 'inline-flex' : 'none';

  // models screen
  $('modelsBackBtn').addEventListener('click', ()=>showScreen('location'));
  $('showProfileBtn').addEventListener('click', ()=>{ saveSession(); loadProfile(); });

  // profile screen
  $('profileBackBtn').addEventListener('click', ()=>{ if(playTimer) togglePlay(); showScreen('location'); renderTimePicker(); });
  $('timeSlider').addEventListener('input', e=>setTimeIdx(parseInt(e.target.value,10)));
  $('stepBack').addEventListener('click', ()=>setTimeIdx(state.timeIdx-1));
  $('stepFwd').addEventListener('click', ()=>setTimeIdx(state.timeIdx+1));
  $('playBtn').addEventListener('click', togglePlay);
  $('altRangeMin').addEventListener('input', handleAltRangeInput);
  $('altRangeMax').addEventListener('input', handleAltRangeInput);
  $('altRangeReset').addEventListener('click', resetAltRange);
  $('exportPngBtn').addEventListener('click', exportChartPng);
  $('shareBtn').addEventListener('click', shareProfile);
  $('shareClose').addEventListener('click', ()=>{ $('shareOverlay').style.display='none'; });
  $('shareOverlay').addEventListener('click', e=>{ if(e.target.id==='shareOverlay') $('shareOverlay').style.display='none'; });
  $('copyBtn').addEventListener('click', async ()=>{ try{ await navigator.clipboard.writeText($('shareUrl').value); $('copyBtn').textContent='Copied'; setTimeout(()=>$('copyBtn').textContent='Copy',1500); }catch(e){ $('shareUrl').select(); } });
  document.querySelectorAll('.panel-export-btn').forEach(b=>b.addEventListener('click', ()=>{
    const c = $(b.dataset.canvas); if(!c) return;
    c.toBlob(blob=>{ const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=`stuevecast_${b.dataset.suffix}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000); }, 'image/png');
  }));
  $('thermoStrip').addEventListener('click', e=>{ const t = e.target.closest('[data-info-key]'); if(t) openInfoModal(t.dataset.infoKey); });
  $('commentsInfoBtn').addEventListener('click', ()=>openInfoModal('analyticalComments'));
  window.addEventListener('resize', ()=>{ if(document.body.dataset.screen==='profile' && state.rows) redrawAll(); if(PICK_MAP) PICK_MAP.invalidateSize(); });
  window.addEventListener('online', ()=>{ if(document.body.dataset.screen==='profile') showNotice('Back online.', false); });

  registerSw();

  if(hash && state.selectedModels.length){
    resolvePoint(state.location.lat, state.location.lon);
    loadProfile();
  } else {
    showScreen('location');
  }
})();
