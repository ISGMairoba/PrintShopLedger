import test from 'node:test';
import assert from 'node:assert/strict';
import { vendorExpenseEvents } from '../src/team-vendor.mjs';
import { workEvents } from '../src/team.mjs';

const actor = { id: 'u', label: 'Ada', level: 2 };
const job = {
  id: 'abcdef12-0000-4000-8000-000000000001',
  service: 'Jotters',
  quantity: 200,
  productionStatus: 'Printing',
  workflow: ['Added', 'Design', 'Printing', 'Finishing', 'Completed', 'Collected'],
};
const ledger = { payees: [{ id: 'p1', name: 'Kano Prints' }] };

test('team vendor: its cost is an expense for the job, owed or paid; a new vendor is added to Payees', () => {
  const work = {
    unit: 'percent',
    shares: [{ personId: 'u', share: 60 }],
    doneAt: '2026-11-25T10:00:00Z',
    vendor: { name: 'New Binders', cost: 500000, share: 40 },
    vendorExpense: { payeeId: null, paidFrom: null },
  };
  const out = vendorExpenseEvents(ledger, job, 'Finishing', work, actor, '2026-11-25T10:00:00Z');
  assert.deepEqual(
    out.events.map((e) => e.kind),
    ['payee.created', 'expense.created'],
  );
  const expense = out.events[1].data;
  assert.deepEqual(expense.jobIds, [job.id]);
  assert.equal(expense.amount, 500000);
  assert.equal(expense.payment, undefined);
  assert.equal(out.work.vendor.expenseId, expense.id);
  assert.equal(out.work.vendor.payeeId, out.events[0].data.id);
  assert.equal(out.work.vendorExpense, undefined);
  // Paid now from an account; an existing payee is used.
  const paid = vendorExpenseEvents(
    ledger,
    job,
    'Finishing',
    {
      ...work,
      vendorExpense: {
        payeeId: 'p1',
        paidFrom: { kind: 'Transfer', label: 'Transfer', accountId: 'bank', source: 'Business bank account' },
      },
    },
    actor,
  );
  assert.deepEqual(
    paid.events.map((e) => e.kind),
    ['expense.created'],
  );
  assert.equal(paid.events[0].data.payment.accountId, 'bank');
});

test('team vendor: a move over several stages records the cost once', () => {
  const events = workEvents(
    job,
    'Completed',
    { unit: 'percent', shares: [], doneAt: '2026-11-25T10:00:00Z', vendor: { name: 'Kano Prints', cost: 9000 } },
    actor,
  );
  assert.deepEqual(
    events.map((e) => e.data.vendor.cost),
    [9000, 0],
  );
});
