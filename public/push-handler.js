// =====================================================================
// push-handler.js — injected into the generated Workbox service worker via
// vite.config `workbox.importScripts`. Handles Web Push events (callback
// reminders) and notification clicks (deep-link straight into the lead).
// =====================================================================

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'AVNIDEEP CRM', body: 'New notification' };
  }
  const title = data.title || 'Callback Reminder';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: Array.isArray(data.vibrate) ? data.vibrate : [200, 100, 200],
    sound: data.sound || undefined,
    // One notification per lead — replacing any previous reminder for the
    // same lead prevents duplicate stacked notifications on one device.
    tag: `callback-${data.data?.leadId || 'x'}`,
    renotify: true,
    data: { leadId: data.data?.leadId, customerId: data.data?.customerId },
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  const notif = event.notification;
  notif.close();
  const leadId = notif.data && notif.data.leadId;
  // HashRouter — deep-link to Lead Center and open that lead's customer.
  const target = `${self.registration.scope}${leadId ? `#/leads?openLead=${leadId}` : '#/leads'}`;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if ('focus' in client) {
          try {
            await client.focus();
            await client.navigate(target);
            return;
          } catch { /* client may be gone — fall through */ }
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});
