import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';
import { settingsTabKeys, allowedSettingsTabs } from '../src/page-access.mjs';
test('Words and time frames are independent settings sections with inherited access once', () => {
  const old = {
    ...defaultBranding(),
    businessName: 'Shop',
    settingsTabsVersion: 1,
    settingsTabs: { 2: ['Jobs & payments', 'Dropdowns & workflow'], 3: [] },
  };
  old.pageAccess['2'].push('Business Settings');
  const up = validateBranding(old);
  assert.ok(allowedSettingsTabs(2, up).includes('Words'));
  assert.ok(allowedSettingsTabs(2, up).includes('Default time frames'));
  assert.ok(
    !allowedSettingsTabs(2, up).includes('Payment methods'),
    'Previously revoked payment-method access was re-enabled',
  );
  assert.deepEqual(settingsTabKeys.Words, ['terms']);
  assert.deepEqual(settingsTabKeys['Default time frames'], ['periods']);
  assert.deepEqual(settingsTabKeys['Jobs & payments'], ['jobs', 'discounts']);
  up.settingsTabs['2'] = ['Jobs & payments'];
  assert.ok(!allowedSettingsTabs(2, validateBranding(up)).includes('Words'));
});
