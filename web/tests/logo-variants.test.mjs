import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptModel } from '../src/receipts.mjs';
import { sampleReceipt } from '../src/receipt-sample.mjs';
import { defaultBranding, validateBranding, receiptBusiness } from '../src/business-branding.mjs';
import {
  logoVariantsDefaults,
  resolveLogo,
  validateLogoVariants,
  validateLogoUsage,
} from '../src/logo-variants.mjs';
const image = 'data:image/png;base64,YQ==';
const second = 'data:image/png;base64,Yg==';

test('roll and full-page documents independently select logos and preserve old choices', () => {
  const settings = { ...defaultBranding(), businessName: 'Shop' };
  settings.logoVariants.icon.light = image;
  settings.logoVariants.horizontal.light = second;
  settings.receipt.logoLayout = 'icon';
  settings.receiptPage.logoLayout = 'horizontal';
  assert.equal(receiptModel(sampleReceipt(), settings, false, [], 'roll').business.logo, image);
  assert.equal(receiptModel(sampleReceipt(), settings, false, [], 'page').business.logo, second);
  assert.equal(receiptBusiness(settings).logo, second, 'reports use full-page selection');
  assert.equal(validateBranding(settings).receipt.logoLayout, 'icon');
  settings.receipt.logoLayout = 'invalid';
  assert.throws(() => validateBranding(settings), /logo layout/);
  delete settings.receipt.logoLayout;
  delete settings.receiptPage.logoLayout;
  settings.logoUsage.documents = 'horizontal';
  assert.equal(resolveLogo(settings, 'roll'), second);
  assert.equal(resolveLogo(settings, 'page'), second);
});

test('older business settings retain their original logo and gain empty variants', () => {
  const legacy = { ...defaultBranding(), businessName: 'Studio', logo: image };
  delete legacy.logoVariants;
  delete legacy.logoUsage;
  const saved = validateBranding(legacy);
  assert.deepEqual(saved.logoVariants, logoVariantsDefaults());
  for (const target of ['sidebar', 'documents', 'favicon'])
    assert.equal(resolveLogo(saved, target, 'dark'), image);
});
test('layout selection and background variants resolve independently', () => {
  const settings = defaultBranding();
  settings.logoVariants.horizontal.light = image;
  settings.logoVariants.horizontal.dark = second;
  settings.logoVariants.icon.dark = image;
  assert.equal(resolveLogo(settings, 'sidebar', 'light'), image);
  assert.equal(resolveLogo(settings, 'sidebar', 'dark'), second);
  assert.equal(resolveLogo(settings, 'favicon', 'dark'), image);
  settings.logoUsage.documents = 'horizontal';
  assert.equal(receiptBusiness(settings).logo, image);
});
test('missing layouts prefer a matching background and fall back safely after removal', () => {
  const settings = defaultBranding();
  settings.logoVariants.icon.dark = image;
  settings.logoVariants.wordmark.light = second;
  assert.equal(resolveLogo(settings, 'favicon', 'light'), second);
  settings.logo = second;
  settings.logoVariants.wordmark.light = '';
  assert.equal(resolveLogo(settings, 'favicon', 'light'), second);
  settings.logo = '';
  assert.equal(resolveLogo(settings, 'documents'), image);
  settings.logoVariants.icon.dark = '';
  assert.equal(resolveLogo(settings), '');
});
test('reject unsafe images, unsupported layouts, invalid usage and null variants', () => {
  for (const value of [
    null,
    [],
    { unknown: {} },
    { icon: null },
    { icon: { light: null } },
    { icon: { light: 'https://example.com/logo.png' } },
    { icon: { light: 'data:image/svg+xml;base64,YQ==' } },
    { icon: { dark: image + 'a'.repeat(350000) } },
  ])
    assert.throws(() => validateLogoVariants(value));
  for (const value of [null, [], { sidebar: 'unknown' }, { unknown: 'icon' }])
    assert.throws(() => validateLogoUsage(value));
});
