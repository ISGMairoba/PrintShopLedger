export const pages = [
  'Dashboard',
  'Point of Service',
  'My Sales',
  'Jobs',
  'Customers',
  'Payments',
  'Expenses',
  'Materials',
  'Services',
  'Stock History',
  'Print Settings',
  'Users',
  'My Account',
  'Business Settings',
  'Conflict Inbox',
  'Sale Adjustments',
  'Material Waste',
];
// Pages shown in the menu. Derived pages are not configured separately: their access
// follows another page (Reports follows Dashboard), so saved settings need no change.
export const derivedPages = {
  Reports: 'Dashboard',
  Quotations: 'Point of Service',
  'Payment Reminders': 'Customers',
};
export const navigationPages = [
  'Dashboard',
  'Reports',
  'Point of Service',
  'Quotations',
  ...pages.slice(2).flatMap((page) => (page === 'Customers' ? [page, 'Payment Reminders'] : [page])),
];
export const roleNames = { 1: 'Cashier', 2: 'Admin', 3: 'Manager', 4: 'Developer' };
export const minimumPageAccess = (page) =>
  page === 'Business Settings'
    ? 4
    : ['Dashboard', 'Users', 'Conflict Inbox', 'Sale Adjustments', 'Material Waste'].includes(page)
      ? 2
      : 1;
export const defaultPageAccess = () =>
  Object.fromEntries(
    [1, 2, 3].map((rank) => [
      String(rank),
      pages.filter((page) =>
        rank >= 2
          ? page !== 'Business Settings'
          : ['Point of Service', 'My Sales', 'Print Settings', 'My Account'].includes(page),
      ),
    ]),
  );
export function validatePageAccess(input) {
  const value = input === undefined ? defaultPageAccess() : structuredClone(input);
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['1', '2', '3'].includes(key))
  )
    throw Error('Invalid page access settings.');
  value['3'] ??= defaultPageAccess()['3'];
  for (const rank of [1, 2, 3]) {
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
  if (Object.hasOwn(derivedPages, page)) return canAccessPage(derivedPages[page], access, configured);
  if (
    !pages.includes(page) ||
    !Number.isInteger(access) ||
    access < 1 ||
    access > 4 ||
    access < minimumPageAccess(page)
  )
    return false;
  if (access === 4 || page === 'My Account') return true;
  return (configured?.[String(access)] ?? defaultPageAccess()[String(access)]).includes(page) ?? false;
}
