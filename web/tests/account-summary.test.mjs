import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { accountSummary } from '../src/account-summary.mjs';

const ledger = () => ({
  ...emptyLedger(),
  moneyAccounts: [
    {
      id: 'till',
      name: 'Till',
      accountType: 'cash',
      openingBalance: 5000,
      openingDate: '2026-10-01',
      methods: ['Cash'],
    },
    {
      id: 'bank',
      name: 'Bank',
      accountType: 'bank',
      openingBalance: 100000,
      openingDate: '2026-10-01',
      methods: ['Transfer'],
    },
  ],
  payments: [
    { id: 'p1', amount: 20000, paidOn: '2026-11-03T10:00:00Z', method: 'Cash', accountId: 'till' },
    { id: 'p2', amount: 7000, paidOn: '2026-10-20T10:00:00Z', method: 'Transfer', accountId: 'bank' },
    { id: 'p3', amount: 1500, paidOn: '2026-11-04T10:00:00Z', method: 'POS' },
  ],
  expenses: [
    {
      id: 'e',
      description: 'Paper',
      payments: [{ id: 'x', amount: 3000, paidOn: '2026-11-05T10:00:00Z', accountId: 'bank' }],
    },
  ],
  accountEntries: [
    {
      id: 't',
      action: 'transfer',
      accountId: 'till',
      toAccountId: 'bank',
      amount: 10000,
      paidOn: '2026-11-06',
    },
    { id: 'r', action: 'reconciliation', accountId: 'till', amount: -500, paidOn: '2026-11-07' },
  ],
});

test('accounts summary: balance now, this month in and out, reconciliation and unassigned money', () => {
  const l = ledger();
  const s = accountSummary(l, l.moneyAccounts, '2026-11-08');
  assert.equal(s.total, 5000 + 20000 - 10000 - 500 + 100000 + 7000 - 3000 + 10000);
  assert.equal(s.cash, 14500);
  assert.equal(s.moneyIn, 20000); // October's payment and the transfer are left out
  assert.equal(s.moneyOut, 3000);
  assert.equal(s.lastReconciled, '2026-11-07');
  assert.equal(s.differenceMonth, -500);
  assert.equal(s.neverReconciled, 1);
  assert.equal(s.unassignedCount, 1);
  assert.equal(s.unassignedNet, 1500);
  // Accounts this person cannot see in full are left out of the total.
  assert.equal(accountSummary(l, [l.moneyAccounts[1]], '2026-11-08').total, 114000);
});
