const PRECACHE = 'geometra-v2';
const APPLICATION_SERVER_KEY = 'BI2IpPMmOWwihtC8OAeSvXqKuApewLTdDW6HozdYwgG3oHJvNeOWeiF8KRR2mEWPi8OVpjyaagI86gZpURSb_vg';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

function urlB64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function notifyClients(type, payload) {
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      client.postMessage({ type, ...payload });
    }
  });
}

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
    tag: data.notification_id || data.type || 'default',
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
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'navigate' in client) {
          return client.navigate(targetUrl).then(() => client.focus());
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// The browser rotates push subscriptions over time. Re-register with the
// same VAPID application server key and hand the fresh subscription to the
// page, which persists it in push_subscriptions for the active user.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const current = await self.registration.pushManager.getSubscription();
        if (!current) {
          return;
        }
        await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8Array(APPLICATION_SERVER_KEY),
        });
        const next = await self.registration.pushManager.getSubscription();
        if (next) {
          notifyClients('PUSH_SUBSCRIPTION_CHANGED', { subscription: next.toJSON() });
        }
      } catch (err) {
        console.error('Push: pushsubscriptionchange resubscribe failed', err);
      }
    })()
  );
});