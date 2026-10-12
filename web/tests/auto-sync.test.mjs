import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoSync } from '../src/auto-sync.mjs';
function clock() {
  let id = 0;
  const tasks = new Map();
  return {
    schedule(fn, ms) {
      tasks.set(++id, { fn, ms });
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    tasks,
    async tick() {
      const first = tasks.entries().next().value;
      assert.ok(first);
      tasks.delete(first[0]);
      first[1].fn();
      await new Promise((resolve) => setImmediate(resolve));
    },
    delay() {
      return tasks.values().next().value?.ms;
    },
  };
}
test('connects on startup, debounces saves and polls cloud updates', async () => {
  const time = clock();
  let calls = 0;
  const status = [];
  const sync = createAutoSync({
    ...time,
    run: async () => {
      calls++;
    },
    onStatus: (s) => status.push(s),
  });
  sync.wake();
  assert.equal(time.delay(), 0);
  await time.tick();
  assert.equal(calls, 1);
  assert.equal(time.delay(), 30000);
  sync.request();
  sync.request();
  assert.equal(time.tasks.size, 1);
  assert.equal(time.delay(), 500);
  await time.tick();
  assert.equal(calls, 2);
  assert.deepEqual(status, ['syncing', 'saved', 'syncing', 'saved']);
  sync.dispose();
  assert.equal(time.tasks.size, 0);
});
test('offline pauses requests; reconnect wakes immediately', async () => {
  const time = clock();
  let online = false,
    calls = 0;
  const sync = createAutoSync({
    ...time,
    canRun: () => online,
    run: async () => {
      calls++;
    },
  });
  sync.wake();
  await time.tick();
  assert.equal(calls, 0);
  online = true;
  sync.wake();
  assert.equal(time.delay(), 0);
  await time.tick();
  assert.equal(calls, 1);
  sync.dispose();
});
test('temporary server failures retry with bounded backoff, then recover', async () => {
  const time = clock();
  let fails = true;
  const status = [];
  const sync = createAutoSync({
    ...time,
    run: async () => {
      if (fails) throw Error('Server unreachable');
    },
    onStatus: (s) => status.push(s),
  });
  sync.wake();
  await time.tick();
  assert.equal(time.delay(), 2000);
  await time.tick();
  assert.equal(time.delay(), 4000);
  for (let i = 0; i < 7; i++) await time.tick();
  assert.equal(time.delay(), 60000);
  fails = false;
  await time.tick();
  assert.equal(status.at(-1), 'saved');
  assert.equal(time.delay(), 30000);
  sync.dispose();
});
test('new work during a sync schedules another pass without concurrent runs', async () => {
  const time = clock();
  let release,
    calls = 0;
  const sync = createAutoSync({
    ...time,
    run: () => {
      calls++;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  sync.wake();
  await time.tick();
  sync.request();
  sync.wake();
  assert.equal(calls, 1);
  assert.equal(time.tasks.size, 0);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(time.delay(), 500);
  sync.dispose();
});
test('conflicts pause until reviewed, cleanup ignores an old workspace result', async () => {
  const time = clock();
  let blocked = true;
  const statuses = [];
  const sync = createAutoSync({
    ...time,
    run: async () => {
      if (blocked) throw Error('Conflict');
    },
    onError: () => 'pause',
    onStatus: (s) => statuses.push(s),
  });
  sync.wake();
  await time.tick();
  assert.equal(statuses.at(-1), 'attention');
  assert.equal(time.tasks.size, 0);
  sync.request();
  assert.equal(time.tasks.size, 0);
  blocked = false;
  sync.wake();
  await time.tick();
  assert.equal(statuses.at(-1), 'saved');
  sync.dispose();
  const second = clock();
  let finish;
  const completed = [];
  const old = createAutoSync({
    ...second,
    run: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    onStatus: (s) => completed.push(s),
  });
  old.wake();
  await second.tick();
  old.dispose();
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(completed, ['syncing']);
  assert.equal(second.tasks.size, 0);
});

import { isTransientSyncError } from '../src/auto-sync.mjs';
test('slow or dropped connections are retried quietly; data problems are not', () => {
  assert.ok(isTransientSyncError(new Error('TimeoutError: signal timed out')));
  assert.ok(
    isTransientSyncError(
      new Error('Sync paused: TypeError: Failed to fetch. Your pending work is still saved locally.'),
    ),
  );
  assert.ok(isTransientSyncError(new TypeError('Load failed')));
  assert.ok(
    isTransientSyncError(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
  );
  assert.ok(!isTransientSyncError(new Error('Business access denied')));
  assert.ok(
    !isTransientSyncError(new Error('Your sign-in changed. Sign in again before syncing this workspace.')),
  );
});
