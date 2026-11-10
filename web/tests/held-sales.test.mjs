import test from 'node:test';
import assert from 'node:assert/strict';
import { heldLabel, holdSale, isOld, listHeld, removeHeld } from '../src/held-sales.mjs';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
};
const sale = (id, heldAt, extra = {}) => ({
  id,
  kind: 'quick',
  heldAt,
  heldBy: 'Ada',
  customerName: '',
  items: ['2 × Pen'],
  total: 40000,
  data: {},
  ...extra,
});

test('held sales: hold, list newest first, resume replaces, remove', () => {
  const store = memory();
  holdSale(store, 'shop', sale('a', '2026-11-10T08:00:00Z'));
  holdSale(store, 'shop', sale('b', '2026-11-10T09:00:00Z'));
  assert.deepEqual(
    listHeld(store, 'shop').map((h) => h.id),
    ['b', 'a'],
  );
  holdSale(store, 'shop', sale('a', '2026-11-10T10:00:00Z', { items: ['3 × Pen'] }));
  assert.equal(listHeld(store, 'shop').length, 2, 'holding a resumed sale again replaces it');
  assert.equal(listHeld(store, 'shop')[0].items[0], '3 × Pen');
  assert.deepEqual(listHeld(store, 'other'), [], 'each business keeps its own');
  removeHeld(store, 'shop', 'a');
  assert.deepEqual(
    listHeld(store, 'shop').map((h) => h.id),
    ['b'],
  );
});

test('held sales: blocked or broken storage does not break the page', () => {
  const broken = {
    getItem: () => '{not json',
    setItem: () => {
      throw Error('full');
    },
  };
  assert.deepEqual(listHeld(broken, 'shop'), []);
  assert.deepEqual(listHeld(null, 'shop'), []);
  assert.throws(() => holdSale(broken, 'shop', sale('a', '2026-11-10T08:00:00Z')), /could not keep the sale/);
});

test('held sales: at most 30 per device; old ones are flagged; labels', () => {
  const store = memory();
  for (let i = 0; i < 30; i++) holdSale(store, 'shop', sale(`s${i}`, '2026-11-10T08:00:00Z'));
  assert.throws(() => holdSale(store, 'shop', sale('x', '2026-11-10T08:00:00Z')), /already holds 30/);
  const now = Date.parse('2026-11-12T09:00:00Z');
  assert.equal(isOld(sale('a', '2026-11-10T08:00:00Z'), now), true);
  assert.equal(isOld(sale('a', '2026-11-11T08:00:00Z'), now), false);
  assert.equal(
    heldLabel(sale('a', '', { customerName: 'Bayo', items: ['A', 'B', 'C'] })),
    'Bayo · A, B +1 more',
  );
  assert.equal(heldLabel(sale('a', '', { items: [] })), 'No customer yet · No items');
});
