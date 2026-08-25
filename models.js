// ---- StueveCast model catalog ----
// One entry per Open-Meteo forecast model that can deliver pressure-level
// data. Fields:
//   key        Open-Meteo `models=` identifier
//   label      short display name
//   provider   national weather service
//   gridKm     approximate horizontal grid spacing (used for sorting / default)
//   horizonH   forecast length in hours (from the model run)
//   cycleH     run cycle in hours (00, 06, 12, 18 UTC for cycleH=6, ...)
//   latencyH   typical delay between run start and availability on Open-Meteo
//   bbox       [latMin, lonMin, latMax, lonMax] coverage, or null for global
//   levels     name of the pressure-level list in LEVEL_SETS
//   noVertical true when the model is listed for information only (no pressure levels yet)
//   note       optional remark shown in the model list
//
// Grid spacing, horizons and update cycles follow the Open-Meteo model table
// (github.com/open-meteo/open-data). Latencies are estimates: Open-Meteo does
// not return the model run time in its forecast responses, so the run shown
// in the app is derived from cycle + latency, the same approach as in the
// Gasballoon Cockpit app.
const LEVEL_SETS = {
  icon:  [1000,975,950,925,900,850,800,700,600,500,400,300,250,200,150,100,70,50,30],
  mf:    [1000,950,925,900,850,800,700,600,500,400,300,250,200,150,100,70,50,30],
  gfs:   [1000,975,950,925,900,850,800,750,700,650,600,550,500,450,400,350,300,250,200,150,100,70,50,40,30,20,15,10],
  ecmwf: [1000,925,850,700,500,300,250,200,50],
  aifs:  [1000,925,850,700,600,500,400,300,250,200,100,50],
  std:   [1000,975,950,925,900,850,800,700,600,500,400,300,250,200,150,100],
};

const MODEL_CATALOG = [
  { key:'icon_d2',       label:'ICON-D2',        provider:'DWD',           gridKm:2.2, horizonH:48,  cycleH:3, latencyH:1.8, bbox:[43.18,-3.94,58.08,20.34], levels:'icon' },
  { key:'meteofrance_arome_france', label:'AROME France', provider:'Météo-France', gridKm:2.5, horizonH:51, cycleH:3, latencyH:2.6, bbox:[37.5,-12.0,55.4,16.0], levels:'mf' },
  { key:'gfs_hrrr',      label:'HRRR',           provider:'NOAA',          gridKm:3,   horizonH:48,  cycleH:1, latencyH:1.6, bbox:[21.0,-134.0,53.0,-60.0], levels:'gfs', note:'US only' },
  { key:'icon_eu',       label:'ICON-EU',        provider:'DWD',           gridKm:6.5, horizonH:120, cycleH:3, latencyH:2.4, bbox:[29.5,-23.5,70.5,62.5], levels:'icon' },
  { key:'ukmo_global_deterministic_10km', label:'UKMO global', provider:'UK Met Office', gridKm:10, horizonH:168, cycleH:6, latencyH:6.0, bbox:null, levels:'std' },
  { key:'meteofrance_arpege_europe', label:'ARPEGE Europe', provider:'Météo-France', gridKm:11, horizonH:96, cycleH:6, latencyH:3.6, bbox:[20.0,-32.0,72.0,42.0], levels:'mf' },
  { key:'icon_global',   label:'ICON global',    provider:'DWD',           gridKm:13,  horizonH:180, cycleH:6, latencyH:3.6, bbox:null, levels:'icon' },
  { key:'gem_global',    label:'GEM global',     provider:'ECCC (Canada)', gridKm:15,  horizonH:240, cycleH:12, latencyH:5.0, bbox:null, levels:'std' },
  { key:'gfs_global',    label:'GFS',            provider:'NOAA',          gridKm:25,  horizonH:384, cycleH:6, latencyH:4.0, bbox:null, levels:'gfs' },
  { key:'ecmwf_ifs025',  label:'ECMWF IFS',      provider:'ECMWF',         gridKm:25,  horizonH:360, cycleH:6, latencyH:7.0, bbox:null, levels:'ecmwf', note:'3-hourly, 9 levels' },
  { key:'ecmwf_aifs025_single', label:'ECMWF AIFS', provider:'ECMWF',      gridKm:25,  horizonH:360, cycleH:6, latencyH:7.5, bbox:null, levels:'aifs', note:'AI model, 6-hourly' },
  { key:'meteofrance_arpege_world', label:'ARPEGE world', provider:'Météo-France', gridKm:25, horizonH:96, cycleH:6, latencyH:4.5, bbox:null, levels:'mf' },
  { key:'jma_gsm',       label:'JMA GSM',        provider:'JMA',           gridKm:55,  horizonH:264, cycleH:6, latencyH:4.5, bbox:null, levels:'std', note:'6-hourly' },
  // Listed for information: high-resolution models without pressure-level
  // data on Open-Meteo (planned for v2 through a Cloudflare Worker that
  // reads the native MeteoSwiss GRIB files).
  { key:'meteoswiss_icon_ch1', label:'ICON-CH1', provider:'MeteoSwiss',    gridKm:1,   horizonH:33,  cycleH:3, latencyH:2.0, bbox:[43.0,1.0,50.5,17.0], levels:null, noVertical:true, note:'no pressure levels on Open-Meteo yet' },
  { key:'meteoswiss_icon_ch2', label:'ICON-CH2', provider:'MeteoSwiss',    gridKm:2.1, horizonH:120, cycleH:6, latencyH:2.5, bbox:[43.0,1.0,50.5,17.0], levels:null, noVertical:true, note:'no pressure levels on Open-Meteo yet' },
];

