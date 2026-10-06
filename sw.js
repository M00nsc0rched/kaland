// Offline-működés: az alkalmazás fájljai a gyorsítótárból indulnak, a háttérben frissülnek.
// Új kiadásnál a VERSION értékét növelni kell.
const VERSION = 'kjk-v2';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/analyze.js', 'js/rules.js', 'js/store.js', 'js/importer.js', 'js/layout.js', 'js/demo.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const RUNTIME = VERSION + '-rt';

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // saját fájlok: azonnal a gyorsítótárból, közben frissítés a hálózatról
    ev.respondWith(caches.open(VERSION).then(async cache => {
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const net = fetch(req).then(res => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || new Response('Offline – nincs elmentve.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }));
    return;
  }
  // betűtípusok és CDN-könyvtárak (pdf.js, szövegfelismerő): első letöltés után offline is
  if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) {
    ev.respondWith(caches.open(RUNTIME).then(async cache => {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    }));
  }
});
