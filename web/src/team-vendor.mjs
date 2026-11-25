// An outside vendor in Team work (owner, 25 Nov): the vendor did a stage, or part of one. Its cost is
// an expense for the job (so it counts in the job's actual profit, with the job's other expenses and
// the stock it used), paid now or owed to the vendor, who is one of the Payees (added when new).
import { makeExpenseEvent } from './expenses.mjs';
import { operationEvent } from './operations.mjs';
import { stagesFinished } from './team.mjs';
import { saleDay } from './my-sales.mjs';


/**
 * The events for a stage move's vendor, and the work with the vendor's payee and expense ids, or
 * null when there is no vendor cost to record (work.vendorExpense is set by the move dialog only for
 * people who can record expenses).
 */
export function vendorExpenseEvents(ledger, job, target, work, actor, now = new Date().toISOString()) {
  const { vendorExpense, ...rest } = work;
  if (!rest.vendor || !vendorExpense || !(rest.vendor.cost > 0)) return { events: [], work: rest };
  const events = [];
  let payeeId = vendorExpense.payeeId;
  if (!payeeId) {
    payeeId = crypto.randomUUID();
    events.push(
      operationEvent(
        'payee.created',
        { id: payeeId, name: rest.vendor.name, phone: '', address: '', note: 'Outside vendor' },
        actor,
        now,
      ),
    );
  }
  const expenseId = crypto.randomUUID();
  const stages = stagesFinished(job, target).filter((s) => s !== 'Added');
  const pf = vendorExpense.paidFrom;
  events.push(
    makeExpenseEvent(
      'expense.created',
      {
        id: expenseId,
        description: `${stages.join(', ')} for ${job.service} · order #${job.id.slice(0, 8).toUpperCase()}`.slice(0, 200),
        category: 'Outsourced work',
        incurredOn: saleDay(now),
        incurredAt: now,
        amount: rest.vendor.cost,
        payeeId,
        payee: rest.vendor.name,
        note: '',
        receiptReference: '',
        jobIds: [job.id],
        restockIds: [],
        covers: null,
        materials: [],
        ...(pf
          ? {
              payment: {
                id: crypto.randomUUID(),
                amount: rest.vendor.cost,
                paidOn: saleDay(now),
                paidAt: now,
                method: pf.kind,
                methodLabel: pf.label,
                source: pf.source,
                reference: '',
                ...(pf.accountId ? { accountId: pf.accountId } : {}),
              },
            }
          : {}),
      },
      null,
      actor,
    ),
  );
  return { events, work: { ...rest, vendor: { ...rest.vendor, payeeId, expenseId } } };
}
