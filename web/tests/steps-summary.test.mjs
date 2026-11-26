import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesLabel, stepsMinutes } from '../src/workflow-steps.mjs';

test('Steps summary: the time in all, only when every step has one', () => {
  assert.equal(stepsMinutes([{ name: 'Design', minutes: 1440 }, { name: 'Printing', minutes: 2880 }]), 4320);
  // A step without a time shares the time to the due date: no total.
  assert.equal(stepsMinutes([{ name: 'Design', minutes: 60 }, { name: 'Printing' }]), 0);
  assert.equal(stepsMinutes([]), 0);
  assert.equal(minutesLabel(4320), '3 days');
  assert.equal(minutesLabel(90), '1.5 hours');
  assert.equal(minutesLabel(60), '1 hour');
  assert.equal(minutesLabel(30), '30 min');
});
