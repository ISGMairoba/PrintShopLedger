import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { emptyLedger, applyEvent } from '../src/domain.mjs';

const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4180', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4180')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    const id = '11111111-1111-4111-8111-111111111111',
      shop = '22222222-2222-4222-8222-222222222222',
      material = '33333333-3333-4333-8333-333333333333';
    const now = new Date().toISOString(),
      user = {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'test@example.invalid',
        user_metadata: { full_name: 'Test User' },
        app_metadata: { provider: 'email' },
        created_at: now,
      };
    const token = [
      { alg: 'HS256', typ: 'JWT' },
      { sub: id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
      'c2lnbmF0dXJl',
    ]
      .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
      .join('.');
    let cashierMode = false,
      queue = [];
    const supervisorToken = [
      { alg: 'HS256', typ: 'JWT' },
      {
        sub: '99999999-9999-4999-8999-999999999999',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      'c2lnbmF0dXJl',
    ]
      .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
      .join('.');
    let failBusiness = true,
      failStaff = false,
      holdLookup = false,
      held = [],
      writes = 0,
      conflictCode = 'PT409',
      noBusiness = false,
      creations = 0;
    let cloud = applyEvent(emptyLedger(), {
      id: crypto.randomUUID(),
      kind: 'material.created',
      data: {
        id: material,
        name: 'Paper',
        available: 10,
        measurementUnit: 'sheet',
        requireSize: false,
        modifiedBy: id,
        modifiedByLabel: 'Test User',
        modifiedAt: now,
      },
    });
    await context.route('https://*.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let result = {},
        status = 200;
      if (path === '/auth/v1/token') {
        if (route.request().postDataJSON().password === 'wrong-password') {
          status = 400;
          result = { error: 'invalid_grant', error_description: 'Invalid login credentials' };
        } else
          result = {
            access_token: token,
            token_type: 'bearer',
            expires_in: 3600,
            refresh_token: 'mock-refresh',
            user,
          };
      } else if (path === '/auth/v1/user') result = user;
      else if (path === '/auth/v1/logout') result = {};
      else if (path.endsWith('/list_business_shops')) {
        if (holdLookup) {
          held.push(route);
          return;
        }
        if (failBusiness) {
          status = 504;
          result = { message: 'Business lookup timed out' };
        } else result = noBusiness ? [] : [{ id: shop, name: 'Test business' }];
      } else if (path.endsWith('/list_my_shops')) {
        if (failStaff) {
          status = 403;
          result = { message: 'Staff lookup unavailable' };
        } else {
          const supervisor = route.request().headers().authorization === 'Bearer ' + supervisorToken;
          const rank = cashierMode && !supervisor ? 1 : 3;
          result = [
            {
              id: shop,
              name: 'Test business',
              role: rank === 1 ? 'cashier' : 'manager',
              rank,
              accessLevel: rank,
              userId: supervisor ? '99999999-9999-4999-8999-999999999999' : id,
              username: rank === 1 ? 'cashier' : 'manager',
              staffName: 'Test User',
            },
          ];
        }
      } else if (path.endsWith('/business_settings')) result = [];
      else if (/\/get_ledger(_changes)?$/.test(path)) result = cloud;
      else if (path.endsWith('/apply_material_event')) {
        writes++;
        const event = route.request().postDataJSON().p_event;
        cloud = applyEvent(cloud, {
          id: crypto.randomUUID(),
          kind: 'material.updated',
          data: { ...event.data, name: 'Business paper ' + writes, baseVersion: cloud.materials[0].version },
        });
        status = 409;
        result = {
          code: conflictCode,
          message: 'Material changed elsewhere. Sync and reopen it before editing.',
        };
      } else if (path.endsWith('/submit_sync_conflict')) {
        const event = route.request().postDataJSON().p_event;
        if (!queue.some((item) => item.event_id === event.id))
          queue.push({
            event_id: event.id,
            actor_id: id,
            actor_label: 'Test User',
            source: event,
            message: 'Material changed elsewhere',
            status: 'pending',
            submitted_at: now,
          });
      } else if (path.endsWith('/list_sync_conflicts')) result = queue;
      else if (path.endsWith('/get_sync_conflict'))
        result = {
          conflict: queue.find((item) => item.event_id === route.request().postDataJSON().p_event),
          ledger: cloud,
          token: 'current-review',
        };
      else if (path.endsWith('/resolve_sync_conflict')) {
        const item = queue.find((item) => item.event_id === route.request().postDataJSON().p_event);
        item.status = 'resolved';
        item.replacements = [];
      } else if (path.endsWith('/register-business')) {
        creations++;
        noBusiness = false;
        failBusiness = true;
        result = shop;
      } else if (path.endsWith('/staff-login'))
        result = {
          access_token: route.request().postDataJSON().username === 'supervisor' ? supervisorToken : token,
          refresh_token: 'mock-refresh',
        };
      else throw Error('Unexpected request ' + path);
      // Syncs ask for changes since a cursor; this test server always sends everything.
      if (path.endsWith('/get_ledger_changes')) result = { cursor: '1', full: true, ledger: result };
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4180');
    await page.getByLabel('Business email', { exact: true }).fill('test@example.invalid');
    await page.getByLabel('Business password', { exact: true }).fill('wrong-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Invalid login credentials' }).waitFor();
    await page.getByLabel('Business password', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Could not load your business', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Create your business workspace' }).count(), 0);
    await page.getByRole('alert').filter({ hasText: 'Business lookup timed out' }).waitFor();
    failBusiness = false;
    failStaff = true;
    await page.getByRole('button', { name: 'Retry workspace lookup', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Staff lookup unavailable' }).waitFor();
    failStaff = false;
    holdLookup = true;
    await page.clock.install();
    await page.getByRole('button', { name: 'Retry workspace lookup', exact: true }).click();
    await page.getByRole('heading', { name: 'Loading business workspace…', exact: true }).waitFor();
    await page.clock.runFor(25001);
    await page.getByRole('heading', { name: 'Could not load your business', exact: true }).waitFor();
    holdLookup = false;
    await page.getByRole('button', { name: 'Retry workspace lookup', exact: true }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    for (const route of held)
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {});
    // A late empty response from the old lookup must not replace the successful retry.
    await page.clock.runFor(1000);
    assert.equal(await page.getByRole('heading', { name: 'Create your business workspace' }).count(), 0);
    await page.reload();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    const openMenu = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.clock.runFor(100);
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
    };
    const nav = async (name) => {
      if (mobile) await openMenu();
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    const saved = () => readCopy(page, id + ':' + shop);
    for (const code of ['PT409', '40001']) {
      conflictCode = code;
      await nav('Materials');
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edit material', exact: true });
      await edit.getByLabel('Name', { exact: true }).fill('Local paper');
      await edit.getByRole('button', { name: 'Save material', exact: true }).click();
      await page.clock.runFor(1000);
      await page.getByText('pending operations await review.', { exact: false }).waitFor();
      const before = writes;
      assert.equal((await saved()).pending.length, 1, 'Conflict keeps pending work');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.clock.runFor(10000);
      assert.equal(writes, before, 'Held work is not retried on focus');
      if (code === 'PT409') {
        cashierMode = true;
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'Admin review required.' }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Add job', exact: true }).isEnabled(), true);
        await page.getByRole('button', { name: 'Supervisor review', exact: true }).click();
        const login = page.getByRole('dialog', { name: 'Supervisor conflict review' });
        await login.getByLabel('Supervisor username').fill('cashier');
        await login.getByLabel('Supervisor password').fill('password');
        await login.getByRole('button', { name: 'Verify supervisor' }).click();
        await login
          .getByRole('alert')
          .filter({ hasText: 'Admin, Manager or Developer access is required' })
          .waitFor();
        await login.getByLabel('Supervisor username').fill('supervisor');
        await login.getByRole('button', { name: 'Verify supervisor' }).click();
        await login.waitFor({ state: 'detached' });
      } else await nav('Conflict Inbox');
      await page.getByRole('button', { name: 'Review conflict', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Remote conflict review' });
      await review.waitFor();
      await review.getByLabel('Review reason').fill('Business version confirmed');
      await review.getByRole('button', { name: 'Keep business version', exact: true }).click();
      await review.waitFor({ state: 'detached' });
      await page.clock.runFor(31000);
      await page.waitForFunction(() => !document.body.innerText.includes('pending operations await review.'));
      cashierMode = false;
      await page.reload();
      await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
      assert.equal((await saved()).pending.length, 0);
      assert.equal((await saved()).ledger.materials[0].name, 'Business paper ' + writes);
    }
    if (mobile) await openMenu();
    await page.getByRole('button', { name: 'Logout', exact: true }).click();
    await page.getByRole('heading', { name: 'Staff sign in', exact: true }).waitFor();
    await page.getByLabel('Username', { exact: true }).fill('manager');
    await page.getByLabel('Password', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: 'Sign in user', exact: true }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    // A successful create followed by a failed read must offer lookup retry,
    // and must not invite a second workspace creation.
    if (mobile) await openMenu();
    await page.getByRole('button', { name: 'Sign out business', exact: true }).click();
    await page.getByLabel('Business email', { exact: true }).waitFor();
    noBusiness = true;
    await page.getByLabel('Business email', { exact: true }).fill('test@example.invalid');
    await page.getByLabel('Business password', { exact: true }).fill('correct-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Create your business workspace', exact: true }).waitFor();
    await page.getByLabel('Business name', { exact: true }).fill('New business');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByRole('heading', { name: 'Could not load your business', exact: true }).waitFor();
    assert.equal(creations, 1);
    assert.equal(await page.getByRole('button', { name: 'Create workspace', exact: true }).count(), 0);
    failBusiness = false;
    await page.getByRole('button', { name: 'Retry workspace lookup', exact: true }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    assert.equal(creations, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // A stalled refresh during startup must provide a recovery action rather
  // than an endless opening screen. The expired session is entirely synthetic.
  const recovery = await browser.newContext({ serviceWorkers: 'block' });
  const expiredId = '44444444-4444-4444-8444-444444444444';
  const expiredToken = [
    { alg: 'HS256', typ: 'JWT' },
    { sub: expiredId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) - 3600 },
    'c2lnbmF0dXJl',
  ]
    .map((x) => (typeof x === 'string' ? x : Buffer.from(JSON.stringify(x)).toString('base64url')))
    .join('.');
  await recovery.addInitScript(
    (session) => localStorage.setItem('printshopledger-business-auth', JSON.stringify(session)),
    {
      access_token: expiredToken,
      refresh_token: 'expired-mock-refresh',
      token_type: 'bearer',
      expires_at: Math.floor(Date.now() / 1000) - 3600,
      expires_in: 3600,
      user: {
        id: expiredId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'expired@example.invalid',
        user_metadata: {},
        app_metadata: { provider: 'email' },
        created_at: new Date().toISOString(),
      },
    },
  );
  let releaseRefresh;
  await recovery.route('https://*.supabase.co/auth/v1/token**', (route) => {
    releaseRefresh = () =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token expired' }),
      });
  });
  const loading = await recovery.newPage();
  loading.setDefaultTimeout(10000);
  await loading.clock.install();
  await loading.goto('http://127.0.0.1:4180');
  await loading.getByRole('heading', { name: 'Opening PrintShopLedger…', exact: true }).waitFor();
  await loading.clock.runFor(25001);
  await loading.getByRole('heading', { name: 'Could not restore your sign-in', exact: true }).waitFor();
  await loading.getByRole('button', { name: 'Retry sign-in loading', exact: true }).click();
  assert.ok(releaseRefresh, 'Saved session attempted a refresh');
  await releaseRefresh();
  await loading.getByLabel('Business email', { exact: true }).waitFor();
  await recovery.close();
  console.log(
    'Login recovery, session restoration, staff logout/sign-in and conflict pause checks passed on desktop and mobile.',
  );
} finally {
  await browser?.close();
  server.kill();
}
