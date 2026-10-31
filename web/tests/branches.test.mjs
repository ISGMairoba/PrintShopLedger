import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedBranches,
  branchesOf,
  hasBranches,
  MAIN,
  seesAllBranches,
  validateBranchAccess,
  validateBranches,
} from '../src/branches.mjs';

const ada = '11111111-1111-4111-8111-111111111111';
const bola = '22222222-2222-4222-8222-222222222222';
const list = [
  { id: 'main', name: 'Kano Road', address: ' 12 Kano Road ', phone: '0803' },
  { id: 'b-abc123def0', name: 'Zoo Road' },
  { id: 'b-old0000001', name: 'Old shop', archived: true },
];

test('a business without branches has one main branch', () => {
  assert.deepEqual(
    branchesOf({}).map((b) => b.id),
    [MAIN],
  );
  assert.equal(hasBranches({}), false);
  assert.deepEqual(
    allowedBranches({}, ada).map((b) => b.id),
    [MAIN],
  );
});

test('branches are checked and tidied', () => {
  const clean = validateBranches(list);
  assert.equal(clean[0].address, '12 Kano Road');
  assert.equal(clean[2].archived, true);
  assert.throws(() => validateBranches([{ id: 'b-abc123def0', name: 'X' }]), /first branch/);
  assert.throws(
    () =>
      validateBranches([
        { id: 'main', name: 'A' },
        { id: 'b-abc123def0', name: 'a' },
      ]),
    /same name/,
  );
  assert.throws(() => validateBranches([{ id: 'main', name: 'A', archived: true }]), /cannot be archived/);
  assert.throws(() => validateBranches([{ id: 'main', name: '' }]), /name/);
  assert.equal(hasBranches({ branches: clean }), true);
});

test('staff work in the branches they are given; the owner sees all', () => {
  const branches = validateBranches(list);
  const branchAccess = validateBranchAccess(
    { [ada]: ['b-abc123def0', 'nope'], [bola]: ['*', 'main'] },
    branches,
  );
  assert.throws(() => validateBranchAccess({ 'not-an-id': ['main'] }, branches), /Invalid branch access/);
  assert.deepEqual(branchAccess, { [ada]: ['b-abc123def0'], [bola]: ['*'] });
  const settings = { branches, branchAccess };
  assert.deepEqual(
    allowedBranches(settings, ada).map((b) => b.id),
    ['b-abc123def0'],
  );
  assert.deepEqual(
    allowedBranches(settings, bola).map((b) => b.id),
    ['main', 'b-abc123def0'],
  );
  assert.deepEqual(
    allowedBranches(settings, 'someone-else').map((b) => b.id),
    ['main'],
  );
  assert.deepEqual(
    allowedBranches(settings, 'dev', 4).map((b) => b.id),
    ['main', 'b-abc123def0'],
  );
  assert.equal(seesAllBranches(settings, bola), true);
  assert.equal(seesAllBranches(settings, ada), false);
});

import { branchLedger, setLocalBranch, tagNewRecords } from '../src/branches.mjs';
import { accountToken, walletBalance } from '../src/checkout.mjs';

test('each branch sees its own records; a customer has one account per branch', () => {
  const ledger = {
    customers: [{ id: 'c1', name: 'Ada' }],
    jobs: [
      { id: 'j1', customerId: 'c1', amount: 1000 },
      { id: 'j2', customerId: 'c1', amount: 500, branchId: 'b-zoo0000001' },
    ],
    payments: [
      { id: 'p1', customerId: 'c1', amount: 0, walletAdded: 300, walletUsed: 0, allocations: [] },
      {
        id: 'p2',
        customerId: 'c1',
        amount: 0,
        walletAdded: 200,
        walletUsed: 0,
        allocations: [],
        branchId: 'b-zoo0000001',
      },
    ],
    services: [{ id: 's1' }],
  };
  try {
    setLocalBranch('main');
    assert.deepEqual(
      branchLedger(ledger).jobs.map((j) => j.id),
      ['j1'],
    );
    assert.equal(branchLedger(ledger).services.length, 1);
    assert.equal(walletBalance(ledger, 'c1'), 300);
    assert.equal(accountToken(ledger, 'c1'), 'wallet=300;j1:1000');
    setLocalBranch('b-zoo0000001');
    assert.deepEqual(
      branchLedger(ledger).jobs.map((j) => j.id),
      ['j2'],
    );
    assert.equal(walletBalance(ledger, 'c1'), 200);
    assert.equal(accountToken(ledger, 'c1'), 'wallet=200;j2:500');
    // Records made on this device are tagged with its branch.
    const after = { ...ledger, jobs: [...ledger.jobs, { id: 'j3', customerId: 'c1', amount: 50 }] };
    const tagged = tagNewRecords(ledger, after);
    assert.equal(tagged.jobs.find((j) => j.id === 'j3').branchId, 'b-zoo0000001');
    assert.equal(tagged.jobs.find((j) => j.id === 'j1').branchId, undefined);
    setLocalBranch('main');
    assert.equal(tagNewRecords(ledger, after), after);
  } finally {
    setLocalBranch('main');
  }
});

import { defaultMoneyAccount, operationEvent, applyOperation } from '../src/operations.mjs';

test('money accounts belong to a branch or are shared', () => {
  const actor = { id: 'u1', label: 'Owner' };
  const create = (ledger, data) =>
    applyOperation(
      ledger,
      operationEvent('account.created', { openingDate: '2026-10-01', openingBalance: 0, ...data }, actor),
    );
  let ledger = { moneyAccounts: [], accountEntries: [], operationHistory: [] };
  try {
    setLocalBranch('main');
    ledger = create(ledger, { id: 'a1', name: 'Kano POS', accountType: 'pos', methods: ['POS'] });
    assert.equal(ledger.moneyAccounts[0].branch, 'main');
    // Another branch can have its own POS account for the same method.
    ledger = create(ledger, {
      id: 'a2',
      name: 'Zoo POS',
      accountType: 'pos',
      methods: ['POS'],
      branch: 'b-zoo0000001',
    });
    // A shared account cannot take a method a branch already uses.
    assert.throws(
      () =>
        create(ledger, {
          id: 'a3',
          name: 'Business bank',
          accountType: 'bank',
          methods: ['POS'],
          branch: '*',
        }),
      /one default account in a branch/,
    );
    ledger = create(ledger, {
      id: 'a3',
      name: 'Business bank',
      accountType: 'bank',
      methods: ['Transfer'],
      branch: '*',
    });
    assert.equal(defaultMoneyAccount(ledger, 'POS'), 'a1');
    assert.equal(defaultMoneyAccount(ledger, 'Transfer'), 'a3');
    setLocalBranch('b-zoo0000001');
    assert.equal(defaultMoneyAccount(ledger, 'POS'), 'a2');
    assert.equal(defaultMoneyAccount(ledger, 'Transfer'), 'a3');
    // Each branch sees its own accounts and the shared one.
    assert.deepEqual(
      branchLedger(ledger).moneyAccounts.map((a) => a.id),
      ['a2', 'a3'],
    );
  } finally {
    setLocalBranch('main');
  }
});
