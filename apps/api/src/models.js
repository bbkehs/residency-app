import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const { Schema } = mongoose;
const key = { type: String, default: () => randomUUID() };
const ref = { type: String, required: true };
function model(name, definition, indexes = []) {
  const schema = new Schema({ _id: key, ...definition }, { timestamps: true, strict: 'throw', versionKey: false });
  for (const [fields, options] of indexes) schema.index(fields, options);
  return mongoose.model(name, schema);
}
export const Department = model('Department', { code: { type: String, unique: true }, name: String, nameFa: String });
export const Cohort = model('Cohort', { departmentId: ref, year: Number, name: String }, [[{ departmentId: 1, year: 1 }, { unique: true }]]);
export const User = model('User', {
  username: { type: String, unique: true, required: true }, name: String, passwordHash: { type: String, select: false },
  departmentId: ref, cohortId: String, approvalCohortId: String,
  kind: { type: String, enum: ['admin', 'student', 'professor'], required: true },
  isRep: { type: Boolean, default: false }, status: { type: String, enum: ['pending', 'active', 'rejected', 'suspended'], default: 'pending' },
  mustChangePassword: { type: Boolean, default: false }, authVersion: { type: Number, default: 0 },
}, [[{ departmentId: 1, cohortId: 1, status: 1 }, {}]]);
export const LoginSession = model('LoginSession', { tokenHash: { type: String, unique: true }, userId: ref, csrf: String, authVersion: Number, expiresAt: Date }, [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]]);
const participation = new Schema({
  cohortId: ref, studentIds: [String], confirmed: { type: Boolean, default: false }, confirmedBy: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'superseded'], default: 'pending' }, approvedBy: String,
}, { _id: false, strict: 'throw' });
export const ClassSession = model('ClassSession', {
  departmentId: ref, ownerCohortId: ref, title: String, description: String, room: String,
  startAt: Date, endAt: Date, professorIds: [String], participations: [participation], createdBy: ref,
  revision: { type: Number, default: 1 }, version: { type: Number, default: 0 }, replacesId: String, nextProposalId: String,
}, [[{ departmentId: 1, 'participations.cohortId': 1, startAt: 1 }, {}]]);
export const Observation = model('Observation', {
  departmentId: ref, cohortId: ref, sessionId: ref, studentId: ref, observerId: ref,
  role: { type: String, enum: ['rep', 'professor'] }, status: { type: String, enum: ['present', 'absent'] },
  recordedAt: Date, receivedAt: Date, version: Number,
}, [[{ sessionId: 1, studentId: 1, observerId: 1, role: 1 }, { unique: true }]]);
export const Receipt = model('Receipt', { actorId: ref, operationId: ref, digest: String, result: Schema.Types.Mixed }, [[{ actorId: 1, operationId: 1 }, { unique: true }]]);
export const Leave = model('Leave', {
  departmentId: ref, cohortId: ref, studentId: ref, professorId: ref,
  type: { type: String, enum: ['day', 'session', 'hourly'] }, sessionId: String, startAt: Date, endAt: Date, reason: String,
  status: { type: String, enum: ['pending_professor', 'pending_admin', 'approved', 'professor_denied', 'admin_denied'], default: 'pending_professor' },
  professorDecision: Schema.Types.Mixed, adminDecision: Schema.Types.Mixed, version: { type: Number, default: 0 },
}, [[{ departmentId: 1, cohortId: 1, status: 1 }, {}], [{ studentId: 1, status: 1 }, {}]]);
export const LeaveOverride = model('LeaveOverride', { departmentId: ref, cohortId: ref, sessionId: ref, studentId: ref, status: { type: String, enum: ['present', 'absent'] }, reason: String, actorId: ref }, [[{ sessionId: 1, studentId: 1 }, { unique: true }]]);
export const Notification = model('Notification', { recipientId: ref, type: String, entityId: String, readAt: Date }, [[{ recipientId: 1, createdAt: -1 }, {}]]);
export const Thread = model('Thread', { departmentId: ref, cohortId: ref, professorId: ref, subject: String });
export const Message = model('Message', { threadId: ref, authorId: ref, text: String }, [[{ threadId: 1, createdAt: 1 }, {}]]);
export const Audit = model('Audit', { departmentId: ref, cohortId: ref, actorId: ref, action: String, entityId: String, detail: Schema.Types.Mixed }, [[{ cohortId: 1, createdAt: -1 }, {}]]);
export const models = { Department, Cohort, User, LoginSession, ClassSession, Observation, Receipt, Leave, LeaveOverride, Notification, Thread, Message, Audit };
export async function initializeIndexes() { await Promise.all(Object.values(models).map(m => m.init())); }
