import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './pricing-fixture.mjs';
import { comparisonModel, comparisonMessage, comparisonRef } from '../src/comparison-doc.mjs';
import { quoteTemplate } from '../src/pricing-templates.mjs';
import { defaultBranding } from '../src/business-branding.mjs';

test('a comparison document lists each option with client details only, never costs or totals', () => {
  const { ledger } = fixture();
  const t = ledger.pricing.templates[0];
  const rows = [
    { quantity: 50, inner_paper: 1 },
    { quantity: 50, inner_paper: 2 },
    { quantity: 100, inner_paper: 1 },
  ].map(({ quantity, inner_paper }) => {
    const q = quoteTemplate(ledger, {
      serviceId: t.id,
      quantity,
      templateInputs: { sheets_per_book: 25, inner_paper, cover_card: 1 },
    });
    return {
      inputs: { quantity, sheets_per_book: 25, inner_paper, cover_card: 1 },
      amount: q.amount,
      unit: q.unitPrice,
    };
  });
  const m = comparisonModel(
    t,
    rows,
    { ...defaultBranding(), businessName: 'Mairoba Studio' },
    {
      customerName: 'Ada',
      customerPhone: '0803',
      preparedBy: 'Tolu',
      ref: 'CMP-TEST',
      now: '2026-10-13T12:00:00Z',
    },
  );
  assert.equal(m.items.length, 3);
  assert.equal(m.items[1].title, 'Option 2');
  assert.deepEqual(m.items[1].meta, [
    'Number of books: 50 books',
    'Sheets per book: 25 sheets',
    'Inner paper: 80 gsm paper',
    '₦626.00 each',
  ]);
  assert.equal(m.items[0].amount, '₦28,800.00');
  assert.deepEqual(m.totals, []);
  assert.match(m.notices[0], /3 options for Books\. Choose one/);
  assert.deepEqual(
    m.meta.map((x) => x[0]),
    ['Reference', 'Date', 'Customer', 'Phone', 'Prepared by'],
  );
  const text = JSON.stringify(m);
  for (const hidden of ['Cover card', 'Art card', 'paper_70', 'binding', 'cost'])
    assert.ok(!text.includes(hidden), hidden);
  assert.match(
    comparisonMessage(t, rows, 'Mairoba Studio'),
    /Mairoba Studio: price options for Books \(3 options\)/,
  );
  assert.match(comparisonRef(), /^CMP-[0-9A-F]{8}$/);
  assert.throws(() => comparisonModel(t, [{ inputs: {}, error: 'x' }], 'Shop'), /Compare prices first/);
});
