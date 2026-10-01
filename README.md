# Cohort — residency attendance

A MERN PWA for department-separated residency cohorts. This first implementation follows the decisions in [docs/blueprint.md](docs/blueprint.md). “Cohort” means one department/year; “session” means one non-recurring scheduled class.

## Implemented

- Username/password signup with cohort-admin approval; admin-issued accounts and temporary password resets. Passwords are hashed, never retrievable. Temporary passwords must be changed on first login.
- Separate department membership, cohort-scoped admins, and representative privileges added to student accounts. Admins can assign/revoke reps and suspend residents.
- Shared, multi-professor sessions, per-cohort schedule approval, and rep-confirmed participant rosters. Schedule revisions preserve the original until each cohort approves its replacement. Overlaps warn without blocking submission.
- Independent timestamped rep and professor observations, including several professors per session. Reports show every source separately, with no combined attendance verdict.
- Day, session, and hourly leave; selected professor approval followed by cohort-admin approval. Approved leave supplies a separate absent status, with an audited admin override. Observer records remain intact.
- Attendance reports with CSV export, scoped activity history, professor/admin message threads, and in-app notifications.
- Optional browser push with explicit per-browser consent, English/Persian generic alerts, durable retries, and login-scoped subscriptions.
- English/Persian screens, RTL layout, Jalali date entry and display, and Tehran timezone handling.
- Installable PWA, explicitly downloaded rosters, an IndexedDB attendance queue, ordered/idempotent sync, stale-write detection, and logout cleanup.

## Quick local demonstration

Requires Node.js 22 or newer. This uses an actual temporary MongoDB replica set with fictional data. It does not connect to an existing database. The MongoDB test binary is downloaded on first use.

```bash
npm ci
npm run demo
```

Open **http://localhost:4000**.

| Role | Demo username |
| --- | --- |
| Year 1 cohort admin | `demo-admin` |
| Year 1 representative | `demo-rep` |
| Assigned professor | `demo-professor` |
| Resident | `demo-student` |
| Year 2 cohort admin | `demo-year2-admin` |

The **demo-only** password for these fictional accounts is `Demo-Only-2026!`. The demo binds to loopback and loses its data when stopped. It must not be exposed as a real service or used for actual residents.

The demo includes contradictory observations to illustrate that the admin sees both sources without a final verdict. Attendance examples are fictional, even if their sessions are scheduled in the future.

## Development with persistent MongoDB

MongoDB must support transactions: use a replica set or a suitable Atlas deployment. The supplied Compose file starts a local single-node replica set, bound to loopback. It is a development database without authentication, not a production database configuration.

```bash
npm ci
cp .env.example .env
docker compose up -d --wait
```

Edit `.env` to match your local connection and origin:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27017/residency?replicaSet=rs0&directConnection=true
PORT=4000
APP_ORIGIN=http://localhost:5173
NODE_ENV=development
```

### Initial departments and admins

`npm run setup` creates PM&R and Neurology and four year cohorts per department by default. It does not create accounts with default passwords.

To create the cohort administrators, add a `SETUP_ADMINS_JSON` array to `.env` with one entry per admin. Use different private passwords for every account. For example, replace the sample value below before running setup:

```dotenv
SETUP_ADMINS_JSON='[{"department":"PMR","year":1,"username":"pmr-year1-admin","name":"PM&R Year 1 Admin","password":"REPLACE-WITH-A-UNIQUE-PRIVATE-PASSWORD"}]'
```

Use department codes `PMR` and `NEU`, and years 1–4, for the initial eight admin entries. Each created admin must change their initial password at first login. The script does not overwrite existing credentials. Remove the password-bearing setup variable afterward.

```bash
npm run setup
npm run dev
```

Open **http://localhost:5173**. Vite proxies API requests to port 4000. Sign in as the configured admin, change the password, create/approve professor and resident accounts, assign a rep, and create a session.

For new departments or different year counts, run setup with a custom catalog definition:

```dotenv
SETUP_DEPARTMENTS_JSON='[{"code":"PMR","name":"Physical Medicine & Rehabilitation","nameFa":"طب فیزیکی و توانبخشی","years":4},{"code":"NEU","name":"Neurology","nameFa":"نورولوژی","years":4}]'
```

Initial setup is an operator command, not a public web endpoint. Ordinary cohort admins cannot create other administrators or expand their scope through the API. Changes to admin appointments and shared professor identity management remain operator responsibilities in this release.

## Production build and runtime

```bash
npm run build
npm start
```

Express serves the built React app and API from the same origin. Set `NODE_ENV=production`, `APP_ORIGIN=https://your-domain.example` (no trailing slash), and a private authenticated `MONGODB_URI`. Place the app behind HTTPS so secure session cookies and PWA features work. Set `TRUST_PROXY=true` only when requests pass through exactly one trusted reverse proxy.

The Dockerfile builds the frontend and runs Express as a non-root user. Supply runtime environment variables; never include real `.env` files or credentials in an image. The Compose database is only for local development.

This deliverable does not provision hosting, a production MongoDB database, TLS, backups, browser-push credentials, or a production domain. Test your production database, proxy/origin configuration, backup recovery, and operational limits before using actual resident records. No deployment has been performed.

## Browser notifications

Push is disabled by default. To configure a persistent installation, run `npm run push:keys` once, store the generated key pair in the server environment, and set `PUSH_ENABLED=true` plus a real `VAPID_SUBJECT` operator contact. Do not commit the private key. See [docs/push-notifications.md](docs/push-notifications.md) for the complete setup, lifecycle, and delivery limits.

