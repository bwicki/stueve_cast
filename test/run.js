// Node test harness for StueveCast: loads the classic scripts into a fake
// browser context, simulates the Open-Meteo API, and runs the adapter, the
// analytics and the canvas drawing code (with a recording 2D context).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

// ---------- fake DOM ----------
function fakeCtx(){
  const calls = {};
  return new Proxy({}, {
    get(t, prop){
      if(prop === 'measureText') return s => ({width: String(s).length*6});
      if(prop === 'getImageData') return () => ({data: new Uint8ClampedArray(4)});
      if(prop === 'createLinearGradient' || prop === 'createRadialGradient' || prop === 'createPattern') return () => ({addColorStop(){}});
      if(prop === 'getTransform') return () => ({a:1,b:0,c:0,d:1,e:0,f:0, transformPoint: pt => ({x:pt.x, y:pt.y}), inverse(){ return this; }});
      if(typeof prop === 'string' && !(prop in t)) t[prop] = (...a)=>{ calls[prop]=(calls[prop]||0)+1; };
      return t[prop];
    },
    set(t, prop, v){ t[prop] = v; return true; },
  });
}
const elements = {};
function el(id){
  if(elements[id]) return elements[id];
  const e = {
    id, style: {}, dataset: {}, classList: {toggle(){}, add(){}, remove(){}, contains(){return false;}},
    innerHTML: '', textContent: '', value: '0', width: 0, height: 0, clientWidth: 900, clientHeight: 520,
    listeners: {}, children: [],
    addEventListener(t, f){ (this.listeners[t] = this.listeners[t]||[]).push(f); },
    removeEventListener(){}, getContext(){ return this._ctx || (this._ctx = fakeCtx()); },
    getBoundingClientRect(){ return {left:0, top:0, width: this.clientWidth, height: this.clientHeight}; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, appendChild(){}, remove(){}, closest(){ return null; },
    setAttribute(){}, focus(){}, select(){},
  };
  e.parentElement = {clientWidth: id==='hodoCanvas' ? 360 : 900, clientHeight: 400};
  elements[id] = e;
  return e;
}
const document = {
  getElementById: el, documentElement: {dataset: {theme: 'light'}, classList: {toggle(){}, remove(){}, add(){}}},
  body: {style: {}, dataset: {}, classList: {add(){}, remove(){}}, appendChild(){}, },
  createElement(){ return el('_tmp'+Math.random()); }, querySelector(){ return null; }, querySelectorAll(){ return []; },
  addEventListener(){},
};
const storage = {};
const context = {
  console, document, window: null, navigator: {onLine: true}, performance: {now: ()=>Date.now()},
  localStorage: {getItem: k=>k in storage ? storage[k] : null, setItem: (k,v)=>{storage[k]=String(v);}, removeItem: k=>{delete storage[k];}},
  getComputedStyle: () => ({getPropertyValue: name => ({'--temp':'#c9271f','--dew':'#0f7fa0','--amber':'#b96f14'}[name] || '#888888')}),
  requestAnimationFrame: f => setTimeout(f, 0), cancelAnimationFrame: ()=>{}, setTimeout, clearTimeout, setInterval, clearInterval,
  Math, Date, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise, Intl, isFinite, parseInt, parseFloat, Infinity, NaN, encodeURIComponent, decodeURIComponent, URLSearchParams, Error, RegExp, Uint8ClampedArray,
  devicePixelRatio: 1, innerHeight: 800, innerWidth: 1000, alert: m=>console.log('ALERT', m), Proxy,
};
context.DOMPoint = function(x,y){ this.x=x; this.y=y; }; context.window = context; context.self = context; context.addEventListener = ()=>{}; context.URL = URL; context.MouseEvent = function(){}; context.File = function(){}; context.Blob = function(){};
vm.createContext(context);
function load(file){ vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, {filename: file}); }

