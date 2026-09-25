import { Router } from 'express';
import { z } from 'zod';
import { id, dayInterval, nextLeaveState, leaveApplies, canManage } from '@residency/domain';
import { Leave, User, ClassSession, LeaveOverride } from './models.js';
import { requireThat } from './security.js';
import { mutate, audit, notify, admins } from './services.js';
export const leaveRouter = Router();

leaveRouter.get('/leave', async (req, res) => {
  const u = req.user;
  const scope = u.kind === 'admin' ? { cohortId: u.cohortId, status: { $ne: 'pending_professor' } } : u.kind === 'professor' ? { professorId: u._id } : { studentId: u._id };
  const leaves = await Leave.find({ departmentId: u.departmentId, ...scope }).sort({ createdAt: -1 }).limit(300).lean();
  const people = await User.find({ _id: { $in: leaves.flatMap(l => [l.studentId, l.professorId]) } }).select('_id name').lean();
  res.json(leaves.map(l => ({ ...l, studentName: people.find(p => p._id === l.studentId)?.name, professorName: people.find(p => p._id === l.professorId)?.name })));
});
leaveRouter.post('/leave', async (req, res) => {
  const v = z.object({ type: z.enum(['day', 'session', 'hourly']), professorId: id, sessionId: id.optional(), date: z.string().max(20).optional(), startAt: z.iso.datetime({ offset: true }).optional(), endAt: z.iso.datetime({ offset: true }).optional(), reason: z.string().trim().max(2000).default('') }).strict().parse(req.body);
  res.status(201).json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'student');
    requireThat(await User.exists({ _id: v.professorId, departmentId: actor.departmentId, kind: 'professor', status: 'active' }).session(tx), 422, 'INVALID_PROFESSOR');
    let interval;
    if (v.type === 'session') {
      requireThat(v.sessionId, 422, 'SESSION_REQUIRED');
      const s = await ClassSession.findOne({ _id: v.sessionId, departmentId: actor.departmentId, participations: { $elemMatch: { cohortId: actor.cohortId, studentIds: actor._id, status: 'approved', confirmed: true } } }).session(tx).lean();
      requireThat(s, 422, 'INVALID_SESSION'); interval = { startAt: s.startAt, endAt: s.endAt };
    } else if (v.type === 'day') {
      requireThat(v.date, 422, 'DATE_REQUIRED');
      try { interval = dayInterval(v.date); } catch { requireThat(false, 422, 'INVALID_JALALI_DATE'); }
    } else {
      requireThat(v.startAt && v.endAt && new Date(v.endAt) > new Date(v.startAt), 422, 'INVALID_INTERVAL');
      interval = { startAt: v.startAt, endAt: v.endAt };
    }
    const [leave] = await Leave.create([{ departmentId: actor.departmentId, cohortId: actor.cohortId, studentId: actor._id, professorId: v.professorId, type: v.type, ...(v.type === 'session' ? { sessionId: v.sessionId } : {}), ...interval, reason: v.reason }], { session: tx });
    await audit(actor, tx, actor.cohortId, 'leave_requested', leave._id, { type: v.type });
    await notify(tx, [v.professorId], 'leave_professor_pending', leave._id);
    return leave.toObject();
  }));
});
leaveRouter.post('/leave/:id/decision', async (req, res) => {
  const leaveId = id.parse(req.params.id);
  const v = z.object({ decision: z.enum(['approve', 'deny']), version: z.number().int().min(0), note: z.string().trim().max(1000).default('') }).strict().parse(req.body);
  res.json(await mutate(req, async (actor, tx) => {
    const scope = actor.kind === 'professor' ? { professorId: actor._id } : actor.kind === 'admin' ? { cohortId: actor.cohortId } : { _id: null };
    const leave = await Leave.findOne({ _id: leaveId, departmentId: actor.departmentId, ...scope }).session(tx);
    requireThat(leave, 404, 'NOT_FOUND'); requireThat(leave.version === v.version, 409, 'STALE_VERSION');
    let status; try { status = nextLeaveState(actor, leave, v.decision); } catch { requireThat(false, 409, 'INVALID_TRANSITION'); }
    const field = actor.kind === 'professor' ? 'professorDecision' : 'adminDecision';
    leave[field] = { actorId: actor._id, decision: v.decision, at: new Date(), note: v.note };
    leave.status = status; leave.version++; await leave.save({ session: tx });
    await audit(actor, tx, leave.cohortId, `leave_${status}`, leave._id);
    await notify(tx, status === 'pending_admin' ? await admins(leave.cohortId, tx) : [leave.studentId], `leave_${status}`, leave._id);
    // Approved absence is derived from approved requests when viewing attendance.
    // This also applies automatically to later enrollment and approved schedule changes.
    return leave.toObject();
  }));
});
leaveRouter.put('/sessions/:id/leave-override', async (req, res) => {
  const sessionId = id.parse(req.params.id);
  const v = z.object({ studentId: id, status: z.enum(['present', 'absent']), reason: z.string().trim().min(2).max(1000) }).strict().parse(req.body);
  res.json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'admin');
    const s = await ClassSession.findOne({ _id: sessionId, departmentId: actor.departmentId, participations: { $elemMatch: { cohortId: actor.cohortId, studentIds: v.studentId } } }).session(tx).lean();
    const student = await User.findOne({ _id: v.studentId, cohortId: actor.cohortId, departmentId: actor.departmentId, kind: 'student' }).session(tx).lean();
    requireThat(s && student && canManage(actor, student.cohortId), 404, 'NOT_FOUND');
    const leaves = await Leave.find({ studentId: v.studentId, status: 'approved' }).session(tx).lean();
    requireThat(leaves.some(l => leaveApplies(l, s)), 409, 'NO_APPROVED_LEAVE');
    const before = await LeaveOverride.findOne({ sessionId, studentId: v.studentId }).session(tx).lean();
    const override = await LeaveOverride.findOneAndUpdate({ sessionId, studentId: v.studentId }, { $set: { ...v, actorId: actor._id, departmentId: actor.departmentId, cohortId: actor.cohortId } }, { upsert: true, new: true, session: tx }).lean();
    await audit(actor, tx, actor.cohortId, 'leave_attendance_overridden', override._id, { before: before ? { status: before.status, reason: before.reason } : null, after: v });
    return override;
  }));
});
