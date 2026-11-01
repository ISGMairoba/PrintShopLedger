import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const origin = 'http://127.0.0.1:4197';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4197', '--strictPort'],
  { stdio: 'ignore', windowsHide: true },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      serviceWorkers: 'block',
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByRole('button', { name: 'Try locally on this device', exact: true }).click();
    if (mobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Business Settings', exact: true })
      .click();
    const section = async (name) => {
      if (mobile) await page.getByLabel('Business settings section', { exact: true }).selectOption(name);
      else await page.getByRole('tab', { name, exact: true }).click();
    };
    await section('Jobs & payments');
    assert.equal(await page.getByLabel('Words for', { exact: true }).isVisible(), false);
    await section('Words');
    await page.getByRole('group',{name:'Words',exact:true}).getByRole('combobox').selectOption('retail');
    await page.getByRole('button', { name: 'Save words', exact: true }).click();
    await page.getByText('Words saved.', { exact: true }).waitFor();
    await section('Default time frames');
    await page.getByRole('group',{name:'Default time frames',exact:true}).getByRole('combobox').first().selectOption('today');
    await page.getByRole('button', { name: 'Save default time frames', exact: true }).click();
    await page.getByText('Default time frames saved.', { exact: true }).waitFor();
    const b = await page.evaluate(
      () => JSON.parse(localStorage.getItem('printshopledger:branding:v1:local-trial')).settings,
    );
    assert.equal(b.terms.preset, 'retail');
    assert.equal(b.periods.dashboard, 'today');
    assert.deepEqual(errors, []);
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'Settings overflow horizontally',
    );
    console.log('Settings sections ' + (mobile ? 'mobile' : 'desktop') + ' passed');
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