// ---------- synthetic Open-Meteo API ----------
const KNOWN_LEVELS = [1000,950,925,900,850,800,700,600,500,400,300,250,200,150,100,70,50,30];
const KNOWN_SURFACE = new Set(['temperature_2m','relative_humidity_2m','dew_point_2m','surface_pressure','pressure_msl','wind_speed_10m','wind_direction_10m','cloud_cover','precipitation','cape','lifted_index','wind_speed_80m','wind_direction_80m','wind_speed_120m','wind_direction_120m','freezing_level_height','cloud_cover_low','cloud_cover_mid','cloud_cover_high']);
const KNOWN_LEVEL_VARS = new Set(['temperature','relative_humidity','wind_speed','wind_direction','geopotential_height','vertical_velocity']);
let apiCalls = [];
function synthResponse(url){
  const u = new URL(url);
  const vars = (u.searchParams.get('hourly')||'').split(',').filter(Boolean);
  for(const v of vars){
    const m = /^(.*)_(\d+)hPa$/.exec(v);
    if(m){ if(!KNOWN_LEVEL_VARS.has(m[1]) || !KNOWN_LEVELS.includes(+m[2])) return {error:true, reason:`Cannot initialize VariableOrDerived from invalid String value ${v} for key hourly`}; }
    else if(!KNOWN_SURFACE.has(v)) return {error:true, reason:`Cannot initialize VariableOrDerived from invalid String value ${v} for key hourly`};
  }
  const days = parseInt(u.searchParams.get('forecast_days')||'2',10);
  const n = days*24;
  const t0 = Math.floor(Date.now()/86400e3)*86400; // today 00 UTC
  const time = Array.from({length:n}, (_,i)=>t0+i*3600);
  const hourly = {time}, units = {};
  const z0 = 480, ps0 = 960;
  function level(p){ // ISA-ish reference with a warm summer boundary layer
    const z = 44330.8*(1-Math.pow(p/1013.25, 0.190263));
    return z;
  }
  for(const v of vars){
    const arr = new Array(n);
    for(let i=0;i<n;i++){
      const diurnal = 4*Math.sin((i-9)/24*2*Math.PI);
      const Tsfc = 24 + diurnal;
      const m = /^(.*)_(\d+)hPa$/.exec(v);
      if(m){
        const p = +m[2], z = level(p);
        const dz = Math.max(0, z - z0)/1000;
        const T = p >= ps0 ? Tsfc + 2 : Tsfc - 6.5*dz - (z>11000 ? 0 : 0) + (dz>1.2 && dz<1.6 ? 7 : 0); // inversion near 1.2-1.6 km AGL
        const Tclamped = z>12000 ? -56 : T;
        const rh = p>=500 ? Math.min(98, 55 + 30*Math.sin(dz)) : Math.max(5, 40 - dz*2);
        const val = {temperature: Tclamped, relative_humidity: rh, wind_speed: 2 + dz*3, wind_direction: (200 + dz*20)%360,
          geopotential_height: z, vertical_velocity: -0.05*Math.sin(dz)}[m[1]];
        arr[i] = (i >= n-6) ? null : val; // last hours missing (beyond model horizon)
      } else {
        const val = {temperature_2m: Tsfc, relative_humidity_2m: 55, dew_point_2m: Tsfc-9.4, surface_pressure: ps0, pressure_msl: ps0+56,
          wind_speed_10m: 2.5, wind_direction_10m: 210, cloud_cover: 35, precipitation: 0, cape: 420, lifted_index: -1.8,
          wind_speed_80m: 4, wind_direction_80m: 215, wind_speed_120m: 5, wind_direction_120m: 220, freezing_level_height: 3400,
          cloud_cover_low: 10, cloud_cover_mid: 20, cloud_cover_high: 30}[v];
        arr[i] = (i >= n-6) ? null : val;
      }
    }
    hourly[v] = arr; units[v] = /vertical_velocity/.test(v) ? 'Pa/s' : '';
  }
  return {latitude: 47.38, longitude: 8.54, elevation: z0, utc_offset_seconds: 0, timezone: 'UTC', timezone_abbreviation: 'GMT', hourly, hourly_units: units};
}
context.fetch = async (url) => {
  apiCalls.push(url);
  const j = synthResponse(url);
  return {ok: !j.error, status: j.error ? 400 : 200, json: async () => j};
};

