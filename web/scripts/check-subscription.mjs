// The subscription set in the developer console reaches the app: pages turned off with a banner,
// a locked business, and a device beyond the plan's device limit.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
const port = 4201;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Subscription check timed out');
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
  const problems = [];
  const run = async (name, subscription, report, beforeSignIn) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
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
      else if (path.endsWith('/report_problems')) {
        problems.push(route.request().postDataJSON());
        result = null;
      } else if (path.endsWith('/my_subscription')) result = subscription;
      else if (path.endsWith('/report_device')) result = report;
      else if (path.endsWith('/ack_device_sign_out')) result = null;
      else throw Error('Unexpected request: ' + path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await beforeSignIn?.(page);
    await page.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
    await page.getByLabel('Business password', { exact: true }).fill('test-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    return { page, errors, context, name };
  };
  {
    // Expired with pages turned off: a banner, and Reports is gone from the menu.
    const { page, errors, context } = await run(
      'pages off',
      {
        state: 'expired',
        plan: 'Standard',
        expiresAt: '2026-10-01T22:59:59Z',
        graceEndsAt: '2026-10-04T22:59:59Z',
        restriction: 'pages_off',
        pagesOff: ['Reports'],
        message: 'Call 0800 to renew.',
      },
      { signOut: false, deviceLimit: 0 },
      // An app error before signing in is noted, then sent to the console with the first sync.
      (page) =>
        page.evaluate(() =>
          window.dispatchEvent(
            new ErrorEvent('error', { message: 'Test problem', error: new Error('Test problem') }),
          ),
        ),
    );
    await page.getByText('Some pages are turned off until it is renewed.', { exact: false }).waitFor();
    await page.getByText('Call 0800 to renew.', { exact: false }).first().waitFor();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.getByRole('button', { name: 'Point of Service', exact: true }).waitFor();
    assert.equal(await nav.getByRole('button', { name: 'Reports', exact: true }).count(), 0);
    for (let i = 0; i < 50 && !problems.length; i++) await delay(100);
    assert.equal(problems[0].p_shop, shop);
    assert.equal(problems[0].p_items[0].kind, 'error');
    assert.equal(problems[0].p_items[0].message, 'Test problem');
    assert.equal(problems[0].p_items[0].count, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('printshopledger:problems:v1')), null);
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // Locked: only the message and a way to sign out.
    const { page, errors, context } = await run(
      'locked',
      { state: 'suspended', restriction: 'locked', pagesOff: [], message: 'Account on hold.' },
      { signOut: false, deviceLimit: 0 },
    );
    await page
      .getByText('subscription has ended. Contact PrintShopLedger to renew', { exact: false })
      .waitFor();
    await page.getByText('Account on hold.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Main' }).count(), 0);
    await page.getByRole('button', { name: 'Sign out business', exact: true }).click();
    await page.getByLabel('Business email', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  {
    // A device beyond the plan's limit is signed out after its first sync, with the reason.
    const { page, errors, context } = await run(
      'device limit',
      { state: 'active', plan: 'Standard', expiresAt: '2099-01-01T00:00:00Z', restriction: '', pagesOff: [] },
      { signOut: false, deviceLimit: 2 },
    );
    await page.getByText('This business already uses its 2 devices.', { exact: false }).first().waitFor();
    await page.getByLabel('Business email', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log('Subscription passed');
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: '/tmp/subscription-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
