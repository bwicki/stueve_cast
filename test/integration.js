// Integration test: boots index.html in jsdom with a synthetic Open-Meteo API,
// walks through the three screens and moves the time slider.
const fs = require('fs'), path = require('path');
const {JSDOM, VirtualConsole, ResourceLoader} = require('jsdom');
const ROOT = path.join(__dirname, '..');

// synthetic API shared with run.js (copied to keep the harness self-contained)
const KNOWN_LEVELS = [1000,975,950,925,900,850,800,700,600,500,400,300,250,200,150,100,70,50,30];
const KNOWN_SURFACE = new Set(['temperature_2m','relative_humidity_2m','dew_point_2m','surface_pressure','pressure_msl','wind_speed_10m','wind_direction_10m','cloud_cover','precipitation','cape','lifted_index','wind_speed_80m','wind_direction_80m','freezing_level_height','wind_gusts_10m']);
const KNOWN_LEVEL_VARS = new Set(['temperature','relative_humidity','wind_speed','wind_direction','geopotential_height']);
function synthResponse(url){
  const u = new URL(url);
  if(u.hostname === 'geocoding-api.open-meteo.com'){
    return {results:[{name:'Pizol', admin1:'Sankt Gallen', country:'Switzerland', latitude:46.96, longitude:9.39, elevation:2227, timezone:'Europe/Zurich'}]};
  }
  if(u.hostname === 'nominatim.openstreetmap.org') return {address:{village:'Bad Ragaz', state:'Sankt Gallen', country:'Switzerland'}};
  const vars = (u.searchParams.get('hourly')||'').split(',').filter(Boolean);
  if(u.searchParams.get('timezone') === 'auto'){
    return {elevation: 1980, timezone:'Europe/Zurich', utc_offset_seconds:7200, timezone_abbreviation:'CEST', hourly:{time:[0], temperature_2m:[20]}, hourly_units:{}};
  }
  for(const v of vars){
    const m = /^(.*)_(\d+)hPa$/.exec(v);
    if(m){ if(!KNOWN_LEVEL_VARS.has(m[1]) || !KNOWN_LEVELS.includes(+m[2])) return {error:true, reason:`Cannot initialize VariableOrDerived from invalid String value ${v} for key hourly`}; }
    else if(!KNOWN_SURFACE.has(v)) return {error:true, reason:`Cannot initialize VariableOrDerived from invalid String value ${v} for key hourly`};
  }
  const model = u.searchParams.get('models');
  const days = parseInt(u.searchParams.get('forecast_days')||'2',10), n = days*24;
  const t0 = Math.floor(Date.now()/86400e3)*86400;
  const time = Array.from({length:n}, (_,i)=>t0+i*3600);
  const hourly = {time}, units = {};
  const z0 = 1980, ps0 = 800;
  const horizonH = {icon_d2:48, meteofrance_arome_france:51, icon_eu:120, gfs_global:384}[model] || 120;
  const nowIdx = Math.floor((Date.now()/1000 - t0)/3600);
  for(const v of vars){
    const arr = new Array(n);
    for(let i=0;i<n;i++){
      const Tsfc = 14 + 4*Math.sin((i-9)/24*2*Math.PI);
      const m = /^(.*)_(\d+)hPa$/.exec(v);
      let val;
      if(m){
        const p = +m[2], z = 44330.8*(1-Math.pow(p/1013.25, 0.190263)), dz = Math.max(0, z-z0)/1000;
        const T = z>12000 ? -56 : Tsfc - 6.5*dz;
        val = {temperature:T, relative_humidity: p>=500 ? 60 : 20, wind_speed: 3+dz*3, wind_direction:(250+dz*10)%360, geopotential_height:z}[m[1]];
      } else {
        val = {temperature_2m:Tsfc, relative_humidity_2m:60, dew_point_2m:Tsfc-7.5, surface_pressure:ps0, pressure_msl:1015, wind_speed_10m:3, wind_direction_10m:250,
          cloud_cover:40, precipitation:0, cape:150, lifted_index:1.2, wind_speed_80m:5, wind_direction_80m:255, freezing_level_height:3100, wind_gusts_10m:7}[v];
      }
      arr[i] = (i > nowIdx + horizonH - 3) ? null : val;
    }
    hourly[v] = arr; units[v] = '';
  }
  return {latitude:46.96, longitude:9.39, elevation:z0, utc_offset_seconds:0, timezone:'UTC', timezone_abbreviation:'GMT', hourly, hourly_units:units};
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const vc = new VirtualConsole();
const errors = [];
vc.on('jsdomError', e => { errors.push(e.message || String(e)); });
vc.on('error', (...a) => { errors.push(a.join(' ')); });
vc.on('warn', ()=>{});
vc.on('log', (...a) => console.log('[page]', ...a));

function fakeCtx(){
  return new Proxy({}, {
    get(t, prop){
      if(prop === 'measureText') return s => ({width: String(s).length*6});
      if(prop === 'getTransform') return () => ({a:1,b:0,c:0,d:1,e:0,f:0, transformPoint: pt => ({x:pt.x, y:pt.y})});
      if(prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return () => ({addColorStop(){}});
      if(typeof prop === 'string' && !(prop in t)) t[prop] = ()=>{};
      return t[prop];
    },
    set(t, prop, v){ t[prop] = v; return true; },
  });
}

class LocalLoader extends ResourceLoader {
  fetch(url, options){
    const m = /^https:\/\/example\.github\.io\/stuevecast\/(.*)$/.exec(url);
    if(m){
      const file = path.join(ROOT, m[1].split('?')[0]);
      if(fs.existsSync(file)) return Promise.resolve(fs.readFileSync(file));
    }
    return Promise.resolve(Buffer.from(''));
  }
}
const dom = new JSDOM(html, {
  url: 'https://example.github.io/stuevecast/',
  runScripts: 'dangerously', resources: new LocalLoader(), pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(window){
    window.HTMLCanvasElement.prototype.getContext = function(){ return this._ctx || (this._ctx = fakeCtx()); };
    window.HTMLCanvasElement.prototype.toBlob = function(cb){ cb(new window.Blob(['x'])); };
    window.DOMPoint = function(x,y){ this.x=x; this.y=y; };
    window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
    window.fetch = async (url) => { const j = synthResponse(String(url)); return {ok:!j.error, status:j.error?400:200, json: async()=>j}; };
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {get(){ return this.id==='hodoCanvas' ? 300 : 800; }});
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {get(){ return 500; }});
    window.HTMLElement.prototype.scrollIntoView = function(){};
    window.HTMLElement.prototype.setPointerCapture = function(){};
    window.navigator.geolocation = {getCurrentPosition(ok){ setTimeout(()=>ok({coords:{latitude:47.05, longitude:9.45, accuracy:12}}), 60); }};
    window.alert = m => errors.push('ALERT '+m);
    window.matchMedia = () => ({matches:false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}});
    window.requestAnimationFrame = f => setTimeout(()=>f(Date.now()), 0);
  },
});

