// A device reports itself after syncing; when the developer console asked it to sign out, it
// confirms and signs out, showing why.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
const port = 4200;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Device sign-out check timed out');
  process.exit(1);
}, 120000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const id = '11111111-1111-4111-8111-111111111111',
    shop = '22222222-2222-4222-8222-222222222222',
    now = new Date().toISOString();
  const token = [
    { alg: 'HS256', typ: 'JWT' },
    { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
    'c2lnbmF0dXJl',
  ]
    .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
    .join('.');
  const user = {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'shop@example.invalid',
    user_metadata: {},
    app_metadata: { provider: 'email' },
    created_at: now,
  };
  const settings = { ...defaultBranding(), businessName: 'Mairoba Studios' };
  const reports = [];
  let acknowledged = 0;
  await context.route('https://*.supabase.co/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result = {};
    if (path === '/auth/v1/token')
      result = { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user };
    else if (path === '/auth/v1/user') result = user;
    else if (path === '/auth/v1/logout') result = {};
    else if (path.endsWith('/list_business_shops')) result = [{ id: shop, name: 'Mairoba Studios' }];
    else if (path.endsWith('/list_my_shops'))
      result = [
        {
          id: shop,
          name: 'Mairoba Studios',
          userId: id,
          role: 'manager',
          rank: 3,
          accessLevel: 3,
          username: 'manager',
          staffName: 'Test User',
        },
      ];
    else if (path.endsWith('/business_settings')) result = [{ settings, version: 1 }];
    else if (path.endsWith('/get_ledger_changes'))
      result = { cursor: '1', full: true, ledger: emptyLedger() };
    else if (path.endsWith('/report_device')) {
      reports.push(route.request().postDataJSON());
      result = { signOut: true };
    } else if (path.endsWith('/ack_device_sign_out')) {
      acknowledged++;
      result = null;
    } else throw Error('Unexpected request: ' + path);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
  await page.getByLabel('Business password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // After its first sync the device reports itself, is asked to sign out, confirms and signs out.
  await page.getByText('This device was signed out by PrintShopLedger support.', { exact: false }).waitFor();
  await page.getByLabel('Business email', { exact: true }).waitFor();
  assert.equal(acknowledged, 1);
  const report = reports[0];
  assert.equal(report.p_shop, shop);
  assert.match(report.p_device, /^[0-9a-f-]{36}$/);
  assert.equal(report.p_info.name, 'Chrome on Linux');
  assert.equal(report.p_info.pending, 0);
  assert.ok(report.p_info.appVersion);
  assert.deepEqual(errors, []);
  console.log('Device sign-out passed');
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: '/tmp/device-signout-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
