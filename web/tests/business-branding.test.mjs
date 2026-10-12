import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultBranding,
  validateBranding,
  validLogo,
  contrastText,
  suggestedPalette,
  defaultBackgrounds,
  themeColors,
  themeVariables,
  contrastRatio,
} from '../src/business-branding.mjs';
import { receiptHtml } from '../src/receipts.mjs';
test('profile validates contact details, safe logos, colors and receipt options', () => {
  const input = {
    ...defaultBranding(),
    businessName: '  Mairoba Studio  ',
    email: 'studio@example.com',
    website: 'https://example.com',
  };
  assert.equal(validateBranding(input).businessName, 'Mairoba Studio');
  assert.equal(input.businessName, '  Mairoba Studio  ');
  for (const patch of [
    { businessName: '' },
    { email: 'invalid' },
    { website: 'javascript:alert(1)' },
    { logo: 'data:image/svg+xml;base64,QQ==' },
    { logo: 'https://example.com/logo.png' },
    { primary: 'red' },
    { theme: 'night' },
    { receipt: { showLogo: 'true' } },
  ])
    assert.throws(() => validateBranding({ ...input, ...patch }));
  assert.ok(validLogo('data:image/png;base64,QQ=='));
  assert.ok(!validLogo('data:image/png;base64,QQ==" onerror="bad'));
});
test('brand buttons select contrasting text, logo palette ignores transparent and plain white pixels', () => {
  assert.equal(contrastText('#000000'), '#ffffff');
  assert.equal(contrastText('#ffffff'), '#000000');
  assert.deepEqual(
    suggestedPalette(
      new Uint8ClampedArray([255, 255, 255, 255, 30, 140, 50, 0, 200, 20, 20, 255, 200, 20, 20, 255]),
    ),
    ['#c01818'],
  );
});
test('receipt branding is escaped, optional, and does not change money', () => {
  const record = {
    id: 'receipt',
    customerSnapshot: { name: 'Customer', phone: '080111' },
    createdAt: '2026-10-08T00:00:00Z',
    createdByLabel: 'Cashier',
    jobs: [],
    jobBalances: [
      {
        id: 'job',
        description: 'Banner',
        service: 'Printing',
        amount: 4500000,
        paidBefore: 0,
        paidThisCheckout: 500000,
        outstandingAfter: 4000000,
      },
    ],
    total: 0,
    cashReceived: 500000,
    walletUsed: 0,
    walletAdded: 0,
    walletAfter: 0,
    outstandingAfter: 4000000,
    method: 'Cash',
    paidOn: '2026-10-08',
  };
  const b = {
    ...defaultBranding(),
    businessName: 'Mairoba <Studio>',
    address: 'Kano <address>',
    phones: '080111',
    logo: 'data:image/png;base64,QQ==',
  };
  let html = receiptHtml(record, b);
  for (const value of [
    'Mairoba &lt;Studio&gt;',
    'Kano &lt;address&gt;',
    'Business logo',
    '₦45,000.00',
    '₦5,000.00',
    '₦40,000.00',
  ])
    assert.ok(html.includes(value));
  b.receiptPage = {
    showLogo: false,
    showAddress: false,
    showContacts: false,
    footer: '<script>footer</script>',
  };
  html = receiptHtml(record, b);
  assert.ok(!html.includes('Business logo'));
  assert.ok(!html.includes('Kano'));
  assert.ok(html.includes('&lt;script&gt;footer&lt;/script&gt;'));
  assert.ok(receiptHtml(record, 'Old shop').includes('Old shop'));
});
test('Old business settings gain recent-job and access defaults without losing saved branding', () => {
  const old = { ...defaultBranding(), businessName: 'Mairoba Studio' };
  delete old.corrections;
  delete old.pageAccess;
  const upgraded = validateBranding(old);
  assert.equal(upgraded.corrections.recentDays, 7);
  assert.equal(upgraded.pageAccess['1'].includes('Sale Adjustments'), false);
  assert.equal(upgraded.businessName, 'Mairoba Studio');
});
test('Correction window and role page settings reject invalid or elevated access', () => {
  const current = { ...defaultBranding(), businessName: 'Mairoba Studio' };
  for (const days of [0, 366, 1.5, '7'])
    assert.throws(() => validateBranding({ ...current, corrections: { recentDays: days } }));
  assert.throws(() =>
    validateBranding({
      ...current,
      pageAccess: { 1: ['My Account', 'Conflict Inbox'], 2: current.pageAccess['2'] },
    }),
  );
  assert.throws(() => validateBranding({ ...current, pageAccess: { 1: [], 2: current.pageAccess['2'] } }));
});

