// The lock screen (plans/lock-screen.md): work open when the app locks is still there after
// unlocking, the Security choices show, and with "Remember people on each device" one person can
// step away, another sign in with their password, and the first switch back with their PIN.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
import { hashPin } from '../src/pin.mjs';
import { settingsSection } from './settings-navigation.mjs';

const port = 4251;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Lock screen check timed out');
  process.exit(1);
}, 240000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  const shop = '22222222-2222-4222-8222-222222222222',
    now = new Date().toISOString();
  const people = {
    ada: {
      id: '11111111-1111-4111-8111-111111111111',
      username: 'owner',
      staffName: 'Ada Owner',
      role: 'developer',
      rank: 5,
      pin: '2580',
    },
    tunde: {
      id: '33333333-3333-4333-8333-333333333333',
      username: 'tunde',
      staffName: 'Tunde Bello',
      role: 'cashier',
      rank: 1,
      pin: '1357',
    },
  };
  for (const person of Object.values(people)) person.hash = await hashPin(person.pin, 10000);
  const token = (id) =>
    [
      { alg: 'HS256', typ: 'JWT' },
      { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 36000 },
      'c2lnbmF0dXJl',
    ]
      .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
      .join('.');
  const user = (id) => ({
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${id}@example.invalid`,
    user_metadata: {},
    app_metadata: { provider: 'email' },
    created_at: now,
  });
  const sessionFor = (person) => ({
    access_token: token(person.id),
    token_type: 'bearer',
    expires_in: 36000,
    refresh_token: `r-${person.username}`,
    user: user(person.id),
  });
  const base = defaultBranding();
  const settings = {
    ...base,
    businessName: 'Mairoba Studios',
    security: { ...base.security, autoLockMinutes: 5, rememberPeople: true },
  };
  const whose = (request) => {
    const bearer = request.headers().authorization?.replace('Bearer ', '') ?? '';
    try {
      const sub = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()).sub;
      return Object.values(people).find((p) => p.id === sub);
    } catch {
      return undefined;
    }
  };

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  await context.route('https://*.supabase.co/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const me = whose(request);
    let result = {};
    if (path === '/auth/v1/token') {
      const body = request.postDataJSON() ?? {};
      const back = Object.values(people).find((p) => body.refresh_token === `r-${p.username}`);
      result = sessionFor(back ?? people.ada);
    } else if (path === '/auth/v1/user') result = user((me ?? people.ada).id);
    else if (path === '/auth/v1/logout') result = {};
    else if (path.endsWith('/functions/v1/staff-login')) result = sessionFor(people.tunde);
    else if (path.endsWith('/list_business_shops')) result = [{ id: shop, name: 'Mairoba Studios' }];
    else if (path.endsWith('/list_my_shops'))
      result = me
        ? [
            {
              id: shop,
              name: 'Mairoba Studios',
              userId: me.id,
              role: me.role,
              rank: me.rank,
              accessLevel: me.rank,
              username: me.username,
              staffName: me.staffName,
            },
          ]
        : [];
    else if (path.endsWith('/business_settings')) result = [{ settings, version: 1 }];
    else if (path.endsWith('/get_ledger_changes'))
      result = { cursor: '1', full: true, ledger: emptyLedger() };
    else if (path.endsWith('/my_pin')) result = me?.hash ?? null;
    else if (path.endsWith('/my_subscription')) result = { state: 'none' };
    else if (path.endsWith('/get_notices')) result = [];
    else if (path.endsWith('/report_device')) result = { signOut: false };
    else result = null;
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    } catch {}
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
  await page.getByLabel('Business password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const lockButton = page.getByRole('button', { name: 'Lock', exact: true });
  const nav = (name) =>
    page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
  await lockButton.waitFor();
  await page.clock.runFor(1500); // the PIN hash from the server is now kept on the device

  // The Security choices.
  await nav('Business Settings');
  await settingsSection(page, 'Security');
  await page.getByRole('heading', { name: 'Lock screen and PIN' }).waitFor();
  assert.equal(await page.getByLabel('Remember people on each device').isChecked(), true);
  assert.equal(await page.getByLabel('Wrong PINs before the password is needed').inputValue(), '5');
  await page.getByLabel('Remember each person for').waitFor();

  // Work open when the app locks is still there after unlocking.
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  const sale = page.getByRole('dialog', { name: 'New checkout' });
  await sale.getByLabel('Money received (₦)').fill('777');
  await page.clock.runFor(6 * 60_000);
  await page.getByText('Locked', { exact: true }).waitFor();
  assert.equal(await sale.isVisible(), false, 'the sale shows over the lock screen');
  await page.locator('input[type="password"]').fill('2580');
  await page.getByRole('button', { name: /Unlock/ }).click();
  await sale.waitFor();
  assert.equal(await sale.getByLabel('Money received (₦)').inputValue(), '777', 'the open sale was lost');
  await sale.getByRole('button', { name: 'Close', exact: true }).first().click();

  // Ada steps away (still remembered); Tunde signs in with his password.
  await lockButton.click();
  await page.getByText('Locked', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Switch user', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).waitFor();
  await page.getByLabel('Username', { exact: true }).fill('tunde');
  await page.getByLabel('Password', { exact: true }).fill('tunde-password');
  await page.getByRole('button', { name: 'Sign in user', exact: true }).click();
  await lockButton.waitFor();
  await page.clock.runFor(1500);

  // Tunde locks; Ada switches back with her PIN, and the app opens as her.
  await lockButton.click();
  await page.getByText('Locked', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Switch user', exact: true }).click();
  await page.getByRole('heading', { name: 'Who is using the app?' }).waitFor();
  await page.screenshot({ path: '/tmp/lock-switch-user.png' });
  await page.getByRole('button', { name: /Ada Owner/ }).click();
  await page.locator('input[type="password"]').fill('1111');
  await page.getByRole('button', { name: /Unlock/ }).click();
  await page.getByText(/Wrong PIN\. 4 tries left before Ada's password is needed\./).waitFor();
  await page.locator('input[type="password"]').fill('2580');
  await page.getByRole('button', { name: /Unlock/ }).click();
  await lockButton.waitFor({ timeout: 30000 });
  const signedIn = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    return key ? JSON.parse(localStorage.getItem(key) ?? '{}').user?.id : '';
  });
  assert.equal(signedIn, people.ada.id, 'the app did not open as Ada');
  assert.deepEqual(errors, []);
  console.log('Lock screen passed');
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages()) {
        const text = await page
          .locator('body')
          .innerText()
          .catch(() => '');
        console.error('Page:', text.slice(0, 700).replace(/\s+/g, ' '));
      }
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
