import test from 'node:test';
import assert from 'node:assert/strict';
import { myTransactions, salesSummary, drawerSnapshot, saleDay } from '../src/my-sales.mjs';
import { normalizeLedger } from '../src/materials.mjs';
const record = (id, createdBy, method, cashReceived, extra = {}) => ({
  id,
  createdBy,
  method,
  cashReceived,
  total: 10000,
  walletUsed: 0,
  customerId: 'customer',
  ...extra,
});
test('My Sales isolates the logged-in user, including managers', () => {
  const ledger = { checkouts: [record('a', 'manager', 'Cash', 7000), record('b', 'cashier', 'Cash', 5000)] };
  assert.deepEqual(
    myTransactions(ledger, 'manager').map((r) => r.id),
    ['a'],
  );
});
test('cash means actual money received, including deposits, and excludes wallet, POS and transfer', () => {
  const summary = salesSummary([
    record('a', 'u', 'Cash', 7000),
    record('b', 'u', 'Cash', 12000),
    record('c', 'u', 'POS', 3000),
    record('d', 'u', 'Transfer', 5000, { customerId: 'other' }),
    record('e', 'u', 'Cash', 0, { walletUsed: 2000, total: 0 }),
  ]);
  assert.equal(summary.cash, 19000);
  assert.equal(summary.collected, 27000);
  assert.equal(summary.pos, 3000);
  assert.equal(summary.transfer, 5000);
  assert.equal(summary.walletUsed, 2000);
  assert.equal(summary.customers.length, 2);
});
test('drawer includes overnight transactions and incoming counted cash, excluding previously closed receipts', () => {
  const ledger = {
    checkouts: [
      record('a', 'u', 'Cash', 7000, { createdAt: '2026-10-05T12:00:00Z' }),
      record('b', 'u', 'POS', 3000),
      record('closed', 'u', 'Cash', 5000, { drawerClosingId: 'old' }),
      record('other', 'v', 'Cash', 9000),
    ],
    drawerClosings: [
      {
        id: 'old',
        fromUserId: 'u',
        toUserId: 'v',
        closedAt: '2026-10-05T12:00:00Z',
        countedCash: 5000,
        checkoutIds: ['closed'],
      },
      {
        id: 'incoming',
        fromUserId: 'v',
        toUserId: 'u',
        closedAt: '2026-10-06T12:00:00Z',
        countedCash: 7500,
        checkoutIds: ['previous'],
      },
    ],
  };
  const s = drawerSnapshot(ledger, 'u');
  assert.deepEqual(s.checkoutIds, ['a', 'b']);
  assert.equal(s.openingId, 'incoming');
  assert.equal(s.expectedCash, 14500);
  ledger.drawerClosings.push({
    id: 'last',
    fromUserId: 'u',
    toUserId: 'v',
    closedAt: '2026-10-06T13:00:00Z',
    countedCash: 14500,
    checkoutIds: ['a', 'b'],
  });
  assert.equal(drawerSnapshot(ledger, 'u').openingCash, 0);
  assert.deepEqual(drawerSnapshot(ledger, 'u').checkoutIds, []);
});
test('older local ledgers gain an empty drawer history and dates follow the business timezone', () => {
  assert.deepEqual(normalizeLedger({ customers: [] }).drawerClosings, []);
  assert.equal(saleDay('2026-10-05T23:30:00Z'), '2026-10-06');
});
