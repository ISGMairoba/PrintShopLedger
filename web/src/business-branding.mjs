import { validDocumentTerms } from './document-terms.mjs';
import { logoPositions } from './document-logos.mjs';
import {
  logoVariantsDefaults,
  logoUsageDefaults,
  validateLogoVariants,
  validateLogoUsage,
  resolveLogo,
} from './logo-variants.mjs';
import {
  validatePageAccess,
  defaultPageAccess,
  upgradePageAccess,
  validateSettingsTabs,
  upgradeSettingsTabs,
  SETTINGS_TABS_VERSION,
  defaultSettingsTabs,
  PAGE_ACCESS_VERSION,
} from './page-access.mjs';
import { defaultOptions, validateOptions } from './business-options.mjs';
import { discountDefaults, validateDiscountSettings } from './discounts.mjs';
import { termDefaults, validateTerms } from './terms.mjs';
import { validateBranchAccess, validateBranches } from './branches.mjs';
import { pricingDefaults, validatePricingSettings } from './pricing-templates.mjs';
// What each business shows on its receipts. headline: the bold line for each job ('description' or 'service');
// showSubline: print the other one beneath it. Older saved settings fill in these defaults.
export const receiptContentDefaults = () => ({
  headline: 'description',
  showSubline: true,
  showJobId: true,
  showQuantity: true,
  showSize: true,
  showSource: true,
  showDueDate: true,
  showPaidBefore: true,
  showPaidNow: true,
  showItemBalance: true,
  showCustomerPhone: true,
  showCashier: true,
  showPaymentDate: true,
  showPaymentMethod: true,
  showWalletMovements: true,
  showAccountBalances: true,
  showNote: true,
});
// Jobs and checkout. defaultDuration: how long a new job is given before it is due (0 = no deadline
// unless one is entered). paymentPrefill: what the payment amount box starts with at checkout.
export const jobSettingsDefaults = () => ({
  defaultDuration: { value: 0, unit: 'days' },
  paymentPrefill: 'suggested',
  descriptionMode: 'required',
  // 'allow': stock may go below zero (with a warning); 'block': nothing takes more than is in stock.
  stockBelowZero: 'allow',
});
// The period each page opens with. 'all' is offered only where a page can list everything.
export const defaultPeriods = () => ({
  dashboard: 'month',
  reports: 'month',
  pointOfService: '30days',
  jobs: 'all',
  payments: 'all',
  expenses: 'all',
  stockHistory: 'all',
  mySales: 'today',
});
export const periodChoices = ['today', 'week', 'month', '30days', 'all'];
export const pagesWithoutAll = ['dashboard', 'reports'];
// The installer's credit ("Installed by … | phone"). Only Developer can change it (the server keeps
// it out of every Business Settings tab). Each switch chooses where the line appears.
export const POWERED_BY_MAX = 60;
export const poweredByDefaults = () => ({
  text: '',
  receipts: false,
  pages: false,
  reports: false,
  shares: false,
});
export function validatePoweredBy(input) {
  const value = { ...poweredByDefaults(), ...(input ?? {}) };
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !(key in poweredByDefaults()))
  )
    throw Error('Invalid installer credit.');
  if (typeof value.text !== 'string' || /[\x00-\x1f\x7f]/.test(value.text))
    throw Error('The installer credit must be a single line of text.');
  value.text = value.text.trim().replace(/\s+/g, ' ');
  if (value.text.length > POWERED_BY_MAX)
    throw Error(`Keep the installer credit to ${POWERED_BY_MAX} characters so it fits on a receipt.`);
  for (const key of ['receipts', 'pages', 'reports', 'shares'])
    if (typeof value[key] !== 'boolean') throw Error('Invalid installer credit.');
  return value;
}
/**
 * The installer credit for one kind of output, or '' when it is off there.
 * where: 'receipts' (receipt printers), 'pages' (full-page receipts, quotations, comparisons),
 * 'reports' (report PDFs) or 'shares' (text pasted in chat).
 */
