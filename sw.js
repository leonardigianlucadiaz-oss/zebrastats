/* ZebraStats Service Worker — cache-first for static assets */
const CACHE_NAME = 'zebrastats-v1';

const STATIC_ASSETS = [
  'home.html', 'zebras.html', 'ranking.html', 'partida.html',
  'time.html', 'liga.html', 'alertas.html', 'perfil.html',
  'comparar.html', 'notificacoes.html', 'busca.html',
  'assinatura.html', 'pagamento.html', 'favoritos.html', 'explorar.html',
  'css/main.css', 'js/main.js', 'js/config.js', 'js/api.js',
  'manifest.json', 'icons/icon-192.svg', 'icons/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Only cache same-origin requests
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});
