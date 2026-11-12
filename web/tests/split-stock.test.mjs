import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger } from '../src/domain.mjs';
import { applyMaterialEvent, splitPlan } from '../src/materials.mjs';

const ev = (kind, data, id = crypto.randomUUID()) => ({
  id,
  kind,
  data: { modifiedBy: 'u', modifiedByLabel: 'Owner', modifiedAt: '2026-11-12T10:00:00Z', ...data },
});
const create = (l, id, name, available) =>
  applyMaterialEvent(
    l,
    ev('material.created', {
      id,
      name,
      available,
      measurementUnit: 'sheets',
      requireSize: false,
      canSplit: true,
    }),
  );

test('split stock: A4 into A5, and back together to fix a mistake', () => {
  let l = create(create(emptyLedger(), 'a4', 'A4', 100), 'a5', 'A5', 4);
  const v = (id) => l.materials.find((m) => m.id === id);
  l = applyMaterialEvent(
    l,
    ev('material.split', {
      id: 'a4',
      baseVersion: 1,
      toId: 'a5',
      toBaseVersion: 1,
      toEventId: 'h2',
      quantity: 10,
      yield: 2,
      reason: 'Cut',
    }),
  );
  assert.equal(v('a4').available, 90);
  assert.equal(v('a5').available, 24);
  assert.deepEqual(
    l.materialHistory
      .filter((h) => h.action === 'material.split')
      .map((h) => [h.materialId, h.beforeAvailable, h.afterAvailable]),
    [
      ['a4', 100, 90],
      ['a5', 4, 24],
    ],
  );
  l = applyMaterialEvent(
    l,
    ev('material.split', {
      id: 'a4',
      baseVersion: 2,
      toId: 'a5',
      toBaseVersion: 2,
      toEventId: 'h4',
      quantity: 3,
      yield: 2,
      join: true,
    }),
  );
  assert.equal(v('a4').available, 93);
  assert.equal(v('a5').available, 18);
  assert.throws(
    () =>
      applyMaterialEvent(
        l,
        ev('material.split', {
          id: 'a4',
          baseVersion: 1,
          toId: 'a5',
          toBaseVersion: 3,
          toEventId: 'h5',
          quantity: 1,
          yield: 2,
        }),
      ),
    /changed elsewhere/,
  );
  assert.throws(() => splitPlan(v('a4'), v('a5'), 0, 2), /greater than zero/);
  assert.throws(
    () =>
      applyMaterialEvent(
        l,
        ev('material.split', {
          id: 'a4',
          baseVersion: 3,
          toId: 'a4',
          toBaseVersion: 3,
          toEventId: 'h6',
          quantity: 1,
          yield: 2,
        }),
      ),
    /other material/,
  );
});

test('split stock: only a material that can be split', () => {
  let l = applyMaterialEvent(
    emptyLedger(),
    ev('material.created', {
      id: 'card',
      name: 'Card',
      available: 10,
      measurementUnit: 'sheets',
      requireSize: false,
    }),
  );
  l = applyMaterialEvent(
    l,
    ev('material.created', {
      id: 'half',
      name: 'Half card',
      available: 0,
      measurementUnit: 'sheets',
      requireSize: false,
    }),
  );
  assert.equal(l.materials[0].canSplit, false, 'off unless turned on');
  assert.throws(
    () =>
      applyMaterialEvent(
        l,
        ev('material.split', {
          id: 'card',
          baseVersion: 1,
          toId: 'half',
          toBaseVersion: 1,
          toEventId: 'h',
          quantity: 1,
          yield: 2,
        }),
      ),
    /Can be split/,
  );
});

test('split stock into several pieces: 1 A2 makes 1 A3 + 1 A4 + 2 A7, and offcuts are allowed', () => {
  let l = create(create(create(create(emptyLedger(), 'a2', 'A2', 10), 'a3', 'A3', 0), 'a4', 'A4', 5), 'a7', 'A7', 0);
  const v = (id) => l.materials.find((m) => m.id === id);
  const pieces = [
    { toId: 'a3', toBaseVersion: 1, toEventId: 'p1', yield: 1 },
    { toId: 'a4', toBaseVersion: 1, toEventId: 'p2', yield: 1 },
    { toId: 'a7', toBaseVersion: 1, toEventId: 'p3', yield: 2 },
  ];
  l = applyMaterialEvent(l, ev('material.split', { id: 'a2', baseVersion: 1, pieces, quantity: 3 }));
  assert.deepEqual(
    ['a2', 'a3', 'a4', 'a7'].map((id) => v(id).available),
    [7, 3, 8, 6],
  );
  assert.equal(l.materialHistory.filter((h) => h.action === 'material.split').length, 4);
  // Put back together reverses every piece.
  l = applyMaterialEvent(
    l,
    ev('material.split', {
      id: 'a2',
      baseVersion: 2,
      join: true,
      quantity: 1,
      pieces: pieces.map((p, i) => ({ ...p, toBaseVersion: 2, toEventId: `j${i}` })),
    }),
  );
  assert.deepEqual(
    ['a2', 'a3', 'a4', 'a7'].map((id) => v(id).available),
    [8, 2, 7, 4],
  );
  // The same smaller material twice, or the material itself, is refused.
  for (const bad of [
    [pieces[0], { ...pieces[0], toEventId: 'x' }],
    [{ ...pieces[0], toId: 'a2' }],
  ])
    assert.throws(
      () =>
        applyMaterialEvent(
          l,
          ev('material.split', {
            id: 'a2',
            baseVersion: 3,
            quantity: 1,
            pieces: bad.map((p, i) => ({ ...p, toBaseVersion: 3, toEventId: `b${i}` })),
          }),
        ),
      /once|other material/,
    );
});
