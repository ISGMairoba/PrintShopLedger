import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupJobsByCheckout,
  batchProgressPlan,
  batchProgressEvents,
  lineWithDescription,
} from '../src/job-batches.mjs';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { validateJobSettings } from '../src/business-branding.mjs';
const actor = { id: 'staff', label: 'Staff' };
const job = (id, status = 'Added', more = {}) => ({
  id,
  amount: 4500000,
  version: 1,
  productionStatus: status,
  service: 'Pressing',
  description: 'Customer shirt',
  ...more,
});

test('grouping uses checkout identity and keeps legacy standalone items separate', () => {
  const jobs = [
    job('a', 'Added', { checkoutId: 'one' }),
    job('b', 'Added', { checkoutId: 'two' }),
    job('c', 'Added', { checkoutId: 'one' }),
    job('d'),
    job('e'),
  ];
  assert.deepEqual(
    groupJobsByCheckout(jobs).map((g) => g.jobs.map((j) => j.id)),
    [['a', 'c'], ['b'], ['d'], ['e']],
  );
});
test('bulk next advances each item one step and skips terminal/cancelled items', () => {
  const plan = batchProgressPlan(
    [job('a'), job('b', 'Printing'), job('c', 'Collected'), job('d', 'Cancelled')],
    'next',
  );
  assert.deepEqual(
    plan.map((p) => p.path),
    [['In Queue'], ['Completed'], [], []],
  );
  assert.equal(plan[2].reason, 'No next stage');
  assert.equal(plan[3].reason, 'Cancelled');
});
test('bulk complete preserves each intervening stage and financial values', () => {
  const jobs = [job('a'), job('b', 'Printing'), job('c', 'Collected')];
  const events = batchProgressEvents(jobs, 'complete', '', actor);
  assert.deepEqual(
    events.map((e) => [e.data.id, e.data.status, e.data.baseVersion]),
    [
      ['a', 'In Queue', 1],
      ['a', 'Printing', 2],
      ['a', 'Completed', 3],
      ['b', 'Completed', 1],
    ],
  );
  const ledger = events.reduce(applyEvent, { ...emptyLedger(), jobs });
  assert.deepEqual(
    ledger.jobs.map((j) => j.productionStatus),
    ['Completed', 'Completed', 'Collected'],
  );
  assert.deepEqual(
    ledger.jobs.map((j) => j.amount),
    [4500000, 4500000, 4500000],
  );
});
test('set handles different workflows, unchanged stages and duplicate selections', () => {
  const jobs = [
    job('a'),
    job('b', 'Added', { workflow: ['Added', 'Design', 'Completed', 'Collected'] }),
    job('c', 'Completed'),
  ];
  const plan = batchProgressPlan([...jobs, jobs[0]], 'set', 'Printing');
  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0].path, ['In Queue', 'Printing']);
  assert.equal(plan[1].reason, 'Stage is not in this workflow');
  assert.equal(plan[2].reason, 'Already at or beyond this stage');
});
test('stale bulk events fail instead of overwriting an updated job', () => {
  const events = batchProgressEvents([job('a'), job('b')], 'next', '', actor);
  const original = { ...emptyLedger(), jobs: [job('a'), job('b', 'Added', { version: 2 })] };
  assert.throws(() => events.reduce(applyEvent, original), /latest job status/);
  assert.equal(original.jobs[0].productionStatus, 'Added');
});
test('description modes preserve defaults and existing descriptions, and reject invalid settings', () => {
  assert.equal(validateJobSettings({}).descriptionMode, 'required');
  for (const mode of ['required', 'optional', 'hidden'])
    assert.equal(validateJobSettings({ descriptionMode: mode }).descriptionMode, mode);
  assert.throws(() => validateJobSettings({ descriptionMode: 'invalid' }));
  const services = [{ id: 's', description: 'Cap pressing' }];
  const blank = { serviceId: 's', description: ' ' };
  assert.equal(lineWithDescription(blank, services, 'required').description, ' ');
  assert.equal(lineWithDescription(blank, services, 'optional').description, 'Cap pressing');
  assert.equal(lineWithDescription(blank, services, 'hidden').description, 'Cap pressing');
  assert.equal(
    lineWithDescription({ ...blank, description: 'Existing note' }, services, 'hidden').description,
    'Existing note',
  );
});

import { collectionCheck } from '../src/job-batches.mjs';
test('Bulk actions that collect show how many items and how much is still owed', () => {
  const job = (id, extra) => ({
    id,
    customerId: 'c',
    service: 'S',
    description: 'd',
    amount: 5000,
    createdAt: '2026-10-13T08:00:00Z',
    version: 1,
    productionStatus: 'Completed',
    ...extra,
  });
  const jobs = [job('paid'), job('owing'), job('early', { productionStatus: 'Printing' })];
  const ledger = {
    jobs,
    payments: [{ id: 'p', customerId: 'c', amount: 5000, allocations: [{ jobId: 'paid', amount: 5000 }] }],
    saleAdjustments: [],
  };
  assert.deepEqual(collectionCheck(batchProgressPlan(jobs, 'next'), ledger), {
    collecting: 2,
    unpaid: 1,
    owed: 5000,
  });
  assert.deepEqual(collectionCheck(batchProgressPlan(jobs, 'complete'), ledger), {
    collecting: 0,
    unpaid: 0,
    owed: 0,
  });
});
