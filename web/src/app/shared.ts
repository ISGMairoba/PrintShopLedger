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
  | 'Expenses'
  | 'My Account'
  | 'Business Settings'
  | 'Pricing Templates'
  | 'Conflict Inbox';
export const currency = (amount: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(amount / 100);
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
export const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
export const errorMessage = (error: unknown) =>
  error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : 'Something went wrong.';
