import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, customerBalance, emptyLedger, jobBalance, money } from '../src/domain.mjs';

function fixture() {
  let ledger = emptyLedger();
  for (const id of ['c1', 'c2']) ledger = applyEvent(ledger, { id: `e-${id}`, kind: 'customer.created', data: { id, name: id } });
  for (const [id, customerId, amount] of [['banner', 'c1', 2000000], ['cards', 'c1', 1000000], ['other', 'c2', 500000]]) {
    ledger = applyEvent(ledger, { id: `e-${id}`, kind: 'job.created', data: { id, customerId, amount, service: id, description: id } });
  }
  return ledger;
}
const payment = (allocations, amount, extra = {}) => ({ id: 'event-payment', kind: 'payment.recorded', data: {
  id: 'payment-1', customerId: 'c1', amount, method: 'Cash', paidOn: '2026-10-03', allocations, ...extra
} });

test('amounts convert to integer kobo without floating point drift', () => {
  assert.equal(money('0.29'), 29); assert.equal(money('20000'), 2000000); assert.equal(money('12.50'), 1250);
  for (const invalid of ['-1', '1.001', '', 'NaN', '1e6', '1000000001']) assert.throws(() => money(invalid));
});
test('payment reduces only its allocated job balance', () => {
  const ledger = applyEvent(fixture(), payment([{ jobId: 'banner', amount: 1500000 }], 1500000));
  assert.equal(jobBalance(ledger, ledger.jobs[0]).outstanding, 500000);
  assert.equal(jobBalance(ledger, ledger.jobs[1]).outstanding, 1000000);
  assert.equal(customerBalance(ledger, 'c1'), 1500000);
  assert.equal(customerBalance(ledger, 'c2'), 500000);
});
test('one payment can cover multiple jobs with explicit allocations', () => {
  const ledger = applyEvent(fixture(), payment([{ jobId: 'banner', amount: 2000000 }, { jobId: 'cards', amount: 500000 }], 2500000));
  assert.equal(jobBalance(ledger, ledger.jobs[0]).status, 'Fully paid');
  assert.equal(jobBalance(ledger, ledger.jobs[1]).status, 'Partially paid');
});
test('rejects overpayment, foreign customers, duplicate jobs, missing allocations and totals that do not match', () => {
  const ledger = fixture();
  for (const operation of [
    payment([{ jobId: 'banner', amount: 2000001 }], 2000001),
    payment([{ jobId: 'other', amount: 100 }], 100),
    payment([{ jobId: 'missing', amount: 100 }], 100),
    payment([{ jobId: 'banner', amount: 100 }, { jobId: 'banner', amount: 100 }], 200),
    payment([{ jobId: 'banner', amount: 100 }], 200), payment([], 100),
    payment([{ jobId: 'banner', amount: 0 }], 100),
    payment([{ jobId: 'banner', amount: 100 }], 100, { method: 'Unknown' })
  ]) assert.throws(() => applyEvent(ledger, operation));
  assert.equal(ledger.payments.length, 0);
});
test('replaying a successful payment never duplicates it', () => {
  const operation = payment([{ jobId: 'banner', amount: 100 }], 100);
  const once = applyEvent(fixture(), operation);
  assert.equal(applyEvent(once, operation).payments.length, 1);
  assert.throws(() => applyEvent(once, { ...operation, data: { ...operation.data, method: 'Transfer' } }));
});
test('invalid calendar dates are rejected', () => {
  assert.throws(() => applyEvent(fixture(), payment([{ jobId: 'banner', amount: 100 }], 100, { paidOn: '2026-02-31' })));
});
test('a later payment pays off only the selected job', () => {
  const first = applyEvent(fixture(), payment([{ jobId: 'banner', amount: 1500000 }], 1500000));
  const second = applyEvent(first, { ...payment([{ jobId: 'banner', amount: 500000 }], 500000), id: 'second-event',
    data: { ...payment([{ jobId: 'banner', amount: 500000 }], 500000).data, id: 'second-payment' } });
  assert.equal(jobBalance(second, second.jobs[0]).status, 'Fully paid');
  assert.equal(jobBalance(second, second.jobs[1]).status, 'Unpaid');
});
