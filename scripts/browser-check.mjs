import { chromium } from 'playwright';
import { createECDH, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { jalaliDateTime } from '../packages/domain/index.js';

// Starts its own fictional, temporary demo. Never targets a deployed service.
await mkdir(resolve('.runtime/tmp'), { recursive: true }); await mkdir(resolve('test-results'), { recursive: true });
process.env.TMPDIR = resolve('.runtime/tmp');
const port = 4100; const base = `http://localhost:${port}`;
const demo = spawn(process.execPath, ['scripts/demo.mjs'], { env: { ...process.env, DEMO_PORT: String(port), DEMO_TEST_PUSH: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOutput = '';
await new Promise((resolveReady, reject) => {
  const timer = setTimeout(() => reject(new Error('Demo startup timed out')), 60000);
  demo.stdout.on('data', data => { demoOutput += data.toString(); if (demoOutput.includes('Open http')) { clearTimeout(timer); resolveReady(); } });
  demo.stderr.on('data', data => { demoOutput += data.toString(); });
  demo.on('exit', code => { clearTimeout(timer); reject(new Error(`Demo exited ${code}: ${demoOutput}`)); });
});
let browser;
const results = []; const pageErrors = [];
const checked = name => { results.push(name); console.log(`PASS ${name}`); };
async function session(username, mockPush = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  if (mockPush) {
    const key = createECDH('prime256v1'); key.generateKeys();
    await context.addInitScript(({ p256dh, auth }) => {
      window.permissionRequests = 0;
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => localStorage.getItem('qa-permission') || 'default' });
      Notification.requestPermission = async () => { window.permissionRequests++; localStorage.setItem('qa-permission', 'granted'); return 'granted'; };
      function current() {
        const saved = JSON.parse(localStorage.getItem('qa-push') || 'null');
        if (!saved) return null;
        return { options: { applicationServerKey: Uint8Array.from(saved.applicationServerKey).buffer },
          toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/browser-test-only', expirationTime: null, keys: { p256dh, auth } }),
          unsubscribe: async () => { localStorage.removeItem('qa-push'); return true; } };
      }
      PushManager.prototype.getSubscription = async () => current();
      PushManager.prototype.subscribe = async options => { localStorage.setItem('qa-push', JSON.stringify({ applicationServerKey: Array.from(new Uint8Array(options.applicationServerKey)) })); return current(); };
    }, { p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') });
  }
  const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(base); await page.getByLabel('Username', { exact: true }).fill(username); await page.getByLabel('Password', { exact: true }).fill('Demo-Only-2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  return { context, page };
}
async function route(page, value) { await page.evaluate(value => { location.hash = value; }, value); }
async function apiGet(page, path) { return page.evaluate(async path => { const r = await fetch('/api' + path); if (!r.ok) throw new Error(`API ${r.status}`); return r.json(); }, path); }
async function decision(page, marker, action) {
  const card = page.locator('.leave-card').filter({ hasText: marker }); await card.getByRole('button', { name: action, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' });
}
try {
  const args = process.env.CHROMIUM_ARGS_FILE ? JSON.parse(await readFile(process.env.CHROMIUM_ARGS_FILE, 'utf8')) : ['--no-sandbox'];
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}), args });
  const admin = await session('demo-admin');
  await admin.page.screenshot({ path: 'test-results/admin-overview.png', fullPage: true }); checked('Admin login and overview');
  await route(admin.page, 'residents'); await admin.page.getByRole('button', { name: 'Create account', exact: true }).click();
  await admin.page.getByRole('dialog').getByLabel('Full name', { exact: true }).fill('Browser QA Resident');
  await admin.page.getByRole('dialog').getByLabel('Username', { exact: true }).fill('browser-qa-resident');
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await admin.page.getByRole('dialog', { name: 'Temporary password', exact: true }).waitFor();
  const issued = await admin.page.getByRole('dialog').getByLabel('Temporary password', { exact: true }).inputValue(); assert.ok(issued.length >= 12);
  await admin.page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await admin.page.getByText('Browser QA Resident', { exact: true }).waitFor(); checked('Admin account creation and temporary credentials');

  const rep = await session('demo-rep');
  const repSessions = await apiGet(rep.page, '/sessions'); const target = repSessions.find(s => s.title === 'Neuromuscular assessment');
  await route(rep.page, `sessions/${target._id}`); await rep.page.getByRole('heading', { name: target.title, exact: true }).waitFor();
  await rep.page.getByRole('button', { name: 'Save for offline attendance', exact: true }).click();
  await rep.page.getByText('Session saved for offline attendance', { exact: true }).waitFor();
  await rep.page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })); });
  await rep.context.setOffline(true); await rep.page.getByText('Offline', { exact: true }).waitFor();
  await rep.page.getByRole('button', { name: 'Dena Sepehr: Present', exact: true }).click();
  await rep.page.locator('tr').filter({ hasText: 'Dena Sepehr' }).getByText('Saved on this device', { exact: true }).waitFor();
  await rep.page.getByRole('button', { name: 'Dena Sepehr: Absent', exact: true }).click();
  await rep.page.locator('[aria-label="Dena Sepehr: Absent"][aria-pressed="true"]').waitFor();
  await rep.page.reload(); await rep.page.getByRole('heading', { name: target.title, exact: true }).waitFor();
  await rep.page.locator('[aria-label="Dena Sepehr: Absent"][aria-pressed="true"]').waitFor();
  assert.equal(await rep.page.getByRole('button', { name: 'Dena Sepehr: Absent', exact: true }).getAttribute('aria-pressed'), 'true');
  checked('Downloaded roster and two ordered edits survive a fully offline reload');
  await rep.context.setOffline(false); await rep.page.getByText('Connected', { exact: true }).waitFor();
  await rep.page.waitForFunction(() => !document.body.innerText.includes('Queued changes') && !document.body.innerText.includes('Saved on this device'));
  const synced = await apiGet(rep.page, `/sessions/${target._id}`); const row = synced.rows.find(r => r.student.name === 'Dena Sepehr');
  assert.equal(row.observations.find(o => o.role === 'rep').status, 'absent'); assert.equal(row.observations.find(o => o.role === 'rep').version, 2); checked('Reconnection synchronizes both edits exactly once');
  await rep.page.screenshot({ path: 'test-results/rep-attendance.png', fullPage: true });

  await route(rep.page, 'sessions'); await rep.page.getByRole('button', { name: 'Propose session', exact: true }).click();
  const proposedModal = rep.page.getByRole('dialog');
  await proposedModal.getByLabel('Session name', { exact: true }).fill('Browser QA shared teaching');
  await proposedModal.getByLabel('Start date', { exact: true }).fill(jalaliDateTime(target.startAt).date);
  await proposedModal.getByLabel('End date', { exact: true }).fill(jalaliDateTime(target.startAt).date);
  await proposedModal.getByLabel('Dr. Leila Rad', { exact: true }).check();
  await proposedModal.getByLabel('Year 2', { exact: true }).check();
  await proposedModal.getByRole('button', { name: 'Submit request', exact: true }).click();
  await rep.page.getByRole('heading', { name: 'Browser QA shared teaching', exact: true }).waitFor();
  const proposedId = new URL(rep.page.url()).hash.split('/')[1];
  await rep.page.getByRole('button', { name: 'Confirm participants', exact: true }).click();
  await rep.page.getByRole('dialog').getByLabel('Arman Darya', { exact: true }).check();
  await rep.page.getByRole('dialog').getByLabel(/Sara Mehr/).check();
  await rep.page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
  await rep.page.getByRole('dialog').waitFor({ state: 'detached' });
  await route(admin.page, `sessions/${proposedId}`); await admin.page.getByRole('button', { name: 'Approve', exact: true }).click();
  await admin.page.getByText('Approved', { exact: true }).waitFor(); checked('Rep session proposal, cohort roster confirmation, and admin approval');

  const student = await session('demo-student'); await route(student.page, 'leave'); await student.page.getByRole('button', { name: 'Request leave', exact: true }).click();
  const leaveModal = student.page.getByRole('dialog'); await leaveModal.getByLabel('Leave type', { exact: true }).selectOption('session');
  await leaveModal.getByLabel('One session', { exact: true }).selectOption(target._id);
  const professors = await apiGet(student.page, '/directory'); const professorId = professors.professors.find(p => p.name === 'Dr. Leila Rad')._id;
  await leaveModal.getByLabel('Approving professor', { exact: true }).selectOption(professorId);
  const marker = 'Browser QA leave request'; await leaveModal.getByLabel('Reason (optional)', { exact: true }).fill(marker);
  await leaveModal.getByRole('button', { name: 'Submit request', exact: true }).click(); await leaveModal.waitFor({ state: 'detached' });
  await student.page.locator('.leave-card').filter({ hasText: marker }).getByText('Awaiting professor', { exact: true }).waitFor();
  const professor = await session('demo-professor'); await route(professor.page, 'leave'); await decision(professor.page, marker, 'Approve');
  await route(admin.page, 'leave'); await decision(admin.page, marker, 'Approve');
  await student.page.reload(); await student.page.locator('.leave-card').filter({ hasText: marker }).getByText('Approved', { exact: true }).first().waitFor(); checked('Student request → professor approval → admin approval');
  await route(admin.page, `sessions/${target._id}`); await admin.page.getByRole('heading', { name: target.title, exact: true }).waitFor();
  const arman = admin.page.locator('tr').filter({ hasText: 'Arman Darya' }); await arman.getByText('Absent — approved leave', { exact: true }).waitFor();
  assert.ok(await arman.getByText('Present', { exact: true }).count()); assert.ok(await arman.getByText('Absent', { exact: true }).count());
  await admin.page.screenshot({ path: 'test-results/admin-attendance.png', fullPage: true }); checked('Admin sees independent rep, professor, and leave statuses');

  await route(admin.page, 'reports'); const reportDate = jalaliDateTime(target.startAt).date;
  await admin.page.getByLabel('From', { exact: true }).fill(reportDate); await admin.page.getByLabel('Until', { exact: true }).fill(reportDate);
  await admin.page.getByRole('button', { name: 'Generate report', exact: true }).click(); await admin.page.getByRole('heading', { name: target.title, exact: true }).waitFor();
  const downloadEvent = admin.page.waitForEvent('download'); await admin.page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  const download = await downloadEvent; await download.saveAs('test-results/attendance.csv'); assert.ok((await readFile('test-results/attendance.csv','utf8')).includes('Arman Darya')); checked('Date-range report and CSV export');

  await route(professor.page, 'messages'); await professor.page.getByRole('button', { name: 'Message an admin', exact: true }).click();
  const threadModal = professor.page.getByRole('dialog'); const dir = await apiGet(professor.page, '/directory');
  await threadModal.getByLabel('Cohort', { exact: true }).selectOption(dir.cohorts.find(c => c.year === 1)._id);
  await threadModal.getByLabel('Subject', { exact: true }).fill('Browser QA teaching message');
  await threadModal.getByLabel('Message', { exact: true }).fill('A fictional browser test message.');
  await threadModal.getByRole('button', { name: 'Send', exact: true }).click(); await threadModal.waitFor({ state: 'detached' });
  await route(admin.page, 'messages'); await admin.page.locator('.thread-list').getByRole('button').filter({ hasText: 'Browser QA teaching message' }).click();
  await admin.page.getByLabel('Reply', { exact: true }).fill('Received in the local demo.'); await admin.page.getByRole('button', { name: 'Send', exact: true }).click();
  await admin.page.getByText('Received in the local demo.', { exact: true }).waitFor(); checked('Professor/admin message thread and reply');

  await route(rep.page, 'overview'); await rep.page.getByRole('button', { name: 'فارسی', exact: true }).click();
  await rep.page.setViewportSize({ width: 390, height: 844 });
  await rep.page.getByRole('heading', { name: /خوش آمدید/ }).waitFor();
  assert.equal(await rep.page.locator('html').getAttribute('dir'), 'rtl');
  assert.ok(await rep.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await rep.page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= innerWidth - 1);
  if (await rep.page.locator('.toast button').count()) await rep.page.locator('.toast button').click();
  await rep.page.screenshot({ path: 'test-results/persian-mobile.png', fullPage: true, animations: 'disabled' }); checked('Persian RTL at 390px without page overflow');
  // Provider subscription and permission are mocked; no browser vendor is contacted.
  const pushUser = await session('demo-student', true);
  await pushUser.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  assert.equal(await pushUser.page.evaluate(() => window.permissionRequests), 0);
  await pushUser.page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Enable on this browser', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Disable on this browser', exact: true }).waitFor();
  assert.equal(await pushUser.page.evaluate(() => window.permissionRequests), 1);
  assert.ok((await apiGet(pushUser.page, '/push/subscriptions/current')).subscription);
  checked('Push requires explicit opt-in and saves a login-scoped subscription (mock provider)');
  await pushUser.page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await pushUser.page.reload(); await pushUser.page.getByRole('heading', { name: /Welcome back/ }).waitFor();
  await pushUser.page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Disable on this browser', exact: true }).waitFor();
  await pushUser.page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await pushUser.page.getByRole('button', { name: 'فارسی', exact: true }).click();
  await pushUser.page.waitForFunction(async () => (await (await fetch('/api/push/subscriptions/current')).json()).subscription?.language === 'fa');
  await pushUser.page.getByRole('button', { name: 'English', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Disable on this browser', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Enable on this browser', exact: true }).waitFor();
  await pushUser.page.waitForFunction(async () => (await (await fetch('/api/push/subscriptions/current')).json()).subscription === null);
  checked('Push binding survives reload, follows language, and can be disabled');
  await pushUser.page.getByRole('button', { name: 'Enable on this browser', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Disable on this browser', exact: true }).waitFor();
  await pushUser.page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).first().click();
  await pushUser.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await pushUser.page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await pushUser.page.evaluate(() => localStorage.getItem('qa-push')), null);
  assert.equal(await pushUser.page.evaluate(() => new Promise(resolve => { const r = indexedDB.open('cohort-push-v1', 1); r.onsuccess = () => { const q = r.result.transaction('settings').objectStore('settings').get('active'); q.onsuccess = () => { resolve(q.result || null); r.result.close(); }; }; })), null);
  checked('Sign-out clears browser push subscription and local account binding');
  assert.deepEqual(pageErrors, []); checked('No browser JavaScript errors');
  await writeFile('test-results/browser-results.json', JSON.stringify({ checked: results, pageErrors }, null, 2));
  console.log(`${results.length} browser checks passed.`);
} catch (error) {
  if (browser) for (const [i, context] of browser.contexts().entries()) {
    const page = context.pages()[0]; if (!page) continue;
    await page.screenshot({ path: `test-results/failure-${i}.png`, fullPage: true }).catch(() => {});
    console.error(`PAGE ${i}`, await page.locator('main').innerText({ timeout: 1000 }).catch(() => 'No main content'));
  }
  console.error(error); await writeFile('test-results/browser-results.json', JSON.stringify({ checked: results, pageErrors, error: error.message }, null, 2)); process.exitCode = 1;
} finally {
  await browser?.close(); demo.kill('SIGTERM');
}
