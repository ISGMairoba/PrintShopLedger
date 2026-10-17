import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { PIECE_SIZE, loadState, sameState, splitState, writeState } from '../src/storage-core.mjs';

const scope = 'user-1:shop-1';
const lost = () => Object.assign(new Error('Data lost due to missing file.'), { name: 'UnknownError' });

/** An in-memory store; keys listed in `broken` fail to read the way a lost file does. */
function memory(initial = {}) {
  const data = new Map(Object.entries(initial)),
    broken = new Set(),
    writes = [];
  return {
    data,
    broken,
    writes,
    keys: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix) && k < prefix + '￿').sort(),
    get: async (key) => {
      if (broken.has(key)) throw lost();
      return structuredClone(data.get(key));
    },
    put: async (key, value) => {
      writes.push(key);
      broken.delete(key);
      data.set(key, structuredClone(value));
    },
    delete: async (key) => {
      broken.delete(key);
      data.delete(key);
    },
  };
}
const job = (n) => ({ id: `job-${n}`, description: `Job ${n}`, amount: n * 100 });
function shop(jobs = 250) {
  const ledger = emptyLedger();
  ledger.jobs = Array.from({ length: jobs }, (_, i) => job(i));
  ledger.customers = [{ id: 'c1', name: 'Bello', phone: '0801', address: '', creditLimit: 0 }];
  return {
    ledger,
    pending: [{ id: 'e1', kind: 'job.status_changed', data: { id: 'job-1' } }],
    lastSynced: '2026-10-16T19:01:55Z',
  };
}

test('an old single record moves to small pieces once, and nothing is lost', async () => {
  const store = memory({ [scope]: shop() });
  const loaded = await loadState(store, scope, { writable: true });
  assert.equal(loaded.migrated, true);
  assert.equal(store.data.has(scope), false, 'old record removed after the move');
  assert.equal(loaded.state.ledger.jobs.length, 250);
  const jobPieces = [...store.data.keys()].filter((k) => k.includes('|L|jobs|'));
  assert.equal(jobPieces.length, Math.ceil(250 / PIECE_SIZE));
  const again = await loadState(store, scope, { writable: false });
  assert.ok(sameState(again.state, loaded.state));
  assert.equal(again.state.pending.length, 1);
  assert.equal(again.state.lastSynced, '2026-10-16T19:01:55Z');
});

test('a read-only look at an old record asks for a write instead of changing anything', async () => {
  const store = memory({ [scope]: shop() });
  assert.deepEqual(await loadState(store, scope, { writable: false }), { needsWrite: true });
  assert.equal(store.data.has(scope), true);
});

test('a save writes only the pieces that changed, plus the outbox', async () => {
  const store = memory({ [scope]: shop() });
  const loaded = await loadState(store, scope, { writable: true });
  store.writes.length = 0;
  const state = loaded.state;
  const next = {
    ...state,
    ledger: {
      ...state.ledger,
      jobs: state.ledger.jobs.map((j) => (j.id === 'job-240' ? { ...j, amount: 1 } : j)),
    },
    pending: [...state.pending, { id: 'e2', kind: 'job.status_changed', data: { id: 'job-240' } }],
  };
  await writeState(store, scope, loaded.records, next);
  // The changed jobs piece, the outbox, and the small meta record (its revision moves on).
  assert.deepEqual(store.writes.sort(), [`${scope}|L|jobs|2`, `${scope}|meta`, `${scope}|outbox`].sort());
});

test('a cached copy is reused only while no other tab has written', async () => {
  const store = memory({ [scope]: shop() });
  const first = await loadState(store, scope, { writable: true });
  let reads = 0;
  const get = store.get;
  store.get = async (key) => {
    reads++;
    return get(key);
  };
  const cached = await loadState(store, scope, { writable: true, cached: first.records });
  assert.equal(reads, 1, 'only the small meta record is read');
  cached.state.ledger.jobs[0].amount = -5; // the app changing its copy cannot touch the cache
  assert.equal(first.records.get(`${scope}|L|jobs|0`)[0].amount, 0);
  // Another tab saves: the revision moves on, so the next load reads everything again.
  const other = await loadState(store, scope, { writable: true });
  await writeState(store, scope, other.records, { ...other.state, pending: [] });
  reads = 0;
  const fresh = await loadState(store, scope, { writable: true, cached: first.records });
  assert.ok(reads > 1);
  assert.equal(fresh.state.pending.length, 0);
});

test('a lost piece: the records are downloaded again, the unsynced changes stay', async () => {
  const store = memory({ [scope]: shop() });
  await loadState(store, scope, { writable: true });
  store.broken.add(`${scope}|L|jobs|1`);
  assert.deepEqual(await loadState(store, scope, { writable: false }), { needsWrite: true });
  const repaired = await loadState(store, scope, { writable: true });
  assert.equal(repaired.repaired, true);
  assert.ok(repaired.state.storageRecovered);
  assert.equal(repaired.state.ledger.jobs.length, 0, 'records come back with the next download');
  assert.equal(repaired.state.lastSynced, undefined, 'the next sync downloads everything');
  assert.deepEqual(
    repaired.state.pending.map((e) => e.id),
    ['e1'],
  );
  const after = await loadState(store, scope, { writable: false });
  assert.equal(after.state.pending.length, 1, 'the repaired copy reads cleanly');
});

test('a lost outbox comes back from the separate backup', async () => {
  const store = memory({ [scope]: shop() });
  await loadState(store, scope, { writable: true });
  store.broken.add(`${scope}|outbox`);
  const backup = () => [{ id: 'e9', kind: 'job.status_changed', data: { id: 'job-9' } }];
  const repaired = await loadState(store, scope, { writable: true, backup });
  assert.deepEqual(
    repaired.state.pending.map((e) => e.id),
    ['e9'],
  );
});

test('a lost old single record: start again from the backup and the server', async () => {
  const store = memory({ [scope]: shop() });
  store.broken.add(scope);
  const backup = () => [{ id: 'e7', kind: 'job.status_changed', data: { id: 'job-7' } }];
  const repaired = await loadState(store, scope, { writable: true, backup });
  assert.equal(repaired.repaired, true);
  assert.equal(store.data.has(scope), false);
  assert.equal(repaired.state.pending[0].id, 'e7');
});

test('a first visit starts empty; pieces shrink when collections do', async () => {
  const store = memory();
  const first = await loadState(store, scope, { writable: true });
  assert.equal(first.state.ledger.jobs.length, 0);
  const written = await writeState(store, scope, first.records, shop(250));
  const smaller = shop(50);
  await writeState(store, scope, written, smaller);
  assert.equal([...store.data.keys()].filter((k) => k.includes('|L|jobs|')).length, 1);
  const split = splitState(scope, smaller);
  assert.equal(split.get(`${scope}|meta`).pieces.jobs, 1);
});
