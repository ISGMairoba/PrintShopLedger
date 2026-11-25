// Money in and out that is not a sale or an expense: loans (and their repayment), the owner putting
// money in or taking it out, and other income such as gifts and grants. Each moves an account's
// balance. Loans are owed to a lender (a saved payee) until repaid; only other income counts as
// income in reports. Interest on a loan is an expense: record it on the Expenses page.

export const MONEY_TYPES = {
  loan_in: { label: 'Loan received', direction: 1, lender: true },
  loan_repayment: { label: 'Loan repayment', direction: -1, lender: true },
  owner_in: { label: 'Owner puts money in', direction: 1, lender: false },
  owner_out: { label: 'Owner takes money out', direction: -1, lender: false },
  other_income: { label: 'Gift, grant or other income', direction: 1, lender: false },
  // An advance paid to a payee (e.g. a supplier), and money a payee gives back from it. Recorded from
  // the Payees page; expenses for that payee can then be paid from the advance (source "Payee advance").
  payee_advance: { label: 'Advance paid to a payee', direction: -1, lender: false, payee: true },
  advance_returned: { label: 'Advance returned by a payee', direction: 1, lender: false, payee: true },
};

/** The expense payment source for money taken from a payee's advance (no account moves). */
export const ADVANCE_SOURCE = 'Payee advance';

/** Money moves (account entries with action "money"), optionally within [from, to] days. */
export const moneyMoves = (ledger, from = '', to = '9999-12-31') =>
  (ledger.accountEntries ?? []).filter((e) => e.action === 'money' && e.paidOn >= from && e.paidOn <= to);

/** What is still owed to each lender: { lenderId: kobo }, lenders with nothing owed left out. */
export function lenderBalances(ledger) {
  /** @type {Record<string, number>} */
  const owed = {};
  for (const e of moneyMoves(ledger)) {
    if (!e.lenderId) continue;
    owed[e.lenderId] = (owed[e.lenderId] ?? 0) + (e.moneyType === 'loan_in' ? e.amount : -e.amount);
  }
  for (const [id, n] of Object.entries(owed)) if (n === 0) delete owed[id];
  return owed;
}

/** Totals by type for a period: { loan_in, loan_repayment, owner_in, owner_out, other_income }. */
export function moneyMoveTotals(ledger, from, to) {
  const totals = Object.fromEntries(Object.keys(MONEY_TYPES).map((k) => [k, 0]));
  for (const e of moneyMoves(ledger, from, to)) totals[e.moneyType] += e.amount;
  return totals;
}

/**
 * The advance held with each payee: advances paid, less money given back and expense payments taken
 * from it. { payeeId: kobo }, payees with nothing held left out. The server keeps the same figure
 * (private.payee_advance).
 */
export function payeeAdvances(ledger) {
  /** @type {Record<string, number>} */
  const held = {};
  for (const e of moneyMoves(ledger)) {
    if (!e.payeeId) continue;
    held[e.payeeId] = (held[e.payeeId] ?? 0) + (e.moneyType === 'payee_advance' ? e.amount : -e.amount);
  }
  for (const x of ledger.expenses ?? [])
    for (const p of x.payments ?? [])
      if (p.source === ADVANCE_SOURCE && x.payeeId) held[x.payeeId] = (held[x.payeeId] ?? 0) - p.amount;
  for (const [id, n] of Object.entries(held)) if (n === 0) delete held[id];
  return held;
}
