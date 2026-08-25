// ---- StueveCast: weighted mean of several model profiles ("avg." chip) ----
//
// Weight of a model: w = (1 / sqrt(grid km)) / (1 + run age h / 6)
//   - finer grids count more (2.2 km ≈ 0.67, 13 km ≈ 0.28, 25 km ≈ 0.20)
//   - a run that is 6 h old counts half as much as a fresh one
// Weights are normalised over the models that carry data at a given level, so
// a coarse global model above the top of a regional model simply continues
// the profile with full weight.
const Blend = (function(){
  const RD = 287.05, G = 9.80665;

  function modelWeight(meta, now){
    const age = Math.max(0, estimateRunAgeHours(meta, now));
    return (1/Math.sqrt(Math.max(0.5, meta.gridKm))) / (1 + age/6);
  }
  function normalise(entries){
    const sum = entries.reduce((a,e)=>a+e.weight, 0) || 1;
    return entries.map(e=>Object.assign({}, e, {weight: e.weight/sum}));
  }

  // Linear interpolation in ln(p) of one row quantity; rows sorted by
  // ascending height (descending pressure). Returns null outside the range.
  function interpRow(rows, p){
    if(!rows || rows.length < 2) return null;
    if(p > rows[0][2] || p < rows[rows.length-1][2]) return null;
    for(let i=0;i<rows.length-1;i++){
      const a = rows[i], b = rows[i+1];
      if((p <= a[2] && p >= b[2])){
        const f = (Math.log(a[2]) - Math.log(p)) / ((Math.log(a[2]) - Math.log(b[2])) || 1e-9);
        const lin = (x,y)=> x==null||y==null ? null : x + (y-x)*f;
        let ws = null, hd = null;
        if(a[6]!=null && b[6]!=null && a[7]!=null && b[7]!=null){
          const ua = -a[6]*Math.sin(windFromDeg(a[7])*Math.PI/180), va = -a[6]*Math.cos(windFromDeg(a[7])*Math.PI/180);
          const ub = -b[6]*Math.sin(windFromDeg(b[7])*Math.PI/180), vb = -b[6]*Math.cos(windFromDeg(b[7])*Math.PI/180);
          const u = lin(ua, ub), v = lin(va, vb);
          ws = Math.hypot(u, v);
          const from = (Math.atan2(-u, -v)*180/Math.PI + 360) % 360;
          hd = (from + 180) % 360;
        }
        return {z: lin(a[1], b[1]), T: lin(a[3], b[3]), Td: lin(a[5], b[5]), ws, hd, w: lin(a[10], b[10])};
      }
    }
    return null;
  }

  // entries: [{rows, meta, weight}] with rows in S2 format. Returns S2 rows of
  // the weighted mean, or null when fewer than two entries carry data.
  function buildAverageRows(entriesIn){
    const entries = normalise(entriesIn.filter(e=>e.rows && e.rows.length >= 3));
    if(entries.length < 2) return null;
    const ts = entries[0].rows[0][0], lat = entries[0].rows[0][8], lon = entries[0].rows[0][9];
    const wsum = (get) => { let s=0, w=0; entries.forEach(e=>{ const v = get(e); if(v!=null && isFinite(v)){ s += v*e.weight; w += e.weight; } }); return w>0 ? s/w : null; };
    // surface: weighted mean of the models' ground rows
    entries.forEach(e=>{ e.sfc = e.rows.find(r=>r[12]==='sfc') || e.rows[0]; });
    const z0 = wsum(e=>e.sfc[1]), p0 = wsum(e=>e.sfc[2]), T0 = wsum(e=>e.sfc[3]), Td0 = wsum(e=>e.sfc[5]);
    let u0 = 0, v0 = 0, ww = 0;
    entries.forEach(e=>{ const r = e.sfc; if(r[6]!=null && r[7]!=null){ const d = windFromDeg(r[7])*Math.PI/180; u0 += -r[6]*Math.sin(d)*e.weight; v0 += -r[6]*Math.cos(d)*e.weight; ww += e.weight; } });
    const rows = [];
    if(z0!=null && p0!=null && T0!=null){
      const RH0 = Td0!=null ? rhFromTTd(T0, Td0) : 50;
      const ws0 = ww>0 ? Math.hypot(u0/ww, v0/ww) : null;
      const hd0 = ww>0 ? ((Math.atan2(-u0, -v0)*180/Math.PI + 360) % 360 + 180) % 360 : null;
      rows.push([ts, z0, p0, T0, RH0, Td0!=null ? Math.min(Td0, T0) : magnusDewpoint(T0, RH0), ws0, hd0, lat, lon, null, false, 'sfc']);
    }
    // common pressure grid: union of the models' level pressures above the mean surface
    const pset = new Set();
    entries.forEach(e=>e.rows.forEach(r=>{ if(r[12]!=='agl') pset.add(Math.round(r[2]*10)/10); }));
    const levels = Array.from(pset).filter(p=>p0==null || p < p0-1).sort((a,b)=>b-a);
    levels.forEach(p=>{
      let sT=0, sTd=0, sz=0, su=0, sv=0, sw=0, wT=0, wW=0, wV=0, sV=0;
      entries.forEach(e=>{
        const q = interpRow(e.rows, p);
        if(!q || q.T==null || q.z==null) return;
        sT += q.T*e.weight; sTd += (q.Td!=null ? q.Td : q.T-10)*e.weight; sz += q.z*e.weight; wT += e.weight;
        if(q.ws!=null){ const d = windFromDeg(q.hd)*Math.PI/180; su += -q.ws*Math.sin(d)*e.weight; sv += -q.ws*Math.cos(d)*e.weight; wW += e.weight; }
        if(q.w!=null){ sV += q.w*e.weight; wV += e.weight; }
      });
      // require at least 35 % of the total weight (i.e. not just one coarse model far aloft)
      if(wT < 0.35 && wT < Math.max(...entries.map(e=>e.weight))) return;
      if(wT <= 0) return;
      const T = sT/wT, Td = Math.min(sTd/wT, T), z = sz/wT;
      const ws = wW>0 ? Math.hypot(su/wW, sv/wW) : null;
      const hd = wW>0 ? ((Math.atan2(-su, -sv)*180/Math.PI + 360) % 360 + 180) % 360 : null;
      rows.push([ts, z, p, T, rhFromTTd(T, Td), Td, ws, hd, lat, lon, wV>0 ? sV/wV : null, false, 'lvl']);
    });
    rows.sort((a,b)=>a[1]-b[1]);
    const out = rows.filter((r,i)=>i===0 || r[1] > rows[i-1][1]);
    return out.length >= 3 ? out : null;
  }

  function rhFromTTd(T, Td){
    const es = 6.112*Math.exp(17.62*T/(243.12+T)), e = 6.112*Math.exp(17.62*Td/(243.12+Td));
    return Math.max(1, Math.min(100, 100*e/es));
  }

  // Weighted mean of the surface/diagnostic values (readout) — only fields
  // that every contributing model provides are averaged.
  function averageSurface(list){ // [{surface, weight}]
    const entries = normalise(list.filter(e=>e.surface));
    if(!entries.length) return null;
    const out = {};
    const keys = new Set(); entries.forEach(e=>Object.keys(e.surface).forEach(k=>keys.add(k)));
    keys.forEach(k=>{
      let s=0, w=0;
      if(k==='wind_direction_10m'){ let u=0, v=0; entries.forEach(e=>{ const sp = e.surface.wind_speed_10m, d = e.surface[k]; if(sp!=null && d!=null){ u += -sp*Math.sin(d*Math.PI/180)*e.weight; v += -sp*Math.cos(d*Math.PI/180)*e.weight; w += e.weight; } });
        if(w>0) out[k] = (Math.atan2(-u, -v)*180/Math.PI + 360) % 360; return; }
      entries.forEach(e=>{ const v = e.surface[k]; if(v!=null){ s += v*e.weight; w += e.weight; } });
      if(w>0) out[k] = s/w;
    });
    return out;
  }

  return {modelWeight, normalise, buildAverageRows, averageSurface, interpRow};
})();
