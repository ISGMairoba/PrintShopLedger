import test from 'node:test';
import assert from 'node:assert/strict';
import { latestActivity, shouldLock } from '../src/auto-lock.mjs';

test('auto-lock: locks only when idle long enough, online, not saving, and turned on', () => {
  const base = { now: 10 * 60_000, lastActivity: 0, minutes: 10, online: true };
  assert.equal(shouldLock(base), true);
  assert.equal(shouldLock({ ...base, lastActivity: 1 }), false);
  assert.equal(shouldLock({ ...base, minutes: 0 }), false);
  assert.equal(shouldLock({ ...base, online: false }), false);
  assert.equal(shouldLock({ ...base, busy: true }), false);
});

test('auto-lock: use in another tab counts as activity', () => {
  assert.equal(latestActivity(100, '250'), 250);
  assert.equal(latestActivity(300, '250'), 300);
  assert.equal(latestActivity(300, null), 300);
  assert.equal(latestActivity(300, 'junk'), 300);
});
