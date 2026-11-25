// Paying a payee once for several expenses (owner, 25 Nov): one amount, spread over the payee's unpaid
// expenses oldest first (each share can be changed). What is left over becomes an advance held with
// the payee (Business Settings → Jobs & payments → Payees: automatically by default, or only when
// asked). The pieces are ordinary records: one expense payment per expense, all with the same
// reference, and the advance as money paid out of the account (money-moves.mjs, "payee_advance").
import { expensePaid, makeExpenseEvent } from './expenses.mjs';
import { operationEvent } from './operations.mjs';
import { payeeAdvances } from './money-moves.mjs';

const when = (e) => e.incurredAt ?? `${e.incurredOn}T00:00:00Z`;

/** The payee's expenses still owing, oldest first, with what each still owes. */
export function unpaidExpenses(ledger, payeeId) {
  return (ledger.expenses ?? [])
    .filter((e) => e.payeeId === payeeId && !e.voided && e.amount > expensePaid(e))
    .sort((a, b) => when(a).localeCompare(when(b)) || a.id.localeCompare(b.id))
    .map((e) => ({ expense: e, owed: e.amount - expensePaid(e) }));
}

/** An amount spread oldest first: { [expenseId]: kobo } and what is left over. */
export function spreadPayment(ledger, payeeId, amount) {
  let left = Math.max(0, amount);
  /** @type {Record<string, number>} */
  const shares = {};
  for (const { expense, owed } of unpaidExpenses(ledger, payeeId)) {
    const share = Math.min(owed, left);
    if (share > 0) shares[expense.id] = share;
    left -= share;
  }
  return { shares, rest: left };
}

/** A short reference shared by every piece of one payee payment. */
export const payeePaymentReference = (id) => `Payee payment PP-${id.slice(0, 6).toUpperCase()}`;

/**
 * The records for one payee payment. pay: { payeeId, amount, shares: {expenseId: kobo}, paidOn,
 * paidAt, method, methodLabel, accountId, source, reference, keepRest }. Returns { expenseEvents,
 * advanceEvent } (advanceEvent null when nothing is left over).
 */
export function payeePaymentEvents(ledger, pay, actor, now = new Date().toISOString()) {
  const payee = (ledger.payees ?? []).find((p) => p.id === pay.payeeId);
  if (!payee) throw Error('Choose the payee.');
  if (!Number.isSafeInteger(pay.amount) || pay.amount <= 0) throw Error('Enter an amount greater than zero.');
  const owing = new Map(unpaidExpenses(ledger, payee.id).map((u) => [u.expense.id, u]));
  let used = 0;
  const expenseEvents = [];
  const id = crypto.randomUUID();
  const reference = (pay.reference ?? '').trim() || payeePaymentReference(id);
  for (const [expenseId, share] of Object.entries(pay.shares ?? {})) {
    if (!share) continue;
    const u = owing.get(expenseId);
    if (!u) throw Error('An expense in this payment is no longer owing. Reopen the payment.');
    if (!Number.isSafeInteger(share) || share < 0 || share > u.owed)
      throw Error(`Pay at most what is owed on ${u.expense.description}.`);
    used += share;
    expenseEvents.push(
      makeExpenseEvent(
        'expense.payment_recorded',
        {
          payment: {
            id: crypto.randomUUID(),
            accountId: pay.accountId || undefined,
            amount: share,
            paidOn: pay.paidOn,
            paidAt: pay.paidAt,
            method: pay.method,
            methodLabel: pay.methodLabel,
            source: pay.source,
            reference,
          },
        },
        u.expense,
        actor,
      ),
    );
  }
  if (used > pay.amount) throw Error('The shares add up to more than the amount paid.');
  const rest = pay.amount - used;
  let advanceEvent = null;
  if (rest > 0) {
    if (!pay.keepRest) throw Error('Pay only what is owed, or keep the rest as an advance with this payee.');
    if (!pay.accountId) throw Error('Choose the account the advance is paid from.');
    advanceEvent = operationEvent(
      'account.money_moved',
      {
        id: crypto.randomUUID(),
        accountId: pay.accountId,
        paidOn: pay.paidOn,
        reason: `Advance to ${payee.name} · ${reference}`,
        moneyType: 'payee_advance',
        amount: rest,
        payeeId: payee.id,
      },
      actor,
      now,
    );
  }
  if (!expenseEvents.length && !advanceEvent) throw Error('Enter an amount greater than zero.');
  return { expenseEvents, advanceEvent, rest, reference };
}

/** The advance held with a payee (kobo). */
export const advanceHeld = (ledger, payeeId) => payeeAdvances(ledger)[payeeId] ?? 0;
