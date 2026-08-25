// ---- StueveCast: Open-Meteo access and the model -> S2 rows adapter ----
//
// Everything the chart and analytics code consumes is the S2 row format:
//   [timeStr, altMSL_m, p_hPa, T_C, RH_pct, Td_C, windSpeed_ms|null,
//    windHeading_deg|null, lat, lon, verticalVelocity|null, interpFlag, kind]
// kind: 'sfc' (2 m surface point), 'lvl' (pressure level), 'agl' (80/120/180 m
// wind level, temperature interpolated). windHeading is the direction the air
// moves TO (S2 convention from the drifting sonde); windFromDeg() converts it
// back to the meteorological "from" direction.

const OpenMeteo = (function(){
  const CORE_SURFACE = ['temperature_2m','relative_humidity_2m','dew_point_2m','surface_pressure','pressure_msl',
                        'wind_speed_10m','wind_direction_10m','cloud_cover','precipitation'];
  const EXTRA_SURFACE = ['wind_gusts_10m','cloud_cover_low','cloud_cover_mid','cloud_cover_high','cape','lifted_index',
                         'convective_inhibition','freezing_level_height','boundary_layer_height',
                         'wind_speed_80m','wind_direction_80m','wind_speed_120m','wind_direction_120m',
                         'wind_speed_180m','wind_direction_180m'];
  const LEVEL_VARS = ['temperature','relative_humidity','wind_speed','wind_direction','geopotential_height'];
  const LEVEL_EXTRA_VARS = ['vertical_velocity'];
  const VARS_CACHE_PREFIX = 'sc_vars_v1_';
  const CALLS_KEY = 'sc_om_calls_v1';

  function storageGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function storageSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }

  function base(){ return state.apiKey ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'; }
  function keyParam(){ return state.apiKey ? '&apikey='+encodeURIComponent(state.apiKey) : ''; }

  // Daily call counter (informational; the free tier allows 10,000 calls a
  // day and a request with many variables counts as several calls).
  function trackCall(){
    const today = new Date().toISOString().slice(0,10);
    let rec = {day: today, count: 0};
    try{ const j = JSON.parse(storageGet(CALLS_KEY)||'null'); if(j && j.day===today) rec = j; }catch(e){}
    rec.count += 1;
    storageSet(CALLS_KEY, JSON.stringify(rec));
    return rec.count;
  }
  function callsToday(){
    try{ const j = JSON.parse(storageGet(CALLS_KEY)||'null'); if(j && j.day===new Date().toISOString().slice(0,10)) return j.count; }catch(e){}
    return 0;
  }

  async function fetchJson(url, opts){
    trackCall();
    const r = await fetch(url, opts);
    let j = null;
    try{ j = await r.json(); }catch(e){ j = null; }
    if(!j){ throw new Error(`HTTP ${r.status} from Open-Meteo`); }
    return j;
  }

  // Requests `hourly` variables and removes variables the model does not
  // support until the request succeeds. Open-Meteo answers such requests with
  // {error:true, reason:"... invalid String value <variable> ..."}; the whole
  // pressure level is dropped when a level variable is named.
  async function fetchHourlyPruning(baseUrl, vars, maxTries){
    let list = vars.slice();
    const dropped = [];
    for(let attempt=0; attempt<(maxTries||14) && list.length; attempt++){
      const j = await fetchJson(baseUrl + '&hourly=' + list.join(','));
      if(!j.error) return {json: j, vars: list, dropped};
      const m = /invalid String value ([a-z0-9_]+)/i.exec(j.reason||'');
      if(!m) throw new Error(j.reason || 'Open-Meteo request failed');
      const bad = m[1];
      const lvl = /^(.*)_(\d+)hPa$/.exec(bad);
      if(lvl && (lvl[1]==='vertical_velocity')){
        list = list.filter(v=>!v.startsWith('vertical_velocity_'));
        dropped.push('vertical_velocity_*');
      } else if(lvl){
        list = list.filter(v=>!v.endsWith('_'+lvl[2]+'hPa'));
        dropped.push('*_'+lvl[2]+'hPa');
      } else {
        list = list.filter(v=>v!==bad);
        dropped.push(bad);
      }
    }
    if(!list.length) return {json:null, vars:[], dropped};
    throw new Error('Open-Meteo kept rejecting variables for this model');
  }

  function cachedVars(modelKey){
    try{ return JSON.parse(storageGet(VARS_CACHE_PREFIX+modelKey)||'null'); }catch(e){ return null; }
  }
  function saveVars(modelKey, rec){ storageSet(VARS_CACHE_PREFIX+modelKey, JSON.stringify(rec)); }

  function forecastDaysFor(meta){
    return Math.max(2, Math.min(16, Math.ceil(meta.horizonH/24)+2));
  }

  // Fetches one model for a location. Returns the model record used by the
  // adapter. Two requests: the essential one (surface + pressure levels) and
  // an "extras" one whose failure is not fatal.
  async function fetchModel(meta, lat, lon, onProgress){
    const key = meta.key;
    const cache = cachedVars(key) || {};
    const levelsWanted = (cache.levels && cache.levels.length) ? cache.levels : LEVEL_SETS[meta.levels].slice();
    const surfaceWanted = CORE_SURFACE.filter(v=>!(cache.droppedSurface||[]).includes(v));
    const days = forecastDaysFor(meta);
    const common = `${base()}/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&models=${key}`+
                   `&forecast_days=${days}&timezone=UTC&timeformat=unixtime&wind_speed_unit=ms${keyParam()}`;

    const coreVars = surfaceWanted.concat(levelsWanted.flatMap(p=>LEVEL_VARS.map(v=>`${v}_${p}hPa`)));
    if(onProgress) onProgress(`${meta.label}: requesting profile levels…`);
    const core = await fetchHourlyPruning(common, coreVars);
    if(!core.json) throw new Error(`${meta.label}: no usable variables`);
    const H = Object.assign({}, core.json.hourly);
    const units = Object.assign({}, core.json.hourly_units);
    // levels actually delivered (arrays that are null throughout are treated as absent)
    const levels = levelsWanted.filter(p=>{ const a = H[`temperature_${p}hPa`]; return a && a.some(v=>v!=null); });
    const droppedSurface = CORE_SURFACE.filter(v=>!core.vars.includes(v));

    // extras: model diagnostics, extra wind levels, vertical velocity
    let extrasDropped = cache.droppedExtras || [];
    const extraVars = EXTRA_SURFACE.filter(v=>!extrasDropped.includes(v))
      .concat(extrasDropped.includes('vertical_velocity_*') ? [] :
        levels.filter(p=>p>=100).flatMap(p=>LEVEL_EXTRA_VARS.map(v=>`${v}_${p}hPa`)));
    if(extraVars.length){
      if(onProgress) onProgress(`${meta.label}: requesting model diagnostics…`);
      try{
        const ex = await fetchHourlyPruning(common, extraVars, 20);
        if(ex.json){
          // align on time in case a day rolled over between the two requests
          const shift = Math.round((ex.json.hourly.time[0] - H.time[0])/3600);
          Object.keys(ex.json.hourly).forEach(v=>{
            if(v==='time') return;
            let arr = ex.json.hourly[v];
            if(shift>0) arr = new Array(shift).fill(null).concat(arr);
            else if(shift<0) arr = arr.slice(-shift);
            H[v] = arr.slice(0, H.time.length);
          });
          Object.assign(units, ex.json.hourly_units);
        }
        extrasDropped = extrasDropped.concat(ex.dropped);
      }catch(e){
        console.warn('extras request failed for', key, e);
      }
    }
    saveVars(key, {levels, droppedSurface, droppedExtras: Array.from(new Set(extrasDropped))});

    const n = H.time.length;
    let first = -1, last = -1;
    const probes = [H.temperature_2m, H[`temperature_${levels[0]}hPa`], H['temperature_500hPa']].filter(Boolean);
    for(let i=0;i<n;i++){ if(probes.some(a=>a[i]!=null)){ if(first<0) first=i; last=i; } }
    return {
      key, meta, lat, lon,
      elevation: core.json.elevation,
      t0: H.time[0], n, hourly: H, units, levels,
      validRange: [first, last],
      fetchedAt: Date.now(),
      offset: 0,
    };
  }

  // ---------- Adapter: model record + hour index -> S2 rows ----------
  const RD = 287.05, G = 9.80665;
  function hypsoUp(zA, pA, pB, TA_C, TB_C){
    const Tm = ((TA_C+TB_C)/2) + 273.15;
    return zA + (RD*Tm/G)*Math.log(pA/pB);
  }
  function timeStr(unix){
    const d = new Date(unix*1000);
    return d.toISOString().slice(0,16).replace('T',' ');
  }
  function val(H, name, i){
    const a = H[name];
    if(!a) return null;
    const v = a[i];
    return (v==null || !isFinite(v)) ? null : v;
  }

  function buildRows(md, timelineIdx){
    const H = md.hourly;
    const i = timelineIdx - md.offset;
    if(i<0 || i>=md.n) return null;
    const ts = timeStr(H.time[i]);
    const lat = md.lat, lon = md.lon;
    const rows = [];

    const ps = val(H,'surface_pressure',i);
    const T2 = val(H,'temperature_2m',i), RH2 = val(H,'relative_humidity_2m',i);
    let Td2 = val(H,'dew_point_2m',i);
    if(Td2==null && T2!=null && RH2!=null) Td2 = magnusDewpoint(T2, RH2);
    const z0 = md.elevation!=null ? md.elevation : null;
    const ws10 = val(H,'wind_speed_10m',i), wd10 = val(H,'wind_direction_10m',i);
    if(ps!=null && T2!=null && RH2!=null && z0!=null){
      rows.push([ts, z0, ps, T2, RH2, Td2, ws10, wd10!=null ? (wd10+180)%360 : null, lat, lon, null, false, 'sfc']);
    }

    // pressure levels above the surface
    const lvlRows = [];
    for(const p of md.levels){
      const T = val(H,`temperature_${p}hPa`,i);
      const RH = val(H,`relative_humidity_${p}hPa`,i);
      if(T==null || RH==null) continue;
      if(ps!=null && p >= ps-1) continue;           // below (or at) model ground
      const z = val(H,`geopotential_height_${p}hPa`,i);
      const ws = val(H,`wind_speed_${p}hPa`,i), wd = val(H,`wind_direction_${p}hPa`,i);
      const w = val(H,`vertical_velocity_${p}hPa`,i);
      lvlRows.push([ts, z, p, T, Math.max(0, Math.min(100, RH)), magnusDewpoint(T, RH),
        ws, wd!=null ? (wd+180)%360 : null, lat, lon, w, false, 'lvl']);
    }
    lvlRows.sort((a,b)=>b[2]-a[2]); // descending pressure = ascending height
    if(!rows.length && !lvlRows.length) return null;

    // hypsometric fill for levels without geopotential height
    let all = rows.concat(lvlRows);
    let ref = null; // last row with a known height
    for(const r of all){
      if(r[1]!=null){ ref = r; continue; }
      if(ref){ r[1] = hypsoUp(ref[1], ref[2], r[2], ref[3], r[3]); ref = r; }
    }
    // no known height at all below the first level: ISA start, then walk up
    if(all.length && all[0][1]==null){
      all[0][1] = 44330.8*(1-Math.pow(all[0][2]/1013.25, 0.190263));
      ref = all[0];
      for(let k=1;k<all.length;k++){ if(all[k][1]==null){ all[k][1] = hypsoUp(ref[1], ref[2], all[k][2], ref[3], all[k][3]); } ref = all[k]; }
    }
    // guard against non-monotonic heights (data glitches): drop offenders
    all = all.filter((r,k)=>k===0 || r[1] > all[k-1][1]);

    // 80/120/180 m wind levels (ICON, GFS): temperature/humidity interpolated
    // in height between the neighbouring rows so the S2 row stays complete.
    if(rows.length && z0!=null){
      [80,120,180].forEach(h=>{
        const ws = val(H,`wind_speed_${h}m`,i), wd = val(H,`wind_direction_${h}m`,i);
        if(ws==null || wd==null) return;
        const z = z0 + h;
        let lo=null, hi=null;
        for(let k=0;k<all.length-1;k++){ if(all[k][1] <= z && all[k+1][1] > z){ lo=all[k]; hi=all[k+1]; break; } }
        if(!lo || !hi) return;
        const f = (z-lo[1])/((hi[1]-lo[1])||1);
        const T = lo[3]+(hi[3]-lo[3])*f, RH = lo[4]+(hi[4]-lo[4])*f;
        const p = lo[2]*Math.exp(-(z-lo[1])*G/(RD*(T+273.15)));
        all.push([ts, z, p, T, RH, magnusDewpoint(T, RH), ws, (wd+180)%360, lat, lon, null, false, 'agl']);
      });
      all.sort((a,b)=>a[1]-b[1]);
    }
    return all.length >= 3 ? all : null;
  }

  // Surface / diagnostic values of the model for one hour (for the readout).
  function surfaceAt(md, timelineIdx){
    const i = timelineIdx - md.offset;
    if(i<0 || i>=md.n) return null;
    const H = md.hourly, o = {};
    ['temperature_2m','dew_point_2m','relative_humidity_2m','surface_pressure','pressure_msl','wind_speed_10m',
     'wind_direction_10m','wind_gusts_10m','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high',
     'precipitation','cape','lifted_index','convective_inhibition','freezing_level_height','boundary_layer_height']
      .forEach(v=>{ const x = val(H,v,i); if(x!=null) o[v]=x; });
    return o;
  }

  function hasDataAt(md, timelineIdx){
    const i = timelineIdx - md.offset;
    if(i<0 || i>=md.n) return false;
    return i>=md.validRange[0] && i<=md.validRange[1];
  }

  // ---------- Location services ----------
  async function geocode(query){
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
    const j = await fetchJson(url);
    return (j.results||[]).map(r=>({
      name: r.name, admin: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude, lon: r.longitude, elevation: r.elevation, timezone: r.timezone,
    }));
  }
  // Elevation, time zone and UTC offset for a point (one cheap forecast call).
  async function locationInfo(lat, lon){
    const url = `${base()}/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=temperature_2m&forecast_days=1&timezone=auto${keyParam()}`;
    const j = await fetchJson(url);
    if(j.error) throw new Error(j.reason);
    return {elevation: j.elevation, timezone: j.timezone, utcOffsetSec: j.utc_offset_seconds, tzAbbr: j.timezone_abbreviation};
  }
  async function reverseGeocode(lat, lon){
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}&zoom=12&format=jsonv2`;
    const r = await fetch(url, {headers:{'Accept-Language':'en'}});
    if(!r.ok) throw new Error('reverse geocoding failed');
    const j = await r.json();
    const a = j.address || {};
    const place = a.village || a.hamlet || a.town || a.city || a.municipality || a.locality || a.county || j.name || '';
    const region = a.state || a.region || a.country || '';
    return place ? (region ? `${place}, ${region}` : place) : (j.display_name||'').split(',').slice(0,2).join(',');
  }

  return {fetchModel, buildRows, surfaceAt, hasDataAt, geocode, locationInfo, reverseGeocode, callsToday,
          CORE_SURFACE, EXTRA_SURFACE, LEVEL_VARS};
})();
