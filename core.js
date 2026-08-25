// ---- StueveCast core: physics, indices, unit helpers, wind helpers (ported from the S2 Radiosonde Sounding Diagram tool) ----

// Shared application state. The chart/analytics code (ported from S2) reads
// the S2 fields; the StueveCast-specific fields are documented inline.
const state = {
  // ---- S2 chart/analytics state ----
  rows: null,                 // primary model profile at the selected hour (S2 row format)
  compareFlights: [],         // other selected models at the same hour: [{rows, source}]
  windSmoothed: false,        // model winds are already smooth — no time-window smoothing
  barbIntervalSec: 0,         // one barb per model level
  scrubIdx: null,             // (S2 ascent scrubber — unused, kept for the chart code)
  diagramType: 'stuve',
  viewMinPct: 0, viewMaxPct: 1000,
  showThetaE: false, cloudThreshold: 85,
  speedPanelWidth: null,      // wind-speed panel width in CSS px (null = automatic)
  altitudeUnit: 'amsl', windDisplayMode: 'barb', printWithPanels: true,
  transitionAltFt: null, transitionAltConfirmed: false, speedUnit: 'kmh',
  showLevelDots: true,
  // ---- StueveCast state ----
  location: null,             // {lat, lon, name, elevation, timezone, utcOffsetSec}
  timeline: null,             // {t0: unix seconds of hour 0, hours: number}
  timeIdx: null,              // selected hour index on the timeline
  selectedModels: [],         // model keys in display order (first = primary unless primaryModel set)
  primaryModel: null,
  modelData: {},              // key -> fetched/adapted model record (see openmeteo.js)
  apiKey: null,               // optional Open-Meteo commercial key
};
const COMPARE_COLORS = [
  {temp:'#d1770f', dew:'#3fae7a'},
  {temp:'#c9367a', dew:'#5a7fd6'},
  {temp:'#8a5fd6', dew:'#4f9f4f'},
];
const MAX_COMPARE = COMPARE_COLORS.length;
let printMode = false;

function parseCsvTime(s){ return Date.parse(String(s).replace(' ','T')+'Z')/1000; }
function magnusDewpoint(T, RH){
  const rh = Math.min(100, Math.max(1, RH));
  const a=17.62,b=243.12;
  const alpha = Math.log(rh/100) + (a*T)/(b+T);
  return (b*alpha)/(a-alpha);
}

const KAPPA = 0.286, P0 = 1000;
function yOf(pHpa){
  return (state.diagramType === 'emagram' || state.diagramType === 'skewt')
    ? Math.log(pHpa/P0) : Math.pow(pHpa/P0, KAPPA);
}
function pOf(y){
  return (state.diagramType === 'emagram' || state.diagramType === 'skewt')
    ? Math.exp(y)*P0 : Math.pow(y,1/KAPPA)*P0;
}
// Interpolates the actual measured altitude (m MSL) at a given pressure from
// the real sounding data (more accurate than a standard-atmosphere formula,
// since real conditions differ from ISA). Extrapolates a short distance
// above the highest data point (using the barometric formula with the
// measured top-of-sounding temperature) so the axis labels also cover the
// small headroom band above the profile.
function altitudeAtPressure(rows, pHpa){
  for(let i=0;i<rows.length-1;i++){
    const pA=rows[i][2], pB=rows[i+1][2];
    if((pHpa<=pA && pHpa>=pB) || (pHpa>=pA && pHpa<=pB)){
      const f = (pA-pHpa)/((pA-pB)||1e-9);
      return rows[i][1] + f*(rows[i+1][1]-rows[i][1]);
    }
  }
  const top = rows[rows.length-1];
  if(pHpa < top[2]){
    const topTK = top[3]+273.15;
    const scaleHeight = 287.05*topTK/9.80665;
    return top[1] - scaleHeight*Math.log(pHpa/top[2]);
  }
  return null;
}

// Inverse of altitudeAtPressure: interpolates pressure at a given target
// altitude (m MSL) from the real sounding data. Used to place the
// transition-altitude marker on the Y axis.
function pressureAtAltitude(rows, targetAltM){
  for(let i=0;i<rows.length-1;i++){
    const aA=rows[i][1], aB=rows[i+1][1];
    if((targetAltM<=aA && targetAltM>=aB) || (targetAltM>=aA && targetAltM<=aB)){
      const f = (targetAltM-aA)/((aB-aA)||1e-9);
      return rows[i][2] + f*(rows[i+1][2]-rows[i][2]);
    }
  }
  return null;
}

