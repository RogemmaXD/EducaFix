const VERSION = 'educafix-v9';
const CORE = [
  './',
  'index.html',
  'css/app.css',
  'js/api-config.js',
  'js/login.js',
  'js/app.js',
  'js/pwa.js',
  'manifest.json',
  'img/icon-192.png',
  'img/icon-512.png'
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;
  if (url.pathname.indexOf('/descargar') >= 0) return;

  const pagina = req.mode === 'navigate';

  ev.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(pagina ? 'index.html' : req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(pagina ? 'index.html' : req).then((c) => c || (pagina ? caches.match('./') : undefined))
      )
  );
});