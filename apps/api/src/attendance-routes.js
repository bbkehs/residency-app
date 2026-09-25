import { Router } from 'express';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { id, observationSchema, canObserve } from '@residency/domain';
import { ClassSession, User, Observation, Receipt } from './models.js';
import { requireThat } from './security.js';
import { mutate, audit, sessionQuery, visibleParticipations, attendanceReport } from './services.js';
export const attendanceRouter = Router();

async function record(req, sessionId, input) {
  const v = observationSchema.parse(input);
  requireThat(new Date(v.recordedAt).getTime() <= Date.now() + 5 * 60000, 422, 'DEVICE_TIME_IN_FUTURE');
  const digest = createHash('sha256').update(JSON.stringify({ sessionId, ...v })).digest('hex');
  return mutate(req, async (actor, tx) => {
    const s = await ClassSession.findOne({ _id: sessionId, departmentId: actor.departmentId }).session(tx).lean();
    const student = await User.findOne({ _id: v.studentId, kind: 'student', status: 'active', departmentId: actor.departmentId }).session(tx).lean();
    requireThat(s && student && canObserve(actor, s, student), 403, 'ATTENDANCE_NOT_ALLOWED');
    const previousReceipt = await Receipt.findOne({ actorId: actor._id, operationId: v.operationId }).session(tx).lean();
    if (previousReceipt) { requireThat(previousReceipt.digest === digest, 409, 'OPERATION_REUSED'); return previousReceipt.result; }
    const role = actor.kind === 'professor' ? 'professor' : 'rep';
    const filter = { sessionId, studentId: student._id, observerId: actor._id, role };
    let observation = await Observation.findOne(filter).session(tx);
    requireThat((observation?.version || 0) === v.version, 409, 'STALE_VERSION');
    const before = observation ? { status: observation.status, recordedAt: observation.recordedAt, version: observation.version } : null;
    const data = { ...filter, departmentId: actor.departmentId, cohortId: student.cohortId, status: v.status, recordedAt: new Date(v.recordedAt), receivedAt: new Date(), version: v.version + 1 };
    if (observation) { Object.assign(observation, data); await observation.save({ session: tx }); }
    else { [observation] = await Observation.create([data], { session: tx }); }
    const result = { observation: observation.toObject() };
    await Receipt.create([{ actorId: actor._id, operationId: v.operationId, digest, result }], { session: tx });
    await audit(actor, tx, student.cohortId, 'attendance_recorded', observation._id, { sessionId, studentId: student._id, before, after: { status: v.status, recordedAt: v.recordedAt, receivedAt: data.receivedAt, version: data.version }, role });
    return result;
  });
}
attendanceRouter.put('/sessions/:id/attendance', async (req, res) => res.json(await record(req, id.parse(req.params.id), req.body)));
attendanceRouter.post('/attendance/sync', async (req, res) => {
  const input = z.object({ actorId: id, operations: z.array(observationSchema.extend({ sessionId: id })).max(100) }).strict().parse(req.body);
  requireThat(input.actorId === req.user._id, 403, 'ACCOUNT_CHANGED');
  const results = [];
  for (const { sessionId, ...operation } of input.operations) {
    try { results.push({ operationId: operation.operationId, ok: true, ...await record(req, sessionId, operation) }); }
    catch (e) {
      if (e.status >= 400 && e.status < 500) results.push({ operationId: operation.operationId, ok: false, error: e.code });
      else throw e;
    }
  }
  res.json({ results });
});
attendanceRouter.get('/reports/attendance', async (req, res) => {
  const query = z.object({ startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }) }).parse(req.query);
  requireThat(new Date(query.endAt) > new Date(query.startAt), 422, 'INVALID_INTERVAL');
  requireThat(new Date(query.endAt) - new Date(query.startAt) <= 366 * 86400000, 422, 'REPORT_RANGE_TOO_LARGE');
  const sessions = await ClassSession.find({ ...sessionQuery(req.user), startAt: { $gte: query.startAt, $lt: query.endAt } }).sort({ startAt: -1 }).limit(201).lean();
  requireThat(sessions.length <= 200, 422, 'NARROW_REPORT_RANGE');
  const reports = [];
  for (const s of sessions) reports.push({ session: { ...s, participations: visibleParticipations(req.user, s) }, rows: await attendanceReport(req.user, s) });
  res.json(reports);
});
