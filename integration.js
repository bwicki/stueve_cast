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
  if(u.hostname === 'nominatim.openstreetmap.org') return {address:{village:'Bad Ragaz', state:'Sankt Gallen'}};
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
    window.navigator.geolocation = {getCurrentPosition(ok){ ok({coords:{latitude:46.96, longitude:9.39}}); }};
    window.alert = m => errors.push('ALERT '+m);
    window.prompt = () => 'Test place';
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
  check(typeof w.state === 'object' || w.eval('typeof state') === 'object', 'scripts loaded, state exists');
  check(d.body.dataset.screen === 'location', 'starts on the location screen');
  check(w.eval('PICK_MAP') != null, 'Leaflet map initialised');

  // search and pick a place
  d.getElementById('searchInput').value = 'Pizol';
  d.getElementById('searchInput').dispatchEvent(new w.Event('input'));
  await sleep(500);
  const item = d.querySelector('.sr-item');
  check(item, 'search results rendered');
  item.click();
  await sleep(900);
  const loc = w.eval('state.location');
  check(loc && loc.name && loc.name.startsWith('Pizol') && loc.timezone === 'Europe/Zurich' && loc.elevation === 1980, 'place resolved: '+JSON.stringify({name:loc.name, tz:loc.timezone, elev:loc.elevation}));
  check(d.getElementById('timeSummary').textContent.includes('CEST'), 'time picker in local time: '+d.getElementById('timeSummary').textContent);
  d.getElementById('favBtn').click();
  check(d.querySelectorAll('#favList .chip').length === 1, 'favorite saved');

  // models
  d.getElementById('chooseModelsBtn').click();
  await sleep(50);
  check(d.body.dataset.screen === 'models', 'models screen shown');
  const checked = Array.from(d.querySelectorAll('#modelList input:checked')).map(i=>i.dataset.model);
  check(checked.length === 1 && checked[0] === 'icon_d2', 'ICON-D2 preselected: '+checked.join(','));
  check(d.querySelector('input[data-model="meteoswiss_icon_ch1"]').disabled, 'ICON-CH1 listed disabled');
  const gfs = d.querySelector('input[data-model="gfs_global"]'); gfs.checked = true; gfs.dispatchEvent(new w.Event('change'));
  check(w.eval('state.selectedModels').join(',') === 'icon_d2,gfs_global', 'GFS added as comparison');

  // profile
  d.getElementById('showProfileBtn').click();
  for(let i=0;i<40 && d.getElementById('loadingOverlay').style.display !== 'none'; i++) await sleep(100);
  await sleep(200);
  check(d.body.dataset.screen === 'profile', 'profile screen shown');
  check(d.getElementById('loadingOverlay').style.display === 'none', 'loading finished');
  const rows = w.eval('state.rows');
  check(rows && rows.length > 10, 'rows for primary model: '+(rows&&rows.length));
  check(w.eval('state.compareFlights.length') === 1, 'comparison model drawn');
  check(d.getElementById('thermoStrip').children.length === 14, '14 analytics fields');
  check(d.getElementById('statStrip').textContent.includes('ICON-D2'), 'profile facts show the model');
  check(d.getElementById('analyticalCommentsList').children.length >= 3, 'analytical comments rendered');
  check(d.getElementById('scrubberReadout').textContent.includes('CAPE'), 'hour readout rendered');
  check(d.getElementById('timeLabel').textContent.includes('CEST'), 'time label local: '+d.getElementById('timeLabel').textContent+' / '+d.getElementById('timeLabelUtc').textContent);
  check(d.querySelectorAll('#modelChips .model-chip').length === 2, 'model chips rendered');
  check(d.getElementById('windPanelHandle').style.display === 'flex', 'wind panel handle visible');
  check(d.getElementById('hodoCard').style.display === 'block', 'hodograph shown');

  // move the slider to the end: ICON-D2 runs out, GFS must take over
  const sl = d.getElementById('timeSlider');
  const max = parseInt(sl.max,10);
  check(max > 24*10, 'slider spans the GFS horizon: max idx '+max);
  sl.value = String(max); sl.dispatchEvent(new w.Event('input'));
  await sleep(100);
  check(w.eval('state.rows') && d.getElementById('profileNotice').style.display === 'block' && d.getElementById('profileNotice').textContent.includes('GFS'), 'fallback to GFS beyond ICON-D2 horizon: '+d.getElementById('profileNotice').textContent);
  check(d.querySelector('#modelChips .model-chip.nodata'), 'ICON-D2 chip marked as no data');

  // step back and keyboard
  sl.value = String(parseInt(sl.min,10)+5); sl.dispatchEvent(new w.Event('input'));
  await sleep(60);
  d.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
  await sleep(60);
  check(w.eval('state.timeIdx') === parseInt(sl.min,10)+6, 'arrow key steps the hour');

  // settings sheet and diagram switch
  d.getElementById('settingsBtn').click();
  d.getElementById('diagramTypeSelect').value = 'skewt'; d.getElementById('diagramTypeSelect').dispatchEvent(new w.Event('change'));
  await sleep(60);
  check(w.eval('state.diagramType') === 'skewt' && JSON.parse(w.localStorage.getItem('sc_settings_v1')).diagramType === 'skewt', 'diagram type switched and persisted');
  d.getElementById('themeBtn').click();
  check(d.documentElement.dataset.theme === '', 'theme toggled to dark');
  d.getElementById('settingsClose').click();

  // share link + reload from hash
  const url = w.eval('buildShareUrl()');
  check(/#loc=46\.96/.test(url) && /models=icon_d2%2Cgfs_global/.test(url), 'share url: '+url);
  const sess = JSON.parse(w.localStorage.getItem('sc_session_v1'));
  check(sess && sess.selectedModels.length === 2, 'session persisted');

  // export + info modal
  d.getElementById('exportPngBtn').click();
  d.querySelector('[data-info-key="cape"]').click();
  await sleep(30);
  check(d.getElementById('infoModalOverlay').style.display === 'flex' && d.getElementById('infoModalContent').textContent.includes('Model data note'), 'info modal opens with model note');
  d.getElementById('infoModalClose').click();

  // back to location, keep state
  d.getElementById('profileBackBtn').click();
  check(d.body.dataset.screen === 'location', 'back to the location screen');

  if(errors.length){ console.log('page errors:'); errors.forEach(e=>console.log('   ', String(e).split('\n')[0])); }
  check(errors.filter(e=>!/Not implemented|canvas|scrollIntoView/i.test(e)).length === 0, 'no page errors');
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nintegration passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
