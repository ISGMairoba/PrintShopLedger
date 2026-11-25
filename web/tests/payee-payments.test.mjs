import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyOperation, operationEvent, accountBalance, moneyTransactions } from '../src/operations.mjs';
import { applyExpenseEvent, makeExpenseEvent } from '../src/expenses.mjs';
import { payeeAdvances, ADVANCE_SOURCE } from '../src/money-moves.mjs';
import { payeePaymentEvents, spreadPayment, unpaidExpenses } from '../src/payee-payments.mjs';

const actor = { id: 'u', label: 'Owner' };
const op = (l, kind, data) => applyOperation(l, operationEvent(kind, data, actor, '2026-11-20T10:00:00Z'));
const expense = (l, id, amount, on, payment) =>
  applyExpenseEvent(
    l,
    makeExpenseEvent(
      'expense.created',
      {
        id,
        description: `Bill ${id}`,
        category: 'Supplies',
        incurredOn: on,
        incurredAt: `${on}T09:00:00Z`,
        amount,
        payeeId: 'sup',
        payee: 'Supplier',
        note: '',
        receiptReference: '',
        jobIds: [],
        restockIds: [],
        covers: null,
        materials: [],
        ...(payment ? { payment } : {}),
      },
      null,
      actor,
    ),
  );
function base() {
  let l = emptyLedger();
  l = op(l, 'account.created', {
    id: 'bank',
    name: 'Bank',
    accountType: 'bank',
    openingBalance: 0,
    openingDate: '2026-11-01',
    methods: [],
  });
  l = op(l, 'payee.created', { id: 'sup', name: 'Supplier', phone: '', address: '', note: '' });
  l = expense(l, 'b2', 300000, '2026-11-12');
  l = expense(l, 'b1', 500000, '2026-11-10');
  return l;
}
const pay = (l, amount, extra = {}) => {
  const { shares } = spreadPayment(l, 'sup', amount);
  const out = payeePaymentEvents(
    l,
    {
      payeeId: 'sup',
      amount,
      shares,
      paidOn: '2026-11-20',
      paidAt: '2026-11-20T10:00:00Z',
      method: 'Transfer',
      methodLabel: 'Transfer',
      accountId: 'bank',
      source: 'Business bank account',
      reference: '',
      keepRest: true,
      ...extra,
    },
    actor,
    '2026-11-20T10:00:00Z',
  );
  for (const e of out.expenseEvents) l = applyExpenseEvent(l, e);
  if (out.advanceEvent) l = applyOperation(l, out.advanceEvent);
  return l;
};

test('payee payments: one amount spread oldest first, the rest kept as an advance', () => {
  let l = base();
  assert.deepEqual(
    unpaidExpenses(l, 'sup').map((u) => u.expense.id),
    ['b1', 'b2'],
  );
  assert.deepEqual(spreadPayment(l, 'sup', 600000), { shares: { b1: 500000, b2: 100000 }, rest: 0 });
  assert.throws(() => pay(l, 1000000, { keepRest: false }), /keep the rest as an advance/);
  l = pay(l, 1000000);
  assert.equal(unpaidExpenses(l, 'sup').length, 0);
  assert.equal(payeeAdvances(l).sup, 200000);
  assert.equal(accountBalance(l, 'bank', '2026-11-30').balance, -1000000);
  const refs = new Set(l.expenses.flatMap((e) => e.payments.map((p) => p.reference)));
  assert.equal(refs.size, 1);
});

test('payee payments: an expense paid from the advance moves no account; the advance cannot go below zero', () => {
  let l = pay(base(), 1000000);
  const fromAdvance = (amount) => ({
    id: crypto.randomUUID(),
    amount,
    paidOn: '2026-11-21',
    paidAt: '2026-11-21T10:00:00Z',
    method: 'Other',
    methodLabel: 'Advance',
    source: ADVANCE_SOURCE,
    reference: '',
  });
  assert.throws(() => expense(l, 'b3', 300000, '2026-11-21', fromAdvance(300000)), /more than the advance/);
  l = expense(l, 'b3', 150000, '2026-11-21', fromAdvance(150000));
  assert.equal(payeeAdvances(l).sup, 50000);
  assert.equal(accountBalance(l, 'bank', '2026-11-30').balance, -1000000);
  assert.ok(!moneyTransactions(l).some((t) => t.source?.source === ADVANCE_SOURCE));
  assert.throws(
    () =>
      op(l, 'account.money_moved', {
        id: 'ret',
        accountId: 'bank',
        paidOn: '2026-11-22',
        reason: 'Back',
        moneyType: 'advance_returned',
        amount: 60000,
        payeeId: 'sup',
      }),
    /more than the advance/,
  );
  l = op(l, 'account.money_moved', {
    id: 'ret',
    accountId: 'bank',
    paidOn: '2026-11-22',
    reason: 'Back',
    moneyType: 'advance_returned',
    amount: 50000,
    payeeId: 'sup',
  });
  assert.equal(payeeAdvances(l).sup, undefined);
  assert.equal(accountBalance(l, 'bank', '2026-11-30').balance, -950000);
  // Cancelling the advance once it is used is refused.
  const adv = l.accountEntries.find((e) => e.moneyType === 'payee_advance');
  assert.throws(
    () =>
      op(l, 'account.entry_corrected', {
        id: adv.id,
        baseVersion: adv.version ?? 1,
        cancel: true,
        correctionReason: 'Mistake',
      }),
    /advance already used/,
  );
});
