// ---- StueveCast application (single-screen cockpit) ----
// Loaded last; relies on the globals from core.js, info.js, analytics.js,
// draw.js, models.js and openmeteo.js (classic scripts sharing one scope).

const APP_VERSION = 'v0.11.5 (2026-08-25)';
const MAX_TOTAL = 3; // models drawn at once (primary + comparisons)
const SESSION_KEY = 'sc_session_v2';
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
  o.sideOpen = state.sideOpen !== false;
  o.timeDisplay = state.timeDisplay || 'lt';
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
  state.sideOpen = o.sideOpen !== false;
  state.timeDisplay = o.timeDisplay === 'utc' ? 'utc' : 'lt';
}

// ---------- time helpers (location time zone) ----------
function activeLoc(){ return state.loaded || state.location || null; }
function tzOffsetMs(utcMs, timeZone){
  try{
    const f = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle:'h23', year:'numeric', month:'numeric', day:'numeric', hour:'numeric', minute:'numeric', second:'numeric'});
    const p = {};
    f.formatToParts(new Date(utcMs)).forEach(x=>{ if(x.type!=='literal') p[x.type]=parseInt(x.value,10); });
    const asUtc = Date.UTC(p.year, p.month-1, p.day, p.hour===24?0:p.hour, p.minute, p.second);
    return asUtc - utcMs;
  }catch(e){
    const l = activeLoc();
    return (l && l.utcOffsetSec ? l.utcOffsetSec*1000 : 0);
  }
}
function locTz(){ const l = activeLoc(); return (l && l.timezone) || null; }
// zone used for every displayed time: the location's zone (LT) or UTC
function dispTz(){ return state.timeDisplay === 'utc' ? 'UTC' : (locTz() || 'UTC'); }
function localParts(utcMs){
  const off = tzOffsetMs(utcMs, dispTz());
  const d = new Date(utcMs + off);
  return {y:d.getUTCFullYear(), m:d.getUTCMonth(), d:d.getUTCDate(), h:d.getUTCHours(), min:d.getUTCMinutes(), dow:d.getUTCDay(), off};
}
function zonedToUtcMs(y, m, d, h, min){
  const tz = dispTz();
  let guess = Date.UTC(y, m, d, h, min||0);
  guess -= tzOffsetMs(guess, tz);
  guess = Date.UTC(y, m, d, h, min||0) - tzOffsetMs(guess, tz);
  return guess;
}
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function tzAbbr(){ if(state.timeDisplay === 'utc') return ' UTC'; const l = activeLoc(); return l && l.tzAbbr ? ' '+l.tzAbbr : (l && l.timezone ? '' : ' UTC'); }
// the other zone, shown as a small secondary line under the main time label
function fmtAlt(utcMs){
  if(state.timeDisplay === 'utc'){
    const l = activeLoc(); if(!l || !l.timezone) return '';
    const off = tzOffsetMs(utcMs, l.timezone), d = new Date(utcMs+off);
    return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}${l.tzAbbr?' '+l.tzAbbr:' LT'}`;
  }
  return fmtUtcDate(utcMs);
}
function fmtLocal(utcMs, withDate){
  const p = localParts(utcMs);
  const hh = String(p.h).padStart(2,'0'), mm = String(p.min).padStart(2,'0');
  return withDate ? `${DOW[p.dow]} ${p.d} ${MON[p.m]} ${hh}:${mm}${tzAbbr()}` : `${DOW[p.dow]} ${hh}:${mm}${tzAbbr()}`;
}
function fmtUtc(utcMs){
  const d = new Date(utcMs);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} UTC`;
}
function fmtUtcDate(utcMs){
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')} ${fmtUtc(utcMs)}`;
}
function fmtCoord(lat, lon){
  return `${Math.abs(lat).toFixed(4)}° ${lat>=0?'N':'S'} · ${Math.abs(lon).toFixed(4)}° ${lon>=0?'E':'W'}`;
}
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---------- in-app dialog (replaces window.prompt / alert / confirm) ----------
// opts: {title, text, input:{value, placeholder}|null, buttons:[{label, value, primary}]}
// resolves {button, value}; Escape / backdrop = {button:'cancel'}
function appDialog(opts){
  return new Promise(resolve=>{
    const ov = $('sideDialog'), inp = $('dialogInput'), acts = $('dialogActions');
    if(!state.sideOpen) applySide(true); // the dialog lives in the left column
    $('dialogTitle').textContent = opts.title || '';
    $('dialogText').innerHTML = opts.text || '';
    $('dialogText').style.display = opts.text ? 'block' : 'none';
    if(opts.input){ inp.style.display = 'block'; inp.value = opts.input.value || ''; inp.placeholder = opts.input.placeholder || ''; }
    else inp.style.display = 'none';
    acts.innerHTML = '';
    const buttons = opts.buttons || [{label:'OK', value:'ok', primary:true}];
    let done = false;
    function finish(val){
      if(done) return; done = true;
      ov.style.display = 'none';
      document.removeEventListener('keydown', onKey, true);
      resolve({button: val, value: inp.value.trim()});
    }
    buttons.forEach(b=>{
      const el = document.createElement('button');
      el.className = b.primary ? 'primary-btn' : 'reset-btn';
      el.textContent = b.label;
      el.addEventListener('click', ()=>finish(b.value));
      acts.appendChild(el);
    });
    function onKey(e){
      if(e.key==='Escape'){ e.stopPropagation(); finish('cancel'); }
      else if(e.key==='Enter' && opts.input){ e.stopPropagation(); const pb = buttons.find(b=>b.primary); if(pb) finish(pb.value); }
    }
    document.addEventListener('keydown', onKey, true);
    ov.style.display = 'block';
    ov.scrollIntoView && ov.scrollIntoView({block:'nearest'});
    if(opts.input) setTimeout(()=>{ inp.focus(); inp.select(); }, 30);
  });
}
function appInfo(text, title){ return appDialog({title: title||'StueveCast', text}); }

