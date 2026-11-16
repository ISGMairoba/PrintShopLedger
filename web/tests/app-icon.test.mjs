import test from 'node:test';
import assert from 'node:assert/strict';
import { appIconSource, validateAppIcon } from '../src/app-icon.mjs';
import { defaultBranding, validateBranding } from '../src/business-branding.mjs';

const png = 'data:image/png;base64,iVBORw0KGgo=';

test('the app icon is off by default and keeps only its own fields', () => {
  assert.deepEqual(validateAppIcon(undefined), { layout: 'none', background: '#ffffff', png: '' });
  assert.deepEqual(validateAppIcon({ layout: 'none', background: '#000000', png }), {
    layout: 'none',
    background: '#000000',
    png: '',
  });
  assert.throws(() => validateAppIcon({ layout: 'logo', background: '#fff', png: '' }), /layout/);
  assert.throws(() => validateAppIcon({ layout: 'icon', background: 'red', png: '' }), /background/);
  assert.throws(() =>
    validateAppIcon({ layout: 'icon', background: '#ffffff', png: 'data:image/svg+xml;base64,AA' }),
  );
});

test('the icon is drawn from the chosen layout, in the version that suits the background', () => {
  const settings = {
    ...defaultBranding(),
    logoVariants: { ...defaultBranding().logoVariants, icon: { light: 'L', dark: 'D' } },
  };
  assert.equal(appIconSource(settings, 'icon', '#ffffff'), 'L');
  assert.equal(appIconSource(settings, 'icon', '#101820'), 'D');
  assert.equal(appIconSource(settings, 'none', '#ffffff'), '');
});

test('branding saved before the app icon existed still loads', () => {
  const old = { ...defaultBranding(), businessName: 'Ink & Co' };
  delete old.appIcon;
  assert.equal(validateBranding(old).appIcon.layout, 'none');
});

test('the icon may have no background', () => {
  assert.equal(validateAppIcon({ layout: 'icon', background: 'transparent', png: '' }).background, 'transparent');
  const settings = {
    ...defaultBranding(),
    logoVariants: { ...defaultBranding().logoVariants, icon: { light: 'L', dark: 'D' } },
  };
  assert.equal(appIconSource(settings, 'icon', 'transparent'), 'L');
});
