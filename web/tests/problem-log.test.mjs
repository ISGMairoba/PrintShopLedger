import assert from 'node:assert/strict';
import test from 'node:test';
import { recordProblem, returnProblems, takeProblems } from '../src/problem-log.mjs';

const memory = () => {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
};

test('the same problem is kept once with a count', () => {
  const storage = memory();
  recordProblem(
    'error',
    'x is not a function',
    { page: 'Jobs' },
    { storage, now: new Date('2026-10-28T10:00:00Z') },
  );
  recordProblem(
    'error',
    '  x is not   a function ',
    { page: 'Payments' },
    { storage, now: new Date('2026-10-28T11:00:00Z') },
  );
  recordProblem('sync', 'Business access denied', {}, { storage });
  const taken = takeProblems({ storage });
  assert.equal(taken.length, 2);
  const error = taken.find((p) => p.kind === 'error');
  assert.equal(error.count, 2);
  assert.equal(error.firstAt, '2026-10-28T10:00:00.000Z');
  assert.equal(error.lastAt, '2026-10-28T11:00:00.000Z');
  assert.deepEqual(error.detail, { page: 'Payments' });
  assert.deepEqual(takeProblems({ storage }), []);
});

test('browser noise is ignored, and at most 30 problems are kept', () => {
  const storage = memory();
  recordProblem('error', 'ResizeObserver loop completed with undelivered notifications.', {}, { storage });
  recordProblem('error', 'Script error.', {}, { storage });
  recordProblem('error', '', {}, { storage });
  assert.deepEqual(takeProblems({ storage }), []);
  for (let i = 0; i < 40; i++)
    recordProblem('error', `problem ${i}`, {}, { storage, now: new Date(Date.UTC(2026, 9, 28, 0, i)) });
  const first = takeProblems({ storage });
  const rest = takeProblems({ storage });
  assert.equal(first.length + rest.length, 30);
  assert.equal(first[0].message, 'problem 39');
});

test('problems that could not be sent are put back', () => {
  const storage = memory();
  recordProblem('sync', 'Failed', {}, { storage });
  recordProblem('sync', 'Failed', {}, { storage });
  const taken = takeProblems({ storage });
  returnProblems(taken, { storage });
  const again = takeProblems({ storage });
  assert.equal(again.length, 1);
  assert.equal(again[0].count, 2);
});