// ---------- Altitude unit conversion/formatting ----------
// unit: 'amsl' | 'agl' | 'ft' | 'fl'. groundAltM is the launch-site
// elevation (m MSL), needed for the AGL conversion.
function formatAltitudeValue(altM, groundAltM, unit){
  if(altM==null) return null;
  switch(unit){
    case 'agl': return Math.round(altM - (groundAltM||0));
    case 'ft': return Math.round(altM*3.28084);
    case 'fl': return Math.round(altM*3.28084/100);
    default: return Math.round(altM); // amsl
  }
}
function altitudeUnitSuffix(unit){
  switch(unit){
    case 'agl': return ' m AGL';
    case 'ft': return ' ft AMSL';
    case 'fl': return ''; // FL### already encodes the unit
    default: return ' m AMSL';
  }
}
// Estimates a transition altitude (ft) for the launch site from its ground
// elevation. This is a rough heuristic, not a lookup against actual
// published airspace/AIP boundaries — Switzerland's real transition
// altitudes vary by TMA/CTR (commonly 5000 ft in lowland areas, up to
// 7000 ft or FL100 in Alpine/complex sectors) and can only be confirmed
// from the current AIP. The value is always shown to the user for
// confirmation/adjustment before use (see confirmTransitionAltitude()).
function estimateTransitionAltFt(groundAltM){
  if(groundAltM == null) return 5000;
  if(groundAltM > 1800) return 10000;
  if(groundAltM > 1000) return 7000;
  return 5000;
}

function formatAltitude(altM, groundAltM){
  const unit = state.altitudeUnit || 'amsl';
  const v = formatAltitudeValue(altM, groundAltM, unit);
  if(v==null) return 'n/a';
  if(unit==='fl'){
    const ft = Math.round(altM*3.28084);
    const taFt = state.transitionAltFt || 5000;
    // Below the transition altitude, real-world practice is to state a
    // plain feet altitude (QNH-referenced) rather than a flight level —
    // FL is only meaningful above the transition altitude.
    return ft < taFt ? (ft+' ft') : ('FL'+String(v).padStart(3,'0'));
  }
  return v + altitudeUnitSuffix(unit);
}


function satVaporPressure(Tc){ return 6.112*Math.exp(17.67*Tc/(Tc+243.5)); } // hPa, Bolton
function satMixingRatio(Tc, pHpa){ const es=satVaporPressure(Tc); return 0.622*es/(pHpa-es); }

function moistAdiabat(T0, pStart, pEnd, stepHpa){
  // returns array of [pHpa, Tc] following pseudoadiabatic lapse rate from pStart to pEnd
  const Rd=287.05, Cpd=1005.7, Lv=2.501e6, eps=0.622;
  let p = pStart, T = T0;
  const pts = [[p,T]];
  const dir = pEnd < pStart ? -1 : 1;
  const dp = dir*Math.abs(stepHpa);
  while((dir<0 && p>pEnd) || (dir>0 && p<pEnd)){
    const Tk = T+273.15;
    const rs = satMixingRatio(T, p);
    const num = Rd*Tk + Lv*rs;
    const den = Cpd + (Lv*Lv*rs*eps)/(Rd*Tk*Tk);
    const dTdp = num/(p*den);
    T = T + dTdp*dp;
    p = p + dp;
    pts.push([p,T]);
  }
  return pts;
}

// ---------- Thermodynamic indices ----------
// LCL via Bolton (1980) approximation. T0/Td0 in °C, p0 in hPa.
function computeLCL(T0, Td0, p0){
  const T0K = T0+273.15, Td0K = Td0+273.15;
  const T_LCL_K = 1/(1/(Td0K-56) + Math.log(T0K/Td0K)/800) + 56;
  const p_LCL = p0 * Math.pow(T_LCL_K/T0K, 1/KAPPA);
  return {p: p_LCL, T: T_LCL_K-273.15};
}

