import test from 'node:test';
import assert from 'node:assert/strict';
import { isStaleAppError, plainError, STALE_APP_MESSAGE } from '../src/stale-app.mjs';

test('an outdated screen gets a plain explanation, in every browser wording', () => {
  for (const text of [
    'Failed to fetch dynamically imported module: https://print-shop-ledger.vercel.app/assets/receipt-pdf-Dr6wdf7X.js',
    'Importing a module script failed.',
    'error loading dynamically imported module: https://x/assets/a.js',
  ])
    assert.equal(plainError(text), STALE_APP_MESSAGE);
  assert.equal(isStaleAppError('Not enough stock'), false);
  assert.equal(plainError('Not enough stock'), 'Not enough stock');
});
