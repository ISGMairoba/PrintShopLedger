import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger, customerBalance } from '../src/domain.mjs';
import {
  applyCheckout,
  checkoutParts,
  partsByMethod,
  partsLabel,
  prepareCheckout,
  splitPayments,
  validSplits,
  walletBalance,
} from '../src/checkout.mjs';
import { quickSaleInput } from '../src/quick-sale.mjs';
import { salesSummary } from '../src/my-sales.mjs';

const audit = { modifiedBy: 'u', modifiedByLabel: 'Ada', modifiedAt: '2026-11-16T09:00:00Z' };
const actor = { id: 'u', label: 'Ada' };
const shop = () => {
  let l = emptyLedger();
  for (const e of [
    {
      id: 'm1',
      kind: 'material.created',
      data: {
        id: 'pen',
        name: 'Pen',
        measurementUnit: 'piece',
        available: 100,
        requireSize: false,
        ...audit,
      },
    },
    {
      id: 's1',
      kind: 'service.created',
      data: { id: 'pen-s', description: 'Pen', materialId: 'pen', price: 500000, shelfItem: true, ...audit },
    },
    {
      id: 'c1',
      kind: 'customer.created',
      data: { id: 'bayo', name: 'Bayo', phone: '0802', address: '', creditLimit: 0, ...audit },
    },
  ])
    l = applyEvent(l, e);
  return l;
};
const base = (extra) => ({
  method: 'Cash',
  methodLabel: 'Cash',
  paidOn: '2026-11-16',
  source: 'In shop / USB',
  actor,
  now: '2026-11-16T09:00:00Z',
  ...extra,
});
const cash = (amount) => ({ method: 'Cash', methodLabel: 'Cash', amount });
const opay = (amount, id) => ({ id, method: 'Transfer', methodLabel: 'OPay', amount });

test('Split parts: 2–6 methods, each paid something, different, adding up to the money received', () => {
  assert.throws(() => validSplits([cash(100)], 100, 'k'), /2 to 6/);
  assert.throws(() => validSplits([cash(100), cash(50)], 150, 'k'), /twice/);
  assert.throws(() => validSplits([cash(100), opay(0)], 100, 'k'), /amount for each part/);
  assert.throws(() => validSplits([cash(100), opay(50)], 200, 'k'), /add up/);
  const parts = validSplits([cash(100), opay(50, 'x')], 150, 'k');
  assert.deepEqual(
    parts.map((p) => [p.id, p.methodLabel, p.amount]),
    [
      ['k', 'Cash', 100],
      ['x', 'OPay', 50],
    ],
  );
});

test('A split sale is one checkout and one payment per method; jobs are paid in order', () => {
  let ledger = shop();
  // Two pens (₦10,000): ₦3,000 cash + ₦7,000 OPay.
  const { input } = quickSaleInput(
    ledger,
    [{ serviceId: 'pen-s', quantity: 2 }],
    base({ customerId: 'bayo', tendered: 1000000, splits: [cash(300000), opay(700000, 'p2')] }),
  );
  const event = prepareCheckout(ledger, input, actor, 'sale-1', '2026-11-16T09:00:00Z');
  assert.equal(event.data.method, 'Cash');
  ledger = applyCheckout(ledger, event);
  const pays = ledger.payments.filter((p) => p.checkoutId === 'sale-1');
  assert.deepEqual(
    pays.map((p) => [p.id, p.methodLabel, p.amount, p.allocations.reduce((n, a) => n + a.amount, 0)]),
    [
      ['sale-1', 'Cash', 300000, 300000],
      ['p2', 'OPay', 700000, 700000],
    ],
  );
  assert.equal(ledger.checkouts.length, 1);
  assert.equal(customerBalance(ledger, 'bayo'), 0);
  const record = ledger.checkouts[0];
  assert.equal(partsByMethod(record, 'Cash'), 300000);
  assert.equal(partsByMethod(record, 'Transfer'), 700000);
  assert.equal(
    partsLabel(record, (n) => `₦${n / 100}`),
    'Cash ₦3000 · OPay ₦7000',
  );
  const summary = salesSummary([record]);
  assert.deepEqual([summary.cash, summary.transfer, summary.collected], [300000, 700000, 1000000]);
  // Replaying the same event changes nothing.
  assert.equal(applyCheckout(ledger, event), ledger);
});

test('Money a split part does not need is wallet credit on that part; wallet used rides on the first', () => {
  const data = {
    id: 'k',
    customerId: 'c',
    paidOn: '2026-11-16',
    reference: '',
    createdAt: 'now',
    walletUsed: 0,
    allocations: [
      { jobId: 'j1', amount: 400 },
      { jobId: 'j2', amount: 300 },
    ],
    splits: [
      { id: 'k', method: 'Cash', methodLabel: 'Cash', amount: 500 },
      { id: 'x', method: 'POS', methodLabel: 'POS', amount: 500 },
    ],
  };
  const [first, second] = splitPayments(data);
  assert.deepEqual(first.allocations, [
    { jobId: 'j1', amount: 400 },
    { jobId: 'j2', amount: 100 },
  ]);
  assert.deepEqual(second.allocations, [{ jobId: 'j2', amount: 200 }]);
  assert.deepEqual([first.walletAdded, second.walletAdded], [0, 300]);
  const withWallet = splitPayments({
    ...data,
    walletUsed: 200,
    allocations: [{ jobId: 'j1', amount: 1200 }],
  });
  assert.deepEqual(
    withWallet.map((p) => [p.walletUsed, p.walletAdded, p.allocations[0].amount]),
    [
      [200, 0, 700],
      [0, 0, 500],
    ],
  );
});

