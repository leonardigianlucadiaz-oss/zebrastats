/* ZebraStats Service Worker — v4 */
// Fix #13: CACHE_VERSION é agora usado no nome do cache (incrementar aqui invalida tudo)
const CACHE_VERSION = 4;
const CACHE_NAME    = `zebrastats-v${CACHE_VERSION}`;

// Assets imutáveis — cache-first (icons/images mudam raramente)
const IMMUTABLE_EXT = ['.png','.jpg','.jpeg','.svg','.webp','.woff','.woff2','.ico'];

// Fix #14: adicionados teams-data.js e share.js que estavam faltando
// AVISO: não use query strings (ex: css/main.css?v=12) neste array —
// query strings criam entradas duplicadas no cache e nunca fazem hit.
// Para versionar, mude o nome do arquivo (ex: main.v12.css) ou incremente CACHE_VERSION.
const STATIC_ASSETS = [
  'home.html','zebras.html','ranking.html','partida.html',
  'time.html','liga.html','alertas.html','perfil.html',
  'comparar.html','notificacoes.html','busca.html',
  'assinatura.html','pagamento.html','favoritos.html','explorar.html',
  'css/main.css',
  'js/main.js','js/config.js','js/api.js','js/zebra-engine.js',
  'js/auth.js','js/auth-guard.js','js/db.js',
  'js/teams-data.js','js/share.js', // fix #14
  'manifest.json','icons/icon-192.svg','icons/icon-512.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        // Fix #15: loga erros de pre-cache em vez de engoli-los silenciosamente
        Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] Não foi possível pré-cachear: ${url}`, err.message)
            )
          )
        )
      )
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
  if (url.origin !== self.location.origin) return;

  const isImmutable  = IMMUTABLE_EXT.some(ext => url.pathname.endsWith(ext));
  const isScriptOrStyle = url.pathname.endsWith('.js') || url.pathname.endsWith('.css');

  if (isImmutable) {
    // ── Cache-first para imagens e fontes ──────────────────────
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }));
      })
    );

  } else if (isScriptOrStyle) {
    // ── Fix #20: Stale-While-Revalidate para JS e CSS ──────────
    // Serve do cache imediatamente (zero latência), atualiza em segundo plano.
    // Muito melhor que network-first em conexões instáveis.
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(res => {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          }).catch(() => null);
          // Retorna cache imediatamente; se não tem cache, espera a rede
          return cached || networkFetch;
        })
      )
    );

  } else {
    // ── Network-first para HTML ────────────────────────────────
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request)
          .then(cached => cached || new Response('Offline — reabra quando conectado', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          }))
        )
    );
  }
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────
self.addEventListener('push', e => {
  // TODO: criar icons/badge-72.png monocromático (72x72px)
  let data = { title: 'ZebraStats 🦓', body: 'Nova zebra detectada!', icon: 'icons/icon-192.svg', badge: 'icons/badge-72.png', tag: 'zebra-alert' };
  try {
    if (e.data) {
      const json = e.data.json();
      data = { ...data, ...json };
    }
  } catch {
    if (e.data) data.body = e.data.text();
  }

  e.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon    || 'icons/icon-192.svg',
      badge:   data.badge   || 'icons/badge-72.png',
      tag:     data.tag     || 'zebra-alert',
      data:    { url: data.url || 'partida.html' },
      actions: [
        { action: 'open',    title: 'Ver partida' },
        { action: 'dismiss', title: 'Fechar'      },
      ],
      vibrate:   [200, 100, 200],
      renotify:  true,
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const url = (e.notification.data && e.notification.data.url) ? e.notification.data.url : 'home.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(url));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
