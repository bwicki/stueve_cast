// ---- StueveCast chart rendering (ported from S2) ----

const canvas = document.getElementById('chart');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
let PLOT = null; // holds current layout for hit-testing

function renderLegend(){
  const items = [
    ['Temperature', 'var(--temp)', 'solid'],
    ['Dew point', 'var(--dew)', 'solid'],
    ['Isobars (pressure)', 'var(--grid-isobar)', 'solid'],
    ['Isotherms', 'var(--grid-isotherm)', 'dot'],
    ['Dry adiabats', 'var(--grid-adiabat)', 'dash'],
    ['Moist adiabats', 'var(--grid-moist)', 'dash'],
    ['Wind speed ('+speedUnitLabel()+')', 'var(--wind-line)', 'solid'],
    ['Inversion (temp. increases with height)', 'var(--text-dim)', 'solid'],
    ['Isothermal layer (temp. constant with height)', 'var(--grid-isotherm)', 'solid'],
    ['Mixing ratio (g/kg)', '#5fae7a', 'dot'],
    ['Cloud layer (RH ≥ 95%)', '#7fd4e8', 'solid'],
    [`Relative humidity shading (from ${state.cloudThreshold}%)`, '#7a7a7a', 'solid'],
    ['Convective development band', '#8a95a6', 'solid'],
    ['Model ground elevation', '#3fae5a', 'solid'],
    ['Freezing level (0°C)', '#2f7fbf', 'dot'],
    ['Tropopause', '#9a7fd1', 'dot'],
    ['Parcel path (LCL → moist adiabat)', 'var(--amber)', 'dash'],
  ];
  document.getElementById('legend').innerHTML = items.map(([label,color,style])=>
    `<div class="item"><span class="swatch ${style==='solid'?'':style}" style="border-top-color:${color}"></span>${label}</div>`
  ).join('')
    + `<div class="item"><span style="display:inline-flex;gap:3px;vertical-align:middle;"><span style="width:7px;height:7px;border-radius:50%;background:var(--temp);"></span><span style="width:7px;height:7px;border-radius:50%;background:var(--dew);"></span></span> Model levels (real data points; curves in between are interpolated)</div>`
    + `<div class="item">🎌 Wind barb: pennant=50kt, full barb=10kt, half barb=5kt, circle=calm</div>`
    + `<div class="item"><span style="width:12px;height:12px;background:#e0554a;opacity:.5;display:inline-block;border-radius:2px;"></span> CAPE (positive area)</div>`
    + `<div class="item"><svg width="14" height="14" style="vertical-align:middle;"><circle cx="7" cy="7" r="3" fill="var(--amber)"/><circle cx="7" cy="7" r="6" fill="none" stroke="var(--amber)" stroke-width="1"/></svg> LCL (lifting condensation level — cloud base if lifted)</div>`
    + `<div class="item"><span style="width:0;height:0;display:inline-block;border-left:6px solid transparent;border-right:6px solid transparent;border-bottom:10px solid #e0554a;"></span> LFC (level of free convection — where CAPE begins)</div>`
    + `<div class="item"><span style="width:12px;height:12px;background:#4a90c4;opacity:.5;display:inline-block;border-radius:2px;"></span> CIN (negative area)</div>`
    + state.compareFlights.map((cf,i)=>{
        const c = COMPARE_COLORS[i];
        return `<div class="item"><span class="swatch dash" style="border-top-color:${c.temp}"></span><span class="swatch dash" style="border-top-color:${c.dew}"></span>Comparison model: ${cf.source}</div>`;
      }).join('');
}


function layoutChart(rows){
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  // Compact mode: phone-sized widths get tighter axis columns and a taller
  // plot relative to the width, so the profile stays legible in portrait.
  // Compact axis columns below 720 px (phones, and the centre column of the
  // three-column cockpit on an iPad). The height follows the space the app
  // measured for the chart (state.chartTargetHeight) so the profile fills the
  // screen; phones use the viewport height instead.
  const compact = !printMode && cssWidth < 720;
  const cssHeight = printMode
    ? (state.printWithPanels ? Math.min(230, cssWidth*0.34) : Math.min(460, cssWidth*0.65))
    : (state.chartTargetHeight
        ? Math.max(380, Math.min(state.chartTargetHeight, Math.round(cssWidth*1.35)))
        : (cssWidth < 640 ? Math.max(400, Math.min(620, Math.round(window.innerHeight*0.56)))
                          : Math.max(520, Math.min(760, cssWidth*0.62))));
  canvas.width = cssWidth*dpr;
  canvas.height = cssHeight*dpr;
  canvas.style.height = cssHeight+'px';
  const cursorOverlay = document.getElementById('chartCursorOverlay');
  if(cursorOverlay){
    cursorOverlay.width = canvas.width;
    cursorOverlay.height = canvas.height;
    cursorOverlay.style.width = cssWidth+'px';
    cursorOverlay.style.height = cssHeight+'px';
  }
  const altMinEl = document.getElementById('altRangeMin'), altMaxEl = document.getElementById('altRangeMax');
  if(altMinEl){
    const trackH = document.getElementById('altRangeTrack').clientHeight;
    altMinEl.style.height = trackH+'px';
    altMaxEl.style.height = trackH+'px';
    updateAltRangeFill();
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);

  const windRowsAll = activeWindRows(rows);
  const hasWind = windRowsAll.length>0;
  const defaultSpeedW = compact ? Math.max(44, Math.min(120, cssWidth*0.16)) : Math.max(60, Math.min(320, cssWidth*0.20));
  const speedW = printMode ? (state.printWithPanels ? 50 : 85) : (state.speedPanelWidth || defaultSpeedW);
  // pad.right's base value (172) below was calibrated assuming a 72px-wide
  // speed panel — extraSpeedW must always be measured against that same
  // fixed baseline, not against defaultSpeedW itself (which is now dynamic
  // and would otherwise make extraSpeedW=0 even when the panel is rendered
  // much wider than 72px, clipping the curve at high wind speeds).
  const extraSpeedW = printMode ? 0 : Math.max(0, speedW - (compact ? 44 : 72));
  const pad = printMode
    ? {left:88, right: hasWind ? (state.printWithPanels ? 130 : 165) : 24, top:12, bottom:26}
    : (compact
        ? {left:80, right: hasWind ? (108 + extraSpeedW) : 16, top:40, bottom:40}
        : {left:135, right: hasWind ? (172 + extraSpeedW) : 34, top:48, bottom:44});
  const plotW = cssWidth - pad.left - pad.right;
  const plotH = cssHeight - pad.top - pad.bottom;

  // wind sub-panels, laid out to the right of the main plot
  const speedX0 = pad.left + plotW + (printMode ? 14 : (compact ? 12 : 20));
  const speedX1 = speedX0 + speedW;
  const windColX = speedX1 + (printMode ? 26 : (compact ? 30 : 38));
  const rightEdge = windColX + (printMode ? 16 : (compact ? 18 : 24));

  const maxSpeed = hasWind ? Math.max(...windRowsAll.map(r=>formatSpeed(r[6]))) : 0;
  const sMax = Math.max(20, Math.ceil((maxSpeed+3)/10)*10);
  const speedScale = v => speedX0 + (v/sMax)*speedW;

  // Altitude zoom window (left-hand vertical sliders): restrict the axis
  // range to a sub-band of the data without discarding/refiltering the
  // curves themselves — they're still drawn in full and simply clipped.
  const dataAlts = rows.map(r=>r[1]);
  const dataAltMin = Math.min(...dataAlts), dataAltMax = Math.max(...dataAlts);
  const altLo = dataAltMin + (dataAltMax-dataAltMin)*(state.viewMinPct||0)/1000;
  const altHi = dataAltMin + (dataAltMax-dataAltMin)*(state.viewMaxPct!=null?state.viewMaxPct:1000)/1000;
  const zoomed = (state.viewMinPct>0 || (state.viewMaxPct!=null && state.viewMaxPct<1000));
  const rangeRows = zoomed ? rows.filter(r=>r[1]>=altLo && r[1]<=altHi) : rows;
  const rowsForRange = rangeRows.length>=2 ? rangeRows : rows;

  const temps = rowsForRange.map(r=>r[3]);
  const dews = rowsForRange.map(r=>r[5]);
  const pres = rowsForRange.map(r=>r[2]);
  const yData = pres.map(yOf);
  if(!zoomed) state.compareFlights.forEach(cf=>{
    temps.push(...cf.rows.map(r=>r[3]));
    dews.push(...cf.rows.map(r=>r[5]));
    yData.push(...cf.rows.map(r=>yOf(r[2])));
  });
  if(state.showThetaE){
    // Theta-E can run tens of degrees above the actual temperature (latent
    // heat), so it needs its own headroom on the T axis — but only when the
    // curve is actually switched on, so leaving it off keeps the tightest,
    // most legible axis for the primary temperature/dew point curves.
    temps.push(...rowsForRange.map(r=>thetaE(r[3], r[5], r[2])));
  }

  const Tmin = Math.floor((Math.min(...temps,...dews)-4)/5)*5;
  const Tmax = Math.ceil((Math.max(...temps,...dews)+4)/5)*5;
  const yDataMin = Math.min(...yData), yDataMax = Math.max(...yData);
  const yPad = Math.max((yDataMax-yDataMin)*0.02, 1e-4);
  // Extra headroom above the highest data point (~800 m of "sky") so the
  // profile doesn't run right up against the top edge of the chart. Uses
  // the hypsometric/barometric formula with the actual measured temperature
  // at the highest point — robust even when the balloon's climb rate has
  // slowed to a crawl just before burst (so nearby samples span very
  // little altitude and a finite-difference lapse-rate estimate would be
  // unreliable).
  const topRow = rowsForRange[rowsForRange.length-1];
  const topTK = topRow[3] + 273.15;
  const scaleHeight = 287.05 * topTK / 9.80665; // meters
  const extraP = topRow[2] * Math.exp(-800/scaleHeight);
  const extraYof = extraP > 1 ? yOf(extraP) : null;
  const Ymin = Math.min(yDataMin - yPad, extraYof!=null ? extraYof : Infinity);
  const Ymax = yDataMax + yPad;

  const xScale = T => pad.left + (T-Tmin)/(Tmax-Tmin) * plotW;
  const yScale = y => pad.top + ((y-Ymin)/(Ymax-Ymin)) * plotH; // Ymin(top,small p) -> top px; Ymax(ground) -> bottom px

  return {cssWidth,cssHeight,pad,plotW,plotH,Tmin,Tmax,Ymin,Ymax,xScale,yScale,rows,compact,
    hasWind, windRowsAll, speedX0, speedW, speedX1, windColX, rightEdge, sMax, speedScale};
}

