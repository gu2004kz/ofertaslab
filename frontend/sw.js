const CACHE_NAME = 'ofertaslab-v1';
const urlsToCache = [
  '/',
  '/ofertas',
  '/telegram',
  '/afiliados',
  '/analytics',
  '/configuracoes',
  '/assets/css/style.css',
  '/assets/js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Sem conexão' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(response => response || fetch(event.request))
    );
  }
});

self.addEventListener('push', event => {
  const data = event.data?.json() || { title: 'OFERTASLAB', body: 'Nova oferta disponível!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png'
    })
  );
});
