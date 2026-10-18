import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultBranding,
  validateBranding,
  validatePoweredBy,
  poweredByLine,
  receiptBusiness,
} from '../src/business-branding.mjs';
import { settingsTabKeys, developerSettingsTabs } from '../src/page-access.mjs';
import { receiptHtml } from '../src/receipts.mjs';
import { sampleReceipt } from '../src/receipt-sample.mjs';

const CREDIT = 'Installed by Mairoba Studio | 08088850271';
const shop = (poweredBy) => ({ ...defaultBranding(), businessName: 'Ada Prints', poweredBy });

test('the installer credit is off by default, and older settings without it still load', () => {
  assert.deepEqual(defaultBranding().poweredBy, {
    text: '',
    receipts: false,
    pages: false,
    reports: false,
    shares: false,
  });
  const { poweredBy, ...older } = shop();
  assert.equal(validateBranding(older).poweredBy.text, '');
  assert.equal(receiptBusiness(older).poweredBy.receipts, false);
  assert.equal(poweredByLine(older, 'receipts'), '');
  assert.equal(poweredByLine('Plain name', 'receipts'), '');
});

test('the credit is one tidy line of at most 60 characters with yes/no switches', () => {
  assert.equal(validatePoweredBy({ text: `  ${CREDIT.replace(' | ', '   |  ')} ` }).text, CREDIT);
  assert.throws(() => validatePoweredBy({ text: 'x'.repeat(61) }), /60 characters/);
  assert.throws(() => validatePoweredBy({ text: 'Line one\nLine two' }), /single line/);
  assert.throws(() => validatePoweredBy({ text: CREDIT, receipts: 'yes' }), /Invalid installer credit/);
  assert.throws(() => validatePoweredBy({ text: CREDIT, everywhere: true }), /Invalid installer credit/);
});

test('each output shows the credit only where Developer turned it on', () => {
  const b = shop({ text: CREDIT, receipts: true, pages: false, reports: true, shares: false });
  assert.equal(poweredByLine(b, 'receipts'), CREDIT);
  assert.equal(poweredByLine(b, 'pages'), '');
  assert.equal(poweredByLine(b, 'reports'), CREDIT);
  assert.equal(poweredByLine(b, 'shares'), '');
  assert.equal(poweredByLine(shop({ ...b.poweredBy, text: '  ' }), 'receipts'), '');
});

test('receipt previews add the credit under the footer, escaped, for the chosen paper only', () => {
  const b = shop({ text: 'Installed by <Studio> | 0808', receipts: true, pages: false });
  const narrow = receiptHtml(sampleReceipt(), b, false, [], { layout: 'narrow' });
  const wide = receiptHtml(sampleReceipt(), b, false, [], { layout: 'wide' });
  assert.match(narrow, /<p class="credit">Installed by &lt;Studio&gt; \| 0808<\/p><\/div>$/);
  assert.ok(!wide.includes('class="credit"'));
  const both = shop({ ...b.poweredBy, pages: true });
  assert.ok(receiptHtml(sampleReceipt(), both, false, [], { layout: 'wide' }).includes('class="credit"'));
});

test('Admin and Manager can never be given the credit (it is on no shared settings tab)', () => {
  for (const keys of Object.values(settingsTabKeys)) assert.ok(!keys.includes('poweredBy'));
  assert.deepEqual(developerSettingsTabs['Installer credit'], ['poweredBy']);
});