// Surface-based parcel path + CAPE/CIN, integrated against the actual
// sounding using the real altitude of each level (no virtual-temp correction
// — a standard simplification for a quick-look tool).
function computeThermo(rows){
  if(rows.length < 5) return null;
  const p0 = rows[0][2], T0 = rows[0][3], Td0 = rows[0][5], alt0 = rows[0][1];
  const lcl = computeLCL(T0, Td0, p0);
  const pTop = rows[rows.length-1][2];
  const moistPts = lcl.p > pTop ? moistAdiabat(lcl.T, lcl.p, Math.max(pTop-10,100), -2) : [[lcl.p,lcl.T]];

  function parcelTempAt(p){
    if(p >= lcl.p){
      const TK = (T0+273.15)*Math.pow(p/p0, KAPPA);
      return TK-273.15;
    }
    // interpolate from moistPts (pressure descending)
    for(let i=0;i<moistPts.length-1;i++){
      const [pa,Ta]=moistPts[i], [pb,Tb]=moistPts[i+1];
      if(p<=pa && p>=pb){
        const f=(pa-p)/(pa-pb||1e-9);
        return Ta+(Tb-Ta)*f;
      }
    }
    return moistPts[moistPts.length-1][1];
  }

  let cape=0, cin=0;
  for(let i=0;i<rows.length-1;i++){
    const p_i=rows[i][2], p_j=rows[i+1][2];
    const Tenv_i=rows[i][3], Tenv_j=rows[i+1][3];
    const Tp_i=parcelTempAt(p_i), Tp_j=parcelTempAt(p_j);
    const b_i = 9.80665*(Tp_i-Tenv_i)/(Tenv_i+273.15);
    const b_j = 9.80665*(Tp_j-Tenv_j)/(Tenv_j+273.15);
    const dz = rows[i+1][1]-rows[i][1];
    const bAvg = (b_i+b_j)/2;
    if(bAvg>0) cape += bAvg*dz; else cin += bAvg*dz;
  }

  // LFC (Level of Free Convection): first level at/above the LCL where the
  // lifted parcel becomes warmer than the environment — where positive
  // buoyancy (CAPE) actually begins. If the parcel is already warmer than
  // its environment right at the LCL (no capping inversion above it), the
  // LFC coincides with the LCL.
  let lfcP = null, lfcAlt = null;
  {
    let prevDiff = null, prevP = null, prevAlt = null;
    for(let i=0;i<rows.length;i++){
      const p = rows[i][2];
      if(p > lcl.p) continue;
      const diff = parcelTempAt(p) - rows[i][3];
      if(prevDiff==null){
        if(diff>0){ lfcP = p; lfcAlt = rows[i][1]; break; }
      } else if(prevDiff<=0 && diff>0){
        const f = prevDiff/(prevDiff-diff||1e-9);
        lfcP = prevP + f*(p-prevP);
        lfcAlt = prevAlt + f*(rows[i][1]-prevAlt);
        break;
      }
      prevDiff = diff; prevP = p; prevAlt = rows[i][1];
    }
  }

  // freezing level: first crossing of 0°C going up
  let freezeAlt = null, freezeP = null;
  for(let i=0;i<rows.length-1;i++){
    const T1=rows[i][3], T2=rows[i+1][3];
    if((T1>=0 && T2<0) || (T1<=0 && T2>0)){
      const f = T1/(T1-T2||1e-9);
      freezeAlt = rows[i][1] + f*(rows[i+1][1]-rows[i][1]);
      freezeP = rows[i][2] + f*(rows[i+1][2]-rows[i][2]);
      break;
    }
  }

  // tropopause: WMO — lapse rate ≤2°C/km, sustained so the average lapse
  // rate over the following 2 km also stays ≤2°C/km.
  let tropoAlt = null, tropoP = null;
  for(let i=0;i<rows.length-1;i++){
    const dz1 = rows[i+1][1]-rows[i][1];
    if(dz1<=0) continue;
    const lapse1 = -(rows[i+1][3]-rows[i][3])/dz1*1000;
    if(lapse1 <= 2){
      const alt_i = rows[i][1];
      let j=i, ok=true, foundEnd=false;
      while(j<rows.length-1 && rows[j][1]-alt_i < 2000){ j++; foundEnd = (rows[j][1]-alt_i>=2000); }
      if(foundEnd){
        const dzAll = rows[j][1]-rows[i][1];
        const lapseAvg = -(rows[j][3]-rows[i][3])/dzAll*1000;
        if(lapseAvg<=2){ tropoAlt = rows[i][1]; tropoP = rows[i][2]; ok=true; } else ok=false;
      } else ok=false;
      if(ok && tropoAlt!=null) break;
    }
  }

  // Lifted Index: how much colder/warmer a surface-lifted parcel is than
  // its environment at 500 hPa — a classic, widely-used stability index
  // that complements CAPE and the K-Index.
  const T500env = interpAtPressure(rows, 500, 3);
  const li = T500env!=null ? (T500env - parcelTempAt(500)) : null;

  return {lcl, cape, cin: Math.abs(cin), freezeAlt, freezeP, tropoAlt, tropoP, lfcP, lfcAlt, li, moistPts, p0, alt0};
}

