// StueveCast service worker: offline app shell + cached model data + map tiles.
const VERSION = 'stuevecast-v0.11.5';
const SHELL_CACHE = VERSION + '-shell';
const DATA_CACHE = VERSION + '-data';
const TILE_CACHE = 'stuevecast-tiles';
const TILE_LIMIT = 700;

const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/s2-base.css', './css/app.css',
  './js/core.js', './js/info.js', './js/models.js', './js/openmeteo.js', './js/blend.js', './js/draw.js', './js/analytics.js', './js/app.js',
  './js/qrcode.min.js',
  './js/vendor/leaflet/leaflet.js', './js/vendor/leaflet/leaflet.css',
  './js/vendor/leaflet/images/layers.png', './js/vendor/leaflet/images/layers-2x.png',
  './js/vendor/leaflet/images/marker-icon.png', './js/vendor/leaflet/images/marker-icon-2x.png', './js/vendor/leaflet/images/marker-shadow.png',
  './icons/favicon.svg', './icons/favicon.ico', './icons/apple-touch-icon.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './img/wicki-logo.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // add one by one so a single missing file does not block installation
    await Promise.all(SHELL.map(u => cache.add(u).catch(err => console.warn('SW precache skipped', u, err))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== DATA_CACHE && k !== TILE_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isApi(url){
  return /(^|\.)open-meteo\.com$/.test(url.hostname);
}
function isTile(url){
  return /tile\.openstreetmap\.org$/.test(url.hostname) || /tile\.opentopomap\.org$/.test(url.hostname);
}

async function networkFirst(request, cacheName, timeoutMs){
  const cache = await caches.open(cacheName);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try{
    const res = await fetch(request, {signal: ctrl.signal});
    clearTimeout(timer);
    if(res && res.ok) cache.put(request, res.clone()).catch(()=>{});
    return res;
  }catch(err){
    clearTimeout(timer);
    const cached = await cache.match(request);
    if(cached) return cached;
    throw err;
  }
}

async function cacheFirstTiles(request){
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if(cached) return cached;
  const res = await fetch(request);
  if(res && (res.ok || res.type === 'opaque')){
    cache.put(request, res.clone()).catch(()=>{});
    trimTiles(cache);
  }
  return res;
}
let trimming = false;
async function trimTiles(cache){
  if(trimming) return; trimming = true;
  try{
    const keys = await cache.keys();
    if(keys.length > TILE_LIMIT){
      const excess = keys.slice(0, keys.length - TILE_LIMIT);
      await Promise.all(excess.map(k => cache.delete(k)));
    }
  }finally{ trimming = false; }
}

async function shellStaleWhileRevalidate(request){
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, {ignoreSearch: true});
  const network = fetch(request).then(res => { if(res && res.ok) cache.put(request, res.clone()).catch(()=>{}); return res; }).catch(() => null);
  if(cached){ network.catch(()=>{}); return cached; }
  const res = await network;
  if(res) return res;
  if(request.mode === 'navigate'){
    const index = await cache.match('./index.html');
    if(index) return index;
  }
  return new Response('Offline', {status: 503, statusText: 'Offline'});
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(isApi(url)){
    event.respondWith(networkFirst(req, DATA_CACHE, 20000));
  } else if(isTile(url)){
    event.respondWith(cacheFirstTiles(req));
  } else if(url.origin === self.location.origin){
    event.respondWith(shellStaleWhileRevalidate(req));
  }
  // everything else (Nominatim, etc.): default browser handling
});