// ---------- timeline: hour 0 = today 00 UTC, one slider for everything ----------
function initTimeline(){
  const t0 = Math.floor(Date.now()/86400e3)*86400;
  state.timeline = {t0, hours: TIMELINE_HOURS + 24};
}
function idxToMs(idx){ return (state.timeline.t0 + idx*3600)*1000; }
function msToIdx(ms){ return Math.round((ms/1000 - state.timeline.t0)/3600); }
function nowIdx(){ return Math.floor((Date.now()/1000 - state.timeline.t0)/3600); }
function currentTimeMs(){ return idxToMs(state.timeIdx); }
function maxIdx(){
  // furthest hour any applicable model is expected to cover (estimated for
  // unfetched models, actual for fetched ones)
  const l = state.location; let m = nowIdx()+1;
  MODEL_CATALOG.forEach(mm=>{
    if(mm.noVertical || (l && !modelCoversPoint(mm, l.lat, l.lon))) return;
    const md = state.modelData[mm.key];
    // fetched models: the hours actually delivered; others: estimated horizon
    m = Math.max(m, md ? md.validRange[1]+md.offset : msToIdx(estimateModelValidUntil(mm).getTime()));
  });
  return Math.min(m, state.timeline.hours-1);
}
function clampIdx(idx){ return Math.max(nowIdx(), Math.min(maxIdx(), idx)); }
// Manual time changes (slider, day chips, picker, ‹ ›, arrow keys) clear the
// model selection: the list re-sorts for the new hour and the user picks the
// model anew. Playback (opts.user === false) keeps the selection.
function setTimeIdx(idx, opts){
  opts = opts || {};
  idx = clampIdx(idx);
  const changed = idx !== state.timeIdx;
  state.timeIdx = idx;
  if(changed && opts.user !== false) clearSelection();
  renderTimeControls();
  renderModelList();
  if(changed || opts.force) scheduleRender();
}
function clearSelection(){
  state.selectedModels = []; state.selectionOrder = []; state.primaryModel = null; state.avgOn = false;
  state.rows = null; state.compareFlights = []; state.renderedPrimary = null;
  hideNotice();
}
let renderPending = false;
function scheduleRender(){
  if(renderPending) return;
  renderPending = true;
  requestAnimationFrame(()=>{ renderPending = false; renderProfile(); });
}
function renderTimeControls(){
  const ms = currentTimeMs();
  const lead = (ms - Date.now())/3600e3;
  const leadTxt = lead < 0.5 ? 'now' : `+${Math.round(lead)} h`;
  $('timeLabel').textContent = fmtLocal(ms, true);
  $('timeLead').textContent = leadTxt;
  $('timeLabelUtc').textContent = fmtAlt(ms);
  $('timeStripLabel').textContent = `${fmtLocal(ms, true)} · ${leadTxt}`;
  const l = activeLoc();
  $('timeZoneNote').textContent = state.timeDisplay === 'utc' ? 'UTC' : (l && l.timezone ? l.timezone : 'UTC');
  const sl = $('timeSlider');
  sl.min = String(nowIdx()); sl.max = String(maxIdx()); sl.value = String(state.timeIdx);
  // day chips
  const p = localParts(ms), todayP = localParts(Date.now());
  const days = $('dayChips');
  const nDays = Math.ceil((maxIdx()-nowIdx())/24)+1;
  let html = '';
  for(let d=0; d<=nDays; d++){
    const dayMs = zonedToUtcMs(todayP.y, todayP.m, todayP.d + d, 12);
    if(msToIdx(dayMs) - 12 > maxIdx()) break;
    const dp = localParts(dayMs);
    const sel = dp.y===p.y && dp.m===p.m && dp.d===p.d;
    html += `<button class="chip${sel?' sel':''}" data-day="${d}" title="jump to this day, same hour">${d===0?'Today':DOW[dp.dow]+' '+dp.d}</button>`;
  }
  if(days.innerHTML !== html) days.innerHTML = html;
  const selChip = days.querySelector('.sel'); if(selChip && selChip.scrollIntoView) selChip.scrollIntoView({block:'nearest', inline:'nearest'});
  // tick marks at local midnights
  const min = nowIdx(), max = maxIdx();
  const midnights = [];
  for(let i=min;i<=max;i++){ const q = localParts(idxToMs(i)); if(q.h===0) midnights.push({i, dow:q.dow}); }
  const every = midnights.length > 12 ? 3 : (midnights.length > 7 ? 2 : 1);
  let ticks = '';
  midnights.forEach((m,k)=>{ const x = (m.i-min)/(max-min||1)*100; ticks += `<span style="left:${x.toFixed(2)}%"><i></i>${k%every===0 ? DOW[m.dow] : ''}</span>`; });
  if($('timeTicks').innerHTML !== ticks) $('timeTicks').innerHTML = ticks;
  // native picker value (local wall clock)
  const pk = $('timePicker');
  pk.value = `${p.y}-${String(p.m+1).padStart(2,'0')}-${String(p.d).padStart(2,'0')}T${String(p.h).padStart(2,'0')}:00`;
}
function jumpToDay(d){
  const cur = localParts(currentTimeMs()), todayP = localParts(Date.now());
  const ms = zonedToUtcMs(todayP.y, todayP.m, todayP.d + d, cur.h);
  setTimeIdx(msToIdx(ms));
}
function onTimePicked(){
  const v = $('timePicker').value; if(!v) return;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v); if(!m) return;
  const ms = zonedToUtcMs(+m[1], +m[2]-1, +m[3], +m[4], 0);
  setTimeIdx(msToIdx(ms));
}
let playTimer = null;
function togglePlay(){
  if(playTimer){ clearInterval(playTimer); playTimer = null; $('playBtn').textContent = '▶'; return; }
  $('playBtn').textContent = '❚❚';
  playTimer = setInterval(()=>{
    if(state.timeIdx >= maxIdx()){ togglePlay(); return; }
    setTimeIdx(state.timeIdx+1, {user:false});
  }, Math.round(1000/playSpeed));
}

// ---------- side panel ----------
function applySide(open){
  state.sideOpen = open;
  document.body.classList.toggle('side-collapsed', !open);
  document.body.classList.toggle('side-open', open);
  $('sideHandle').querySelector('span').textContent = open ? '‹' : '›';
  if(PICK_MAP && open) setTimeout(()=>PICK_MAP.invalidateSize(), 220);
  setTimeout(()=>{ if(state.rows) redrawAll(); }, 30);
}
function isNarrow(){ return window.innerWidth < 1000; }

