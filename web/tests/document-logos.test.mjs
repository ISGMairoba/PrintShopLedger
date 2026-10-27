import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
import { resolveWatermark, logoPositions, documentHeaderGeometry } from '../src/document-logos.mjs';
import { receiptModel, receiptHtml } from '../src/receipts.mjs';
import { sampleReceipt } from '../src/receipt-sample.mjs';
const logo = 'data:image/png;base64,YQ==';
const icon = 'data:image/png;base64,Yg==';
const settings = () => ({ ...defaultBranding(), businessName: 'Mairoba', logo });
test('old settings retain their header and watermark defaults; invalid choices are rejected', () => {
  const b = settings();
  delete b.receiptPage.logoPosition;
  b.documents = { watermark: true };
  const saved = validateBranding(b);
  assert.equal(saved.receiptPage.logoPosition, 'right');
  assert.equal(saved.documents.watermarkLogoLayout, '');
  assert.throws(
    () => validateBranding({ ...b, documents: { watermark: true, watermarkLogoLayout: 'wrong' } }),
    /watermark/,
  );
  assert.throws(
    () => validateBranding({ ...b, receiptPage: { ...b.receiptPage, logoPosition: 'wrong' } }),
    /position/,
  );
});
test('watermark selection is independent of header artwork and header visibility', () => {
  const b = settings();
  b.logoVariants.icon.light = icon;
  b.documents = { watermark: true, watermarkLogoLayout: 'icon' };
  b.receiptPage.showLogo = false;
  assert.equal(resolveWatermark(b), icon);
  const model = receiptModel(sampleReceipt(), b, false, [], 'page');
  assert.equal(model.business.watermarkLogo, icon);
  assert.equal(resolveWatermark({ ...b, documents: { ...b.documents, watermark: false } }), '');
});
test('all five positions reserve non-overlapping header space within printable bounds', () => {
  for (const p of Object.keys(logoPositions)) {
    const g = documentHeaderGeometry(p, 16, 14, 178, 60, 25);
    assert.ok(g.x >= 16 && g.x + 60 <= 194);
    if (p.startsWith('top-')) assert.ok(g.textY >= g.bottom + 8);
    else if (p === 'left') assert.ok(g.textX >= g.x + 60 + 8);
    else assert.ok(g.textX + g.textWidth <= g.x - 8);
  }
});
test('full-page preview follows placement and shows the separately selected watermark', () => {
  const b = settings();
  b.documents = { watermark: true, watermarkLogoLayout: 'icon' };
  b.logoVariants.icon.light = icon;
  for (const p of Object.keys(logoPositions)) {
    b.receiptPage.logoPosition = p;
    const html = receiptHtml(sampleReceipt(), b, false, [], { layout: 'wide' });
    assert.ok(html.includes('document-watermark'));
    assert.ok(html.includes(icon));
    if (p === 'top-center') assert.ok(html.includes('text-align:center;margin-bottom:10px'));
  }
});
