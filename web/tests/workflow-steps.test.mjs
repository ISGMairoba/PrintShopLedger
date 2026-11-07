import test from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_STAGES_ID, validateOptions } from '../src/business-options.mjs';
import { itemSteps, stagesToSteps, stepsWorkflow, validSteps } from '../src/workflow-steps.mjs';
import { validProduction } from '../src/production-materials.mjs';
import { validateTerms, stageName } from '../src/terms.mjs';

test('steps sit between the fixed Added and Completed, Collected', () => {
  const steps = validSteps([{ name: ' Design ', minutes: 90, unit: 'h' }, { name: 'Approval' }]);
  assert.deepEqual(steps, [{ name: 'Design', minutes: 90, unit: 'h' }, { name: 'Approval' }]);
  assert.deepEqual(stepsWorkflow(steps), {
    stages: ['Added', 'Design', 'Approval', 'Completed', 'Collected'],
    hours: { Design: 1.5 },
  });
  assert.throws(() => validSteps([{ name: 'Completed' }]), /first or last/);
  assert.throws(() => validSteps([{ name: 'A' }, { name: 'a' }]), /two steps/);
  assert.throws(() => validSteps([{ name: '' }]), /name/);
  assert.throws(() => validSteps([{ name: 'A', minutes: 0 }]), /1 minute/);
  assert.equal(stepsWorkflow(validSteps([{ name: 'Cut', minutes: 1 }])).hours.Cut, 0.0167);
  assert.deepEqual(stagesToSteps(['Added', 'Print', 'Completed', 'Collected'], { Print: 48 }), [
    { name: 'Print', minutes: 2880, unit: 'd' },
  ]);
});

test('a business with its own stages keeps them as the saved workflow items follow', () => {
  const o = validateOptions({
    jobStages: ['Added', 'In Queue', 'Printing', 'Completed', 'Collected'],
    stageHours: { Printing: 3 },
  });
  assert.equal(o.defaultWorkflowId, CURRENT_STAGES_ID);
  assert.deepEqual(o.workflows[0], {
    id: CURRENT_STAGES_ID,
    name: 'Our current stages',
    steps: [{ name: 'In Queue' }, { name: 'Printing', minutes: 180, unit: 'h' }],
  });
  assert.deepEqual(o.jobStages, ['Added', 'In Queue', 'Printing', 'Completed', 'Collected']);
  assert.deepEqual(o.stageHours, { Printing: 3 });
  // Saved again, nothing changes; choosing no saved workflow gives the master default.
  assert.deepEqual(validateOptions(o), o);
  const plain = validateOptions({ ...o, defaultWorkflowId: null });
  assert.deepEqual(plain.jobStages, ['Added', 'Processing', 'Completed', 'Collected']);
  assert.equal(plain.workflows.length, 1);
  // A new business: Added → Processing → Completed → Collected.
  assert.deepEqual(validateOptions({}).jobStages, ['Added', 'Processing', 'Completed', 'Collected']);
  assert.deepEqual(validateOptions({}).workflows, []);
});

test('items keep their own copy of steps', () => {
  const o = validateOptions({
    workflows: [{ id: 'logo-0001', name: 'Logo', steps: [{ name: 'Design', minutes: 7200, unit: 'd' }] }],
    defaultWorkflowId: 'logo-0001',
  });
  assert.deepEqual(itemSteps(o, undefined), [{ name: 'Design', minutes: 7200, unit: 'd' }]);
  assert.deepEqual(itemSteps(o, { steps: [{ name: 'Cut' }] }), [{ name: 'Cut' }]);
  assert.deepEqual(validProduction({ steps: [{ name: 'Cut', minutes: 30, unit: 'm' }] }), {
    steps: [{ name: 'Cut', minutes: 30, unit: 'm' }],
  });
  // Older saved workflows (stages and hours) read as steps.
  const old = validateOptions({
    workflows: [
      {
        id: 'a-000001',
        name: 'X',
        stages: ['Added', 'Design', 'Completed', 'Collected'],
        hours: { Design: 2 },
      },
    ],
    defaultWorkflowId: null,
  });
  assert.deepEqual(old.workflows[0].steps, [{ name: 'Design', minutes: 120, unit: 'h' }]);
});

test('Processing uses the business words', () => {
  assert.equal(stageName('Processing', validateTerms({ preset: 'retail' })), 'Preparing');
  assert.equal(
    stageName('Processing', validateTerms({ preset: 'print', stages: { Added: 'Added' } })),
    'Processing',
  );
});