Users enable notifications from the notification bell. The app does not ask for browser permission until they press **Enable on this browser**. Push alerts contain generic text only; records remain inside the authenticated app. Sign-out or password reset revokes the related subscriptions. The fictional `npm run demo` deliberately does not deliver browser push.

The server validates production origin and push configuration at startup, checks for a transaction-capable MongoDB deployment, and exposes `/api/ready` for database readiness (`/api/health` remains a liveness check).

### Windows: use an installed MongoDB executable

If the demo cannot download MongoDB, set these in the same PowerShell terminal before running it. Replace the example executable path and version with those from your installation:

```powershell
$env:MONGOMS_SYSTEM_BINARY = "C:\Program Files\MongoDB\Server\7.0\bin\mongod.exe"
& $env:MONGOMS_SYSTEM_BINARY --version
$env:MONGOMS_VERSION = "7.0.24"
$env:MONGOMS_RUNTIME_DOWNLOAD = "false"
npm run demo
```

The demo launches this executable in its own temporary replica set; it does not connect to your existing database or require you to start a MongoDB service. Its data is discarded when the demo stops. The Windows startup fix omits Unix-only arguments.

## Verification

```bash
npm test
npm run build
```

The test suite uses a temporary MongoDB replica set. It covers department/cohort isolation, pending signup, CSRF/origin validation, session approval, independent attendance, timestamps and history, idempotency, stale writes, leave ordering/effects, password resets, messages, schedule revisions, and Jalali/Tehran boundaries.

For browser checks:

```bash
npx playwright install chromium
npm run test:browser
```

The browser check starts its own temporary fictional demo on localhost:4100 and stops it afterward. It changes demo data while checking login, attendance, offline reload and replay, reports, Persian/mobile layout, account flows, and opt-in/disable/language/logout notification controls with a mocked push provider. Screenshots and test output go into `test-results/` and are not application records.

In a restricted execution environment without writable `/tmp`, use a writable temporary directory:

```bash
mkdir -p .runtime/tmp
TMPDIR="$PWD/.runtime/tmp" npm test
```

## Attendance and leave semantics

- Rep and professor observations have independent current values and audit history. The server never computes an authoritative combined value.
- Device-recorded time and server-received time are distinct. Offline device timestamps are not verified proof of attendance time.
- A missing mark means “Not recorded,” not absent.
- Approved leave is projected when the report is read, so approved day/hour leave also covers later enrollment or scheduling changes. Its status is shown separately from observer entries.
- Hourly leave applies to overlapping sessions. Touching interval endpoints do not overlap. Whole-day leave uses Tehran midnight boundaries.
- Session-specific leave remains tied to the specific session/revision requested. If it is rescheduled into a new revision, the resident must request leave for that replacement. Day/hour requests continue to apply by their approved intervals.
- Each cohort approves a schedule revision separately. Original records remain available as history. No roster participant with attendance records can be removed.

## Offline behavior

Only representatives record attendance offline in this release. While connected, use **Save for offline attendance** on the approved session. Recording an attendance entry also downloads its current roster.

Each local edit is queued in order with a unique operation ID and expected record version. After reconnection, the server rechecks the current user, rep assignment, enrollment, and session status. Replayed operations do not duplicate observations or audit events. Conflicting changes are retained as “Needs review”; later edits to that same resident remain blocked until the rep reviews/discards the queue and reloads current data.

The app shell is cached by the production service worker. API responses are never service-worker cached. Private downloaded rosters and the outbox live in account-scoped IndexedDB and are cleared on logout. Offline logout is completed on the server after connectivity returns. A revoked permission cannot be detected by an offline device until it reconnects; the server always rechecks permission before accepting queued edits.

The app must be open to sync reliably. Background attendance sync is not implemented. Optional browser push is independent of attendance synchronization. Do not use downloaded private rosters on an untrusted/shared device.

## Current boundaries

- Browser push requires operator configuration and user permission; delivery remains best effort. See [notification setup](docs/push-notifications.md).
- No imports, absence thresholds, recurring schedules, file attachments, or global administrator UI.
- Jalali date input uses validated text fields and time controls, not a graphical calendar picker.
- Account and session lists are bounded to 1,000 accounts / 300 sessions; leave lists to 300 requests; notifications and conversation lists to 100; each message thread displays up to 500 messages. Audit history is paginated. Reports reject ranges over one year or more than 200 sessions. Add cursor pagination before a deployment requires larger working sets.
- The signup/login rate limiter is in-process. Multiple API instances need a shared limiter store and deployment-level traffic controls.
- Shared professor activation is sponsored by a cohort admin; shared professor identity changes are not exposed to ordinary cohort admins.
- No email/SMS delivery or forgotten-password self-service; account recovery is an admin-issued temporary password for residents and operator maintenance for shared professor/admin identities.

## Layout

```text
apps/api/src/       Express API, MongoDB models, authorization and workflows
apps/api/test/      MongoDB integration tests
apps/web/src/       React panels, English/Persian copy, offline queue
apps/web/public/    PWA manifest and icons
packages/domain/   Shared validation, scope and date rules
scripts/           Fictional demo and browser checks
docs/              Requirements and implementation notes
```

See [docs/implementation-notes.md](docs/implementation-notes.md) for the initial verification record and design choices. Phase-specific changes and verification are in [docs/push-notifications.md](docs/push-notifications.md).
