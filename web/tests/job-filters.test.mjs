import test from 'node:test';
import assert from 'node:assert/strict';
import { inStageRange, payMatches, payState } from '../src/job-filters.mjs';

const stages = ['Added', 'In Queue', 'Processing', 'Completed', 'Collected'];
const order = ['Added', 'In Queue', 'Processing', 'Design', 'Completed', 'Collected'];
const at = (productionStatus, workflow) => ({ productionStatus, workflow });

test('only, up to, and from a stage', () => {
  const jobs = ['Added', 'In Queue', 'Processing', 'Completed', 'Collected', 'Cancelled'].map((s) => at(s));
  const pick = (range) =>
    jobs.filter((j) => inStageRange(j, 'In Queue', range, order, stages)).map((j) => j.productionStatus);
  assert.deepEqual(pick('only'), ['In Queue']);
  assert.deepEqual(pick('upTo'), ['Added', 'In Queue']);
  assert.deepEqual(pick('from'), ['In Queue', 'Processing', 'Completed']);
});

test("a job's own steps decide its place", () => {
  // Design comes before Processing for this job, though the shared order puts it after.
  const job = at('Design', ['Added', 'Design', 'Processing', 'Completed', 'Collected']);
  assert.equal(inStageRange(job, 'Processing', 'upTo', order, stages), true);
  assert.equal(inStageRange(job, 'Processing', 'from', order, stages), false);
});

test('payment states', () => {
  assert.equal(payState({ paid: 0, outstanding: 0 }), 'paid');
  assert.equal(payState({ paid: 5, outstanding: 5 }), 'part');
  assert.equal(payState({ paid: 0, outstanding: 5 }), 'unpaid');
  assert.equal(payMatches('part', 'owing'), true);
  assert.equal(payMatches('paid', 'owing'), false);
  assert.equal(payMatches('unpaid', ''), true);
});
