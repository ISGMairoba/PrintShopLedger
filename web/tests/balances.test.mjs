import test from 'node:test';
import assert from 'node:assert/strict';
import { jobBalance, customerBalance } from '../src/domain.mjs';
import { lastJobPayment } from '../src/job-progress.mjs';
import { jobBalanceFast, customerBalanceFast, lastPaymentFast } from '../src/balances.mjs';

test('fast balances match the exact ones', () => {
  const jobs = Array.from({ length: 40 }, (_, i) => ({
    id: 'j' + i,
    customerId: 'c' + (i % 7),
    amount: 1000 * (i + 1),
    productionStatus: i % 9 === 0 ? 'Cancelled' : 'Added',
  }));
  const payments = Array.from({ length: 60 }, (_, i) => ({
    id: 'p' + i,
    customerId: 'c' + (i % 7),
    paidOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    amount: 700,
    allocations: [
      { jobId: 'j' + (i % 40), amount: 500 },
      { jobId: 'j' + ((i * 3) % 40), amount: i % 4 === 0 ? 0 : 200 },
    ],
  }));
  const ledger = { jobs, payments };
  for (const job of jobs) {
    assert.deepEqual(jobBalanceFast(ledger, job), jobBalance(ledger, job));
    assert.equal(lastPaymentFast(ledger, job), lastJobPayment(ledger, job));
  }
  for (let c = 0; c < 8; c++) assert.equal(customerBalanceFast(ledger, 'c' + c), customerBalance(ledger, 'c' + c));
  // A new payments list (as after any change) is tallied afresh.
  const next = { jobs, payments: [...payments, { ...payments[0], id: 'new', allocations: [{ jobId: 'j1', amount: 50 }] }] };
  assert.deepEqual(jobBalanceFast(next, jobs[1]), jobBalance(next, jobs[1]));
});
