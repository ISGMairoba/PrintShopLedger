// Branches: a staff member allowed in two branches chooses the branch this device works in; the
// header shows it, every request says it, and My Account can switch it.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
const port = 4203;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Branches check timed out');
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
  const settings = {
    ...defaultBranding(),
    businessName: 'Mairoba Studios',
    branches: [
      { id: 'main', name: 'Kano Road', address: '', phone: '', archived: false },
      { id: 'b-zoo0000001', name: 'Zoo Road', address: '5 Zoo Road', phone: '', archived: false },
      { id: 'b-old0000001', name: 'Old shop', address: '', phone: '', archived: true },
    ],
    branchAccess: { [id]: ['main', 'b-zoo0000001'] },
  };
  const problems = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  const sent = [];
  const handler = async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/rest/'))
      sent.push([path.split('/').pop(), route.request().headers()['x-psl-branch'] ?? null]);
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
      result = {
        cursor: '1',
        full: true,
        ledger: {
          ...emptyLedger(),
          customers: [
            {
              id: 'c1',
              name: 'Ada',
              phone: '08031234567',
              address: '',
              creditLimit: 0,
              archived: false,
              version: 1,
              createdAt: now,
            },
          ],
          // The owner's device receives both branches; this staff device shows its own.
          jobs: [
            {
              id: 'j-main',
              customerId: 'c1',
              service: 'Print',
              description: 'Kano job',
              amount: 1000,
              createdAt: now,
              productionStatus: 'Added',
              version: 1,
            },
            {
              id: 'j-zoo',
              customerId: 'c1',
              service: 'Print',
              description: 'Zoo job',
              amount: 2000,
              createdAt: now,
              productionStatus: 'Added',
              version: 1,
              branchId: 'b-zoo0000001',
            },
          ],
        },
      };
    else if (path.endsWith('/my_subscription')) result = { state: 'none' };
    else if (path.endsWith('/report_device')) result = { signOut: false, deviceLimit: 0 };
    else if (path.endsWith('/report_problems')) result = null;
    else throw Error('Unexpected request: ' + path);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  };
  await context.route('https://*.supabase.co/**', handler);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
  await page.getByLabel('Business password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Two branches allowed (the closed one is not offered): choose one.
  await page.getByRole('heading', { name: 'Choose your branch', exact: true }).waitFor();
  assert.equal(await page.locator('.branch-choices button').count(), 2);
  await page.getByRole('button', { name: /Zoo Road/ }).click();
  await page.locator('.eyebrow').filter({ hasText: 'Mairoba Studios · Zoo Road' }).waitFor();
  // Requests after the choice say the branch.
  const before = sent.length;
  await page.reload();
  await page.locator('.eyebrow').filter({ hasText: 'Zoo Road' }).waitFor();
  for (let i = 0; i < 50 && !sent.slice(before).some(([name]) => name === 'get_ledger_changes'); i++)
    await delay(100);
  const later = sent.slice(before).filter(([name]) => name === 'get_ledger_changes');
  assert.ok(later.length > 0);
  assert.ok(
    later.every(([, branch]) => branch === 'b-zoo0000001'),
    JSON.stringify(later),
  );
  // Each branch shows its own jobs.
  const nav = page.getByRole('navigation', { name: 'Main' });
  await nav.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByText('Zoo job', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Kano job', { exact: true }).count(), 0);
  // My Account switches the device back to the main branch.
  await nav.getByRole('button', { name: 'My Account', exact: true }).click();
  await page.getByLabel('Switch this device to').selectOption('main');
  await page.locator('.eyebrow').filter({ hasText: 'Mairoba Studios · Kano Road' }).waitFor();
  await nav.getByRole('button', { name: 'Jobs', exact: true }).click();
  await page.getByText('Kano job', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Zoo job', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  // The business owner (Every branch): the Dashboard shows all branches together and side by side.
  settings.branchAccess = { [id]: ['*'] };
  const owner = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await owner.route('https://*.supabase.co/**', handler);
  const op = await owner.newPage();
  op.setDefaultTimeout(20000);
  op.on('pageerror', (e) => errors.push(e.message));
  await op.goto(`http://127.0.0.1:${port}`);
  await op.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
  await op.getByLabel('Business password', { exact: true }).fill('test-password');
  await op.getByRole('button', { name: 'Sign in', exact: true }).click();
  await op.getByRole('button', { name: /Kano Road/ }).click();
  const ownerNav = op.getByRole('navigation', { name: 'Main' });
  await ownerNav.getByRole('button', { name: 'Dashboard', exact: true }).click();
  assert.equal(await op.getByLabel('Show branch').inputValue(), 'all');
  const compare = op.getByRole('table', { name: 'Branches side by side' });
  await compare.waitFor();
  assert.match(
    await compare.innerText(),
    /Kano Road[\s\S]*₦10\.00[\s\S]*Zoo Road[\s\S]*₦20\.00[\s\S]*All branches[\s\S]*₦30\.00/i,
  );
  // One branch at a time hides the comparison.
  await op.getByLabel('Show branch').selectOption('b-zoo0000001');
  await compare.waitFor({ state: 'detached' });
  await op.screenshot({ path: '/tmp/branches-owner.png', fullPage: true });
  assert.deepEqual(errors, []);
  await owner.close();
  console.log('Branches passed');
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: '/tmp/branches-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
