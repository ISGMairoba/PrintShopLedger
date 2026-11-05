import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { makeExpenseEvent, expensePaid, fromLagosLocal, lagosLocal } from '../src/expenses.mjs';
const actor = { id: 'staff', label: 'Staff' };
const event = (kind, d, existing) => makeExpenseEvent(kind, d, existing, actor, randomUUID);
const base = {
  description: 'Fuel',
  category: 'Fuel',
  incurredOn: '2026-11-05',
  incurredAt: '2026-11-05T08:30:00.000Z',
  amount: 1000000,
  payee: '',
  note: '',
  receiptReference: '',
  materials: [],
};
const pay = (patch = {}) => ({
  id: randomUUID(),
  amount: 400000,
  paidOn: '2026-11-05',
  paidAt: '2026-11-05T09:00:00.000Z',
  method: 'Cash',
  methodLabel: 'Cash',
  source: 'Business cash',
  reference: '',
  ...patch,
});

test('an expense and its payment keep the time they happened', () => {
  const l = applyEvent(emptyLedger(), event('expense.created', { ...base, payment: pay() }));
  assert.equal(l.expenses[0].incurredAt, '2026-11-05T08:30:00.000Z');
  assert.equal(l.expenses[0].payments[0].paidAt, '2026-11-05T09:00:00.000Z');
  // 23:30 on the 5th in Lagos is 22:30 UTC: still the 5th.
  assert.equal(lagosLocal('2026-11-05T22:30:00.000Z'), '2026-11-05T23:30');
  assert.equal(fromLagosLocal('2026-11-05T23:30'), '2026-11-05T22:30:00.000Z');
  assert.throws(
    () => applyEvent(emptyLedger(), event('expense.created', { ...base, incurredAt: '2026-11-06T08:00:00.000Z' })),
    /must be on the chosen day/,
  );
});

test('a payment can be corrected or removed, with the reason kept', () => {
  const first = pay();
  let l = applyEvent(emptyLedger(), event('expense.created', { ...base, payment: first }));
  const fixed = { ...first, amount: 500000, method: 'Transfer', methodLabel: 'Transfer', source: 'Business bank account' };
  l = applyEvent(
    l,
    event('expense.payment_corrected', { paymentId: first.id, payment: fixed, reason: 'Paid by transfer' }, l.expenses[0]),
  );
  const p = l.expenses[0].payments[0];
  assert.equal(p.amount, 500000);
  assert.equal(p.method, 'Transfer');
  assert.equal(p.createdByLabel, 'Staff');
  assert.equal(p.corrections[0].reason, 'Paid by transfer');
  assert.equal(p.corrections[0].before.amount, 400000);
  assert.throws(
    () =>
      applyEvent(
        l,
        event(
          'expense.payment_corrected',
          { paymentId: first.id, payment: { ...fixed, amount: 2000000 }, reason: 'x' },
          l.expenses[0],
        ),
      ),
    /cannot exceed/,
  );
  assert.throws(
    () => applyEvent(l, event('expense.payment_corrected', { paymentId: first.id, payment: fixed, reason: ' ' }, l.expenses[0])),
    /Reason/,
  );
  l = applyEvent(l, event('expense.payment_corrected', { paymentId: first.id, remove: true, reason: 'Entered twice' }, l.expenses[0]));
  assert.equal(expensePaid(l.expenses[0]), 0);
  assert.equal(l.expenses[0].removedPayments[0].corrections.at(-1).reason, 'Entered twice');
  assert.equal(l.expenseHistory.at(-1).action, 'expense.payment_corrected');
});