test('Walk-in split: change comes out of the cash part', () => {
  let ledger = shop();
  const { input, change } = quickSaleInput(
    ledger,
    [{ serviceId: 'pen-s', quantity: 1 }],
    base({ customerId: null, tendered: 600000, splits: [cash(300000), opay(300000)] }),
  );
  assert.equal(change, 100000);
  assert.deepEqual(
    input.splits.map((s) => s.amount),
    [200000, 300000],
  );
  ledger = applyCheckout(ledger, prepareCheckout(ledger, input, actor, 'w1', '2026-11-16T09:00:00Z'));
  assert.equal(walletBalance(ledger, input.customerId), 0);
  assert.throws(
    () =>
      quickSaleInput(
        shop(),
        [{ serviceId: 'pen-s', quantity: 1 }],
        base({
          customerId: null,
          tendered: 600000,
          splits: [{ ...opay(300000), methodLabel: 'POS', method: 'POS' }, opay(300000)],
        }),
      ),
    /change comes from cash/,
  );
});

test('An ordinary checkout has one part', () => {
  assert.deepEqual(checkoutParts({ id: 'k', cashReceived: 500, method: 'POS', methodLabel: 'Moniepoint' }), [
    { id: 'k', method: 'POS', methodLabel: 'Moniepoint', amount: 500 },
  ]);
  assert.deepEqual(checkoutParts({ id: 'k', cashReceived: 0, method: 'Cash' }), []);
});

test('A split sale is corrected as one: only the parts that change, one after another', async () => {
  const { splitCorrectionEvents } = await import('../src/payment-correction.mjs');
  const { applySaleAdjustment } = await import('../src/sale-adjustments.mjs');
  let ledger = shop();
  const { input } = quickSaleInput(
    ledger,
    [{ serviceId: 'pen-s', quantity: 2 }],
    base({ customerId: 'bayo', tendered: 1000000, splits: [cash(300000), opay(700000, 'p2')] }),
  );
  ledger = applyCheckout(ledger, prepareCheckout(ledger, input, actor, 'sale-1', '2026-11-16T09:00:00Z'));
  const shared = { paidOn: '2026-11-16', reference: '', reason: 'Wrong method' };
  // The second part was POS, not OPay: one correction.
  const one = splitCorrectionEvents(
    ledger,
    [
      { paymentId: 'sale-1', amount: 300000, method: 'Cash', methodLabel: 'Cash' },
      { paymentId: 'p2', amount: 700000, method: 'POS', methodLabel: 'POS' },
    ],
    shared,
    actor,
  );
  assert.equal(one.events.length, 1);
  assert.equal(one.after.payments.find((p) => p.id === 'p2').methodLabel, 'POS');
  // ₦1,000 less cash and ₦1,000 more on POS: two corrections that apply in order.
  const two = splitCorrectionEvents(
    ledger,
    [
      { paymentId: 'sale-1', amount: 200000, method: 'Cash', methodLabel: 'Cash' },
      { paymentId: 'p2', amount: 800000, method: 'POS', methodLabel: 'POS' },
    ],
    shared,
    actor,
  );
  assert.equal(two.events.length, 2);
  let replay = ledger;
  for (const e of two.events) replay = applySaleAdjustment(replay, e);
  assert.deepEqual(
    replay.payments.filter((p) => p.checkoutId === 'sale-1').map((p) => [p.amount, p.methodLabel]),
    [
      [200000, 'Cash'],
      [800000, 'POS'],
    ],
  );
  assert.equal(customerBalance(replay, 'bayo'), 0);
  assert.throws(
    () =>
      splitCorrectionEvents(
        ledger,
        [{ paymentId: 'sale-1', amount: 300000, method: 'Cash', methodLabel: 'Cash' }],
        shared,
        actor,
      ),
    /Nothing changed/,
  );
});

test('A split sale is refunded by its methods, cash first, each up to what it paid', async () => {
  const { refundMethods, cashFirst } = await import('../src/sale-adjustments.mjs');
  const ledger = {
    payments: [
      { method: 'Cash', methodLabel: 'Cash', allocations: [{ jobId: 'j1', amount: 500000 }] },
      { method: 'Transfer', methodLabel: 'OPay', allocations: [{ jobId: 'j1', amount: 2000000 }] },
      { method: 'Cash', methodLabel: 'Cash', allocations: [{ jobId: 'j2', amount: 100000 }] },
    ],
  };
  const paid = refundMethods(ledger, 'j1', [{ label: 'OPay', kind: 'Transfer' }]);
  assert.deepEqual(
    paid.map((m) => [m.label, m.paid]),
    [
      ['Cash', 500000],
      ['OPay', 2000000],
    ],
  );
  assert.deepEqual(
    cashFirst(paid, 700000).map((m) => m.amount),
    [500000, 200000],
  );
  assert.deepEqual(
    cashFirst(paid, 300000).map((m) => m.amount),
    [300000, 0],
  );
});
