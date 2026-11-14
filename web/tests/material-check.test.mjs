import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { applyMaterialEvent } from '../src/materials.mjs';
import { checkDraft, checkLines, materialsCheckEvent, pendingChecks } from '../src/material-check.mjs';
import { materialConfirmDue, materialPending, stageMoveEvents } from '../src/material-choice.mjs';

const at = '2026-11-14T10:00:00Z';
const create = (l, id, name, available, unit = 'sheets') =>
  applyMaterialEvent(l, {
    id: crypto.randomUUID(),
    kind: 'material.created',
    data: {
      id,
      name,
      available,
      measurementUnit: unit,
      requireSize: false,
      modifiedBy: 'u',
      modifiedByLabel: 'Owner',
      modifiedAt: at,
    },
  });

/** A job that took 5 sheets of A at checkout, as the checkout leaves it. */
function setup() {
  let l = create(create(create(emptyLedger(), 'a', 'Gloss', 100), 'b', 'Matte', 50), 'r', 'Roll', 10, 'ft');
  l = { ...l, materials: l.materials.map((m) => (m.id === 'a' ? { ...m, available: 95 } : m)) };
  const job = {
    id: 'j1',
    customerId: 'c1',
    service: 'Print',
    description: 'Print',
    amount: 1000,
    materialId: 'a',
    materialNeeded: 5,
    measurementUnit: 'sheets',
    checkMaterials: true,
    productionStatus: 'Printing',
    version: 1,
    createdAt: at,
    modifiedBy: 'u',
    modifiedByLabel: 'Owner',
    modifiedAt: at,
    lastEventId: 'j1',
  };
  l = {
    ...l,
    jobs: [job],
    materialHistory: [
      ...l.materialHistory,
      {
        id: 'j1',
        materialId: 'a',
        action: 'material.job_used',
        jobId: 'j1',
        beforeAvailable: 100,
        afterAvailable: 95,
        changedAt: at,
      },
    ],
  };
  return l;
}
const cashier = { id: 'c', label: 'Cashier', level: 1 };
const admin = { id: 'g', label: 'GM', level: 4 };
const stock = (l, id) => l.materials.find((m) => m.id === id).available;

test('materials check: lines start at the calculated amount; moving past the stage needs the check', () => {
  const l = setup();
  const job = l.jobs[0];
  assert.deepEqual(
    checkLines(l, job).map((x) => [x.key, x.unit, x.expected]),
    [['m:a', 'sheets', 5]],
  );
  assert.deepEqual(checkDraft(l, job), [{ line: 'm:a', materialId: 'a', quantity: '5' }]);
  assert.equal(materialConfirmDue(job, 'Completed'), true);
  assert.equal(materialConfirmDue(job, 'Printing'), false);
  assert.throws(() => stageMoveEvents(l, job, 'Completed', admin, null), /Confirm the materials/);
});

test('a cashier sends it for approval: nothing moves, the job can move on; the GM approves with changes', () => {
  let l = setup();
  const usages = [
    { line: 'm:a', materialId: 'a', quantity: 4 },
    { line: 'm:a', materialId: 'b', quantity: 2 },
  ];
  for (const event of stageMoveEvents(l, l.jobs[0], 'Completed', cashier, usages)) l = applyEvent(l, event);
  assert.equal(l.jobs[0].materialCheck.status, 'pending');
  assert.equal(l.jobs[0].productionStatus, 'Completed');
  assert.equal(materialPending(l.jobs[0]), false);
  assert.deepEqual([stock(l, 'a'), stock(l, 'b')], [95, 50]);
  assert.equal(pendingChecks(l).length, 1);
  // A cashier cannot change a confirmed check later; the GM approves 4 Gloss + 3 Matte.
  l = applyEvent(l, materialsCheckEvent(l, l.jobs[0], [usages[0], { ...usages[1], quantity: 3 }], admin));
  const check = l.jobs[0].materialCheck;
  assert.equal(check.status, 'confirmed');
  assert.equal(check.requestedByLabel, 'Cashier');
  assert.equal(check.confirmedByLabel, 'GM');
  assert.deepEqual([stock(l, 'a'), stock(l, 'b')], [96, 47]);
  assert.equal(pendingChecks(l).length, 0);
  assert.throws(() => materialsCheckEvent(l, l.jobs[0], usages, cashier), /already confirmed/);
  // Correcting again moves only the difference: 5 Gloss, no Matte.
  l = applyEvent(
    l,
    materialsCheckEvent(l, l.jobs[0], [{ line: 'm:a', materialId: 'a', quantity: 5 }], admin),
  );
  assert.deepEqual([stock(l, 'a'), stock(l, 'b')], [95, 50]);
});

test('materials check refuses another unit, a missing line and duplicates', () => {
  const l = setup();
  const job = l.jobs[0];
  assert.throws(
    () => materialsCheckEvent(l, job, [{ line: 'm:a', materialId: 'r', quantity: 1 }], admin),
    /measured in ft/,
  );
  assert.throws(
    () => materialsCheckEvent(l, job, [{ line: 'm:x', materialId: 'a', quantity: 1 }], admin),
    /materials used/,
  );
  assert.throws(
    () =>
      materialsCheckEvent(
        l,
        job,
        [
          { line: 'm:a', materialId: 'a', quantity: 1 },
          { line: 'm:a', materialId: 'a', quantity: 2 },
        ],
        admin,
      ),
    /once per line/,
  );
});

test('a choice of materials is checked the same way: nothing was taken, the check takes it', () => {
  let l = setup();
  const job = {
    ...l.jobs[0],
    id: 'j2',
    materialId: null,
    materialNeeded: 0,
    checkMaterials: undefined,
    materialChoice: { options: ['a', 'b'], confirmStage: 'Printing', work: 3 },
  };
  l = { ...l, jobs: [job] };
  assert.deepEqual(
    checkLines(l, job).map((x) => [x.key, x.unit, x.expected]),
    [['g:0', 'sheets', 3]],
  );
  l = applyEvent(l, materialsCheckEvent(l, job, [{ line: 'g:0', materialId: 'b', quantity: 3 }], admin));
  assert.equal(stock(l, 'b'), 47);
  assert.equal(l.jobs[0].materialUsed.usages[0].materialId, 'b');
  assert.equal(materialPending(l.jobs[0]), false);
});

test('a business may let cashiers confirm materials without approval', () => {
  let l = setup();
  const usages = [{ line: 'm:a', materialId: 'a', quantity: 7 }];
  l = applyEvent(l, materialsCheckEvent(l, l.jobs[0], usages, { ...cashier, confirms: true }));
  assert.equal(l.jobs[0].materialCheck.status, 'confirmed');
  assert.equal(stock(l, 'a'), 93);
});
