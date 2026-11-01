import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareAccountMethods, routingLabels, resolveAccountPayment } from '../src/account-methods.mjs';
const id = '00000000-0000-4000-8000-000000000001',
  other = '00000000-0000-4000-8000-000000000002';
test('adding a card method retains offline labels and forbids deleting saved history', () => {
  const paymentMethods = prepareAccountMethods('Bank', [
    { id, name: 'Transfer', kind: 'Transfer', enabled: true },
  ]);
  const account = { id: 'a', name: 'Bank', paymentMethods };
  const next = prepareAccountMethods(
    'Bank',
    [...paymentMethods, { id: other, name: 'Card', kind: 'POS', enabled: true }],
    account,
  );
  assert.equal(next[0].label, 'Bank — Transfer');
  assert.deepEqual(next[0].aliases, ['Bank']);
  assert.ok(routingLabels(next).includes('Bank'));
  assert.throws(() => prepareAccountMethods('Bank', [next[1]], { ...account, paymentMethods: next }));
});
test('account routing rejects wrong account, type and disabled methods', () => {
  const paymentMethods = prepareAccountMethods('Bank', [
    { id, name: 'Transfer', kind: 'Transfer', enabled: true },
  ]);
  const a = { id: 'a', name: 'Bank', branch: 'main', methods: routingLabels(paymentMethods), paymentMethods };
  const ledger = { moneyAccounts: [a], activeBranch: 'main' };
  assert.equal(resolveAccountPayment(ledger, 'Bank', 'Transfer', 'a'), 'a');
  assert.throws(() => resolveAccountPayment(ledger, 'Bank', 'POS', 'a'));
  assert.throws(() => resolveAccountPayment(ledger, 'Bank', 'Transfer', 'b'));
  a.paymentMethods[0].enabled = false;
  assert.throws(() => resolveAccountPayment(l