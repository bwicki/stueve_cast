// ---- StueveCast analytics rendering (ported from S2) ----

function buildAnalyticsCtx(rows){
  const t = computeThermo(rows);
  if(!t) return null;
  const k = computeKIndex(rows);
  const stormPct = kIndexToProbabilityPct(k);
  const cloudPct = estimateCloudCoverPct(rows);
  const shearKt = computeWindShear(rows);
  const dcape = computeDCAPE(rows);
  const pw = computePW(rows);
  const groundAltM = rows[0][1];
  return {t, k, stormPct, cloudPct, shearKt, dcape, pw, groundAltM};
}


function renderThermo(rows){
  const el = document.getElementById('thermoStrip');
  const ctx = buildAnalyticsCtx(rows);
  if(!ctx){ el.innerHTML=''; return; }
  const {t, k, stormPct, cloudPct, shearKt, dcape, pw, groundAltM} = ctx;

  function formatLayers(layers){
    if(layers.length === 0) return 'none detected';
    const alts = layers.map(l => formatAltitude(altitudeAtPressure(rows, (l.p0+l.p1)/2), groundAltM));
    return `${layers.length} layer${layers.length>1?'s':''} @ ${alts.join(', ')}`;
  }
  const invLayers = detectInversions(rows);
  const isoLayers = detectIsothermalLayers(rows);

  const items = [
    ['lcl', 'LCL', `${Math.round(t.lcl.p)} hPa / ${t.lcl.T.toFixed(1)}°C`],
    ['lfc', 'LFC', t.lfcP!=null ? `${Math.round(t.lfcP)} hPa / ${formatAltitude(t.lfcAlt, groundAltM)}` : 'not reached'],
    ['cape', 'CAPE', `${Math.round(t.cape)} J/kg`],
    ['li', 'Lifted Index', t.li!=null ? `${t.li>0?'+':''}${t.li.toFixed(1)} °C` : 'sounding too shallow'],
    ['cin', 'CIN', `${Math.round(t.cin)} J/kg`],
    ['dcape', 'DCAPE', dcape!=null ? `${Math.round(dcape)} J/kg` : 'n/a'],
    ['pw', 'Precipitable water', `${pw.toFixed(1)} mm`],
    ['freezeLevel', 'Freezing level', t.freezeAlt!=null ? formatAltitude(t.freezeAlt, groundAltM) : 'not in sounding'],
    ['tropopause', 'Tropopause', t.tropoAlt!=null ? formatAltitude(t.tropoAlt, groundAltM) : 'not reached'],
    ['thunderstorm', 'Thunderstorm chance (est.)', stormPct!=null ? stormPct+'% (K='+Math.round(k)+')' : 'sounding too shallow'],
    ['cloudCover', 'Cloud cover (est.)', `${cloudPct}% ${octasToMetar(cloudPctToOctas(cloudPct))} · ${cloudPctToOctas(cloudPct)}/8 <span style="font-size:0.75em;">octas</span>`],
    ['shear', '0–6 km bulk shear', shearKt!=null ? Math.round(ktToDisplayUnit(shearKt))+' '+speedUnitLabel() : 'not enough wind data'],
    ['inversions', 'Inversions', formatLayers(invLayers)],
    ['isothermal', 'Isothermal layers', formatLayers(isoLayers)],
  ];
  el.innerHTML = items.map(([key,k,v])=>{
    const info = FIELD_INFO[key];
    const octasBadge = key==='cloudCover'
      ? `<span style="position:absolute;top:3px;right:19px;">${octasSvgIcon(cloudPctToOctas(cloudPct), 17)}</span>`
      : '';
    return `<div class="stat">
      <div class="k">${k}</div><div class="v">${v}</div>
      ${octasBadge}
      ${info ? `<button class="stat-info-btn" data-info-key="${key}">i</button>` : ''}
    </div>`;
  }).join('');

  renderAnalyticalComments(rows, ctx);
  LAST_ANALYTICS_CTX = ctx;
  LAST_ANALYTICS_ROWS = rows;
}