const MODEL_BY_KEY = Object.fromEntries(MODEL_CATALOG.map(m=>[m.key, m]));

// Maximum timeline length (hours): the longest horizon in the catalog.
const TIMELINE_HOURS = Math.max(...MODEL_CATALOG.filter(m=>!m.noVertical).map(m=>m.horizonH));

function modelCoversPoint(m, lat, lon){
  if(!m.bbox) return true;
  const [la0, lo0, la1, lo1] = m.bbox;
  return lat>=la0 && lat<=la1 && lon>=lo0 && lon<=lo1;
}

// Estimated start time (Date, UTC) of the newest run that should already be
// available on Open-Meteo for this model.
function estimateModelRun(m, now){
  now = now || new Date();
  const availableMs = now.getTime() - m.latencyH*3600e3;
  const cycleMs = m.cycleH*3600e3;
  const runMs = Math.floor(availableMs/cycleMs)*cycleMs;
  return new Date(runMs);
}
function estimateRunAgeHours(m, now){
  now = now || new Date();
  return (now.getTime() - estimateModelRun(m, now).getTime())/3600e3;
}
// Latest valid time (Date) the newest run is expected to cover.
function estimateModelValidUntil(m, now){
  return new Date(estimateModelRun(m, now).getTime() + m.horizonH*3600e3);
}

// Applicability of a model for a location and a target time (Date).
// Returns {ok, reason} — reason is a short label for the model list.
function modelApplicability(m, lat, lon, targetDate, now){
  if(m.noVertical) return {ok:false, reason: m.note || 'no pressure levels'};
  if(!modelCoversPoint(m, lat, lon)) return {ok:false, reason:'outside model area'};
  if(targetDate){
    const until = estimateModelValidUntil(m, now);
    if(targetDate.getTime() > until.getTime()+1800e3) return {ok:false, reason:'beyond forecast horizon'};
  }
  return {ok:true, reason:''};
}

// Default model: the finest grid among applicable models; ties broken by
// the most recent run. Returns a catalog entry or null.
function pickDefaultModel(lat, lon, targetDate, now){
  const candidates = MODEL_CATALOG.filter(m=>modelApplicability(m, lat, lon, targetDate, now).ok);
  candidates.sort((a,b)=>{
    if(a.gridKm !== b.gridKm) return a.gridKm - b.gridKm;
    return estimateRunAgeHours(a, now) - estimateRunAgeHours(b, now);
  });
  return candidates[0] || null;
}

function formatRunLabel(m, now){
  const run = estimateModelRun(m, now);
  const age = estimateRunAgeHours(m, now);
  const hh = String(run.getUTCHours()).padStart(2,'0');
  return `run ${hh}Z (${age<1 ? '<1' : Math.round(age)} h) · est.`;
}
