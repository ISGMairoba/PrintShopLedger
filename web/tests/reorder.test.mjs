import test from 'node:test';
import assert from 'node:assert/strict';
import { reorderList, reorderText } from '../src/reorder.mjs';

const material = (id, name, available, minimumStock, extra = {}) => ({
  id,
  name,
  measurementUnit: 'sheet',
  available,
  minimumStock,
  archived: false,
  requireSize: false,
  ...extra,
});
const used = (materialId, before, after, changedAt, action = 'material.job_used') => ({
  id: materialId + changedAt,
  materialId,
  action,
  beforeAvailable: before,
  afterAvailable: after,
  changedAt,
});

test('Items at or near their minimum, with a suggested quantity', () => {
  const ledger = {
    materials: [
      material('a4', 'A4 paper', 40, 50),
      material('flex', 'Flex', 11, 10),
      material('ink', 'Ink', 30, 5),
      material('old', 'Old', 0, 5, { archived: true }),
    ],
    materialHistory: [
      used('a4', 200, 120, '2026-10-01T10:00:00Z'),
      used('a4', 120, 40, '2026-10-10T10:00:00Z'),
      used('a4', 500, 400, '2026-08-01T10:00:00Z'), // older than 30 days
      used('flex', 12, 11, '2026-10-12T10:00:00Z', 'material.wasted'),
    ],
  };
  const rows = reorderList(ledger, '2026-10-13T09:00:00Z');
  assert.deepEqual(
    rows.map((r) => [r.name, r.level, r.used30, r.suggested]),
    [
      // A4: max(100, 50 + 160) − 40 = 170.  Flex: max(20, 10 + 1) − 11 = 9.
      ['A4 paper', 'Critical', 160, 170],
      ['Flex', 'Near minimum', 1, 9],
    ],
  );
});

test('The supplier message lists the chosen items', () => {
  assert.equal(
    reorderText([{ name: 'A4 paper', quantity: 170, unit: 'sheet' }], 'Packrium'),
    'Order from Packrium:\n- A4 paper: 170 sheet\nPlease confirm prices and delivery. Thank you.',
  );
});
