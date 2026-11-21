// One money account's movements as a statement: every payment received, expense paid, refund,
// loan, owner money, transfer, reconciliation and carried-forward record in one list, each tagged
// with its type, in date order with the running balance. The balance follows accountBalance
// (operations.mjs) exactly; movements dated before the account's opening date are listed but don't
// move the balance (the opening balance already covers them).
import { businessDay } from './dashboard.mjs';
import { MONEY_TYPES } from './money-moves.mjs';
import { moneyTransactions } from './operations.mjs';

/** The tags, with the words shown on each line. */
export const STATEMENT_TYPES = {
  sale: 'Sale',
  expense: 'Expense',
  refund: 'Refund',
  loan: 'Loan',
  repayment: 'Loan repayment',
  owner: 'Owner',
  income: 'Other income',
  transfer: 'Transfer',
  reconcile: 'Reconcile',
  carried: 'Carried forward',
};

const moneyTag = (moneyType) =>
  moneyType === 'loan_in'
    ? 'loan'
    : moneyType === 'loan_repayment'
      ? 'repayment'
      : moneyType === 'other_income'
        ? 'income'
        : 'owner';

/**
 * @param {any} ledger
 * @param {string} accountId
 * @param {{ from?: string, to?: string, accountName?: (id: string) => string, payeeName?: (id: string) => string }} [options]
 *   from / to: business days (YYYY-MM-DD), both included.
 */
export function accountStatement(ledger, accountId, options = {}) {
  const account = (ledger.moneyAccounts ?? []).find((a) => a.id === accountId);
  if (!account) throw Error('Account not found.');
  const to = options.to || businessDay(new Date().toISOString());
  const from = options.from || '';
  const name = options.accountName ?? (() => 'another account');
  const payee = options.payeeName ?? (() => '');
  /** @type {any[]} */
  const all = [];
  for (const t of moneyTransactions(ledger).filter((t) => t.accountId === accountId)) {
    all.push({
      id: t.id,
      paidOn: t.paidOn,
      order: 1,
      type: t.id.startsWith('payment:') ? 'sale' : t.id.startsWith('refund:') ? 'refund' : 'expense',
      label: t.label,
      method: t.method,
      amountIn: t.direction > 0 ? t.amount : 0,
      amountOut: t.direction < 0 ? t.amount : 0,
      change: t.direction * t.amount,
      entry: null,
    });
  }
  for (const e of ledger.accountEntries ?? []) {
    if (e.accountId !== accountId && e.toAccountId !== accountId) continue;
    const base = { id: 'entry:' + e.id, paidOn: e.paidOn, order: 1, method: '', entry: e };
    if (e.action === 'transfer') {
      const out = e.accountId === accountId;
      all.push({
        ...base,
        type: 'transfer',
        label: out ? `Transfer to ${name(e.toAccountId)}` : `Transfer from ${name(e.accountId)}`,
        amountIn: out ? 0 : e.amount,
        amountOut: out ? e.amount : 0,
        change: out ? -e.amount : e.amount,
      });
    } else if (e.action === 'money' && e.accountId === accountId) {
      const lender = e.lenderId ? payee(e.lenderId) : '';
      const label = MONEY_TYPES[e.moneyType]?.label ?? 'Money';
      all.push({
        ...base,
        type: moneyTag(e.moneyType),
        label: lender ? `${label} · ${lender}` : label,
        amountIn: e.direction > 0 ? e.amount : 0,
        amountOut: e.direction < 0 ? e.amount : 0,
        change: e.direction * e.amount,
      });
    } else if (e.action === 'reconciliation' && e.accountId === accountId) {
      // Last in its day: the difference brings the balance to what was counted that day.
      all.push({
        ...base,
        order: 2,
        type: 'reconcile',
        label: e.amount === 0 ? 'Reconciled · no difference' : 'Reconcile difference',
        amountIn: e.amount > 0 ? e.amount : 0,
        amountOut: e.amount < 0 ? -e.amount : 0,
        change: e.amount,
      });
    } else if (e.action === 'carried' && e.accountId === accountId) {
      all.push({
        ...base,
        order: 0,
        type: 'carried',
        label: 'Older records, carried forward',
        amountIn: e.received ?? 0,
        amountOut: e.paid ?? 0,
        change: e.amount,
      });
    }
  }
  all.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.order - b.order || a.id.localeCompare(b.id));
  let balance = account.openingBalance;
  let opening = account.openingBalance;
  const rows = [];
  let received = 0,
    paid = 0;
  for (const row of all) {
    if (row.paidOn > to) break;
    const counts = row.paidOn >= account.openingDate;
    if (counts) balance += row.change;
    if (from && row.paidOn < from) {
      opening = balance;
      continue;
    }
    if (counts) {
      received += row.amountIn;
      paid += row.amountOut;
    }
    rows.push({ ...row, balance, beforeOpening: !counts });
  }
  return { opening, closing: balance, received, paid, rows };
}

/**
 * Rows a person asked for: type ('' all), direction ('in' / 'out' / ''), words in the label, method or
 * note, then sorted ('date', 'date-desc', 'amount', 'amount-desc').
 * @param {any[]} rows
 * @param {{ type?: string, direction?: string, search?: string, sort?: string }} f
 */
export function filterStatement(rows, f = {}) {
  const words = (f.search ?? '').trim().toLowerCase();
  const kept = rows.filter(
    (r) =>
      (!f.type || r.type === f.type) &&
      (f.direction !== 'in' || r.amountIn > 0) &&
      (f.direction !== 'out' || r.amountOut > 0) &&
      (!words ||
        `${r.label} ${r.method} ${r.entry?.reason ?? ''} ${STATEMENT_TYPES[r.type]}`
          .toLowerCase()
          .includes(words)),
  );
  const size = (r) => r.amountIn + r.amountOut;
  if (f.sort === 'date-desc') return [...kept].reverse();
  if (f.sort === 'amount') return [...kept].sort((a, b) => size(a) - size(b));
  if (f.sort === 'amount-desc') return [...kept].sort((a, b) => size(b) - size(a));
  return kept;
}

/**
 * The statement as report sections (PDF and spreadsheet), with amounts as `money` shows them.
 * @param {any[]} rows
 * @param {(n: number) => string} money
 */
export function accountStatementSections(rows, money) {
  return [
    {
      title: 'Transactions',
      columns: ['Date', 'Type', 'Details', 'Method', 'In', 'Out', 'Balance'],
      widths: [1.1, 1.1, 3, 1.2, 1.1, 1.1, 1.2],
      numeric: [4, 5, 6],
      rows: rows.map((r) => [
        r.paidOn,
        STATEMENT_TYPES[r.type],
        [r.label, r.entry?.reason, r.beforeOpening ? 'before the opening date' : '']
          .filter(Boolean)
          .join(' · '),
        r.method,
        r.amountIn ? money(r.amountIn) : '',
        r.amountOut ? money(r.amountOut) : '',
        r.beforeOpening ? '' : money(r.balance),
      ]),
    },
  ];
}
