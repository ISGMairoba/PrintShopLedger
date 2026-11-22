import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { holdEvent } from '../src/job-hold.mjs';
import { stageOverdue } from '../src/stage-time.mjs';

const actor = { id: 'u', label: 'Ada' };
const H = 3600000;
const base = () => ({
  ...emptyLedger(),
  jobs: [
    {
      id: 'j',
      customerId: 'c',
      productionStatus: 'Design',
      workflow: ['Added', 'Design', 'Approval', 'Completed', 'Collected'],
      stageHours: { Design: 2 },
      stageAt: '2026-11-07T08:00:00Z',
      createdAt: '2026-11-07T07:00:00Z',
      version: 1,
      amount: 0,
    },
  ],
});

test('a held job keeps its stage, stops its clock and cannot move on until resumed', () => {
  let l = base();
  l = applyEvent(
    l,
    holdEvent(
      l.jobs[0],
      { reason: 'Waiting for design approval', note: 'Sent on WhatsApp' },
      actor,
      '2026-11-07T09:00:00Z',
    ),
  );
  const held = l.jobs[0];
  assert.equal(held.hold.reason, 'Waiting for design approval');
  assert.equal(stageOverdue(held, {}, Date.parse('2026-11-08T09:00:00Z')), null, 'Not late while on hold');
  assert.throws(
    () =>
      applyEvent(l, {
        id: 'x',
        kind: 'job.status_changed',
        data: {
          id: 'j',
          status: 'Approval',
          baseVersion: held.version,
          modifiedBy: 'u',
          modifiedByLabel: 'Ada',
          modifiedAt: '2026-11-07T10:00:00Z',
        },
      }),
    /on hold/,
  );
  // Resumed after 24 hours on hold: 1 hour at the stage before, so 1 hour of its 2 is left.
  l = applyEvent(l, holdEvent(held, null, actor, '2026-11-08T09:00:00Z'));
  const resumed = l.jobs[0];
  assert.equal(resumed.hold, undefined);
  assert.equal(resumed.holdHistory.length, 1);
  assert.equal(resumed.stageHeldMs, 24 * H);
  assert.equal(
    stageOverdue(resumed, {}, Date.parse('2026-11-08T09:30:00Z')),
    null,
    '1.5 hours counted: fine',
  );
  assert.ok(stageOverdue(resumed, {}, Date.parse('2026-11-08T10:30:00Z')), '2.5 hours counted: late');
});

test('a hold needs a reason, and Other needs a note', () => {
  const l = base();
  assert.throws(() => applyEvent(l, holdEvent(l.jobs[0], { reason: 'Bored', note: '' }, actor)), /why/);
  assert.throws(
    () => applyEvent(l, holdEvent(l.jobs[0], { reason: 'Other', note: '' }, actor)),
    /waiting for/,
  );
});

test('a hold that extends the deadline moves the due date by the time on hold when resumed', () => {
  let l = base();
  l = { ...l, jobs: [{ ...l.jobs[0], dueAt: '2026-11-10T17:00:00.000Z' }] };
  const start = '2026-11-07T09:00:00.000Z',
    end = '2026-11-08T12:30:00.000Z'; // 27.5 hours later
  l = applyEvent(
    l,
    holdEvent(
      l.jobs[0],
      { reason: 'Waiting for design approval', note: '', extendDeadline: true },
      actor,
      start,
    ),
  );
  assert.equal(l.jobs[0].hold.extendDeadline, true);
  assert.equal(l.jobs[0].dueAt, '2026-11-10T17:00:00.000Z', 'Unchanged while on hold');
  l = applyEvent(l, holdEvent(l.jobs[0], null, actor, end));
  assert.equal(l.jobs[0].dueAt, '2026-11-11T20:30:00.000Z');
  const last = l.jobs[0].dueHistory.at(-1);
  assert.equal(last.from, '2026-11-10T17:00:00.000Z');
  assert.equal(last.to, '2026-11-11T20:30:00.000Z');
  assert.match(last.reason, /^On hold: Waiting for design approval/);
});

test('a plain hold, or a job with no deadline, leaves the due date alone', () => {
  let l = base();
  l = { ...l, jobs: [{ ...l.jobs[0], dueAt: '2026-11-10T17:00:00.000Z' }] };
  l = applyEvent(
    l,
    holdEvent(l.jobs[0], { reason: 'Waiting for materials', note: '' }, actor, '2026-11-07T09:00:00Z'),
  );
  assert.equal(l.jobs[0].hold.extendDeadline, undefined);
  l = applyEvent(l, holdEvent(l.jobs[0], null, actor, '2026-11-08T09:00:00Z'));
  assert.equal(l.jobs[0].dueAt, '2026-11-10T17:00:00.000Z');
  assert.equal(l.jobs[0].dueHistory, undefined);
  // No deadline: asking to extend is ignored.
  let m = base();
  m = applyEvent(
    m,
    holdEvent(
      m.jobs[0],
      { reason: 'Other', note: 'Ink', extendDeadline: true },
      actor,
      '2026-11-07T09:00:00Z',
    ),
  );
  assert.equal(m.jobs[0].hold.extendDeadline, undefined);
  m = applyEvent(m, holdEvent(m.jobs[0], null, actor, '2026-11-08T09:00:00Z'));
  assert.equal(m.jobs[0].dueAt, undefined);
});

test('holds caused by the customer extend the deadline by default', async () => {
  const { extendsByDefault } = await import('../src/job-hold.mjs');
  assert.equal(extendsByDefault('Waiting for design approval'), true);
  assert.equal(extendsByDefault('Waiting for balance payment'), true);
  assert.equal(extendsByDefault('Customer not reachable'), true);
  assert.equal(extendsByDefault('Waiting for materials'), false);
  assert.equal(extendsByDefault('Other'), false);
});