// ---------- map / place ----------
let PICK_MAP = null, GPS_MARKER = null, moveTimer = null, searchTimer = null;
function initMap(){
  const loc = state.location || {lat: 47.3769, lon: 8.5417};
  PICK_MAP = L.map('pickMap', {zoomControl: true, attributionControl: true}).setView([loc.lat, loc.lon], state.location ? 11 : 8);
  PICK_MAP.attributionControl.setPrefix(false);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'});
  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom: 17, subdomains:'abc', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>, <a href="https://opentopomap.org">OpenTopoMap</a>'});
  const base = lsGet('sc_baselayer', 'topo')==='osm' ? osm : topo;
  base.addTo(PICK_MAP);
  L.control.layers({'Terrain': topo, 'Streets': osm}, null, {position:'topright', collapsed:false}).addTo(PICK_MAP);
  PICK_MAP.on('baselayerchange', e=>lsSet('sc_baselayer', e.name==='Streets' ? 'osm' : 'topo'));
  PICK_MAP.on('moveend', ()=>{
    const c = PICK_MAP.getCenter();
    setPickedPoint(c.lat, c.lng, null);
    clearTimeout(moveTimer);
    moveTimer = setTimeout(()=>resolvePoint(c.lat, c.lng), 650);
  });
  const c = PICK_MAP.getCenter();
  if(state.location) updatePlaceCard(); else { setPickedPoint(c.lat, c.lng, null); resolvePoint(c.lat, c.lng); }
}
function setPickedPoint(lat, lon, name){
  const prev = state.location || {};
  const moved = prev.lat==null || Math.abs(prev.lat-lat)>2e-4 || Math.abs(prev.lon-lon)>2e-4;
  state.location = Object.assign({}, prev, {lat, lon});
  if(name) state.location.name = name;
  else if(moved) state.location.name = null;
  if(moved) state.location.elevation = null;
  updatePlaceCard();
  renderModelList();
}
let resolveSeq = 0, lastResolved = null;
async function resolvePoint(lat, lon){
  if(lastResolved && Math.abs(lastResolved.lat-lat)<1e-6 && Math.abs(lastResolved.lon-lon)<1e-6 && state.location && state.location.elevation!=null) return;
  const seq = ++resolveSeq;
  $('placeStatus').textContent = 'looking up elevation and place name…';
  try{
    const [info, name] = await Promise.all([
      OpenMeteo.locationInfo(lat, lon).catch(()=>null),
      state.location && state.location.name ? Promise.resolve(state.location.name) : OpenMeteo.reverseGeocode(lat, lon).catch(()=>null),
    ]);
    if(seq !== resolveSeq) return;
    if(info){ Object.assign(state.location, {elevation: info.elevation, timezone: info.timezone, utcOffsetSec: info.utcOffsetSec, tzAbbr: info.tzAbbr}); lastResolved = {lat, lon}; }
    if(name) state.location.name = name;
    if(state.loaded && Math.abs(state.loaded.lat-lat)<2e-4 && Math.abs(state.loaded.lon-lon)<2e-4) Object.assign(state.loaded, state.location);
    $('placeStatus').textContent = info ? '' : 'elevation lookup failed (offline?)';
  }catch(e){
    if(seq === resolveSeq) $('placeStatus').textContent = 'lookup failed';
  }
  updatePlaceCard();
  renderTimeControls();
  if(state.rows) renderProfileFacts();
}
function locationIsLoaded(){
  const l = state.location, d = state.loaded;
  return !!(l && d && Math.abs(l.lat-d.lat)<2e-4 && Math.abs(l.lon-d.lon)<2e-4);
}
function updatePlaceCard(){
  const l = state.location; if(!l) return;
  $('placeName').textContent = l.name || 'Map centre';
  $('placeCoords').textContent = fmtCoord(l.lat, l.lon);
  $('placeElev').textContent = l.elevation!=null ? `${Math.round(l.elevation)} m AMSL` : '';
  const fav = favIndexOf(l) >= 0;
  $('favBtn').textContent = fav ? '★' : '☆';
  $('favBtn').title = fav ? 'Saved place — rename or remove' : 'Save this place';
  const loaded = locationIsLoaded();
  $('loadBtn').textContent = loaded ? 'Loaded' : 'Load';
  $('loadBtn').classList.toggle('attention', !loaded && !!state.loaded);
}
function favorites(){ return lsGet(FAV_KEY, []); }
function favIndexOf(l){ return favorites().findIndex(f=>Math.abs(f.lat-l.lat)<1e-4 && Math.abs(f.lon-l.lon)<1e-4); }
// Saved places live in a dropdown under the search field: ★ opens it, and it
// also appears when the empty search field gets focus.
function showFavDropdown(){
  const box = $('searchResults');
  const list = favorites();
  if(!list.length){
    box.innerHTML = '<div class="sr-head">Saved places</div><div class="sr-empty">None yet — press ☆ in the place card to save the crosshair position.</div>';
  } else {
    box.innerHTML = '<div class="sr-head">Saved places</div>' + list.map((f,i)=>
      `<div class="sr-item fav" data-fav="${i}">
        <div class="sr-main"><span>${escapeHtml(f.name)}</span><span class="sr-sub">${fmtCoord(f.lat,f.lon)}${f.elevation!=null?' · '+Math.round(f.elevation)+' m':''}</span></div>
        <button class="sr-x" data-fav-remove="${i}" title="remove">×</button>
      </div>`).join('');
  }
  box.style.display = 'block';
}
async function saveCurrentPlace(){
  const l = state.location; if(!l) return;
  const i = favIndexOf(l);
  const list = favorites();
  if(i >= 0){
    const r = await appDialog({title:'Saved place', text:`<b>${escapeHtml(list[i].name)}</b><br>${fmtCoord(l.lat,l.lon)}`,
      buttons:[{label:'Remove', value:'remove'},{label:'Rename', value:'rename'},{label:'Close', value:'cancel', primary:true}]});
    if(r.button==='remove'){ list.splice(i,1); lsSet(FAV_KEY, list); }
    else if(r.button==='rename'){
      const r2 = await appDialog({title:'Rename place', input:{value:list[i].name, placeholder:'Name'}, buttons:[{label:'Cancel', value:'cancel'},{label:'Save', value:'save', primary:true}]});
      if(r2.button==='save' && r2.value){ list[i].name = r2.value; lsSet(FAV_KEY, list); }
    }
  } else {
    const r = await appDialog({title:'Save this place', text:`${fmtCoord(l.lat,l.lon)}${l.elevation!=null?' · '+Math.round(l.elevation)+' m AMSL':''}`,
      input:{value: l.name || '', placeholder:'Name for this place'}, buttons:[{label:'Cancel', value:'cancel'},{label:'Save', value:'save', primary:true}]});
    if(r.button==='save'){
      list.push({name: r.value || fmtCoord(l.lat,l.lon), lat: l.lat, lon: l.lon, elevation: l.elevation, timezone: l.timezone});
      lsSet(FAV_KEY, list);
    }
  }
  updatePlaceCard();
}
async function removeFavorite(i){
  const list = favorites(); const f = list[i]; if(!f) return;
  const r = await appDialog({title:'Remove saved place', text:`Remove <b>${escapeHtml(f.name)}</b> from your saved places?`,
    buttons:[{label:'Cancel', value:'cancel'},{label:'Remove', value:'remove', primary:true}]});
  if(r.button!=='remove') return;
  list.splice(i,1); lsSet(FAV_KEY, list);
  showFavDropdown(); updatePlaceCard();
}
function goToPlace(lat, lon, name, zoom, load){
  const prev = state.location || {};
  state.location = Object.assign({}, prev, {lat, lon, name: name||null, elevation:null});
  updatePlaceCard();
  PICK_MAP.setView([lat, lon], zoom || 12);
  clearTimeout(moveTimer);
  resolvePoint(lat, lon); // the debounced moveend lookup is skipped once this one resolved
  if(load) loadProfile();
}
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
      goToPlace(r.lat, r.lon, r.country ? `${r.name}/${r.country}` : r.name, 12, true);
    }));
  }catch(e){
    box.innerHTML = '<div class="sr-empty">Search failed (offline?)</div>'; box.style.display='block';
  }
}
// GPS position: shown as a blue cross on the map; the crosshair picker is
// independent of it. `center` moves the picker there and loads the profile.
function gpsIcon(){
  return L.divIcon({className:'gps-marker', iconSize:[22,22], iconAnchor:[11,11], html:
    '<svg viewBox="0 0 22 22" width="22" height="22"><g fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"><path d="M11 1.5v6M11 14.5v6M1.5 11h6M14.5 11h6"/></g>'+
    '<g fill="none" stroke="#1f8fb0" stroke-width="1.8" stroke-linecap="round"><path d="M11 1.5v6M11 14.5v6M1.5 11h6M14.5 11h6"/></g><circle cx="11" cy="11" r="1.6" fill="#1f8fb0"/></svg>'});
}
function placeGpsMarker(lat, lon, accuracy){
  if(GPS_MARKER) GPS_MARKER.setLatLng([lat,lon]);
  else GPS_MARKER = L.marker([lat,lon], {icon: gpsIcon(), interactive:false, keyboard:false, zIndexOffset:500}).addTo(PICK_MAP);
  GPS_MARKER.bindTooltip(`your position${accuracy ? ' ±'+Math.round(accuracy)+' m' : ''}`, {direction:'top', offset:[0,-8]});
}
function acquireGps(center){
  if(!navigator.geolocation){ if(center) appInfo('Geolocation is not available in this browser.'); return; }
  const btn = $('gpsBtn'); btn.classList.add('geo-spin');
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.classList.remove('geo-spin');
    const {latitude:lat, longitude:lon, accuracy} = pos.coords;
    placeGpsMarker(lat, lon, accuracy);
    if(center) goToPlace(lat, lon, null, 13, true);
  }, err=>{
    btn.classList.remove('geo-spin');
    if(center) appInfo('Position not available: '+escapeHtml(err.message)+'. Allow location access for this site, or pick the place on the map.');
  }, {enableHighAccuracy: true, timeout: 12000, maximumAge: 60000});
}
function locateMe(){ acquireGps(true); }

