import type { IconName } from '../Icon';
import type { Page } from './shared';

/** The icon shown next to each page in the main navigation. */
export const pageIcons: Record<Page, IconName> = {
  Dashboard: 'table',
  Reports: 'audit',
  'Point of Service': 'services',
  Quotations: 'quote',
  'Payment Reminders': 'payments',
  'My Sales': 'drawer',
  Jobs: 'jobs',
  Customers: 'customers',
  Payments: 'payments',
  Expenses: 'expenses',
  Materials: 'materials',
  Services: 'services',
  'Stock History': 'history',
  'Print Settings': 'quantity',
  Users: 'customers',
  'My Account': 'customers',
  'Business Settings': 'quantity',
  'Pricing Templates': 'quote',
  'Conflict Inbox': 'history',
  'Sale Adjustments': 'history',
  'Material Waste': 'materials',
};

const workAndPayments = 'Track work and keep every payment attached to its job.';

/** The one-line description under each page title. */
export const pageDescriptions: Record<Page, string> = {
  Dashboard: 'Sales, collections, expenses and current business position.',
  Reports: 'Customer statements, transaction records and summaries, with spreadsheet and PDF export.',
  'Sale Adjustments': 'Approve and review changes to sales and customer credit.',
  'Material Waste': 'Track extra material use, damage and reprints.',
  'Business Settings': '',
  'Pricing Templates': 'Build and manage reusable prices from existing items and services.',
  'Conflict Inbox': 'Review pending work from connected staff devices.',
  'My Account': 'Manage your username and password.',
  Expenses: 'Record expenses, payments and material purchases.',
  'My Sales': 'Review your transactions and record a verified drawer handover.',
  Users: 'Manage staff accounts, ranks and business access.',
  'Print Settings': 'Set default printer, paper, font and margins for this device.',
  Customers: 'Manage customer details and credit limits.',
  Materials: 'Manage materials, quantities and pricing requirements.',
  'Stock History': 'Review every material change and stock adjustment.',
  Services: 'Define services, their base materials and prices.',
  'Point of Service': workAndPayments,
  Quotations: 'Price work for customers, send quotations and turn accepted ones into jobs.',
  'Payment Reminders': 'See who owes money, oldest first, and send a friendly reminder with their statement.',
  Jobs: workAndPayments,
  Payments: workAndPayments,
};
