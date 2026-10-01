/* global self, clients, URL */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON: show defaults */
  }
  const n = payload.notification ?? {};
  const link = payload.data?.link ?? '/';
  // iOS revokes push permission from a site that receives a push without showing one,
  // so this must always show something, even for a malformed payload.
  event.waitUntil(
    self.registration.showNotification(n.title ?? 'World Wide War', {
      body: n.body ?? '',
      icon: n.icon ?? '/icon-192.png',
      data: { link },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      return open ? open.navigate(link).then((w) => w?.focus()) : clients.openWindow(link);
    }),
  );
});