// ---------- load app scripts (without app.js, which needs Leaflet) ----------
['js/core.js','js/info.js','js/models.js','js/openmeteo.js','js/draw.js','js/analytics.js'].forEach(load);
// helpers the chart code expects from app.js
vm.runInContext('function updateAltRangeFill(){}', context);

(async () => {
  const S = context;
  const G = expr => vm.runInContext(expr, context);
  const MODEL_BY_KEY = G('MODEL_BY_KEY'), OpenMeteo = G('OpenMeteo'), state = G('state'), FIELD_INFO = G('FIELD_INFO'), FIELD_MODEL_NOTES = G('FIELD_MODEL_NOTES');
  let failures = 0;
  const check = (cond, msg) => { if(cond) console.log('  ok   ' + msg); else { failures++; console.log('  FAIL ' + msg); } };

  console.log('1) model catalog');
  const lat = 47.38, lon = 8.54, now = new Date();
  const def = S.pickDefaultModel(lat, lon, new Date(now.getTime()+6*3600e3), now);
  check(def && def.key === 'icon_d2', 'default for Zürich +6 h is ICON-D2 (got '+(def&&def.key)+')');
  const def3d = S.pickDefaultModel(lat, lon, new Date(now.getTime()+72*3600e3), now);
  check(def3d && def3d.key === 'icon_eu', 'default for +72 h is ICON-EU (got '+(def3d&&def3d.key)+')');
  const def10d = S.pickDefaultModel(lat, lon, new Date(now.getTime()+10*86400e3), now);
  check(def10d && ['gem_global','gfs_global','ecmwf_ifs025','ecmwf_aifs025_single','jma_gsm'].includes(def10d.key), 'default for +10 d is a global model (got '+(def10d&&def10d.key)+')');
  check(!S.modelApplicability(MODEL_BY_KEY.gfs_hrrr, lat, lon).ok, 'HRRR not applicable in Europe');
  check(!S.modelApplicability(MODEL_BY_KEY.meteoswiss_icon_ch1, lat, lon).ok, 'ICON-CH1 listed but not applicable');

  console.log('2) fetch with pruning (synthetic API rejects 975 hPa and unknown extras)');
  const meta = MODEL_BY_KEY.icon_d2;
  const md = await OpenMeteo.fetchModel(meta, lat, lon, ()=>{});
  check(md.levels.length === 18 && !md.levels.includes(975), 'pruned to 18 levels without 975 hPa (got '+md.levels.length+')');
  check(apiCalls.length >= 3, 'used retries: '+apiCalls.length+' requests');
  const cached = JSON.parse(storage['sc_vars_v1_icon_d2']);
  check(cached.levels.length === 18 && cached.droppedExtras.length > 0, 'pruned variable lists cached: dropped extras = '+cached.droppedExtras.join(','));
  apiCalls = [];
  const md2 = await OpenMeteo.fetchModel(meta, lat, lon, ()=>{});
  check(apiCalls.length === 2, 'second fetch needs only 2 requests (got '+apiCalls.length+')');
  check(md2.validRange[0] === 0 && md2.validRange[1] === md2.n-7, 'valid range excludes missing tail hours: '+md2.validRange.join('-')+' of '+md2.n);

  console.log('3) adapter -> S2 rows');
  const rows = OpenMeteo.buildRows(md2, 14);
  check(rows && rows.length > 15, 'rows built: '+(rows&&rows.length));
  check(rows[0][12] === 'sfc' && Math.abs(rows[0][2]-960) < 1e-6, 'row 0 is the 2 m surface point at 960 hPa');
  check(!rows.some(r=>r[12]==='lvl' && r[2] >= 959), '1000 hPa (below ground) dropped');
  check(rows.some(r=>r[12]==='agl'), '80/120 m wind rows inserted');
  check(rows.every((r,i)=>i===0 || r[1] > rows[i-1][1]), 'heights strictly increasing');
  check(rows.every(r=>r[5] <= r[3]+1e-6), 'dew point never above temperature');
  check(rows.every(r=>r[6]!=null && r[7]!=null), 'wind on every row');
  check(rows.some(r=>r[10]!=null), 'vertical velocity present');
  const sfc = OpenMeteo.surfaceAt(md2, 14);
  check(sfc.cape === 420 && sfc.freezing_level_height === 3400, 'surface diagnostics read back');
  check(OpenMeteo.buildRows(md2, md2.n-2) === null, 'no rows beyond the model horizon');

  console.log('4) analytics on coarse rows');
  state.rows = rows;
  const t = S.computeThermo(rows);
  check(t && isFinite(t.cape) && t.lcl.p < 960, 'computeThermo ok: CAPE '+Math.round(t.cape)+' J/kg, LCL '+Math.round(t.lcl.p)+' hPa, LFC '+(t.lfcP?Math.round(t.lfcP):'none'));
  const ctx = S.buildAnalyticsCtx(rows);
  check(ctx && ctx.k!=null && ctx.pw>0, 'K-index '+Math.round(ctx.k)+', PW '+ctx.pw.toFixed(1)+' mm, cloud '+ctx.cloudPct+' %, shear '+(ctx.shearKt&&ctx.shearKt.toFixed(0))+' kt');
  const inv = S.detectInversions(rows), iso = S.detectIsothermalLayers(rows);
  check(inv.length >= 1, 'inversion detected on coarse levels: '+JSON.stringify(inv));
  console.log('  info isothermal layers: '+JSON.stringify(iso));
  const comments = S.computeAnalyticalComments(rows, ctx);
  check(comments.length === 3, 'three analytical comments: '+comments.map(c=>c.level).join('/'));
  S.renderThermo(rows);
  const strip = S.document.getElementById('thermoStrip').innerHTML;
  check(strip.includes('data-info-key="lcl"') && strip.includes('Tropopause'), 'renderThermo produced the 14 fields');
  check(Object.keys(FIELD_INFO).length >= 15 && Object.keys(FIELD_MODEL_NOTES).length === 15, 'FIELD_INFO + model notes present');
  S.openInfoModal('cape');
  check(S.document.getElementById('infoModalContent').innerHTML.includes('Model data note'), 'info modal includes model note');

  console.log('5) drawing with a fake canvas (runtime errors only)');
  state.compareFlights = [{rows: OpenMeteo.buildRows(md2, 15), source: 'AROME', key: 'x'}];
  for(const dt of ['stuve','emagram','skewt']){
    state.diagramType = dt;
    let err = null;
    try{ S.renderLegend(); S.draw(rows); S.drawHodograph(S.getZoomedRows()); S.drawMiniProfile('riseCanvas','riseCard', S.getZoomedRows(), r=>r[10], '#e0a83f', 2); S.drawMiniProfile('thetaECanvas','thetaECard', S.getZoomedRows(), r=>S.thetaE(r[3], r[5], r[2]), '#c76bd1', 0); }
    catch(e){ err = e; }
    check(!err, 'draw pipeline runs in '+dt+' mode'+(err ? ': '+err.stack.split('\n').slice(0,2).join(' | ') : ''));
  }
  state.diagramType = 'stuve';
  // compact layout
  S.document.getElementById('chart').parentElement.clientWidth = 380;
  let err = null; try{ S.draw(rows); }catch(e){ err = e; }
  check(!err && G('PLOT').compact === true && G('PLOT').pad.left === 80, 'compact layout at 380 px width'+(err?': '+err.message:''));
  state.viewMinPct = 100; state.viewMaxPct = 600;
  try{ S.draw(rows); S.drawHodograph(S.getZoomedRows()); }catch(e){ err = e; }
  check(!err, 'zoomed altitude band draws');
  try{ S.chartInspectAt(200, 200); S.chartInspectEnd(); }catch(e){ err = e; }
  check(!err, 'inspect routine runs'+(err?': '+err.message:''));
  state.altitudeUnit = 'fl'; state.transitionAltFt = 7000;
  try{ S.draw(rows); S.renderThermo(rows); }catch(e){ err = e; }
  check(!err, 'flight-level axis draws');

  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