// ---------- models: list (left) and chips (above chart) ----------
function modelInHorizonAt(m, idx){
  const md = state.modelData[m.key];
  if(md && md.validRange[0] >= 0) return OpenMeteo.hasDataAt(md, idx);
  return idxToMs(idx) <= estimateModelValidUntil(m).getTime() + 1800e3;
}
function applicableModels(){
  const l = state.location; if(!l) return [];
  return MODEL_CATALOG.filter(m=>!m.noVertical && modelCoversPoint(m, l.lat, l.lon));
}
function renderModelList(){
  const l = state.location; if(!l) return;
  const now = new Date();
  const rows = MODEL_CATALOG.map(m=>{
    const app = modelApplicability(m, l.lat, l.lon, null, now);
    const inHorizon = app.ok && state.timeline && modelInHorizonAt(m, state.timeIdx);
    return {m, app, inHorizon, rank: inHorizon ? 0 : (app.ok ? 1 : (m.noVertical ? 3 : 2))};
  });
  // order follows the time slider: models covering this hour first, finest grid on top
  rows.sort((a,b)=> a.rank!==b.rank ? a.rank-b.rank : (a.m.gridKm!==b.m.gridKm ? a.m.gridKm-b.m.gridKm : estimateRunAgeHours(a.m, now)-estimateRunAgeHours(b.m, now)));
  const okCount = rows.filter(r=>r.inHorizon).length;
  $('modelSummary').textContent = state.timeline ? `${okCount} cover this hour` : `${rows.filter(r=>r.app.ok).length} cover this place`;
  const cachedLevels = k => { try{ const c = JSON.parse(localStorage.getItem('sc_vars_v1_'+k)||'null'); return c && c.levels ? c.levels.length : null; }catch(e){ return null; } };
  const html = rows.map(({m, app, inHorizon})=>{
    const checked = state.selectedModels.includes(m.key);
    const nLev = m.levels ? (cachedLevels(m.key) || LEVEL_SETS[m.levels].length) : 0;
    const until = app.ok ? fmtLocal(estimateModelValidUntil(m, now).getTime(), true) : '';
    const run = estimateModelRun(m, now), age = estimateRunAgeHours(m, now);
    const runTxt = `run ${String(run.getUTCHours()).padStart(2,'0')}Z (${age<1?'<1':Math.round(age)} h ago)`;
    return `<div class="model-row${app.ok?'':' off'}${inHorizon?'':' later'}" data-model="${m.key}">
      <input type="checkbox" data-model="${m.key}" ${checked?'checked':''} ${app.ok?'':'disabled'} title="show as curve">
      <div class="mr-body" data-toggle="${m.key}">
        <div class="mr-name">${m.label}${app.ok && !inHorizon ? ' <span class="badge">beyond horizon</span>' : ''}</div>
        <div class="mr-meta">${m.provider} · ${m.gridKm} km · ${m.levels ? nLev+' levels' : 'no vertical data'}${m.note && app.ok ? ' · '+m.note : ''}</div>
        <div class="mr-meta">${app.ok ? runTxt+' · to '+until : app.reason}</div>
      </div>
      ${app.ok ? `<button class="mr-star${state.primaryModel===m.key?' on':''}" data-primary="${m.key}" title="make primary">${state.primaryModel===m.key?'★':'☆'}</button>` : ''}
    </div>`;
  }).join('');
  if($('modelList').innerHTML !== html) $('modelList').innerHTML = html;
}
function renderModelChips(){
  const wrap = $('modelChips');
  if(!state.loaded){ wrap.innerHTML = ''; return; }
  const avail = applicableModels().filter(m=>modelInHorizonAt(m, state.timeIdx));
  const withData = modelsWithData();
  const avgActive = state.avgOn && state.renderedPrimary === 'avg';
  const primary = (state.renderedPrimary && withData.includes(state.renderedPrimary)) ? state.renderedPrimary : state.primaryModel;
  let html = avail.map(m=>{
    const k = m.key, sel = state.selectedModels.includes(k);
    const ci = state.compareFlights.findIndex(c=>c.key===k);
    let cls = 'chip model-chip', style = '', title;
    if(!avgActive && k===primary && withData.includes(k)){ cls += ' primary'; title = 'primary model (drives the analytics)'; }
    else if(sel){ cls += ' comp'; const col = ci>=0 ? COMPARE_COLORS[ci].temp : 'var(--text-dim)'; style = `border-color:${col};color:${col}`; title = avgActive ? 'part of the blend' : 'comparison curve · tap to make primary'; }
    else { cls += ' avail'; title = 'tap to add this model'; }
    return `<button class="${cls}" data-chip="${k}" style="${style}" title="${title}">${sel?'':'+ '}${m.label}${sel?`<span class="x" data-remove="${k}" title="remove">×</span>`:''}</button>`;
  }).join('');
  if(withData.length >= 2){
    html += `<button class="chip avg${avgActive?' primary':''}" data-avg="1" title="weighted mean of the shown models (grid spacing × run age)">avg.${avgActive?'<span class="x" title="back to the single model">×</span>':''}</button>`;
  }
  wrap.innerHTML = html;
}
function selectionAdd(key){
  if(state.selectedModels.includes(key)) return true;
  let removed = null;
  if(state.selectedModels.length >= MAX_TOTAL){
    const order = state.selectionOrder || [];
    const cand = order.filter(k=>k!==state.primaryModel && state.selectedModels.includes(k));
    removed = cand[0] || state.selectedModels.find(k=>k!==state.primaryModel);
    if(removed) state.selectedModels = state.selectedModels.filter(k=>k!==removed);
  }
  state.selectedModels = MODEL_CATALOG.map(m=>m.key).filter(k=>state.selectedModels.includes(k) || k===key);
  state.selectionOrder = (state.selectionOrder||[]).filter(k=>state.selectedModels.includes(k)).concat([key]);
  if(!state.primaryModel || !state.selectedModels.includes(state.primaryModel)) state.primaryModel = key;
  if(removed) showNotice(`${MODEL_BY_KEY[removed].label} removed — up to ${MAX_TOTAL} models at once.`, false);
  return true;
}
function selectionRemove(key){
  state.selectedModels = state.selectedModels.filter(k=>k!==key);
  state.selectionOrder = (state.selectionOrder||[]).filter(k=>k!==key);
  if(state.primaryModel === key) state.primaryModel = state.selectedModels[0] || null;
}
async function toggleModel(key, opts){
  opts = opts || {};
  if(state.selectedModels.includes(key) && !opts.addOnly) selectionRemove(key);
  else selectionAdd(key);
  renderModelList(); saveSession();
  if(state.loaded){ await ensureModels(state.selectedModels); renderProfile(); }
}
function setPrimary(key){
  if(!state.selectedModels.includes(key)) selectionAdd(key);
  state.primaryModel = key;
  renderModelList(); saveSession();
  if(state.loaded){ ensureModels(state.selectedModels).then(renderProfile); }
}