// ---------- Theta-E (equivalent potential temperature), Bolton 1980 ----------
// ---------- Interpolate any column at a given pressure (linear) ----------
function interpAtPressure(rows, targetP, colIdx){
  for(let i=0;i<rows.length-1;i++){
    const pA=rows[i][2], pB=rows[i+1][2];
    if((targetP<=pA && targetP>=pB) || (targetP>=pA && targetP<=pB)){
      const f = (pA-targetP)/((pA-pB)||1e-9);
      return rows[i][colIdx] + f*(rows[i+1][colIdx]-rows[i][colIdx]);
    }
  }
  return null;
}

// ---------- Thunderstorm likelihood via the K-Index (a standard, widely
// used forecasting heuristic — not a substitute for an actual forecast). ----------
// ---------- Bulk wind shear (surface to ~6 km AGL) ----------
// ---------- Downdraft CAPE (DCAPE) ----------
// Finds the level of minimum equivalent potential temperature (theta-e) in
// the lowest ~400 hPa — the likely source of dry air aloft feeding a
// downdraft — then brings a saturated parcel down from there to the
// surface along a moist adiabat (the same reversible curve used for CAPE,
// just traversed downward) and integrates the negative buoyancy this
// produces relative to the environment. Standard simplified approach
// (e.g. Emanuel 1994); no entrainment.
function computeDCAPE(rows){
  if(rows.length < 5) return null;
  const p0 = rows[0][2];
  let minThetaE = Infinity, srcIdx = -1;
  for(let i=0;i<rows.length;i++){
    if(p0 - rows[i][2] > 400) break;
    const te = thetaE(rows[i][3], rows[i][5], rows[i][2]);
    if(te < minThetaE){ minThetaE = te; srcIdx = i; }
  }
  if(srcIdx < 1) return null;
  const pSrc = rows[srcIdx][2], TSrc = rows[srcIdx][3];
  const descentPts = moistAdiabat(TSrc, pSrc, p0, 2); // descending: p increases toward the surface
  function parcelTempDescent(p){
    for(let i=0;i<descentPts.length-1;i++){
      const [pa,Ta]=descentPts[i], [pb,Tb]=descentPts[i+1];
      if((p>=pa && p<=pb) || (p<=pa && p>=pb)){
        const f=(p-pa)/((pb-pa)||1e-9);
        return Ta+(Tb-Ta)*f;
      }
    }
    return descentPts[descentPts.length-1][1];
  }
  let dcape = 0;
  for(let i=0;i<srcIdx;i++){
    const pA=rows[i][2], pB=rows[i+1][2];
    const TenvA=rows[i][3], TenvB=rows[i+1][3];
    const TpA=parcelTempDescent(pA), TpB=parcelTempDescent(pB);
    const bA = 9.80665*(TenvA-TpA)/(TenvA+273.15); // positive = parcel colder than env (drives sinking)
    const bB = 9.80665*(TenvB-TpB)/(TenvB+273.15);
    const dz = rows[i+1][1]-rows[i][1];
    dcape += Math.max(0,(bA+bB)/2) * dz;
  }
  return dcape;
}

