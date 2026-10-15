import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyCheckout, prepareCheckout } from '../src/checkout.mjs';
import { receiptHtml, receiptIntegrityError } from '../src/receipts.mjs';
const job = {
  id: 'job',
  customerId: 'customer',
  service: 'Banner',
  description: 'Shop banner',
  amount: 4500000,
  createdAt: '2026-10-06T10:00:00Z',
};
const initial = {
  ...emptyLedger(),
  customers: [{ id: 'customer', name: 'Customer', phone: '080111', address: '', archived: false }],
  jobs: [job],
};
const input = {
  customerId: 'customer',
  lines: [],
  cashReceived: 500000,
  useWallet: false,
  method: 'Cash',
  paidOn: '2026-10-06',
  reference: '',
};
const event = () =>
  prepareCheckout(initial, input, { id: 'cashier', label: 'Cashier' }, 'receipt', '2026-10-06T12:00:00Z');
test('45000 job with 5000 received prints 45000 amount and 40000 outstanding', () => {
  const e = event(),
    saved = applyCheckout(initial, e),
    r = saved.checkouts[0];
  assert.equal(r.jobBalances[0].amount, 4500000);
  assert.equal(r.jobBalances[0].paidThisCheckout, 500000);
  assert.equal(r.jobBalances[0].outstandingAfter, 4000000);
  assert.equal(receiptIntegrityError(r), '');
  const html = receiptHtml(r, 'Shop');
  for (const amount of ['₦45,000.00', '₦5,000.00', '₦40,000.00']) assert.ok(html.includes(amount));
  assert.ok(!html.includes('₦80,000.00'));
  const later = prepareCheckout(
    saved,
    { ...input, cashReceived: 1000000 },
    { id: 'cashier', label: 'Cashier' },
    'later',
    '2026-10-07T12:00:00Z',
  );
  const next = applyCheckout(saved, later);
  assert.equal(
    receiptHtml(next.checkouts[0], 'Shop'),
    html,
    'Later payments do not change an earlier receipt',
  );
});
test('inconsistent 80000 receipt amount is flagged and never rendered as a confirmed amount', () => {
  const r = event().data;
  r.jobBalances[0].amount = 8000000;
  assert.match(receiptIntegrityError(r), /payment breakdown/);
  const html = receiptHtml(r, 'Shop');
  assert.ok(html.includes('Needs verification'));
  assert.ok(!html.includes('₦80,000.00'));
});

test('a conflicting new-job total is also hidden and blocked from printing', () => {
  const r = event().data;
  r.total = 8000000;
  assert.match(receiptIntegrityError(r), /job total/);
  assert.ok(!receiptHtml(r, 'Shop').includes('₦80,000.00'));
});