// ---------- data loading ----------
function setLoading(on, msg){
  $('loadingOverlay').style.display = on ? 'flex' : 'none';
  if(msg!=null) $('loadingMsg').textContent = msg;
}
function showNotice(text, isError){
  const n = $('profileNotice');
  n.textContent = text; n.style.display = 'block';
  n.classList.toggle('error', !!isError);
}
function hideNotice(){ $('profileNotice').style.display = 'none'; }
function modelStale(md, loc){
  return !md || Math.abs(md.lat-loc.lat)>2e-4 || Math.abs(md.lon-loc.lon)>2e-4 || (Date.now()-md.fetchedAt) > 3*3600e3;
}
// Fetches every listed model that is missing or stale for the loaded location.
async function ensureModels(keys, force){
  const loc = state.loaded; if(!loc) return [];
  const errors = [];
  const todo = keys.filter(k=>MODEL_BY_KEY[k] && (force || modelStale(state.modelData[k], loc)));
  if(todo.length) setLoading(true, 'Loading model data…');
  for(const key of todo){
    try{
      const md = await OpenMeteo.fetchModel(MODEL_BY_KEY[key], loc.lat, loc.lon, msg=>setLoading(true, msg));
      md.offset = Math.round((md.t0 - state.timeline.t0)/3600);
      if(md.validRange[0] < 0){ errors.push(`${md.meta.label}: no data at this place`); delete state.modelData[key]; }
      else state.modelData[key] = md;
    }catch(e){
      console.error(e);
      errors.push(`${MODEL_BY_KEY[key].label}: ${e.message}`);
      delete state.modelData[key];
    }
  }
  if(todo.length) setLoading(false);
  if(errors.length) showNotice('Some models failed: '+errors.join(' · '), false);
  return errors;
}
async function loadProfile(opts){
  opts = opts || {};
  const l = state.location; if(!l) return;
  if(!state.selectedModels.length){
    const def = pickDefaultModel(l.lat, l.lon, new Date(currentTimeMs()));
    if(def){ state.selectedModels = [def.key]; state.primaryModel = def.key; state.selectionOrder = [def.key]; }
  }
  // drop models that do not cover the new place
  state.selectedModels = state.selectedModels.filter(k=>modelCoversPoint(MODEL_BY_KEY[k], l.lat, l.lon));
  if(!state.selectedModels.length){
    const def = pickDefaultModel(l.lat, l.lon, new Date(currentTimeMs()));
    if(def){ state.selectedModels = [def.key]; state.primaryModel = def.key; }
  }
  if(!state.primaryModel || !state.selectedModels.includes(state.primaryModel)) state.primaryModel = state.selectedModels[0] || null;
  state.loaded = Object.assign({}, l);
  hideNotice();
  const errors = await ensureModels(state.selectedModels, opts.force);
  const have = state.selectedModels.filter(k=>state.modelData[k]);
  if(!have.length){
    showNotice('No model data could be loaded. '+(navigator.onLine ? errors.join(' · ') : 'You appear to be offline and no cached profile exists for this place.'), true);
    state.loaded = null; updatePlaceCard(); renderModelChips();
    return;
  }
  if(!state.zoomTouched && isNarrow() && state.viewMaxPct === 1000){ state.viewMaxPct = 450; $('altRangeMax').value = '450'; }
  if(isNarrow()) applySide(false);
  state.timeIdx = clampIdx(state.timeIdx);
  updatePlaceCard(); renderModelList(); saveSession();
  renderProfile();
}

