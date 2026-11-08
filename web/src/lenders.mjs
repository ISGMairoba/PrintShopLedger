// Lenders: payees the business has borrowed from (Accounts → Money in / out → Loan received).
// What each is still owed, their loans and repayments, and an optional next repayment date
// (kept on the payee) that brings a reminder when it is near.
import { moneyMoves } from './money-moves.mjs';

/** Ids of payees that have lent money. */
export const lenderIds = (ledger) =>
  new Set(
    moneyMoves(ledger)
      .filter((e) => e.lenderId)
      .map((e) => e.lenderId),
  );

/** One lender's loans: borrowed, repaid, still owed, and each entry (optionally within a period). */
export function lenderSummary(ledger, payeeId, from = '', to = '9999-12-31') {
  const all = moneyMoves(ledger).filter((e) => e.lenderId === payeeId);
  const sum = (list, type) => list.filter((e) => e.moneyType === type).reduce((n, e) => n + e.amount, 0);
  const inPeriod = all.filter((e) => e.paidOn >= from && e.paidOn <= to);
  return {
    borrowed: sum(all, 'loan_in'),
    repaid: sum(all, 'loan_repayment'),
    owed: sum(all, 'loan_in') - sum(all, 'loan_repayment'),
    borrowedInPeriod: sum(inPeriod, 'loan_in'),
    repaidInPeriod: sum(inPeriod, 'loan_repayment'),
    entries: inPeriod
      .filter((e) => e.amount > 0)
      .sort((a, b) => a.paidOn.localeCompare(b.paidOn))
      .map((e) => ({
        id: e.id,
        date: e.paidOn,
        kind: e.moneyType === 'loan_in' ? 'Borrowed' : 'Repaid',
        amount: e.amount,
        note: e.reason,
        accountId: e.accountId,
      })),
  };
}

/**
 * Lenders still owed whose next repayment is due within `days` (or overdue), soonest first.
 * @returns {{ id: string, name: string, due: string, owed: number, overdue: boolean }[]}
 */
export function repaymentsDue(ledger, today, days = 3) {
  const limit = new Date(Date.parse(`${today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  return (ledger.payees ?? [])
    .filter((p) => p.repaymentDue && p.repaymentDue <= limit && lenderSummary(ledger, p.id).owed > 0)
    .sort((a, b) => a.repaymentDue.localeCompare(b.repaymentDue))
    .map((p) => ({
      id: p.id,
      name: p.name,
      due: p.repaymentDue,
      owed: lenderSummary(ledger, p.id).owed,
      overdue: p.repaymentDue < today,
    }));
}
