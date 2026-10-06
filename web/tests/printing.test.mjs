import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPrintSettings, validatePrintSettings, savePrintSettings, loadPrintSettings, qzOptions, printDocument } from '../src/print-settings.mjs';
const memory = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
test('printer defaults are separated by business and user scope', () => {
  const storage = memory(), a = defaultPrintSettings(); a.printer = 'Receipt Printer'; a.autoPrint = true;
  savePrintSettings('user:business-a', a, storage);
  assert.equal(loadPrintSettings('user:business-a', storage).printer, 'Receipt Printer');
  assert.equal(loadPrintSettings('user:business-b', storage).printer, '');
  assert.equal(loadPrintSettings('other-user:business-a', storage).autoPrint, false);
});
test('automatic printing needs a named printer and valid margins', () => {
  assert.throws(() => validatePrintSettings({ ...defaultPrintSettings(), autoPrint: true }), /Select a printer/);
  assert.throws(() => validatePrintSettings({ ...defaultPrintSettings(), width: 58, margins: { top: 0, bottom: 0, left: 30, right: 30 } }), /leave room/);
  assert.throws(() => validatePrintSettings({ ...defaultPrintSettings(), copies: 1.5 }), /whole number/);
});
test('landscape margins are checked against rotated paper dimensions', () => {
  const s = { ...defaultPrintSettings(), width: 58, height: 200, orientation: 'landscape', margins: { top: 30, bottom: 30, left: 0, right: 0 } };
  assert.throws(() => validatePrintSettings(s), /leave room/);
});
test('print configuration preserves device settings with millimetre units', () => {
  const s = defaultPrintSettings(); s.printer = 'Test'; s.paperSource = 'Tray 2'; s.color = true; s.copies = 2;
  const config = qzOptions(s);
  assert.equal(config.units, 'mm'); assert.equal(config.printerTray, 'Tray 2'); assert.equal(config.colorType, 'color'); assert.equal(config.copies, 2);
  assert.deepEqual(config.size, { width: 210, height: 297 });
});
test('print document applies font settings and escapes the title', () => {
  const s = { ...defaultPrintSettings(), fontSize: 12, bold: true, italic: true };
  const doc = printDocument(s, '<customer>', '<p>Safe body</p>');
  assert.ok(doc.includes('<title>&lt;customer&gt;</title>')); assert.ok(doc.includes('font-size:12pt')); assert.ok(doc.includes('font-weight:bold')); assert.ok(doc.includes('font-style:italic'));
});
