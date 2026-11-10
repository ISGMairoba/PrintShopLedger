import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { accountBalance, applyOperation, defaultMoneyAccount, operationEvent } from '../src/operations.mjs';
import { accountPaymentOptions } from '../src/account-methods.mjs';

const actor = { id: 'u', label: 'Owner' };
const ev = (kind, data) => operationEvent(kind, data, actor, '2026-11-10T10:00:00Z');
const account = (id, methods) =>
  ev('account.created', { id, name: id, accountType: 'bank', openingBalance: 0, openingDate: '2026-11-01', methods });

test('hidden accounts: no payments reach them, transfers still do, unhiding brings them back', () => {
  let l = emptyLedger();
  l = applyOperation(l, account('Cash', ['Cash']));
  l = applyOperation(l, account('Savings', ['Transfer']));
  assert.equal(defaultMoneyAccount(l, 'Transfer'), 'Savings');
  const savings = () => l.moneyAccounts.find((a) => a.id === 'Savings');
  l = applyOperation(l, ev('account.visibility_changed', { id: 'Savings', baseVersion: savings().version, hidden: true }));
  assert.equal(savings().hidden, true);
  assert.deepEqual(savings().methods, [], 'its payment-method links are removed');
  assert.equal(defaultMoneyAccount(l, 'Transfer'), '');
  assert.ok(accountPaymentOptions(l, []).every((o) => o.accountId !== 'Savings'));
  l = applyOperation(
    l,
    ev('account.transferred', {
      id: 't1',
      accountId: 'Cash',
      toAccountId: 'Savings',
      amount: 50000,
      paidOn: '2026-11-05',
      reason: 'Saving',
    }),
  );
  assert.equal(accountBalance(l, 'Savings').balance, 50000);
  assert.throws(
    () => applyOperation(l, ev('account.visibility_changed', { id: 'Savings', baseVersion: 1, hidden: false })),
    /changed elsewhere/,
  );
  l = applyOperation(l, ev('account.visibility_changed', { id: 'Savings', baseVersion: savings().version, hidden: false }));
  assert.equal(savings().hidden, false);
});
