import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, id, actor } from './pricing-fixture.mjs';
import { applyEvent } from '../src/domain.mjs';
import { itemMaterialEvents } from '../src/item-material.mjs';

const eventFor = (ledger, materialId = null) => ({
  id: crypto.randomUUID(),
  kind: 'service.updated',
  data: {
    ...ledger.services.find((s) => s.id === id(7)),
    materialId,
    materialOptions: [],
    baseVersion: 1,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: '2026-10-27T10:00:00Z',
  },
});
const draft = {
  name: '',
  unit: 'piece',
  minimum: '2',
  requireSize: false,
  mode: 'none',
  quantity: '10',
  reason: '',
};
const apply = (ledger, events) => events.reduce(applyEvent, ledger);

test('creates and links material using item name; retry does not add stock again', () => {
  const { ledger } = fixture();
  const events = itemMaterialEvents(ledger, eventFor(ledger), draft);
  const next = apply(ledger, events);
  const service = next.services.find((s) => s.id === id(7));
  const material = next.materials.find((m) => m.id === service.materialId);
  assert.equal(material.name, service.description);
  assert.equal(material.available, 10);
  assert.equal(material.minimumStock, 2);
  assert.deepEqual(apply(next, events), next);
  assert.equal(ledger.materials.length + 1, next.materials.length);
});

test('edits material metadata then restocks against the next version, preserving shared links', () => {
  const { ledger } = fixture();
  const material = ledger.materials.find((m) => m.id === id(10));
  ledger.services.find((s) => s.id === id(8)).materialId = material.id;
  const events = itemMaterialEvents(ledger, eventFor(ledger, material.id), {
    ...draft,
    id: material.id,
    name: 'New card',
    mode: 'add',
    quantity: '5',
    reason: 'Restocking',
  });
  const next = apply(ledger, events);
  assert.deepEqual(
    events.map((e) => e.kind),
    ['material.updated', 'material.stock_added', 'service.updated'],
  );
  assert.equal(next.materials.find((m) => m.id === material.id).available, material.available + 5);
  assert.equal(next.services.find((s) => s.id === id(8)).materialId, material.id);
  assert.deepEqual(apply(next, events), next);
});

test('metadata-only changes preserve negative stock; stock count changes it once', () => {
  const { ledger } = fixture();
  const material = ledger.materials.find((m) => m.id === id(10));
  material.available = -50;
  const edit = {
    ...draft,
    id: material.id,
    name: material.name,
    unit: material.measurementUnit,
    requireSize: material.requireSize,
  };
  assert.equal(
    apply(ledger, itemMaterialEvents(ledger, eventFor(ledger, material.id), edit)).materials.find(
      (m) => m.id === material.id,
    ).available,
    -50,
  );
  const next = apply(
    ledger,
    itemMaterialEvents(ledger, eventFor(ledger, material.id), {
      ...edit,
      mode: 'set',
      quantity: '12.5',
      reason: 'Physical count',
    }),
  );
  assert.equal(next.materials.find((m) => m.id === material.id).available, 12.5);
});

test('invalid item, quantity, stale material or missing reason fails before saving', () => {
  const { ledger } = fixture();
  for (const quantity of ['-1', 'NaN', '0.0001'])
    assert.throws(
      () => itemMaterialEvents(ledger, eventFor(ledger), { ...draft, quantity }),
      /Opening stock/,
    );
  assert.throws(() =>
    itemMaterialEvents(
      ledger,
      { ...eventFor(ledger), data: { ...eventFor(ledger).data, description: '' } },
      draft,
    ),
  );
  assert.throws(() => itemMaterialEvents(ledger, eventFor(ledger), { ...draft, id: id(10) }), /changed/);
  assert.throws(
    () => itemMaterialEvents(ledger, eventFor(ledger, id(10)), { ...draft, id: id(10), mode: 'add' }),
    /reason/,
  );
});

test('no-stock and material-choice saves do not create or modify stock', () => {
  const { ledger } = fixture();
  const events = itemMaterialEvents(ledger, eventFor(ledger), null);
  assert.equal(events.length, 1);
  assert.deepEqual(apply(ledger, events).materials, ledger.materials);
});
