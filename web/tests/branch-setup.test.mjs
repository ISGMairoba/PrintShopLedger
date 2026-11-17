import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chosenItemsLedger,
  ownPrices,
  sellsChosen,
  setLocalBranch,
  settingsForBranch,
  soldAt,
  tagNewRecords,
  validateBranches,
} from '../src/branches.mjs';

const settings = {
  businessType: 'print',
  features: { Quotations: false },
  branchPricing: 'perBranch',
  branches: [
    { id: 'main', name: 'Main', address: '', phone: '', archived: false },
    {
      id: 'b-shop000001',
      name: 'Shop',
      address: '',
      phone: '',
      archived: false,
      type: 'retail',
      prices: 'main',
      sells: 'chosen',
    },
    { id: 'b-press00001', name: 'Press', address: '', phone: '', archived: false },
  ],
};

test('each branch keeps what it does, its prices and the items it sells', () => {
  const out = validateBranches(settings.branches);
  assert.deepEqual(
    { type: out[1].type, prices: out[1].prices, sells: out[1].sells },
    { type: 'retail', prices: 'main', sells: 'chosen' },
  );
  assert.equal(out[2].sells, undefined);
  assert.throws(() => validateBranches([{ id: 'main', name: 'M', type: 'bakery' }]), /what each branch does/);
  // The main branch always uses the main prices and sells every item.
  assert.deepEqual(
    validateBranches([{ id: 'main', name: 'M', prices: 'own', sells: 'chosen' }])[0].prices,
    undefined,
  );
});

test('prices: the branch’s own choice, else the business’s older setting', () => {
  assert.equal(ownPrices(settings, 'b-shop000001'), false);
  assert.equal(ownPrices(settings, 'b-press00001'), true);
  assert.equal(ownPrices(settings, 'main'), false);
  assert.equal(ownPrices({ ...settings, branchPricing: 'shared' }, 'b-press00001'), false);
});

test('a branch with its own type shows that type’s parts of the app', () => {
  const shop = settingsForBranch(settings, 'b-shop000001');
  assert.equal(shop.businessType, 'retail');
  assert.deepEqual(shop.features, {});
  assert.equal(settingsForBranch(settings, 'b-press00001'), settings);
});

test('a branch selling chosen items sees only those and the materials they use', () => {
  const ledger = {
    services: [
      { id: 's1', description: 'Pen', materialId: 'm1', soldAt: ['b-shop000001'] },
      { id: 's2', description: 'Banner', materialId: 'm2' },
    ],
    materials: [
      { id: 'm1', name: 'Pens', available: 0 },
      { id: 'm2', name: 'Flex', available: 0 },
      { id: 'm3', name: 'Ink', available: 4 },
    ],
  };
  assert.equal(sellsChosen(settings, 'b-shop000001'), true);
  assert.equal(soldAt(settings, ledger.services[1], 'b-press00001'), true);
  const view = chosenItemsLedger(ledger, settings, 'b-shop000001');
  assert.deepEqual(
    view.services.map((s) => [s.id, !!s.archived]),
    [
      ['s1', false],
      ['s2', true],
    ],
  );
  assert.deepEqual(
    view.materials.filter((m) => !m.hiddenHere).map((m) => m.id),
    ['m1', 'm3'],
  );
  assert.equal(chosenItemsLedger(ledger, settings, 'b-press00001'), ledger);
});

test('an item added at a branch selling chosen items is sold there', () => {
  setLocalBranch('b-shop000001', true);
  const before = { services: [{ id: 's1' }] };
  const after = { services: [{ id: 's1' }, { id: 's2' }] };
  assert.deepEqual(tagNewRecords(before, after).services[1].soldAt, ['b-shop000001']);
  setLocalBranch('main');
});
