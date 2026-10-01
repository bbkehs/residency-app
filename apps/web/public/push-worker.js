/* Push handling runs in the service worker, even when no application tab is open. */
async function activePushContext() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('cohort-push-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('settings', 'readonly').objectStore('settings').get('active');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload; try { payload = event.data?.json(); } catch { return; }
    const context = await activePushContext();
    if (!context || payload?.subscriptionId !== context.subscriptionId || typeof payload.tag !== 'string') return;
    const fa = context.language === 'fa';
    // Render only fixed generic copy, never remote message text or private records.
    await self.registration.showNotification(fa ? 'هم‌دوره' : 'Cohort', {
      body: fa ? 'به‌روزرسانی جدیدی دارید. برای مشاهده وارد برنامه شوید.' : 'You have a new update. Open the app to review it.',
      icon: '/icon-192.png', badge: '/icon-192.png', tag: payload.tag, lang: fa ? 'fa' : 'en', dir: fa ? 'rtl' : 'ltr',
      data: { subscriptionId: context.subscriptionId },
    });
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) client.postMessage({ type: 'COHORT_NOTIFICATION' });
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const context = await activePushContext();
    if (!context || event.notification.data?.subscriptionId !== context.subscriptionId) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (target) { await target.focus(); target.postMessage({ type: 'COHORT_OPEN_NOTIFICATIONS' }); }
    else await self.clients.openWindow('/#notifications');
  })());
});
