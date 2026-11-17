// Garde une copie du site et des données sur le téléphone : la consultation continue si le Wi-Fi du forum sature.
// Réseau d'abord (données toujours à jour quand c'est possible), copie locale sinon.
const CACHE = 'forum-mobile-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (ev) => ev.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const rep = await fetch(req, { cache: 'no-cache' });
      if (rep.ok) cache.put(req, rep.clone());
      return rep;
    } catch (e) {
      const copie = await cache.match(req, { ignoreSearch: true });
      if (copie) return copie;
      throw e;
    }
  })());
});
