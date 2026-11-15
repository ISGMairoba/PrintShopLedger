import test from 'node:test';
import assert from 'node:assert/strict';
import { customerSummary } from '../src/customer-summary.mjs';

test('customer summary cards', () => {
  const ledger = {
    customers: [
      { id: 'a', createdAt: '2026-11-02T10:00:00Z' },
      { id: 'b', createdAt: '2026-01-05T10:00:00Z' },
      { id: 'c', createdAt: '2025-06-05T10:00:00Z' },
      { id: 'd', createdAt: '2026-10-20T10:00:00Z', archived: true },
    ],
    jobs: [
      { customerId: 'a', createdAt: '2026-11-03T10:00:00Z' },
      { customerId: 'b', createdAt: '2026-03-01T10:00:00Z' },
      { customerId: 'c', createdAt: '2025-07-01T10:00:00Z' },
    ],
    payments: [
      { customerId: 'b', paidOn: '2026-11-10', createdAt: '2026-11-10T09:00:00Z' },
      { customerId: 'c', paidOn: '2026-11-01', createdAt: '2026-11-01T09:00:00Z', carryForward: true },
    ],
  };
  const owe = { a: 5000, b: 0, c: 2000, d: 9000 };
  const wal = { a: 0, b: 300, c: 0, d: 100 };
  const s = customerSummary(
    ledger,
    { balance: (id) => owe[id], wallet: (id) => wal[id] },
    new Date('2026-11-15T12:00:00Z'),
  );
  assert.equal(s.total, 3);
  assert.equal(s.archived, 1);
  assert.equal(s.activeMonth, 2, 'a bought, b paid; a carried-forward record is not activity');
  assert.equal(s.activeYear, 2);
  assert.equal(s.newMonth, 1);
  assert.equal(s.owingCount, 3, 'an archived customer who owes still counts');
  assert.equal(s.owingTotal, 16000);
  assert.equal(s.walletCount, 2, 'wallet credit counts every customer, archived too');
  assert.equal(s.walletTotal, 400);
  assert.equal(s.quiet, 1);
});
