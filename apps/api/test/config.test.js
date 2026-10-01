import { test } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { getPushConfig, validateProductionConfig } from '../src/config.js';
const keys = webpush.generateVAPIDKeys();
const origin = 'http://localhost:5173';
const env = { PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };

test('production configuration validates origin and matching VAPID keys', () => {
  assert.equal(getPushConfig({}).enabled, false);
  assert.equal(getPushConfig(env).publicKey, keys.publicKey);
  assert.throws(() => getPushConfig({ ...env, VAPID_PRIVATE_KEY: webpush.generateVAPIDKeys().privateKey }), /matching/);
  assert.throws(() => getPushConfig({ ...env, PUSH_ALLOWED_HOSTS: '*.example.com' }), /exact DNS/);
  assert.throws(() => validateProductionConfig({ NODE_ENV: 'production', APP_ORIGIN: origin, MONGODB_URI: 'mongodb://localhost/test' }), /HTTPS/);
  assert.throws(() => validateProductionConfig({ APP_ORIGIN: 'https://example.com/path', MONGODB_URI: 'mongodb://localhost/test' }), /only the scheme/);
});
