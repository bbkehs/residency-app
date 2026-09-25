import { api } from './api';
const dbPromise = new Promise((resolve, reject) => {
  const request = indexedDB.open('cohort-private-v1', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('records');
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function operation(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('records', mode); const request = fn(transaction.objectStore('records'));
    transaction.oncomplete = () => resolve(request?.result); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}
export const cache = { get: key => operation('readonly', s => s.get(key)), set: (key, value) => operation('readwrite', s => s.put(value, key)), delete: key => operation('readwrite', s => s.delete(key)), clear: () => operation('readwrite', s => s.clear()) };
export const queueKey = userId => `${userId}:outbox`;
export const loadQueue = async userId => (await cache.get(queueKey(userId))) || [];
export async function enqueue(userId, sessionId, observation, currentVersion) {
  const queue = await loadQueue(userId);
  const previous = queue.filter(o => o.sessionId === sessionId && o.studentId === observation.studentId).at(-1);
  if (previous?.error) throw new Error('RESOLVE_SYNC_ERROR');
  const entry = { ...observation, operationId: crypto.randomUUID(), sessionId, version: previous ? previous.version + 1 : currentVersion, recordedAt: new Date().toISOString() };
  queue.push(entry); await cache.set(queueKey(userId), queue); return queue;
}
let syncing = null;
export function syncQueue(userId) {
  if (syncing) return syncing;
  syncing = (async () => {
    let queue = await loadQueue(userId);
    const blocked = new Set(queue.filter(o => o.error).map(o => o.sessionId + o.studentId));
    for (const entry of [...queue]) {
      const group = entry.sessionId + entry.studentId;
      if (blocked.has(group)) continue;
      try {
        const response = await api('/attendance/sync', { method: 'POST', body: { actorId: userId, operations: [entry] } });
        const result = response.results[0];
        if (!result.ok) { const error = new Error(result.error); error.code = result.error; error.status = 409; throw error; }
        const saved = await cache.get(`${userId}:session:${entry.sessionId}`);
        if (saved) {
          const row = saved.rows.find(r => r.student._id === entry.studentId);
          if (row) row.observations = [...row.observations.filter(o => !(o.observerId === userId && o.role === 'rep')), result.observation];
          await cache.set(`${userId}:session:${entry.sessionId}`, saved);
        }
        queue = queue.filter(q => q.operationId !== entry.operationId);
        await cache.set(queueKey(userId), queue);
      } catch (e) {
        if (['NETWORK_ERROR','CSRF_FAILED','ORIGIN_REJECTED'].includes(e.code) || e.status === 401 || !e.status || e.status >= 500) throw e;
        queue = queue.map(q => q.sessionId === entry.sessionId && q.studentId === entry.studentId ? { ...q, error: e.code || e.message } : q);
        blocked.add(group); await cache.set(queueKey(userId), queue);
      }
    }
    return queue;
  })().finally(() => { syncing = null; });
  return syncing;
}
