import test from 'node:test';
import assert from 'node:assert/strict';
import { stageAllowance, stageOverdue, validStageHours } from '../src/stage-time.mjs';
import { validateOptions } from '../src/business-options.mjs';

const H = 3600000;
const created = '2026-11-07T08:00:00Z';
const job = (over) => ({ id: 'j', createdAt: created, productionStatus: 'In Queue', ...over });

test('a job with a due date shares its time evenly across the stages before Completed', () => {
  // Added, In Queue, Printing → 3 stages; due 48 hours after the sale → 16 hours each.
  const j = job({ dueAt: '2026-11-09T08:00:00Z', stageAt: '2026-11-07T10:00:00Z' });
  assert.equal(stageAllowance(j), 16 * H);
  assert.equal(stageOverdue(j, {}, Date.parse('2026-11-08T01:00:00Z')), null, '15 hours: still fine');
  assert.equal(
    stageOverdue(j, {}, Date.parse('2026-11-08T03:00:00Z')).over,
    1 * H,
    '17 hours: one hour over',
  );
});

test('a fixed time for a stage wins, and also covers jobs without a due date', () => {
  const j = job({ modifiedAt: '2026-11-07T09:00:00Z' });
  assert.equal(stageAllowance(j), null, 'No due date and no fixed time: never flagged');
  assert.ok(
    stageOverdue(j, { 'In Queue': 2 }, Date.parse('2026-11-07T11:30:00Z')),
    'Counts from the last change',
  );
  assert.equal(stageOverdue({ ...j, productionStatus: 'Completed' }, { Completed: 1 }, Date.now()), null);
});

test('time per stage is saved with the business options; unknown stages are dropped', () => {
  assert.deepEqual(
    validStageHours({ Printing: 2, Gone: 3, Completed: 1, Added: '' }, [
      'Added',
      'Printing',
      'Completed',
      'Collected',
    ]),
    { Printing: 2 },
  );
  assert.throws(() => validStageHours({ Printing: 0.1 }, ['Added', 'Printing', 'Completed', 'Collected']));
  assert.deepEqual(validateOptions({ stageHours: { Printing: 4 } }).stageHours, { Printing: 4 });
});
