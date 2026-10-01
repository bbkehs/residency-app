import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import webpush from 'web-push';
import { createApp } from '../src/app.js';
import { User, LoginSession, Notification, PushSubscription, PushDelivery, initializeIndexes } from '../src/models.js';
import { hashPassword } from '../src/security.js';
import { deliverOne, retryDelay, revokeSessions } from '../src/push.js';
import { notify } from '../src/services.js';

const keys = webpush.generateVAPIDKeys();
const env = { PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
const origin = 'http://localhost:5173'; const password = 'Test-notifications-2026!';
let mongo, app, user, other, a, b;
function subscription(endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) {
  const key = createECDH('prime256v1'); key.generateKeys();
  return { publicKey: keys.publicKey, language: 'en', subscription: { endpoint, expirationTime: null, keys: { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } } };
}
async function login(account) {
  const agent = request.agent(app);
  const result = await agent.post('/api/auth/login').set('Origin', origin).send({ username: account.username, password }).expect(200);
  return { agent, csrf: result.body.csrf, get: p => agent.get('/api' + p), send: (method, p, body = {}) => agent[method]('/api' + p).set('Origin', origin).set('X-CSRF-Token', result.body.csrf).send(body) };
}
async function enqueue(recipient = user._id) {
  await mongoose.connection.transaction(tx => notify(tx, [recipient], 'leave_approved', 'private-entity'));
  return PushDelivery.findOne({ state: 'queued' }).sort({ createdAt: -1 }).lean();
}
const noSend = async () => { assert.fail('Unexpected push transport call'); };
before(async () => {
  Object.assign(process.env, env);
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: process.platform === 'win32' ? [] : ['--nounixsocket'] }], binary: { version: process.env.MONGOMS_VERSION || '7.0.24' } });
  await mongoose.connect(mongo.getUri()); await initializeIndexes(); app = createApp({ origin });
  const passwordHash = await hashPassword(password);
  user = await User.create({ username: 'push-user', name: 'Private resident name', departmentId: 'department', cohortId: 'cohort', kind: 'student', status: 'active', passwordHash });
  other = await User.create({ username: 'other-user', name: 'Other resident', departmentId: 'other-department', cohortId: 'other-cohort', kind: 'student', status: 'active', passwordHash });
});
beforeEach(async () => {
  await Promise.all([LoginSession.deleteMany({}), PushSubscription.deleteMany({}), PushDelivery.deleteMany({}), Notification.deleteMany({})]);
  await User.updateMany({}, { $set: { status: 'active', authVersion: 0, mustChangePassword: false } });
  a = await login(user); b = await login(other);
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('subscription routes enforce authentication, CSRF, trusted endpoints, and key validation', async () => {
  const input = subscription();
  await request(app).get('/api/push/config').expect(401);
  await a.agent.post('/api/push/subscriptions').set('Origin', origin).send(input).expect(403);
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://fcm.googleapis.com.evil.example/x', 'https://fcm.googleapis.com:444/x', 'https://user:password@fcm.googleapis.com/x']) {
    await a.send('post', '/push/subscriptions', subscription(endpoint)).expect(422);
  }
  await a.send('post', '/push/subscriptions', { ...input, userId: other._id }).expect(422);
  await a.send('post', '/push/subscriptions', { ...input, subscription: { ...input.subscription, keys: { ...input.subscription.keys, auth: 'invalid' } } }).expect(422);
  await a.send('post', '/push/subscriptions', { ...input, publicKey: 'stale' }).expect(409);
  const config = await a.get('/push/config').expect(200);
  assert.deepEqual(Object.keys(config.body).sort(), ['configured', 'publicKey']);
});
test('subscriptions are login-scoped, secret-free on reads, and cannot be adopted by another user', async () => {
  const input = subscription(); const result = await a.send('post', '/push/subscriptions', input).expect(201);
  assert.deepEqual(Object.keys(result.body.subscription).sort(), ['_id', 'language', 'publicKey']);
  const current = await a.get('/push/subscriptions/current').expect(200);
  assert.equal(current.body.subscription._id, result.body.subscription._id);
  assert.equal((await b.get('/push/subscriptions/current')).body.subscription, null);
  await b.send('post', '/push/subscriptions', input).expect(409);
  const db = await PushSubscription.findById(result.body.subscription._id).lean();
  assert.equal(db.endpoint, undefined); assert.equal(db.keys, undefined);
  await a.send('patch', '/push/subscriptions/current', { language: 'fa' }).expect(200);
  assert.equal((await PushSubscription.findById(db._id)).language, 'fa');
});
test('notifications and delivery queue commit or roll back together', async () => {
  await a.send('post', '/push/subscriptions', subscription()).expect(201);
  await assert.rejects(mongoose.connection.transaction(async tx => { await notify(tx, [user._id], 'leave_approved', 'private'); throw new Error('rollback'); }), /rollback/);
  assert.equal(await Notification.countDocuments(), 0); assert.equal(await PushDelivery.countDocuments(), 0);
  await enqueue(); assert.equal(await Notification.countDocuments(), 1); assert.equal(await PushDelivery.countDocuments(), 1);
});
test('concurrent workers claim once and send only generic localized content', async () => {
  await a.send('post', '/push/subscriptions', { ...subscription(), language: 'fa' }).expect(201); await enqueue();
  let calls = 0;
  const send = async (sub, payload, options) => {
    calls++; const data = JSON.parse(payload);
    assert.equal(data.language, 'fa'); assert.equal(data.title, 'هم‌دوره'); assert.ok(data.subscriptionId);
    assert.ok(!payload.includes('Private resident')); assert.ok(!payload.includes('leave_approved')); assert.ok(!payload.includes('private-entity'));
    assert.equal(options.TTL, 3600); assert.equal(options.timeout, 10000); assert.ok(sub.keys.auth);
  };
  const results = await Promise.all([deliverOne({ send }), deliverOne({ send })]);
  assert.equal(calls, 1); assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await PushDelivery.findOne()).state, 'sent'); assert.equal(await deliverOne({ send: noSend }), false);
});
test('transient failures retry with backoff, then recover; expired subscriptions are removed', async () => {
  await a.send('post', '/push/subscriptions', subscription()).expect(201); const delivery = await enqueue();
  const now = new Date(Date.now() + 1000);
  await deliverOne({ now, send: async () => { throw { statusCode: 429, headers: { 'retry-after': '120' } }; } });
  let saved = await PushDelivery.findById(delivery._id);
  assert.equal(saved.state, 'queued'); assert.equal(saved.nextAttemptAt.getTime(), now.getTime() + 120000);
  assert.equal(await deliverOne({ now, send: noSend }), false);
  await deliverOne({ now: saved.nextAttemptAt, send: async () => {} });
  assert.equal((await PushDelivery.findById(delivery._id)).state, 'sent');
  await enqueue(); await deliverOne({ send: async () => { throw { statusCode: 410 }; } });
  assert.equal(await PushSubscription.countDocuments(), 0);
  assert.equal(await PushDelivery.countDocuments({ failureCode: 'SUBSCRIPTION_EXPIRED' }), 1);
  assert.equal(retryDelay(1, '999999'), 3600000);
});
test('permanent provider failure stops retries and exhausted leases respect attempt limit', async () => {
  await a.send('post', '/push/subscriptions', subscription()).expect(201); const delivery = await enqueue();
  await deliverOne({ send: async () => { throw { statusCode: 403 }; } });
  assert.equal((await PushDelivery.findById(delivery._id)).state, 'failed');
  await PushDelivery.updateOne({ _id: delivery._id }, { $set: { state: 'sending', attempts: 6, leaseUntil: new Date(0) } });
  await deliverOne({ send: noSend });
  assert.equal((await PushDelivery.findById(delivery._id)).failureCode, 'RETRY_LIMIT');
});
test('read notifications, suspended accounts, and revoked login sessions are never sent', async () => {
  await a.send('post', '/push/subscriptions', subscription()).expect(201); await enqueue();
  await Notification.updateMany({}, { $set: { readAt: new Date() } }); await deliverOne({ send: noSend });
  await enqueue(); await User.updateOne({ _id: user._id }, { $set: { status: 'suspended' } }); await deliverOne({ send: noSend });
  await User.updateOne({ _id: user._id }, { $set: { status: 'active' } }); await enqueue();
  await LoginSession.deleteMany({ userId: user._id }); await deliverOne({ send: noSend });
  assert.equal(await PushDelivery.countDocuments({ state: 'cancelled' }), 3);
});
test('logout revokes this device; password/session revocation removes all user devices', async () => {
  const second = await login(user);
  await a.send('post', '/push/subscriptions', subscription()).expect(201);
  await second.send('post', '/push/subscriptions', subscription()).expect(201);
  await enqueue(); assert.equal(await PushDelivery.countDocuments(), 2);
  await a.send('post', '/auth/logout').expect(200);
  assert.equal(await PushSubscription.countDocuments({ userId: user._id }), 1);
  assert.equal(await PushDelivery.countDocuments({ state: 'cancelled' }), 1);
  await mongoose.connection.transaction(tx => revokeSessions({ userId: user._id }, tx));
  assert.equal(await PushSubscription.countDocuments(), 0);
  assert.equal(await PushDelivery.countDocuments({ state: 'cancelled' }), 2);
});
test('replacing a subscription cancels old queued work and disabling cancels new work', async () => {
  const input = subscription(); await a.send('post', '/push/subscriptions', input).expect(201); await enqueue();
  await a.send('post', '/push/subscriptions', input).expect(201);
  assert.equal((await PushDelivery.findOne()).failureCode, 'SUBSCRIPTION_REPLACED');
  assert.equal((await PushSubscription.findOne()).version, 2);
  await enqueue(); await a.send('delete', '/push/subscriptions/current').expect(200);
  assert.equal(await PushSubscription.countDocuments(), 0); assert.equal(await PushDelivery.countDocuments({ state: 'cancelled' }), 2);
});
