import { readCopy } from './local-copy.mjs';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { pick, pickedValue, pickOptions } from './pick.mjs';
const server = spawn(
  process.execPath,
  ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'],
  { stdio: 'inherit' },
);
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4175')).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('Browser error:', e.message);
  });
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  const nav = (name) =>
    page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name, exact: true }).click();
  await nav('Materials');
  await page.getByRole('button', { name: 'Add material', exact: true }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Name', { exact: true }).fill('Paper');
  await d.getByLabel('Measurement unit', { exact: true }).fill('sheet');
  await d.getByRole('button', { name: 'Save material', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Add to stock', exact: true }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Quantity to add').fill('10');
  await d.getByRole('button', { name: 'Add to stock', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await nav('Services');
  await page.getByRole('button', { name: 'Add service', exact: true }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Service description').fill('Printing');
  await pick(d, 'Base material', { index: 2 });
  await d.getByLabel('Price (₦)').fill('000100.00');
  await d.getByLabel('Price (₦)').blur();
  assert.equal(await d.getByLabel('Price (₦)').inputValue(), '100.00');
  await d.getByRole('button', { name: 'Save service', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  assert.equal(await d.locator('.customer-section-toggle').count(), 0);
  assert.equal(await d.getByRole('combobox', { name: 'Customer name or phone' }).count(), 1);
  await d.getByRole('button', { name: 'Add new customer', exact: true }).click();
  const cd = page.getByRole('dialog', { name: 'Add customer' });
  await cd.getByLabel('Credit limit (₦)').fill('100000.25');
  assert.equal(await cd.getByLabel('Credit limit (₦)').inputValue(), '100,000.25');
  await cd.getByLabel('Credit limit (₦)').fill('0');
  await cd.getByLabel('Full name').fill('Alex Customer');
  await cd.getByLabel('Phone number').fill('080111');
  await cd.getByRole('button', { name: 'Save customer', exact: true }).click();
  await cd.waitFor({ state: 'detached' });
  assert.ok(
    await d.evaluate((el) => {
      const jobs = el.querySelector('.cart-line'),
        customer = el.querySelector('.checkout-customer'),
        payment = [...el.querySelectorAll('h3')].find((h) => h.textContent === 'Payment'),
        cash = el.querySelector('.currency-input');
      return (
        !!(jobs.compareDocumentPosition(payment) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(payment.compareDocumentPosition(customer) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !!(customer.compareDocumentPosition(cash) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
    'Jobs precede payment; customer is first within payment',
  );
  async function fillLine(index, quantity, description) {
    const line = d.locator('.cart-line').nth(index);
    assert.equal(await d.count(), 1, 'Checkout stays open');
    assert.equal(await line.count(), 1, 'Cart line remains available');
    await pick(line, 'Service', { index: 0 });
    await line.getByLabel('Job description').fill(description);
    await line.getByLabel('Quantity', { exact: true }).fill(String(quantity));
    await line.getByLabel('Job received through').selectOption('WhatsApp');
  }
  let pdfChecked = false;
  async function finish() {
    await d.getByRole('button', { name: 'Complete checkout', exact: true }).click();
    await d.waitFor({ state: 'detached' });
    const receipt = page.getByRole('dialog');
    await receipt.waitFor();
    assert.match(await receipt.innerText(), /Wallet balance/);
    if (!pdfChecked) {
      const waiting = page.waitForEvent('download');
      await receipt.getByRole('button', { name: 'Download PDF (A4)', exact: true }).click();
      const download = await waiting;
      assert.match(download.suggestedFilename(), /^Receipt-.+\.pdf$/);
      const bytes = await readFile(await download.path());
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      pdfChecked = true;
    }
    await receipt.getByRole('button', { name: 'Close', exact: true }).click();
  }
  await fillLine(0, 60, 'Sixty sheets');
  await d.getByRole('button', { name: 'Add another service', exact: true }).click();
  await fillLine(1, 5, 'Five sheets');
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '6,500.00');
  assert.match(await d.locator('.cart-total').innerText(), /₦6,500.00/);
  assert.equal(await d.locator('.cart-total').evaluate((el) => getComputedStyle(el).textAlign), 'center');
  assert.ok(
    Number(await d.locator('.cart-total strong').evaluate((el) => getComputedStyle(el).fontWeight)) >= 700,
  );
  const cashInput = d.getByLabel('Money received (₦)');
  for (const invalid of ['-500', 'abc', '1e6', '1.001', '1000000000.01']) {
    await cashInput.fill(invalid);
    assert.equal(await cashInput.evaluate((el) => el.checkValidity()), true);
    assert.notEqual(await cashInput.inputValue(), invalid, 'Invalid entry is blocked');
  }
  await cashInput.fill('00007000.00');
  await cashInput.blur();
  assert.equal(await cashInput.inputValue(), '7,000.00');
  assert.equal(await cashInput.evaluate((el) => el.checkValidity()), true);
  assert.equal(await d.locator('.allocation-service').first().innerText(), 'Printing');
  assert.ok(await d.locator('.allocation-description').first().getAttribute('title'));
  assert.match(await d.innerText(), /Stock warning/);
  await finish();
  const state = () => readCopy(page, 'local-trial');
  let saved = await state();
  assert.equal(saved.ledger.jobs.length, 2);
  assert.equal(saved.ledger.customers.length, 1);
  assert.equal(saved.ledger.materials[0].available, -55);
  assert.equal(saved.ledger.payments[0].walletAdded, 50000);
  assert.equal(saved.ledger.materialHistory.filter((h) => h.action === 'material.job_used').length, 2);
  await nav('Materials');
  await page.getByRole('button', { name: 'Add to stock', exact: true }).click();
  d = page.getByRole('dialog');
  await d.getByLabel('Quantity to add').fill('100');
  await d.getByRole('button', { name: 'Add to stock', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.equal((await state()).ledger.materials[0].available, 45);
  async function pickCustomer() {
    assert.equal(await d.locator('.customer-section-toggle').count(), 0);
    const picker = d.getByRole('combobox', { name: 'Customer name or phone' });
    await picker.focus();
    assert.equal(await d.getByRole('listbox').count(), 0, 'Focus alone does not show suggestions');
    await picker.fill('');
    assert.equal(await d.getByRole('listbox').count(), 0, 'Empty search has no suggestions');
    await picker.fill('Alex');
    const option = d.getByRole('listbox', { name: 'Customer suggestions' }).getByRole('option').first();
    assert.match(await option.innerText(), /080111/);
    await option.click();
  }
  await nav('Point of Service');
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await pickCustomer();
  await fillLine(0, 3, 'Wallet print');
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '0.00', 'Wallet covers the whole job');
  await d.getByLabel('Use available wallet credit when needed').uncheck();
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '300.00');
  await d.getByLabel('Use available wallet credit when needed').check();
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '0.00');
  await finish();
  saved = await state();
  assert.equal(saved.ledger.payments[1].amount, 0);
  assert.equal(saved.ledger.payments[1].walletUsed, 30000);
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await pickCustomer();
  await fillLine(0, 4, 'Unpaid first');
  await d.getByRole('button', { name: 'Add another service', exact: true }).click();
  await fillLine(1, 6, 'Unpaid second');
  assert.equal(
    await d.getByLabel('Money received (₦)').inputValue(),
    '800.00',
    'Wallet reduces recommended cash',
  );
  await d.getByLabel('Use available wallet credit when needed').uncheck();
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '1,000.00');
  await d.getByLabel('Money received (₦)').fill('0');
  assert.match(await d.innerText(), /Credit limit exceeded/);
  await finish();
  await page.getByRole('button', { name: 'Receive payment', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Receive payment' });
  await pickCustomer();
  assert.equal(
    await d.getByLabel('Money received (₦)').inputValue(),
    '800.00',
    'Payment-only recommends unpaid balances minus wallet',
  );
  await d.getByLabel('Money received (₦)').fill('500');
  await d.getByLabel('Use available wallet credit when needed').uncheck();
  await d.getByRole('button', { name: 'Override allocation', exact: true }).click();
  const firstAllocation = d.getByLabel(/Allocate to Printing: Unpaid first \(Job /),
    secondAllocation = d.getByLabel(/Allocate to Printing: Unpaid second \(Job /);
  assert.equal(await firstAllocation.inputValue(), '400.00');
  assert.equal(await secondAllocation.inputValue(), '100.00');
  await secondAllocation.fill('300');
  assert.equal(await firstAllocation.inputValue(), '200.00');
  assert.equal(await secondAllocation.inputValue(), '300', 'Newest allocation keeps the cashier’s entry');
  await firstAllocation.fill('350');
  assert.equal(
    await secondAllocation.inputValue(),
    '150.00',
    'Re-editing the first allocation makes it newest',
  );
  await secondAllocation.fill('500');
  assert.equal(await firstAllocation.inputValue(), '0.00');
  await d.getByLabel('Money received (₦)').fill('300');
  await page.waitForFunction(
    () =>
      document.querySelector('input[aria-label^="Allocate to Printing: Unpaid second (Job "]')?.value ===
      '300.00',
  );
  assert.equal(
    await secondAllocation.inputValue(),
    '300.00',
    'Lowering the available money rebalances allocations',
  );
  await d.getByLabel('Money received (₦)').fill('500');
  await d.getByLabel('Use available wallet credit when needed').check();
  await d.getByRole('button', { name: 'Use automatic allocation', exact: true }).click();
  await finish();
  saved = await state();
  const payment = saved.ledger.payments.at(-1);
  assert.equal(payment.allocations.length, 2);
  assert.equal(payment.walletUsed, 20000);
  assert.equal(payment.allocations[0].amount, 40000);
  assert.equal(payment.allocations[1].amount, 30000);
  await page.getByRole('button', { name: 'Receive payment', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Receive payment' });
  await pickCustomer();
  await d.getByLabel('Money received (₦)').fill('100');
  await d.getByRole('button', { name: 'Override allocation', exact: true }).click();
  await d.getByLabel(/Allocate to Printing: Unpaid second \(Job /).fill('100');
  await finish();
  assert.equal((await state()).ledger.payments.at(-1).allocations[0].amount, 10000);
  await page.getByRole('button', { name: 'Next: In Queue', exact: true }).first().click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Confirm next action' }).click();
  await d.waitFor({ state: 'detached' });
  assert.equal((await state()).ledger.jobs.filter((j) => j.productionStatus === 'In Queue').length, 1);
  const queuedJob = (await state()).ledger.jobs.find((j) => j.productionStatus === 'In Queue');
  let jobRow = page.locator('tbody tr').filter({ hasText: queuedJob.description });
  assert.equal(await jobRow.locator('.job-service').innerText(), 'Printing');
  assert.ok(
    Number(await jobRow.locator('.job-service').evaluate((el) => getComputedStyle(el).fontWeight)) >= 700,
  );
  assert.match(await jobRow.innerText(), /Quantity:/);
  assert.match(await jobRow.innerText(), /Source: WhatsApp/);
  await page.getByRole('button', { name: 'Date', exact: true }).waitFor();
  await jobRow.getByRole('button', { name: 'Set Action', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Set job stage' });
  await d.getByLabel('Desired stage').selectOption('Printing');
  assert.match(await d.innerText(), /Proceed in order: Printing/);
  await d.getByRole('button', { name: 'Set action', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.equal((await state()).ledger.jobs.find((j) => j.id === queuedJob.id).productionStatus, 'Printing');
  await nav('Jobs');
  jobRow = page.locator('tbody tr').filter({ hasText: queuedJob.description });
  assert.equal(await page.locator('thead th').count(), 6, 'Jobs has the six requested columns');
  assert.match(await jobRow.innerText(), /080111/);
  assert.match(await jobRow.innerText(), /Paid:/);
  assert.match(await jobRow.innerText(), /Outstanding:/);
  assert.match(await jobRow.innerText(), /Last payment:/);
  await jobRow.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Move job to Completed?' });
  await d.getByRole('button', { name: 'Mark as Complete', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  assert.equal((await state()).ledger.jobs.find((j) => j.id === queuedJob.id).productionStatus, 'Completed');
  assert.equal(
    await jobRow.getByRole('button', { name: 'Mark as Complete', exact: true }).isDisabled(),
    true,
  );
  const addedJob = (await state()).ledger.jobs.find((j) => j.productionStatus === 'Added');
  jobRow = page.locator('tbody tr').filter({ hasText: addedJob.description });
  await jobRow.getByRole('button', { name: 'Set Action', exact: true }).click();
  d = page.getByRole('dialog', { name: 'Set job stage' });
  await d.getByLabel('Desired stage').selectOption('Completed');
  assert.match(await d.innerText(), /In Queue → Printing → Completed/);
  await d.getByRole('button', { name: 'Set action', exact: true }).click();
  await d.waitFor({ state: 'detached' });
  const completedJob = (await state()).ledger.jobs.find((j) => j.id === addedJob.id);
  assert.equal(completedJob.productionStatus, 'Completed');
  assert.equal(completedJob.version, 4, 'Intervening steps each increment the version');
  await nav('Customers');
  await page.getByRole('button', { name: 'Account records', exact: true }).click();
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Outstanding', exact: true }).click();
  assert.match(await d.innerText(), /Unpaid second/);
  await d.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'Point of Service', exact: true }).click();
  await page.locator('.mobile-list').waitFor();
  assert.equal(await page.locator('.mobile-list thead th').count(), 3);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile Point of Service list fits',
  );
  await page.getByRole('button', { name: 'Add job', exact: true }).click();
  d = page.getByRole('dialog', { name: 'New checkout' });
  await pickCustomer();
  await fillLine(0, 1, 'Mobile checkout');
  assert.equal(
    await d.getByLabel('Money received (₦)').inputValue(),
    '300.00',
    'New job adds the previous unpaid 200 balance',
  );
  await d.getByLabel('Money received (₦)').fill('100');
  await d.locator('.cart-line').getByLabel('Quantity', { exact: true }).fill('2');
  assert.equal(
    await d.getByLabel('Money received (₦)').inputValue(),
    '100.00',
    'Cashier amount survives cart changes',
  );
  await d.getByRole('button', { name: 'Use recommended amount', exact: true }).click();
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '400.00');
  await d.getByRole('button', { name: 'Add another service', exact: true }).click();
  await fillLine(1, 1, 'Temporary job');
  assert.match(await d.locator('.cart-total').innerText(), /₦300.00/);
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '500.00');
  await d.locator('.cart-line').nth(1).getByRole('button', { name: 'Remove job', exact: true }).click();
  assert.match(await d.locator('.cart-total').innerText(), /₦200.00/);
  assert.equal(await d.getByLabel('Money received (₦)').inputValue(), '400.00');
  await d.locator('.cart-line').getByLabel('Quantity', { exact: true }).fill('1');
  await d.getByLabel('Money received (₦)').fill('100');
  await d.getByRole('button', { name: 'Override allocation', exact: true }).click();
  await d.getByLabel(/Allocate to Printing: Mobile checkout \(Job /).fill('100');
  assert.equal(
    await d.getByLabel(/Allocate to Printing: Unpaid second \(Job /).inputValue(),
    '0.00',
    'Mobile uses the same allocation priority',
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Mobile checkout fits',
  );
  await d.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Try locally on this device' }).click();
  saved = await state();
  assert.equal(saved.ledger.jobs.length, 5, 'Reload preserves checkout');
  assert.equal(saved.ledger.checkouts.length, 5, 'Each checkout has one receipt');
  assert.deepEqual(errors, []);
  console.log(
    'Checkout browser checks passed: cart, inline customer creation, phone suggestions, negative stock and restock, wallet, multi-job payment, manual allocation, credit warning, receipts, production status, mobile and persistence.',
  );
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
