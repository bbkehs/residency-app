import mongoose from 'mongoose';
import { Audit, Notification, User, ClassSession, Leave, LeaveOverride, Observation } from './models.js';
import { requireThat, publicUser } from './security.js';
import { canManage, canRep, activeParticipation, leaveApplies } from '@residency/domain';
import { enqueuePush } from './push.js';

export async function mutate(req, fn) {
  return mongoose.connection.transaction(async tx => {
    const user = await User.findOne({ _id: req.user._id, status: 'active', authVersion: req.loginSession.authVersion }).session(tx).lean();
    requireThat(user, 401, 'UNAUTHENTICATED');
    return fn(user, tx);
  });
}
export async function audit(user, tx, cohortId, action, entityId, detail = {}) {
  await Audit.create([{ departmentId: user.departmentId, cohortId, actorId: user._id, action, entityId, detail }], { session: tx });
}
export async function notify(tx, recipientIds, type, entityId) {
  for (const recipientId of [...new Set(recipientIds)]) {
    const [notification] = await Notification.create([{ recipientId, type, entityId }], { session: tx });
    await enqueuePush(notification, tx);
  }
}
export async function admins(cohortId, tx) { return (await User.find({ kind: 'admin', cohortId, status: 'active' }).session(tx).lean()).map(x => x._id); }
export function sessionQuery(user) {
  const base = { departmentId: user.departmentId };
  if (user.kind === 'professor') return { ...base, professorIds: user._id, participations: { $elemMatch: { status: { $in: ['approved', 'superseded'] } } } };
  if (user.kind === 'admin' || user.isRep) return { ...base, 'participations.cohortId': user.cohortId };
  return { ...base, participations: { $elemMatch: { cohortId: user.cohortId, studentIds: user._id, status: { $in: ['approved', 'superseded'] }, confirmed: true } } };
}
export function visibleParticipations(user, session) {
  if (user.kind === 'professor') return session.participations.filter(p => ['approved', 'superseded'].includes(p.status));
  return session.participations.filter(p => p.cohortId === user.cohortId).map(p => user.kind === 'student' && !user.isRep ? { ...p, studentIds: p.studentIds.filter(id => id === user._id) } : p);
}
export async function getSession(user, sessionId, tx) {
  const s = await ClassSession.findOne({ _id: sessionId, ...sessionQuery(user) }).session(tx || null).lean();
  requireThat(s, 404, 'NOT_FOUND');
  return s;
}
export async function attendanceReport(user, session) {
  const participations = visibleParticipations(user, session);
  const studentIds = [...new Set(participations.flatMap(p => p.studentIds))];
  const students = await User.find({ _id: { $in: studentIds }, departmentId: user.departmentId }).sort({ name: 1 }).lean();
  const observations = await Observation.find({ sessionId: session._id, studentId: { $in: studentIds } }).lean();
  const observerIds = [...new Set(observations.map(o => o.observerId))];
  const observers = await User.find({ _id: { $in: observerIds } }).select('_id name kind').lean();
  const leaves = await Leave.find({ studentId: { $in: studentIds }, status: 'approved', departmentId: user.departmentId }).lean();
  const overrides = await LeaveOverride.find({ sessionId: session._id, studentId: { $in: studentIds } }).lean();
  return students.map(student => {
    const matching = leaves.filter(l => l.studentId === student._id && leaveApplies(l, session));
    const override = overrides.find(o => o.studentId === student._id);
    return {
      student: { _id: student._id, name: student.name, cohortId: student.cohortId },
      observations: observations.filter(o => o.studentId === student._id).map(o => ({ ...o, observerName: observers.find(p => p._id === o.observerId)?.name || '—' })),
      leave: matching.length ? { status: override?.status || 'absent', approved: true, override: override ? { status: override.status, reason: override.reason, actorId: override.actorId, updatedAt: override.updatedAt } : null,
        intervals: matching.map(l => ({ type: l.type, startAt: l.startAt, endAt: l.endAt })) } : null,
      canObserve: activeParticipation(participations.find(p => p.cohortId === student.cohortId) || {}) && (canRep(user, student.cohortId) || user.kind === 'professor'),
      canOverride: canManage(user, student.cohortId) && matching.length > 0,
    };
  });
}
export const usersPublic = users => users.map(publicUser);
