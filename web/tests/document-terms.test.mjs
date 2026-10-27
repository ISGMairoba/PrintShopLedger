import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actor, id } from './pricing-fixture.mjs';
import { prepareCheckout } from '../src/checkout.mjs';
import { prepareQuotation, quotationModel } from '../src/quotations.mjs';
import { receiptModel, receiptHtml } from '../src/receipts.mjs';
import { sampleReceipt } from '../src/receipt-sample.mjs';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
import { validDocumentTerms } from '../src/document-terms.mjs';
import { applyEvent } from '../src/domain.mjs';
test('terms validate as plain text and preserve line breaks', () => {
  assert.equal(
    validDocumentTerms(' Deposit required.\nArtwork approval. '),
    'Deposit required.\nArtwork approval.',
  );
  for (const value of [null, {}, 'x'.repeat(5001), 'bad\u0001'])
    assert.throws(() => validDocumentTerms(value), /5,000/);
  const b = defaultBranding();
  b.businessName = 'Mairoba';
  b.documents.invoiceTerms = 'Invoice';
  b.documents.quotationTerms = 'Quote';
  assert.equal(validateBranding(b).documents.quotationTerms, 'Quote');
});
test('checkout snapshots terms without altering amounts, stock or allocations', () => {
  const { ledger, input } = fixture();
  const plain = prepareCheckout(ledger, input, actor);
  const withTerms = prepareCheckout(
    ledger,
    { ...input, termsAndConditions: 'Pay before collection.' },
    actor,
  );
  assert.equal(withTerms.data.termsAndConditions, 'Pay before collection.');
  assert.equal(applyEvent(ledger, withTerms).checkouts[0].termsAndConditions, 'Pay before collection.');
  assert.equal(withTerms.data.total, plain.data.total);
  assert.deepEqual(withTerms.data.allocations, plain.data.allocations);
});
test('saved quotation terms survive a change in defaults, including deliberate blank terms', () => {
  const { ledger } = fixture();
  const input = {
    customerName: 'Ada',
    customerPhone: '',
    validUntil: '2026-12-01',
    lines: [{ id: id(90), serviceId: id(7), description: 'Cards', quantity: '2' }],
    termsAndConditions: 'Original terms',
  };
  const event = prepareQuotation(ledger, input, actor);
  const saved = applyEvent(ledger, event).quotations[0];
  const b = defaultBranding();
  b.documents.quotationTerms = 'Changed defaults';
  assert.equal(quotationModel(saved, b).termsAndConditions, 'Original terms');
  assert.equal(quotationModel({ ...saved, termsAndConditions: '' }, b).termsAndConditions, '');
});
test('full-page documents escape terms; small receipts omit them unless enabled; old documents stay unchanged', () => {
  const b = defaultBranding();
  b.documents.invoiceTerms = 'New default';
  const record = { ...sampleReceipt(), termsAndConditions: '<script>bad()</script>\nDeposit required.' };
  const html = receiptHtml(record, b, false, [], { layout: 'wide' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>bad()'));
  assert.equal(receiptModel(record, b, false, [], 'roll').termsAndConditions, '');
  b.documents.showTermsOnRoll = true;
  assert.equal(receiptModel(record, b, false, [], 'roll').termsAndConditions, record.termsAndConditions);
  assert.equal(receiptModel(sampleReceipt(), b, false, [], 'page').termsAndConditions, '');
});

test('reviewing an offline checkout preserves the terms on later pending sales', async () => {
  const { replacePendingCheckout } = await import('../src/checkout-conflicts.mjs');
  const { ledger, input } = fixture();
  const first = prepareCheckout(ledger, { ...input, termsAndConditions: 'First terms' }, actor);
  const afterFirst = applyEvent(ledger, first);
  const second = prepareCheckout(
    afterFirst,
    { ...input, lines: [{ ...input.lines[0], id: id(98) }], termsAndConditions: 'Later sale terms' },
    actor,
  );
  const state = { ledger: applyEvent(afterFirst, second), pending: [first, second] };
  const reviewed = prepareCheckout(
    ledger,
    { ...input, termsAndConditions: 'Reviewed terms' },
    actor,
    first.id,
    first.data.createdAt,
  );
  const next = replacePendingCheckout(state, ledger, first.id, reviewed);
  assert.equal(next.pending[1].data.termsAndConditions, 'Later sale terms');
  assert.equal(next.ledger.checkouts[1].termsAndConditions, 'Later sale terms');
});
