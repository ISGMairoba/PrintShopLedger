import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4182', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4182')).ok) break;
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
      now = new Date().toISOString();
    const user = {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'owner@example.invalid',
      email_confirmed_at: now,
      user_metadata: { full_name: 'Owner Name', business_name: 'New Print Shop' },
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
    let signedUp = 0,
      created = 0,
      activated = 0,
      lastSignup;
    await context.route('https://*.supabase.co/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      let result = {};
      if (path === '/auth/v1/signup') {
        lastSignup = route.request().postDataJSON();
        signedUp++;
        result = { user, session: null };
      } else if (path === '/auth/v1/token')
        result = {
          access_token: token,
          refresh_token: 'mock-refresh',
          token_type: 'bearer',
          expires_in: 3600,
          user,
        };
      else if (path === '/auth/v1/user') result = user;
      else if (path.endsWith('/register-business')) {
        created++;
        const body = route.request().postDataJSON();
        assert.deepEqual(body, { businessName: 'New Print Shop', ownerName: 'Owner Name' });
        result = { shopId: shop, created: true };
      } else if (path.endsWith('/list_business_shops'))
        result = created ? [{ id: shop, name: 'New Print Shop' }] : [];
      else if (path.endsWith('/list_my_shops'))
        result = created
          ? [
              {
                id: shop,
                name: 'New Print Shop',
                userId: id,
                role: 'manager',
                rank: 3,
                accessLevel: 3,
                username: 'manager',
                staffName: 'Owner Name',
              },
            ]
          : [];
      else if (path.endsWith('/business_settings'))
        result = [{ settings: { ...defaultBranding(), businessName: 'New Print Shop' }, version: 1 }];
      else if (path.endsWith('/get_ledger')) result = emptyLedger();
      else if (path.endsWith('/activate-developer')) {
        activated++;
        const body = route.request().postDataJSON();
        assert.equal(body.token, 'a'.repeat(64));
        result = { success: true, businessName: 'New Print Shop', username: 'developer' };
      } else if (path === '/auth/v1/logout') result = {};
      else throw Error('Unexpected request: ' + path);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://127.0.0.1:4182');
    await page.getByRole('button', { name: 'Register your business', exact: true }).click();
    await page.getByLabel('Business name', { exact: true }).fill('New Print Shop');
    await page.getByLabel('Owner’s full name', { exact: true }).fill('Owner Name');
    await page.getByLabel('Business email', { exact: true }).fill('owner@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('example-password');
    await page.getByLabel('Confirm password', { exact: true }).fill('different-password');
    await page.getByRole('button', { name: 'Register business', exact: true }).click();
    await page.getByText('The passwords do not match.', { exact: true }).waitFor();
    assert.equal(signedUp, 0);
    await page.getByLabel('Confirm password', { exact: true }).fill('example-password');
    await context.setOffline(true);
    await page.waitForFunction(() => document.querySelector('form button')?.disabled);
    assert.equal(
      await page.getByRole('button', { name: 'Register business', exact: true }).isEnabled(),
      false,
    );
    await context.setOffline(false);
    await page.waitForFunction(() => !document.querySelector('form button')?.disabled);
    await page.getByRole('button', { name: 'Register business', exact: true }).click();
    await page.getByText(/Check your email to confirm/).waitFor();
    assert.equal(signedUp, 1);
    assert.equal(created, 0);
    assert.deepEqual(lastSignup.data, { full_name: 'Owner Name', business_name: 'New Print Shop' });
    assert.ok(!JSON.stringify(lastSignup).includes('mairobaprints'));
    await page.screenshot({
      path: `/tmp/ledger-registration-${mobile ? 'mobile' : 'desktop'}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
    await page.getByLabel('Business email', { exact: true }).fill('owner@example.invalid');
    await page.getByLabel('Business password', { exact: true }).fill('example-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    // The workspace request can finish just after the page appears; wait for it, then check once.
    for (let i = 0; i < 50 && created === 0; i++) await delay(100);
    assert.equal(created, 1, 'Verified signup creates exactly one workspace');
    await page.reload();
    await page.getByRole('heading', { name: 'Point of Service', exact: true }).waitFor();
    assert.equal(created, 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto('http://127.0.0.1:4182/#developer_activation=' + 'a'.repeat(64));
    await page.getByRole('heading', { name: 'Activate Developer account', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('heading', { name: 'Activate Developer account', exact: true }).waitFor();
    assert.equal(activated, 0, 'Opening an email link must not consume it');
    await page.getByLabel('New password', { exact: true }).fill('developer-password');
    await page.getByLabel('Confirm password', { exact: true }).fill('developer-password');
    await page.getByRole('button', { name: 'Activate account', exact: true }).click();
    await page.getByText(/Developer account activated for New Print Shop/).waitFor();
    assert.equal(activated, 1);
    assert.ok(!page.url().includes('developer_activation'));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`${mobile ? 'Mobile' : 'Desktop'} signup and activation passed.`);
  }
} finally {
  await browser?.close();
  server.kill();
}
