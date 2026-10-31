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