// ---------- profile rendering ----------
function modelsWithData(){ return state.selectedModels.filter(k=>state.modelData[k] && OpenMeteo.hasDataAt(state.modelData[k], state.timeIdx)); }
function showEmpty(title, text){
  $('emptyTitle').textContent = title; $('emptyText').innerHTML = text;
  $('emptyState').style.display = 'block'; $('dataView').style.display = 'none';
}
function renderProfile(){
  renderTimeControls();
  if(!state.loaded){
    showEmpty('No profile loaded', 'Move the map so the crosshair sits on your site (or search a place, or use ◎ for your position), then press <b>Load</b>. Models that cover the place and hour appear as chips above the chart; the ☰ menu holds units and display options.');
    renderModelChips(); return;
  }
  const avail = modelsWithData();
  if(!avail.length){
    state.rows = null; state.compareFlights = []; state.renderedPrimary = null;
    if(playTimer) togglePlay();
    const n = applicableModels().filter(m=>modelInHorizonAt(m, state.timeIdx)).length;
    showEmpty(`Choose a model for ${fmtLocal(currentTimeMs(), true)}`,
      n ? `${n} model${n>1?'s cover':' covers'} this hour — they are listed first in the left panel and as chips above. Tap one to draw it.`
        : 'No model reaches this hour at this place. Move the time slider back.');
    renderModelChips(); renderModelList(); renderTimeControls();
    return;
  }
  $('emptyState').style.display = 'none';
  $('dataView').style.display = 'block';
  let primary = state.primaryModel;
  if(!avail.includes(primary)){
    // only reachable during playback (manual time changes clear the selection)
    primary = avail[0]; state.primaryModel = primary;
    showNotice(`Primary model left its horizon — continuing with ${MODEL_BY_KEY[primary].label}.`, false);
  }
  const shown = [primary].concat(avail.filter(k=>k!==primary)).slice(0, MAX_TOTAL);
  const rowsBy = {};
  shown.forEach(k=>{ rowsBy[k] = OpenMeteo.buildRows(state.modelData[k], state.timeIdx); });
  if(!rowsBy[primary]){ showNotice('Model profile incomplete for this hour.', false); return; }
  let md = state.modelData[primary], usedAvg = false;
  if(state.avgOn && shown.filter(k=>rowsBy[k]).length >= 2){
    const entries = shown.filter(k=>rowsBy[k]).map(k=>({key:k, rows: rowsBy[k], meta: MODEL_BY_KEY[k], weight: Blend.modelWeight(MODEL_BY_KEY[k])}));
    const avgRows = Blend.buildAverageRows(entries);
    if(avgRows){
      state.rows = avgRows;
      state.compareFlights = entries.map(e=>({rows: e.rows, source: e.meta.label, key: e.key}));
      state.renderedPrimary = 'avg';
      state.blendEntries = Blend.normalise(entries);
      md = null; usedAvg = true;
      $('riseTitle').textContent = 'Vertical velocity (model mean)';
    } else { state.avgOn = false; }
  }
  if(!usedAvg){
    state.rows = rowsBy[primary];
    state.compareFlights = shown.filter(k=>k!==primary && rowsBy[k]).map(k=>({rows: rowsBy[k], source: MODEL_BY_KEY[k].label, key: k}));
    state.renderedPrimary = primary;
    state.blendEntries = null;
  }
  renderProfileFacts();
  renderDiagStrip(md);
  renderThermo(state.rows);
  renderLegend();
  if(md) updateVerticalVelocityLabel(md);
  renderModelChips();
  renderModelList();
  redrawAll();
  updateTaEditLink();
  if(state.altitudeUnit === 'fl' && !state.transitionAltConfirmed) openTaModal('fl');
}
function fitChartHeight(){
  if(isNarrow() || printMode){ state.chartTargetHeight = null; return; }
  const col = $('centerCol'), card = document.querySelector('#dataView .chart-card');
  if(!col || !card || $('dataView').style.display==='none'){ state.chartTargetHeight = null; return; }
  const top = card.getBoundingClientRect().top - col.getBoundingClientRect().top + col.scrollTop;
  const legendH = $('legend').offsetHeight || 24;
  const available = col.clientHeight - top - legendH - 22;
  state.chartTargetHeight = Math.max(380, Math.min(1100, available));
}
function redrawAll(){
  if(!state.rows) return;
  fitChartHeight();
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
function renderProfileFacts(){
  const key = state.renderedPrimary; const l = state.loaded; if(!key || !state.rows || !l) return;
  const top = state.rows[state.rows.length-1];
  const lvlCount = state.rows.filter(r=>r[12]!=='agl').length;
  if(key === 'avg'){
    const parts = (state.blendEntries||[]).map(e=>`${e.meta.label} ${Math.round(e.weight*100)} %`).join(' · ');
    const items = [
      ['Model', `Weighted mean`],
      ['Weights', parts],
      ['Levels', `${lvlCount} lv · top ${Math.round(top[2])} hPa`],
      ['Model ground · site', `${Math.round(state.rows[0][1])} m · ${l.elevation!=null ? Math.round(l.elevation)+' m' : 'n/a'}`],
      ['Valid', `${fmtLocal(currentTimeMs(), true)} · ${fmtUtc(currentTimeMs())}`],
      ['Weighting', '1/√grid km ÷ (1 + run age h / 6)'],
      ['Comparison', state.compareFlights.map(c=>c.source).join(', ')],
      ['Place', `${l.name || fmtCoord(l.lat, l.lon)}`],
    ];
    $('statStrip').innerHTML = items.map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    $('subtitle').textContent = `${l.name || fmtCoord(l.lat,l.lon)} · ${fmtLocal(currentTimeMs(), true)} · weighted mean · ${APP_VERSION}`;
    return;
  }
  const md = state.modelData[key]; if(!md) return;
  const m = md.meta;
  const run = estimateModelRun(m);
  const age = Math.round((Date.now()-md.fetchedAt)/60000);
  const cached = (md.t0*1000) < Date.now()-36*3600e3;
  const items = [
    ['Model', `${m.label} · ${m.provider}`],
    ['Run (est.)', `${String(run.getUTCHours()).padStart(2,'0')}Z ${run.getUTCDate()} ${MON[run.getUTCMonth()]} · ${m.cycleH}-hourly`],
    ['Grid · levels', `${m.gridKm} km · ${lvlCount} lv · top ${Math.round(top[2])} hPa`],
    ['Model ground · site', `${md.elevation!=null ? Math.round(md.elevation)+' m' : 'n/a'} · ${l.elevation!=null ? Math.round(l.elevation)+' m' : 'n/a'}`],
    ['Valid', `${fmtLocal(currentTimeMs(), true)} · ${fmtUtc(currentTimeMs())}`],
    ['Fetched', age<1 ? 'just now' : (age<90 ? age+' min ago' : Math.round(age/60)+' h ago')+(cached?' · cached':'')],
    ['Comparison', state.compareFlights.length ? state.compareFlights.map(c=>c.source).join(', ') : 'none'],
    ['Place', `${l.name || fmtCoord(l.lat, l.lon)}`],
  ];
  $('statStrip').innerHTML = items.map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('subtitle').textContent = `${l.name || fmtCoord(l.lat,l.lon)} · ${fmtLocal(currentTimeMs(), true)} · ${m.label} · ${APP_VERSION}`;
}
function renderDiagStrip(md){
  const el = $('diagStrip');
  const s = md ? (OpenMeteo.surfaceAt(md, state.timeIdx) || {})
               : (Blend.averageSurface((state.blendEntries||[]).map(e=>({surface: OpenMeteo.surfaceAt(state.modelData[e.key], state.timeIdx), weight: e.weight}))) || {});
  const f1 = (v,d)=> v==null ? '—' : (Math.round(v*Math.pow(10,d||0))/Math.pow(10,d||0)).toFixed(d||0);
  const spd = v => v==null ? '—' : formatSpeed(v).toFixed(0)+' '+speedUnitLabel();
  const items = [
    ['2 m T / Td', `${f1(s.temperature_2m,1)} / ${f1(s.dew_point_2m,1)} °C`],
    ['10 m wind', s.wind_speed_10m!=null ? `${spd(s.wind_speed_10m)} / ${f1(s.wind_direction_10m)}°${s.wind_gusts_10m!=null?' · G '+spd(s.wind_gusts_10m):''}` : '—'],
    ['Cloud cover (model)', s.cloud_cover!=null ? `${f1(s.cloud_cover)} %${s.cloud_cover_low!=null?' · L/M/H '+f1(s.cloud_cover_low)+'/'+f1(s.cloud_cover_mid)+'/'+f1(s.cloud_cover_high):''}` : '—'],
    ['Precipitation', s.precipitation!=null ? `${f1(s.precipitation,1)} mm/h` : '—'],
    ['Surface / MSL p', `${f1(s.surface_pressure)} / ${f1(s.pressure_msl)} hPa`],
    ['CAPE / CIN (model)', s.cape!=null ? `${f1(s.cape)}${s.convective_inhibition!=null?' / '+f1(s.convective_inhibition):''} J/kg` : '—'],
    ['Lifted index (model)', s.lifted_index!=null ? `${s.lifted_index>0?'+':''}${f1(s.lifted_index,1)} °C` : '—'],
    ['Freezing level (model)', s.freezing_level_height!=null ? formatAltitude(s.freezing_level_height, state.rows ? state.rows[0][1] : 0) : '—'],
    ['Boundary layer (model)', s.boundary_layer_height!=null ? `${f1(s.boundary_layer_height)} m AGL` : '—'],
  ];
  el.innerHTML = items.map(([k,v])=>`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
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
    if(inspecting){ endInspect(); }
  }
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('touchmove', e=>{ if(inspecting || pinch) e.preventDefault(); }, {passive:false});
  c.addEventListener('touchstart', e=>{ if(state.inspectLock || e.touches.length===2) e.preventDefault(); }, {passive:false});
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

// ---------- wind-speed panel resize handle ----------
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
    const delta = startX - e.clientX; // dragging left widens the wind panel
    const maxW = PLOT ? Math.max(60, PLOT.cssWidth - PLOT.pad.left - 120) : 340;
    state.speedPanelWidth = Math.max(36, Math.min(maxW, startWidth + delta));
    draw(state.rows);
  });
  const end = ()=>{ if(dragging){ dragging = false; document.body.style.userSelect = ''; saveSettings(); } };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', ()=>{ state.speedPanelWidth = null; saveSettings(); draw(state.rows); });
}

// ---------- settings menu (hamburger) and diagram controls ----------
function openMenu(on){
  $('settingsMenu').style.display = on ? 'block' : 'none';
  if(on) syncSettingsControls();
}
function syncSettingsControls(){
  $('altitudeUnitSelect').value = state.altitudeUnit;
  $('speedUnitSelect').value = state.speedUnit;
  $('windDisplayModeSelect').value = state.windDisplayMode;
  $('levelDotsBtn').textContent = state.showLevelDots===false ? 'Off' : 'On';
  $('cloudThreshInput').value = String(state.cloudThreshold);
  $('playSpeedSelect').value = String(playSpeed);
  $('apiKeyInput').value = state.apiKey || '';
  $('callsToday').textContent = `${OpenMeteo.callsToday()} requests today`;
  $('themeBtn').textContent = document.documentElement.dataset.theme==='light' ? 'Dark' : 'Light';
  const dt = document.querySelector(`input[name=diagramType][value=${state.diagramType}]`); if(dt) dt.checked = true;
  const te = document.querySelector(`input[name=thetaE][value=${state.showThetaE?'on':'off'}]`); if(te) te.checked = true;
  const td = document.querySelector(`input[name=timeDisplay][value=${state.timeDisplay==='utc'?'utc':'lt'}]`); if(td) td.checked = true;
  updateTaEditLink();
}
function bindSettings(){
  $('settingsBtn').addEventListener('click', e=>{ e.stopPropagation(); openMenu($('settingsMenu').style.display==='none'); });
  document.addEventListener('click', e=>{ if($('settingsMenu').style.display!=='none' && !e.target.closest('.menu-wrap')) openMenu(false); });
  document.querySelectorAll('input[name=diagramType]').forEach(r=>r.addEventListener('change', ()=>{ if(r.checked){ state.diagramType = r.value; saveSettings(); if(state.rows) renderProfile(); } }));
  document.querySelectorAll('input[name=thetaE]').forEach(r=>r.addEventListener('change', ()=>{ if(r.checked){ state.showThetaE = r.value==='on'; saveSettings(); if(state.rows) draw(state.rows); } }));
  document.querySelectorAll('input[name=timeDisplay]').forEach(r=>r.addEventListener('change', ()=>{ if(r.checked){ state.timeDisplay = r.value; saveSettings(); renderTimeControls(); renderModelList(); if(state.rows) renderProfileFacts(); } }));
  $('altitudeUnitSelect').addEventListener('change', e=>{
    const v = e.target.value;
    if(v==='fl' && !state.transitionAltConfirmed){ openTaModal('fl'); return; }
    state.altitudeUnit = v; saveSettings(); updateTaEditLink(); if(state.rows) renderProfile();
  });
  $('speedUnitSelect').addEventListener('change', e=>{ state.speedUnit = e.target.value; saveSettings(); if(state.rows) renderProfile(); });
  $('windDisplayModeSelect').addEventListener('change', e=>{ state.windDisplayMode = e.target.value; saveSettings(); if(state.rows) draw(state.rows); });
  $('levelDotsBtn').addEventListener('click', ()=>{ state.showLevelDots = state.showLevelDots===false; syncSettingsControls(); saveSettings(); if(state.rows) draw(state.rows); });
  $('cloudThreshInput').addEventListener('input', e=>{ const v = parseFloat(e.target.value); if(isFinite(v) && v>=0 && v<=100){ state.cloudThreshold = v; saveSettings(); if(state.rows){ draw(state.rows); renderLegend(); } } });
  $('playSpeedSelect').addEventListener('change', e=>{ playSpeed = parseFloat(e.target.value)||1; saveSettings(); if(playTimer){ togglePlay(); togglePlay(); } });
  $('apiKeyInput').addEventListener('change', e=>{ state.apiKey = e.target.value.trim() || null; saveSettings(); });
  $('themeBtn').addEventListener('click', ()=>{
    document.documentElement.dataset.theme = document.documentElement.dataset.theme==='light' ? '' : 'light';
    saveSettings(); syncSettingsControls(); if(state.rows) redrawAll();
  });
  $('resetConfigBtn').addEventListener('click', ()=>{
    Object.assign(state, {diagramType:'stuve', altitudeUnit:'amsl', speedUnit:'kmh', windDisplayMode:'barb', showThetaE:false,
      cloudThreshold:85, showLevelDots:true, transitionAltFt:null, transitionAltConfirmed:false, speedPanelWidth:null});
    playSpeed = 1; saveSettings(); syncSettingsControls(); if(state.rows) renderProfile();
  });
  $('refreshBtn').addEventListener('click', ()=>{ openMenu(false); if(state.loaded) loadProfile({force:true}); });
  $('aboutBtn').addEventListener('click', ()=>{ openMenu(false); $('aboutOverlay').style.display='flex'; });
  $('aboutClose').addEventListener('click', ()=>{ $('aboutOverlay').style.display='none'; });
  $('aboutOverlay').addEventListener('click', e=>{ if(e.target.id==='aboutOverlay') $('aboutOverlay').style.display='none'; });
  $('inspectLockBtn').addEventListener('click', ()=>{ state.inspectLock = !state.inspectLock; applyInspectLock(); saveSettings(); });
}

// ---------- transition altitude modal (S2) ----------
function updateTaEditLink(){
  const link = $('taEditLink');
  if(state.altitudeUnit === 'fl' && state.transitionAltFt){ link.style.display = 'flex'; $('taEditLinkValue').textContent = state.transitionAltFt; }
  else link.style.display = 'none';
}
function openTaModal(pendingUnit){
  const groundAltM = state.rows && state.rows[0] ? state.rows[0][1] : (state.location ? state.location.elevation : null);
  $('taInput').value = state.transitionAltFt || estimateTransitionAltFt(groundAltM);
  $('taModalOverlay').dataset.pendingUnit = pendingUnit || 'fl';
  $('taModalOverlay').style.display = 'flex';
}
function bindTaModal(){
  $('taEditLink').addEventListener('click', ()=>{ openMenu(false); openTaModal('fl'); });
  $('taConfirmBtn').addEventListener('click', ()=>{
    const v = parseInt($('taInput').value, 10);
    state.transitionAltFt = isFinite(v) && v>=0 ? v : 5000;
    state.transitionAltConfirmed = true;
    state.altitudeUnit = $('taModalOverlay').dataset.pendingUnit || 'fl';
    $('altitudeUnitSelect').value = state.altitudeUnit;
    $('taModalOverlay').style.display = 'none';
    saveSettings(); updateTaEditLink(); if(state.rows) renderProfile();
  });
  $('taCancelBtn').addEventListener('click', ()=>{
    state.altitudeUnit = 'amsl'; $('altitudeUnitSelect').value = 'amsl';
    $('taModalOverlay').style.display = 'none';
    saveSettings(); updateTaEditLink(); if(state.rows) renderProfile();
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
  const name = `stuevecast_${((state.loaded&&state.loaded.name)||'profile').replace(/[^a-z0-9]+/gi,'_')}_${fmtUtcDate(currentTimeMs()).replace(/[^0-9]+/g,'-')}.png`;
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
  const l = state.loaded || state.location;
  const params = new URLSearchParams();
  params.set('loc', `${l.lat.toFixed(4)},${l.lon.toFixed(4)}`);
  if(l.name) params.set('name', l.name);
  params.set('t', new Date(currentTimeMs()).toISOString().slice(0,13)+'Z');
  params.set('models', state.selectedModels.join(','));
  if(state.primaryModel) params.set('p', state.primaryModel);
  if(state.avgOn) params.set('avg', '1');
  return location.origin + location.pathname + '#' + params.toString();
}
async function shareProfile(){
  if(!state.loaded) return;
  const url = buildShareUrl();
  const text = `StueveCast — ${state.loaded.name || fmtCoord(state.loaded.lat, state.loaded.lon)}, ${fmtLocal(currentTimeMs(), true)}`;
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
            models: (p.get('models')||'').split(',').filter(k=>MODEL_BY_KEY[k]), primary: p.get('p')||null, avg: p.get('avg')==='1'};
  }catch(e){ return null; }
}
let _preprintTheme = null;
function bindPrint(){
  $('printBtn').addEventListener('click', ()=>{ if(!state.rows) return; $('printModalOverlay').style.display='flex'; });
  $('printCancelBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; });
  $('printWithPanelsBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; proceedToPrint(true); });
  $('printWithoutPanelsBtn').addEventListener('click', ()=>{ $('printModalOverlay').style.display='none'; proceedToPrint(false); });
  window.addEventListener('beforeprint', ()=>{
    _preprintTheme = document.documentElement.dataset.theme || '';
    document.documentElement.dataset.theme = 'light';
    printMode = true;
    if(state.rows){ $('printUrl').textContent = buildShareUrl(); redrawAll(); }
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
  window.print();
}

// ---------- session ----------
function saveSession(){
  lsSet(SESSION_KEY, {loaded: state.loaded, location: state.location, timeMs: state.timeline ? currentTimeMs() : null,
    selectedModels: state.selectedModels, primaryModel: state.primaryModel, selectionOrder: state.selectionOrder||[]});
}
function restoreSession(){
  const s = lsGet(SESSION_KEY, null);
  if(!s) return false;
  if(s.location) state.location = s.location;
  state.selectedModels = (s.selectedModels||[]).filter(k=>MODEL_BY_KEY[k]);
  state.primaryModel = s.primaryModel;
  state.selectionOrder = s.selectionOrder || [];
  state.pendingLoad = s.loaded || null;
  state.restoredTimeMs = s.timeMs || null;
  return true;
}

// ---------- keyboard ----------
function bindKeyboard(){
  document.addEventListener('keydown', e=>{
    if(e.target && ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
    const k = e.key;
    if(k==='ArrowRight'){ setTimeIdx(state.timeIdx+1); e.preventDefault(); }
    else if(k==='ArrowLeft'){ setTimeIdx(state.timeIdx-1); e.preventDefault(); }
    else if(k===' '){ togglePlay(); e.preventDefault(); }
    else if(k==='p' || k==='P'){ $('printBtn').click(); }
    else if(k==='t' || k==='T'){ $('themeBtn').click(); }
    else if(k==='l' || k==='L'){ shareProfile(); }
    else if(k==='e' || k==='E'){ exportChartPng(); }
    else if(k==='Escape'){ openMenu(false); }
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
  initTimeline();
  $('versionStamp').textContent = APP_VERSION;
  const hash = parseHash();
  restoreSession();
  let startLoad = false;
  if(hash){
    state.location = Object.assign({}, state.location && Math.abs(state.location.lat-hash.lat)<2e-4 && Math.abs(state.location.lon-hash.lon)<2e-4 ? state.location : {}, {lat: hash.lat, lon: hash.lon, name: hash.name || null});
    if(hash.models.length){ state.selectedModels = hash.models; state.selectionOrder = hash.models.slice(); }
    if(hash.primary) state.primaryModel = hash.primary;
    state.avgOn = !!hash.avg;
    state.restoredTimeMs = hash.t || null;
    startLoad = true;
  } else if(state.pendingLoad){
    state.location = Object.assign({}, state.location||{}, state.pendingLoad);
    startLoad = true;
  }
  let idx = Math.ceil(Date.now()/3600e3)*3600e3; // next full hour
  if(state.restoredTimeMs && state.restoredTimeMs > Date.now()-3600e3) idx = state.restoredTimeMs;
  state.timeIdx = Math.max(nowIdx(), msToIdx(idx));

  applySide(isNarrow() ? !startLoad : state.sideOpen !== false);
  initMap();
  bindSettings(); bindTaModal(); bindPrint(); bindKeyboard();
  setupChartTouch(); setupWindHandle();
  renderTimeControls();
  renderModelList();
  syncSettingsControls();

  // side panel
  $('sideHandle').addEventListener('click', ()=>{ applySide(!state.sideOpen); saveSettings(); });
  $('searchInput').addEventListener('input', e=>{ clearTimeout(searchTimer); const q = e.target.value.trim(); searchTimer = setTimeout(()=>runSearch(q), 350); });
  $('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter'){ clearTimeout(searchTimer); runSearch(e.target.value.trim()); } if(e.key==='Escape'){ $('searchResults').style.display='none'; } });
  document.addEventListener('click', e=>{ if(!e.target.closest('#searchWrap')) $('searchResults').style.display='none'; });
  $('gpsBtn').addEventListener('click', locateMe);
  $('loadBtn').addEventListener('click', ()=>loadProfile());
  $('favBtn').addEventListener('click', saveCurrentPlace);
  $('favMenuBtn').addEventListener('click', e=>{ e.stopPropagation(); const box = $('searchResults'); if(box.style.display==='block' && box.querySelector('.sr-head')) box.style.display='none'; else showFavDropdown(); });
  $('searchInput').addEventListener('focus', ()=>{ if(!$('searchInput').value.trim()) showFavDropdown(); });
  $('searchResults').addEventListener('click', e=>{
    const x = e.target.closest('[data-fav-remove]'); if(x){ e.stopPropagation(); removeFavorite(parseInt(x.dataset.favRemove,10)); return; }
    const it = e.target.closest('[data-fav]'); if(!it) return;
    const f = favorites()[parseInt(it.dataset.fav,10)]; if(!f) return;
    $('searchResults').style.display='none';
    if(f.timezone) state.location = Object.assign(state.location||{}, {timezone: f.timezone});
    goToPlace(f.lat, f.lon, f.name, 12, true);
  });
  // time
  $('timeSlider').addEventListener('input', e=>setTimeIdx(parseInt(e.target.value,10)));
  ['stepBack','stepBack2'].forEach(id=>$(id).addEventListener('click', ()=>setTimeIdx(state.timeIdx-1)));
  ['stepFwd','stepFwd2'].forEach(id=>$(id).addEventListener('click', ()=>setTimeIdx(state.timeIdx+1)));
  $('playBtn').addEventListener('click', togglePlay);
  $('dayChips').addEventListener('click', e=>{ const b = e.target.closest('[data-day]'); if(b) jumpToDay(parseInt(b.dataset.day,10)); });
  $('timeLabelBtn').addEventListener('click', ()=>{ const pk = $('timePicker'); try{ if(pk.showPicker) pk.showPicker(); else pk.focus(); }catch(e){ pk.focus(); } });
  $('timePicker').addEventListener('change', onTimePicked);
  // models
  $('modelList').addEventListener('change', e=>{ const cb = e.target.closest('input[data-model]'); if(cb) toggleModel(cb.dataset.model); });
  $('modelList').addEventListener('click', e=>{
    const star = e.target.closest('[data-primary]'); if(star){ setPrimary(star.dataset.primary); return; }
    const body = e.target.closest('[data-toggle]'); if(body){ const row = body.closest('.model-row'); if(row && !row.classList.contains('off')) toggleModel(body.dataset.toggle); }
  });
  $('modelChips').addEventListener('click', e=>{
    const avg = e.target.closest('[data-avg]'); if(avg){ state.avgOn = !state.avgOn; renderProfile(); return; }
    const x = e.target.closest('[data-remove]'); if(x){ e.stopPropagation(); toggleModel(x.dataset.remove); return; }
    const chip = e.target.closest('[data-chip]'); if(!chip) return;
    const k = chip.dataset.chip;
    if(state.selectedModels.includes(k)){
      if(state.avgOn){ state.avgOn = false; setPrimary(k); }
      else if(k!==state.primaryModel) setPrimary(k);
    }
    else toggleModel(k, {addOnly:true});
  });
  // chart
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
  const measureHeader = ()=>{ const h = document.querySelector('header.topbar'); if(h && h.offsetHeight) document.documentElement.style.setProperty('--topbar-h', h.offsetHeight+'px'); };
  measureHeader();
  let resizeTimer = null;
  window.addEventListener('resize', ()=>{ clearTimeout(resizeTimer); resizeTimer = setTimeout(()=>{ measureHeader(); if(state.rows) redrawAll(); if(PICK_MAP) PICK_MAP.invalidateSize(); }, 120); });
  window.addEventListener('online', ()=>{ if(state.loaded) showNotice('Back online.', false); });

  registerSw();
  renderProfile();
  if(startLoad){
    resolvePoint(state.location.lat, state.location.lon);
    loadProfile();
    acquireGps(false);           // marker only; the stored place stays
  } else {
    acquireGps(true);            // default place = GPS position
  }
})();
