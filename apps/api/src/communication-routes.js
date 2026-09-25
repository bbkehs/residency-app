import { Router } from 'express';
import { z } from 'zod';
import { id } from '@residency/domain';
import { Audit, Notification, Thread, Message, Cohort, User, ClassSession, Leave } from './models.js';
import { requireThat } from './security.js';
import { mutate, audit, notify, admins } from './services.js';
export const communicationRouter = Router();
const scope = actor => actor.kind === 'admin' ? { cohortId: actor.cohortId } : actor.kind === 'professor' ? { professorId: actor._id } : { _id: null };
communicationRouter.get('/notifications', async (req, res) => res.json(await Notification.find({ recipientId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean()));
communicationRouter.post('/notifications/:id/read', async (req, res) => {
  const result = await Notification.updateOne({ _id: id.parse(req.params.id), recipientId: req.user._id }, { $set: { readAt: new Date() } });
  requireThat(result.matchedCount, 404, 'NOT_FOUND'); res.json({ ok: true });
});
communicationRouter.get('/audit', async (req, res) => {
  requireThat(req.user.kind === 'admin');
  const limit = 100; const query = z.object({ before: z.iso.datetime({ offset: true }).optional() }).parse(req.query);
  const events = await Audit.find({ departmentId: req.user.departmentId, cohortId: req.user.cohortId, ...(query.before ? { createdAt: { $lt: query.before } } : {}) }).sort({ createdAt: -1 }).limit(limit).lean();
  const users = await User.find({ _id: { $in: events.map(e => e.actorId) } }).select('_id name').lean();
  res.json({ events: events.map(e => ({ ...e, actorName: users.find(u => u._id === e.actorId)?.name || '—' })), next: events.length === limit ? events.at(-1).createdAt : null });
});
communicationRouter.get('/threads', async (req, res) => {
  requireThat(['admin', 'professor'].includes(req.user.kind));
  const threads = await Thread.find({ departmentId: req.user.departmentId, ...scope(req.user) }).sort({ updatedAt: -1 }).limit(100).lean();
  const people = await User.find({ _id: { $in: threads.map(t => t.professorId) } }).select('_id name').lean();
  res.json(threads.map(t => ({ ...t, professorName: people.find(p => p._id === t.professorId)?.name })));
});
communicationRouter.post('/threads', async (req, res) => {
  const v = z.object({ cohortId: id, subject: z.string().trim().min(2).max(160), text: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
  res.status(201).json(await mutate(req, async (actor, tx) => {
    requireThat(actor.kind === 'professor');
    requireThat(await Cohort.exists({ _id: v.cohortId, departmentId: actor.departmentId }).session(tx), 422, 'INVALID_COHORT');
    const related = await ClassSession.exists({ departmentId: actor.departmentId, professorIds: actor._id, 'participations.cohortId': v.cohortId }).session(tx) || await Leave.exists({ professorId: actor._id, cohortId: v.cohortId }).session(tx);
    requireThat(related, 403, 'UNRELATED_COHORT');
    const [thread] = await Thread.create([{ departmentId: actor.departmentId, cohortId: v.cohortId, professorId: actor._id, subject: v.subject }], { session: tx });
    await Message.create([{ threadId: thread._id, authorId: actor._id, text: v.text }], { session: tx });
    await notify(tx, await admins(v.cohortId, tx), 'message_received', thread._id);
    await audit(actor, tx, v.cohortId, 'message_thread_created', thread._id);
    return thread.toObject();
  }));
});
communicationRouter.get('/threads/:id/messages', async (req, res) => {
  const thread = await Thread.findOne({ _id: id.parse(req.params.id), departmentId: req.user.departmentId, ...scope(req.user) }).lean();
  requireThat(thread, 404, 'NOT_FOUND');
  res.json(await Message.find({ threadId: thread._id }).sort({ createdAt: 1 }).limit(500).lean());
});
communicationRouter.post('/threads/:id/messages', async (req, res) => {
  const threadId = id.parse(req.params.id); const v = z.object({ text: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
  res.status(201).json(await mutate(req, async (actor, tx) => {
    const thread = await Thread.findOne({ _id: threadId, departmentId: actor.departmentId, ...scope(actor) }).session(tx);
    requireThat(thread, 404, 'NOT_FOUND');
    const [message] = await Message.create([{ threadId, authorId: actor._id, text: v.text }], { session: tx });
    thread.updatedAt = new Date(); await thread.save({ session: tx });
    await notify(tx, actor.kind === 'admin' ? [thread.professorId] : await admins(thread.cohortId, tx), 'message_received', threadId);
    await audit(actor, tx, thread.cohortId, 'message_sent', message._id);
    return message.toObject();
  }));
});
