// Repeating expenses (rent, salaries, internet…): a reminder, never an automatic expense. When one
// is due it waits in "Due to record" until an Admin records it (checking the amount, since prices
// change) or skips it; either moves it to its next date. Monthly and yearly ones keep their day of
// the month (31st → 30 Apr, 28/29 Feb). The server applies the same rules (apply_operations_event).

export const EVERY = { week: 'Every week', month: 'Every month', year: 'Every year' };

const text = (v, max, label, required = true) => {
  if (
    typeof v !== 'string' ||
    v.trim().length > max ||
    (required && !v.trim()) ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
  )
    throw Error(`${label}: up to ${max} characters${required ? ', required' : ''}.`);
  return v.trim();
};
const isDay = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The date after `on` for this repeat; monthly and yearly keep `anchor` (day of the month). */
export function nextDate(on, every, anchor = Number(on.slice(8, 10))) {
  const d = new Date(`${on}T00:00:00Z`);
  if (every === 'week') return new Date(d.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const months = every === 'year' ? 12 : 1;
  const y = d.getUTCFullYear(),
    m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(anchor, last))).toISOString().slice(0, 10);
}

/** Active repeats due on or before `today`, oldest first. */
/**
 * The id the expense for one due date of a repeating expense always gets: the same on every
 * device, so if two devices record the same rent the business refuses the second one
 * ("Expense ID already exists") instead of keeping two.
 * @returns {Promise<string>}
 */
export async function repeatExpenseId(repeatId, dueOn) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`repeat-expense:${repeatId}:${dueOn}`)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80; // UUID version 8 (custom)
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const dueRepeats = (ledger, today) =>
  (ledger.repeatingExpenses ?? [])
    .filter((r) => r.status === 'active' && r.nextDue <= today)
    .sort((a, b) => a.nextDue.localeCompare(b.nextDue) || a.description.localeCompare(b.description));

/** Apply repeat.created / repeat.updated / repeat.done to the ledger. */
export function applyRepeat(ledger, event, audit) {
  const d = event.data,
    kind = event.kind;
  const rows = ledger.repeatingExpenses ?? [];
  const old = rows.find((r) => r.id === d.id);
  let after;
  if (kind === 'repeat.created' || kind === 'repeat.updated') {
    if (kind === 'repeat.created' ? old : !old || (old.version ?? 1) !== d.baseVersion)
      throw Error(
        old ? 'This repeating expense changed elsewhere. Reopen it.' : 'Repeating expense not found.',
      );
    const every = d.every ?? old?.every;
    if (!EVERY[every]) throw Error('Choose how often it repeats.');
    const nextDue = d.nextDue ?? old?.nextDue;
    if (!isDay(nextDue)) throw Error('Choose the next date.');
    const status = d.status ?? old?.status ?? 'active';
    if (!['active', 'paused', 'stopped'].includes(status)) throw Error('Choose active, paused or stopped.');
    const amount = d.amount ?? old?.amount ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000000)
      throw Error('Enter a valid amount.');
    after = {
      ...(old ?? {}),
      id: d.id,
      description: text(d.description ?? old?.description, 200, 'Description'),
      category: text(d.category ?? old?.category, 80, 'Category'),
      payeeId: d.payeeId ?? old?.payeeId ?? '',
      payee: text(d.payee ?? old?.payee ?? '', 160, 'Payee', false),
      note: text(d.note ?? old?.note ?? '', 1000, 'Note', false),
      amount,
      every,
      nextDue,
      anchor:
        d.nextDue && d.nextDue !== old?.nextDue
          ? Number(nextDue.slice(8, 10))
          : (old?.anchor ?? Number(nextDue.slice(8, 10))),
      status,
      history: old?.history ?? [],
      version: (old?.version ?? 0) + 1,
      createdBy: old?.createdBy ?? audit.modifiedBy,
      createdByLabel: old?.createdByLabel ?? audit.modifiedByLabel,
      createdAt: old?.createdAt ?? audit.modifiedAt,
      ...audit,
    };
  } else if (kind === 'repeat.done') {
    if (!old || (old.version ?? 1) !== d.baseVersion)
      throw Error('This repeating expense changed elsewhere. Reopen it.');
    if (old.status !== 'active' || d.dueOn !== old.nextDue)
      throw Error('This one has already been recorded or skipped.');
    if (!['recorded', 'skipped'].includes(d.action)) throw Error('Record or skip it.');
    if (d.action === 'recorded' && !(ledger.expenses ?? []).some((e) => e.id === d.expenseId))
      throw Error('Save the expense first.');
    const amount =
      d.action === 'recorded'
        ? (ledger.expenses.find((e) => e.id === d.expenseId)?.amount ?? old.amount)
        : old.amount;
    after = {
      ...old,
      amount,
      nextDue: nextDate(old.nextDue, old.every, old.anchor),
      history: [
        ...(old.history ?? []),
        {
          dueOn: old.nextDue,
          action: d.action,
          ...(d.action === 'recorded' ? { expenseId: d.expenseId } : {}),
          by: audit.modifiedBy,
          byLabel: audit.modifiedByLabel,
          at: audit.modifiedAt,
        },
      ].slice(-60),
      version: (old.version ?? 1) + 1,
      ...audit,
    };
  } else throw Error('Unknown operation.');
  return {
    before: old ?? null,
    after,
    repeatingExpenses: old ? rows.map((r) => (r.id === old.id ? after : r)) : [...rows, after],
  };
}
