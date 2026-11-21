// The PIN lock never shows the app behind it: reloading a locked device goes straight to the lock
// screen (even while the server is slow to answer), unlocking isn't undone by a late server reply,
// and the screen is hidden while the app is in the background.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding } from '../src/business-branding.mjs';
import { emptyLedger } from '../src/domain.mjs';
import { hashPin } from '../src/pin.mjs';
const port = 4201;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('PIN reload check timed out');
  process.exit(1);
}, 150000).unref();
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
  const settings = {
    ...defaultBranding(),
    businessName: 'Mairoba Studios',
    security: { ...defaultBranding().security, autoLockMinutes: 5 },
  };
  const hash = await hashPin('2580', 1000);
  // How long the server takes to give the PIN hash (slow after the reload).
  let pinDelay = 0;
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
    else if (path.endsWith('/my_pin')) {
      if (pinDelay) await delay(pinDelay);
      result = hash;
    } else if (path.endsWith('/my_subscription')) result = { state: 'none' };
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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.getByLabel('Business email', { exact: true }).fill('shop@example.invalid');
  await page.getByLabel('Business password', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const lockButton = page.getByRole('button', { name: 'Lock', exact: true });
  await lockButton.waitFor();
  await delay(1000); // the PIN hash from the server is now kept on the device

  // Background: the screen is hidden, and shown again on return (the lock isn't due yet).
  const setVisibility = (state) =>
    page.evaluate((value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
  await setVisibility('hidden');
  const covered = () => page.evaluate(() => document.documentElement.classList.contains('privacy-cover'));
  assert.equal(await covered(), true);
  await setVisibility('visible');
  assert.equal(await covered(), false);

  await lockButton.click();
  await page.getByText('Locked', { exact: true }).waitFor();

  // From the first moment of the reload, note whether anything of the app ever appears.
  await page.addInitScript(() => {
    const seen = () => {
      if (document.querySelector('button[aria-label="Lock"]')) sessionStorage.setItem('leaked', '1');
    };
    new MutationObserver(seen).observe(document, { childList: true, subtree: true });
  });
  pinDelay = 4000;
  await page.reload();
  await page.getByText('Locked', { exact: true }).waitFor();
  await delay(1500);
  const leaked = await page.evaluate(() => sessionStorage.getItem('leaked'));
  assert.equal(leaked, null, 'the app showed before the lock');

  // Unlock before the slow server answers: its late answer must not lock the screen again.
  await page.locator('input[type="password"]').fill('2580');
  await page.getByRole('button', { name: /Unlock/ }).click();
  await lockButton.waitFor();
  await delay(4500);
  assert.equal(await lockButton.isVisible(), true, 'a late server answer locked the screen again');
  assert.deepEqual(errors, []);
  console.log('PIN reload passed');
} catch (error) {
  if (browser)
    for (const context of browser.contexts())
      for (const page of context.pages())
        await page.screenshot({ path: '/tmp/pin-reload-failure.png', fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
