import { createECDH } from 'node:crypto';

const defaultPushHosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.services.mozilla.com', 'web.push.apple.com'];
export function getPushConfig(env = process.env) {
  if (env.PUSH_ENABLED !== 'true') return { enabled: false };
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(privateKey || '')) throw new Error();
    const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.from(privateKey, 'base64url'));
    if (key.getPublicKey().toString('base64url') !== publicKey) throw new Error();
  } catch { throw new Error('PUSH_ENABLED requires a matching VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. Run npm run push:keys.'); }
  const mailto = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject || '');
  let web = false;
  try { const url = new URL(subject); web = url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.') && url.hostname !== 'localhost'; } catch {}
  if (!mailto && !web) throw new Error('Set VAPID_SUBJECT to an operator contact mailto: address or public HTTPS URL.');
  const extraHosts = (env.PUSH_ALLOWED_HOSTS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (extraHosts.some(h => !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(h) || h === 'localhost')) throw new Error('PUSH_ALLOWED_HOSTS must contain exact DNS hostnames, without wildcards, ports, or URLs.');
  return { enabled: true, publicKey, privateKey, subject, allowedHosts: [...new Set([...defaultPushHosts, ...extraHosts])] };
}
export function validateProductionConfig(env = process.env) {
  if (!env.MONGODB_URI) throw new Error('Set MONGODB_URI. See README.md.');
  const origin = env.APP_ORIGIN || (env.NODE_ENV === 'production' ? '' : 'http://localhost:5173');
  let url;
  try { url = new URL(origin); } catch { throw new Error('APP_ORIGIN must be a complete origin.'); }
  if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('APP_ORIGIN must contain only the scheme, hostname, and optional port, without a trailing slash.');
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Production APP_ORIGIN must use HTTPS.');
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  if (env.TRUST_PROXY && !['true','false'].includes(env.TRUST_PROXY)) throw new Error('TRUST_PROXY must be true or false.');
  return { origin, port, push: getPushConfig(env) };
}