function computeAnalyticalComments(rows, ctx){
  const {t, k, stormPct, dcape, shearKt, groundAltM, cloudPct, pw} = ctx;
  const comments = [];

  // ---- Rain risk (general/stratiform: moisture + cloud cover based) ----
  {
    let level, text;
    if(cloudPct >= 85 && pw >= 30){
      level = 'red';
      text = `High rain risk — overcast-tending cloud cover (${cloudPct}%) with a moist column (PW ${pw.toFixed(1)} mm). Widespread/sustained rain plausible.`;
    } else if(cloudPct >= 50 || pw >= 20){
      level = 'yellow';
      text = `Moderate rain risk — cloud cover ${cloudPct}%, precipitable water ${pw.toFixed(1)} mm.`;
    } else {
      level = 'green';
      text = `Low rain risk — cloud cover ${cloudPct}%, precipitable water ${pw.toFixed(1)} mm.`;
    }
    comments.push({level, text});
  }

  // ---- Thunderstorm risk (convective: CAPE/K-Index/DCAPE based) ----
  {
    let level, text;
    const cape = t.cape;
    if(stormPct==null){
      level = 'gray'; text = `Thunderstorm risk: sounding too shallow to assess (K-Index needs data to 500 hPa).`;
    } else if(stormPct >= 60 || cape >= 1000){
      level = 'red';
      text = `High thunderstorm risk — K-Index ${Math.round(k)} (${stormPct}% est. probability), CAPE ${Math.round(cape)} J/kg. Convective development likely if triggered.`;
    } else if(stormPct >= 30 || cape >= 300){
      level = 'yellow';
      text = `Moderate thunderstorm risk — K-Index ${Math.round(k)} (${stormPct}% est. probability), CAPE ${Math.round(cape)} J/kg. Some convective potential.`;
    } else {
      level = 'green';
      text = `Low thunderstorm risk — K-Index ${Math.round(k)} (${stormPct}% est. probability), CAPE ${Math.round(cape)} J/kg.`;
    }
    if(dcape!=null && dcape >= 800){
      text += ` DCAPE ${Math.round(dcape)} J/kg — strong downdraft/gust potential if a storm does develop.`;
    }
    comments.push({level, text});
  }

  // ---- Wind shear risk ----
  {
    const band = findMaxLocalShearBand(rows);
    let level, text;
    if(shearKt==null){
      level = 'gray'; text = `Wind shear: not enough wind data to assess.`;
    } else if(shearKt >= 40){
      level = 'red';
      text = `High wind shear risk — 0–6 km bulk shear ${Math.round(ktToDisplayUnit(shearKt))} ${speedUnitLabel()}.`;
    } else if(shearKt >= 20){
      level = 'yellow';
      text = `Moderate wind shear risk — 0–6 km bulk shear ${Math.round(ktToDisplayUnit(shearKt))} ${speedUnitLabel()}.`;
    } else {
      level = 'green';
      text = `Low wind shear risk — 0–6 km bulk shear ${Math.round(ktToDisplayUnit(shearKt))} ${speedUnitLabel()}.`;
    }
    if(band && band.shearKt >= 15){
      text += ` Sharpest local change between ${formatAltitude(band.altLo, groundAltM)} and ${formatAltitude(band.altHi, groundAltM)} (≈${Math.round(band.shearKt)} kt over that band) — worth flagging for turbulence.`;
    }
    comments.push({level, text});
  }

  return comments;
}

function renderAnalyticalComments(rows, ctx){
  const el = document.getElementById('analyticalCommentsList');
  const comments = computeAnalyticalComments(rows, ctx);
  const dotColor = {green:'#3fae5a', yellow:'#e0b23f', red:'#e0554a', gray:'#8a95a6'};
  el.innerHTML = comments.map(c=>
    `<div style="display:flex;gap:10px;align-items:flex-start;">
      <span style="flex-shrink:0;width:12px;height:12px;border-radius:50%;background:${dotColor[c.level]};
        margin-top:3px;box-shadow:0 0 0 1px rgba(0,0,0,.15);"></span>
      <span style="color:var(--text);line-height:1.5;">${c.text}</span>
    </div>`
  ).join('') + `<div style="font-size:9.5px;color:var(--text-dim);margin-top:2px;">
    Automated qualitative assessment from this single sounding — not a substitute for an official forecast.
  </div>`;
}

function openInfoModal(key){
  const info = FIELD_INFO[key];
  if(!info) return;
  const content = document.getElementById('infoModalContent');
  const actualFn = FIELD_ACTUAL[key];
  const actualHtml = (actualFn && LAST_ANALYTICS_CTX) ? actualFn(LAST_ANALYTICS_CTX, LAST_ANALYTICS_ROWS) : null;
  content.innerHTML = `
    <h2>${info.label}</h2>
    <h3>Derivation</h3>
    ${info.derivation}
    <h3>What it means</h3>
    ${info.meaning}
    <h3>Interpretation</h3>
    ${info.interpretation}
    ${actualHtml ? `<h3>Interpretation of the actual value</h3>${actualHtml}` : ''}
    <h3>Model data note</h3>
    <p>${(typeof FIELD_MODEL_NOTES !== 'undefined' && FIELD_MODEL_NOTES[key]) || FIELD_MODEL_NOTES_GENERIC}</p>
    <h3>Further reading</h3>
    <ul class="im-links">
      ${info.links.map(l=>`<li><a href="${l.url}" target="_blank" rel="noopener">${l.label} ↗</a></li>`).join('')}
    </ul>
  `;
  document.getElementById('infoModalOverlay').style.display = 'flex';
}
function closeInfoModal(){
  document.getElementById('infoModalOverlay').style.display = 'none';
}
document.getElementById('infoModalClose').addEventListener('click', closeInfoModal);
document.getElementById('infoModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'infoModalOverlay') closeInfoModal();
});
document.getElementById('infoModalPdf').addEventListener('click', ()=>{
  document.body.classList.add('printing-info-modal');
  window.print();
});
window.addEventListener('afterprint', ()=>{
  document.body.classList.remove('printing-info-modal');
});
