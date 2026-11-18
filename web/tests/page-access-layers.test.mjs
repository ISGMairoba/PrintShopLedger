import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessPage, defaultPageAccess, limitedPageAccess, rankPages } from '../src/page-access.mjs';

test('a branch or personal limit only takes pages away from the rank', () => {
  const configured = defaultPageAccess();
  const limited = limitedPageAccess(configured, 2, ['Jobs', 'Business Settings']);
  assert.equal(canAccessPage('Jobs', 2, limited), true);
  assert.equal(canAccessPage('Customers', 2, limited), false);
  // Not in the rank's pages, so the limit cannot give it.
  assert.equal(canAccessPage('Business Settings', 2, limited), false);
  assert.equal(canAccessPage('My Account', 2, limited), true);
  // No limit, or Developer: unchanged.
  assert.equal(limitedPageAccess(configured, 2, null), configured);
  assert.equal(limitedPageAccess(configured, 5, ['Jobs']), configured);
  // Another rank is untouched.
  assert.equal(canAccessPage('Customers', 3, limited), true);
  assert.ok(rankPages(configured, 1).includes('Point of Service'));
  assert.ok(!rankPages(configured, 1).includes('Dashboard'));
});
