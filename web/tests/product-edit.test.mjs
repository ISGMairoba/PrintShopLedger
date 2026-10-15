import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, actor } from './pricing-fixture.mjs';
import { applyEvent } from '../src/domain.mjs';
import { editableProducts, productEditEvents } from '../src/product-edit.mjs';

const apply = (ledger, events) => events.reduce(applyEvent, ledger);

test('renaming a product renames its stock item too, with the price, minimum and a restock', () => {
  const { ledger } = fixture();
  const { events, summary } = productEditEvents(
    ledger,
    id(7),
    {
      name: 'Art card 300gsm',
      price: 25000,
      renameStock: true,
      minimumStock: 20,
      stock: { mode: 'add', quantity: 50, reason: 'Restocking' },
    },
    actor,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ['service.updated', 'material.updated', 'material.stock_added'],
  );
  assert.equal(summary.length, 5);
  const next = apply(ledger, events);
  const service = next.services.find((s) => s.id === id(7));
  const material = next.materials.find((m) => m.id === id(10));
  assert.equal(service.description, 'Art card 300gsm');
  assert.equal(service.price, 25000);
  assert.equal(service.shelfItem, true);
  assert.deepEqual(service.costing, ledger.services.find((s) => s.id === id(7)).costing);
  assert.equal(material.name, 'Art card 300gsm');
  assert.equal(material.minimumStock, 20);
  assert.equal(material.available, 150);
  assert.equal(material.version, 3);
});

test('a count sets stock; the stock item keeps its name when not renamed', () => {
  const { ledger } = fixture();
  const { events } = productEditEvents(
    ledger,
    id(7),
    {
      name: 'Art card',
      price: 20000,
      renameStock: false,
      minimumStock: 0,
      stock: { mode: 'set', quantity: 12.5, reason: 'Stock Count Correction' },
    },
    actor,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ['material.stock_set'],
  );
  const next = apply(ledger, events);
  assert.equal(next.materials.find((m) => m.id === id(10)).available, 12.5);
  assert.equal(next.materials.find((m) => m.id === id(10)).name, 'Art card');
});

test('checks: nothing changed, a reason is needed, and services without stock only change name and price', () => {
  const { ledger } = fixture();
  const same = {
    name: 'Art card',
    price: 20000,
    renameStock: false,
    minimumStock: 0,
    stock: { mode: 'none' },
  };
  assert.throws(() => productEditEvents(ledger, id(7), same, actor), /Nothing has changed/);
  assert.throws(
    () =>
      productEditEvents(ledger, id(7), { ...same, stock: { mode: 'add', quantity: 5, reason: '' } }, actor),
    /reason/,
  );
  assert.throws(
    () =>
      productEditEvents(ledger, id(7), { ...same, stock: { mode: 'add', quantity: 0, reason: 'x' } }, actor),
    /greater than zero/,
  );
  assert.throws(
    () =>
      productEditEvents(
        ledger,
        id(8),
        { ...same, name: 'Binding labour', stock: { mode: 'add', quantity: 1, reason: 'x' } },
        actor,
      ),
    /no stock item/,
  );
  const { events } = productEditEvents(ledger, id(8), { ...same, name: 'Binding work', price: 0 }, actor);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['service.updated'],
  );
  assert.equal(apply(ledger, events).services.find((s) => s.id === id(8)).private, true);
});

test('shared stock items are flagged', () => {
  const { ledger } = fixture();
  ledger.services.push({ ...ledger.services[2], id: id(77), description: 'Art card cut', costing: null });
  const art = editableProducts(ledger).find((p) => p.service.id === id(7));
  assert.deepEqual(
    art.sharedWith.map((s) => s.id),
    [id(77)],
  );
});

test('the unit can be changed from the product editor', () => {
  const { ledger } = fixture();
  const material = ledger.materials.find((m) => m.id === id(10));
  const { events, summary } = productEditEvents(
    ledger,
    id(7),
    {
      name: ledger.services.find((s) => s.id === id(7)).description,
      price: ledger.services.find((s) => s.id === id(7)).price,
      renameStock: false,
      unit: 'sheet',
      minimumStock: material.minimumStock ?? 0,
      stock: { mode: 'none' },
    },
    actor,
  );
  assert.deepEqual(summary, [`Change the unit from ${material.measurementUnit} to sheet`]);
  const next = apply(ledger, events);
  const after = next.materials.find((m) => m.id === id(10));
  assert.equal(after.measurementUnit, 'sheet');
  assert.equal(after.available, material.available);
});