export function poweredByLine(business, where) {
  if (!business || typeof business !== 'object') return '';
  const p = business.poweredBy;
  if (!p || typeof p.text !== 'string' || p[where] !== true) return '';
  return p.text.trim().replace(/\s+/g, ' ').slice(0, POWERED_BY_MAX);
}
export const defaultBackgrounds = () => ({
  light: { canvas: '', surface: '', surfaceAlt: '' },
  dark: { canvas: '', surface: '', surfaceAlt: '' },
});
export const defaultBranding = () => ({
  businessName: '',
  address: '',
  phones: '',
  email: '',
  website: '',
  socials: '',
  logo: '',
  logoVariants: logoVariantsDefaults(),
  logoUsage: logoUsageDefaults(),
  primary: '#124b40',
  accent: '#d9a126',
  theme: 'system',
  backgrounds: defaultBackgrounds(),
  options: defaultOptions(),
  corrections: { recentDays: 7 },
  // syncMinutes: how often devices check for changes made on other devices.
  security: { autoLockMinutes: 0, syncMinutes: 2 },
  jobs: jobSettingsDefaults(),
  pricing: pricingDefaults(),
  periods: defaultPeriods(),
  discounts: discountDefaults(),
  terms: termDefaults(),
  pageAccess: defaultPageAccess(),
  pageAccessVersion: PAGE_ACCESS_VERSION,
  settingsTabs: defaultSettingsTabs(),
  settingsTabsVersion: SETTINGS_TABS_VERSION,
  receipt: {
    showLogo: true,
    showBusinessName: true,
    showAddress: true,
    showContacts: true,
    footer: 'Thank you for your business.',
    logoLayout: '',
    logoPosition: 'right',
    ...receiptContentDefaults(),
  },
  receiptPage: {
    logoLayout: '',
    logoPosition: 'right',
    showLogo: true,
    showBusinessName: true,
    showAddress: true,
    showContacts: true,
    footer: 'Thank you for your business.',
    ...receiptContentDefaults(),
  },
  documents: {
    watermark: false,
    watermarkLogoLayout: '',
    invoiceTerms: '',
    quotationTerms: '',
    showTermsOnRoll: false,
  },
  poweredBy: poweredByDefaults(),
  /** Branches beyond the main one ([] = only the main branch); see branches.mjs. */
  branches:
    /** @type {{ id: string, name: string, address: string, phone: string, archived: boolean }[]} */ ([]),
  /** Which branches each staff member works in: { memberId: ['main', …] or ['*'] }. */
  branchAccess: /** @type {Record<string, string[]>} */ ({}),
  /** 'shared': one price list; 'perBranch': each branch may set its own prices. */
  branchPricing: /** @type {'shared' | 'perBranch'} */ ('shared'),
});
export function validLogo(value) {
  return (
    value === '' ||
    (typeof value === 'string' &&
      value.length <= 350000 &&
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
  );
}
export function validateBranding(input) {
  const value = structuredClone(input);
  for (const [key, max] of Object.entries({
    businessName: 160,
    address: 500,
    phones: 200,
    email: 200,
    website: 300,
    socials: 500,
  })) {
    if (
      typeof value?.[key] !== 'string' ||
      value[key].length > max ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value[key])
    )
      throw Error(`Invalid ${key}.`);
    value[key] = value[key].trim();
  }
  if (!value.businessName) throw Error('Enter the business name.');
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))
    throw Error('Enter a valid email address.');
  if (value.website && !/^https?:\/\/[^\s]+$/i.test(value.website))
    throw Error('Website must start with https:// or http://.');
  if (!validLogo(value.logo)) throw Error('Choose a PNG or JPEG logo (up to 250 KB after processing).');
  value.logoVariants = validateLogoVariants(value.logoVariants);
  value.logoUsage = validateLogoUsage(value.logoUsage);
  // Leave room for JSONB whitespace in the database's 4 MB payload budget.
  if (new TextEncoder().encode(JSON.stringify(value)).length > 3900000)
    throw Error('Business settings are too large. Use smaller logos or remove unused logo variants.');
  for (const key of ['primary', 'accent'])
    if (!/^#[0-9a-f]{6}$/i.test(value[key])) throw Error('Choose valid brand colors.');
  if (!['light', 'dark', 'system'].includes(value.theme)) throw Error('Choose Light, Dark or System.');
  value.backgrounds = validateBackgrounds(value.backgrounds);
  // Till-roll receipts (receipt) and full-page receipts (receiptPage) are set separately.
  // Settings saved before the split start the page copy from the roll settings.
  value.receipt = validateReceiptOptions(value.receipt);
  value.receiptPage = validateReceiptOptions(value.receiptPage ?? value.receipt);
  value.documents ??= { watermark: false };
  if (typeof value.documents !== 'object' || typeof value.documents.watermark !== 'boolean')
    throw Error('Invalid document options.');
  const watermarkLogoLayout = value.documents.watermarkLogoLayout ?? '';
  if (!['', 'complete', 'stacked', 'horizontal', 'wordmark', 'icon'].includes(watermarkLogoLayout))
    throw Error('Choose a valid watermark logo.');
  if (value.documents.showTermsOnRoll !== undefined && typeof value.documents.showTermsOnRoll !== 'boolean')
    throw Error('Invalid receipt terms option.');
  value.documents = {
    watermark: value.documents.watermark,
    watermarkLogoLayout,
    invoiceTerms: validDocumentTerms(value.documents.invoiceTerms),
    quotationTerms: validDocumentTerms(value.documents.quotationTerms),
    showTermsOnRoll: value.documents.showTermsOnRoll ?? false,
  };
  value.poweredBy = validatePoweredBy(value.poweredBy);
  value.options = validateOptions(value.options);
  if (value.pageAccessVersion !== PAGE_ACCESS_VERSION)
    value.pageAccess = upgradePageAccess(value.pageAccess, value.pageAccessVersion ?? 0);
  value.pageAccess = validatePageAccess(value.pageAccess);
  value.pageAccessVersion = PAGE_ACCESS_VERSION;
  value.settingsTabs = validateSettingsTabs(
    upgradeSettingsTabs(value.settingsTabs, value.settingsTabsVersion ?? 0),
  );
  value.settingsTabsVersion = SETTINGS_TABS_VERSION;
  value.jobs = validateJobSettings(value.jobs);
  value.pricing = validatePricingSettings(value.pricing);
  value.discounts = validateDiscountSettings(value.discounts);
  value.terms = validateTerms(value.terms);
  value.branches = validateBranches(value.branches);
  value.branchAccess = validateBranchAccess(value.branchAccess, value.branches);
  value.branchPricing ??= 'shared';
  if (!['shared', 'perBranch'].includes(value.branchPricing)) throw Error('Choose how branches price items.');
  value.periods = { ...defaultPeriods(), ...value.periods };
  for (const [key, preset] of Object.entries(value.periods))
    if (
      !(key in defaultPeriods()) ||
      !periodChoices.includes(preset) ||
      (preset === 'all' && pagesWithoutAll.includes(key))
    )
      throw Error('Choose a valid default period for each page.');
  value.corrections ??= { recentDays: 7 };
  if (
    !Number.isInteger(value.corrections.recentDays) ||
    value.corrections.recentDays < 1 ||
    value.corrections.recentDays > 365
  )
    throw Error('Choose a correction history window from 1 to 365 days.');
  value.security = { autoLockMinutes: 0, syncMinutes: 2, ...value.security };
  const lock = value.security.autoLockMinutes;
  const sync = value.security.syncMinutes;
  if (!Number.isInteger(sync) || sync < 1 || sync > 60)
    throw Error('Choose a sync check time from 1 to 60 minutes.');
  if (
    Object.keys(value.security).some((key) => key !== 'autoLockMinutes' && key !== 'syncMinutes') ||
    !Number.isInteger(lock) ||
    lock < 0 ||
    lock > 240
  )
    throw Error('Choose an auto-lock time from 0 to 240 minutes.');
  return value;
}
export function contrastText(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
export function validateBackgrounds(input) {
  const result = defaultBackgrounds();
  // Older saved settings use palette-derived backgrounds until explicitly customized.
  if (input === undefined) return result;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['light', 'dark'].includes(key))
  )
    throw Error('Invalid background settings.');
  for (const mode of ['light', 'dark']) {
    const colors = input[mode];
    if (colors === undefined) continue;
    if (
      !colors ||
      typeof colors !== 'object' ||
      Array.isArray(colors) ||
      Object.keys(colors).some((key) => !['canvas', 'surface', 'surfaceAlt'].includes(key))
    )
      throw Error('Invalid background settings.');
    for (const key of ['canvas', 'surface', 'surfaceAlt']) {
      const color = colors[key] ?? '';
      if (
        typeof color !== 'string' ||
        (color !== '' && !/^#[0-9a-f]{6}$/i.test(color)) ||
        colors[key] === null
      )
        throw Error('Choose valid background colors.');
      result[mode][key] = color.toLowerCase();
    }
  }
  return result;
}
function mixColor(from, to, weight) {
  const a = from
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16)),
    b = to
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16));
  return (
    '#' +
    a
      .map((value, i) =>
        Math.round(value * (1 - weight) + b[i] * weight)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function luminance(hex) {
  const c = hex
    .slice(1)
    .match(/../g)
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrastRatio(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function readableColor(color, background) {
  const target = contrastText(background);
  for (let weight = 0; weight <= 1; weight += 0.05) {
    const candidate = mixColor(color, target, weight);
    if (contrastRatio(candidate, background) >= 4.5) return candidate;
  }
  return target;
}
export function themeColors(settings, mode) {
  const primary = settings.primary,
    custom = settings.backgrounds?.[mode] ?? {},
    dark = mode === 'dark';
  const canvas =
    custom.canvas || (dark ? mixColor('#000000', primary, 0.16) : mixColor('#ffffff', primary, 0.05));
  const surface = custom.surface || (dark ? mixColor('#000000', primary, 0.3) : '#ffffff');
  const surfaceAlt =
    custom.surfaceAlt || (dark ? mixColor('#000000', primary, 0.43) : mixColor('#ffffff', primary, 0.08));
  const ink = contrastText(surface),
    canvasInk = contrastText(canvas),
    controlInk = contrastText(surfaceAlt);
  return {
    canvas,
    surface,
    surfaceAlt,
    ink,
    canvasInk,
    controlInk,
    subtle: readableColor(mixColor(surface, ink, 0.62), surface),
    canvasSubtle: readableColor(mixColor(canvas, canvasInk, 0.62), canvas),
    controlSubtle: readableColor(mixColor(surfaceAlt, controlInk, 0.62), surfaceAlt),
    line: mixColor(surface, ink, 0.22),
    controlLine: mixColor(surfaceAlt, controlInk, 0.28),
    link: readableColor(primary, surface),
  };
}
export function themeVariables(settings, mode) {
  const c = themeColors(settings, mode);
  return {
    '--brand-primary': settings.primary,
    '--brand-accent': settings.accent,
    '--brand-on-primary': contrastText(settings.primary),
    '--canvas': c.canvas,
    '--surface': c.surface,
    '--surface-alt': c.surfaceAlt,
    '--ink': c.ink,
    '--canvas-ink': c.canvasInk,
    '--control-ink': c.controlInk,
    '--subtle': c.canvasSubtle,
    '--surface-subtle': c.subtle,
    '--control-subtle': c.controlSubtle,
    '--line': c.line,
    '--control-line': c.controlLine,
    '--brand-link': c.link,
  };
}
export function validateJobSettings(input) {
  const value = { ...jobSettingsDefaults(), ...input };
  const duration = value.defaultDuration;
  if (
    !duration ||
    !Number.isInteger(duration.value) ||
    duration.value < 0 ||
    !['hours', 'days'].includes(duration.unit) ||
    duration.value > (duration.unit === 'hours' ? 720 : 365)
  )
    throw Error('Default job duration must be 0–720 hours or 0–365 days.');
  if (!['suggested', 'zero'].includes(value.paymentPrefill))
    throw Error('Choose how the payment amount is filled in.');
  if (!['required', 'optional', 'hidden'].includes(value.descriptionMode))
    throw Error('Choose whether job descriptions are required, optional or hidden.');
  if (!['allow', 'block'].includes(value.stockBelowZero))
    throw Error('Choose whether stock may go below zero.');
  return {
    stockBelowZero: value.stockBelowZero,
    descriptionMode: value.descriptionMode,
    defaultDuration: { value: duration.value, unit: duration.unit },
    paymentPrefill: value.paymentPrefill,
  };
}
export function validateReceiptOptions(input) {
  if (!input || typeof input !== 'object') throw Error('Invalid receipt options.');
  const value = { ...input };
  value.logoPosition ??= 'right';
  if (!Object.hasOwn(logoPositions, value.logoPosition)) throw Error('Choose a valid logo position.');
  value.logoLayout ??= '';
  if (!['', 'complete', 'stacked', 'horizontal', 'wordmark', 'icon'].includes(value.logoLayout))
    throw Error('Choose a valid receipt logo layout.');
  value.showBusinessName ??= true;
  for (const key of ['showLogo', 'showBusinessName', 'showAddress', 'showContacts'])
    if (typeof value[key] !== 'boolean') throw Error('Invalid receipt options.');
  if (typeof value.footer !== 'string' || value.footer.length > 500)
    throw Error('Receipt footer must be up to 500 characters.');
  value.footer = value.footer.trim();
  for (const [key, fallback] of Object.entries(receiptContentDefaults())) {
    value[key] ??= fallback;
    if (
      key === 'headline' ? !['description', 'service'].includes(value[key]) : typeof value[key] !== 'boolean'
    )
      throw Error('Invalid receipt content options.');
  }
  return value;
}
export function receiptBusiness(input, usage = 'documents') {
  if (typeof input === 'string') return { ...defaultBranding(), businessName: input };
  return {
    ...defaultBranding(),
    ...input,
    logo: resolveLogo(input, usage, 'light'),
    receipt: { ...defaultBranding().receipt, ...input?.receipt },
    receiptPage: { ...defaultBranding().receiptPage, ...(input?.receiptPage ?? input?.receipt) },
    documents: { ...defaultBranding().documents, ...input?.documents },
    poweredBy: { ...poweredByDefaults(), ...input?.poweredBy },
  };
}
export function suggestedPalette(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const [r, g, b, a] = pixels.slice(i, i + 4);
    if (a < 180 || Math.max(r, g, b) < 25 || Math.min(r, g, b) > 235) continue;
    const rgb = [r, g, b].map((v) => Math.min(255, Math.round(v / 24) * 24));
    const key = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => hex);
}
