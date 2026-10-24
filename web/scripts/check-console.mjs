// The developer console (/console): its own sign-in, refusing business accounts; the business list,
// a business's overview, the activity log and the team, on desktop and phone.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
const port = 4199;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Console check timed out');
  process.exit(1);
}, 180000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    const id = '33333333-3333-4333-8333-333333333333',
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
      email: 'team@example.invalid',
      app_metadata: { provider: 'email' },
      user_metadata: {},
      created_at: now,
    };
    let member = null; // the first sign-in is a business account: not on the team
    const calls = [];
    await context.route('https://*.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path.split('/').pop());
      let result = {};
      if (path === '/auth/v1/token')
        result = { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'r', user };
      else if (path === '/auth/v1/user') result = user;
      else if (path === '/auth/v1/logout') result = {};
      else if (path.endsWith('/console_whoami')) result = member;
      else if (path.endsWith('/console_businesses'))
        result = [
          {
            id: shop,
            name: 'Mairoba Studios',
            createdAt: '2026-10-03T08:00:00Z',
            ownerEmail: 'shop@example.invalid',
            staff: 5,
            customers: 120,
            jobs: 480,
            sales30: 125000000,
            events7: 340,
            lastActivity: now,
          },
          {
            id: '44444444-4444-4444-8444-444444444444',
            name: 'Packrium',
            createdAt: '2026-10-10T08:00:00Z',
            ownerEmail: 'pack@example.invalid',
            staff: 2,
            customers: 4,
            jobs: 9,
            sales30: 450000,
            events7: 0,
            lastActivity: '2026-10-12T08:00:00Z',
          },
        ];
      else if (path.endsWith('/console_business'))
        result = {
          id: shop,
          name: 'Mairoba Studios',
          currency: 'NGN',
          createdAt: '2026-10-03T08:00:00Z',
          ownerEmail: 'shop@example.invalid',
          settingsVersion: 58,
          settingsChangedAt: now,
          staff: [
            {
              id: 's1',
              name: 'Ada',
              username: 'ada',
              role: 'manager',
              rank: 3,
              accessLevel: 3,
              archived: false,
              createdAt: now,
              lastActivity: now,
            },
            {
              id: 's2',
              name: 'Developer',
              username: 'developer',
              role: 'developer',
              rank: 4,
              accessLevel: 4,
              archived: false,
              createdAt: now,
              lastActivity: null,
            },
          ],
          records: {
            customers: 120,
            jobs: 480,
            payments: 400,
            services: 60,
            materials: 40,
            stockChanges: 900,
            expenses: 30,
            quotations: 5,
            events: 3000,
          },
          storageBytes: {
            jobs: 1200000,
            payments: 300000,
            customers: 50000,
            stockChanges: 400000,
            events: 2000000,
            settings: 566000,
          },
          daily: Array.from({ length: 30 }, (_, i) => ({
            day: `2026-10-${String(i + 1).padStart(2, '0')}`,
            events: i * 3,
            sales: i * 10000,
          })),
        };
      else if (path.endsWith('/console_activity'))
        result = [
          {
            id: 'a1',
            shopId: shop,
            business: 'Mairoba Studios',
            actorName: 'Owner',
            action: 'business.viewed',
            reason: null,
            details: {},
            at: now,
          },
        ];
      else if (path.endsWith('/console_team'))
        result = [
          {
            userId: id,
            name: 'Owner',
            email: 'team@example.invalid',
            role: 'owner',
            disabled: false,
            addedAt: now,
          },
          {
            userId: 'u2',
            name: 'Helper',
            email: 'helper@example.invalid',
            role: 'support',
            disabled: false,
            addedAt: now,
          },
        ];
      else if (path.endsWith('/console_set_member')) result = null;
      else throw Error('Unexpected request: ' + path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/console`);
    await page.getByRole('heading', { name: 'PrintShopLedger console', exact: true }).waitFor();
    const signIn = async () => {
      await page.getByLabel('Console email', { exact: true }).fill('team@example.invalid');
      await page.getByLabel('Password', { exact: true }).fill('a-long-test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    };
    // A business account is refused.
    await signIn();
    await page.getByRole('alert').filter({ hasText: 'not on the console team' }).waitFor();
    member = { userId: id, role: 'owner', name: 'Owner', email: 'team@example.invalid' };
    await signIn();
    const list = page.getByRole('table', { name: 'Businesses', exact: true });
    await list.waitFor();
    assert.match(
      await list.innerText(),
      /Mairoba Studios[\s\S]*shop@example\.invalid[\s\S]*480[\s\S]*₦1,250,000\.00/,
    );
    await page.getByLabel('Search businesses').fill('pack');
    assert.equal(await list.locator('tbody tr').count(), 1);
    await page.getByLabel('Search businesses').fill('');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `/tmp/console-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    // A business's overview.
    await list.getByRole('button', { name: 'Mairoba Studios', exact: true }).click();
    await page.getByRole('heading', { name: 'Mairoba Studios', exact: true }).waitFor();
    assert.match(await page.locator('.stats').innerText(), /120[\s\S]*480 jobs[\s\S]*4\.4 MB/);
    assert.match(await page.getByRole('table', { name: 'Staff accounts' }).innerText(), /Ada[\s\S]*Manager/);
    assert.equal(await page.locator('.console-bars i').count(), 30);
    assert.ok(new URL(page.url()).search.includes('business='));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({
      path: `/tmp/console-business-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    // Back, the activity log and the team.
    await page.goBack();
    await list.waitFor();
    await page.getByRole('button', { name: 'Activity log', exact: true }).click();
    assert.match(
      await page.getByRole('table', { name: 'Console activity' }).innerText(),
      /Owner[\s\S]*Opened business/,
    );
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    const teamTable = page.getByRole('table', { name: 'Console team' });
    await teamTable.waitFor();
    await teamTable.getByRole('button', { name: 'Make owner', exact: true }).click();
    await page.getByText('Helper is now an owner.').waitFor();
    assert.ok(calls.includes('console_set_member'));
    await page.getByRole('heading', { name: 'Add a team member', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Console email', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Console passed: ${mobile ? 'phone' : 'desktop'}`);
  }
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: '/tmp/console-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
