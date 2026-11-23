import test from 'node:test';
import assert from 'node:assert/strict';
import { keepPeople } from '../src/device-people.mjs';

const person = (userId, passwordAt, seenAt = passwordAt) => ({
  userId,
  name: userId,
  username: userId,
  rank: 1,
  session: {},
  passwordAt,
  seenAt,
});

test('a device remembers people for the chosen days after their password sign-in', () => {
  const now = '2026-11-30T12:00:00.000Z';
  const kept = keepPeople(
    [person('ada', '2026-11-01T11:00:00.000Z'), person('tunde', '2026-11-29T09:00:00.000Z')],
    { days: 28, max: 10, now },
  );
  assert.deepEqual(kept.map((p) => p.userId), ['tunde']);
});

test('at most the chosen number of people, keeping the most recently seen', () => {
  const now = '2026-11-30T12:00:00.000Z';
  const people = ['a', 'b', 'c'].map((id, i) =>
    person(id, '2026-11-29T00:00:00.000Z', `2026-11-29T0${i}:00:00.000Z`),
  );
  assert.deepEqual(keepPeople(people, { days: 30, max: 2, now }).map((p) => p.userId), ['c', 'b']);
});
