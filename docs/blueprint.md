# Residency attendance application — implementation blueprint

Version: 1.0 · 25 September 2026

Status: Requirements and application design. No application code has been implemented or deployed in this deliverable. Rules below distinguish user decisions from implementation defaults that can be adjusted during development.

## 1. Purpose and stack

A MERN application (MongoDB, Express, React, Node.js), delivered as an installable PWA, for residency schedules, attendance, leave requests, and simple messages to administrators.

Initial departments: PM&R and Neurology. Each has four residency-year cohorts, with one cohort admin and one student representative per cohort initially. Support additional departments and configurable cohorts/rep assignments without hard-coded department names or a four-year limit.

### Terminology

| Term | Meaning |
| --- | --- |
| Department | An isolated department such as PM&R or Neurology |
| Cohort | All residents in a particular year within one department |
| Session | One non-recurring scheduled class with explicit start and end times |
| Session participation | One cohort's roster and approval state for a shared session |
| Observation | A rep's or individual professor's attendance entry for a resident |

Students and professors cannot belong to multiple departments. A session can have multiple professors and participating cohorts, all within its department.

## 2. Confirmed rules

### Accounts and permissions

- Login uses username and password.
- Self-signup remains pending until approval; pending users cannot access the application panels or protected data.
- Admins may also create accounts and issue initial credentials.
- Cohort admins can manage only their cohort within their department. There is no general cross-cohort student-data permission.
- A rep is an enrolled student with an additional assignment to their own cohort. The student panel remains available to them.
- Admins can change rep assignments for their own cohort.
- Reps can request both new student accounts and enrollment of existing students. New accounts require admin approval.
- Initial departments and admin appointments use an initial setup process. Administrative ownership of this process does not grant all cohort admins unrestricted application access.

### Sessions and schedules

- Sessions are individual events, not recurring course rules.
- Reps can propose sessions and schedule changes. Admin approval is required before these become approved schedules/classes.
- Each rep confirms which of their own cohort's residents are included in a shared session.
- Students see sessions to which they are assigned; professors see their assigned sessions.
- Scheduling overlaps generate warnings, not blocking errors.

### Attendance

- Reps mark attendance for their own cohort's session roster.
- Professors assigned to a session may independently record present or absent.
- Each professor's observations are retained separately, including when several professors teach the same session.
- Record the time each rep checks or changes a resident's attendance.
- Admin approval is not required for attendance submissions.
- Admins see the rep's and each professor's observations side by side.
- Do not calculate a combined present/absent verdict, require conflict resolution, or introduce a disputed approval workflow.
- An unmarked resident is unmarked, not automatically absent.
- Preserve prior values in the audit history when an observer changes their own entry.

### Leave

- A student can request whole-day, session-specific, or hourly leave.
- They choose one professor from their department's professor list.
- The selected professor approves or denies first.
- Only after professor approval can the student's cohort admin approve or deny.
- Admins are notified after professor approval. The student is notified when both approvals are complete.
- One selected professor's approval is sufficient even if the leave affects multiple classes/professors.
- Fully approved leave automatically sets the affected leave-related attendance status to absent, unless the admin changes it.
- Do not replace or erase rep/professor observations when applying approved leave.

### Other features

- Professors can send simple messages to an admin.
- Include attendance reports and audit history.
- English and Persian interfaces; Persian uses right-to-left layout.
- Jalali date input and display.
- Prefer offline attendance recording; notifications are desirable.
- Student imports and absence thresholds are outside the first-release scope.

## 3. Implementation defaults

These resolve operational details without adding new approval roles. They are design choices, not additional user-confirmed requirements.

