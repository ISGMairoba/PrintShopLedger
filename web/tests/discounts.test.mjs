import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOrderDiscount,
  discountKobo,
  discountPolicy,
  shareByWeight,
  validDiscount,
  validateDiscountSettings,
} from '../src/discounts.mjs';
import { applyCheckout } from '../src/checkout.mjs';
import { fixture, job, checkout } from './checkout.test.mjs';

test('percent and flat discounts, never more than the price', () => {
  assert.equal(discountKobo({ kind: 'percent', value: 10 }, 105000), 10500);
  assert.equal(discountKobo({ kind: 'percent', value: 12.5 }, 1001), 125);
  assert.equal(discountKobo({ kind: 'amount', value: 50000 }, 30000), 30000);
  assert.equal(discountKobo(null, 30000), 0);
  assert.equal(validDiscount({ kind: 'percent', value: 0 }), null);
  assert.deepEqual(validDiscount({ kind: 'amount', value: 500, reason: '  loyal ' }), {
    kind: 'amount',
    value: 500,
    reason: 'loyal',
  });
  assert.throws(() => validDiscount({ kind: 'percent', value: 101 }), /between 0 and 100/);
  assert.throws(() => validDiscount({ kind: 'amount', value: 1.5 }), /valid discount amount/);
  assert.throws(() => validDiscount({ kind: 'percent', value: 5, reason: 'x'.repeat(201) }), /200/);
});

test('an order discount is shared by price, to the kobo', () => {
  assert.deepEqual(shareByWeight(100000, [300000, 100000]), [75000, 25000]);
  assert.deepEqual(shareByWeight(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(shareByWeight(0, [5, 5]), [0, 0]);
  const jobs = [
    {
      id: 'a',
      grossAmount: 300000,
      lineDiscount: 30000,
      amount: 270000,
      discount: { kind: 'percent', value: 10 },
    },
    { id: 'b', grossAmount: 100000, lineDiscount: 0, amount: 100000 },
    { id: 'c', grossAmount: 50000, lineDiscount: 0, amount: 50000 },
  ];
  const r = applyOrderDiscount(jobs, { kind: 'amount', value: 42000 });
  assert.equal(r.orderTotal, 42000);
  assert.equal(
    r.jobs.reduce((n, j) => n + j.orderDiscountShare, 0),
    42000,
  );
  assert.deepEqual(
    r.jobs.map((j) => j.amount),
    [270000 - 27000, 100000 - 10000, 50000 - 5000],
  );
  assert.equal(r.discountTotal, 30000 + 42000);
  // Jobs without any discount carry no discount fields.
  const plain = applyOrderDiscount([{ id: 'x', grossAmount: 500, lineDiscount: 0, amount: 500 }], null);
  assert.deepEqual(plain.jobs[0], { id: 'x', amount: 500 });
});

test('rank limits: cashiers percent up to their cap; flat and order discounts need Admin', () => {
  const settings = validateDiscountSettings({ maxPercent: { 1: 5, 2: 20 } });
  const cashier = discountPolicy(settings, 1),
    admin = discountPolicy(settings, 2),
    developer = discountPolicy(settings, 4);
  assert.deepEqual(cashier, { maxPercent: 5, canFlat: false });
  assert.equal(developer.maxPercent, 100);
  const pct = (value) => ({
    id: 'a',
    grossAmount: 10000,
    lineDiscount: Math.round(100 * value),
    amount: 10000 - Math.round(100 * value),
    discount: { kind: 'percent', value },
  });
  assert.doesNotThrow(() => applyOrderDiscount([pct(5)], null, cashier));
  assert.throws(() => applyOrderDiscount([pct(6)], null, cashier), /limit is 5%/);
  const flat = {
    id: 'a',
    grossAmount: 10000,
    lineDiscount: 500,
    amount: 9500,
    discount: { kind: 'amount', value: 500 },
  };
  assert.throws(() => applyOrderDiscount([flat], null, cashier), /flat discount/);
  assert.doesNotThrow(() => applyOrderDiscount([flat], null, admin));
  const plain = { id: 'a', grossAmount: 10000, lineDiscount: 0, amount: 10000 };
  assert.throws(() => applyOrderDiscount([plain], { kind: 'percent', value: 5 }, cashier), /whole order/);
  assert.throws(() => applyOrderDiscount([plain], { kind: 'percent', value: 25 }, admin), /20%/);
  // By default cashiers cannot discount at all.
  assert.equal(discountPolicy(validateDiscountSettings({}), 1).maxPercent, 0);
  assert.throws(
    () => applyOrderDiscount([pct(1)], null, discountPolicy(validateDiscountSettings({}), 1)),
    /cannot give/,
  );
  assert.throws(() => validateDiscountSettings({ maxPercent: { 1: 120 } }), /0% and 100%/);
});

test('checkout with job and order discounts keeps exact balances and survives replay', () => {
  const ledger = fixture();
  const lines = [{ ...job(3), discount: { kind: 'percent', value: 10, reason: 'Regular customer' } }, job(1)];
  const event = checkout(ledger, lines, 0, { orderDiscount: { kind: 'amount', value: 2000 } });
  const [a, b] = event.data.jobs;
  // 3 × ₦100 = ₦300 less 10% = ₦270; ₦100; order ₦20 shared 270:100.
  assert.equal(a.grossAmount, 30000);
  assert.equal(a.lineDiscount, 3000);
  assert.equal(a.orderDiscountShare + b.orderDiscountShare, 2000);
  assert.equal(a.amount + b.amount, 30000 + 10000 - 3000 - 2000);
  assert.equal(event.data.total, a.amount + b.amount);
  assert.equal(event.data.discountTotal, 5000);
  assert.deepEqual(event.data.orderDiscount, { kind: 'amount', value: 2000 });
  const after = applyCheckout(ledger, event);
  assert.equal(after.jobs.find((j) => j.id === a.id).amount, a.amount);
  assert.equal(after.jobs.find((j) => j.id === a.id).discount.reason, 'Regular customer');
});

import { receiptModel } from '../src/receipts.mjs';
import { defaultBranding } from '../src/business-branding.mjs';
test('receipts show each discount and the total given', () => {
  const ledger = fixture();
  const event = checkout(ledger, [{ ...job(2), discount: { kind: 'percent', value: 10 } }], 18000);
  const record = { ...event.data, jobs: event.data.jobs };
  const m = receiptModel(record, { ...defaultBranding(), businessName: 'Shop' });
  assert.ok(m.items[0].meta.some((x) => /Price ₦200\.00 less discount ₦20\.00/.test(x)));
  assert.ok(m.totals.some((t) => t.label === 'Discounts given' && t.value === '−₦20.00'));
});
