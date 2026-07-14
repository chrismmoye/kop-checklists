// King of Pops Checklists — service worker (push notifications + PWA installability)
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network passthrough */ });

self.addEventListener('push', e => {
  let payload = { title: 'King of Pops', body: 'You have a new alert.' };
  try { payload = e.data.json(); } catch { }
  e.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'kop-alert-' + Date.now(),
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow('/');
  }));
});
