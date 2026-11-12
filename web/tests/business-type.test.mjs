import test from 'node:test';
import assert from 'node:assert/strict';
import { featureOn, validateBusinessType } from '../src/business-type.mjs';

test('business type: retail hides print-shop parts, which can be turned back on one by one', () => {
  assert.equal(featureOn({}, 'Services'), true);
  assert.equal(featureOn({ businessType: 'print' }, 'Jobs'), true);
  const retail = { businessType: 'retail', features: { 'Pricing Templates': true } };
  assert.equal(featureOn(retail, 'Services'), false);
  assert.equal(featureOn(retail, 'Jobs'), false);
  assert.equal(featureOn(retail, 'Pricing Templates'), true);
  assert.equal(featureOn(retail, 'Point of Service'), true);
  assert.equal(featureOn({ businessType: 'both', features: { Quotations: false } }, 'Quotations'), false);
  assert.deepEqual(validateBusinessType({}), { businessType: 'both', features: {} });
  assert.throws(() => validateBusinessType({ businessType: 'bakery' }), /business type/);
  assert.throws(() => validateBusinessType({ features: { Dashboard: false } }), /Invalid/);
});
