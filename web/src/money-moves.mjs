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
};

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