1. **Shared sessions:** each participating cohort admin approves the schedule for their own cohort. Each rep confirms their own roster. Approval by one admin cannot publish another cohort's participation. An admin creating a schedule for their own cohort may approve it in the same audited action.
2. **Shared revisions:** changes to time, professors, room, or session identity create a proposed revision. The existing approved revision remains visible until the replacement is approved. Re-approval applies to affected cohorts; another cohort's approval cannot be impersonated.
3. **Initial administration:** a deployment setup command initializes departments, cohorts, and admin accounts. It is not a public registration endpoint. A future organization-management interface requires a separate explicit permission design.
4. **Professor onboarding:** a cohort admin in the professor's department can approve a pending professor account for use in their own sessions. Professor identity is department-wide; ordinary cohort admins do not subsequently reset, disable, or change a professor shared by other cohorts. Such identity maintenance belongs to the setup operator until an explicit departmental management permission is agreed.
5. **Passwords:** store password hashes only. Admins can issue temporary credentials and initiate scoped resets; temporary credentials require a password change. No endpoint displays existing passwords. This replaces the requested password-visibility approach while preserving account recovery.
6. **Leave display:** show a separate “Leave-related attendance: Absent — approved leave” field. An admin override changes only that field, with a reason and audit trail. It does not decide between rep and professor observations.
7. **Hourly leave:** apply leave when its interval overlaps an assigned session; visibly display the leave interval to explain partial overlap. Use half-open intervals: a leave ending exactly when a class starts does not overlap it.
8. **Whole-day leave:** cover the selected calendar day in Asia/Tehran, not a fixed UTC day.
9. **Notifications:** in-app notifications are first-release baseline. Browser push is an optional later addition requiring permission and delivery configuration. Notify students of denials as well as final approval.
10. **Messages:** professor-to-cohort-admin threads with simple text replies and read/unread state. No attachments or additional ticket lifecycle in the initial scope.
11. **Student visibility:** residents see their own attendance and leave, never classmates' attendance or leave details.
12. **Time:** Asia/Tehran is the initial application timezone. Persist absolute timestamps with timezone context and convert Jalali input at the boundary. English and Persian both support Jalali dates.
13. **Enrollment:** a rep's roster confirmation can select already approved residents of their own cohort. A proposed new resident stays pending until account approval. Rep confirmation of the roster is distinct from the admin's session/schedule approval.

## 4. Authorization matrix

Every scope is enforced by the server, including list, detail, update, report, notification, message, and offline-sync endpoints. Hiding controls in React is insufficient.

| Action | Student | Rep | Professor | Cohort admin |
| --- | --- | --- | --- | --- |
| View own assigned sessions | Yes | Yes | Assigned teaching sessions | Own cohort sessions |
| Request leave | Own requests | Own requests | — | Review own cohort requests after professor |
| First-stage leave decision | — | — | Selected approver only | — |
| Final leave decision | — | — | — | Own cohort, after professor approval |
| Propose a session or schedule | — | Own cohort | — | Own cohort |
| Confirm participating residents | — | Own cohort | — | Manage own cohort |
| Approve session/schedule | — | — | — | Own cohort participation |
| Record rep attendance | — | Own cohort, active assignment | — | — |
| Record professor attendance | — | — | Assigned session, own observation | — |
| View attendance observations | Own rows | Own cohort | Assigned session | Own cohort rows |
| Override leave-related absence | — | — | — | Own cohort, audited |
| Request new account/enrollment | Self-signup | Own cohort | Self-signup | Own cohort provisioning |
| Approve student accounts | — | — | — | Own cohort |
| Assign/revoke rep | — | — | — | Own cohort |
| View audit history | — | — | — | Own cohort events, scoped shared events |
| Message admin | — | — | Relevant cohort admin | Reply to authorized threads |

Professors receive only the student information necessary for their assigned sessions and selected leave requests. A cross-year session does not allow its admins to read another cohort's roster, leave requests, or private reports.

## 5. Attendance report design

One report row per session participant. Columns:

| Resident | Rep observation | Rep recorded at | Server received at | Professor A | Professor B | Approved leave | Admin leave override |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Example resident | Present | 08:03 | 08:05 | Absent · 08:12 | Not recorded | None | None |

The example intentionally has no final-status column. Multiple professors generate independently labeled columns or expandable entries. On mobile, render the same information in a resident detail card.

