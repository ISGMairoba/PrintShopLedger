import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMethod, defaultSource, methodKey, orderMethods, validateOptions } from '../src/business-options.mjs';
import { fallbackSteps, itemSteps } from '../src/workflow-steps.mjs';

test('payment methods follow the business order; new ones go last', () => {
  const cash = { label: 'Cash', accountId: 'a' };
  const opay = { label: 'OPAY', accountId: 'b' };
  const pos = { label: 'POS', accountId: 'c' };
  const order = [methodKey(opay), methodKey(cash)];
  assert.deepEqual(
    orderMethods([cash, opay, pos], order).map((m) => m.label),
    ['OPAY', 'Cash', 'POS'],
  );
  assert.equal(defaultMethod([cash, opay], methodKey(opay)), opay);
  assert.equal(defaultMethod([cash, opay], 'gone|X'), cash);
});

test('the usual sales channel and steps per kind', () => {
  const options = validateOptions({
    jobSources: ['In shop', 'WhatsApp'],
    defaultJobSource: 'WhatsApp',
    defaultWorkflowId: null,
    workflows: [
      { id: 'logo-flow1', name: 'Logo', steps: [{ name: 'Design' }] },
      { id: 'shelf-flow', name: 'Pick', steps: [{ name: 'Packing' }] },
    ],
    defaultShelfWorkflowId: 'shelf-flow',
    defaultServiceWorkflowId: 'missing-id',
  });
  assert.equal(defaultSource(options), 'WhatsApp');
  assert.equal(defaultSource({ ...options, defaultJobSource: 'Gone' }), 'In shop');
  assert.equal(options.defaultServiceWorkflowId, null, 'an unknown workflow is dropped');
  assert.deepEqual(fallbackSteps(options, 'shelf').map((s) => s.name), ['Packing']);
  assert.deepEqual(fallbackSteps(options, 'service'), fallbackSteps(options));
  assert.deepEqual(itemSteps(options, { steps: [{ name: 'Own' }] }, 'shelf').map((s) => s.name), ['Own']);
});
