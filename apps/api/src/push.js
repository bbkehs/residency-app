import { randomUUID, createHash, ECDH } from 'node:crypto';
import webpush from 'web-push';
import { getPushConfig } from './config.js';
import { LoginSession, Notification, PushDelivery, PushSubscription, User } from './models.js';
import { requireThat } from './security.js';

export const endpointHash = value => createHash('sha256').update(value).digest('hex');
export function validateSubscription(subscription, config) {
  let url;
  try { url = new URL(subscription.endpoint); } catch { requireThat(false, 422, 'INVALID_PUSH_ENDPOINT'); }
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash, 422, 'INVALID_PUSH_ENDPOINT');
  requireThat(config.allowedHosts.includes(url.hostname), 422, 'PUSH_HOST_NOT_ALLOWED');
  try {
    const publicKey = Buffer.from(subscription.keys.p256dh, 'base64url');
    const auth = Buffer.from(subscription.keys.auth, 'base64url');
    if (publicKey.length !== 65 || auth.length !== 16 || publicKey.toString('base64url') !== subscription.keys.p256dh || auth.toString('base64url') !== subscription.keys.auth) throw new Error();
    ECDH.convertKey(publicKey, 'prime256v1');
  } catch { requireThat(false, 422, 'INVALID_PUSH_KEYS'); }
}

// Called within the same transaction as the in-app notification. No network I/O here.
export async function enqueuePush(notification, tx) {
  if (!getPushConfig().enabled) return;
  const subscriptions = await PushSubscription.find({ userId: notification.recipientId, expiresAt: { $gt: new Date() } }).session(tx).lean();
  for (const subscription of subscriptions) await PushDelivery.create([{
    notificationId: notification._id, userId: notification.recipientId, subscriptionId: subscription._id, subscriptionVersion: subscription.version,
  }], { session: tx });
}

export async function removePushSubscriptions(filter, tx = null) {
  const ids = (await PushSubscription.find(filter).select('_id').session(tx).lean()).map(s => s._id);
  if (ids.length) {
    await PushDelivery.updateMany({ subscriptionId: { $in: ids }, state: { $in: ['queued', 'sending'] } }, { $set: { state: 'cancelled', failureCode: 'UNSUBSCRIBED' }, $unset: { leaseToken: '', leaseUntil: '' } }).session(tx);
    await PushSubscription.deleteMany({ _id: { $in: ids } }).session(tx);
  }
}
export async function revokeSessions(filter, tx = null) {
  const ids = (await LoginSession.find(filter).select('_id').session(tx).lean()).map(s => s._id);
  await LoginSession.deleteMany({ _id: { $in: ids } }).session(tx);
  await removePushSubscriptions({ loginSessionId: { $in: ids } }, tx);
}

export function retryDelay(attempts, retryAfter, now = new Date()) {
  const base = Math.min(3600000, 30000 * 2 ** Math.max(0, attempts - 1));
  const seconds = typeof retryAfter === 'string' && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : NaN;
  const date = typeof retryAfter === 'string' ? new Date(retryAfter).getTime() - now.getTime() : NaN;
  return Math.min(3600000, Math.max(base, Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date : 0));
}
function payloadFor(delivery, subscription) {
  // Intentionally no names, departments, leave reasons, attendance, or event types.
  const fa = subscription.language === 'fa';
  return JSON.stringify({ title: fa ? 'هم‌دوره' : 'Cohort', body: fa ? 'به‌روزرسانی جدیدی دارید. برای مشاهده وارد برنامه شوید.' : 'You have a new update. Open the app to review it.', tag: delivery.notificationId, subscriptionId: subscription._id, language: subscription.language });
}

export async function deliverOne({ config = getPushConfig(), send = webpush.sendNotification.bind(webpush), now = new Date() } = {}) {
  if (!config.enabled) return false;
  const leaseToken = randomUUID();
  const delivery = await PushDelivery.findOneAndUpdate({
    expiresAt: { $gt: now }, $or: [{ state: 'queued', nextAttemptAt: { $lte: now } }, { state: 'sending', leaseUntil: { $lte: now } }],
  }, { $set: { state: 'sending', leaseToken, leaseUntil: new Date(now.getTime() + 60000) }, $inc: { attempts: 1 } }, { sort: { nextAttemptAt: 1, createdAt: 1 }, new: true }).lean();
  if (!delivery) return false;
  const lease = { _id: delivery._id, state: 'sending', leaseToken };
  const finish = data => PushDelivery.updateOne(lease, { $set: data, $unset: { leaseToken: '', leaseUntil: '' } });
  try {
    const subscription = await PushSubscription.findById(delivery.subscriptionId).select('+endpoint +keys').lean();
    const user = await User.findOne({ _id: delivery.userId, status: 'active', mustChangePassword: false }).lean();
    const login = subscription && user && await LoginSession.exists({ _id: subscription.loginSessionId, userId: user._id, authVersion: user.authVersion, expiresAt: { $gt: now } });
    const notification = await Notification.findOne({ _id: delivery.notificationId, recipientId: delivery.userId }).lean();
    if (!subscription || !user || !login || subscription.userId !== user._id || subscription.version !== delivery.subscriptionVersion || subscription.publicKey !== config.publicKey || subscription.expiresAt <= now || !notification || notification.readAt) {
      await finish({ state: 'cancelled', failureCode: 'NO_LONGER_ELIGIBLE' }); return true;
    }
    if (delivery.attempts > 6) { await finish({ state: 'failed', failureCode: 'RETRY_LIMIT' }); return true; }
    validateSubscription(subscription, config);
    await send({ endpoint: subscription.endpoint, keys: subscription.keys }, payloadFor(delivery, subscription), {
      vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey }, TTL: 3600, timeout: 10000, urgency: 'normal',
    });
    await finish({ state: 'sent', sentAt: now, failureCode: null, lastStatus: 201 });
  } catch (error) {
    const status = Number(error.statusCode) || 0;
    if ([404,410].includes(status)) {
      await PushSubscription.deleteOne({ _id: delivery.subscriptionId, version: delivery.subscriptionVersion });
      await finish({ state: 'cancelled', lastStatus: status, failureCode: 'SUBSCRIPTION_EXPIRED' });
    } else {
      const retryable = !error.status && (!status || status === 429 || status >= 500);
      const retry = retryable && delivery.attempts < 6;
      await finish({ state: retry ? 'queued' : 'failed', lastStatus: status, failureCode: retry ? 'RETRY_SCHEDULED' : 'DELIVERY_REJECTED', nextAttemptAt: new Date(now.getTime() + retryDelay(delivery.attempts, error.headers?.['retry-after'], now)) });
    }
  }
  return true;
}

export function startPushWorker(config = getPushConfig()) {
  let stopped = false; let timer; let running = Promise.resolve();
  if (config.enabled) {
    const tick = () => {
      running = (async () => { for (let i = 0; i < 10 && !stopped; i++) { if (!await deliverOne({ config })) break; } })()
        .catch(() => console.error('Push worker will retry after a database or delivery error.'))
        .finally(() => { if (!stopped) { timer = setTimeout(tick, 10000); timer.unref(); } });
    };
    timer = setTimeout(tick, 1000); timer.unref();
  }
  return { stop: async () => { stopped = true; clearTimeout(timer); await running; } };
}