Reports can filter by date range, session, cohort, resident, and observer. If totals are displayed, label them by source (rep-reported absences, each professor's observations, leave-related absences); never merge them into a conclusive attendance score.

The client-recorded timestamp and server receipt timestamp must remain distinguishable. Offline device time is informative, not proof of when an observation occurred.

## 6. Data model

Use MongoDB collections with explicit references. Store department and cohort scope wherever required for reliable authorization and efficient filtering. All references must be validated against the authenticated actor's permissions.

| Collection | Essential fields and invariants |
| --- | --- |
| Department | Name, code, active status; unique department code |
| Cohort | Department, residency-year label, active status; one department per cohort |
| User | Canonical username, display name, password hash, department, optional student cohort, roles, approval status, forced-password-change flag, account version; unique canonical username |
| RoleAssignment | User, role, department, cohort where applicable, active dates, assigning admin; rep must be a student of the assigned cohort |
| Session | Department, title, description, room/location, owning cohort, professor IDs, revision metadata; no recurring rule |
| SessionRevision | Session, revision number, start/end timestamps, timezone, proposed details, author; approved revisions retained |
| SessionParticipation | Session, revision, cohort, schedule approval, approving admin, roster confirmation, confirming rep |
| Enrollment | Session participation, student, state, proposing actor; unique participation/student pair |
| AttendanceObservation | Session, student, observer, observer role/assignment, present/absent status, client recorded time, server receipt time, revision, operation ID |
| LeaveRequest | Student, department, cohort, type, session ID or interval, chosen professor, optional reason, state, professor decision, admin decision |
| LeaveAttendanceEffect | Approved leave, affected enrollment/session, absent status, admin override, reason; idempotent effect per leave/enrollment |
| MessageThread | Professor, target cohort admin scope, subject, participants |
| Message | Thread, author, text, created time, read state |
| Notification | Recipient, event type, entity reference, created time, read time, delivery state |
| AuditEvent | Actor, department/cohort scope, action, entity, safe before/after values, server time, request ID; append-only through application APIs |
| SyncReceipt | Actor, operation ID, payload digest, result, server receipt time; unique actor/operation pair |

Do not write passwords, password hashes, session tokens, or unnecessary sensitive leave reasons into audit events, notifications, or application logs.

Attendance uniqueness is per session, resident, observer, and observation role/assignment. A student rep's ordinary student identity must not enable them to write another observer's entry. History is retained separately from the current observation value.

## 7. Workflow state machines

### Accounts

Self-signup or rep-proposed account → pending → approved or rejected.

Approved accounts can be suspended by an authorized administrator. Rejection and suspension immediately block protected access. Resetting a password invalidates existing sessions according to the account session policy.

### Session participation

Draft → submitted → approved or rejected. Approval references an exact session revision. A material proposed revision must not silently inherit an earlier revision's approval.

Roster confirmation is separate: unconfirmed → confirmed by that cohort's rep. A session becomes available for that cohort's attendance when the schedule is approved and its roster is confirmed. Admin changes to enrollment remain audited.

### Leave

Submitted → professor approved → admin approved.

Submitted → professor denied.

Professor approved → admin denied.

An admin cannot skip professor approval. Only the selected professor can perform the professor-stage decision. Reject repeated or stale transitions using version checks. A request cannot be edited to change professor, timing, or coverage after approval without a new request/review cycle.

On final approval, create leave effects and notifications idempotently. Newly approved enrollments or schedule changes that overlap already approved day/hour leave must also be evaluated. Multiple overlapping approved requests must not generate contradictory duplicate effects.

## 8. Offline PWA behavior

- Cache the application shell and explicitly downloaded approved session rosters for the signed-in rep.
- Store attendance edits in an IndexedDB outbox, partitioned by account.
- Each operation carries a unique ID, observation version, session revision, resident ID, status, and client-recorded time.
- Show clear saved-on-device, pending-sync, synced, and needs-review states.
- Sync while the application is open and connectivity returns. Do not depend exclusively on background-sync availability.
- The server checks current account status, rep assignment, roster membership, session validity, and version for every queued operation.
- Retry of the same operation must return the same result without duplicate attendance or audit records. A reused operation ID with a different payload is rejected.
- Independent rep and professor observations do not conflict. Conflicting edits to the same observer's record require explicit review; do not silently overwrite newer data.
- Revoked access or changed enrollment produces an explicit rejected-sync result. Locally queued operations must not grant authority after revocation.
- Logging out clears cached private rosters and account data. If unsynced entries exist, warn before discarding them; never send them under the next account.
- Offline mode is limited to downloaded session attendance initially. Login, approvals, enrollment changes, messaging, and leave submission require connectivity.

## 9. React application surfaces

### Shared

Login, signup, pending approval, required password change, profile/language preference, notification inbox, responsive navigation, connection/sync indicator.

### Student

Assigned sessions, session details, own attendance observations, leave request form (day/session/hour), selected-professor picker, leave progress/history.

### Representative

Student surfaces plus cohort roster, propose student/enrollment, propose session/schedule, confirm participants, attendance checklist, offline download/outbox, proposal status.

### Professor

Assigned sessions, attendance roster with rep observations and own observation controls, selected leave-request inbox, simple admin messages. Other professors' records are shown separately and cannot be edited.

### Cohort admin

Cohort overview, account approvals, residents, rep assignments, session/schedule approvals, second-stage leave approvals, side-by-side attendance reports, leave-related overrides, messages, and scoped audit history.

Shared session screens expose shared schedule details but filter resident rows by role scope. Both language layouts need keyboard-accessible forms and clearly labeled attendance controls, with no reliance on color alone.

## 10. Express API outline

Route names are design proposals; permissions and transitions are the requirements.

| Area | Representative routes |
| --- | --- |
| Authentication | POST /api/auth/signup, /login, /logout, /change-password; GET /api/auth/me |
| Accounts | GET /api/users; POST /api/users/proposals; POST /api/users/:id/approval; POST /api/users/:id/password-reset |
| Rep assignments | GET/POST /api/cohorts/:id/representatives; DELETE /api/cohorts/:id/representatives/:assignmentId |
| Sessions | GET/POST /api/sessions; GET /api/sessions/:id; POST /api/sessions/:id/revisions |
| Participation | POST /api/sessions/:id/participations; POST /api/participations/:id/approval; PUT /api/participations/:id/roster-confirmation |
| Attendance | GET /api/sessions/:id/attendance; PUT /api/sessions/:id/attendance/me/:studentId; POST /api/attendance/sync |
| Leave | GET/POST /api/leave; POST /api/leave/:id/professor-decision; POST /api/leave/:id/admin-decision |
| Leave effect | PUT /api/leave-effects/:id/admin-override |
| Reports | GET /api/reports/attendance |
| Messages | GET/POST /api/threads; GET/POST /api/threads/:id/messages |
| Notifications | GET /api/notifications; POST /api/notifications/:id/read |
| Audit | GET /api/audit-events |

Authenticated actors and scope come from validated server sessions, never trusted body fields. Apply request validation, pagination, scoped queries, rate limits on authentication, secure cookie sessions, CSRF protection where needed, and consistent error responses. Serve over HTTPS in production.

## 11. Project structure

Planned monorepo:

- apps/web — React panels, translated copy, Jalali input/display, PWA and offline outbox.
- apps/api — Express routes, authentication, authorization, domain services, MongoDB persistence.
- packages/contracts — shared request/response types and validation schemas.
- packages/domain — attendance, scope, scheduling, and leave transition rules that do not depend on HTTP.
- scripts — initial department/cohort/admin setup and migration tasks.
- docs — this specification, setup guide, and decisions.

Deployment requires a Node.js backend and MongoDB. Hosting credentials, database connection, and a production domain have not been supplied. Do not substitute an in-browser demo store for MongoDB or represent a static preview as the complete application.

## 12. Implementation order and acceptance criteria

### A. Identity and boundaries

Implement data models, setup process, signup/approval, login, scoped role assignments, and server authorization.

Accept when pending users cannot access protected data; a PM&R user cannot access Neurology records; and a cohort admin cannot retrieve another cohort's residents by changing URL parameters or request bodies.

### B. Sessions and enrollment

Implement session proposals, per-cohort approval, rep roster confirmation, shared teaching assignments, and overlap warnings.

Accept when two cohorts can join one session while their admins and reps manage only their own participation, and overlaps warn without preventing a valid submission.

### C. Attendance and reports

Implement timestamped rep observations, independent professor observations, audit history, and source-specific reports.

Accept when one rep marks a resident present and two professors mark different observations; the admin sees every entry and its timestamps with no conclusive verdict. Professor edits must never alter the rep's record.

### D. Leave and messages

Implement the sequential approval workflow, absence effects, scoped overrides, in-app notifications, and simple messages.

Accept when admin approval before professor approval fails; final approval adds an absent leave effect without changing observer records; overlapping class coverage is correct; and repeated approval processing cannot duplicate effects or notifications.

### E. Bilingual PWA and offline verification

Complete translated panels, Jalali date handling, RTL layout, installability, downloaded rosters, and outbox synchronization.

Accept when a rep can mark attendance offline and sync once without duplication; revoked reps cannot sync unauthorized edits; account switching cannot leak cached rosters; and stale edits remain visible for review.

Use meaningful integration tests for authorization, cross-cohort isolation, approval order, timestamp/history retention, date boundaries, and offline retries. Browser checks must cover representative mobile and desktop layouts in both languages. Production deployment follows implementation and verification, not this requirements document.

## 13. Deferred work

Student spreadsheet imports, configurable absence thresholds, recurring schedules, attachments, full ticket workflows, browser push delivery, multi-department identities, and a global administrator UI are not part of the initial agreed build.
