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

test('each branch or store can have its own minimum stock', async () => {
  const { minimumAt, withLocationMinimums, validateStockMinimums } = await import('../src/branches.mjs');
  const { lowAtOtherLocations } = await import('../src/low-stock-locations.mjs');
  const id = '11111111-1111-1111-1111-111111111111';
  const s = { stockMinimums: validateStockMinimums({ 'b-shop000001': { [id]: 5 }, main: { [id]: 9 } }) };
  assert.deepEqual(Object.keys(s.stockMinimums), ['b-shop000001']);
  const paper = { id, name: 'Paper', minimumStock: 50, available: 8 };
  assert.equal(minimumAt(s, paper, 'b-shop000001'), 5);
  assert.equal(minimumAt(s, paper, 'main'), 50);
  const view = withLocationMinimums({ materials: [paper] }, s, 'b-shop000001');
  assert.equal(view.materials[0].minimumHere, 5);
  assert.equal(view.materials[0].minimumStock, 50, 'the item’s own minimum is kept for editing');
  const low = lowAtOtherLocations(
    [paper],
    [
      { materialId: id, location: 'main', available: 40 },
      { materialId: id, location: 'b-shop000001', available: 8 },
    ],
    'b-other00001',
    [
      { id: 'main', name: 'Main' },
      { id: 'b-shop000001', name: 'Shop' },
    ],
    s,
  );
  assert.deepEqual(
    low.map((r) => [r.location, r.minimum]),
    [['main', 50]],
  );
});

test('customers by branch: worked here, own credit limit, own customers only', async () => {
  const { branchCustomersLedger, setLocalBranch, tagNewRecords } = await import('../src/branches.mjs');
  const shared = {
    branches: [
      { id: 'main', name: 'Main' },
      { id: 'b-shop000001', name: 'Shop' },
    ],
  };
  const ledger = {
    customers: [
      { id: 'c1', name: 'Ada', creditLimit: 5000, creditLimits: { 'b-shop000001': 2000 } },
      { id: 'c2', name: 'Bayo', creditLimit: 1000, branchId: 'b-shop000001' },
      { id: 'c3', name: 'Chi', creditLimit: 1000 },
    ],
    jobs: [{ id: 'j1', customerId: 'c1' }],
    checkouts: [],
    payments: [],
    quotations: [],
  };
  const view = branchCustomersLedger(ledger, shared, 'b-shop000001');
  assert.deepEqual(
    view.customers.map((c) => [c.id, c.workedHere, c.creditLimit, c.baseCreditLimit]),
    [
      ['c1', true, 2000, 5000],
      ['c2', true, 1000, 1000],
      ['c3', false, 1000, 1000],
    ],
  );
  const own = { branches: [shared.branches[0], { ...shared.branches[1], customers: 'own' }] };
  assert.deepEqual(
    branchCustomersLedger(ledger, own, 'b-shop000001').customers.map((c) => c.id),
    ['c1', 'c2'],
  );
  assert.equal(branchCustomersLedger(ledger, shared, 'main').customers[0].creditLimit, 5000);
  setLocalBranch('b-shop000001');
  const after = tagNewRecords({ customers: [] }, { customers: [{ id: 'c9' }] });
  assert.equal(after.customers[0].branchId, 'b-shop000001');
  setLocalBranch('main');
});

test('a branch can keep its own receipts, dropdowns & workflow and job settings', async () => {
  const { defaultBranding, validateBranding } = await import('../src/business-branding.mjs');
  const { settingsForBranch, setBranchSettings, ownsGroup } = await import('../src/branches.mjs');
  const s = validateBranding({
    ...defaultBranding(),
    businessName: 'X',
    branches: [
      { id: 'main', name: 'Main', address: '', phone: '', archived: false },
      { id: 'b-shop000001', name: 'Shop', address: '', phone: '', archived: false },
    ],
  });
  s.branchSettings = setBranchSettings(s, 'b-shop000001', 'receipts', {
    receipt: { ...s.receipt, footer: 'Thank you, Shop' },
  });
  s.branchSettings = setBranchSettings(s, 'b-shop000001', 'workflow', {
    options: { ...s.options, expenseCategories: ['Fuel', 'Rent'] },
  });
  const saved = validateBranding(s);
  assert.equal(ownsGroup(saved, 'b-shop000001', 'receipts'), true);
  assert.equal(ownsGroup(saved, 'b-shop000001', 'jobs'), false);
  const shop = settingsForBranch(saved, 'b-shop000001');
  assert.equal(shop.receipt.footer, 'Thank you, Shop');
  assert.deepEqual(shop.options.expenseCategories, ['Fuel', 'Rent']);
  assert.deepEqual(
    shop.options.paymentMethods,
    saved.options.paymentMethods,
    'payment methods stay the business’s',
  );
  assert.notEqual(settingsForBranch(saved, 'main').receipt.footer, 'Thank you, Shop');
  // Going back to the whole business's.
  saved.branchSettings = setBranchSettings(saved, 'b-shop000001', 'receipts', null);
  assert.equal(ownsGroup(saved, 'b-shop000001', 'receipts'), false);
  // A closed-down branch id is dropped.
  assert.deepEqual(
    validateBranding({ ...saved, branchSettings: { 'b-gone000001': { receipts: {} } } }).branchSettings,
    {},
  );
});

test('everything but the business name can be a branch’s own', async () => {
  const { defaultBranding, validateBranding } = await import('../src/business-branding.mjs');
  const { settingsForBranch, setBranchSettings, branchSettingGroup } = await import('../src/branches.mjs');
  assert.equal(branchSettingGroup('businessName'), null);
  assert.equal(branchSettingGroup('branchAccess'), null);
  assert.equal(branchSettingGroup('pageAccess'), null);
  assert.equal(branchSettingGroup('primary'), 'appearance');
  const s = validateBranding({
    ...defaultBranding(),
    businessName: 'X',
    branches: [
      { id: 'main', name: 'Main', address: '', phone: '', archived: false },
      { id: 'b-shop000001', name: 'Shop', address: '', phone: '', archived: false },
    ],
  });
  s.branchSettings = setBranchSettings(s, 'b-shop000001', 'appearance', { primary: '#7a1f5c', accent: '#f0b400' });
  s.branchSettings = setBranchSettings(s, 'b-shop000001', 'profile', { email: 'shop@example.com' });
  const saved = validateBranding(s);
  const shop = settingsForBranch(saved, 'b-shop000001');
  assert.equal(shop.primary, '#7a1f5c');
  assert.equal(shop.email, 'shop@example.com');
  assert.equal(shop.businessName, 'X');
  assert.notEqual(settingsForBranch(saved, 'main').primary, '#7a1f5c');
});
