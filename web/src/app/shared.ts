/** Types and small formatting helpers shared by the app shell and its pages. */
export type Shop = {
  id: string;
  name: string;
  userId: string;
  role: string;
  rank: number;
  accessLevel: number;
  username: string;
  staffName: string;
};
export type Page =
  | 'Dashboard'
  | 'Reports'
  | 'Sale Adjustments'
  | 'Material Waste'
  | 'My Sales'
  | 'Point of Service'
  | 'Quotations'
  | 'Payment Reminders'
  | 'Jobs'
  | 'Customers'
  | 'Payments'
  | 'Materials'
  | 'Stock History'
  | 'Services'
  | 'Print Settings'
  | 'Users'
  | 'Payees'
  | 'Accounts'
  | 'Expenses'
  | 'My Account'
  | 'Business Settings'
  | 'Pricing Templates'
  | 'Edit Products'
  | 'Conflict Inbox';
// Formatters are made once: making one for every amount or date shown is slow on long lists.
const naira = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });
export const currency = (amount: number) => naira.format(amount / 100);
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
const shortDate = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Africa/Lagos',
});
export const dateLabel = (value: string) => shortDate.format(new Date(value));
export const errorMessage = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Something went wrong.';
