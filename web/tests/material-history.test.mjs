import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, emptyLedger } from '../src/domain.mjs';
import { materialCode, stockReasonSuggestions } from '../src/material-display.mjs';
const command = (id, kind, fields = {}) => ({
  id,
  kind,
  data: {
    id: 'm',
    name: 'Paper',
    available: 0,
    measurementUnit: 'sheet',
    requireSize: false,
    modifiedBy: 'owner',
    modifiedByLabel: 'Owner',
    modifiedAt: '2026-10-05T12:00:00Z',
    ...fields,
  },
});
test('every material action records immutable before and after state', () => {
  let ledger = applyEvent(emptyLedger(), command('create', 'material.created'));
  const create = ledger.materialHistory[0];
  assert.equal(create.before, null);
  assert.equal(create.afterAvailable, 0);
  ledger = applyEvent(
    ledger,
    command('add', 'material.stock_added', { baseVersion: 1, quantity: 10.5, reason: ' Restocking ' }),
  );
  ledger = applyEvent(
    ledger,
    command('edit', 'material.updated', {
      baseVersion: 2,
      name: 'Card paper',
      measurementUnit: 'pack',
      requireSize: true,
      available: 10.5,
    }),
  );
  ledger = applyEvent(
    ledger,
    command('set', 'material.stock_set', { baseVersion: 3, quantity: 7, reason: 'Stock Count Correction' }),
  );
  ledger = applyEvent(ledger, command('archive', 'material.archived', { baseVersion: 4 }));
  ledger = applyEvent(ledger, command('restore', 'material.restored', { baseVersion: 5 }));
  assert.equal(ledger.materialHistory.length, 6);
  assert.deepEqual(
    ledger.materialHistory.map((item) => item.action),
    [
      'material.created',
      'material.stock_added',
      'material.updated',
      'material.stock_set',
      'material.archived',
      'material.restored',
    ],
  );
  const edit = ledger.materialHistory[2];
  assert.equal(edit.before.name, 'Paper');
  assert.equal(edit.after.name, 'Card paper');
  assert.equal(edit.before.measurementUnit, 'sheet');
  assert.equal(edit.after.measurementUnit, 'pack');
  assert.equal(edit.before.requireSize, false);
  assert.equal(edit.after.requireSize, true);
  assert.equal(edit.beforeAvailable, 10.5);
  assert.equal(edit.afterAvailable, 10.5);
  assert.equal(ledger.materialHistory[1].reason, 'Restocking');
  assert.equal(ledger.materialHistory[4].after.archived, true);
  assert.equal(ledger.materialHistory[5].after.archived, false);
  assert.equal(create.after.name, 'Paper');
});
test('replaying an older acknowledged event never duplicates history or rewinds stock', () => {
  const create = command('create', 'material.created');
  let ledger = applyEvent(emptyLedger(), create);
  ledger = applyEvent(ledger, command('add', 'material.stock_added', { baseVersion: 1, quantity: 3 }));
  assert.deepEqual(applyEvent(ledger, create), ledger);
  assert.equal(ledger.materialHistory.length, 2);
  assert.equal(ledger.materials[0].available, 3);
});
test('compact material IDs expand when a prefix collision occurs', () => {
  const first = '12345678-aaaa-4000-8000-000000000001';
  const second = '12345678-bbbb-4000-8000-000000000002';
  assert.equal(materialCode(first), 'MAT-12345678');
  const all = [{ id: first }, { id: second }];
  assert.notEqual(materialCode(first, all), materialCode(second, all));
  assert.equal(materialCode(first, all), 'MAT-12345678AA');
});
test('stock note suggestions include defaults and deduplicate previous notes', () => {
  const list = stockReasonSuggestions([
    { action: 'material.stock_added', reason: ' Delivery from Kano ' },
    { action: 'material.stock_set', reason: 'restocking' },
    { action: 'material.updated', reason: 'ignore' },
  ]);
  assert.ok(list.includes('Restocking'));
  assert.ok(list.includes('Stock Count Correction'));
  assert.ok(list.includes('Delivery from Kano'));
  assert.equal(list.filter((value) => value.toLowerCase() === 'restocking').length, 1);
  assert.ok(!list.includes('ignore'));
});
