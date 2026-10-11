import test from 'node:test';
import assert from 'node:assert/strict';
import { paperLabel, printerMedia } from '../src/print-settings.mjs';

test('driver paper names become readable labels', () => {
  assert.equal(paperLabel('iso-a4'), 'A4');
  assert.equal(paperLabel('na-letter'), 'Letter');
  assert.equal(paperLabel('na-legal'), 'Legal');
  assert.equal(paperLabel('jis-b5'), 'JIS B5');
  assert.equal(paperLabel('80(72.1) x 297 mm'), '80(72.1) x 297 mm');
});

test('printer sizes are cleaned, de-duplicated and sorted; trays listed once', () => {
  const media = printerMedia({
    name: 'Thermal',
    sizes: [
      { name: 'iso-a4', mm: { width: 210.0001, height: 297 } },
      { name: '80(72.1) x 297 mm', mm: { width: 80, height: 297 } },
      { name: 'iso-a4', mm: { width: 210, height: 297 } },
      { name: 'tiny', mm: { width: 5, height: 5 } },
      { name: 'broken' },
    ],
    trays: ['Auto', 'Tray 1', 'Auto', ''],
  });
  assert.deepEqual(media.sizes, [
    { name: '80(72.1) x 297 mm', width: 80, height: 297 },
    { name: 'A4', width: 210, height: 297 },
  ]);
  assert.deepEqual(media.trays, ['Auto', 'Tray 1']);
});

test('older QZ Tray without sizes or trays gives empty lists', () => {
  assert.deepEqual(printerMedia({ name: 'Old' }), { sizes: [], trays: [] });
  assert.deepEqual(printerMedia(undefined), { sizes: [], trays: [] });
});
