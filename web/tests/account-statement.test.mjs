import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { accountBalance } from '../src/operations.mjs';
import { accountStatement, filterStatement } from '../src/account-statement.mjs';

const ledger = {
  ...emptyLedger(),
  moneyAccounts: [
    { id: 'bank', name: 'Bank', openingBalance: 10000, openingDate: '2026-11-01' },
    { id: 'cash', name: 'Cash', openingBalance: 0, openingDate: '2026-11-01' },
  ],
  payments: [
    { id: 'p0', amount: 700, method: 'Transfer', paidOn: '2026-10-30', accountId: 'bank' },
    { id: 'p1', amount: 5000, method: 'Transfer', paidOn: '2026-11-02', accountId: 'bank' },
    { id: 'p2', amount: 300, method: 'Cash', paidOn: '2026-11-02', accountId: 'cash' },
  ],
  expenses: [
    {
      id: 'e1',
      description: 'Ink',
      payments: [{ id: 'x1', amount: 2000, method: 'Transfer', paidOn: '2026-11-03', accountId: 'bank' }],
    },
  ],
  saleAdjustments: [
    { id: 'r1', action: 'sale.refunded', refundAmount: 500, paidOn: '2026-11-04', accountId: 'bank' },
  ],
  checkouts: [],
  payees: [{ id: 'moni', name: 'Moniepoint' }],
  accountEntries: [
    {
      id: 'l1',
      action: 'money',
      moneyType: 'loan_in',
      direction: 1,
      amount: 20000,
      lenderId: 'moni',
      accountId: 'bank',
      paidOn: '2026-11-02',
      reason: 'Printer loan',
    },
    {
      id: 'l2',
      action: 'money',
      moneyType: 'loan_repayment',
      direction: -1,
      amount: 4000,
      lenderId: 'moni',
      accountId: 'bank',
      paidOn: '2026-11-05',
      reason: 'First instalment',
    },
    {
      id: 't1',
      action: 'transfer',
      amount: 1000,
      accountId: 'bank',
      toAccountId: 'cash',
      paidOn: '2026-11-03',
    },
    // Counted 314.00 on 4 Nov when 315.00 was expected: bank charges.
    { id: 'c1', action: 'reconciliation', amount: -100, accountId: 'bank', paidOn: '2026-11-04' },
  ],
};
const names = { accountName: (id) => (id === 'cash' ? 'Cash' : 'Bank'), payeeName: () => 'Moniepoint' };

test('the statement lists every movement with its type and ends at the account balance', () => {
  const s = accountStatement(ledger, 'bank', { ...names, to: '2026-11-30' });
  assert.equal(s.closing, accountBalance(ledger, 'bank', '2026-11-30').balance);
  assert.equal(s.closing, 10000 + 5000 + 20000 - 2000 - 1000 - 100 - 500 - 4000);
  assert.deepEqual(
    s.rows.map((r) => r.type),
    ['sale', 'loan', 'sale', 'transfer', 'expense', 'refund', 'reconcile', 'repayment'],
  );
  // Before the opening date: listed, but the opening balance already covers it.
  assert.equal(s.rows[0].beforeOpening, true);
  assert.equal(s.rows[0].balance, 10000);
  assert.equal(s.rows.find((r) => r.type === 'loan').label, 'Loan received · Moniepoint');
  assert.equal(s.rows.find((r) => r.type === 'transfer').label, 'Transfer to Cash');
  // The reconciliation comes last in its day, so the balance there is what was counted.
  const recon = s.rows.find((r) => r.type === 'reconcile');
  assert.equal(recon.amountOut, 100);
  assert.equal(recon.balance, 31400);
  assert.equal(s.received, 25000);
  assert.equal(s.paid, 2000 + 1000 + 100 + 500 + 4000);
});

test('a period starts from the balance carried into it', () => {
  const s = accountStatement(ledger, 'bank', { ...names, from: '2026-11-04', to: '2026-11-04' });
  assert.equal(s.opening, 10000 + 5000 + 20000 - 2000 - 1000);
  assert.equal(s.closing, s.opening - 500 - 100);
  assert.deepEqual(
    s.rows.map((r) => r.type),
    ['refund', 'reconcile'],
  );
  const cash = accountStatement(ledger, 'cash', { ...names, to: '2026-11-30' });
  assert.equal(cash.closing, accountBalance(ledger, 'cash', '2026-11-30').balance);
  assert.equal(cash.rows.find((r) => r.type === 'transfer').label, 'Transfer from Bank');
});

test('rows can be filtered by type, direction and words, and sorted', () => {
  const { rows } = accountStatement(ledger, 'bank', { ...names, to: '2026-11-30' });
  assert.deepEqual(
    filterStatement(rows, { direction: 'in' }).map((r) => r.type),
    ['sale', 'loan', 'sale'],
  );
  assert.equal(filterStatement(rows, { type: 'repayment' }).length, 1);
  assert.equal(filterStatement(rows, { search: 'instalment' })[0].type, 'repayment');
  assert.equal(filterStatement(rows, { sort: 'amount-desc' })[0].type, 'loan');
  assert.equal(filterStatement(rows, { sort: 'date-desc' })[0].type, 'repayment');
});
