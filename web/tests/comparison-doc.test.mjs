import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './pricing-fixture.mjs';
import { comparisonModel, comparisonMessage, comparisonRef, comparisonText } from '../src/comparison-doc.mjs';
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

test('grouped comparisons get one titled group per value, numbering continues', () => {
  const { ledger } = fixture();
  const t = ledger.pricing.templates[0];
  const rows = [
    [50, 1],
    [50, 2],
    [100, 1],
    [100, 2],
  ].map(([quantity, inner_paper]) => ({
    inputs: { quantity, sheets_per_book: 25, inner_paper, cover_card: 1 },
    amount: 100,
    unit: 2,
  }));
  const m = comparisonModel(t, rows, 'Shop', { groupBy: 'quantity' });
  assert.deepEqual(
    m.items.map((i) => i.heading ?? ''),
    ['Number of books: 50 books · 2 options', '', 'Number of books: 100 books · 2 options', ''],
  );
  assert.deepEqual(
    m.items.map((i) => i.title),
    ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
  );
  assert.ok(comparisonModel(t, rows, 'Shop').items.every((i) => !i.heading));
});

test('the comparison as chat text: same options and client details as the PDF, ready to paste', () => {
  const { ledger } = fixture();
  const t = ledger.pricing.templates[0];
  const rows = [
    [50, 1],
    [50, 2],
    [100, 1],
  ].map(([quantity, inner_paper]) => {
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
  const business = { ...defaultBranding(), businessName: 'Mairoba *Studio*', phones: '0808 885 0271' };
  const text = comparisonText(t, rows, business, {
    customerName: 'Ada',
    ref: 'CMP-TEST',
    now: '2026-10-13T12:00:00Z',
  });
  const lines = text.split('\n');
  assert.equal(lines[0], '*Mairoba Studio*');
  assert.equal(lines[1], '*Price options: Books*');
  assert.equal(lines[2], '13 Oct 2026 · Ref CMP-TEST');
  assert.equal(lines[3], 'For: Ada');
  assert.ok(lines.includes('*Option 1: ₦28,800.00*'));
  assert.ok(
    lines.includes('Number of books: 50 books · Sheets per book: 25 sheets · Inner paper: 80 gsm paper'),
  );
  assert.ok(lines.includes('₦626.00 each'));
  assert.match(text, /Choose one option: prices are not added together\./);
  assert.ok(lines.includes('0808 885 0271'));
  for (const hidden of ['Cover card', 'Art card', 'cost', 'Total', '|'])
    assert.ok(!text.includes(hidden), hidden);
  // Grouped like the screen when asked.
  const grouped = comparisonText(t, rows, business, { groupBy: 'quantity' });
  assert.ok(grouped.includes('*Number of books: 50 books · 2 options*'));
  // The installer credit only when Developer turned it on for text shares.
  const credit = { text: 'Installed by Mairoba Studio | 08088850271', shares: true };
  const withCredit = comparisonText(t, rows, { ...business, poweredBy: credit });
  assert.ok(withCredit.endsWith('\n\n_Installed by Mairoba Studio | 08088850271_'));
  const creditOff = { ...business, poweredBy: { ...credit, shares: false } };
  assert.ok(!comparisonText(t, rows, creditOff).includes('Installed by'));
  assert.throws(() => comparisonText(t, [{ inputs: {}, error: 'x' }], 'Shop'), /Compare prices first/);
});
