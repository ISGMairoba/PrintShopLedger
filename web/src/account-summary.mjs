// Accounts page summary: what the business holds now and what moved this month. Transfers between
// accounts move money without adding or removing any, so they are left out of money in and out.
import { accountBalance, moneyTransactions } from './operations.mjs';

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
    moneyIn,
    moneyOut,
    unassignedCount,
    unassignedNet,
    lastReconciled,
    differenceMonth,
    neverReconciled: accounts.filter((a) => !reconciliations.some((e) => e.accountId === a.id)).length,
  };
}
