// Renders the S2/StueveCast chart with a real (node) canvas for a visual check.
// Usage: node test/render.js  -> writes test/out/chart-phone.png and chart-ipad.png
const fs = require('fs'), path = require('path'), vm = require('vm');
const {createCanvas, DOMPoint: NapiDOMPoint} = require('@napi-rs/canvas');
const ROOT = path.join(__dirname, '..');
fs.mkdirSync(path.join(__dirname, 'out'), {recursive: true});

const canvases = {};
const elements = {};
function el(id){
  if(elements[id]) return elements[id];
  const e = {id, style:{}, dataset:{}, classList:{toggle(){},add(){},remove(){},contains(){return false;}}, innerHTML:'', textContent:'', value:'0',
    clientWidth: 900, clientHeight: 520, listeners:{}, addEventListener(){}, removeEventListener(){}, getBoundingClientRect(){ return {left:0,top:0,width:this.clientWidth,height:this.clientHeight}; },
    querySelector(){return null;}, querySelectorAll(){return [];}, appendChild(){}, remove(){}, closest(){return null;}, setAttribute(){}};
  e.parentElement = {clientWidth: 900, clientHeight: 400};
  if(/canvas|chart|Overlay/i.test(id)){
    let c = createCanvas(900, 600);
    Object.defineProperty(e, 'width', {get(){ return c.width; }, set(v){ c.width = Math.max(1,Math.round(v)); }});
    Object.defineProperty(e, 'height', {get(){ return c.height; }, set(v){ c.height = Math.max(1,Math.round(v)); }});
    e.getContext = () => c.getContext('2d');
    canvases[id] = c;
    e._get = () => c;
  }
  elements[id] = e; return e;
}
const light = process.argv.includes('--dark') ? '' : 'light';
const cssVars = light ? {
  '--bg':'#f4f5f7','--panel':'#ffffff','--panel-2':'#eef0f3','--plot-bg':'#ffffff','--plot-bg-2':'#f4f6f9','--line':'#d7dce3','--grid-isobar':'#8b96a6',
  '--grid-isotherm':'#5f95c9','--grid-adiabat':'#c97a2e','--grid-moist':'#2f8f68','--wind-line':'#8a4fae','--wind-barb':'#2c3846','--grid-strong':'#96a2b3',
  '--inversion':'#d98a1f','--text':'#2a323e','--text-dim':'#667080','--text-strong':'#12161c','--amber':'#b96f14','--temp':'#c9271f','--dew':'#0f7fa0'
} : {
  '--bg':'#0b1017','--panel':'#121926','--panel-2':'#0f1520','--plot-bg':'#0e1420','--plot-bg-2':'#0c111b','--line':'#263143','--grid-isobar':'#3b475c',
  '--grid-isotherm':'#2d5f86','--grid-adiabat':'#a8672f','--grid-moist':'#2f7d63','--wind-line':'#b98fd1','--wind-barb':'#c9d3e3','--grid-strong':'#445370',
  '--inversion':'#f0a63d','--text':'#cfd8e3','--text-dim':'#7c8aa0','--text-strong':'#f2f5f9','--amber':'#f0a63d','--temp':'#ff5f56','--dew':'#4fd0e7'
};
const context = {
  console, document: {getElementById: el, documentElement:{dataset:{theme: light}, classList:{toggle(){},remove(){},add(){}}}, body:{style:{}, dataset:{}, classList:{add(){},remove(){}}},
    createElement(){ return el('_t'+Math.random()); }, querySelector(){return null;}, querySelectorAll(){return [];}, addEventListener(){} },
  navigator:{onLine:true}, localStorage:{getItem:()=>null, setItem(){}, removeItem(){}},
  getComputedStyle: () => ({getPropertyValue: n => cssVars[n] || '#888888'}),
  requestAnimationFrame: f=>setTimeout(f,0), setTimeout, clearTimeout, setInterval, clearInterval, Math, Date, JSON, Object, Array, Number, String, Boolean, Map, Set, Promise, Intl,
  isFinite, parseInt, parseFloat, Infinity, NaN, encodeURIComponent, decodeURIComponent, URLSearchParams, Error, RegExp, devicePixelRatio: 2, innerHeight: 760, innerWidth: 390,
  DOMPoint: NapiDOMPoint || function(x,y){ this.x=x; this.y=y; }, addEventListener(){}, alert(){}, Proxy, URL, MouseEvent: function(){}, File: function(){}, Blob: function(){},
};
context.window = context; context.self = context;
vm.createContext(context);
const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, {filename: f});
['js/core.js','js/info.js','js/models.js','js/openmeteo.js','js/draw.js','js/analytics.js'].forEach(load);
vm.runInContext('function updateAltRangeFill(){}', context);