const sleep = ms => new Promise(r=>setTimeout(r, ms));
(async () => {
  const w = dom.window, d = w.document;
  await new Promise(res => { if(d.readyState==='complete') res(); else w.addEventListener('load', res); });
  await sleep(300);
  let failures = 0;
  const check = (c, m) => { if(c) console.log('  ok   '+m); else { failures++; console.log('  FAIL '+m); } };
  check(w.eval('typeof state') === 'object', 'scripts loaded, state exists');
  check(w.eval('PICK_MAP') != null, 'Leaflet map initialised');
  // GPS default: marker + auto-load of the position
  for(let i=0;i<60 && !w.eval('state.rows'); i++) await sleep(100);
  await sleep(400);
  check(w.eval('GPS_MARKER') != null && w.eval('state.loaded') && Math.abs(w.eval('state.loaded.lat')-47.05)<1e-6, 'GPS position marked and loaded as default place');
  check(w.eval('state.loaded.name') === 'Bad Ragaz/Switzerland', 'reverse-geocoded name as place/country: '+w.eval('state.loaded.name'));
  check(d.querySelectorAll('.leaflet-control-layers-expanded label').length === 2, 'open layer chooser with two base maps');
  check(d.getElementById('timeSlider').max > d.getElementById('timeSlider').min && d.querySelectorAll('#dayChips .chip').length > 10, 'time slider and day chips ready before any load');
  check(d.querySelectorAll('#modelList .model-row').length === w.eval('MODEL_CATALOG.length'), 'model list rendered from the catalog');

  // search and pick a place -> auto-load
  d.getElementById('searchInput').value = 'Pizol';
  d.getElementById('searchInput').dispatchEvent(new w.Event('input'));
  await sleep(500);
  const item = d.querySelector('.sr-item');
  check(item, 'search results rendered');
  item.click();
  for(let i=0;i<60 && (d.getElementById('loadingOverlay').style.display !== 'none' || !w.eval('state.rows')); i++) await sleep(100);
  await sleep(300);
  const loc = w.eval('state.loaded');
  check(loc && loc.name === 'Pizol/Switzerland' && loc.timezone === 'Europe/Zurich' && loc.elevation === 1980, 'place resolved and loaded: '+JSON.stringify({name:loc.name, tz:loc.timezone, elev:loc.elevation}));
  check(d.getElementById('dataView').style.display === 'block' && d.getElementById('emptyState').style.display === 'none', 'profile view shown after auto-load');
  const rows = w.eval('state.rows');
  check(rows && rows.length > 10, 'rows for primary model: '+(rows&&rows.length));
  check(w.eval('state.primaryModel') === 'icon_d2', 'ICON-D2 is the default primary');
  check(d.getElementById('timeLabel').textContent.includes('CEST'), 'time in local zone: '+d.getElementById('timeLabel').textContent+' / '+d.getElementById('timeLabelUtc').textContent);
  const utcRadio = d.querySelector('input[name=timeDisplay][value=utc]'); utcRadio.checked = true; utcRadio.dispatchEvent(new w.Event('change'));
  check(d.getElementById('timeLabel').textContent.endsWith('UTC') && d.getElementById('timeLabelUtc').textContent.includes('CEST'), 'UTC toggle: '+d.getElementById('timeLabel').textContent+' / '+d.getElementById('timeLabelUtc').textContent);
  check(d.querySelector('#modelList .mr-meta:last-child') && /levels/.test(d.getElementById('modelList').textContent) && /UTC/.test(d.getElementById('modelList').textContent), 'model list shows "levels" and follows the UTC toggle');
  const ltRadio = d.querySelector('input[name=timeDisplay][value=lt]'); ltRadio.checked = true; ltRadio.dispatchEvent(new w.Event('change'));
  check(d.getElementById('timeLabel').textContent.includes('CEST'), 'back to LT');
  check(d.getElementById('loadBtn').textContent === 'Loaded', 'load button shows loaded state');
  // favorites: in-app dialog, dropdown list
  d.getElementById('favBtn').click(); await sleep(60);
  check(d.getElementById('sideDialog').style.display === 'block' && d.getElementById('dialogInput').value === 'Pizol/Switzerland', 'inline save dialog in the left column with prefilled name');
  d.getElementById('dialogInput').value = 'Pizol launch site';
  Array.from(d.querySelectorAll('#dialogActions button')).find(b=>b.textContent==='Save').click(); await sleep(60);
  check(d.getElementById('sideDialog').style.display === 'none' && d.getElementById('favBtn').textContent === '★', 'place saved, star filled');
  d.getElementById('favMenuBtn').click(); await sleep(30);
  check(d.querySelectorAll('#searchResults .sr-item.fav').length === 1 && d.querySelector('#searchResults .sr-item.fav').textContent.includes('Pizol launch site'), 'saved places dropdown lists the favorite');
  d.body.click();
  d.getElementById('favBtn').click(); await sleep(60);
  Array.from(d.querySelectorAll('#dialogActions button')).find(b=>b.textContent==='Rename').click(); await sleep(60);
  d.getElementById('dialogInput').value = 'Pizol top';
  Array.from(d.querySelectorAll('#dialogActions button')).find(b=>b.textContent==='Save').click(); await sleep(60);
  check(JSON.parse(w.localStorage.getItem('sc_favorites_v1'))[0].name === 'Pizol top', 'favorite renamed via dialog');
  d.getElementById('searchInput').value = ''; d.getElementById('searchInput').dispatchEvent(new w.Event('focus')); await sleep(30);
  check(d.querySelector('#searchResults .sr-head') && d.getElementById('searchResults').style.display === 'block', 'empty search field on focus shows the saved places');
  d.querySelector('#searchResults [data-fav-remove]').click(); await sleep(60);
  Array.from(d.querySelectorAll('#dialogActions button')).find(b=>b.textContent==='Remove').click(); await sleep(60);
  check(JSON.parse(w.localStorage.getItem('sc_favorites_v1')).length === 0 && d.getElementById('favBtn').textContent === '☆', 'favorite removed after in-app confirmation');
  d.getElementById('favBtn').click(); await sleep(60);
  Array.from(d.querySelectorAll('#dialogActions button')).find(b=>b.textContent==='Save').click(); await sleep(60);
  d.body.click();

  // chips above the chart
  const chips = () => Array.from(d.querySelectorAll('#modelChips .model-chip')).map(c=>({k:c.dataset.chip, cls:c.className}));
  check(chips().length >= 10 && chips().some(c=>c.k==='icon_d2' && /primary/.test(c.cls)), chips().length+' model chips, ICON-D2 primary');
  check(!chips().some(c=>c.k==='gfs_hrrr' || c.k==='meteoswiss_icon_ch1'), 'HRRR and ICON-CH1 not offered');
  check(!d.querySelector('#modelChips [data-avg]'), 'no avg chip with a single model');
  check(d.getElementById('placeElev').textContent === '1980 m AMSL' && d.getElementById('placeCoords').textContent.includes('46.9600'), 'place card: name / coordinates / elevation on separate lines');
  d.querySelector('#modelChips [data-chip="gfs_global"]').click();
  for(let i=0;i<60 && d.getElementById('loadingOverlay').style.display !== 'none'; i++) await sleep(100);
  await sleep(200);
  check(w.eval('state.selectedModels').join(',') === 'icon_d2,gfs_global' && w.eval('state.compareFlights.length') === 1, 'GFS added as comparison via chip');
  check(chips().some(c=>c.k==='gfs_global' && /comp/.test(c.cls)), 'GFS chip styled as comparison');
  check(d.getElementById('thermoStrip').children.length === 14, '14 analytics fields in the right column');
  check(d.getElementById('diagStrip').textContent.includes('CAPE') && d.getElementById('statStrip').textContent.includes('ICON-D2'), 'diagnostics and facts strips rendered');
  check(d.getElementById('analyticalCommentsList').children.length >= 3, 'analytical comments rendered');
  check(d.getElementById('windPanelHandle').style.display === 'flex', 'wind panel handle visible');
  check(d.querySelector('header .head-actions') && !d.querySelector('.toolbar .head-actions'), 'action buttons in the header, chip row full width');
  check(Array.from(d.querySelectorAll('#rightCol .section-title'))[1].textContent.startsWith('Analytical'), 'analytical comments second in the right column');

  // avg chip
  const avgChip = d.querySelector('#modelChips [data-avg]');
  check(avgChip, 'avg chip offered with two models');
  avgChip.click(); await sleep(120);
  check(w.eval('state.renderedPrimary') === 'avg' && w.eval('state.compareFlights.length') === 2, 'avg drawn as primary, both models as comparisons');
  check(d.getElementById('statStrip').textContent.includes('Weighted mean') && /ICON-D2 \d+ %/.test(d.getElementById('statStrip').textContent), 'facts show the weights: '+(d.getElementById('statStrip').textContent.match(/ICON-D2 \d+ % · GFS \d+ %/)||[''])[0]);
  check(d.getElementById('diagStrip').textContent.includes('°C'), 'diagnostics averaged');
  d.querySelector('#modelChips [data-avg] .x').click(); await sleep(120);
  check(w.eval('state.renderedPrimary') === 'icon_d2', 'avg switched off again');

  // third model + limit of three
  d.querySelector('#modelChips [data-chip="icon_eu"]').click();
  for(let i=0;i<60 && d.getElementById('loadingOverlay').style.display !== 'none'; i++) await sleep(100);
  await sleep(150);
  d.querySelector('#modelChips [data-chip="ecmwf_ifs025"]').click();
  for(let i=0;i<60 && d.getElementById('loadingOverlay').style.display !== 'none'; i++) await sleep(100);
  await sleep(150);
  const sel = w.eval('state.selectedModels');
  check(sel.length === 3 && !sel.includes('gfs_global') && sel.includes('ecmwf_ifs025'), 'fourth model replaces the oldest comparison: '+sel.join(','));
  check(w.eval('state.compareFlights.length') === 2, 'two comparison curves drawn');

  // manual time change clears the selection and re-sorts the list
  const sl = d.getElementById('timeSlider');
  const max = parseInt(sl.max,10);
  check(max > 24*10, 'slider spans the longest horizon: max idx '+max);
  sl.value = String(parseInt(sl.min,10)+2); sl.dispatchEvent(new w.Event('input'));
  await sleep(120);
  check(w.eval('state.selectedModels').length === 0 && d.getElementById('emptyState').style.display === 'block' && d.getElementById('emptyTitle').textContent.startsWith('Choose a model'), 'time change clears the selection and asks for a model');
  check(d.querySelectorAll('#modelList input:checked').length === 0, 'model checkboxes empty');
  check(chips().length >= 10 && chips().every(c=>/avail/.test(c.cls)), 'all chips offered, none selected');
  const order = () => Array.from(d.querySelectorAll('#modelList .model-row')).map(r=>r.dataset.model);
  check(order()[0] === 'icon_d2', 'list starts with the finest applicable model: '+order().slice(0,3).join(','));
  sl.value = String(max); sl.dispatchEvent(new w.Event('input'));
  await sleep(120);
  check(order()[0] === 'gfs_global' && d.querySelector('#modelList .model-row').classList.contains('later') === false && d.querySelectorAll('#modelList .model-row')[1].classList.contains('later'), 'at the end of the horizon only GFS is applicable and on top: '+order().slice(0,4).join(','));
  check(!chips().some(c=>c.k==='icon_d2') && chips().some(c=>c.k==='gfs_global'), 'chips follow the horizon (no ICON-D2, GFS present)');
  d.querySelector('#modelChips [data-chip="gfs_global"]').click();
  await sleep(150);
  check(w.eval('state.rows') != null && w.eval('state.primaryModel') === 'gfs_global', 'picking GFS draws it as primary (already fetched, no reload)');
  d.querySelector('#dayChips [data-day="0"]').click();
  await sleep(120);
  check(w.eval('state.selectedModels').length === 0 && order()[0] === 'icon_d2', 'day chip jump clears the selection and re-sorts');
  d.querySelector('#modelChips [data-chip="icon_d2"]').click();
  await sleep(150);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  await sleep(80);
  check(w.eval('state.selectedModels').length === 0, 'arrow key also clears the selection');
  d.querySelector('#modelChips [data-chip="icon_d2"]').click();
  await sleep(150);
  // playback keeps the selection
  d.getElementById('playBtn').click();
  await sleep(1300);
  d.getElementById('playBtn').click();
  check(w.eval('state.selectedModels').join(',') === 'icon_d2' && w.eval('state.rows') != null, 'playback keeps the selection ('+w.eval('state.timeIdx')+')');
  // star in the list
  d.querySelector('#modelList [data-primary="icon_eu"]').click();
  for(let i=0;i<60 && d.getElementById('loadingOverlay').style.display !== 'none'; i++) await sleep(100);
  await sleep(150);
  check(w.eval('state.primaryModel') === 'icon_eu' && w.eval('state.selectedModels').includes('icon_eu'), 'star adds ICON-EU and makes it primary');
  check(d.getElementById('timeStripLabel').textContent.length > 8, 'time strip label: '+d.getElementById('timeStripLabel').textContent);

  // diagram radios, theta-E, settings menu, side handle
  const skew = d.querySelector('input[name=diagramType][value=skewt]'); skew.checked = true; skew.dispatchEvent(new w.Event('change'));
  await sleep(60);
  check(w.eval('state.diagramType') === 'skewt' && JSON.parse(w.localStorage.getItem('sc_settings_v1')).diagramType === 'skewt', 'diagram radio switched and persisted');
  const te = d.querySelector('input[name=thetaE][value=on]'); te.checked = true; te.dispatchEvent(new w.Event('change'));
  check(w.eval('state.showThetaE') === true, 'theta-E radio on');
  d.getElementById('settingsBtn').click();
  check(d.getElementById('settingsMenu').style.display === 'block', 'hamburger menu opens');
  d.getElementById('themeBtn').click();
  check(d.documentElement.dataset.theme === '', 'theme toggled to dark');
  d.body.click();
  check(d.getElementById('settingsMenu').style.display === 'none', 'menu closes on outside click');
  d.getElementById('sideHandle').click();
  check(d.body.classList.contains('side-collapsed'), 'side panel collapses');
  d.getElementById('sideHandle').click();
  check(!d.body.classList.contains('side-collapsed'), 'side panel reopens');

  // share link, session, export, info modal
  const url = w.eval('buildShareUrl()');
  check(/#loc=46\.96/.test(url) && /models=icon_d2%2Cicon_eu/.test(url) && /p=icon_eu/.test(url), 'share url: '+url);
  const sess = JSON.parse(w.localStorage.getItem('sc_session_v2'));
  check(sess && sess.loaded && sess.selectedModels.length === 2, 'session persisted');
  d.getElementById('exportPngBtn').click();
  d.querySelector('[data-info-key="cape"]').click();
  await sleep(30);
  check(d.getElementById('infoModalOverlay').style.display === 'flex' && d.getElementById('infoModalContent').textContent.includes('Model data note'), 'info modal opens with model note');
  d.getElementById('infoModalClose').click();
  // move the map: load button asks for a reload
  w.eval('PICK_MAP.setView([47.05, 9.45], 12)');
  await sleep(900);
  check(d.getElementById('loadBtn').textContent === 'Load' && w.eval('state.rows') != null, 'moving the map keeps the profile and re-arms the Load button');

  if(errors.length){ console.log('page errors:'); errors.forEach(e=>console.log('   ', String(e).split('\n')[0])); }
  check(errors.filter(e=>!/Not implemented|canvas|scrollIntoView/i.test(e)).length === 0, 'no page errors');
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nintegration passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
