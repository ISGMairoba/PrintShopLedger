import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDueAt, validDueAt, deadlineState, durationLabel } from '../src/job-deadlines.mjs';
import { defaultBranding, validateBranding, validateJobSettings } from '../src/business-branding.mjs';
import { receiptModel } from '../src/receipts.mjs';
import { sampleReceipt } from '../src/receipt-sample.mjs';
import { inPeriod } from '../src/dashboard.mjs';

const at = '2026-10-12T09:00:00.000Z';

test('default deadline follows the business duration', () => {
  assert.equal(defaultDueAt({ value: 2, unit: 'days' }, at), '2026-10-14T09:00:00.000Z');
  assert.equal(defaultDueAt({ value: 5, unit: 'hours' }, at), '2026-10-12T14:00:00.000Z');
  assert.equal(defaultDueAt({ value: 0, unit: 'days' }, at), '');
  assert.equal(durationLabel({ value: 1, unit: 'days' }), '1 day');
  assert.equal(durationLabel({ value: 0, unit: 'hours' }), 'No default deadline');
});

test('entered deadlines are optional, valid and within five years', () => {
  assert.equal(validDueAt('', at), '');
  assert.equal(validDueAt(undefined, at), '');
  assert.equal(validDueAt('2026-10-13T10:00:00+01:00', at), '2026-10-13T09:00:00.000Z');
  assert.throws(() => validDueAt('soon', at), /valid deadline/);
  assert.throws(() => validDueAt('2040-01-01T00:00:00Z', at), /five years/);
});

test('deadline state: overdue, due soon, later, done and none', () => {
  const now = Date.parse(at);
  assert.equal(deadlineState({ dueAt: '2026-10-12T08:00:00Z' }, now), 'overdue');
  assert.equal(deadlineState({ dueAt: '2026-10-12T20:00:00Z' }, now), 'soon');
  assert.equal(deadlineState({ dueAt: '2026-10-20T20:00:00Z' }, now), 'later');
  assert.equal(deadlineState({ dueAt: '2026-10-12T08:00:00Z', productionStatus: 'Collected' }, now), 'done');
  assert.equal(deadlineState({}, now), 'none');
});

test('job settings default for older saved settings and are validated', () => {
  const { jobs, ...older } = defaultBranding();
  const loaded = validateBranding({ ...older, businessName: 'Shop' });
  assert.deepEqual(loaded.jobs, { defaultDuration: { value: 0, unit: 'days' }, paymentPrefill: 'suggested' });
  assert.equal(loaded.receipt.showBusinessName, true);
  assert.throws(() => validateJobSettings({ defaultDuration: { value: 1.5, unit: 'days' } }), /duration/);
  assert.throws(() => validateJobSettings({ defaultDuration: { value: 800, unit: 'hours' } }), /duration/);
  assert.throws(() => validateJobSettings({ paymentPrefill: 'half' }), /payment amount/);
  assert.equal(validateJobSettings({ paymentPrefill: 'zero' }).paymentPrefill, 'zero');
});

test('receipts can drop the business name when a logo shows, and print deadlines', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  const brand = { ...defaultBranding(), businessName: 'SMGraphics 2', logo };
  const record = sampleReceipt(at);
  assert.equal(receiptModel(record, brand).business.name, 'SMGraphics 2');
  const hidden = { ...brand, receipt: { ...brand.receipt, showBusinessName: false } };
  assert.equal(receiptModel(record, hidden).business.name, '');
  // Without a logo on the receipt the name stays, so the business is always identified.
  assert.equal(receiptModel(record, { ...hidden, logo: '' }).business.name, 'SMGraphics 2');
  assert.ok(receiptModel(record, brand).items[0].meta.some((m) => m.startsWith('Due ')));
  const noDue = { ...brand, receipt: { ...brand.receipt, showDueDate: false } };
  assert.ok(!receiptModel(record, noDue).items[0].meta.some((m) => m.startsWith('Due ')));
});

test('period matching uses Lagos business days; all dates match everything', () => {
  const period = { preset: 'custom', from: '2026-10-12', to: '2026-10-12' };
  assert.equal(inPeriod('2026-10-11T23:30:00Z', period), true); // 00:30 in Lagos
  assert.equal(inPeriod('2026-10-11T22:30:00Z', period), false);
  assert.equal(inPeriod('2020-01-01T00:00:00Z', { preset: 'all', from: '', to: '' }), true);
});
