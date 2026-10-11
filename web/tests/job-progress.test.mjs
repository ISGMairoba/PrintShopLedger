import test from 'node:test';
import assert from 'node:assert/strict';
import { progressEvents, lastJobPayment } from '../src/job-progress.mjs';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
const actor = { id: 'cashier', label: 'Cashier' };
const job = { id: 'job', amount: 4500000, productionStatus: 'Added', version: 1 };
test('setting a later stage records each step in order and stops at Completed', () => {
  const events = progressEvents(job, 'Completed', actor),
    initial = { ...emptyLedger(), jobs: [job] };
  assert.deepEqual(
    events.map((e) => e.data.status),
    ['In Queue', 'Printing', 'Completed'],
  );
  assert.deepEqual(
    events.map((e) => e.data.baseVersion),
    [1, 2, 3],
  );
  const result = events.reduce(applyEvent, initial);
  assert.equal(result.jobs[0].productionStatus, 'Completed');
  assert.equal(result.jobs[0].version, 4);
  assert.equal(initial.jobs[0].productionStatus, 'Added');
  assert.equal(result.jobs[0].amount, 4500000);
  const collect = progressEvents(result.jobs[0], 'Collected', actor);
  assert.equal(collect.length, 1);
});
test('backwards, unchanged, invalid and stale stage requests are rejected', () => {
  for (const target of ['Added', 'missing']) assert.throws(() => progressEvents(job, target, actor));
  assert.throws(() => progressEvents({ ...job, productionStatus: 'Completed' }, 'Printing', actor));
  const events = progressEvents(job, 'Completed', actor);
  assert.throws(
    () => events.reduce(applyEvent, { ...emptyLedger(), jobs: [{ ...job, version: 2 }] }),
    /latest job status/,
  );
});
test('last payment belongs to this job and includes wallet-funded allocations', () => {
  const ledger = {
    payments: [
      {
        paidOn: '2026-10-05',
        createdAt: '2026-10-05T12:00:00Z',
        allocations: [{ jobId: 'job', amount: 500000 }],
      },
      {
        paidOn: '2026-10-06',
        createdAt: '2026-10-06T10:00:00Z',
        walletUsed: 100000,
        allocations: [{ jobId: 'job', amount: 100000 }],
      },
      {
        paidOn: '2026-10-07',
        createdAt: '2026-10-07T10:00:00Z',
        allocations: [{ jobId: 'other', amount: 100000 }],
      },
    ],
  };
  assert.equal(lastJobPayment(ledger, job), '2026-10-06');
  assert.equal(lastJobPayment(ledger, { id: 'unpaid' }), null);
});
