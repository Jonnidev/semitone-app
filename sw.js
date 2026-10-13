// Service worker: permite usar la app sin conexión una vez cargada.
// Siempre intenta la red primero, así cada publicación nueva se ve de inmediato;
// la caché solo se usa cuando no hay conexión.
const VERSION = 'trama-v3';
const ASSETS = [
  './', './index.html', './css/app.css',
  './js/app.js', './js/core.js', './js/projects.js', './js/loaders.js', './js/plate-worker.js', './js/ai-worker.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // modelos de IA, fuentes y CDN quedan fuera
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, copy)); }
      return r;
    }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: true }))
  );
});