// ---------- Precipitable water (PW) ----------
// Column-integrated water vapor: PW = (1/g) ∫ w dp, using the actual
// (dewpoint-derived) mixing ratio at each level. Result in mm (= kg/m²).
function computePW(rows){
  let pw = 0;
  for(let i=0;i<rows.length-1;i++){
    const pA=rows[i][2], pB=rows[i+1][2];
    const wA = satMixingRatio(rows[i][5], pA);
    const wB = satMixingRatio(rows[i+1][5], pB);
    const dpPa = Math.abs(pA-pB)*100;
    pw += ((wA+wB)/2) * dpPa / 9.80665;
  }
  return pw; // mm
}

// Finds the altitude band (in the current sounding) where wind changes
// most sharply between adjacent measurements — useful to point out where
// shear-related turbulence risk is concentrated, beyond the single bulk
// 0-6 km number.
// ---------- Cloud cover as octas / METAR abbreviation ----------
function cloudPctToOctas(pct){ return Math.max(0, Math.min(8, Math.round(pct/100*8))); }
function octasToMetar(octas){
  if(octas<=0) return 'SKC';
  if(octas<=2) return 'FEW';
  if(octas<=4) return 'SCT';
  if(octas<=7) return 'BKN';
  return 'OVC';
}
// Small inline SVG sky-cover circle (pie-filled proportional to octas),
// the standard simplified representation used on weather charts/synoptic
// station models.
function octasSvgIcon(octas, sizePx){
  sizePx = sizePx || 15;
  const r = sizePx/2 - 1.3, cx = sizePx/2, cy = sizePx/2;
  const frac = octas/8;
  let inner;
  if(octas<=0){
    inner = '';
  } else if(octas>=8){
    inner = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;
  } else {
    const angle = frac*2*Math.PI - Math.PI/2;
    const x = cx + r*Math.cos(angle), y = cy + r*Math.sin(angle);
    const largeArc = frac>0.5 ? 1 : 0;
    inner = `<path d="M${cx},${cy} L${cx},${cy-r} A${r},${r} 0 ${largeArc} 1 ${x.toFixed(2)},${y.toFixed(2)} Z" fill="currentColor"/>`;
  }
  return `<svg width="${sizePx}" height="${sizePx}" style="vertical-align:middle;margin-left:4px;">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="currentColor" stroke-width="1.4"/>${inner}</svg>`;
}

function findMaxLocalShearBand(rows){
  const windRows = rows.filter(r=>r[6]!=null && r[7]!=null);
  if(windRows.length < 2) return null;
  function uv(r){
    const rad = windFromDeg(r[7])*Math.PI/180;
    return {u: -r[6]*Math.sin(rad), v: -r[6]*Math.cos(rad)};
  }
  let best = null;
  for(let i=0;i<windRows.length-1;i++){
    const dz = windRows[i+1][1]-windRows[i][1];
    if(dz < 200) continue; // ignore very thin slivers, focus on meaningful bands
    const a = uv(windRows[i]), b = uv(windRows[i+1]);
    const dSpeedMs = Math.sqrt((b.u-a.u)**2 + (b.v-a.v)**2);
    const perKm = dSpeedMs/(dz/1000);
    if(!best || perKm > best.perKm){
      best = {perKm, altLo: windRows[i][1], altHi: windRows[i+1][1], shearKt: msToKt(dSpeedMs)};
    }
  }
  return best;
}

function computeWindShear(rows){
  const windRows = rows.filter(r=>r[6]!=null && r[7]!=null);
  if(windRows.length < 2) return null;
  const groundAlt = windRows[0][1];
  const target = groundAlt + 6000;
  let top = windRows[0], bestDiff = Infinity;
  for(const r of windRows){
    const diff = Math.abs(r[1]-target);
    if(diff < bestDiff){ bestDiff = diff; top = r; }
  }
  if(bestDiff > 1000) return null; // sounding doesn't reach anywhere near 6 km AGL
  function uv(r){
    const dirFrom = windFromDeg(r[7]);
    const rad = dirFrom*Math.PI/180;
    return {u: -r[6]*Math.sin(rad), v: -r[6]*Math.cos(rad)};
  }
  const a = uv(windRows[0]), b = uv(top);
  const shearMs = Math.sqrt((b.u-a.u)**2 + (b.v-a.v)**2);
  return msToKt(shearMs);
}

