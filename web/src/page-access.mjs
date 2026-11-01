// Every page, in menu order. Each one is set separately in Business Settings → Page access.
export const pages = [
  'Dashboard',
  'Reports',
  'Point of Service',
  'Quotations',
  'Pricing Templates',
  'My Sales',
  'Jobs',
  'Customers',
  'Payment Reminders',
  'Payments',
  'Expenses',
  'Payees',
  'Accounts',
  'Materials',
  'Services',
  'Edit Products',
  'Stock History',
  'Print Settings',
  'Users',
  'My Account',
  'Business Settings',
  'Conflict Inbox',
  'Sale Adjustments',
  'Material Waste',
];
export const navigationPages = pages;
/** Menu sections: each page's group heading. */
export const pageGroups = [
  ['Selling', ['Dashboard', 'Reports', 'Point of Service', 'Quotations', 'Pricing Templates', 'My Sales']],
  ['Jobs & money', ['Jobs', 'Customers', 'Payment Reminders', 'Payments', 'Expenses', 'Payees', 'Accounts']],
  ['Stock & catalogue', ['Materials', 'Material Waste', 'Services', 'Edit Products', 'Stock History']],
  [
    'Settings & control',
    ['Print Settings', 'Users', 'My Account', 'Business Settings', 'Conflict Inbox', 'Sale Adjustments'],
  ],
];
export const pageGroup = (page) => pageGroups.find(([, list]) => list.includes(page))?.[0] ?? '';
// Before every page could be set separately, these pages followed another page. Settings saved
// then (pageAccessVersion missing) are upgraded once by giving each one its old page's access.
export const formerParents = {
  Reports: 'Dashboard',
  Quotations: 'Point of Service',
  'Pricing Templates': 'Point of Service',
  'Payment Reminders': 'Customers',
  'Edit Products': 'Services',
  Payees: 'Expenses',
  Accounts: 'Expenses',
};
export const PAGE_ACCESS_VERSION = 3;
/** The Business Settings tabs. Page access is always Developer only. */
export const settingsTabs = [
  'Profile & logo',
  'Appearance',
  'Receipts',
  'Dropdowns & workflow',
  'Jobs & payments',
  'Default time frames',
  'Words',
  'Pricing templates',
  'Corrections',
  'Security',
  'Branches',
];
/** The saved settings each tab changes (the server uses the same list). */
export const settingsTabKeys = {
  'Profile & logo': [
    'businessName',
    'address',
    'phones',
    'email',
    'website',
    'socials',
    'logo',
    'logoVariants',
    'logoUsage',
  ],
  Appearance: ['primary', 'accent', 'theme', 'backgrounds'],
  Receipts: ['receipt', 'receiptPage', 'documents'],
  'Payment methods': ['options'],
  'Dropdowns & workflow': ['options'],
  'Jobs & payments': ['jobs', 'discounts'],
  'Default time frames': ['periods'],
  Words: ['terms'],
  'Pricing templates': ['pricing'],
  Corrections: ['corrections'],
  Security: ['security'],
  Branches: ['branches', 'branchAccess', 'branchPricing'],
};
export const defaultSettingsTabs = () => ({
  2: [...settingsTabs],
  3: [...settingsTabs],
  4: [...settingsTabs],
});
export function validateSettingsTabs(input) {
  const value = input === undefined ? defaultSettingsTabs() : structuredClone(input);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['2', '3', '4'].includes(key))
  )
    throw Error('Invalid Business Settings tab access.');
  for (const rank of ['2', '3', '4']) {
    // The General Manager has the Manager's tabs until Developer sets their own.
    value[rank] ??= rank === '4' ? [...value['3']] : [...settingsTabs];
    const tabs = value[rank];
    if (
      !Array.isArray(tabs) ||
      new Set(tabs).size !== tabs.length ||
      tabs.some((t) => !settingsTabs.includes(t))
    )
      throw Error('Invalid Business Settings tab access.');
    value[rank] = settingsTabs.filter((t) => tabs.includes(t));
  }
  return value;
}
/** Tabs only Developer sees, with the settings each changes. Admin and Manager can never be given them. */
export const developerSettingsTabs = {
  'Accounts & payment methods': [],
  'Page access': ['pageAccess', 'settingsTabs', 'settingsTabsVersion'],
  'Installer credit': ['poweredBy'],
};
/** Business Settings tabs this rank may open (Page access, Account setup and Installer credit only for Developer). */
export function allowedSettingsTabs(access, settings) {
  if (access === 5) return [...settingsTabs, ...Object.keys(developerSettingsTabs)];
  if (!canAccessPage('Business Settings', access, settings?.pageAccess)) return [];
  return (
    settings?.settingsTabs?.[String(access)] ??
    (access === 4 ? settings?.settingsTabs?.['3'] : undefined) ??
    defaultSettingsTabs()[String(access)] ??
    []
  );
}
export const roleNames = { 1: 'Cashier', 2: 'Admin', 3: 'Manager', 4: 'General Manager', 5: 'Developer' };
export const minimumPageAccess = (page) =>
  [
    'Dashboard',
    'Reports',
    'Edit Products',
    'Users',
    'Business Settings',
    'Conflict Inbox',
    'Sale Adjustments',
    'Material Waste',
    'Payees',
    'Accounts',
  ].includes(page)
    ? 2
    : 1;
