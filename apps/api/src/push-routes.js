import { Router } from 'express';
import { z } from 'zod';
import { PushDelivery, PushSubscription } from './models.js';
import { getPushConfig } from './config.js';
import { requireThat } from './security.js';
import { mutate } from './services.js';
import { endpointHash, validateSubscription, removePushSubscriptions } from './push.js';

export const pushRouter = Router();
pushRouter.get('/push/config', (req, res) => {
  const config = getPushConfig(); res.json({ configured: config.enabled, ...(config.enabled ? { publicKey: config.publicKey } : {}) });
});
pushRouter.get('/push/subscriptions/current', async (req, res) => {
  const subscription = await PushSubscription.findOne({ userId: req.user._id, loginSessionId: req.loginSession._id, expiresAt: { $gt: new Date() } }).select('_id language publicKey').lean();
  res.json({ subscription: subscription || null });
});
pushRouter.post('/push/subscriptions', async (req, res) => {
  const v = z.object({ publicKey: z.string().max(200), language: z.enum(['en','fa']), subscription: z.object({
    endpoint: z.string().min(10).max(2048), expirationTime: z.number().nonnegative().nullable().optional(),
    keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }).strict(),
  }).strict() }).strict().parse(req.body);
  const config = getPushConfig(); requireThat(config.enabled, 503, 'PUSH_NOT_CONFIGURED');
  requireThat(v.publicKey === config.publicKey, 409, 'PUSH_KEY_CHANGED'); validateSubscription(v.subscription, config);
  const expiresAt = new Date(Math.min(new Date(req.loginSession.expiresAt).getTime(), v.subscription.expirationTime ?? Infinity));
  requireThat(expiresAt > new Date(), 422, 'PUSH_SUBSCRIPTION_EXPIRED');
  const result = await mutate(req, async (actor, tx) => {
    const hash = endpointHash(v.subscription.endpoint);
    const existing = await PushSubscription.findOne({ endpointHash: hash }).session(tx).lean();
    requireThat(!existing || existing.userId === actor._id, 409, 'PUSH_SUBSCRIPTION_IN_USE');
    // Enabling again replaces this login's endpoint; there is one subscription per login.
    // A previously bound login from the same browser may be adopted only by the same user.
    if (existing && existing.loginSessionId !== req.loginSession._id) await removePushSubscriptions({ _id: existing._id }, tx);
    const current = await PushSubscription.findOne({ loginSessionId: req.loginSession._id }).session(tx);
    const data = { userId: actor._id, loginSessionId: req.loginSession._id, endpointHash: hash, endpoint: v.subscription.endpoint, keys: v.subscription.keys, publicKey: config.publicKey, language: v.language, expiresAt };
    if (current) {
      await PushDelivery.updateMany({ subscriptionId: current._id, state: { $in: ['queued','sending'] } }, { $set: { state: 'cancelled', failureCode: 'SUBSCRIPTION_REPLACED' }, $unset: { leaseToken: '', leaseUntil: '' } }).session(tx);
      Object.assign(current, data); current.version++; await current.save({ session: tx });
      return { _id: current._id, language: current.language, publicKey: current.publicKey };
    }
    const [created] = await PushSubscription.create([data], { session: tx });
    return { _id: created._id, language: created.language, publicKey: created.publicKey };
  });
  res.status(201).json({ subscription: result });
});
pushRouter.delete('/push/subscriptions/current', async (req, res) => {
  await mutate(req, async (actor, tx) => removePushSubscriptions({ userId: actor._id, loginSessionId: req.loginSession._id }, tx));
  res.json({ ok: true });
});
pushRouter.patch('/push/subscriptions/current', async (req, res) => {
  const v = z.object({ language: z.enum(['en','fa']) }).strict().parse(req.body);
  const result = await PushSubscription.updateOne({ userId: req.user._id, loginSessionId: req.loginSession._id }, { $set: { language: v.language } });
  requireThat(result.matchedCount, 404, 'NOT_FOUND'); res.json({ ok: true });
});