test('Legacy settings gain independent automatic background defaults without changing branding', () => {
  const old = { ...defaultBranding(), businessName: 'Studio', primary: '#2748ab' };
  delete old.backgrounds;
  const upgraded = validateBranding(old);
  assert.deepEqual(upgraded.backgrounds, defaultBackgrounds());
  assert.equal(upgraded.primary, old.primary);
  assert.ok(!('backgrounds' in old));
  upgraded.backgrounds.dark.canvas = '#111111';
  assert.equal(defaultBackgrounds().dark.canvas, '');
  assert.equal(upgraded.backgrounds.light.canvas, '');
});
test('Automatic backgrounds follow the primary palette in both themes', () => {
  const blue = { ...defaultBranding(), primary: '#2244ee' },
    red = { ...defaultBranding(), primary: '#ee4422' };
  for (const mode of ['light', 'dark']) {
    const b = themeColors(blue, mode),
      r = themeColors(red, mode);
    assert.notEqual(b.canvas, r.canvas);
    assert.notEqual(b.surfaceAlt, r.surfaceAlt);
    const channels = b.canvas
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16));
    assert.ok(channels[2] > channels[0], 'Blue primary creates blue-tinted canvas');
    if (mode === 'dark') assert.notEqual(b.surface, r.surface);
  }
});
test('Custom backgrounds are validated, independent and preserved across palette changes', () => {
  const input = {
    ...defaultBranding(),
    businessName: 'Studio',
    backgrounds: {
      light: { canvas: '#FEDCBA' },
      dark: { canvas: '#123456', surface: '#ABCDEF', surfaceAlt: '#030405' },
    },
  };
  const saved = validateBranding(input);
  assert.equal(saved.backgrounds.light.canvas, '#fedcba');
  assert.equal(saved.backgrounds.light.surface, '');
  for (const primary of ['#008800', '#880088']) {
    const c = themeColors({ ...saved, primary }, 'dark');
    assert.equal(c.canvas, '#123456');
    assert.equal(c.surface, '#abcdef');
    assert.equal(c.surfaceAlt, '#030405');
  }
  for (const backgrounds of [
    null,
    [],
    { night: {} },
    { dark: null },
    { dark: [] },
    { dark: { unknown: '#ffffff' } },
    { light: { surface: 'red' } },
    { dark: { canvas: '#123' } },
    { dark: { surface: 123 } },
    { dark: { surface: null } },
  ])
    assert.throws(() => validateBranding({ ...input, backgrounds }));
  const reset = themeColors({ ...saved, backgrounds: defaultBackgrounds() }, 'dark');
  assert.notEqual(reset.canvas, '#123456');
});
test('Foreground and muted text meet contrast requirements even on unusual custom backgrounds', () => {
  for (const primary of ['#ffffff', '#000000', '#ffff00', '#001aff', '#ff0055'])
    for (const color of ['#ffffff', '#000000', '#777777', '#ffff00', '#001aff'])
      for (const mode of ['light', 'dark']) {
        const settings = {
            ...defaultBranding(),
            primary,
            backgrounds: {
              ...defaultBackgrounds(),
              [mode]: { canvas: color, surface: color, surfaceAlt: color },
            },
          },
          c = themeColors(settings, mode);
        for (const [text, bg] of [
          [c.ink, c.surface],
          [c.canvasInk, c.canvas],
          [c.controlInk, c.surfaceAlt],
          [c.subtle, c.surface],
          [c.canvasSubtle, c.canvas],
          [c.controlSubtle, c.surfaceAlt],
          [c.link, c.surface],
        ])
          assert.ok(contrastRatio(text, bg) >= 4.5, `${text} on ${bg}`);
        const vars = themeVariables(settings, mode);
        assert.equal(vars['--canvas'], color);
        assert.equal(vars['--surface-alt'], color);
        assert.equal(vars['--brand-primary'], primary);
      }
});