export const defaultPageAccess = () =>
  Object.fromEntries(
    [1, 2, 3, 4].map((rank) => [
      String(rank),
      pages.filter((page) =>
        rank >= 2
          ? page !== 'Business Settings'
          : [
              'Point of Service',
              'Quotations',
              'Pricing Templates',
              'My Sales',
              'Print Settings',
              'My Account',
            ].includes(page),
      ),
    ]),
  );
/** Settings saved before every page was set separately: give each new page its old page's access. */
export function upgradePageAccess(input, fromVersion = 0) {
  if (!input || typeof input !== 'object') return input;
  const value = structuredClone(input);
  for (const rank of ['1', '2', '3', '4'])
    if (Array.isArray(value[rank]))
      for (const [page, parent] of Object.entries(
        fromVersion >= 2 ? { Payees: 'Expenses', Accounts: 'Expenses' } : formerParents,
      ))
        if (
          value[rank].includes(parent) &&
          !value[rank].includes(page) &&
          minimumPageAccess(page) <= Number(rank)
        )
          value[rank].push(page);
  return value;
}
export function validatePageAccess(input) {
  const value = input === undefined ? defaultPageAccess() : structuredClone(input);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['1', '2', '3', '4'].includes(key))
  )
    throw Error('Invalid page access settings.');
  value['3'] ??= defaultPageAccess()['3'];
  // The General Manager opens the Manager's pages until Developer sets their own.
  value['4'] ??= structuredClone(value['3']);
  for (const rank of [1, 2, 3, 4]) {
    const allowed = value[String(rank)];
    if (
      !Array.isArray(allowed) ||
      new Set(allowed).size !== allowed.length ||
      allowed.some((page) => !pages.includes(page) || minimumPageAccess(page) > rank) ||
      !allowed.includes('My Account')
    )
      throw Error(
        'Invalid page access settings. My Account must remain available and restricted pages require their minimum rank.',
      );
  }
  return value;
}
export function canAccessPage(page, access, configured) {
  if (
    !pages.includes(page) ||
    !Number.isInteger(access) ||
    access < 1 ||
    access > 5 ||
    access < minimumPageAccess(page)
  )
    return false;
  if (access === 5 || page === 'My Account') return true;
  // The General Manager has the Manager's pages until Developer sets their own.
  const own = configured?.[String(access)] ?? (access === 4 ? configured?.['3'] : undefined);
  return (own ?? defaultPageAccess()[String(access)]).includes(page) ?? false;
}

export const SETTINGS_TABS_VERSION = 3;
export function upgradeSettingsTabs(input, version = 0) {
  if (version >= SETTINGS_TABS_VERSION || !input) return input;
  const next = structuredClone(input);
  for (const rank of ['2', '3', '4']) {
    const tabs = next[rank];
    if (!Array.isArray(tabs)) continue;
    if (version < 1 && tabs.includes('Dropdowns & workflow') && !tabs.includes('Payment methods'))
      tabs.push('Payment methods');
    if (version < 2 && tabs.includes('Jobs & payments'))
      for (const tab of ['Default time frames', 'Words']) if (!tabs.includes(tab)) tabs.push(tab);
  }
  for(const rank of ['2','3'])if(Array.isArray(next[rank]))next[rank]=next[rank].filter(t=>t!=='Payment methods');
  return next;
}
