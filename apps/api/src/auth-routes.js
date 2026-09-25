import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import mongoose from 'mongoose';
import { usernameSchema, passwordSchema, nameSchema, id } from '@residency/domain';
import { User, Cohort, Department, LoginSession } from './models.js';
import { authenticated, hashPassword, verifyPassword, createLogin, publicUser, requireThat, cookieOptions } from './security.js';
import { audit, admins, notify, mutate } from './services.js';

export const authRouter = Router();
authRouter.get('/catalog', async (req, res) => res.json({ departments: await Department.find().sort({ code: 1 }).lean(), cohorts: await Cohort.find().sort({ year: 1 }).lean() }));
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'TOO_MANY_ATTEMPTS' } });
authRouter.post('/signup', limiter, async (req, res) => {
  const v = z.object({ username: usernameSchema, password: passwordSchema, name: nameSchema, departmentId: id, cohortId: id, kind: z.enum(['student', 'professor']) }).strict().parse(req.body);
  const cohort = await Cohort.findOne({ _id: v.cohortId, departmentId: v.departmentId }).lean();
  requireThat(cohort, 422, 'INVALID_COHORT');
  const passwordHash = await hashPassword(v.password);
  await mongoose.connection.transaction(async tx => {
    const [user] = await User.create([{ username: v.username, name: v.name, passwordHash, kind: v.kind, departmentId: v.departmentId, cohortId: v.kind === 'student' ? v.cohortId : undefined, approvalCohortId: v.cohortId }], { session: tx });
    await notify(tx, await admins(v.cohortId, tx), 'account_pending', user._id);
  });
  res.status(201).json({ status: 'pending' });
});
authRouter.post('/login', limiter, async (req, res) => {
  const v = z.object({ username: usernameSchema, password: z.string().min(1).max(128) }).strict().parse(req.body);
  const user = await User.findOne({ username: v.username }).select('+passwordHash').lean();
  const valid = await verifyPassword(v.password, user?.passwordHash);
  requireThat(valid && user, 401, 'INVALID_CREDENTIALS');
  requireThat(user.status === 'active', 403, user.status === 'pending' ? 'ACCOUNT_PENDING' : 'ACCOUNT_DISABLED');
  if (req.cookies.residency_session) { const { hashToken } = await import('./security.js'); await LoginSession.deleteOne({ tokenHash: hashToken(req.cookies.residency_session) }); }
  res.json(await createLogin(user, res));
});
authRouter.get('/me', authenticated, (req, res) => res.json({ user: publicUser(req.user), csrf: req.loginSession.csrf }));
authRouter.post('/logout', authenticated, async (req, res) => {
  await LoginSession.deleteOne({ _id: req.loginSession._id });
  res.clearCookie('residency_session', cookieOptions()).json({ ok: true });
});
authRouter.post('/password', authenticated, async (req, res) => {
  const v = z.object({ currentPassword: z.string().min(1).max(128), password: passwordSchema }).strict().parse(req.body);
  const current = await User.findById(req.user._id).select('+passwordHash').lean();
  requireThat(await verifyPassword(v.currentPassword, current.passwordHash), 401, 'INVALID_CREDENTIALS');
  const passwordHash = await hashPassword(v.password);
  const user = await mutate(req, async (actor, tx) => {
    const updated = await User.findByIdAndUpdate(actor._id, { $set: { passwordHash, mustChangePassword: false }, $inc: { authVersion: 1 } }, { new: true, session: tx }).lean();
    await LoginSession.deleteMany({ userId: actor._id }).session(tx);
    if (actor.cohortId || actor.approvalCohortId) await audit(actor, tx, actor.cohortId || actor.approvalCohortId, 'password_changed', actor._id);
    return updated;
  });
  res.json(await createLogin(user, res));
});
