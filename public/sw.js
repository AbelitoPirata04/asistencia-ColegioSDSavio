// Service worker de la app: abre rápido y muestra un aviso cuando no hay internet.
// Nunca guarda datos de asistencia ni fotos de personas: eso siempre viene del servidor.
const VERSION = 'savio-v2';
const BASE = ['/offline.html', '/css/panel.css', '/img/logo_pequeno.png', '/img/app/icono-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Páginas: siempre del servidor; sin internet, el aviso
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/offline.html')));
    return;
  }

  // Estilos y scripts: del servidor (para tener siempre lo último); sin internet, la copia
  if (url.pathname.startsWith('/css/') || url.pathname.startsWith('/js/')) {
    e.respondWith(
      fetch(req)
        .then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); } return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Imágenes del colegio e íconos: de la copia (cambian muy poco) y se actualizan por detrás
  if (url.pathname.startsWith('/img/')) {
    e.respondWith(
      caches.match(req).then((guardada) => {
        const red = fetch(req).then((r) => {
          if (r.ok) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(req, copia)); }
          return r;
        }).catch(() => guardada);
        return guardada || red;
      })
    );
  }
  // Lo demás (datos, fotos de personas, descargas): normal, sin guardar nada
});

// ---------- Avisos push: llegó / salió alguien ----------
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { titulo: 'Asistencia Savio', cuerpo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Asistencia Savio', {
    body: d.cuerpo || '',
    icon: '/img/app/icono-192.png',
    badge: '/img/app/insignia-96.png',
    tag: d.tema || undefined,
    lang: 'es-CO',
    data: { url: d.url || '/' }
  }));
});

// Tocar el aviso abre la app (o la trae al frente) en el historial de esa persona
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abiertas) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) return c.navigate(destino);
        return;
      }
    }
    return self.clients.openWindow(destino);
  })());
});
