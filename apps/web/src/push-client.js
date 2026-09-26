import { api } from './api';

let dbPromise;
function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('cohort-push-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onsuccess = () => resolve(request.result); request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}
async function stored(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', mode); const request = fn(tx.objectStore('settings'));
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
async function updateContext(expected, changes) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite'); const store = tx.objectStore('settings');
    const request = store.get('active');
    request.onsuccess = () => {
      const current = request.result;
      if (current?.subscriptionId === expected.subscriptionId && current.userId === expected.userId) store.put({ ...current, ...changes }, 'active');
    };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export const pushState = { read: () => stored('readonly', s => s.get('active')), write: context => stored('readwrite', s => s.put(context, 'active')), clear: () => stored('readwrite', s => s.delete('active')) };
export const supportsPush = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function bytes(value) { return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0)); }
function sameKey(value, expected) {
  const a = value ? new Uint8Array(value) : new Uint8Array(); const b = bytes(expected);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
export async function deactivatePush(unsubscribe = false) {
  await pushState.clear();
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return;
  try { for (const notification of await registration.getNotifications()) notification.close(); } catch {}
  if (unsubscribe) try { await (await registration.pushManager.getSubscription())?.unsubscribe(); } catch {}
}
export async function enablePush(user, language, config) {
  if (!supportsPush()) throw new Error('PUSH_UNSUPPORTED');
  if (!config?.configured) throw new Error('PUSH_NOT_CONFIGURED');
  // Request permission from the button gesture, before waiting for network calls.
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('PUSH_PERMISSION_DENIED');
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error('PUSH_NOT_READY');
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, config.publicKey)) { await subscription.unsubscribe(); subscription = null; }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(config.publicKey) });
  const result = await api('/push/subscriptions', { method: 'POST', body: { subscription: subscription.toJSON(), publicKey: config.publicKey, language } });
  await pushState.write({ userId: user._id, subscriptionId: result.subscription._id, language, serverLanguage: language });
  return result.subscription;
}
export async function disablePush() {
  await deactivatePush(true);
  await api('/push/subscriptions/current', { method: 'DELETE', body: {} });
}
export async function syncPushLanguage(userId, language, online) {
  const context = await pushState.read();
  if (!context || context.userId !== userId) return;
  if (context.language !== language) await updateContext(context, { language });
  if (online && context.serverLanguage !== language) {
    await api('/push/subscriptions/current', { method: 'PATCH', body: { language } });
    await updateContext(context, { language, serverLanguage: language });
  }
}

// Revalidate the local binding against the authenticated login after a reload.
export async function reconcilePush(userId) {
  const context = await pushState.read();
  if (!context) return;
  if (context.userId !== userId) { await deactivatePush(true); return; }
  const current = await api('/push/subscriptions/current');
  if (current.subscription?._id !== context.subscriptionId) await deactivatePush(true);
}
