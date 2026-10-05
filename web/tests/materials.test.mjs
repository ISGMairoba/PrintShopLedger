import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, applyEvent } from '../src/domain.mjs';
import { normalizeLedger } from '../src/materials.mjs';
const command = (kind = 'material.created', overrides = {}, id = 'event-1') => ({ id, kind, data: {
  id: 'material-1', name: ' Banner vinyl ', available: 12.375, measurementUnit: ' metre ', requireSize: true,
  modifiedBy: 'user-1', modifiedByLabel: 'Owner', modifiedAt: '2026-10-05T10:00:00Z', ...overrides
} });
test('legacy ledgers gain materials without losing jobs', () => {
  const old = { customers: [], jobs: [{ id: 'existing' }], payments: [] };
  assert.deepEqual(normalizeLedger(old).materials, []);
  assert.equal(normalizeLedger(old).jobs, old.jobs);
});
test('create generates full material audit record and keeps other ledger data', () => {
  const before = emptyLedger();
  const next = applyEvent(before, command());
  assert.equal(before.materials.length, 0);
  assert.equal(next.materials[0].name, 'Banner vinyl');
  assert.equal(next.materials[0].measurementUnit, 'metre');
  assert.equal(next.materials[0].available, 12.375);
  assert.equal(next.materials[0].createdBy, 'user-1');
  assert.equal(next.materials[0].createdAt, next.materials[0].modifiedAt);
  assert.equal(next.materials[0].version, 1);
  assert.equal(next.jobs, before.jobs);
});
test('edits preserve creation audit and update modification audit', () => {
  const created = applyEvent(emptyLedger(), command());
  const next = applyEvent(created, command('material.updated', { name: 'Paper', measurementUnit: 'sheet', available: 50, requireSize: false, baseVersion: 1, modifiedBy: 'user-2', modifiedAt: '2026-10-05T11:00:00Z' }, 'event-2'));
  const material = next.materials[0];
  assert.equal(material.createdBy, 'user-1');
  assert.equal(material.createdAt, created.materials[0].createdAt);
  assert.equal(material.modifiedBy, 'user-2');
  assert.equal(material.name, 'Paper');
  assert.equal(material.requireSize, false);
  assert.equal(material.version, 2);
});
test('archive retains quantity and identity; restore permits subsequent edits', () => {
  const created = applyEvent(emptyLedger(), command());
  const archived = applyEvent(created, command('material.archived', { baseVersion: 1 }, 'event-2'));
  assert.equal(archived.materials[0].archived, true);
  assert.equal(archived.materials[0].available, 12.375);
  assert.equal(archived.materials[0].id, 'material-1');
  assert.throws(() => applyEvent(archived, command('material.updated', { baseVersion: 2 }, 'event-3')), /Restore/);
  const restored = applyEvent(archived, command('material.restored', { baseVersion: 2 }, 'event-3'));
  assert.equal(restored.materials[0].archived, false);
  assert.equal(applyEvent(restored, command('material.updated', { baseVersion: 3 }, 'event-4')).materials[0].version, 4);
});
test('retries are idempotent and stale edits are rejected', () => {
  const first = command();
  const created = applyEvent(emptyLedger(), first);
  assert.deepEqual(applyEvent(created, first), created);
  const edit = command('material.updated', { baseVersion: 1 }, 'event-2');
  const edited = applyEvent(created, edit);
  assert.deepEqual(applyEvent(edited, edit), edited);
  assert.throws(() => applyEvent(edited, command('material.updated', { baseVersion: 1 }, 'event-3')), /changed elsewhere/);
  assert.throws(() => applyEvent(edited, command('material.created', {}, 'event-4')), /already in use/);
});
test('invalid names, units, quantities and size flags are rejected', () => {
  for (const data of [{ name: ' ' }, { name: 'a'.repeat(161) }, { measurementUnit: '' }, { measurementUnit: 'a'.repeat(41) },
    { available: -1 }, { available: Infinity }, { available: NaN }, { available: '2' }, { available: 0.0001 }, { requireSize: 'true' }]) {
    assert.throws(() => applyEvent(emptyLedger(), command('material.created', data)));
  }
  assert.equal(applyEvent(emptyLedger(), command('material.created', { available: 0, requireSize: false })).materials[0].available, 0);
});
test('one material edit leaves other materials untouched', () => {
  let ledger = applyEvent(emptyLedger(), command());
  ledger = applyEvent(ledger, command('material.created', { id: 'material-2', name: 'Other' }, 'event-2'));
  const other = ledger.materials[1];
  ledger = applyEvent(ledger, command('material.updated', { baseVersion: 1, available: 3 }, 'event-3'));
  assert.equal(ledger.materials[1], other);
});

test('detail edits cannot change stock quantity', () => {
  const created = applyEvent(emptyLedger(), command());
  const edited = applyEvent(created, command('material.updated', { baseVersion: 1, available: 999 }, 'event-2'));
  assert.equal(edited.materials[0].available, 12.375);
});
test('add to stock adds a decimal quantity and set stock replaces it', () => {
  let ledger = applyEvent(emptyLedger(), command());
  ledger = applyEvent(ledger, command('material.stock_added', { baseVersion: 1, quantity: 2.625 }, 'event-2'));
  assert.equal(ledger.materials[0].available, 15);
  ledger = applyEvent(ledger, command('material.stock_set', { baseVersion: 2, quantity: 0 }, 'event-3'));
  assert.equal(ledger.materials[0].available, 0);
  assert.equal(ledger.materials[0].createdBy, 'user-1');
});
test('stock changes reject zero increments, negative values, invalid precision and archived materials', () => {
  const created = applyEvent(emptyLedger(), command());
  for (const quantity of [0, -1, 0.0001, Infinity]) assert.throws(() => applyEvent(created, command('material.stock_added', { baseVersion: 1, quantity }, 'bad')));
  assert.throws(() => applyEvent(created, command('material.stock_set', { baseVersion: 1, quantity: -1 }, 'bad')));
  const archived = applyEvent(created, command('material.archived', { baseVersion: 1 }, 'archive'));
  assert.throws(() => applyEvent(archived, command('material.stock_set', { baseVersion: 2, quantity: 3 }, 'bad')), /Restore/);
});
