// Offline-működés: az alkalmazás saját fájljai internet mellett mindig frissen jönnek a hálózatról
// (így egy új kiadás azonnal megérkezik), internet nélkül a gyorsítótárból indulnak.
// Új kiadásnál a VERSION értékét növelni kell.
const VERSION = 'kjk-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/analyze.js', 'js/rules.js', 'js/store.js', 'js/importer.js', 'js/layout.js', 'js/demo.js', 'js/alap.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];
const RUNTIME = 'kjk-rt'; // a CDN-könyvtárak kiadásonként nem töltődnek le újra

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== RUNTIME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// lassú hálózatnál ne várjon a végtelenségig: néhány másodperc után a mentett példány indul
const timeout = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('timeout')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // a titkosított alaptörténetek (több MB) a böngészőn át mennek: feloldás után úgyis az eszközön tárolódnak,
    // és a lassú letöltést nem szabad a lenti időkorláttal megszakítani
    if (/\/alap\/[^/]+\.kjke$/.test(url.pathname)) return;
    ev.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const nav = req.mode === 'navigate';
      const key = nav ? 'index.html' : req;
      try {
        // a böngésző HTTP-gyorsítótára se adjon régi változatot (a GitHub Pages 10 percig cache-el)
        const res = await timeout(nav ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' }), 5000);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        const hit = await cache.match(key, { ignoreSearch: nav });
        return hit || new Response('Offline – nincs elmentve.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
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
