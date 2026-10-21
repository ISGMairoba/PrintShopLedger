import test from 'node:test';
import assert from 'node:assert/strict';
import { FULL_SYNC_EVERY, mergeChanges, needsFullSync } from '../src/sync-delta.mjs';

test('changed records replace theirs in place; new ones are added', () => {
  const ledger = {
    jobs: [
      { id: 'a', amount: 1 },
      { id: 'b', amount: 2 },
    ],
    customers: [{ id: 'c' }],
  };
  const next = mergeChanges(ledger, {
    jobs: [
      { id: 'b', amount: 5 },
      { id: 'd', amount: 7 },
    ],
    customers: [],
  });
  assert.deepEqual(next.jobs, [
    { id: 'a', amount: 1 },
    { id: 'b', amount: 5 },
    { id: 'd', amount: 7 },
  ]);
  assert.equal(next.customers, ledger.customers, 'untouched collections are kept as they are');
  assert.equal(ledger.jobs[1].amount, 2, 'the old copy is not changed');
});

test('a full download is needed at first, with unsent work, after a repair and every half hour', () => {
  const now = Date.parse('2026-10-21T22:00:00Z');
  const ready = { syncCursor: '123', fullSyncAt: new Date(now - 60000).toISOString(), pending: [] };
  assert.equal(needsFullSync(ready, now), false);
  assert.equal(needsFullSync({ ...ready, syncCursor: undefined }, now), true);
  assert.equal(needsFullSync({ ...ready, pending: [{ id: 'e' }] }, now), true);
  assert.equal(needsFullSync({ ...ready, syncConflicts: { e: 'held' } }, now), true);
  assert.equal(needsFullSync({ ...ready, storageRecovered: 'x' }, now), true);
  assert.equal(
    needsFullSync({ ...ready, fullSyncAt: new Date(now - FULL_SYNC_EVERY - 1).toISOString() }, now),
    true,
  );
});
