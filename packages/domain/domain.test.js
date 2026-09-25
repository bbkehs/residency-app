import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaps, canObserve, nextLeaveState, jalaliToISO, dayInterval, leaveApplies } from './index.js';
test('overlap intervals are half open', () => {
  assert.equal(overlaps('2026-01-01T08:00Z', '2026-01-01T09:00Z', '2026-01-01T09:00Z', '2026-01-01T10:00Z'), false);
  assert.equal(overlaps('2026-01-01T08:00Z', '2026-01-01T09:00Z', '2026-01-01T08:59Z', '2026-01-01T10:00Z'), true);
});
test('rep scope and professor assignment both require active participation', () => {
  const student = { _id: 's', departmentId: 'd', cohortId: 'c' };
  const session = { departmentId: 'd', professorIds: ['p'], participations: [{ cohortId: 'c', studentIds: ['s'], status: 'approved', confirmed: true }] };
  assert.equal(canObserve({ _id: 'r', kind: 'student', isRep: true, departmentId: 'd', cohortId: 'other' }, session, student), false);
  assert.equal(canObserve({ _id: 'p', kind: 'professor', departmentId: 'd' }, session, student), true);
  session.participations[0].confirmed = false;
  assert.equal(canObserve({ _id: 'p', kind: 'professor', departmentId: 'd' }, session, student), false);
});
test('leave cannot skip professor or cross department/cohort scope', () => {
  const leave = { departmentId: 'd', cohortId: 'c', professorId: 'p', status: 'pending_professor' };
  assert.throws(() => nextLeaveState({ kind: 'admin', departmentId: 'd', cohortId: 'c' }, leave, 'approve'));
  assert.equal(nextLeaveState({ _id: 'p', kind: 'professor', departmentId: 'd' }, leave, 'approve'), 'pending_admin');
  assert.throws(() => nextLeaveState({ _id: 'q', kind: 'professor', departmentId: 'd' }, leave, 'approve'));
  leave.status = 'pending_admin';
  assert.equal(nextLeaveState({ kind: 'admin', departmentId: 'd', cohortId: 'c' }, leave, 'approve'), 'approved');
  assert.throws(() => nextLeaveState({ kind: 'admin', departmentId: 'd', cohortId: 'x' }, leave, 'approve'));
});
test('Jalali conversion handles Persian digits and Tehran day boundaries', () => {
  assert.equal(jalaliToISO('۱۴۰۵/۰۱/۰۱', '۰۸:۳۰'), '2026-03-21T05:00:00.000Z');
  const interval = dayInterval('1405/01/01');
  assert.equal(interval.startAt, '2026-03-20T20:30:00.000Z');
  assert.equal(interval.endAt, '2026-03-21T20:30:00.000Z');
  assert.throws(() => jalaliToISO('1405/12/30'));
  assert.throws(() => jalaliToISO('1405/01/01', '25:00'));
});
test('approved leave applies dynamically and never treats pending leave as absence', () => {
  const s = { _id: 's', startAt: '2026-09-26T08:00Z', endAt: '2026-09-26T09:00Z' };
  assert.equal(leaveApplies({ type: 'session', sessionId: 's', status: 'pending_admin' }, s), false);
  assert.equal(leaveApplies({ type: 'session', sessionId: 's', status: 'approved' }, s), true);
  assert.equal(leaveApplies({ type: 'hourly', status: 'approved', startAt: '2026-09-26T08:30Z', endAt: '2026-09-26T08:45Z' }, s), true);
});
