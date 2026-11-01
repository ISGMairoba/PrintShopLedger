import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOptionsSection } from '../src/options-sections.mjs';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
import { allowedSettingsTabs } from '../src/page-access.mjs';
import { emptyLedger } from '../src/domain.mjs';
import { operationEvent, applyOperation, accountBalance } from '../src/operations.mjs';
test('payment and dropdown section saves preserve the other saved section', () => {
  const saved = { paymentMethods: [{ label: 'Cash' }], jobSources: ['Shop'] },
    draft = { paymentMethods: [{ label: 'Card' }], jobSources: ['Website'] };
  assert.deepEqual(mergeOptionsSection(saved, draft, 'payments'), {
    paymentMethods: draft.paymentMethods,
    jobSources: saved.jobSources,
  });
  assert.deepEqual(mergeOptionsSection(saved, draft, 'workflow'), {
    paymentMethods: saved.paymentMethods,
    jobSources: draft.jobSources,
  });
});
test('existing dropdown access upgrades once; account setup remains Developer only', () => {
  const b = {
    ...defaultBranding(),
    businessName: 'Shop',
    settingsTabsVersion: undefined,
    settingsTabs: { 2: ['Dropdowns & workflow'], 3: [] },
  };
  b.pageAccess['2'].push('Business Settings');
  const up = validateBranding(b);
  assert.ok(!allowedSettingsTabs(2, up).includes('Payment methods'));
  assert.ok(!allowedSettingsTabs(2, up).includes('Accounts & payment methods'));
  assert.ok(allowedSettingsTabs(4, up).includes('Accounts & payment methods'));
  up.settingsTabs['2'] = ['Dropdowns & workflow'];
  assert.ok(!allowedSettingsTabs(2, validateBranding(up)).includes('Payment methods'));
});
test('all editable account fields update together with before/after history and stale protection', () => {
  const actor = { id: 'dev', label: 'Developer' },
    create = operationEvent(
      'account.created',
      {
        id: 'a',
        name: 'Bank',
        accountType: 'bank',
        openingDate: '2026-10-01',
        openingBalance: 10000,
        methods: ['Transfer'],
      },
      actor,
    );
  let ledger = applyOperation(emptyLedger(), create);
  const change = operationEvent(
    'account.updated',
    {
      id: 'a',
      baseVersion: 1,
      name: 'POS',
      accountType: 'pos',
      openingDate: '2026-10-02',
      openingBalance: -5000,
      methods: ['POS'],
      branch: '*',
    },
    actor,
  );
  ledger = applyOperation(ledger, change);
  const a = ledger.moneyAccounts[0];
  assert.equal(a.openingDate, '2026-10-02');
  assert.equal(a.openingBalance, -5000);
  assert.equal(a.accountType, 'pos');
  assert.equal(a.branch, '*');
  assert.equal(accountBalance(ledger, 'a').balance, -5000);
  assert.equal(ledger.operationHistory[1].before.openingBalance, 10000);
  assert.equal(ledger.operationHistory[1].after.openingBalance, -5000);
  assert.throws(
    () => applyOperation(ledger, operationEvent('account.updated', change.data, actor)),
    /changed/,
  );
});