function computeKIndex(rows){
  const T850=interpAtPressure(rows,850,3), T700=interpAtPressure(rows,700,3), T500=interpAtPressure(rows,500,3);
  const Td850=interpAtPressure(rows,850,5), Td700=interpAtPressure(rows,700,5);
  if([T850,T700,T500,Td850,Td700].some(v=>v==null)) return null;
  return (T850-T500) + Td850 - (T700-Td700);
}
function kIndexToProbabilityPct(k){
  if(k==null) return null;
  if(k<20) return Math.max(0, Math.round(20*(k-15)/5));
  if(k<26) return Math.round(20+20*(k-20)/6);
  if(k<31) return Math.round(40+20*(k-26)/5);
  if(k<36) return Math.round(60+20*(k-31)/5);
  if(k<41) return Math.round(80+15*(k-36)/5);
  return Math.min(100, Math.round(95+5*(k-41)/5));
}

// ---------- Rough total cloud cover estimate from the RH profile ----------
// Per-level cloud fraction via a standard empirical RH threshold curve,
// combined down the column assuming random overlap. This is a coarse
// estimate from a single vertical profile, not a real cloud-cover forecast.
function cloudFractionAtRH(rh){
  const critRH = 80;
  if(rh <= critRH) return 0;
  return Math.min(1, Math.pow((rh-critRH)/(100-critRH), 2));
}
function estimateCloudCoverPct(rows){
  let clearProb = 1;
  for(const r of rows) clearProb *= (1 - cloudFractionAtRH(r[4]));
  return Math.round((1-clearProb)*100);
}

// ---------- Convective cloud-development band: from LCL up to the top of
// the parcel's positive buoyancy (roughly the equilibrium level) ----------
function computeConvectiveBand(rows, thermo){
  if(!thermo) return null;
  const pStart = thermo.lcl.p;
  const pts = thermo.moistPts; // [[p,T], ...] from LCL upward along the moist adiabat
  if(!pts || pts.length<2) return null;
  let pTop = pStart;
  for(let i=0;i<pts.length;i++){
    const [p, Tparcel] = pts[i];
    const Tenv = interpAtPressure(rows, p, 3);
    if(Tenv==null) break;
    if(Tparcel <= Tenv) break; // parcel no longer buoyant — top of the cloud layer
    pTop = p;
  }
  if(Math.abs(pStart-pTop) < 1) return null; // no meaningful positive-buoyancy layer
  return {p0: pStart, p1: pTop};
}

function thetaE(Tc, Tdc, pHpa){
  const TK = Tc+273.15;
  const e = satVaporPressure(Tdc); // actual vapor pressure from dewpoint, hPa
  const rGkg = 1000*0.622*e/(pHpa-e);
  const lcl = computeLCL(Tc, Tdc, pHpa);
  const TLK = lcl.T+273.15;
  const term1 = Math.pow(1000/pHpa, 0.2854*(1-0.00028*rGkg));
  const term2 = Math.exp((3.376/TLK - 0.00254)*rGkg*(1+0.00081*rGkg));
  return TK*term1*term2 - 273.15;
}

// ---------- Saturation mixing ratio lines (T at given p for constant rs) ----------
function tempForMixingRatio(rsGkg, pHpa){
  const rs = rsGkg/1000;
  const es = rs*pHpa/(0.622+rs);
  const lnr = Math.log(es/6.112);
  return (243.5*lnr)/(17.67-lnr);
}

// ---------- Cloud layers: sustained near-saturation bands (RH >= 95%) ----------
function detectCloudLayers(rowsIn){
  // Model levels: a cloud layer is any run of adjacent levels at RH >= 95 %
  // (continuing while RH stays >= 93 %). A single saturated level counts as a
  // thin layer spanning half-way to its neighbours.
  const rows = (rowsIn||[]).filter(r=>r[4]!=null && r[12]!=='agl');
  const n = rows.length;
  if(n < 3) return [];
  const layers = [];
  let i=0;
  while(i<n){
    if(rows[i][4] >= 95){
      let j=i;
      while(j<n-1 && rows[j+1][4] >= 93) j++;
      const p0 = i>0 ? (rows[i][2]+rows[i-1][2])/2 : rows[i][2];
      const p1 = j<n-1 ? (rows[j][2]+rows[j+1][2])/2 : rows[j][2];
      layers.push({p0, p1});
      i=j+1;
    } else i++;
  }
  return layers.filter(l=>Math.abs(l.p0-l.p1)>=0.4);
}

