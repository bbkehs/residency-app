import { Router } from 'express';
import { z } from 'zod';
import { id, sessionSchema, canManage, canRep } from '@residency/domain';
import { ClassSession, Cohort, User } from './models.js';
import { requireThat } from './security.js';
import { mutate, audit, admins, notify, sessionQuery, getSession, visibleParticipations, attendanceReport } from './services.js';
export const sessionRouter = Router();

async function validateRelations(v, actor, tx) {
  requireThat(actor.kind === 'admin' || actor.isRep);
  requireThat(v.cohortIds.includes(actor.cohortId), 422, 'OWN_COHORT_REQUIRED');
  requireThat(new Set(v.cohortIds).size === v.cohortIds.length && new Set(v.professorIds).size === v.professorIds.length, 422, 'DUPLICATE_IDS');
  requireThat(await Cohort.countDocuments({ _id: { $in: v.cohortIds }, departmentId: actor.departmentId }).session(tx) === v.cohortIds.length, 422, 'INVALID_COHORT');
  requireThat(await User.countDocuments({ _id: { $in: v.professorIds }, departmentId: actor.departmentId, kind: 'professor', status: 'active' }).session(tx) === v.professorIds.length, 422, 'INVALID_PROFESSOR');
}
async function warnOverlaps(actor, session, tx) {
  const shared = await ClassSession.find({ _id: { $ne: session._id }, departmentId: actor.departmentId, startAt: { $lt: session.endAt }, endAt: { $gt: session.startAt }, 'participations.status': 'approved', $or: [{ professorIds: { $in: session.professorIds } }, ...(session.room ? [{ room: session.room }] : []), { 'participations.cohortId': { $in: session.participations.map(p => p.cohortId) } }] }).session(tx).lean();
  // Return a warning count, never another cohort's roster or private session details.
  return shared.length ? [{ code: 'SCHEDULE_OVERLAP', count: shared.length }] : [];
}
sessionRouter.get('/sessions', async (req, res) => {
  const sessions = await ClassSession.find(sessionQuery(req.user)).sort({ startAt: -1 }).limit(300).lean();
  res.json(sessions.map(s => ({ ...s, cohortIds: s.participations.map(p => p.cohortId), participations: visibleParticipations(req.user, s) })));
});
sessionRouter.post('/sessions', async (req, res) => {
  const v = sessionSchema.parse(req.body);
  res.status(201).json(await mutate(req, async (actor, tx) => {
    await validateRelations(v, actor, tx);
    const { cohortIds, ...data } = v;
    const [s] = await ClassSession.create([{ ...data, departmentId: actor.departmentId, ownerCohortId: actor.cohortId, createdBy: actor._id, participations: cohortIds.map(cohortId => ({ cohortId, studentIds: [], status: 'pending', confirmed: false })) }], { session: tx });
    for (const cohortId of cohortIds) {
      await audit(actor, tx, cohortId, 'session_proposed', s._id, { title: s.title });
      await notify(tx, await admins(cohortId, tx), 'session_pending', s._id);
    }
    return { session: { ...s.toObject(), participations: visibleParticipations(actor, s.toObject()) }, warnings: await warnOverlaps(actor, s, tx) };
  }));
});
sessionRouter.get('/sessions/:id', async (req, res) => {
  const session = await getSession(req.user, id.parse(req.params.id));
  const professors = await User.find({ _id: { $in: session.professorIds } }).select('_id name').lean();
  res.json({ session: { ...session, cohortIds: session.participations.map(p => p.cohortId), participations: visibleParticipations(req.user, session) }, professors, rows: await attendanceReport(req.user, session) });
});
sessionRouter.put('/sessions/:id/roster', async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const v = z.object({ studentIds: z.array(id).max(500), version: z.number().int().min(0) }).strict().parse(req.body);
  res.json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin' || actor.isRep);
    const session = await ClassSession.findOne({ _id: sessionId, departmentId: actor.departmentId, 'participations.cohortId': actor.cohortId }).session(tx);
    requireThat(session, 404, 'NOT_FOUND'); requireThat(session.version === v.version, 409, 'STALE_VERSION');
    const p = session.participations.find(p => p.cohortId === actor.cohortId);
    requireThat(p.status !== 'superseded', 409, 'SUPERSEDED');
    requireThat(canManage(actor, p.cohortId) || canRep(actor, p.cohortId));
    const studentIds = [...new Set(v.studentIds)];
    requireThat(await User.countDocuments({ _id: { $in: studentIds }, departmentId: actor.departmentId, cohortId: actor.cohortId, kind: 'student', status: 'active' }).session(tx) === studentIds.length, 422, 'INVALID_STUDENT');
    // Past observations must remain visible: do not remove a recorded participant.
    const { Observation } = await import('./models.js');
    const removed = p.studentIds.filter(s => !studentIds.includes(s));
    requireThat(!await Observation.exists({ sessionId, studentId: { $in: removed } }).session(tx), 409, 'RECORDED_STUDENT_CANNOT_BE_REMOVED');
    p.studentIds = studentIds; p.confirmed = true; p.confirmedBy = actor._id; session.version++;
    await session.save({ session: tx });
    await audit(actor, tx, actor.cohortId, 'roster_confirmed', sessionId, { studentIds });
    return { ok: true };
  }));
});
sessionRouter.post('/sessions/:id/decision', async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const v = z.object({ decision: z.enum(['approve', 'reject']), version: z.number().int().min(0) }).strict().parse(req.body);
  res.json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin');
    const s = await ClassSession.findOne({ _id: sessionId, departmentId: actor.departmentId, 'participations.cohortId': actor.cohortId }).session(tx);
    requireThat(s, 404, 'NOT_FOUND'); requireThat(s.version === v.version, 409, 'STALE_VERSION');
    const p = s.participations.find(p => p.cohortId === actor.cohortId);
    requireThat(p.status === 'pending', 409, 'INVALID_TRANSITION');
    p.status = v.decision === 'approve' ? 'approved' : 'rejected'; p.approvedBy = actor._id; s.version++;
    if (s.replacesId && p.status === 'approved') {
      await ClassSession.updateOne({ _id: s.replacesId, 'participations.cohortId': actor.cohortId }, { $set: { 'participations.$.status': 'superseded' }, $inc: { version: 1 } }).session(tx);
    }
    await s.save({ session: tx });
    await audit(actor, tx, actor.cohortId, `session_${p.status}`, sessionId);
    const reps = await User.find({ cohortId: actor.cohortId, kind: 'student', isRep: true, status: 'active' }).session(tx).lean();
    await notify(tx, reps.map(r => r._id), `session_${p.status}`, sessionId);
    return { ok: true, warnings: p.status === 'approved' ? await warnOverlaps(actor, s, tx) : [] };
  }));
});
sessionRouter.post('/sessions/:id/revisions', async (req, res) => {
  const sessionId = id.parse(req.params.id); const v = sessionSchema.parse(req.body);
  res.status(201).json(await mutate(req, async (actor, tx) => {
    await validateRelations(v, actor, tx);
    const original = await ClassSession.findOne({ _id: sessionId, departmentId: actor.departmentId, ownerCohortId: actor.cohortId }).session(tx);
    requireThat(original, 404, 'NOT_FOUND'); requireThat(!original.nextProposalId, 409, 'REVISION_EXISTS');
    requireThat(new Date(original.startAt) > new Date(), 409, 'PAST_SESSION_CANNOT_BE_REVISED');
    requireThat(original.participations.length === v.cohortIds.length && original.participations.every(p => v.cohortIds.includes(p.cohortId)), 422, 'REVISION_COHORTS_MUST_MATCH');
    const { cohortIds, ...data } = v;
    const [s] = await ClassSession.create([{ ...data, departmentId: actor.departmentId, ownerCohortId: actor.cohortId, createdBy: actor._id, replacesId: original._id, revision: original.revision + 1,
      participations: original.participations.map(p => ({ cohortId: p.cohortId, studentIds: p.studentIds, confirmed: p.confirmed, confirmedBy: p.confirmedBy, status: 'pending' })) }], { session: tx });
    original.nextProposalId = s._id; original.version++; await original.save({ session: tx });
    for (const cohortId of cohortIds) { await audit(actor, tx, cohortId, 'session_revision_proposed', s._id); await notify(tx, await admins(cohortId, tx), 'session_pending', s._id); }
    return { session: { ...s.toObject(), participations: visibleParticipations(actor, s.toObject()) }, warnings: await warnOverlaps(actor, s, tx) };
  }));
});
