import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../public/push-worker.js', import.meta.url), 'utf8');
function worker(context) {
  const handlers = {}; const shown = []; const opened = []; const messages = [];
  const self = { location: { origin: 'https://cohort.example' }, addEventListener: (name, cb) => { handlers[name] = cb; }, registration: { showNotification: async (...args) => shown.push(args) }, clients: { matchAll: async () => [], openWindow: async url => opened.push(url) } };
  const indexedDB = { open: () => {
    const request = {};
    queueMicrotask(() => { request.result = { close() {}, transaction: () => ({ objectStore: () => ({ get: () => {
      const read = {}; queueMicrotask(() => { read.result = context; read.onsuccess(); }); return read;
    } }) }) }; request.onsuccess(); }); return request;
  } };
  vm.runInNewContext(source, { self, indexedDB, URL });
  const dispatch = (name, event) => new Promise((resolve, reject) => handlers[name]({ ...event, waitUntil: promise => promise.then(resolve, reject) }));
  return { self, dispatch, shown, opened, messages };
}
test('worker renders fixed generic copy, respects Persian, and ignores remote private text', async () => {
  const w = worker({ subscriptionId: 'mine', language: 'fa' });
  await w.dispatch('push', { data: { json: () => ({ subscriptionId: 'mine', tag: 'notification', title: 'Resident name', body: 'Private leave reason' }) } });
  assert.equal(w.shown.length, 1); assert.equal(w.shown[0][0], 'هم‌دوره'); assert.equal(w.shown[0][1].dir, 'rtl');
  assert.ok(!JSON.stringify(w.shown).includes('Private')); assert.ok(!JSON.stringify(w.shown).includes('Resident'));
});
test('worker discards signed-out, different-account, and malformed push events', async () => {
  for (const context of [undefined, { subscriptionId: 'different', language: 'en' }]) {
    const w = worker(context); await w.dispatch('push', { data: { json: () => ({ subscriptionId: 'old', tag: 'notification' }) } }); assert.equal(w.shown.length, 0);
  }
  const w = worker({ subscriptionId: 'mine' }); await w.dispatch('push', { data: { json: () => { throw new Error('bad JSON'); } } }); assert.equal(w.shown.length, 0);
});
test('notification click opens only the app inbox and only for the active binding', async () => {
  const w = worker({ subscriptionId: 'mine' }); let closed = 0;
  await w.dispatch('notificationclick', { notification: { data: { subscriptionId: 'old' }, close: () => closed++ } }); assert.equal(w.opened.length, 0);
  await w.dispatch('notificationclick', { notification: { data: { subscriptionId: 'mine', url: 'https://evil.example' }, close: () => closed++ } });
  assert.deepEqual(w.opened, ['/#notifications']); assert.equal(closed, 2);
});
test('notification click focuses an existing app window and refreshes its inbox', async () => {
  const w = worker({ subscriptionId: 'mine' }); let focused = false; let message;
  w.self.clients.matchAll = async () => [{ url: 'https://cohort.example/#overview', focus: async () => { focused = true; }, postMessage: value => { message = value.type; } }];
  await w.dispatch('notificationclick', { notification: { data: { subscriptionId: 'mine' }, close() {} } });
  assert.equal(focused, true); assert.equal(message, 'COHORT_OPEN_NOTIFICATIONS'); assert.equal(w.opened.length, 0);
});