// ---------- Data-quality / plausibility scan ----------
// Sonde-data anomaly checks from S2 do not apply to model output.
function detectAnomalies(rows){ return []; }

function msToKt(ms){ return ms*1.943844; }
// Formats a wind/air speed (given in m/s) in the currently selected display
// unit (km/h by default, or kt). Wind barbs themselves always stay in
// knots regardless of this setting — the barb pennant/full-barb/half-barb
// shapes are an international meteorological convention tied specifically
// to knots, not a display preference.
function formatSpeed(ms){
  if(ms==null || !isFinite(ms)) return null;
  return state.speedUnit === 'kt' ? msToKt(ms) : ms*3.6;
}
function speedUnitLabel(){ return state.speedUnit === 'kt' ? 'kt' : 'km/h'; }
// For values computed internally in knots (e.g. shear, which has
// established meteorological thresholds defined in kt) — converts only
// for display, without touching the underlying kt-based comparisons.
function ktToDisplayUnit(kt){ return state.speedUnit === 'kt' ? kt : kt*1.852; }
function windFromDeg(headingDeg){ return (headingDeg+180)%360; } // balloon travels WITH the wind

function nearestByPressure(rows, targetHpa){
  let best=-1, bestD=Infinity;
  for(let i=0;i<rows.length;i++){
    const d = Math.abs(rows[i][2]-targetHpa);
    if(d<bestD){bestD=d;best=i;}
  }
  return best>=0 ? rows[best] : null;
}

// Circular mean for wind direction (degrees) — needed because averaging e.g.
// 350° and 10° arithmetically gives 180° (wrong); vector averaging gives 0°.
function circularMeanDeg(anglesDeg){
  let sx=0, sy=0;
  for(const a of anglesDeg){ const r=a*Math.PI/180; sx+=Math.cos(r); sy+=Math.sin(r); }
  let mean = Math.atan2(sy,sx)*180/Math.PI;
  if(mean<0) mean += 360;
  return mean;
}

// Moving-average smoothing of wind speed/heading over a small window
// (speed: linear mean; heading: circular mean). Operates on rows already
// filtered to have wind data, preserving their pressure/altitude/time.
function smoothWindRows(windRows, halfWin=7){
  const n = windRows.length;
  const out = new Array(n);
  for(let i=0;i<n;i++){
    const lo = Math.max(0,i-halfWin), hi = Math.min(n-1,i+halfWin);
    const speeds=[], dirs=[];
    for(let j=lo;j<=hi;j++){ speeds.push(windRows[j][6]); dirs.push(windRows[j][7]); }
    const avgSpeed = speeds.reduce((a,b)=>a+b,0)/speeds.length;
    const avgDir = circularMeanDeg(dirs);
    const r = windRows[i].slice();
    r[6] = avgSpeed; r[7] = avgDir;
    out[i] = r;
  }
  return out;
}

// Returns the wind-bearing rows to actually plot: raw measurements or the
// smoothed version, depending on the current toggle state.
function activeWindRows(rows){
  const rawWithIdx = [];
  rows.forEach((r,i)=>{ if(r[6]!=null && r[7]!=null) rawWithIdx.push({row:r, idx:i}); });
  const raw = rawWithIdx.map((item,k)=>{
    const gapBefore = k>0 && (item.idx - rawWithIdx[k-1].idx > 4);
    if(gapBefore && item.row[11]!==true){
      const copy = item.row.slice();
      copy[11] = true;
      return copy;
    }
    return item.row;
  });
  return state.windSmoothed ? smoothWindRows(raw) : raw;
}

function parseUtcSeconds(tStr){
  const t = Date.parse(String(tStr).trim().replace(' ','T')+'Z');
  return isFinite(t) ? t/1000 : null;
}

// Thins a time-ordered row list so consecutive kept points are at least
// intervalSec apart (0 = keep every point).
function filterByInterval(rows, intervalSec){
  if(!intervalSec || intervalSec<=0) return rows;
  const out = [];
  let lastT = -Infinity;
  for(const r of rows){
    const t = parseUtcSeconds(r[0]);
    if(t==null){ out.push(r); continue; }
    if(t - lastT >= intervalSec - 0.5){ out.push(r); lastT = t; }
  }
  return out;
}

