// Number and phone fields refuse letters as they are typed, and keep only the number when pasted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 4202;
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
setTimeout(() => {
  console.error('Number entry check timed out');
  process.exit(1);
}, 90000).unref();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => document.getElementById('root')?.childElementCount);
  // Fields made on the page, as the app's own fields are: a phone, a quantity and an amount.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<form id="test-fields">
        <label>Phone <input type="tel" aria-label="Test phone"></label>
        <label>Quantity <input inputmode="numeric" aria-label="Test quantity"></label>
        <label>Amount <input inputmode="decimal" aria-label="Test amount"></label>
        <label>Pieces <input type="number" aria-label="Test pieces"></label>
        <label>Name <input aria-label="Test name"></label>
      </form>`,
    );
  });
  const phone = page.getByLabel('Test phone');
  await phone.pressSequentially('Mr Bayo 0803 123 4567');
  assert.equal((await phone.inputValue()).trim(), '0803 123 4567');
  await page.locator('.input-hint').filter({ hasText: 'Phone numbers can only have digits' }).waitFor();
  const quantity = page.getByLabel('Test quantity');
  await quantity.pressSequentially('12a.5');
  assert.equal(await quantity.inputValue(), '125');
  const amount = page.getByLabel('Test amount');
  await amount.pressSequentially('1,250.50naira');
  assert.equal(await amount.inputValue(), '1,250.50');
  const pieces = page.getByLabel('Test pieces');
  await pieces.pressSequentially('3x');
  assert.equal(await pieces.inputValue(), '3');
  // Ordinary text fields are not touched.
  await page.getByLabel('Test name').pressSequentially('Ada 2');
  assert.equal(await page.getByLabel('Test name').inputValue(), 'Ada 2');
  // Pasting (or a keyboard suggestion) keeps only the number.
  await phone.fill('');
  await phone.focus();
  await page.keyboard.insertText('Tel: +234 803 123 4567');
  assert.equal((await phone.inputValue()).trim(), '+234 803 123 4567');
  assert.deepEqual(errors, []);
  console.log('Number entry passed');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
