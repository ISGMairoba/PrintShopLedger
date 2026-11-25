// Paying commission out (Team work, PR D; plans/job-assignment.md). A person's commission balance is
// what their confirmed work earned, all time (team-report.mjs), less what was paid and deducted.
// Paying more than is owed is an advance: the balance goes below zero and later commission pays it
// back. A correction of work already paid changes what was earned, so it shows as a plus or minus
// on the next payout. The server keeps the same records (private.team_payout).
import { makeExpenseEvent } from './expenses.mjs';
import { saleDay } from './my-sales.mjs';
import { teamReport } from './team-report.mjs';
import { personName } from './team.mjs';

/** { earned, paid, deducted, balance } in kobo for one person (null earned: no terms). */
export function commissionBalance(ledger, personId) {
  const row = teamReport(ledger, '0000-01-01', '9999-12-31').rows.find((p) => p.personId === personId);
  const earned = row?.commission ?? 0;
  const mine = (ledger.teamPayouts ?? []).filter((p) => p.personId === personId);
  const paid = mine.filter((p) => p.kind === 'payout').reduce((sum, p) => sum + p.amount, 0);
  const deducted = mine.filter((p) => p.kind === 'deduction').reduce((sum, p) => sum + p.amount, 0);
  return { earned, paid, deducted, balance: earned - paid - deducted };
}

/**
 * The events for paying a person (an expense paid from the chosen account, then the payout that
 * names it) or for a deduction (no money moves).
 * @param {{ kind: 'payout' | 'deduction', amount: number, paidFrom?: { kind: string, label: string, source?: string, accountId?: string } | null, note?: string }} input
 */
export function payoutEvents(ledger, personId, input, actor, now = new Date().toISOString()) {
  if (!(input.amount > 0) || !Number.isSafeInteger(input.amount)) throw Error('Enter an amount greater than zero.');
  const note = String(input.note ?? '').trim();
  if (note.length > 200) throw Error('Keep the note to 200 characters.');
  const paidOn = saleDay(now);
  const balanceBefore = commissionBalance(ledger, personId).balance;
  const events = [];
  let expenseId;
  if (input.kind === 'payout') {
    const pf = input.paidFrom;
    if (!pf) throw Error('Choose where the money is paid from.');
    expenseId = crypto.randomUUID();
    const name = personName(ledger, personId);
    events.push(
      makeExpenseEvent(
        'expense.created',
        {
          id: expenseId,
          description: `Commission: ${name}${input.amount > Math.max(0, balanceBefore) ? ' (includes an advance)' : ''}`.slice(0, 200),
          category: 'Commission',
          incurredOn: paidOn,
          incurredAt: now,
          amount: input.amount,
          payeeId: null,
          payee: name,
          note,
          receiptReference: '',
          jobIds: [],
          restockIds: [],
          covers: null,
          materials: [],
          payment: {
            id: crypto.randomUUID(),
            amount: input.amount,
            paidOn,
            paidAt: now,
            method: pf.kind,
            methodLabel: pf.label,
            source: pf.source,
            reference: '',
            ...(pf.accountId ? { accountId: pf.accountId } : {}),
          },
        },
        null,
        actor,
      ),
    );
  } else if (input.kind !== 'deduction') throw Error('Invalid commission payment.');
  events.push({
    id: crypto.randomUUID(),
    kind: 'team.payout_recorded',
    data: {
      id: crypto.randomUUID(),
      personId,
      kind: input.kind,
      amount: input.amount,
      paidOn,
      note,
      balanceBefore,
      ...(expenseId ? { expenseId } : {}),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  });
  return events;
}
