import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { quoteLine } from '../src/checkout.mjs';
import {
  addVariantEvents,
  newVariantProductEvents,
  syncVariantEvents,
  variantBase,
  variantEditEvents,
  variantGroups,
} from '../src/variants.mjs';

const actor = { id: 'u', label: 'Ada' };
const packs = [{ quantity: 25, price: 150000 }];
const build = () => {
  let ledger = emptyLedger();
  const events = newVariantProductEvents(
    ledger,
    {
      name: 'Envelope',
      unit: 'piece',
      price: 10000,
      packPrices: packs,
      variants: [
        { name: 'Pink', stock: 400 },
        { name: 'Blue', stock: 600, minimum: 50 },
        { name: '', stock: 5 },
      ],
    },
    actor,
    '2026-10-15T09:00:00Z',
  );
  for (const e of events) ledger = applyEvent(ledger, e);
  return ledger;
};

test('A product with variants: one stock item and one item for sale per variant, sharing price and packs', () => {
  const ledger = build();
  const [group] = variantGroups(ledger);
  assert.equal(group.name, 'Envelope');
  assert.deepEqual(
    group.members.map((m) => [m.service.description, m.material.name, m.material.available, m.service.price]),
    [
      ['Envelope — Blue', 'Envelope — Blue', 600, 10000],
      ['Envelope — Pink', 'Envelope — Pink', 400, 10000],
    ],
  );
  assert.equal(group.members[0].material.minimumStock, 50);
  assert.equal(variantBase(group.members[1].service), 'Envelope');
  assert.throws(
    () =>
      newVariantProductEvents(
        emptyLedger(),
        { name: 'X', unit: 'piece', price: 1, variants: [{ name: 'A' }] },
        actor,
      ),
    /at least two/,
  );
  assert.throws(
    () =>
      newVariantProductEvents(
        emptyLedger(),
        { name: 'X', unit: 'piece', price: 1, variants: [{ name: 'Red' }, { name: 'red' }] },
        actor,
      ),
    /twice/,
  );
});

test('Each variant is priced on its own: 10 Pink and 15 Blue never make a pack of 25', () => {
  const ledger = build();
  const [{ members }] = variantGroups(ledger);
  const line = (service, quantity) =>
    quoteLine(ledger, {
      serviceId: service.id,
      description: service.description,
      quantity,
      width: '',
      height: '',
      source: 'In shop / USB',
    });
  assert.equal(line(members[1].service, '10').amount + line(members[0].service, '15').amount, 250000);
  assert.equal(line(members[0].service, '25').amount, 150000);
  assert.equal(line(members[0].service, '25').materialNeeded, 25);
});

test('Name, price and pack changes go to every variant; a new variant copies the product', () => {
  let ledger = build();
  const [group] = variantGroups(ledger);
  const { events, summary } = syncVariantEvents(
    ledger,
    group.id,
    { name: 'Long envelope', price: 12000, packPrices: [{ quantity: 25, price: 160000 }] },
    actor,
  );
  assert.equal(summary.length, 3);
  for (const e of events) ledger = applyEvent(ledger, e);
  const after = variantGroups(ledger)[0];
  assert.equal(after.name, 'Long envelope');
  assert.ok(
    after.members.every((m) => m.service.price === 12000 && m.service.packPrices[0].price === 160000),
  );
  assert.ok(after.members.every((m) => m.material.name === m.service.description));
  for (const e of addVariantEvents(ledger, group.id, { name: 'White', stock: 250 }, actor))
    ledger = applyEvent(ledger, e);
  const white = variantGroups(ledger)[0].members.find((m) => m.service.variantName === 'White');
  assert.equal(white.service.description, 'Long envelope — White');
  assert.equal(white.service.price, 12000);
  assert.equal(white.material.available, 250);
  assert.throws(() => addVariantEvents(ledger, group.id, { name: 'white' }, actor), /twice/);
});

test('Editing a variant: price for all, stock for this one only', () => {
  let ledger = build();
  const blue = variantGroups(ledger)[0].members[0];
  const { events, summary } = variantEditEvents(
    ledger,
    blue.service.id,
    {
      name: 'Envelope',
      price: 12000,
      packPrices: packs,
      minimumStock: 50,
      stock: { mode: 'add', quantity: 100, reason: 'Restock' },
    },
    actor,
  );
  for (const e of events) ledger = applyEvent(ledger, e);
  const [group] = variantGroups(ledger);
  assert.deepEqual(
    group.members.map((m) => [m.service.variantName, m.service.price, m.material.available]),
    [
      ['Blue', 12000, 700],
      ['Pink', 12000, 400],
    ],
  );
  assert.deepEqual(summary, [
    'Change the price of all 2 variants',
    'Blue: Add 100 piece to stock (700 after)',
  ]);
  assert.throws(
    () =>
      variantEditEvents(
        ledger,
        blue.service.id,
        { name: 'Envelope', price: 12000, packPrices: packs, minimumStock: 50, stock: { mode: 'none' } },
        actor,
      ),
    /Nothing has changed/,
  );
});

test('Quick sale shows a product with variants as one tile with a button per variant', async () => {
  const { shelfProducts, productTiles } = await import('../src/quick-sale.mjs');
  const ledger = build();
  const tiles = productTiles(shelfProducts(ledger));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].kind, 'group');
  assert.equal(tiles[0].name, 'Envelope');
  assert.deepEqual(
    tiles[0].variants.map((v) => [v.variantName, v.stock]),
    [
      ['Blue', 600],
      ['Pink', 400],
    ],
  );
  assert.deepEqual(
    productTiles(shelfProducts(ledger), 'pink')[0].variants.map((v) => v.variantName),
    ['Pink'],
  );
});
