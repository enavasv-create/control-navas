/* CONTROL - service worker (uso sin conexión).
 * Funciona en subrutas (GitHub Pages: /control-navas/) porque todas las rutas son relativas.
 * Para publicar una corrección: subir los archivos y cambiar VERSION aquí y APP_VERSION en app.js.
 * No toca los datos del usuario (viven en IndexedDB). */
const VERSION = '1.1.4';
const CACHE = 'control-' + VERSION;
const SHELL = ['./', 'index.html', 'styles.css', 'core.js', 'xlsx.js', 'vault.js', 'app.js',
  'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 'reload' evita que la caché HTTP de GitHub Pages (10 min) entregue archivos viejos; falla completo si falta alguno.
    await Promise.all(SHELL.map(async (u) => {
      const r = await fetch(new Request(u, { cache: 'reload' }));
      if (!r.ok) throw new Error(u + ' -> ' + r.status);
      await c.put(u, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith('control-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true })
      .then((hit) => hit || fetch(req).catch(() => caches.match('index.html')))
  );
});