// ---------- Inversion detection ----------
// Flags altitude bands where (smoothed) temperature increases with height —
// a temperature inversion. Uses a moving average to suppress sensor noise
// and a minimum run length so single noisy samples aren't flagged.
// Detects both inversion layers (temperature rises with height) and
// isothermal layers (temperature stays ~constant with height) — the two
// standard "notable layer" markings on a sounding. Shares the same
// ground-idle trimming and smoothing as before.

function drawHatchedRect(ctx, x, y, w, h, color){
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.10;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const step = 7;
  for(let sx = x - h; sx < x + w; sx += step){
    ctx.beginPath();
    ctx.moveTo(sx, y+h);
    ctx.lineTo(sx+h, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x+w, y);
  ctx.moveTo(x, y+h); ctx.lineTo(x+w, y+h);
  ctx.stroke();
  ctx.globalAlpha = 1;
}


function draw(rows){
  const L = layoutChart(rows);
  PLOT = L;
  const {pad, plotW, plotH, Tmin, Tmax, Ymin, Ymax, xScale, yScale,
    hasWind, windRowsAll, speedX0, speedW, speedX1, windColX, rightEdge, sMax, speedScale} = L;

  ctx.clearRect(0,0,L.cssWidth,L.cssHeight);

  const rootStyle = getComputedStyle(document.documentElement);
  const cv = name => rootStyle.getPropertyValue(name).trim();
  const cIsobar = cv('--grid-isobar');
  const cIso = cv('--grid-isotherm');
  const cAdia = cv('--grid-adiabat');
  const cMoist = cv('--grid-moist');
  const cWindLine = cv('--wind-line');
  const cWindBarb = cv('--wind-barb');
  const cInversion = cv('--inversion');
  const cText = cv('--text');
  const cTextDim = cv('--text-dim');
  const cLine = cv('--line');
  const cPlotBg = cv('--plot-bg');
  const cPlotBg2 = cv('--plot-bg-2');
  const fullRight = hasWind ? rightEdge : (pad.left+plotW);
  const compact = !!L.compact;
  const altLabelX = compact ? pad.left-40 : pad.left-56;
  // In compact mode the axis columns are narrow: drop the unit suffix of the
  // altitude labels (it is shown once in the axis title instead).
  const fmtAxisAlt = (alt, ground) => compact ? formatAltitude(alt, ground).replace(' AMSL','').replace(' AGL','') : formatAltitude(alt, ground);
  // Adaptive label density: S2 was laid out for wide desktop charts; on
  // narrower canvases the axis labels are thinned so they never overlap.
  const pxPer25hPa = Math.abs(yScale(yOf(800)) - yScale(yOf(825)));
  const pLabelStep = pxPer25hPa >= 12 ? 25 : (pxPer25hPa*2 >= 12 ? 50 : 100);
  const altLabelStep = Math.max(50, pLabelStep);
  let tLabelStep = 5;
  while(tLabelStep < 40 && plotW/((Tmax-Tmin)/tLabelStep) < (compact ? 26 : 30)) tLabelStep *= 2;

  // panel backgrounds
  ctx.fillStyle = cPlotBg;
  ctx.fillRect(pad.left, pad.top, plotW, plotH);
  if(hasWind){
    ctx.fillStyle = cPlotBg2;
    ctx.fillRect(speedX0-4, pad.top, speedW+8, plotH);
  }

  // ---------- Isobars: solid horizontal pressure lines, spanning the FULL
  // chart width (main plot + wind panels) — this is the defining reference
  // grid of a Stüve diagram, so it is drawn brightest/most prominent and
  // un-clipped, behind everything else.
  ctx.font = '10px IBM Plex Mono, monospace';
  ctx.lineWidth = 1;
  ctx.strokeStyle = cIsobar;
  ctx.setLineDash([]);
  for(let p=1050;p>=50;p-=25){
    const y = yScale(yOf(p));
    if(y < pad.top-2 || y > pad.top+plotH+2) continue;
    const bold = (p%50===0);
    ctx.lineWidth = bold ? 1.3 : 0.8;
    ctx.globalAlpha = bold ? 0.9 : 0.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(fullRight, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign='right'; ctx.textBaseline='middle';
  ctx.fillStyle = cTextDim;
  for(let p=1050;p>=50;p-=25){
    if(p % pLabelStep !== 0) continue;
    const y = yScale(yOf(p));
    if(y < pad.top-2 || y > pad.top+plotH+2) continue;
    ctx.fillText(compact ? String(p) : (p+' hPa'), pad.left-6, y);
  }
  // effective altitude in the selected unit, interpolated from the real
  // sounding data, shown in its own column clearly left of the pressure
  // labels (right-aligned, same as the pressure column, so the two never
  // run into each other regardless of unit-string length)
  ctx.fillStyle = cText;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.font = '9px IBM Plex Mono, monospace';
  const groundAltM = rows[0][1];
  const altLabelYs = [];
  for(let p=1050;p>=50;p-=50){
    if(p % altLabelStep !== 0) continue;
    const y = yScale(yOf(p));
    if(y < pad.top-2 || y > pad.top+plotH+2) continue;
    const alt = altitudeAtPressure(rows, p);
    if(alt!=null){
      ctx.fillText(fmtAxisAlt(alt, groundAltM), altLabelX, y);
      altLabelYs.push(y);
    }
  }
  // transition-altitude marker on the axis, when displaying Flight Levels —
  // right-aligned in the same column as the regular altitude labels
  if(state.altitudeUnit === 'fl' && state.transitionAltFt){
    const taAltM = state.transitionAltFt/3.28084;
    const taP = pressureAtAltitude(rows, taAltM);
    if(taP!=null){
      const yTA = yScale(yOf(taP));
      if(yTA >= pad.top-2 && yTA <= pad.top+plotH+2){
        ctx.strokeStyle = cv('--amber');
        ctx.lineWidth = 1.4;
        ctx.setLineDash([2,2]);
        ctx.beginPath();
        ctx.moveTo(pad.left-50, yTA);
        ctx.lineTo(pad.left-4, yTA);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cv('--amber');
        ctx.font = 'bold 9px IBM Plex Mono, monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(`TA ${state.transitionAltFt}ft`, altLabelX, yTA-2);
        ctx.fillStyle = cText;
      }
    }
  }
  // explicit label at the very top of the axis (the extended headroom band
  // usually doesn't land exactly on a 50 hPa gridline, so it would
  // otherwise go unlabeled)
  {
    const pTopAxis = pOf(Ymin);
    const yTop = yScale(Ymin);
    const altTop = altitudeAtPressure(rows, pTopAxis);
    // skip when a regular altitude label already sits within 12 px
    if(altTop!=null && !altLabelYs.some(y=>Math.abs(y-(yTop+7)) < 12)){
      ctx.textBaseline = 'top';
      ctx.font = '9px IBM Plex Mono, monospace';
      ctx.fillStyle = cText;
      ctx.textAlign = 'right';
      ctx.fillText(fmtAxisAlt(altTop, groundAltM), altLabelX, yTop+2);
      ctx.textBaseline = 'middle';
    }
  }

  // ---------- Ground/launch-site elevation baseline ----------
  const groundY = yScale(yOf(rows[0][2]));
  if(groundY >= pad.top-2 && groundY <= pad.top+plotH+2){
    ctx.strokeStyle = '#3fae5a';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pad.left, groundY);
    ctx.lineTo(fullRight, groundY);
    ctx.stroke();
    ctx.fillStyle = '#3fae5a';
    ctx.font = 'bold 10px IBM Plex Mono, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${fmtAxisAlt(rows[0][1], rows[0][1])} · ${compact ? 'GND' : 'MODEL GROUND'}`, pad.left+4, groundY-3);
  }

  // ---------- Freezing level & tropopause markers ----------
  const thermoMarkers = computeThermo(rows);
  if(thermoMarkers){
    if(thermoMarkers.freezeP!=null){
      const fy = yScale(yOf(thermoMarkers.freezeP));
      if(fy >= pad.top-2 && fy <= pad.top+plotH+2){
        ctx.strokeStyle = '#2f7fbf';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5,3]);
        ctx.beginPath();
        ctx.moveTo(pad.left, fy);
        ctx.lineTo(fullRight, fy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#2f7fbf';
        ctx.font = 'bold 9.5px IBM Plex Mono, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(`0°C · ${fmtAxisAlt(thermoMarkers.freezeAlt, rows[0][1])}`, pad.left+4, fy-2);
      }
    }
    if(thermoMarkers.tropoP!=null){
      const ty = yScale(yOf(thermoMarkers.tropoP));
      if(ty >= pad.top-2 && ty <= pad.top+plotH+2){
        ctx.strokeStyle = '#9a7fd1';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4,3]);
        ctx.beginPath();
        ctx.moveTo(pad.left, ty);
        ctx.lineTo(fullRight, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#9a7fd1';
        ctx.font = '9.5px IBM Plex Mono, monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText(`Tropopause · ${fmtAxisAlt(thermoMarkers.tropoAlt, rows[0][1])}`, compact ? pad.left+plotW-4 : fullRight-4, ty+2);
      }
    }
  }

  // ---------- Main T/Td plot: inversions, isotherms, adiabats, moist adiabats, data (clipped) ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.left, pad.top, plotW, plotH);
  ctx.clip();
  // Skew-T: shear the whole plot's content sideways in proportion to height,
  // anchored at the bottom axis (which stays put). Every existing drawing
  // call below (isotherms, adiabats, data curves, shading, ...) already
  // just uses xScale(T)/yScale(y) — this single transform makes all of it
  // render correctly skewed with no other code changes needed. The clip
  // rectangle above was set BEFORE this transform, so it stays an upright
  // rectangle in screen space (as on a real skew-T chart) while the
  // isotherms etc. cross it at an angle.
  if(state.diagramType === 'skewt'){
    const skewPxPerRow = 0.6;
    const yBottom = pad.top + plotH;
    ctx.transform(1, 0, -skewPxPerRow, 1, skewPxPerRow*yBottom, 0);
  }

  // Notable-layer shading: inversions (temp rises with height, gray hatch)
  // and isothermal layers (temp ~constant with height, blue hatch).
  const inversions = detectInversions(rows);
  inversions.forEach(({p0,p1})=>{
    const yA = yScale(yOf(p0)), yB = yScale(yOf(p1));
    const top = Math.min(yA,yB), h = Math.max(Math.abs(yA-yB), 1.5);
    drawHatchedRect(ctx, pad.left, top, plotW, h, cTextDim);
  });
  const isoLayers = detectIsothermalLayers(rows);
  isoLayers.forEach(({p0,p1})=>{
    const yA = yScale(yOf(p0)), yB = yScale(yOf(p1));
    const top = Math.min(yA,yB), h = Math.max(Math.abs(yA-yB), 1.5);
    drawHatchedRect(ctx, pad.left, top, plotW, h, cIso);
  });

  // Continuous humidity shading: every height band gets a light gray wash
  // starting at the configurable threshold, growing darker toward saturation
  // — a softer, more informative complement to the discrete "cloud layer" boxes below.
  ctx.save();
  const cloudThresh = state.cloudThreshold;
  const cloudRange = Math.max(100-cloudThresh, 1e-6);
  for(let i=0;i<rows.length-1;i++){
    const rh = (rows[i][4]+rows[i+1][4])/2;
    if(rh <= cloudThresh) continue;
    const alpha = Math.min(1, (rh-cloudThresh)/cloudRange) * 0.38;
    const yA = yScale(yOf(rows[i][2])), yB = yScale(yOf(rows[i+1][2]));
    const top2 = Math.min(yA,yB), h2 = Math.max(Math.abs(yA-yB), 1);
    ctx.fillStyle = '#7a7a7a';
    ctx.globalAlpha = alpha;
    ctx.fillRect(pad.left, top2, plotW, h2);
  }
  ctx.restore();

  // Cloud layers: sustained RH >= 95% bands — pale cyan wash, no hatching
  // (kept visually distinct from the inversion/isothermal hatch patterns).
  const cloudLayers = detectCloudLayers(rows);
  ctx.save();
  cloudLayers.forEach(({p0,p1})=>{
    const yA = yScale(yOf(p0)), yB = yScale(yOf(p1));
    const top = Math.min(yA,yB), h = Math.max(Math.abs(yA-yB), 1.5);
    ctx.fillStyle = '#7fd4e8';
    ctx.globalAlpha = 0.16;
    ctx.fillRect(pad.left, top, plotW, h);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#7fd4e8';
    ctx.setLineDash([3,2]);
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, top, plotW, h);
    ctx.setLineDash([]);
  });
  ctx.restore();

  // Convective cloud-development band: from LCL up to the top of the
  // parcel's positive buoyancy — the layer where cumulus growth is expected.
  const convBand = computeConvectiveBand(rows, computeThermo(rows));
  if(convBand){
    const yA = yScale(yOf(convBand.p0)), yB = yScale(yOf(convBand.p1));
    const top = Math.min(yA,yB), h = Math.max(Math.abs(yA-yB), 1.5);
    ctx.save();
    ctx.fillStyle = '#8a95a6';
    ctx.globalAlpha = 0.16;
    ctx.fillRect(pad.left, top, plotW, h);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#8a95a6';
    ctx.setLineDash([2,3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, top, plotW, h);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Saturation mixing ratio lines (g/kg) — curved, faint, standard
  // background element on professional soundings/Stüve diagrams.
  ctx.strokeStyle = '#5fae7a';
  ctx.setLineDash([1,4]);
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = 0.55;
  const pTopMix = pOf(Ymin);
  const pBotMix = pOf(Ymax);
  [1,2,4,7,10,16,24].forEach(rsGkg=>{
    ctx.beginPath();
    let started = false;
    for(let p=pBotMix; p>=pTopMix-10; p-=15){
      const T = tempForMixingRatio(rsGkg, p);
      const x = xScale(T), y = yScale(yOf(p));
      if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    }
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // Isotherms (vertical, every 5°C)
  ctx.strokeStyle = cIso;
  ctx.setLineDash([1,3]);
  ctx.lineWidth = 1.1;
  for(let t=Math.ceil(Tmin/5)*5; t<=Tmax; t+=5){
    const x = xScale(t);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top+plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Dry adiabats — denser grid, every 5K. Sampled at multiple pressure
  // levels (not just 2 endpoints) via the Poisson formula, so they render
  // correctly as straight lines in Stüve and as curves in Emagram mode.
  ctx.strokeStyle = cAdia;
  ctx.setLineDash([6,4]);
  ctx.lineWidth = 1;
  const pTopAdia = pOf(Ymin), pBotAdia = pOf(Ymax);
  for(let theta=-40; theta<=110; theta+=5){
    const thetaK = theta+273.15;
    ctx.beginPath();
    let started = false;
    for(let p=pBotAdia; p>=pTopAdia-10; p-=20){
      const TK = thetaK*Math.pow(p/P0, KAPPA);
      const x = xScale(TK-273.15), y = yScale(yOf(p));
      if(!started){ ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }

  // Moist adiabats — denser grid, every 5°C starting temperature
  ctx.strokeStyle = cMoist;
  ctx.setLineDash([2,3]);
  ctx.lineWidth = 1.1;
  const pTop = pOf(Ymin);
  for(let T0=-15; T0<=40; T0+=5){
    const pts = moistAdiabat(T0, 1000, Math.max(500,pTop-20), -10);
    ctx.beginPath();
    pts.forEach(([p,T],i)=>{
      const x=xScale(T), y=yScale(yOf(p));
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // ---------- Parcel path / CAPE & CIN shading / LCL marker ----------
  const thermo = computeThermo(rows);
  if(thermo){
    const cParcel = cv('--amber');
    // dry-adiabatic segment: surface to LCL
    ctx.strokeStyle = cParcel;
    ctx.setLineDash([4,3]);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const p0 = thermo.p0, T0 = rows[0][3];
    const steps = 12;
    for(let i=0;i<=steps;i++){
      const p = p0 + (thermo.lcl.p-p0)*(i/steps);
      const TK = (T0+273.15)*Math.pow(p/p0, KAPPA);
      const x = xScale(TK-273.15), y = yScale(yOf(p));
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
    // moist-adiabatic segment: LCL to sounding top
    ctx.beginPath();
    thermo.moistPts.forEach(([p,T],i)=>{
      const x=xScale(T), y=yScale(yOf(p));
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // CAPE (positive buoyancy) / CIN (negative buoyancy) shading between
    // parcel path and environment temperature curve.
    function parcelTempAtLocal(p){
      if(p >= thermo.lcl.p) return ((T0+273.15)*Math.pow(p/p0, KAPPA))-273.15;
      const pts = thermo.moistPts;
      for(let i=0;i<pts.length-1;i++){
        const [pa,Ta]=pts[i], [pb,Tb]=pts[i+1];
        if(p<=pa && p>=pb){ const f=(pa-p)/(pa-pb||1e-9); return Ta+(Tb-Ta)*f; }
      }
      return pts[pts.length-1][1];
    }
    for(let i=0;i<rows.length-1;i++){
      const pA=rows[i][2], pB=rows[i+1][2];
      const TenvA=rows[i][3], TenvB=rows[i+1][3];
      const TpA=parcelTempAtLocal(pA), TpB=parcelTempAtLocal(pB);
      const positive = (TpA-TenvA + TpB-TenvB) > 0;
      ctx.fillStyle = positive ? '#e0554a' : '#4a90c4';
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.moveTo(xScale(TenvA), yScale(yOf(pA)));
      ctx.lineTo(xScale(TenvB), yScale(yOf(pB)));
      ctx.lineTo(xScale(TpB), yScale(yOf(pB)));
      ctx.lineTo(xScale(TpA), yScale(yOf(pA)));
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // LCL/LFC markers must stay true circles/triangles even in Skew-T mode,
    // where a shear transform is otherwise applied to everything drawn on
    // the chart — so these are drawn with that shear temporarily undone,
    // at the same resulting screen position it would otherwise land at.
    function drawUnskewedAt(logicalX, logicalY, drawFn){
      const dpr = window.devicePixelRatio || 1;
      const m = ctx.getTransform();
      const devicePt = m.transformPoint(new DOMPoint(logicalX, logicalY));
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawFn(devicePt.x/dpr, devicePt.y/dpr);
      ctx.restore();
    }

    // LCL marker
    const lclX = xScale(thermo.lcl.T), lclY = yScale(yOf(thermo.lcl.p));
    drawUnskewedAt(lclX, lclY, (x,y)=>{
      ctx.fillStyle = cParcel;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = cParcel;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI*2);
      ctx.stroke();
    });

    // LFC marker (level of free convection) — where the parcel path
    // actually starts being warmer than the environment (CAPE begins).
    // Drawn as a small triangle to be visually distinct from the LCL circle.
    if(thermo.lfcP!=null){
      const lfcT = parcelTempAtLocal(thermo.lfcP);
      const lfcX = xScale(lfcT), lfcY = yScale(yOf(thermo.lfcP));
      drawUnskewedAt(lfcX, lfcY, (x,y)=>{
        ctx.fillStyle = '#e0554a';
        ctx.beginPath();
        ctx.moveTo(x, y-6);
        ctx.lineTo(x-5.5, y+4);
        ctx.lineTo(x+5.5, y+4);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#8a2f26';
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
  }


  function drawCurve(colIdx, color){
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    strokeDashAwarePath(ctx, rows,
      r => [xScale(r[colIdx]), yScale(yOf(r[2]))],
      r => r[11]===true
    );
  }
  drawCurve(5, cv('--dew'));
  drawCurve(3, cv('--temp'));

  // Real model levels (surface + pressure levels) are marked with dots so the
  // interpolated stretches in between are recognisable as such — model data
  // is far sparser than a radiosonde ascent.
  if(state.showLevelDots !== false && !printMode){
    const dotR = compact ? 2.2 : 2.6;
    rows.forEach(r=>{
      if(r[12]==='agl') return;
      const y = yScale(yOf(r[2]));
      if(y < pad.top-2 || y > pad.top+plotH+2) return;
      ctx.fillStyle = cv('--temp'); ctx.beginPath(); ctx.arc(xScale(r[3]), y, dotR, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = cv('--dew');  ctx.beginPath(); ctx.arc(xScale(r[5]), y, dotR, 0, Math.PI*2); ctx.fill();
    });
  }

  if(state.showThetaE){
    ctx.strokeStyle = '#c76bd1';
    ctx.lineWidth = 1.8;
    strokeDashAwarePath(ctx, rows,
      r => [xScale(thetaE(r[3], r[5], r[2])), yScale(yOf(r[2]))],
      r => r[11]===true,
      [3,3], [6,3]
    );
  }

  // ---------- Comparison flight overlays (dashed) ----------
  state.compareFlights.forEach((cf,ci)=>{
    const c = COMPARE_COLORS[ci] || COMPARE_COLORS[0];
    function drawCurve2(colIdx, color){
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5,3]);
      ctx.beginPath();
      cf.rows.forEach((r,i)=>{
        const x = xScale(r[colIdx]);
        const y = yScale(yOf(r[2]));
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawCurve2(5, c.dew);
    drawCurve2(3, c.temp);
  });

  ctx.restore();

  // main plot border + axis labels
  ctx.strokeStyle = cLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  ctx.fillStyle = cTextDim;
  ctx.font = '11px IBM Plex Mono, monospace';
  ctx.textAlign='center'; ctx.textBaseline='top';
  for(let t=Math.ceil(Tmin/tLabelStep)*tLabelStep; t<=Tmax; t+=tLabelStep){
    ctx.fillText(t+'°', xScale(t), pad.top+plotH+8);
  }
  ctx.textAlign='center';
  ctx.fillStyle = cText;
  ctx.font = '11.5px Inter, sans-serif';
  ctx.fillText('Temperature (°C)', pad.left+plotW/2, L.cssHeight-14);

  // small mode watermark, aligned with the "Windspeed (kt)" panel label
  ctx.fillStyle = cv('--amber');
  ctx.font = 'bold 10px IBM Plex Mono, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(state.diagramType === 'emagram' ? 'EMAGRAM' : state.diagramType === 'skewt' ? 'SKEW-T' : 'STÜVE', pad.left+plotW-6, pad.top-6);

  // ---------- Scrubber marker ----------
  if(state.scrubIdx!=null && rows[state.scrubIdx]){
    const r = rows[state.scrubIdx];
    const y = yScale(yOf(r[2]));
    ctx.save();
    ctx.strokeStyle = cv('--amber');
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5,3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(fullRight, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = cv('--amber');
    [3,5].forEach(colIdx=>{
      const x = xScale(r[colIdx]);
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI*2);
      ctx.fill();
    });
    ctx.restore();
  }

  if(!hasWind) return;

  // ---------- Wind-speed profile curve (own x-scale, in knots) ----------
  ctx.save();
  ctx.beginPath();
  ctx.rect(speedX0-4, pad.top, speedW+8, plotH);
  ctx.clip();

  // vertical gridlines every 10 kt, aligned with the axis numbers below
  ctx.strokeStyle = cIsobar;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([]);
  for(let kt=0; kt<=sMax; kt+=10){
    const x = speedScale(kt);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top+plotH);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.28;
  ctx.setLineDash([2,2]);
  for(let kt=5; kt<=sMax; kt+=10){
    const x = speedScale(kt);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top+plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // speed curve
  ctx.strokeStyle = cWindLine;
  ctx.lineWidth = 1.8;
  strokeDashAwarePath(ctx, windRowsAll,
    r => [speedScale(formatSpeed(r[6])), yScale(yOf(r[2]))],
    r => r[11]===true
  );
  ctx.restore();

  ctx.strokeStyle = cLine;
  ctx.lineWidth = 1;
  ctx.strokeRect(speedX0-4, pad.top, speedW+8, plotH);

  ctx.fillStyle = cTextDim;
  ctx.font = '9px IBM Plex Mono, monospace';
  ctx.textAlign='center'; ctx.textBaseline='top';
  let sLabelStep = 10;
  while(sLabelStep < 200 && speedW/(sMax/sLabelStep) < 24) sLabelStep *= 2;
  for(let v=0; v<=sMax; v+=sLabelStep){
    ctx.fillText(String(v), speedScale(v), pad.top+plotH+6);
  }
  // panel title below the axis numbers, on the same baseline as the
  // "Temperature (°C)" title of the main plot, centred under the curve
  ctx.fillStyle = cWindLine;
  ctx.font = compact ? '10px Inter, sans-serif' : '11.5px Inter, sans-serif';
  ctx.textBaseline='top';
  ctx.fillText((compact ? 'Wind (' : 'Windspeed (')+speedUnitLabel()+')', speedX0+speedW/2, L.cssHeight-14);

  // ---------- Wind barb column ----------
  ctx.strokeStyle = cLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(speedX1+18, pad.top);
  ctx.lineTo(speedX1+18, pad.top+plotH);
  ctx.stroke();

  ctx.fillStyle = cTextDim;
  ctx.font = '10px IBM Plex Mono, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(compact ? 'Dir' : 'Direction', windColX, pad.top-6);

  // One barb (or numeric direction label) per measurement point, thinned
  // to the selected density.
  const barbRows = filterByInterval(windRowsAll, state.barbIntervalSec);
  for(let i=0; i<barbRows.length; i++){
    const r = barbRows[i];
    const yv = yOf(r[2]);
    if(yv<Ymin || yv>Ymax) continue;
    const y = yScale(yv);
    const kt = msToKt(r[6]);
    const dirFrom = windFromDeg(r[7]);
    if(state.windDisplayMode === 'direction'){
      ctx.fillStyle = cWindBarb;
      ctx.font = '10px IBM Plex Mono, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.round(dirFrom)).padStart(3,'0')+'°', windColX, y);
    } else {
      drawWindBarb(ctx, windColX, y, kt, dirFrom, cWindBarb);
    }
  }

  // Position the wind-speed-panel resize handle (hidden entirely in print,
  // or when there's no wind data to resize a panel for).
  const handle = document.getElementById('windPanelHandle');
  if(handle){
    if(hasWind && !printMode){
      handle.style.display = 'flex';
      handle.style.left = speedX0+'px';
      handle.style.top = pad.top+'px';
      handle.style.height = plotH+'px';
    } else {
      handle.style.display = 'none';
    }
  }
}

// ---------- Generic small height-profile chart (rise speed, theta-e, ...) ----------

function drawMiniProfile(canvasId, cardId, rows, getValue, color, unitDecimals){
  const card = document.getElementById(cardId);
  const pts = rows.map((r,i)=>({v:getValue(r), y:yOf(r[2]), interp: r[11]===true, idx:i})).filter(p=>p.v!=null && isFinite(p.v));
  for(let k=1;k<pts.length;k++){
    if(pts[k].idx - pts[k-1].idx > 4) pts[k].interp = true;
  }
  if(pts.length < 5){ card.style.display='none'; return; }
  card.style.display = 'block';

  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  if(cssWidth <= 0) return; // hidden ancestor (e.g. "print without panels") — nothing to draw
  const cssHeight = printMode ? 80 : Math.max(200, Math.min(300, cssWidth*0.6));
  canvas.width = cssWidth*dpr; canvas.height = cssHeight*dpr;
  const miniOverlay = document.getElementById(canvasId.replace('Canvas','CursorOverlay'));
  if(miniOverlay){
    miniOverlay.width = cssWidth*dpr; miniOverlay.height = cssHeight*dpr;
    miniOverlay.style.width = cssWidth+'px';
    miniOverlay.style.height = cssHeight+'px';
  }
  canvas.style.height = cssHeight+'px';
  const mctx = canvas.getContext('2d');
  mctx.setTransform(dpr,0,0,dpr,0,0);
  mctx.clearRect(0,0,cssWidth,cssHeight);

  const rootStyle = getComputedStyle(document.documentElement);
  const cv2 = n => rootStyle.getPropertyValue(n).trim();
  const cLine2 = cv2('--grid-strong'), cTextDim2 = cv2('--text-dim');

  const pad = {left:44, right:14, top:10, bottom:26};
  const plotW = cssWidth-pad.left-pad.right, plotH = cssHeight-pad.top-pad.bottom;
  const vMin = Math.min(...pts.map(p=>p.v)), vMax = Math.max(...pts.map(p=>p.v));
  const vPad = Math.max((vMax-vMin)*0.08, 0.1);
  const xMin = vMin-vPad, xMax = vMax+vPad;
  const yMin = Math.min(...pts.map(p=>p.y))-0.004, yMax = Math.max(...pts.map(p=>p.y))+0.004;
  const xScale2 = v => pad.left + (v-xMin)/(xMax-xMin)*plotW;
  const yScale2 = y => pad.top + (y-yMin)/(yMax-yMin)*plotH;

  mctx.strokeStyle = cLine2;
  mctx.lineWidth = 1;
  mctx.strokeRect(pad.left, pad.top, plotW, plotH);

  // horizontal gridlines at pressure levels (matching the main chart's isobars)
  mctx.save();
  mctx.beginPath();
  mctx.rect(pad.left, pad.top, plotW, plotH);
  mctx.clip();
  mctx.strokeStyle = cLine2;
  mctx.globalAlpha = 0.55;
  mctx.lineWidth = 0.8;
  mctx.fillStyle = cTextDim2;
  mctx.font = '8px IBM Plex Mono, monospace';
  mctx.textAlign = 'left'; mctx.textBaseline = 'bottom';
  for(let p=1050; p>=50; p-=50){
    const y = yScale2(yOf(p));
    if(y < pad.top-1 || y > pad.top+plotH+1) continue;
    mctx.beginPath();
    mctx.moveTo(pad.left, y);
    mctx.lineTo(pad.left+plotW, y);
    mctx.stroke();
    mctx.globalAlpha = 0.9;
    mctx.fillText(p+'', pad.left+2, y-1);
    mctx.globalAlpha = 0.55;
  }
  // vertical gridlines at the value-axis tick positions
  for(let s=0;s<=4;s++){
    const v = xMin + (xMax-xMin)*(s/4);
    const x = xScale2(v);
    mctx.beginPath();
    mctx.moveTo(x, pad.top);
    mctx.lineTo(x, pad.top+plotH);
    mctx.stroke();
  }
  mctx.globalAlpha = 1;
  mctx.restore();

  if(xMin<0 && xMax>0){
    mctx.strokeStyle = cLine2;
    mctx.globalAlpha = 0.8;
    mctx.beginPath();
    mctx.moveTo(xScale2(0), pad.top);
    mctx.lineTo(xScale2(0), pad.top+plotH);
    mctx.stroke();
    mctx.globalAlpha = 1;
  }

  mctx.strokeStyle = color;
  mctx.lineWidth = 1.8;
  strokeDashAwarePath(mctx, pts,
    p => [xScale2(p.v), yScale2(p.y)],
    p => p.interp
  );

  mctx.fillStyle = cTextDim2;
  mctx.font = '9.5px IBM Plex Mono, monospace';
  mctx.textAlign = 'center'; mctx.textBaseline = 'top';
  const steps = 4;
  for(let s=0;s<=steps;s++){
    const v = xMin + (xMax-xMin)*(s/steps);
    mctx.fillText(v.toFixed(unitDecimals), xScale2(v), pad.top+plotH+6);
  }
  const result = {pad, plotW, plotH, xMin, xMax, yMin, yMax, xScale: xScale2, yScale: yScale2, pts, rows};
  MINI_PLOTS[canvasId] = result;
  return result;
}

// ---------- Flight-path map (Leaflet + OpenStreetMap tiles) ----------
function getZoomAltRange(){
  const rows = state.rows;
  const zoomed = (state.viewMinPct>0 || (state.viewMaxPct!=null && state.viewMaxPct<1000));
  if(!rows || rows.length<2 || !zoomed) return {zoomed:false, altLo:-Infinity, altHi:Infinity, tLo:-Infinity, tHi:Infinity};
  const dataAlts = rows.map(r=>r[1]);
  const dataAltMin = Math.min(...dataAlts), dataAltMax = Math.max(...dataAlts);
  const altLo = dataAltMin + (dataAltMax-dataAltMin)*(state.viewMinPct||0)/1000;
  const altHi = dataAltMin + (dataAltMax-dataAltMin)*(state.viewMaxPct!=null?state.viewMaxPct:1000)/1000;
  const inBand = rows.filter(r=>r[1]>=altLo && r[1]<=altHi);
  let tLo = -Infinity, tHi = Infinity;
  if(inBand.length){
    const times = inBand.map(r=>parseCsvTime(r[0])).filter(isFinite);
    if(times.length){ tLo = Math.min(...times); tHi = Math.max(...times); }
  }
  return {zoomed:true, altLo, altHi, tLo, tHi};
}
function getZoomedRows(){
  const rows = state.rows;
  if(!rows || rows.length<2) return rows;
  const {zoomed, altLo, altHi} = getZoomAltRange();
  if(!zoomed) return rows;
  const filtered = rows.filter(r=>r[1]>=altLo && r[1]<=altHi);
  return filtered.length>=2 ? filtered : rows;
}

function drawHodograph(rows){
  const card = document.getElementById('hodoCard');
  const windRows = activeWindRows(rows);
  if(windRows.length < 2){ card.style.display='none'; return; }
  card.style.display = 'block';

  const canvas2 = document.getElementById('hodoCanvas');
  const dpr = window.devicePixelRatio || 1;
  if(canvas2.parentElement.clientWidth <= 0) return; // hidden ancestor (e.g. "print without panels") — nothing to draw
  const size = printMode ? Math.min(84, canvas2.parentElement.clientWidth) : Math.min(300, canvas2.parentElement.clientWidth*0.8);
  canvas2.width = size*dpr; canvas2.height = size*dpr;
  canvas2.style.width = size+'px';
  canvas2.style.height = size+'px';
  const hodoOverlay = document.getElementById('hodoCursorOverlay');
  if(hodoOverlay){
    hodoOverlay.width = size*dpr; hodoOverlay.height = size*dpr;
    hodoOverlay.style.width = size+'px';
    hodoOverlay.style.height = size+'px';
  }
  const hctx = canvas2.getContext('2d');
  hctx.setTransform(dpr,0,0,dpr,0,0);
  hctx.clearRect(0,0,size,size);

  const rootStyle = getComputedStyle(document.documentElement);
  const cv2 = n => rootStyle.getPropertyValue(n).trim();
  const cLine2 = cv2('--grid-strong'), cTextDim2 = cv2('--text-dim'), cText2 = cv2('--text');

  // pick one sample per ~25 hPa level (same levels as the wind barbs) so the
  // hodograph isn't dominated by 1 Hz sensor noise.
  const levels = [];
  for(let p=1050;p>=50;p-=25){
    const nearest = nearestByPressure(windRows, p);
    if(nearest && Math.abs(nearest[2]-p) <= 15) levels.push(nearest);
  }
  if(levels.length < 2){ card.style.display='none'; return; }

  const pts = levels.map(r=>{
    const kt = msToKt(r[6]);
    const dirFrom = windFromDeg(r[7]);
    const rad = dirFrom*Math.PI/180;
    // vector wind points TOWARD where the air is going (opposite of "from")
    const u = kt*Math.sin(rad+Math.PI);
    const v = kt*Math.cos(rad+Math.PI);
    return {u, v, p: r[2], alt: r[1], interp: r[11]===true};
  });

  const maxSpeed = Math.max(...pts.map(p=>Math.sqrt(p.u*p.u+p.v*p.v)));
  const ringMax = Math.max(20, Math.ceil((maxSpeed+3)/10)*10);
  const cx = size/2, cy = size/2, R = size/2 - 34;
  const scale = R/ringMax;

  // range rings
  hctx.strokeStyle = cLine2;
  hctx.fillStyle = cTextDim2;
  hctx.font = '9px IBM Plex Mono, monospace';
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  for(let r=10; r<=ringMax; r+=10){
    hctx.beginPath();
    hctx.arc(cx, cy, r*scale, 0, Math.PI*2);
    hctx.globalAlpha = (r%20===0) ? 0.7 : 0.35;
    hctx.stroke();
    hctx.globalAlpha = 1;
    hctx.fillText(String(r), cx + r*scale, cy - 7);
  }
  // cross axes + N/E/S/W
  hctx.beginPath();
  hctx.moveTo(cx-R-14, cy); hctx.lineTo(cx+R+14, cy);
  hctx.moveTo(cx, cy-R-14); hctx.lineTo(cx, cy+R+14);
  hctx.globalAlpha = 0.5; hctx.stroke(); hctx.globalAlpha = 1;
  hctx.fillStyle = cText2;
  hctx.font = '11px IBM Plex Mono, monospace';
  hctx.fillText('N', cx, cy-R-22);
  hctx.fillText('S', cx, cy+R+22);
  hctx.fillText('E', cx+R+22, cy);
  hctx.fillText('W', cx-R-22, cy);

  // wind vector path, colored from ground (cool) to peak (warm)
  hctx.lineWidth = 2;
  for(let i=0;i<pts.length-1;i++){
    const f = i/(pts.length-1);
    const col = `rgb(${Math.round(80+150*f)}, ${Math.round(140-60*f)}, ${Math.round(200-140*f)})`;
    hctx.strokeStyle = col;
    hctx.setLineDash((pts[i].interp || pts[i+1].interp) ? [3,3] : []);
    hctx.beginPath();
    hctx.moveTo(cx+pts[i].u*scale, cy-pts[i].v*scale);
    hctx.lineTo(cx+pts[i+1].u*scale, cy-pts[i+1].v*scale);
    hctx.stroke();
    hctx.setLineDash([]);
    hctx.fillStyle = col;
    hctx.beginPath();
    hctx.arc(cx+pts[i].u*scale, cy-pts[i].v*scale, 2.5, 0, Math.PI*2);
    hctx.fill();
  }
  const last = pts[pts.length-1];
  hctx.beginPath();
  hctx.arc(cx+last.u*scale, cy-last.v*scale, 2.5, 0, Math.PI*2);
  hctx.fill();

  HODO_PLOT = {cx, cy, scale, pts};
}
let HODO_PLOT = null;
let MINI_PLOTS = {};

let LAST_ANALYTICS_CTX = null;
let LAST_ANALYTICS_ROWS = null;

const hodoTooltip = document.getElementById('hodoTooltip');
document.getElementById('hodoCanvas').addEventListener('mousemove', (e)=>{
  if(!HODO_PLOT) return;
  const canvas2 = document.getElementById('hodoCanvas');
  const rect = canvas2.getBoundingClientRect();
  const mx = e.clientX-rect.left, my = e.clientY-rect.top;
  const {cx,cy,scale,pts} = HODO_PLOT;
  let best=-1, bestD=Infinity;
  pts.forEach((p,i)=>{
    const x=cx+p.u*scale, y=cy-p.v*scale;
    const d=(x-mx)*(x-mx)+(y-my)*(y-my);
    if(d<bestD){bestD=d;best=i;}
  });
  if(best<0) return;
  const p = pts[best];
  const speedKt = Math.sqrt(p.u*p.u+p.v*p.v);
  const dirTo = (Math.atan2(p.u,p.v)*180/Math.PI+360)%360;
  const dirFrom = (dirTo+180)%360;
  hodoTooltip.style.display = 'block';
  hodoTooltip.style.left = Math.min(mx+16, rect.width-170)+'px';
  hodoTooltip.style.top = Math.max(my-46,4)+'px';
  hodoTooltip.innerHTML = `
    <div class="hdr">${Math.round(p.p)} hPa level</div>
    <div class="row"><span class="lbl">Wind</span><span>${speedKt.toFixed(0)} kt / ${dirFrom.toFixed(0)}°</span></div>
  `;
});
document.getElementById('hodoCanvas').addEventListener('mouseleave', ()=>{ hodoTooltip.style.display='none'; });

function setupMiniProfileTooltip(canvasId, tooltipId, unitLabel, unitDecimals){
  const canvas2 = document.getElementById(canvasId);
  const tip = document.getElementById(tooltipId);
  canvas2.addEventListener('mousemove', (e)=>{
    const plot = MINI_PLOTS[canvasId];
    if(!plot) return;
    const rect = canvas2.getBoundingClientRect();
    const mx = e.clientX-rect.left, my = e.clientY-rect.top;
    let best=-1, bestD=Infinity;
    plot.pts.forEach((p,i)=>{
      const y = plot.yScale(p.y);
      const d = Math.abs(y-my);
      if(d<bestD){bestD=d;best=i;}
    });
    if(best<0) return;
    const p = plot.pts[best];
    tip.style.display = 'block';
    tip.style.left = Math.min(mx+14, rect.width-150)+'px';
    tip.style.top = Math.max(my-46,4)+'px';
    tip.innerHTML = `
      <div class="hdr">${Math.round(p.p)} hPa</div>
      <div class="row"><span class="lbl">${unitLabel}</span><span>${p.v.toFixed(unitDecimals)}</span></div>
    `;
  });
  canvas2.addEventListener('mouseleave', ()=>{ tip.style.display='none'; });
}
setupMiniProfileTooltip('riseCanvas', 'riseTooltip', 'Vertical velocity', 2);
setupMiniProfileTooltip('thetaECanvas', 'thetaETooltip', 'Theta-E', 0);



function nearestPoint(mx,my){
  if(!PLOT) return null;
  const {rows,yScale} = PLOT;
  let best=-1, bestD=Infinity;
  for(let i=0;i<rows.length;i++){
    const y = yScale(yOf(rows[i][2]));
    const d = Math.abs(y-my);
    if(d<bestD){bestD=d;best=i;}
  }
  return best>=0 ? rows[best] : null;
}

// Shared inspect routine for mouse hover (desktop) and touch inspect
// (phone/tablet, wired up in app.js): mx/my are CSS-pixel coordinates
// relative to the main chart canvas.
function chartInspectAt(mx, my){
  const rect = canvas.getBoundingClientRect();

  // Wind-speed sub-panel: show a wind-specific tooltip when hovering there.
  if(PLOT && PLOT.hasWind && mx >= PLOT.speedX0-6 && mx <= PLOT.speedX1+6){
    const windRows = PLOT.windRowsAll;
    let best=-1, bestD=Infinity;
    windRows.forEach((r,i)=>{
      const x = PLOT.speedScale(formatSpeed(r[6])), y = PLOT.yScale(yOf(r[2]));
      const d = (x-mx)*(x-mx)+(y-my)*(y-my);
      if(d<bestD){ bestD=d; best=i; }
    });
    if(best>=0){
      const r = windRows[best];
      tooltip.style.display='block';
      tooltip.style.left = Math.min(mx+16, rect.width-190)+'px';
      tooltip.style.top = Math.max(my-50,4)+'px';
      tooltip.innerHTML = `
        <div class="hdr">${r[0]} UTC</div>
        <div class="row"><span class="lbl">Altitude</span><span>${formatAltitude(r[1], state.rows[0][1])}</span></div>
        <div class="row"><span class="lbl">Pressure</span><span>${r[2].toFixed(1)} hPa</span></div>
        <div class="row"><span class="lbl">Wind</span><span>${formatSpeed(r[6]).toFixed(0)} ${speedUnitLabel()} / ${windFromDeg(r[7]).toFixed(0)}°</span></div>
      `;
      if(PLOT){
        drawChartCursorDot(PLOT.xScale(r[3]), PLOT.yScale(yOf(r[2])));
        highlightCrossPanels(r);
      }
      return;
    }
  }

  const pt = nearestPoint(mx,my);
  if(!pt){ tooltip.style.display='none'; clearChartCursorDot(); clearCrossPanels(); return; }
  tooltip.style.display='block';
  tooltip.style.left = Math.min(mx+16, rect.width-190)+'px';
  tooltip.style.top = Math.max(my-70,4)+'px';
  tooltip.innerHTML = `
    <div class="hdr">${pt[0]} UTC</div>
    <div class="row"><span class="lbl">Altitude</span><span>${formatAltitude(pt[1], state.rows[0][1])}</span></div>
    <div class="row"><span class="lbl">Pressure</span><span>${pt[2].toFixed(1)} hPa</span></div>
    <div class="row"><span class="lbl">Temp</span><span>${pt[3].toFixed(1)} °C</span></div>
    <div class="row"><span class="lbl">Dew point</span><span>${pt[5].toFixed(1)} °C</span></div>
    <div class="row"><span class="lbl">RH</span><span>${pt[4].toFixed(0)} %</span></div>
    ${pt[6]!=null && pt[7]!=null ? `<div class="row"><span class="lbl">Wind</span><span>${formatSpeed(pt[6]).toFixed(0)} ${speedUnitLabel()} / ${windFromDeg(pt[7]).toFixed(0)}°</span></div>` : ''}
    ${state.showThetaE ? `<div class="row"><span class="lbl">Theta-E</span><span>${thetaE(pt[3], pt[5], pt[2]).toFixed(0)} °C-eq</span></div>` : ''}
  `;
  if(PLOT){
    const dotX = PLOT.xScale(pt[3]), dotY = PLOT.yScale(yOf(pt[2]));
    drawChartCursorDot(dotX, dotY);
    const dewX = PLOT.xScale(pt[5]);
    if(dewX >= PLOT.pad.left && dewX <= PLOT.pad.left+PLOT.plotW){
      const c0 = document.getElementById('chartCursorOverlay');
      paintSecondaryMarker(c0.getContext('2d'), dewX, dotY, 5);
    }
    if(state.showThetaE){
      const teX = PLOT.xScale(thetaE(pt[3], pt[5], pt[2]));
      if(teX >= PLOT.pad.left && teX <= PLOT.pad.left+PLOT.plotW){
        const c = document.getElementById('chartCursorOverlay');
        paintSecondaryMarker(c.getContext('2d'), teX, dotY, 5);
      }
    }
    highlightCrossPanels(pt);
  }
}
function chartInspectEnd(){ tooltip.style.display='none'; clearChartCursorDot(); clearCrossPanels(); }
canvas.addEventListener('mousemove', (e)=>{
  if(e.pointerType === 'touch' || window.SC_TOUCH_ACTIVE) return;
  const rect = canvas.getBoundingClientRect();
  chartInspectAt(e.clientX-rect.left, e.clientY-rect.top);
});
canvas.addEventListener('mouseleave', ()=>{ if(!window.SC_TOUCH_ACTIVE) chartInspectEnd(); });

function clearChartCursorDot(){
  const c = document.getElementById('chartCursorOverlay');
  if(!c) return;
  const octx = c.getContext('2d');
  octx.clearRect(0,0,c.width,c.height);
}
function paintPrimaryMarker(octx, x, y){
  const glow = octx.createRadialGradient(x,y,0,x,y,14);
  glow.addColorStop(0,'rgba(255,60,40,0.55)');
  glow.addColorStop(1,'rgba(255,60,40,0)');
  octx.fillStyle = glow;
  octx.beginPath();
  octx.arc(x, y, 14, 0, Math.PI*2);
  octx.fill();

  octx.strokeStyle = 'rgba(224,57,43,0.85)';
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.moveTo(x-13,y); octx.lineTo(x-6,y);
  octx.moveTo(x+6,y); octx.lineTo(x+13,y);
  octx.moveTo(x,y-13); octx.lineTo(x,y-6);
  octx.moveTo(x,y+6); octx.lineTo(x,y+13);
  octx.stroke();

  octx.fillStyle = '#ff3c28';
  octx.strokeStyle = '#ffffff';
  octx.lineWidth = 2;
  octx.beginPath();
  octx.arc(x, y, 6.5, 0, Math.PI*2);
  octx.fill();
  octx.stroke();
}
function paintSecondaryMarker(octx, x, y, r){
  r = r || 4.5;
  const glow = octx.createRadialGradient(x,y,0,x,y,r*2);
  glow.addColorStop(0,'rgba(255,60,40,0.45)');
  glow.addColorStop(1,'rgba(255,60,40,0)');
  octx.fillStyle = glow;
  octx.beginPath();
  octx.arc(x, y, r*2, 0, Math.PI*2);
  octx.fill();

  const tickInner = r+2, tickOuter = r+6;
  octx.strokeStyle = 'rgba(224,57,43,0.85)';
  octx.lineWidth = 1.1;
  octx.beginPath();
  octx.moveTo(x-tickOuter,y); octx.lineTo(x-tickInner,y);
  octx.moveTo(x+tickInner,y); octx.lineTo(x+tickOuter,y);
  octx.moveTo(x,y-tickOuter); octx.lineTo(x,y-tickInner);
  octx.moveTo(x,y+tickInner); octx.lineTo(x,y+tickOuter);
  octx.stroke();

  octx.fillStyle = '#ff3c28';
  octx.strokeStyle = '#ffffff';
  octx.lineWidth = 1.4;
  octx.beginPath();
  octx.arc(x, y, r, 0, Math.PI*2);
  octx.fill();
  octx.stroke();
}
function clearOverlayCanvas(id){
  const c = document.getElementById(id);
  if(!c) return;
  const dpr = window.devicePixelRatio || 1;
  const octx = c.getContext('2d');
  octx.setTransform(dpr,0,0,dpr,0,0);
  octx.clearRect(0,0,c.width/dpr,c.height/dpr);
}
// Strokes a polyline through `points`, switching between a solid and a
// dashed line style depending on `isInterp`. Crucially, this groups
// consecutive segments that share the same dash state into a single
// continuous path/stroke — stroking every 2-point segment separately (with
// setLineDash reset each time) makes a dash pattern look solid whenever
// segments are short relative to the dash length, since the pattern never
// gets to reach its "gap" phase.
function strokeDashAwarePath(ctx, points, getXY, isInterp, dashPattern, normalDash){
  dashPattern = dashPattern || [3,3];
  normalDash = normalDash || [];
  if(points.length < 2) return;
  let i = 0;
  while(i < points.length-1){
    const dashed = isInterp(points[i]) || isInterp(points[i+1]);
    let j = i;
    while(j < points.length-1 && (isInterp(points[j]) || isInterp(points[j+1])) === dashed){
      j++;
    }
    ctx.setLineDash(dashed ? dashPattern : normalDash);
    ctx.beginPath();
    const p0 = getXY(points[i]);
    ctx.moveTo(p0[0], p0[1]);
    for(let k=i+1;k<=j;k++){
      const p = getXY(points[k]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
    i = j;
  }
  ctx.setLineDash([]);
}

function drawChartCursorDot(x,y){
  const c = document.getElementById('chartCursorOverlay');
  if(!c) return;
  const dpr = window.devicePixelRatio || 1;
  const octx = c.getContext('2d');
  octx.setTransform(dpr,0,0,dpr,0,0);
  octx.clearRect(0,0,c.width/dpr,c.height/dpr);
  paintPrimaryMarker(octx, x, y);
  return octx;
}

// Mirrors the main chart's hover height across the wind-speed curve, the
// nearest wind barb, and all four side panels (hodograph, rise-speed,
// Theta-E, flight-path map), so it's clear at a glance where that same
// altitude sits on every other view.
function highlightCrossPanels(row){
  const p = row[2], targetY = yOf(p);

  // wind speed curve + nearest barb, on the same main-chart overlay
  if(PLOT && PLOT.hasWind && row[6]!=null){
    const c = document.getElementById('chartCursorOverlay');
    const octx = c.getContext('2d');
    const yPix = PLOT.yScale(targetY);
    paintSecondaryMarker(octx, PLOT.speedScale(formatSpeed(row[6])), yPix, 4);
    if(PLOT.windRowsAll && PLOT.windRowsAll.length){
      const barbRows = filterByInterval(PLOT.windRowsAll, state.barbIntervalSec);
      let best=null, bestD=Infinity;
      barbRows.forEach(r=>{ const d=Math.abs(yOf(r[2])-targetY); if(d<bestD){bestD=d;best=r;} });
      if(best) paintSecondaryMarker(octx, PLOT.windColX, PLOT.yScale(yOf(best[2])), 4);
    }
  }

  // hodograph: find the plotted level closest to this height
  if(HODO_PLOT && HODO_PLOT.pts && HODO_PLOT.pts.length){
    clearOverlayCanvas('hodoCursorOverlay');
    let best=null, bestD=Infinity;
    HODO_PLOT.pts.forEach(pt=>{ const d=Math.abs(pt.p-p); if(d<bestD){bestD=d;best=pt;} });
    if(best){
      const c = document.getElementById('hodoCursorOverlay');
      const octx = c.getContext('2d');
      paintSecondaryMarker(octx, HODO_PLOT.cx+best.u*HODO_PLOT.scale, HODO_PLOT.cy-best.v*HODO_PLOT.scale, 4);
    }
  } else clearOverlayCanvas('hodoCursorOverlay');

  // rise-speed / theta-e mini profiles
  ['riseCanvas','thetaECanvas'].forEach(canvasId=>{
    const overlayId = canvasId.replace('Canvas','CursorOverlay');
    const plot = MINI_PLOTS[canvasId];
    if(!plot || !plot.pts.length){ clearOverlayCanvas(overlayId); return; }
    clearOverlayCanvas(overlayId);
    let best=null, bestD=Infinity;
    plot.pts.forEach(pt=>{ const d=Math.abs(pt.y-targetY); if(d<bestD){bestD=d;best=pt;} });
    if(best){
      const c = document.getElementById(overlayId);
      const octx = c.getContext('2d');
      paintSecondaryMarker(octx, plot.xScale(best.v), plot.yScale(best.y), 4);
    }
  });

}

function clearCrossPanels(){
  ['hodoCursorOverlay','riseCursorOverlay','thetaECursorOverlay'].forEach(clearOverlayCanvas);
}

