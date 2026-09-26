import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { id, usernameSchema, nameSchema, canManage } from '@residency/domain';
import { User, Cohort, Department } from './models.js';
import { requireThat, hashPassword, publicUser } from './security.js';
import { mutate, audit, admins, notify } from './services.js';
import { revokeSessions } from './push.js';

export const userRouter = Router();
userRouter.get('/directory', async (req, res) => {
  const u = req.user;
  res.json({
    department: await Department.findById(u.departmentId).lean(),
    cohorts: await Cohort.find({ departmentId: u.departmentId }).sort({ year: 1 }).lean(),
    professors: await User.find({ departmentId: u.departmentId, kind: 'professor', status: 'active' }).select('_id name').sort({ name: 1 }).lean(),
    students: (u.kind === 'admin' || u.isRep) ? await User.find({ departmentId: u.departmentId, cohortId: u.cohortId, kind: 'student', status: 'active' }).select('_id name isRep').sort({ name: 1 }).lean() : [],
  });
});
userRouter.get('/users', async (req, res) => {
  const u = req.user; requireThat(u.kind === 'admin' || u.isRep);
  const scope = u.kind === 'admin' ? { $or: [{ cohortId: u.cohortId, kind: 'student' }, { approvalCohortId: u.cohortId, kind: 'professor', status: 'pending' }] } : { cohortId: u.cohortId, kind: 'student' };
  res.json((await User.find({ departmentId: u.departmentId, ...scope }).sort({ status: 1, name: 1 }).limit(1000).lean()).map(publicUser));
});
userRouter.post('/users', async (req, res) => {
  const v = z.object({ username: usernameSchema, name: nameSchema, kind: z.enum(['student', 'professor']).default('student') }).strict().parse(req.body);
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  const result = await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin' || actor.isRep);
    requireThat(v.kind === 'student' || actor.kind === 'admin');
    const active = actor.kind === 'admin';
    const [user] = await User.create([{ username: v.username, name: v.name, kind: v.kind, departmentId: actor.departmentId, cohortId: v.kind === 'student' ? actor.cohortId : undefined, approvalCohortId: actor.cohortId, status: active ? 'active' : 'pending', passwordHash: active ? passwordHash : undefined, mustChangePassword: true }], { session: tx });
    await audit(actor, tx, actor.cohortId, active ? 'account_created' : 'account_proposed', user._id);
    if (!active) await notify(tx, await admins(actor.cohortId, tx), 'account_pending', user._id);
    return { user: publicUser(user), ...(active ? { temporaryPassword } : {}) };
  });
  res.status(201).json(result);
});
userRouter.post('/users/:id/decision', async (req, res) => {
  const userId = id.parse(req.params.id);
  const v = z.object({ decision: z.enum(['approve', 'reject']) }).strict().parse(req.body);
  const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  res.json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin');
    const user = await User.findOne({ _id: userId, departmentId: actor.departmentId, approvalCohortId: actor.cohortId, status: 'pending' }).select('+passwordHash').session(tx);
    requireThat(user, 404, 'NOT_FOUND');
    requireThat(user.kind !== 'admin');
    const issuePassword = v.decision === 'approve' && !user.passwordHash;
    user.status = v.decision === 'approve' ? 'active' : 'rejected';
    if (issuePassword) { user.passwordHash = passwordHash; user.mustChangePassword = true; }
    await user.save({ session: tx });
    await audit(actor, tx, actor.cohortId, `account_${user.status}`, user._id);
    return { user: publicUser(user), ...(issuePassword ? { temporaryPassword } : {}) };
  }));
});
userRouter.patch('/users/:id', async (req, res) => {
  const userId = id.parse(req.params.id);
  const v = z.object({ isRep: z.boolean().optional(), status: z.enum(['active', 'suspended']).optional() }).strict().refine(v => Object.keys(v).length > 0).parse(req.body);
  res.json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin');
    const user = await User.findOne({ _id: userId, kind: 'student', departmentId: actor.departmentId, cohortId: actor.cohortId, status: { $in: ['active', 'suspended'] } }).session(tx);
    requireThat(user && canManage(actor, user.cohortId), 404, 'NOT_FOUND');
    const before = { isRep: user.isRep, status: user.status };
    Object.assign(user, v);
    if (v.status === 'suspended') { user.authVersion++; await revokeSessions({ userId }, tx); }
    await user.save({ session: tx });
    await audit(actor, tx, actor.cohortId, 'account_updated', userId, { before, after: v });
    return publicUser(user);
  }));
});
userRouter.post('/users/:id/password-reset', async (req, res) => {
  const userId = id.parse(req.params.id); const temporaryPassword = randomBytes(18).toString('base64url');
  const passwordHash = await hashPassword(temporaryPassword);
  await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin');
    const user = await User.findOne({ _id: userId, departmentId: actor.departmentId, cohortId: actor.cohortId, kind: 'student', status: 'active' }).session(tx);
    requireThat(user, 404, 'NOT_FOUND');
    user.passwordHash = passwordHash; user.mustChangePassword = true; user.authVersion++;
    await user.save({ session: tx }); await revokeSessions({ userId }, tx);
    await audit(actor, tx, actor.cohortId, 'password_reset', userId);
  });
  res.json({ temporaryPassword });
});
