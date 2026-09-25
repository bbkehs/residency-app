# Initial implementation — 25 September 2026

This is a working local MERN implementation, not a production deployment. It includes a real Express/MongoDB backend, React panels, and a production PWA build. Demo records are fictional and isolated in a temporary MongoDB replica set.

## Verified

| Check | Result |
| --- | --- |
| Domain and MongoDB integration tests | 18 passing |
| Browser workflow checks | 11 passing |
| React/Vite production build | Passing |
| Production dependency audit | 0 reported vulnerabilities at verification time |
| English desktop and Persian mobile layouts | Rendered and inspected |

The browser checks cover admin login and account creation; downloaded attendance surviving an offline reload; two queued edits syncing in order; a representative proposing a shared session and confirming their roster; admin schedule approval; student → professor → admin leave approval; independent attendance columns; date-range reports and CSV export; messages and replies; and Persian RTL at a 390-pixel viewport. No JavaScript page errors were observed during the passing run.

The API tests additionally cover forged role fields, origin/CSRF rejection, cross-department and cross-cohort ID access, per-cohort session approval, multiple professor observations, idempotent replay, stale versions, history retention, approved leave effects and overrides, revoked representatives, offline queue owner identity, temporary password enforcement, session invalidation, message privacy, and per-cohort schedule revisions.

Browser testing identified and fixed an offline-reload issue: the client now refreshes its authenticated session and CSRF token before replaying its outbox. The sync API also requires the queue's original account ID to match the authenticated actor. These are independent of the enrollment and representative checks performed on every attendance operation.

## Implementation choices

- Node's salted scrypt password hashing; opaque cookie sessions stored as token hashes in MongoDB; login rate limiting; strict request schemas; origin checks and CSRF tokens for mutations.
- MongoDB transactions keep approvals, attendance receipts, audit events, and notifications consistent. The deployment therefore needs a replica set or a compatible Atlas configuration.
- Shared sessions contain one participation entry per cohort. API serializers remove other cohorts' resident rows for cohort admins, representatives, and residents.
- Each attendance record belongs to a session, resident, observer, and observation role. One professor cannot update another observer's entry.
- Approved leave is projected into reports separately from observer records. Admin overrides affect that leave-related field only.
- Schedule revisions use replacement session records with a link to the previous revision; each cohort retains its previous approved schedule until it approves the replacement.
- English and Persian text use a shared translation dictionary. Jalali input is validated and converted to absolute times using Asia/Tehran; stored timestamps remain timezone-independent instants.
- Private API responses are never put into the service-worker cache. Downloaded rep rosters and the ordered outbox are stored in account-scoped IndexedDB.

## Deliberate first-release limits

Browser push, attachments, imports, absence thresholds, recurring schedules, a global admin UI, and graphical date pickers are deferred. In-app notifications are implemented. List-size limits and operational setup requirements are documented in the README.

Automated testing used Chromium on Linux and a temporary MongoDB replica set. Native iOS/Android installation, Safari-specific PWA behavior, a production reverse proxy, real-world device clock changes, multi-instance rate limiting, production database credentials, and production backup/recovery have not been validated. The Docker/Compose files are provided but were not executed in this environment.

## Dependency documentation used

- [Express 5 API](https://expressjs.com/en/api/)
- [MongoDB Node driver transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/)
- [MongoDB transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/)

The package lock records the exact installed dependency versions. The initial dependency audit is a point-in-time result, not a guarantee about future vulnerabilities.
