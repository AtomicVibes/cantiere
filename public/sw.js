const PRECACHE = 'geometra-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  let data = { title: 'Geometra', body: '' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'Geometra', body: event.data.text() };
    }
  }

  const targetUrl = data.url ||
    (data.type === 'message' ? '/messages' : '/notifications');

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/favicon.svg',
    vibrate: [200, 100, 200],
    tag: data.notification_id || 'default',
    renotify: true,
    requireInteraction: true,
    data: {
      url: targetUrl,
      notification_id: data.notification_id,
      type: data.type,
    },
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NAVIGATE', url: targetUrl });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