// realistic-looking summer profile for a 1980 m grid cell
function makeRows(offsetT){
  const ts = '2026-08-26 12:00';
  const z0 = 1980, ps = 800, T0 = 16+offsetT, RH0 = 55;
  const rows = [[ts, z0, ps, T0, RH0, context.magnusDewpoint(T0, RH0), 3.5, (250+180)%360, 46.96, 9.39, null, false, 'sfc']];
  const levels = [750,700,650,600,550,500,450,400,350,300,250,200,150,100,70,50,30];
  levels.forEach(p=>{
    const z = 44330.8*(1-Math.pow(p/1013.25, 0.190263)); const dz = (z-z0)/1000;
    let T = T0 - 6.2*dz + (dz>1.0 && dz<1.5 ? 3.5 : 0); if(z>11500) T = -57 + (z-11500)/1000*1.5;
    const RH = z<3000 ? 75 : (z<5500 ? 92 : (z<9000 ? 35 : 15));
    const ws = 4 + dz*2.6 + (z>9000 ? 8 : 0), wd = (240 + dz*8) % 360;
    rows.push([ts, z, p, T, RH, context.magnusDewpoint(T, RH), ws, (wd+180)%360, 46.96, 9.39, -0.08*Math.sin(dz/2), false, 'lvl']);
  });
  [80,120,180].forEach(h=>{ const z=z0+h; const p = ps*Math.exp(-h/8400*1.02); rows.splice(1+[80,120,180].indexOf(h), 0, [ts, z, p, T0-0.6*h/100, RH0, context.magnusDewpoint(T0-0.6*h/100, RH0), 5+h/40, (255+180)%360, 46.96, 9.39, null, false, 'agl']); });
  rows.sort((a,b)=>a[1]-b[1]);
  return rows;
}
const S = context, G = e => vm.runInContext(e, context);
const state = G('state');
state.rows = makeRows(0);
state.compareFlights = [{rows: makeRows(1.5), source:'GFS', key:'gfs_global'}];

function renderAt(width, name){
  el('chart').parentElement.clientWidth = width;
  el('altRangeTrack').clientHeight = 500;
  S.renderLegend(); S.draw(state.rows);
  const c = canvases['chart'];
  fs.writeFileSync(path.join(__dirname, 'out', name), c.toBuffer('image/png'));
  console.log('wrote', name, c.width+'x'+c.height, 'compact=', G('PLOT.compact'), 'plotW=', Math.round(G('PLOT.plotW')), 'speedW=', Math.round(G('PLOT.speedW')));
}
renderAt(390, 'chart-phone.png');
state.speedPanelWidth = 36;
renderAt(390, 'chart-phone-narrow-wind.png');
state.speedPanelWidth = null;
state.diagramType = 'skewt';
renderAt(700, 'chart-ipad-skewt.png');
state.diagramType = 'stuve';
renderAt(700, 'chart-ipad.png');
el('hodoCanvas').parentElement.clientWidth = 300;
S.drawHodograph(S.getZoomedRows());
fs.writeFileSync(path.join(__dirname, 'out', 'hodograph.png'), canvases['hodoCanvas'].toBuffer('image/png'));
console.log('done');
