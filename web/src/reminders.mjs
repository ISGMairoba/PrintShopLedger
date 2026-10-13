// Payment reminders: who owes money, how long it has been owed, and when they were last reminded.
// A reminder is a record only; it never changes balances.
import { jobBalance } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
import { currency } from './receipts.mjs';

const lagosDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);

/**
 * Customers who owe money: the amount, the oldest unpaid day and its age, the number of unpaid
 * jobs and the last reminder. Oldest debts first, then the largest.
 * @param {import('./types').Ledger} ledger
 */
export function owingCustomers(ledger, now = new Date().toISOString()) {
  const today = lagosDay(now);
  const rows = new Map();
  for (const job of ledger.jobs) {
    if (job.productionStatus === 'Cancelled') continue;
    const owed = jobBalance(ledger, job).outstanding;
    if (owed <= 0) continue;
    const day = lagosDay(job.createdAt);
    const row = rows.get(job.customerId) ?? { customerId: job.customerId, owed: 0, jobs: 0, oldest: day };
    row.owed += owed;
    row.jobs += 1;
    if (day < row.oldest) row.oldest = day;
    rows.set(job.customerId, row);
  }
  const reminders = ledger.reminders ?? [];
  return [...rows.values()]
    .map((row) => {
      const customer = ledger.customers.find((c) => c.id === row.customerId);
      const last = reminders
        .filter((r) => r.customerId === row.customerId)
        .sort((a, b) => b.remindedAt.localeCompare(a.remindedAt))[0];
      return {
        ...row,
        name: customer?.name ?? 'Unknown customer',
        phone: customer?.phone ?? '',
        archived: !!customer?.archived,
        age: Math.max(0, daysBetween(row.oldest, today)),
        lastReminder: last ?? null,
      };
    })
    .sort((a, b) => a.oldest.localeCompare(b.oldest) || b.owed - a.owed || a.name.localeCompare(b.name));
}

const first = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] || 'there';
const longDate = (day) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** A polite reminder message for WhatsApp. */
export function reminderMessage(row, business) {
  return `Hello ${first(row.name)}, this is a friendly reminder${business ? ` from ${business}` : ''} that ${currency(row.owed)} is outstanding on your account (the oldest from ${longDate(row.oldest)}). Your statement is attached. Thank you.`;
}

/** The customer.reminded event. channel: 'whatsapp' (shared) or 'download'. */
export const reminderEvent = (row, channel, actor, now = new Date().toISOString()) => ({
  id: crypto.randomUUID(),
  kind: 'customer.reminded',
  data: {
    id: crypto.randomUUID(),
    customerId: row.customerId,
    amountOwed: row.owed,
    channel,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
  },
});

/** Apply a reminder to the local ledger (mirrors the server). */
export function applyReminderEvent(input, event) {
  const ledger = normalizeLedger(input);
  const d = event.data;
  if (event.kind !== 'customer.reminded' || !event.id || !d?.id || !d.customerId)
    throw Error('Invalid reminder.');
  if (ledger.reminders.some((r) => r.id === d.id)) return ledger;
  if (!ledger.customers.some((c) => c.id === d.customerId)) throw Error('Customer not found.');
  return {
    ...ledger,
    reminders: [
      ...ledger.reminders,
      {
        id: d.id,
        customerId: d.customerId,
        amountOwed: d.amountOwed,
        channel: d.channel,
        remindedBy: d.modifiedBy,
        remindedByLabel: d.modifiedByLabel,
        remindedAt: d.modifiedAt,
        lastEventId: event.id,
      },
    ],
  };
}
