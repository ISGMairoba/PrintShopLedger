import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actor, id } from './pricing-fixture.mjs';
import { applyCheckout, prepareCheckout, walletBalance } from '../src/checkout.mjs';
import { customerBalance, jobBalance } from '../src/domain.mjs';
import { newTemplate, priceTemplate, validateTemplate } from '../src/pricing-templates.mjs';

// These amounts mirror docs/manual/cashier-quick-start.md. No live records are used.
const trainingLedger = () => {
  const { ledger } = fixture();
  ledger.customers[0].name = 'Training Customer A';
  ledger.services[3] = {
    ...ledger.services[3],
    description: 'DI printing — customer-supplied sheets',
    private: false,
    price: 5000, // ₦50, stored as kobo.
  };
  return ledger;
};
const newJob = () => ({
  id: id(501),
  serviceId: id(8),
  description: 'Training order — 100 customer-supplied sheets',
  quantity: 100,
  source: 'In shop / USB',
  sourceNote: '',
});
const transaction = (ledger, lines, cashReceived, eventId) =>
  prepareCheckout(
    ledger,
    {
      customerId: id(2),
      lines,
      cashReceived,
      useWallet: false,
      method: 'Cash',
      paidOn: '2026-10-15',
      reference: '',
    },
    actor,
    eventId,
    '2026-10-15T08:00:00Z',
  );

test('manual: ₦5,000 job, ₦3,000 part-payment, ₦2,000 later payment, no shop stock use', () => {
  const before = trainingLedger();
  const sale = transaction(before, [newJob()], 300000, id(502));
  const after = applyCheckout(before, sale);
  assert.equal(after.jobs[0].amount, 500000);
  assert.equal(jobBalance(after, after.jobs[0]).outstanding, 200000);
  assert.equal(customerBalance(after, id(2)), 200000);
  assert.equal(walletBalance(after, id(2)), 0);
  assert.deepEqual(after.materials, before.materials);
  assert.equal(after.materialHistory.length, 0);
  const payment = transaction(after, [], 200000, id(503));
  const paid = applyCheckout(after, payment);
  assert.equal(paid.jobs.length, 1);
  assert.equal(jobBalance(paid, paid.jobs[0]).outstanding, 0);
  assert.equal(customerBalance(paid, id(2)), 0);
  assert.equal(walletBalance(paid, id(2)), 0);
  assert.deepEqual(paid.materials, before.materials);
});

test('manual: ₦6,000 received for ₦5,000 with no other debt adds ₦1,000 wallet credit', () => {
  const before = trainingLedger();
  const after = applyCheckout(before, transaction(before, [newJob()], 600000, id(504)));
  assert.equal(jobBalance(after, after.jobs[0]).outstanding, 0);
  assert.equal(customerBalance(after, id(2)), 0);
  assert.equal(walletBalance(after, id(2)), 100000);
});

test('manual glossary: 20% markup gives ₦1,200; 20% margin gives ₦1,250 on ₦1,000 cost', () => {
  for (const [method, expected] of [
    ['markup', 120000],
    ['margin', 125000],
  ]) {
    const t = validateTemplate({
      ...newTemplate(),
      name: 'Glossary example',
      computed: [],
      expenses: [{ key: 'training_cost', label: 'Training cost', formula: '1000' }],
      pricing: { method, rate: 20, floor: 0, maxDiscount: 0, rounding: 0.01 },
    });
    assert.equal(priceTemplate(trainingLedger(), t, {}, 1).price.amount, expected);
  }
});
