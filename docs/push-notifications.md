# Phase: browser push notifications

This phase adds optional browser push to the existing in-app notification events: account and schedule approvals, leave decisions, and messages. Attendance/leave semantics and cohort permissions remain as defined in the blueprint. The Windows demo fix is preserved.

## Operator setup

1. Use the persistent development or production setup in the README. The fictional demo intentionally disables push. Browser checks may set `DEMO_TEST_PUSH=true` for synthetic subscriptions; even then the demo never starts a delivery worker.
2. Run `npm run push:keys` once. Store `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in the server's environment or a private `.env`. Keep the same pair across restarts and across API instances. Never put the private key in the React build or commit it.
3. Set `PUSH_ENABLED=true` and `VAPID_SUBJECT=mailto:your-real-operator-address@example.com` (replace this example with your monitored contact). A public HTTPS contact URL is also accepted. Startup rejects missing or mismatched keys. Push disabled requires no keys.
4. Run `npm run build` and `npm start`. Production requires an exact HTTPS `APP_ORIGIN`, authenticated MongoDB replica-set/sharded connection, and suitable TLS/reverse-proxy setup. Local browser checks use trusted localhost. The production service worker is emitted by the build; Vite's development server alone does not provide the installed push worker.
5. Sign in and open the notification bell. Press **Enable on this browser**, then grant the browser's permission request. No permission prompt occurs automatically. Unsupported browsers and denied permission have explanatory messages; on iOS/iPadOS use an installed Home Screen web app where supported.

Allow outbound HTTPS to the browser vendor's push service. Default exact endpoint hosts are `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `push.services.mozilla.com`, and `web.push.apple.com`. The optional `PUSH_ALLOWED_HOSTS` accepts additional comma-separated exact trusted provider hostnames. Never add user-controlled hosts or internal services. HTTP URLs, credentials, non-default ports, wildcards, and malformed encryption keys are rejected. The transport does not follow redirects.

For production activation, test on actual target devices after setting up your domain and keys. The automated provider mock does not prove real vendor delivery, operating-system notification display, Safari support, or delivery under device power/network restrictions.

## Account and privacy behavior

- One subscription per authenticated login session; several signed-in browsers/devices may subscribe independently. Authentication, Origin and CSRF checks protect subscription mutations. Endpoints and encryption keys are omitted from read responses.
- An endpoint bound to one user cannot be adopted by another. Enabling again replaces the current login's subscription and cancels its old queued work.
- Subscriptions expire with the login (at most seven days) or sooner if the browser reports expiration. Sign-out revokes that login; password changes/resets and account suspension revoke all affected login subscriptions. The worker also rechecks account status, auth version, session expiry, subscription version, and unread notification ownership immediately before sending.
- Local sign-out clears the browser binding, closes displayed app notifications, and attempts to unsubscribe even offline. On reconnection, pending server logout is completed. Other tabs reload after account changes. Stale subscription identifiers are ignored by the worker on the device. Logging in again requires enabling push again.
- The push payload and displayed alert contain fixed generic copy in English or Persian, plus opaque notification/subscription identifiers. No names, cohort, attendance status, leave reason, message content, or notification event type is included. Notification clicks open the app's authenticated inbox, never a supplied external URL.
- Delivery that has already been handed to a vendor cannot be recalled. Account changes during a network request can race the send, so generic text and local binding validation provide an additional privacy boundary. If browser storage is deleted but the OS subscription remains, re-enable or disable it through the controls.

## Queue and operations

The existing workflow transaction creates both the in-app notification and one delivery record for each active subscription. Provider network requests happen afterward in the server worker, so provider downtime does not block an approval or message transaction.

The worker polls every ten seconds, claiming up to ten deliveries per pass. Atomic leases permit multiple API processes; a crashed worker's lease can be reclaimed after sixty seconds. Network errors, HTTP 429 and 5xx receive exponential backoff starting at thirty seconds, bounded to one hour and respecting bounded `Retry-After`. A delivery has at most six send attempts. HTTP 404/410 removes the expired subscription; other permanent failures stop retries. Delivery records have seven-day TTL cleanup. MongoDB TTL cleanup is asynchronous; explicit expiry checks prevent sending expired records.

Handoff is at least once: a process crash after sending but before saving success may retry. Stable notification tags allow browsers to replace repeated alerts. A successful provider response means accepted for delivery, not that a person saw it. Payload TTL is one hour; delivery is best effort. The in-app inbox remains the durable record and polls while the app is open. Already-read notifications are skipped.

Changing VAPID keys requires browsers to re-enable notifications. Stop all workers (`PUSH_ENABLED=false`) before rotating keys, then restart all instances with the same new pair. Old-key jobs are cancelled on eligibility checks. Disabling push stops sends but does not immediately erase queue entries; when re-enabled, still-eligible queued items may be sent until their expiry. Admins do not have a delivery monitoring UI in this phase.

`/api/ready` returns 200 only when MongoDB responds to a ping, otherwise 503. The Docker image uses it for health checks. Startup validates origin, port, proxy flag, VAPID configuration and MongoDB transaction capability. Shutdown drains the current delivery and HTTP requests before disconnecting the database, with a thirty-second ceiling.

## Verification

Automated tests cover subscription ownership, invalid endpoints/keys, CSRF, transaction rollback, atomic worker claims, generic localized payloads, retry timing, expiration, revocation, replacement, and service-worker display/click behavior. Browser tests exercise explicit permission, reload persistence, language updates, disabling and logout with mocked browser subscription/permission APIs. They also rerun the existing attendance, leave, report, message, and offline workflows. No automated test sends a real push.

The GitHub `Application checks` workflow runs the database suite and Chromium browser checks on Ubuntu. See the pull request checks for current results. Local build and domain/service-worker tests passed during this phase; the local sandbox's MongoDB binary aborted because it detected zero logical CPU cores, before integration tests reached the application. Full integration/browser verification remains pending until the pull request CI completes. Repository write access was restored after an initial integration permission failure.

Production deployment, real provider delivery, native mobile installation, and Docker execution are outside this phase's verified scope.

## References

- https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- https://github.com/web-push-libs/web-push
- https://typegoose.github.io/mongodb-memory-server/docs/api/config-options/
