import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { LoginSession, User } from './models.js';
const scrypt = promisify(scryptCallback);
export const hashToken = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const result = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${result.toString('hex')}`;
}
export async function verifyPassword(password, encoded) {
  const [, salt, hash] = (encoded || '').split(':');
  if (!salt || !hash) { await scrypt(password, 'constant-dummy-salt-for-timing', 64); return false; }
  const candidate = await scrypt(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}
export function fail(status, code) { const e = new Error(code); e.status = status; e.code = code; throw e; }
export function requireThat(value, status = 403, code = 'FORBIDDEN') { if (!value) fail(status, code); }
export function publicUser(user) {
  const { _id, username, name, departmentId, cohortId, approvalCohortId, kind, isRep, status, mustChangePassword } = user;
  return { _id, username, name, departmentId, cohortId, approvalCohortId, kind, isRep, status, mustChangePassword };
}
export function cookieOptions() { return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/' }; }
export async function createLogin(user, res) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  await LoginSession.create({ userId: user._id, tokenHash: hashToken(token), csrf, authVersion: user.authVersion, expiresAt: new Date(Date.now() + 7 * 86400000) });
  res.cookie('residency_session', token, { ...cookieOptions(), maxAge: 7 * 86400000 });
  return { user: publicUser(user), csrf };
}
export async function authenticated(req, res, next) {
  const token = req.cookies.residency_session;
  requireThat(typeof token === 'string' && token.length <= 100, 401, 'UNAUTHENTICATED');
  const session = await LoginSession.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).lean();
  requireThat(session, 401, 'UNAUTHENTICATED');
  const user = await User.findOne({ _id: session.userId, status: 'active', authVersion: session.authVersion }).lean();
  requireThat(user, 401, 'UNAUTHENTICATED');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireThat(req.get('X-CSRF-Token') === session.csrf, 403, 'CSRF_FAILED');
  req.user = user; req.loginSession = session;
  next();
}