// Draws a standard meteorological wind barb at (cx,cy). dirFromDeg: compass

function drawWindBarb(ctx, cx, cy, speedKt, dirFromDeg, color){
  if(speedKt==null || dirFromDeg==null || !isFinite(speedKt) || !isFinite(dirFromDeg)) return;
  const rad = dirFromDeg*Math.PI/180;
  const dx = Math.sin(rad), dy = -Math.cos(rad); // direction the staff points (toward where wind comes from)
  const shaftLen = 26;
  const ex = cx+dx*shaftLen, ey = cy+dy*shaftLen;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';

  // calm wind: just a small circle
  if(speedKt < 2.5){
    ctx.beginPath();
    ctx.arc(cx,cy,4,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // station point + shaft
  ctx.beginPath();
  ctx.arc(cx,cy,2,0,Math.PI*2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx,cy);
  ctx.lineTo(ex,ey);
  ctx.stroke();

  // perpendicular direction (barbs sit on the clockwise side of the staff)
  const px = Math.cos(rad), py = Math.sin(rad);

  let remaining = Math.round(speedKt/5)*5; // round to nearest 5kt
  let pos = shaftLen; // distance from station along shaft, start at far end
  const step = 6;

  // pennants (50kt triangles)
  while(remaining >= 50){
    const bx = cx+dx*pos, by = cy+dy*pos;
    const bx2 = cx+dx*(pos-step), by2 = cy+dy*(pos-step);
    ctx.beginPath();
    ctx.moveTo(bx,by);
    ctx.lineTo(bx2,by2);
    ctx.lineTo(bx+px*9, by+py*9);
    ctx.closePath();
    ctx.fill();
    pos -= step;
    remaining -= 50;
  }
  // full barbs (10kt)
  while(remaining >= 10){
    const bx = cx+dx*pos, by = cy+dy*pos;
    ctx.beginPath();
    ctx.moveTo(bx,by);
    ctx.lineTo(bx+px*9, by+py*9);
    ctx.stroke();
    pos -= step;
    remaining -= 10;
  }
  // half barb (5kt)
  if(remaining >= 5){
    const bx = cx+dx*pos, by = cy+dy*pos;
    ctx.beginPath();
    ctx.moveTo(bx,by);
    ctx.lineTo(bx+px*4.5, by+py*4.5);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Launch location ----------

// ---------- Notable layers on model levels ----------
// S2 detected inversions/isothermal layers on 1-second sonde samples with a
// smoothing window; model profiles only have 10-60 levels, so the detection
// works directly on the gradient between adjacent levels (K per km):
//   inversion   : temperature increases with height (gradient > +0.2 K/km)
//   isothermal  : |gradient| <= 1.5 K/km  (near-constant temperature)
// Adjacent segments of the same kind are merged. Returns [{p0, p1, kind}]
// with p0 the lower (higher-pressure) boundary, like S2.
function detectThermalLayers(rowsIn){
  const rows = (rowsIn||[]).filter(r=>r[3]!=null && r[1]!=null && r[12]!=='agl');
  if(rows.length < 3) return [];
  const segs = [];
  for(let i=0;i<rows.length-1;i++){
    const dz = rows[i+1][1]-rows[i][1];
    if(dz < 30) continue;
    const grad = (rows[i+1][3]-rows[i][3])/dz*1000; // K/km, positive = warmer aloft
    let kind = null;
    if(grad > 0.2) kind = 'inversion';
    else if(Math.abs(grad) <= 1.5) kind = 'isothermal';
    if(!kind) continue;
    const last = segs[segs.length-1];
    if(last && last.kind===kind && last.b===i) last.b = i+1;
    else segs.push({a:i, b:i+1, kind});
  }
  return segs.map(sg=>({p0: rows[sg.a][2], p1: rows[sg.b][2], kind: sg.kind}));
}
function detectInversions(rows){ return detectThermalLayers(rows).filter(l=>l.kind==='inversion'); }
function detectIsothermalLayers(rows){ return detectThermalLayers(rows).filter(l=>l.kind==='isothermal'); }
