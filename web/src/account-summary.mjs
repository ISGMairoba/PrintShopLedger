// Accounts page summary: what the business holds now and what moved this month. Transfers between
// accounts move money without adding or removing any, so they are left out of money in and out.
import { accountBalance, moneyTransactions } from './operations.mjs';
import { lenderBalances, moneyMoves } from './money-moves.mjs';

/**
 * @param {import('./types').Ledger} ledger
 * @param {import('./types').MoneyAccount[]} accounts the active accounts whose full balance this person sees
 * @param {string} today business day (YYYY-MM-DD)
 */
export function accountSummary(ledger, accounts, today) {
  const month = today.slice(0, 7);
  const ids = new Set(accounts.map((a) => a.id));
  let total = 0,
    cash = 0;
  for (const a of accounts) {
    const { balance } = accountBalance(ledger, a.id, today);
    total += balance;
    if (a.accountType === 'cash') cash += balance;
  }
  let moneyIn = 0,
    moneyOut = 0,
    unassignedCount = 0,
    unassignedNet = 0;
  for (const t of moneyTransactions(ledger)) {
    if (!t.accountId) {
      if (!t.personal) {
        unassignedCount++;
        unassignedNet += t.direction * t.amount;
      }
      continue;
    }
    if (!ids.has(t.accountId) || t.paidOn.slice(0, 7) !== month || t.paidOn > today) continue;
    if (t.direction > 0) moneyIn += t.amount;
    else moneyOut += t.amount;
  }
  // Money in and out from old records a device no longer keeps, carried forward by month.
  for (const e of ledger.accountEntries ?? [])
    if (e.action === 'carried' && ids.has(e.accountId) && e.paidOn.slice(0, 7) === month && e.paidOn <= today) {
      moneyIn += e.received;
      moneyOut += e.paid;
    }
  // Loans, owner money and other income (Money in / out).
  let otherIn = 0,
    otherOut = 0;
  for (const e of moneyMoves(ledger, `${month}-01`, today))
    if (ids.has(e.accountId)) {
      if (e.direction > 0) otherIn += e.amount;
      else otherOut += e.amount;
    }
  const owed = Object.values(lenderBalances(ledger));
  const reconciliations = (ledger.accountEntries ?? []).filter(
    (e) => e.action === 'reconciliation' && ids.has(e.accountId),
  );
  const lastReconciled = reconciliations.reduce((last, e) => (e.paidOn > last ? e.paidOn : last), '');
  const differenceMonth = reconciliations
    .filter((e) => e.paidOn.slice(0, 7) === month)
    .reduce((sum, e) => sum + e.amount, 0);
  return {
    total,
    cash,
    other: total - cash,
    accounts: accounts.length,
    moneyIn: moneyIn + otherIn,
    moneyOut: moneyOut + otherOut,
    otherIn,
    otherOut,
    owedToLenders: owed.reduce((n, x) => n + x, 0),
    lenders: owed.length,
    unassignedCount,
    unassignedNet,
    lastReconciled,
    differenceMonth,
    neverReconciled: accounts.filter((a) => !reconciliations.some((e) => e.accountId === a.id)).length,
  };
}
