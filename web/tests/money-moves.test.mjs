import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyOperation, operationEvent, accountBalance } from '../src/operations.mjs';
import { lenderBalances, moneyMoveTotals } from '../src/money-moves.mjs';
import { accountSummary } from '../src/account-summary.mjs';
import { profitReport } from '../src/profit.mjs';
import { summaryReport } from '../src/reports.mjs';

const actor = { id: 'u', label: 'Owner' };
const ev = (kind, data) => operationEvent(kind, data, actor, '2026-11-08T10:00:00Z');
const base = () => {
  let l = emptyLedger();
  l = applyOperation(
    l,
    ev('account.created', {
      id: 'bank',
      name: 'Bank',
      accountType: 'bank',
      openingBalance: 0,
      openingDate: '2026-11-01',
      methods: [],
    }),
  );
  l = applyOperation(
    l,
    ev('payee.created', { id: 'lender', name: 'Moniepoint', phone: '', address: '', note: 'Lender' }),
  );
  return l;
};
const move = (l, id, moneyType, amount, extra = {}) =>
  applyOperation(
    l,
    ev('account.money_moved', {
      id,
      accountId: 'bank',
      paidOn: '2026-11-05',
      reason: 'Note',
      moneyType,
      amount,
      ...extra,
    }),
  );

test('money in and out: loans owed until repaid, owner money and other income move the balance', () => {
  let l = base();
  l = move(l, 'm1', 'loan_in', 500000, { lenderId: 'lender' });
  l = move(l, 'm2', 'owner_in', 100000);
  l = move(l, 'm3', 'other_income', 20000);
  l = move(l, 'm4', 'loan_repayment', 200000, { lenderId: 'lender' });
  l = move(l, 'm5', 'owner_out', 50000);
  assert.equal(accountBalance(l, 'bank', '2026-11-08').balance, 500000 + 100000 + 20000 - 200000 - 50000);
  assert.deepEqual(lenderBalances(l), { lender: 300000 });
  assert.throws(
    () => move(l, 'm6', 'loan_repayment', 400000, { lenderId: 'lender' }),
    /more than is still owed/,
  );
  assert.throws(() => move(l, 'm7', 'loan_in', 1000), /lender/);
  assert.throws(() => move(l, 'm8', 'salary', 1000), /what kind/);
  assert.deepEqual(moneyMoveTotals(l, '2026-11-01', '2026-11-30'), {
    loan_in: 500000,
    loan_repayment: 200000,
    owner_in: 100000,
    owner_out: 50000,
    other_income: 20000,
  });
  const s = accountSummary(l, l.moneyAccounts, '2026-11-08');
  assert.equal(s.moneyIn, 620000);
  assert.equal(s.moneyOut, 250000);
  assert.equal(s.owedToLenders, 300000);
  assert.equal(profitReport(l, '2026-11-01', '2026-11-30').totals.otherIncome, 20000);
  const rows = summaryReport(l, '2026-11-01', '2026-11-30').figures.map((f) => [f.key, f.value]);
  assert.deepEqual(
    rows.filter(([k]) => ['other_income', 'loan_in', 'owner_out'].includes(k)),
    [
      ['other_income', 20000],
      ['loan_in', 500000],
      ['owner_out', 50000],
    ],
  );
});