import { receiptLayout, receiptModel } from '../src/receipts.mjs';
import { printDocument, defaultPrintSettings } from '../src/print-settings.mjs';
test('Receipt printer layout shows the same confirmed amounts and blocks unverified ones', () => {
  const saved = applyCheckout(initial, event()),
    r = saved.checkouts[0];
  const narrow = receiptHtml(r, 'Shop <b>', false, [], { layout: 'narrow' });
  for (const value of [
    '₦45,000.00',
    '₦5,000.00',
    '₦40,000.00',
    'Paid now',
    'Wallet balance',
    'Shop &lt;b&gt;',
    'RECEIPT',
  ])
    assert.ok(narrow.includes(value), value);
  assert.ok(!narrow.includes('<b>'));
  const bad = event().data;
  bad.jobBalances[0].amount = 8000000;
  const html = receiptHtml(bad, 'Shop', false, [], { layout: 'narrow' });
  assert.ok(html.includes('Needs verification'));
  assert.ok(!html.includes('₦80,000.00'));
  assert.ok(
    !receiptModel(bad, 'Shop').totals.some((t) => t.label === 'Balance on these jobs'),
    'no derived balance from unverified amounts',
  );
});
test('Receipt layout follows paper width and brand colour is never injected raw', () => {
  assert.equal(receiptLayout(80), 'narrow');
  assert.equal(receiptLayout(58), 'narrow');
  assert.equal(receiptLayout(210), 'wide');
  assert.equal(receiptLayout(undefined), 'wide');
  const r = applyCheckout(initial, event()).checkouts[0];
  const html = receiptHtml(r, { businessName: 'X', primary: 'red;}</style><script>x</script>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('#124b40'));
});
test('Print document styles are valid CSS (closed body rule)', () => {
  const doc = printDocument(defaultPrintSettings(), 't', '<p>x</p>');
  assert.match(doc, /font-style:normal;[^}]*}table\{/);
});

import { sampleReceipt } from '../src/receipt-sample.mjs';
import { defaultBranding } from '../src/business-branding.mjs';
test('Each business chooses what its receipt shows and which line leads each job', () => {
  const r = sampleReceipt('2026-10-11T10:00:00Z');
  assert.equal(receiptIntegrityError(r), '', 'preview sample is balanced');
  const brand = (o) => ({
    ...defaultBranding(),
    businessName: 'Shop',
    receipt: { ...defaultBranding().receipt, ...o },
    receiptPage: { ...defaultBranding().receiptPage, ...o },
  });
  const full = receiptModel(r, brand({}));
  assert.equal(full.items[0].title, 'Shop banner, flex with eyelets');
  assert.equal(full.items[0].subtitle, 'Large format printing');
  assert.ok(full.items[0].meta.includes('Qty 2'));
  assert.ok(full.items[0].meta.some((x) => x.startsWith('Size')));
  const service = receiptModel(r, brand({ headline: 'service', showSubline: false }));
  assert.equal(service.items[0].title, 'Large format printing');
  assert.equal(service.items[0].subtitle, '');
  // A minimal receipt: service and price only.
  const minimal = brand({
    headline: 'service',
    showSubline: false,
    showJobId: false,
    showQuantity: false,
    showSize: false,
    showSource: false,
    showDueDate: false,
    showPaidBefore: false,
    showPaidNow: false,
    showItemBalance: false,
    showCustomerPhone: false,
    showCashier: false,
    showPaymentDate: false,
    showPaymentMethod: false,
    showWalletMovements: false,
    showAccountBalances: false,
    showNote: false,
  });
  const m = receiptModel(r, minimal);
  assert.deepEqual(m.items[0].meta, []);
  assert.equal(m.items[0].paidNow, '');
  assert.equal(m.items[0].balance, '');
  assert.deepEqual(m.account, []);
  assert.equal(m.note, '');
  assert.deepEqual(
    m.meta.map((x) => x[0]),
    ['Receipt no.', 'Date', 'Customer'],
  );
  assert.equal(m.totals.find((t) => t.label.startsWith('Paid now')).label, 'Paid now');
  for (const layout of ['narrow', 'wide']) {
    const html = receiptHtml(r, minimal, false, [], { layout });
    assert.ok(html.includes('₦18,000.00'));
    assert.ok(!html.includes('Wallet balance'));
    assert.ok(!html.includes('Joy (Cashier)'));
    assert.ok(!html.includes('B41E9D07'));
    assert.ok(!html.includes('Balance on these jobs'));
  }
  assert.ok(receiptHtml(r, brand({}), false, [], { layout: 'wide' }).includes('<th class="r">Balance</th>'));
  assert.ok(!receiptHtml(r, minimal, false, [], { layout: 'wide' }).includes('<th class="r">Paid now</th>'));
});

test('A payment that also clears older balances shows this sale first, then the earlier jobs', async () => {
  const { receiptModel } = await import('../src/receipts.mjs');
  const bal = (id, amount, before, now) => ({
    id,
    description: id,
    service: 'Bag',
    amount,
    paidBefore: before,
    paidThisCheckout: now,
    outstandingAfter: amount - before - now,
  });
  const record = {
    id: 'r',
    customerSnapshot: { name: 'A', phone: '1' },
    jobs: [{ id: 'new1' }, { id: 'new2' }],
    jobBalances: [
      bal('old', 4000000, 360000, 3640000),
      bal('new1', 13500000, 0, 13500000),
      bal('new2', 8000000, 0, 2860000),
    ],
    total: 21500000,
    cashReceived: 20000000,
    method: 'Cash',
    createdAt: '2026-10-15T00:57:00Z',
    paidOn: '2026-10-15',
    allocations: [],
    walletUsed: 0,
    walletAdded: 0,
  };
  assert.deepEqual(
    receiptModel(record, '').items.map((i) => [i.title, i.heading ?? '']),
    [
      ['new1', 'This sale'],
      ['new2', ''],
      ['old', 'Earlier balances paid with this payment'],
    ],
  );
  // Only new jobs: no headings at all.
  assert.ok(
    receiptModel({ ...record, jobBalances: record.jobBalances.slice(1) }, '').items.every((i) => !i.heading),
  );
});
