import test from 'node:test';
import assert from 'node:assert/strict';
import { keepCutoff, needsFreshWindow, keepChoice, setKeepChoice } from '../src/history-keep.mjs';

test('history choices give the first day kept, Lagos time', () => {
  assert.equal(keepCutoff('all'), null);
  assert.equal(keepCutoff('7d', '2026-11-06T10:00:00Z'), '2026-10-30');
  assert.equal(keepCutoff('3m', '2026-11-06T10:00:00Z'), '2026-08-06');
  // 23:30 UTC on the 5th is already the 6th in Lagos.
  assert.equal(keepCutoff('7d', '2026-11-05T23:30:00Z'), '2026-10-30');
});

test('a change to a record older than the device keeps asks for a fresh recent copy', () => {
  const ledger = {
    historySummary: { cutoff: '2026-10-30' },
    jobs: [{ id: 'kept', createdAt: '2026-10-01T10:00:00Z' }],
    payments: [],
  };
  assert.equal(
    needsFreshWindow(ledger, { jobs: [{ id: 'kept', createdAt: '2026-10-01T10:00:00Z' }] }),
    false,
    'An old job the device has merges',
  );
  assert.equal(
    needsFreshWindow(ledger, { jobs: [{ id: 'new', createdAt: '2026-11-06T10:00:00Z' }] }),
    false,
    'New work merges',
  );
  assert.equal(
    needsFreshWindow(ledger, { jobs: [{ id: 'old', createdAt: '2026-10-02T10:00:00Z' }] }),
    true,
    'An old job it left out',
  );
  assert.equal(needsFreshWindow(ledger, { payments: [{ id: 'p', paidOn: '2026-10-02' }] }), true);
  assert.equal(
    needsFreshWindow({ jobs: [] }, { jobs: [{ id: 'old', createdAt: '2020-01-01' }] }),
    false,
    'Everything: always merges',
  );
});

test('the choice is kept per business on this device', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  assert.equal(keepChoice('a', storage), 'all');
  setKeepChoice('a', '14d', storage);
  assert.equal(keepChoice('a', storage), '14d');
  assert.equal(keepChoice('b', storage), 'all');
  setKeepChoice('a', 'all', storage);
  assert.equal(store.size, 0);
  assert.throws(() => setKeepChoice('a', '2y', storage));
});
