import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTileColors,
  tileColorPicker,
  tileColors,
  tileLook,
  toHsl,
  validateTiles,
} from '../src/item-tiles.mjs';
import { applyFieldEvent, cleanTags, displayEvent, suggestCode } from '../src/item-fields.mjs';
import { productTiles } from '../src/quick-sale.mjs';

test('Tile colours come from the brand: light, near its hues, repeatable, another mix on request', () => {
  const colors = generateTileColors('#124b40', '#d9a126', 6, 0);
  assert.equal(colors.length, 6);
  assert.deepEqual(generateTileColors('#124b40', '#d9a126', 6, 0), colors, 'same seed, same colours');
  assert.notDeepEqual(generateTileColors('#124b40', '#d9a126', 6, 1), colors, 'Generate again');
  for (const c of colors) {
    const [, , l] = toHsl(c);
    assert.ok(l > 80, `${c} is light`);
  }
  const [h0] = toHsl('#124b40');
  const [h1] = toHsl(colors[0]);
  const gap = Math.min(Math.abs(h1 - h0), 360 - Math.abs(h1 - h0));
  assert.ok(gap <= 50, 'near the primary hue');
  const dark = tileLook(colors[0], true);
  assert.ok(toHsl(dark.background)[2] < 30, 'dark mode is deeper');
});

test('Tile settings: varied or one colour, by category or item, 3–8 colours, own colours kept', () => {
  assert.deepEqual(validateTiles(undefined), {
    mode: 'varied',
    by: 'category',
    count: 6,
    seed: 0,
    colors: [],
  });
  assert.equal(validateTiles({ count: 9 }).count, 6);
  assert.throws(() => validateTiles({ count: 3, colors: ['#ffffff'] }), /valid colour/);
  const own = ['#ffeeee', '#eeffee', '#eeeeff'];
  assert.deepEqual(tileColors({ count: 3, colors: own }, '#124b40', '#d9a126'), own);
  assert.equal(tileColors({ mode: 'single' }, '#124b40', '#d9a126').length, 1);
  const items = [
    { id: 'a', category: 'Stationery' },
    { id: 'b', category: 'Gifts' },
    { id: 'c', category: 'Stationery' },
  ];
  const byCategory = tileColorPicker({}, items, 3);
  assert.equal(byCategory(items[0]), byCategory(items[2]), 'a category shares a colour');
  assert.notEqual(byCategory(items[0]), byCategory(items[1]));
  assert.equal(tileColorPicker({ mode: 'single' }, items, 3)(items[1]), 0);
});

test('Item code (unique, suggested from the category) and tags (up to 10) are searchable', () => {
  const actor = { id: 'u', label: 'Ada' };
  let ledger = {
    services: [
      { id: 's1', description: 'Pen', version: 1, category: 'Stationery', code: 'STA-001' },
      { id: 's2', description: 'Ruler', version: 1, category: 'Stationery' },
    ],
    customers: [],
  };
  assert.equal(suggestCode(ledger.services, 'Stationery', 's2'), 'STA-002');
  assert.equal(suggestCode(ledger.services, ''), 'ITM-001');
  assert.throws(
    () =>
      applyFieldEvent(
        ledger,
        displayEvent(ledger.services[1], { icon: '', category: 'Stationery', code: 'sta-001' }, actor),
      ),
    /already has the code/,
  );
  assert.throws(
    () => displayEvent(ledger.services[1], { icon: '', category: '', code: 'bad code' }, actor),
    /Item codes/,
  );
  assert.throws(() => cleanTags(Array.from({ length: 11 }, (_, i) => `t${i}`)), /up to 10 tags/);
  assert.deepEqual(cleanTags([' School ', 'school', 'office  supplies']), ['School', 'office supplies']);
  ledger = applyFieldEvent(
    ledger,
    displayEvent(
      ledger.services[1],
      { icon: 'ruler', category: 'Stationery', code: 'RUL-30', tags: ['school', 'maths'] },
      actor,
    ),
  );
  assert.deepEqual([ledger.services[1].code, ledger.services[1].tags], ['RUL-30', ['school', 'maths']]);
  const products = ledger.services.map((s) => ({
    ...s,
    name: s.description,
    productName: s.description,
    variantGroup: null,
    variantName: null,
    tags: s.tags ?? [],
  }));
  assert.deepEqual(
    productTiles(products, 'maths').map((t) => t.product.id),
    ['s2'],
    'by tag',
  );
  assert.deepEqual(
    productTiles(products, 'sta-001').map((t) => t.product.id),
    ['s1'],
    'by code',
  );
});
