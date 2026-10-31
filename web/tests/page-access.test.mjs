import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPage,
  pages,
  navigationPages,
  defaultPageAccess,
  validatePageAccess,
  upgradePageAccess,
  allowedSettingsTabs,
  settingsTabs,
  validateSettingsTabs,
} from '../src/page-access.mjs';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
test('cashier sees only operational pages and own credentials', () =>
  assert.deepEqual(
    pages.filter((page) => canAccessPage(page, 1)),
    ['Point of Service', 'Quotations', 'Pricing Templates', 'My Sales', 'Print Settings', 'My Account'],
  ));
test('Pricing Templates is open to sellers by default and sits after Quotations', () => {
  assert.equal(canAccessPage('Pricing Templates', 0), false);
  for (const rank of [1, 2, 3, 4]) assert.equal(canAccessPage('Pricing Templates', rank), true);
  assert.equal(navigationPages[navigationPages.indexOf('Quotations') + 1], 'Pricing Templates');
});
test('Edit Products sits right after Services and needs Admin+', () => {
  assert.equal(navigationPages[navigationPages.indexOf('Services') + 1], 'Edit Products');
  assert.equal(canAccessPage('Edit Products', 1), false);
  for (const rank of [2, 3, 4]) assert.equal(canAccessPage('Edit Products', rank), true);
});
test('admin sees every page by default except Business Settings', () => {
  for (const page of pages) assert.equal(canAccessPage(page, 2), page !== 'Business Settings');
});
test('every page can be set on its own, and Business Settings can be given to Admin and Manager', () => {
  const custom = defaultPageAccess();
  custom['2'] = custom['2'].filter((p) => p !== 'Quotations').concat('Business Settings');
  const checked = validatePageAccess(custom);
  assert.equal(canAccessPage('Quotations', 2, checked), false);
  assert.equal(canAccessPage('Point of Service', 2, checked), true);
  assert.equal(canAccessPage('Business Settings', 2, checked), true);
  const cashier = defaultPageAccess();
  cashier['1'].push('Business Settings');
  assert.throws(() => validatePageAccess(cashier));
});
test('older saved settings give each new page its old page access, once', () => {
  const old = {
    1: ['Point of Service', 'My Account'],
    2: ['Dashboard', 'Services', 'My Account'],
    3: ['My Account'],
  };
  const up = upgradePageAccess(old);
  assert.deepEqual(up['1'], ['Point of Service', 'My Account', 'Quotations', 'Pricing Templates']);
  assert.deepEqual(up['2'], ['Dashboard', 'Services', 'My Account', 'Reports', 'Edit Products']);
  assert.deepEqual(up['3'], ['My Account']);
  const b = validateBranding({
    ...defaultBranding(),
    businessName: 'B',
    pageAccess: old,
    pageAccessVersion: undefined,
  });
  assert.equal(b.pageAccessVersion, 3);
  assert.ok(b.pageAccess['2'].includes('Reports'));
  // Once upgraded, a page that was switched off stays off.
  const off = validateBranding({
    ...b,
    pageAccess: { ...b.pageAccess, 2: b.pageAccess['2'].filter((p) => p !== 'Reports') },
  });
  assert.equal(off.pageAccess['2'].includes('Reports'), false);
});
test('Business Settings tabs: Developer has all and Page access; others only allowed tabs', () => {
  const settings = validateBranding({ ...defaultBranding(), businessName: 'B' });
  assert.deepEqual(allowedSettingsTabs(4, settings), [
    ...settingsTabs,
    'Accounts',
    'Page access',
    'Installer credit',
  ]);
  assert.deepEqual(allowedSettingsTabs(3, settings), []);
  settings.pageAccess['3'].push('Business Settings');
  settings.settingsTabs['3'] = ['Receipts', 'Profile & logo'];
  assert.deepEqual(allowedSettingsTabs(3, validateBranding(settings)), ['Profile & logo', 'Receipts']);
  assert.deepEqual(allowedSettingsTabs(1, settings), []);
  assert.throws(() => validateSettingsTabs({ 2: ['Page access'] }));
  assert.throws(() => validateSettingsTabs({ 3: ['Installer credit'] }));
  assert.throws(() => validateSettingsTabs({ 1: [] }));
});
test('developer has every page; manager excludes business settings; revoked and unknown denied', () => {
  for (const page of pages) {
    assert.equal(canAccessPage(page, 3), page !== 'Business Settings');
    assert.ok(canAccessPage(page, 4));
    assert.equal(canAccessPage(page, 0), false);
  }
  assert.equal(canAccessPage('Unknown', 4), false);
});

test('Configured pages restrict Admin and grant Cashier read pages without elevating rank', () => {
  const access = { 1: ['My Account', 'Jobs'], 2: ['My Account', 'Sale Adjustments'] };
  assert.equal(canAccessPage('Jobs', 1, access), true);
  assert.equal(canAccessPage('Payments', 1, access), false);
  assert.equal(canAccessPage('Jobs', 2, access), false);
  assert.equal(canAccessPage('Sale Adjustments', 2, access), true);
  assert.equal(canAccessPage('Sale Adjustments', 1, { 1: ['My Account', 'Sale Adjustments'] }), false);
  for (const page of pages) assert.equal(canAccessPage(page, 4, access), true);
});

test('Manager page list can be restricted while Developer always retains maintenance access', () => {
  const access = { 1: ['My Account'], 2: ['My Account'], 3: ['My Account', 'My Sales'] };
  assert.equal(canAccessPage('Jobs', 3, access), false);
  assert.equal(canAccessPage('My Sales', 3, access), true);
  assert.equal(canAccessPage('Business Settings', 3, access), false);
  assert.equal(canAccessPage('Business Settings', 4, access), true);
});
