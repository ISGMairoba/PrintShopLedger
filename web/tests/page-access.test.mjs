import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPage, pages, navigationPages } from '../src/page-access.mjs';
test('cashier sees only operational pages and own credentials', () =>
  assert.deepEqual(
    pages.filter((page) => canAccessPage(page, 1)),
    ['Point of Service', 'My Sales', 'Print Settings', 'My Account'],
  ));
test('Pricing Templates keeps Developer maintenance access and sits beside Services', () => {
  for (const rank of [0, 1, 2, 3]) assert.equal(canAccessPage('Pricing Templates', rank), false);
  assert.equal(canAccessPage('Pricing Templates', 4), true);
  assert.equal(navigationPages[navigationPages.indexOf('Services') + 2], 'Pricing Templates');
});
test('Edit Products follows Services access and sits right after it', () => {
  assert.equal(navigationPages[navigationPages.indexOf('Services') + 1], 'Edit Products');
  for (const rank of [1, 2, 3, 4])
    assert.equal(canAccessPage('Edit Products', rank), canAccessPage('Services', rank));
});
test('admin sees existing pages and account, business settings require manager', () => {
  for (const page of pages) assert.equal(canAccessPage(page, 2), page !== 'Business Settings');
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
