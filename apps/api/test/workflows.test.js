import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { models, Department, Cohort, User, ClassSession, Observation, Audit, Notification, Leave, initializeIndexes } from '../src/models.js';
import { hashPassword } from '../src/security.js';

let mongo, app, d1, d2, c1, c2, c3, people = {}, clients = {};
const password = 'Test-only-password-2026!';
const origin = 'http://localhost:5173';
async function login(user) {
  const agent = request.agent(app);
  const login = await agent.post('/api/auth/login').set('Origin', origin).send({ username: user.username, password }).expect(200);
  const csrf = login.body.csrf;
  return { get: path => agent.get(`/api${path}`), post: (path, body = {}) => agent.post(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body), put: (path, body) => agent.put(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body), patch: (path, body) => agent.patch(`/api${path}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body), agent, csrf };
}
async function session(extra = {}) {
  return ClassSession.create({ departmentId: d1._id, ownerCohortId: c1._id, createdBy: people.rep._id, title: 'Clinical teaching', startAt: new Date('2027-03-21T05:00:00Z'), endAt: new Date('2027-03-21T06:00:00Z'), room: 'Room A', professorIds: [people.prof._id, people.prof2._id], participations: [{ cohortId: c1._id, studentIds: [people.student._id, people.rep._id], confirmed: true, status: 'approved' }, { cohortId: c2._id, studentIds: [people.student2._id], confirmed: true, status: 'approved' }], ...extra });
}
const observation = (studentId, status = 'present', version = 0) => ({ studentId, status, version, recordedAt: new Date().toISOString(), operationId: randomUUID() });
before(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 }, instanceOpts: [{ args: ['--nounixsocket'] }], binary: { version: '7.0.24' } });
  await mongoose.connect(mongo.getUri()); await initializeIndexes(); app = createApp({ origin });
  [d1, d2] = await Department.create([{ code: 'PMR', name: 'PM&R' }, { code: 'NEU', name: 'Neurology' }]);
  [c1, c2, c3] = await Cohort.create([{ departmentId: d1._id, year: 1 }, { departmentId: d1._id, year: 2 }, { departmentId: d2._id, year: 1 }]);
  const passwordHash = await hashPassword(password);
  for (const [key, kind, cohort, isRep = false] of [['admin','admin',c1], ['admin2','admin',c2], ['admin3','admin',c3], ['rep','student',c1,true], ['rep2','student',c2,true], ['student','student',c1], ['student2','student',c2], ['student3','student',c3], ['prof','professor',c1], ['prof2','professor',c1], ['prof3','professor',c3]]) {
    people[key] = await User.create({ username: `test-${key}`, name: `Test ${key}`, kind, departmentId: cohort.departmentId, cohortId: kind === 'professor' ? undefined : cohort._id, approvalCohortId: cohort._id, isRep, passwordHash, status: 'active' });
    clients[key] = await login(people[key]);
  }
});
after(async () => { await mongoose.disconnect(); await mongo?.stop(); });

test('signup cannot self-grant admin or representative; pending login has no panel access', async () => {
  const body = { username: 'new-resident', name: 'New Resident', password, departmentId: d1._id, cohortId: c1._id, kind: 'student' };
  await request(app).post('/api/auth/signup').set('Origin', origin).send({ ...body, isRep: true }).expect(422);
  await request(app).post('/api/auth/signup').set('Origin', origin).send({ ...body, kind: 'admin' }).expect(422);
  await request(app).post('/api/auth/signup').set('Origin', origin).send(body).expect(201);
  await request(app).post('/api/auth/login').set('Origin', origin).send({ username: body.username, password }).expect(403);
  const pending = await User.findOne({ username: body.username });
  await clients.admin2.post(`/users/${pending._id}/decision`, { decision: 'approve' }).expect(404);
  await clients.admin.post(`/users/${pending._id}/decision`, { decision: 'approve' }).expect(200);
  assert.ok((await login(pending)).csrf);
});
test('origin and csrf prevent unauthorized browser mutations', async () => {
  await clients.admin.agent.post('/api/users').set('Origin', origin).send({ username: 'blocked', name: 'Blocked', kind: 'student' }).expect(403);
  await clients.admin.agent.post('/api/users').set('Origin', 'https://evil.example').set('X-CSRF-Token', clients.admin.csrf).send({ username: 'blocked', name: 'Blocked', kind: 'student' }).expect(403);
});
test('cohort and department boundaries hold on lists, details, and guessed IDs', async () => {
  const s = await session();
  const result = await clients.admin.get(`/sessions/${s._id}`).expect(200);
  assert.equal(result.body.session.participations.length, 1);
  assert.ok(result.body.rows.every(r => r.student.cohortId === c1._id));
  const mine = await clients.student.get(`/sessions/${s._id}`).expect(200);
  assert.deepEqual(mine.body.rows.map(r => r.student._id), [people.student._id]);
  await clients.admin3.get(`/sessions/${s._id}`).expect(404);
  await clients.rep.put(`/sessions/${s._id}/attendance`, observation(people.student2._id)).expect(403);
  await clients.prof3.put(`/sessions/${s._id}/attendance`, observation(people.student._id)).expect(403);
  await clients.admin.patch(`/users/${people.student2._id}`, { isRep: true }).expect(404);
  const users = await clients.admin.get('/users').expect(200);
  assert.ok(!users.body.some(u => u._id === people.student2._id));
  assert.ok(users.body.every(u => !('passwordHash' in u)));
});
test('shared schedule approval is per cohort; rep confirms only their own participants', async () => {
  const proposal = { title: 'Joint teaching', description: '', room: 'Room A', startAt: '2027-03-21T05:00:00.000Z', endAt: '2027-03-21T06:00:00.000Z', professorIds: [people.prof._id], cohortIds: [c1._id, c2._id] };
  const created = await clients.rep.post('/sessions', proposal).expect(201); const sid = created.body.session._id;
  assert.equal(created.body.warnings[0].code, 'SCHEDULE_OVERLAP');
  await clients.rep.put(`/sessions/${sid}/roster`, { studentIds: [people.student2._id], version: 0 }).expect(422);
  await clients.rep.put(`/sessions/${sid}/roster`, { studentIds: [people.student._id], version: 0 }).expect(200);
  await clients.admin.post(`/sessions/${sid}/decision`, { decision: 'approve', version: 1 }).expect(200);
  const saved = await ClassSession.findById(sid).lean();
  assert.equal(saved.participations.find(p => p.cohortId === c2._id).status, 'pending');
  await clients.student2.get(`/sessions/${sid}`).expect(404);
  await clients.rep.post(`/sessions/${sid}/decision`, { decision: 'approve', version: 2 }).expect(403);
});
test('rep and professors keep separate observations; retries are idempotent; stale versions fail', async () => {
  const s = await session(); const input = observation(people.student._id);
  const first = await clients.rep.put(`/sessions/${s._id}/attendance`, input).expect(200);
  const again = await clients.rep.put(`/sessions/${s._id}/attendance`, input).expect(200);
  assert.equal(first.body.observation._id, again.body.observation._id);
  await clients.rep.put(`/sessions/${s._id}/attendance`, { ...input, status: 'absent' }).expect(409);
  await clients.rep.put(`/sessions/${s._id}/attendance`, observation(people.student._id, 'absent', 0)).expect(409);
  await clients.prof.put(`/sessions/${s._id}/attendance`, observation(people.student._id, 'absent')).expect(200);
  await clients.prof2.put(`/sessions/${s._id}/attendance`, observation(people.student._id, 'present')).expect(200);
  const report = await clients.admin.get(`/sessions/${s._id}`).expect(200);
  const row = report.body.rows.find(r => r.student._id === people.student._id);
  assert.equal(row.observations.length, 3); assert.equal('finalStatus' in row, false);
  assert.ok(row.observations.every(o => o.recordedAt && o.receivedAt));
  assert.equal(await Audit.countDocuments({ action: 'attendance_recorded', 'detail.sessionId': s._id }), 3);
});
test('attendance history survives edits and a recorded resident cannot be removed', async () => {
  const s = await session();
  await clients.rep.put(`/sessions/${s._id}/attendance`, observation(people.student._id)).expect(200);
  await clients.rep.put(`/sessions/${s._id}/attendance`, observation(people.student._id, 'absent', 1)).expect(200);
  assert.equal(await Observation.countDocuments({ sessionId: s._id, studentId: people.student._id }), 1);
  const events = await Audit.find({ action: 'attendance_recorded', 'detail.sessionId': s._id }).sort({ createdAt: 1 }).lean();
  assert.equal(events[1].detail.before.status, 'present');
  await clients.rep.put(`/sessions/${s._id}/roster`, { studentIds: [], version: 0 }).expect(409);
});
test('leave follows professor then admin; absence effect does not overwrite attendance', async () => {
  const s = await session();
  await clients.rep.put(`/sessions/${s._id}/attendance`, observation(people.student._id)).expect(200);
  const response = await clients.student.post('/leave', { type: 'session', sessionId: s._id, professorId: people.prof._id, reason: 'Personal leave' }).expect(201); const leave = response.body;
  await clients.admin.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 0 }).expect(409);
  await clients.prof2.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 0 }).expect(404);
  await clients.prof.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 0 }).expect(200);
  await clients.admin2.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 1 }).expect(404);
  await clients.admin.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 1 }).expect(200);
  await clients.admin.post(`/leave/${leave._id}/decision`, { decision: 'approve', version: 1 }).expect(409);
  const report = await clients.admin.get(`/sessions/${s._id}`).expect(200); const row = report.body.rows.find(r => r.student._id === people.student._id);
  assert.equal(row.leave.status, 'absent'); assert.equal(row.observations[0].status, 'present');
  await clients.admin.put(`/sessions/${s._id}/leave-override`, { studentId: people.student._id, status: 'present', reason: 'Returned early' }).expect(200);
  const updated = await clients.admin.get(`/sessions/${s._id}`).expect(200);
  assert.equal(updated.body.rows.find(r => r.student._id === people.student._id).leave.status, 'present');
  assert.equal(await Notification.countDocuments({ recipientId: people.student._id, entityId: leave._id, type: 'leave_approved' }), 1);
});
test('whole-day approved leave applies to newly enrolled sessions and respects Tehran midnight', async () => {
  const result = await clients.student.post('/leave', { type: 'day', date: '1406/01/01', professorId: people.prof._id }).expect(201);
  await clients.prof.post(`/leave/${result.body._id}/decision`, { decision: 'approve', version: 0 }).expect(200);
  await clients.admin.post(`/leave/${result.body._id}/decision`, { decision: 'approve', version: 1 }).expect(200);
  const s = await session({ startAt: new Date('2027-03-21T19:00:00Z'), endAt: new Date('2027-03-21T20:00:00Z') });
  const report = await clients.admin.get(`/sessions/${s._id}`).expect(200);
  assert.equal(report.body.rows.find(r => r.student._id === people.student._id).leave.status, 'absent');
  assert.equal(new Date(result.body.startAt).toISOString(), '2027-03-20T20:30:00.000Z');
});
test('offline sync retries do not duplicate; revoked reps cannot submit queued work', async () => {
  const s = await session(); const op = { ...observation(people.rep._id), sessionId: s._id };
  const a = await clients.rep.post('/attendance/sync', { actorId: people.rep._id, operations: [op] }).expect(200); assert.equal(a.body.results[0].ok, true);
  const b = await clients.rep.post('/attendance/sync', { actorId: people.rep._id, operations: [op] }).expect(200); assert.equal(b.body.results[0].observation._id, a.body.results[0].observation._id);
  await clients.admin.patch(`/users/${people.rep._id}`, { isRep: false }).expect(200);
  const c = await clients.rep.post('/attendance/sync', { actorId: people.rep._id, operations: [{ ...observation(people.student._id), sessionId: s._id }] }).expect(200);
  assert.equal(c.body.results[0].error, 'ATTENDANCE_NOT_ALLOWED');
  await clients.admin.patch(`/users/${people.rep._id}`, { isRep: true }).expect(200);
});
test('sync requires the same account that created the offline queue', async () => {
  const s = await session();
  const result = await clients.rep.post('/attendance/sync', { actorId: people.rep2._id, operations: [{ ...observation(people.student._id), sessionId: s._id }] }).expect(403);
  assert.equal(result.body.error, 'ACCOUNT_CHANGED');
  assert.equal(await Observation.countDocuments({ sessionId: s._id }), 0);
});
test('password reset returns only new temporary credentials, revokes sessions and forces change', async () => {
  const result = await clients.admin.post('/users', { username: 'provisioned-user', name: 'Provisioned Resident', kind: 'student' }).expect(201);
  assert.ok(result.body.temporaryPassword); assert.equal(result.body.user.mustChangePassword, true);
  const agent = request.agent(app);
  const signed = await agent.post('/api/auth/login').set('Origin', origin).send({ username: 'provisioned-user', password: result.body.temporaryPassword }).expect(200);
  await agent.get('/api/sessions').expect(403);
  await agent.post('/api/auth/password').set('Origin', origin).set('X-CSRF-Token', signed.body.csrf).send({ currentPassword: result.body.temporaryPassword, password }).expect(200);
  await agent.get('/api/sessions').expect(200);
  await clients.admin.post(`/users/${result.body.user._id}/password-reset`).expect(200);
  await agent.get('/api/auth/me').expect(401);
});
test('messages are private to the professor and the target cohort admin', async () => {
  await session();
  const created = await clients.prof.post('/threads', { cohortId: c1._id, subject: 'Attendance question', text: 'Please check the session record.' }).expect(201);
  await clients.admin.get(`/threads/${created.body._id}/messages`).expect(200);
  await clients.admin2.get(`/threads/${created.body._id}/messages`).expect(404);
  await clients.prof2.get(`/threads/${created.body._id}/messages`).expect(404);
  await clients.student.get('/threads').expect(403);
  await clients.admin.post(`/threads/${created.body._id}/messages`, { text: 'Thank you, received.' }).expect(201);
  const messages = await clients.prof.get(`/threads/${created.body._id}/messages`).expect(200); assert.equal(messages.body.length, 2);
});
test('schedule revision keeps old approval until each cohort approves replacement', async () => {
  const s = await session();
  const created = await clients.rep.post(`/sessions/${s._id}/revisions`, { title: 'Revised teaching', description: '', room: 'Room B', startAt: '2027-03-22T05:00:00.000Z', endAt: '2027-03-22T06:00:00.000Z', professorIds: [people.prof._id], cohortIds: [c1._id, c2._id] }).expect(201);
  await clients.admin.post(`/sessions/${created.body.session._id}/decision`, { decision: 'approve', version: 0 }).expect(200);
  const old = await ClassSession.findById(s._id).lean();
  assert.equal(old.participations.find(p => p.cohortId === c1._id).status, 'superseded');
  assert.equal(old.participations.find(p => p.cohortId === c2._id).status, 'approved');
});
