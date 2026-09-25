import jalaali from 'jalaali-js';
import { DateTime } from 'luxon';
import { z } from 'zod';

export const ZONE = 'Asia/Tehran';
export const id = z.string().uuid();
export const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,39}$/);
export const passwordSchema = z.string().min(12).max(128);
export const nameSchema = z.string().trim().min(2).max(120);
export const statusSchema = z.enum(['present', 'absent']);
export const observationSchema = z.object({
  studentId: id, status: statusSchema, version: z.number().int().min(0),
  operationId: id, recordedAt: z.iso.datetime({ offset: true }),
}).strict();
export const sessionSchema = z.object({
  title: z.string().trim().min(2).max(160), description: z.string().max(2000).default(''),
  room: z.string().trim().max(120).default(''), startAt: z.iso.datetime({ offset: true }), endAt: z.iso.datetime({ offset: true }),
  professorIds: z.array(id).min(1).max(20), cohortIds: z.array(id).min(1).max(30),
}).strict().refine(v => new Date(v.endAt) > new Date(v.startAt), { message: 'End must be after start', path: ['endAt'] });

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}
export function ownCohort(user, cohortId) { return Boolean(user.cohortId && String(user.cohortId) === String(cohortId)); }
export function canManage(user, cohortId) { return user.kind === 'admin' && ownCohort(user, cohortId); }
export function canRep(user, cohortId) { return user.kind === 'student' && user.isRep && ownCohort(user, cohortId); }
export function activeParticipation(p) { return p.status === 'approved' && p.confirmed; }
export function canObserve(user, session, student) {
  if (user.departmentId !== session.departmentId || student.departmentId !== session.departmentId) return false;
  const p = session.participations.find(p => p.cohortId === student.cohortId && p.studentIds.includes(student._id));
  if (!p || !activeParticipation(p)) return false;
  return canRep(user, p.cohortId) || (user.kind === 'professor' && session.professorIds.includes(user._id));
}
export function nextLeaveState(user, leave, decision) {
  if (user.departmentId !== leave.departmentId) throw new Error('FORBIDDEN');
  if (user.kind === 'professor' && user._id === leave.professorId && leave.status === 'pending_professor') return decision === 'approve' ? 'pending_admin' : 'professor_denied';
  if (canManage(user, leave.cohortId) && leave.status === 'pending_admin') return decision === 'approve' ? 'approved' : 'admin_denied';
  throw new Error('INVALID_TRANSITION');
}
export function digits(value) {
  return value.replace(/[۰-۹]/g, c => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
}
export function jalaliToISO(date, time = '00:00') {
  const match = digits(date).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const clock = digits(time).match(/^(\d{1,2}):(\d{2})$/);
  if (!match || !clock) throw new Error('INVALID_JALALI_DATE');
  const [, y, m, d] = match.map(Number);
  if (!jalaali.isValidJalaaliDate(y, m, d)) throw new Error('INVALID_JALALI_DATE');
  const { gy, gm, gd } = jalaali.toGregorian(y, m, d);
  const dt = DateTime.fromObject({ year: gy, month: gm, day: gd, hour: Number(clock[1]), minute: Number(clock[2]) }, { zone: ZONE });
  if (!dt.isValid) throw new Error('INVALID_JALALI_DATE');
  return dt.toUTC().toISO();
}
export function dayInterval(date) {
  const start = DateTime.fromISO(jalaliToISO(date)).setZone(ZONE);
  return { startAt: start.toUTC().toISO(), endAt: start.plus({ days: 1 }).toUTC().toISO() };
}
export function jalaliToday() {
  const now = DateTime.now().setZone(ZONE);
  const { jy, jm, jd } = jalaali.toJalaali(now.year, now.month, now.day);
  return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
}
export function jalaliDateTime(iso) {
  const dt = DateTime.fromISO(String(iso)).setZone(ZONE);
  const { jy, jm, jd } = jalaali.toJalaali(dt.year, dt.month, dt.day);
  return { date: `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`, time: dt.toFormat('HH:mm') };
}
export function leaveApplies(leave, session) {
  return leave.status === 'approved' && (leave.type === 'session' ? leave.sessionId === session._id : overlaps(leave.startAt, leave.endAt, session.startAt, session.endAt));
}
