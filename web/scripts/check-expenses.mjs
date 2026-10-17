import { readCopy } from './local-copy.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
const openFilters = async (scope) => {
  const toggle = scope.locator('.filter-button').first();
  if ((await toggle.count()) && (await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  return scope;
};
const openMore = async (scope) => {
  // Pages with a single extra action show it directly; others put it under More.
  const toggle = scope.locator('.toolbar-actions .more-menu > button').first();
  if (!(await toggle.count())) return scope;
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await scope.locator('.more-menu-panel').first().waitFor();
  return scope;
};

const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4178', '--strictPort'],
  { stdio: 'inherit' },
);
let browser, mobileBrowser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4178')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHROMIUM_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:4178');
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  const nav = (name) =>
    page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
  const state = () => readCopy(page, 'local-trial');
  await nav('Materials');
  await page.getByRole('button', { name: 'Add material', exact: true }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Name', { exact: true }).fill('Expense Paper');
  await d.getByLabel('Measurement unit', { exact: true }).fill('sheet');
  await d.getByRole('button', { name: 'Save material', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await nav('Expenses');
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Add expense' });
  await d.getByLabel('Description', { exact: true }).fill('Paper purchase');
  await d.getByLabel('Category', { exact: true }).fill('Materials');
  const totalInput = d.getByLabel('Total cost (₦)'),
    paidInput = d.getByLabel('Amount paid (₦)');
  const paste = async (input, text) =>
    input.evaluate((el, text) => {
      el.focus();
      el.select();
      const data = new DataTransfer();
      data.setData('text', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
  await paste(totalInput, '1,2');
  await totalInput.blur();
  assert.equal(await totalInput.inputValue(), '', 'Malformed pasted groups are blocked');
  assert.equal(await totalInput.evaluate((el) => el.checkValidity()), false, 'Required amount stays empty');
  await paste(totalInput, '0,443,342.00');
  await totalInput.blur();
  assert.equal(await totalInput.inputValue(), '443,342.00');
  await totalInput.fill('00025000.00');
  await totalInput.blur();
  assert.equal(await totalInput.inputValue(), '25,000.00');
  assert.equal(await paidInput.inputValue(), '25,000.00', 'Expense payment defaults to total cost');
  await totalInput.fill('30000');
  assert.equal(await paidInput.inputValue(), '30,000.00');
  await paidInput.fill('5000');
  await totalInput.fill('1000');
  await paidInput.focus();
  await paidInput.blur();
  assert.equal(await paidInput.inputValue(), '0.00', 'An amount invalidated by a lower cost resets on blur');
  await paidInput.fill('500');
  await totalInput.fill('25000');
  await paidInput.fill('5000');
  await totalInput.focus();
  assert.equal(await paidInput.inputValue(), '5,000.00', 'Cashier amount survives cost changes');
  await d.getByLabel('Record money paid now').uncheck();
  await d.getByLabel('Record money paid now').check();
  assert.equal(await paidInput.inputValue(), '25,000.00', 'Enabling payment restores recommended amount');
  await paidInput.fill('25000.01');
  assert.equal(
    await paidInput.inputValue(),
    '25,000.00',
    'Overpayment is blocked and previous valid amount is retained',
  );
  assert.equal(await paidInput.evaluate((el) => el.checkValidity()), true);
  await paidInput.fill('5000');
  await d.getByLabel('Supplier / paid to').fill('Paper Seller');
  await d.getByLabel('Add purchased materials to stock').check();
  await d.getByRole('button', { name: 'Add material', exact: true }).click();
  await d.getByLabel('Material 1', { exact: true }).selectOption({ index: 1 });
  await d.getByLabel('Quantity received 1', { exact: true }).fill('100');
  await d.getByLabel('Amount paid (₦)').fill('5000');
  await d.getByRole('button', { name: 'Save expense', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  let saved = await state();
  assert.equal(saved.ledger.materials[0].available, 100);
  assert.equal(saved.ledger.expenses[0].amount, 2500000);
  assert.equal(saved.ledger.expenses[0].payments[0].amount, 500000);
  assert.equal(saved.ledger.jobs.length, 0);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Edit expense' });
  await d.getByLabel('Quantity received 1', { exact: true }).fill('120');
  await d.getByRole('button', { name: 'Save expense', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.equal((await state()).ledger.materials[0].available, 120);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Record expense payment' });
  assert.equal(await d.getByLabel('Amount paid (₦)').inputValue(), '20,000.00');
  await d.getByLabel('Payment method').selectOption('Transfer');
  await d.getByLabel('Paid from').selectOption('Business bank account');
  await d.getByRole('button', { name: 'Save payment', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  saved = await state();
  assert.equal(saved.ledger.expenses[0].payments.length, 2);
  assert.equal(saved.ledger.materials[0].available, 120);
  await (await openMore(page)).getByRole('button', { name: 'Audit view', exact: true }).click();
  assert.ok(await page.getByRole('columnheader', { name: 'Created by', exact: true }).count());
  await page.getByRole('button', { name: 'Amount', exact: true }).click();
  await page.getByLabel('Search expenses').fill('Paper Seller');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Search expenses').fill('no-such-expense');
  assert.match(await page.locator('main').innerText(), /No matching expenses/);
  await (await openFilters(page)).getByRole('button', { name: 'Reset filters', exact: true }).click();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  d = page.getByRole('dialog');
  assert.match(await d.innerText(), /Payment history/);
  assert.equal(await d.locator('details').count(), 3);
  await d.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Void expense?' });
  await d.getByLabel('Reason', { exact: true }).fill('Returned purchase');
  await d.getByRole('button', { name: 'Void expense', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  saved = await state();
  assert.equal(saved.ledger.materials[0].available, 0);
  assert.ok(saved.ledger.expenses[0].voided);
  assert.equal(saved.ledger.expenses[0].payments.length, 2);
  await (await openFilters(page)).getByLabel('Expense status').selectOption('Voided');
  assert.equal(await page.locator('tbody tr').count(), 1);
  await nav('Stock History');
  assert.equal(await page.locator('tbody tr').count(), 4);
  assert.match(await page.locator('tbody').innerText(), /Expense stock change/);
  await nav('Expenses');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Description', { exact: true }).fill('Fuel purchase');
  await d.getByLabel('Category', { exact: true }).fill('Fuel');
  await d.getByLabel('Total cost (₦)').fill('10000');
  await d.getByLabel('Record money paid now').uncheck();
  await d.getByRole('button', { name: 'Save expense', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  saved = await state();
  assert.equal(saved.ledger.expenses.length, 2);
  assert.equal(saved.ledger.materialHistory.length, 4);
  await page.context().setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  await nav('Expenses');
  await (await openFilters(page)).getByLabel('Expense status').selectOption('all');
  assert.equal(await page.locator('tbody tr').count(), 2);
  await page.screenshot({ path: '/tmp/expenses-desktop.png', fullPage: true });
  mobileBrowser = await (process.env.EXPENSE_MOBILE_CHROMIUM ? chromium : webkit).launch({ headless: true });
  const mobile = await mobileBrowser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto('http://127.0.0.1:4178');
  await mobile.getByRole('button', { name: 'Try locally on this device' }).click();
  await mobile.evaluate(
    (saved) =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('printshopledger-v1', 1);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('ledgers', 'readwrite');
          {
            const st = tx.objectStore('ledgers');
            st.delete(IDBKeyRange.bound('local-trial' + '|', 'local-trial' + '|\uffff'));
            st.put(saved, 'local-trial');
          }
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = reject;
        };
        r.onerror = reject;
      }),
    saved,
  );
  await mobile.reload();
  await mobile.getByRole('button', { name: 'Try locally on this device' }).click();
  await mobile.getByRole('button', { name: 'Menu', exact: true }).click();
  await mobile
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Expenses', exact: true })
    .click();
  assert.equal(await mobile.locator('.mobile-list thead th').count(), 3);
  await (await openFilters(mobile)).getByLabel('Expense status').selectOption('all');
  await (await openMore(mobile)).getByRole('button', { name: 'Audit view', exact: true }).click();
  assert.ok(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile page fits viewport',
  );
  await mobile.getByRole('button', { name: 'Add expense', exact: true }).click();
  const md = mobile.getByRole('dialog');
  assert.equal(
    await md.evaluate((element) => document.activeElement === element),
    true,
    'Touch dialog opens without focusing a text field or raising the keyboard',
  );
  // A fixed footer creates a separate scroll viewport. Expose the complete touch target,
  // then exercise the real native checkbox (no forced click or direct checked-state changes).
  await md
    .getByLabel('Add purchased materials to stock')
    .evaluate((element) =>
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }),
    );
  assert.ok(
    await md.getByLabel('Add purchased materials to stock').evaluate((element) => {
      const target = element.getBoundingClientRect();
      const viewport = element.closest('dialog').querySelector('.modal-body').getBoundingClientRect();
      return target.top >= viewport.top && target.bottom <= viewport.bottom;
    }),
    'Stock checkbox is fully inside the dialog scroll viewport before tapping',
  );
  await md.getByLabel('Add purchased materials to stock').evaluate((element) => {
    element.uiEvents = [];
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'input', 'change']) {
      element.addEventListener(
        type,
        (event) => {
          element.uiEvents.push({ type, checked: element.checked, prevented: event.defaultPrevented });
        },
        true,
      );
    }
  });
  try {
    const stockToggle = md.getByLabel('Add purchased materials to stock');
    await stockToggle.tap();
    // WebKit delivers the compatibility click after the touch sequence completes.
    await mobile.waitForFunction(() => document.querySelector('.expense-stock input').checked);
    assert.equal(await stockToggle.isChecked(), true, 'A real touch tap enables stock purchase');
    await stockToggle.press('Space');
    assert.equal(await stockToggle.isChecked(), false, 'Keyboard can turn stock purchase off');
    await stockToggle.press('Space');
    assert.equal(await stockToggle.isChecked(), true, 'Keyboard can turn stock purchase on');
  } catch (error) {
    console.log(
      'Expense mobile hit target',
      await md.getByLabel('Add purchased materials to stock').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const body = element.closest('dialog').querySelector('.modal-body');
        return {
          checked: element.checked,
          events: element.uiEvents,
          rect: rect.toJSON(),
          hit: hit?.outerHTML,
          scrollTop: body.scrollTop,
          body: body.getBoundingClientRect().toJSON(),
        };
      }),
    );
    console.log('Mobile page errors', errors);
    await mobile.screenshot({ path: '/tmp/expenses-mobile-failure.png', fullPage: true });
    throw error;
  }
  await md.getByRole('button', { name: 'Add material', exact: true }).click();
  assert.ok(await md.evaluate((el) => el.scrollWidth <= el.clientWidth), 'Expense popup fits mobile');
  assert.ok(
    Number(
      await md.getByLabel('Total cost (₦)').evaluate((el) => getComputedStyle(el).fontSize.replace('px', '')),
    ) >= 16,
  );
  await mobile.screenshot({ path: '/tmp/expenses-mobile.png', fullPage: true });
  await md.getByRole('button', { name: 'Close', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'Expense desktop and mobile workflows passed: stock, edit, payment, void, history, offline save, filters and modal layout.',
  );
} finally {
  await browser?.close();
  await mobileBrowser?.close();
  server.kill();
}
