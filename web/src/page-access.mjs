export const pages = ['Point of Service', 'My Sales', 'Jobs', 'Customers', 'Payments', 'Expenses', 'Materials', 'Services', 'Stock History', 'Print Settings', 'Users', 'My Account', 'Business Settings', 'Conflict Inbox', 'Sale Adjustments', 'Material Waste'];
export function canAccessPage(page, access) {
 if (!pages.includes(page) || access < 1) return false;
 if (page === 'Business Settings') return access >= 3;
 return access >= 2 || ['Point of Service', 'My Sales', 'Print Settings', 'My Account'].includes(page);
}
