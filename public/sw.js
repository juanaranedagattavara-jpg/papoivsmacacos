// Service worker: red primero, caché como respaldo (permite abrir el juego sin conexión para jugar vs bots).
const CACHE = 'pvm-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'style.css', 'game.js', 'manifest.webmanifest', 'icon.svg'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).pathname.startsWith('/ws')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html'))),
  );
});
