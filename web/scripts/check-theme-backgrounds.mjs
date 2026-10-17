import { settingsSection } from './settings-navigation.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { defaultBranding, themeColors } from '../src/business-branding.mjs';
const openMore = async (scope) => {
  // Pages with a single extra action show it directly; others put it under More.
  const toggle = scope.locator('.toolbar-actions .more-menu > button').first();
  if (!(await toggle.count())) return scope;
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await scope.locator('.more-menu-panel').first().waitFor();
  return scope;
};

const port = 4186,
  url = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
const rgb = (hex) =>
  'rgb(' +
  hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16))
    .join(', ') +
  ')';
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  for (const mobile of [false, true]) {
    const page = await browser.newPage({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    const trial = page.getByRole('button', { name: 'Try locally on this device', exact: true });
    const enterTrial = async () => {
      await page.waitForFunction(
        () =>
          document.querySelector('.app') ||
          [...document.querySelectorAll('button')].some((button) =>
            button.textContent.includes('Try locally on this device'),
          ),
      );
      if (await trial.count()) await trial.click();
      await page.locator('.app').waitFor();
    };
    await enterTrial();
    const nav = async (name) => {
      if (mobile) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await delay(250);
        await page.getByRole('button', { name: 'Menu', exact: true }).click();
      }
      await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
    };
    const appearance = async () => {
      await nav('Business Settings');
      await settingsSection(page, /Appearance/);
    };
    const save = async () => {
      await page.getByRole('button', { name: 'Save appearance', exact: true }).click();
      await page.getByText('Appearance saved.', { exact: true }).waitFor();
    };
    const assertBackground = async (selector, hex) => {
      const element = page.locator(selector).first();
      await element.waitFor();
      for (let i = 0; i < 80; i++) {
        if ((await element.evaluate((el) => getComputedStyle(el).backgroundColor)) === rgb(hex)) return;
        await delay(25);
      }
      assert.equal(await element.evaluate((el) => getComputedStyle(el).backgroundColor), rgb(hex), selector);
    };
    await appearance();
    assert.equal(await page.locator('.theme-background-editor input[type=color]').count(), 6);
    await page.getByLabel('Primary color', { exact: true }).fill('#2244ee');
    await page.getByLabel('Business default theme', { exact: true }).selectOption('dark');
    await save();
    const blue = themeColors({ ...defaultBranding(), primary: '#2244ee' }, 'dark');
    await assertBackground('body', blue.canvas);
    await assertBackground('.business-settings', blue.surface);
    await assertBackground('.business-settings select:visible', blue.surfaceAlt);
    assert.equal(await page.getByLabel('Dark page background automatic', { exact: true }).isChecked(), true);
    await page.getByLabel('Primary color', { exact: true }).fill('#ee4422');
    await save();
    const red = themeColors({ ...defaultBranding(), primary: '#ee4422' }, 'dark');
    await assertBackground('body', red.canvas);
    assert.notEqual(blue.canvas, red.canvas);
    if (!mobile) {
      await page.getByRole('tab', { name: /Appearance/ }).hover();
      await assertBackground('.settings-tabs .active', '#ee4422');
    }
    const controls = [
      ['Light page background', '#f0e8ff'],
      ['Light panels & sidebar', '#fff7ed'],
      ['Light inputs & table headers', '#e1efff'],
      ['Dark page background', '#121225'],
      ['Dark panels & sidebar', '#242448'],
      ['Dark inputs & table headers', '#333366'],
    ];
    for (const [name, color] of controls) {
      await page.getByLabel(name, { exact: true }).fill(color);
      assert.equal(await page.getByLabel(`${name} automatic`, { exact: true }).isChecked(), false);
    }
    await assertBackground('.theme-background-mode:nth-child(2) .theme-background-preview', '#121225');
    await save();
    await assertBackground('body', '#121225');
    await assertBackground('.business-settings', '#242448');
    await assertBackground('.business-settings select:visible', '#333366');
    // Saving a different section must not overwrite the six custom background colors.
    await settingsSection(page, /Receipts/);
    await page.getByLabel('Receipt footer', { exact: true }).fill('Theme test');
    await page.getByRole('button', { name: 'Save receipt settings', exact: true }).click();
    await page.getByText('Receipt settings saved.', { exact: true }).waitFor();
    await page.reload();
    await enterTrial();
    await appearance();
    for (const [name, color] of controls)
      assert.equal(await page.getByLabel(name, { exact: true }).inputValue(), color);
    await assertBackground('body', '#121225');
    await nav('My Account');
    await page.getByLabel('Appearance on this device', { exact: true }).selectOption('light');
    await assertBackground('body', '#f0e8ff');
    await assertBackground('.panel', '#fff7ed');
    await page.getByLabel('Appearance on this device', { exact: true }).selectOption('system');
    await page.emulateMedia({ colorScheme: 'dark' });
    await assertBackground('body', '#121225');
    await page.emulateMedia({ colorScheme: 'light' });
    await assertBackground('body', '#f0e8ff');
    await page.getByLabel('Appearance on this device', { exact: true }).selectOption('business');
    // Forms and modal headers also honor backgrounds, while receipt-like print previews stay white.
    await nav('Materials');
    await page.getByRole('button', { name: 'Add material', exact: true }).click();
    await assertBackground('dialog.modal', '#242448');
    await assertBackground('.modal-header', '#242448');
    await assertBackground('dialog.modal input:not([type=checkbox])', '#333366');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await nav('Print Settings');
    await (await openMore(page)).getByRole('button', { name: 'Layout sample', exact: true }).click();
    await assertBackground('.print-layout-sample', '#ffffff');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await appearance();
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'No mobile overflow',
    );
    await page.screenshot({
      path: mobile ? '/tmp/theme-backgrounds-mobile.png' : '/tmp/theme-backgrounds-desktop.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Restore default colors', exact: true }).click();
    for (const [name] of controls)
      assert.equal(await page.getByLabel(`${name} automatic`, { exact: true }).isChecked(), true);
    await save();
    await assertBackground('body', themeColors(defaultBranding(), 'dark').canvas);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    'Theme backgrounds passed desktop/mobile: palette-derived colors, six overrides, previews, persistence, section saves, device/system themes, modals, print preview and reset.',
  );
} finally {
  await browser?.close();
  server.kill();
}
