import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import {
  doneEvent,
  handoverEvent,
  handoverProblem,
  jobParts,
  partsAllowed,
  paymentNeeded,
} from '../src/job-handover.mjs';
import { deliveryNoteModel } from '../src/delivery-note.mjs';

const actor = { id: 'u', label: 'Ada' };
const base = (status = 'Printing') => ({
  ...emptyLedger(),
  jobs: [
    {
      id: 'j',
      customerId: 'c',
      description: 'Jotters',
      service: 'Jotter',
      quantity: 200,
      amount: 200_000_00,
      productionStatus: status,
      workflow: ['Added', 'Printing', 'Completed', 'Collected'],
      createdAt: '2026-11-15T07:00:00Z',
      version: 1,
    },
  ],
});
const job = (l) => l.jobs[0];

test('Sara’s 200 jotters: 100 done, 60 handed over, the rest later; the last handover closes the job', () => {
  let l = base();
  assert.equal(partsAllowed(job(l)), true);
  assert.match(handoverProblem(job(l), 10), /Record how many are done first/);
  l = applyEvent(l, doneEvent(job(l), 100, actor));
  assert.deepEqual({ done: jobParts(job(l)).done, ready: jobParts(job(l)).ready }, { done: 100, ready: 100 });
  l = applyEvent(l, handoverEvent(job(l), { quantity: 60, collectedBy: 'Sara' }, actor));
  let p = jobParts(job(l));
  assert.deepEqual([p.done, p.collected, p.ready], [100, 60, 40]);
  assert.equal(job(l).productionStatus, 'Printing');
  assert.match(handoverProblem(job(l), 41), /Only 40 are ready/);
  assert.throws(() => applyEvent(l, doneEvent(job(l), 50, actor)), /60 are already collected/);
  // Done reaches 200 but the job is not Completed: the last part waits for Completed.
  l = applyEvent(l, doneEvent(job(l), 200, actor));
  assert.match(handoverProblem(job(l), 140), /Mark the job Completed first/);
  l = applyEvent(l, handoverEvent(job(l), { quantity: 100, collectedBy: 'Sara' }, actor));
  l = { ...l, jobs: [{ ...job(l), productionStatus: 'Completed' }] };
  assert.equal(jobParts(job(l)).ready, 40);
  l = applyEvent(l, handoverEvent(job(l), { quantity: 40, collectedBy: 'Musa' }, actor));
  p = jobParts(job(l));
  assert.equal(job(l).productionStatus, 'Collected');
  assert.deepEqual([p.collected, p.ready], [200, 0]);
  assert.equal(job(l).progress.handovers.length, 3);
});

test('a handover needs its share of the price: 60 of 200 at ₦200,000 is ₦60,000', () => {
  const l = base();
  assert.deepEqual(paymentNeeded(job(l), 50_000_00, 60), { due: 60_000_00, short: 10_000_00 });
  assert.deepEqual(paymentNeeded(job(l), 80_000_00, 60), { due: 60_000_00, short: 0 });
});

test('held, single-item and cancelled jobs are not handed over in parts', () => {
  assert.equal(partsAllowed({ ...job(base()), quantity: 1 }), false);
  assert.equal(partsAllowed(job(base('Cancelled'))), false);
  assert.match(handoverProblem({ ...job(base('Completed')), hold: { reason: 'x' } }, 5), /on hold/);
});

test('the delivery note counts what came before and what is still to come, with no prices', () => {
  let l = base('Completed');
  l = applyEvent(l, handoverEvent(job(l), { quantity: 50, collectedBy: 'Sara' }, actor));
  l = applyEvent(l, handoverEvent(job(l), { quantity: 30, collectedBy: '' }, actor));
  const h = job(l).progress.handovers[1];
  const m = deliveryNoteModel({ job: job(l), handover: h, customerName: 'Sara' }, 'Ink & Co');
  assert.equal(m.title, 'Delivery note');
  assert.equal(m.items[0].amount, '30');
  assert.deepEqual(m.items[0].meta, ['Ordered 200', 'Collected before 50', 'Still to collect 120']);
  assert.match(m.notices[0], /80 of 200 collected so far, 120 still to come/);
  assert.ok(!JSON.stringify(m).includes('₦'));
});
