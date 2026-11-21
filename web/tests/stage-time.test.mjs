import test from 'node:test';
import assert from 'node:assert/strict';
import { stageAllowance, stageOverdue, stagePlan, validStageHours } from '../src/stage-time.mjs';
import { validateOptions } from '../src/business-options.mjs';

const H = 3600000;
const created = '2026-11-07T08:00:00Z';
const job = (over) => ({ id: 'j', createdAt: created, productionStatus: 'In Queue', ...over });

test('with a due date and no set times, the time left is shared by this stage and the ones after it', () => {
  // At In Queue since 10:00 (Added took 2 hours); In Queue and Printing share the 46 hours left.
  const j = job({ dueAt: '2026-11-09T08:00:00Z', stageAt: '2026-11-07T10:00:00Z' });
  assert.equal(stageAllowance(j), 23 * H);
  assert.equal(stageOverdue(j, {}, Date.parse('2026-11-08T01:00:00Z')), null, '15 hours: still fine');
  assert.equal(
    stageOverdue(j, {}, Date.parse('2026-11-08T10:00:00Z')).over,
    1 * H,
    '24 hours: one hour over',
  );
});

const flow = ['Added', 'Design', 'Printing', 'Finishing', 'Completed', 'Collected'];
const timed = { Design: 2, Printing: 4, Finishing: 2 };
const sale = (over) =>
  job({ productionStatus: 'Design', workflow: flow, stageHours: timed, stageAt: created, ...over });

test('every stage timed: each gets its share of the deadline', () => {
  const plan = stagePlan(sale({ dueAt: '2026-11-09T08:00:00Z' }));
  assert.deepEqual(plan.allowances, { Design: 12 * H, Printing: 24 * H, Finishing: 12 * H });
  assert.equal(plan.tight, false);
});

test('some stages timed: they keep their times and the others share what is left', () => {
  const plan = stagePlan(sale({ dueAt: '2026-11-08T08:00:00Z', stageHours: { Design: 2, Printing: 4 } }));
  assert.deepEqual(plan.allowances, { Design: 2 * H, Printing: 4 * H, Finishing: 18 * H });
});

test('a deadline shorter than the set times shrinks every stage to fit and is tight', () => {
  const plan = stagePlan(sale({ dueAt: '2026-11-07T12:00:00Z' }));
  assert.deepEqual(plan.allowances, { Design: 1 * H, Printing: 2 * H, Finishing: 1 * H });
  assert.equal(plan.tight, true);
  assert.equal(plan.needed, 8 * H);
  // Untimed stages count as an average timed stage when shrinking.
  const mixed = stagePlan(sale({ dueAt: '2026-11-07T12:00:00Z', stageHours: { Design: 2, Printing: 4 } }));
  // Weights 2 : 4 : 3 (the average), fitted into the 4 hours left.
  const a = mixed.allowances;
  assert.ok(Math.abs(a.Design + a.Printing + a.Finishing - 4 * H) < 1);
  assert.ok(Math.abs(a.Finishing - (4 * H * 3) / 9) < 1);
  assert.equal(mixed.tight, true);
});

test('a moved deadline keeps the time stages really took and re-spreads the rest', () => {
  // Design took 10 hours; the deadline moved to 3 days after the sale: 62 hours left for
  // Printing (4) and Finishing (2).
  const j = sale({
    productionStatus: 'Printing',
    stageAt: '2026-11-07T18:00:00Z',
    dueAt: '2026-11-10T08:00:00Z',
  });
  const plan = stagePlan(j);
  assert.deepEqual(Object.keys(plan.allowances), ['Printing', 'Finishing']);
  assert.ok(Math.abs(plan.allowances.Printing - (62 * H * 4) / 6) < 1);
  assert.equal(stageAllowance(j), plan.allowances.Printing);
  // A new date can be checked before saving (the due date dialog's warning).
  assert.equal(stagePlan(j, {}, { dueAt: '2026-11-07T20:00:00Z' }).tight, true);
  // From the sale, for the checkout's warning.
  const atSale = stagePlan(j, {}, { fromSale: true });
  assert.deepEqual(Object.keys(atSale.allowances), ['Design', 'Printing', 'Finishing']);
  // Still at Added: its time runs into the first timed stage.
  const added = sale({ productionStatus: 'Added', dueAt: '2026-11-09T08:00:00Z' });
  assert.equal(stageAllowance(added), 12 * H);
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
  assert.throws(() => validStageHours({ Printing: 0.01 }, ['Added', 'Printing', 'Completed', 'Collected']));
  assert.deepEqual(validStageHours({ Printing: 0.0167 }, ['Added', 'Printing', 'Completed', 'Collected']), {
    Printing: 0.0167,
  });
  assert.deepEqual(
    validateOptions({
      jobStages: ['Added', 'Printing', 'Completed', 'Collected'],
      stageHours: { Printing: 4 },
    }).stageHours,
    { Printing: 4 },
  );
});
