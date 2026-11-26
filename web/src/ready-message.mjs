// "Your order is ready": a WhatsApp message to the customer when a job is Completed. Jobs from the
// same sale that are also ready go in one message, with what is left to pay on them.
// The business can write its own wording (Business Settings → Jobs & payments) with these
// placeholders: {customer} {job} {number} {items} {is} {business} {balance} ({job} and {is} follow
// how many jobs are ready: "order is" / "orders are").
import { jobBalanceFast } from './balances.mjs';
import { currency } from './receipts.mjs';
import { whatsappLink } from './share.mjs';
import { customerNames, messageMode, messageText } from './messages.mjs';
import { jobParts, paymentNeeded } from './job-handover.mjs';

/**
 * Some of a part order is ready (made in batches, not yet all done): how many are ready to collect now.
 * Zero when the job is finished or has nothing waiting.
 */
export function partReady(job) {
  if (['Completed', 'Collected', 'Cancelled'].includes(job.productionStatus ?? 'Added')) return 0;
  return jobParts(job).ready;
}

/**
 * Whether "Tell customer" can be used: any job not cancelled (owner, 26 Nov). Ready, collected, on
 * hold and part ready have their own message; otherwise "work continues" just after a hold, else an
 * order update (where it is, how much is done, when it should be ready).
 */
export const canTellCustomer = (job) => job.productionStatus !== 'Cancelled';

/** The message a job gets now: 'held', 'collected', 'part_ready', 'ready', 'resumed' or 'update'. */
export function messageFor(job, now = Date.now()) {
  if (job.hold) return 'held';
  if (job.productionStatus === 'Collected') return 'collected';
  if (job.productionStatus === 'Completed') return 'ready';
  if (partReady(job) > 0) return 'part_ready';
  // Back from a hold in the last day, and no stage moved since: "work continues".
  const last = (job.holdHistory ?? []).at(-1);
  const resumed = last?.resumedAt ? Date.parse(last.resumedAt) : NaN;
  const moved = Date.parse(job.stageAt ?? job.createdAt ?? '');
  if (now - resumed < 86400000 && !(moved > resumed)) return 'resumed';
  return 'update';
}

const dueWords = (job) => {
  const due = job.dueAt && !Number.isNaN(Date.parse(job.dueAt)) ? new Date(job.dueAt) : null;
  return due
    ? due.toLocaleString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '';
};

/** How each hold reason reads to the customer. */
const HOLD_WORDS = {
  'Waiting for design approval': 'waiting for your design approval',
  'Waiting for balance payment': 'waiting for the balance payment',
  'Waiting for materials': 'waiting for materials',
  'Customer not reachable': 'we have not been able to reach you',
};

/** The "order on hold" message: why, the note, and whether the collection date moves. */
export function heldMessage(ledger, job, { business, terms, messages }) {
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const hold = job.hold ?? {};
  const own = String(hold.note ?? '').trim();
  // "Other": the note says what it is waiting for, so it becomes the reason.
  const other = hold.reason === 'Other';
  const note = other ? '' : own;
  const due = job.dueAt && !Number.isNaN(Date.parse(job.dueAt)) ? new Date(job.dueAt) : null;
  const values = {
    ...customerNames(customer?.name, customer?.calledAs),
    job: terms?.job ?? 'order',
    number: `#${job.id.slice(0, 8).toUpperCase()}`,
    items: itemText(job),
    reason: other
      ? own.replace(/[.!?]+$/, '') || 'waiting for something'
      : (HOLD_WORDS[hold.reason] ?? String(hold.reason ?? '').toLowerCase()),
    note: note ? (/[.!?]$/.test(note) ? note : `${note}.`) : '',
    deadline: hold.extendDeadline ? 'Your collection date moves by the time it is on hold.' : '',
    due: due
      ? due.toLocaleString('en-GB', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '',
    business: business || 'our shop',
  };
  const text = messageText(messages, 'held', values);
  return {
    text,
    link: whatsappLink(customer?.phone, text),
    phone: customer?.phone ?? '',
    jobs: [job],
    mode: messageMode(messages, 'held'),
  };
}

export const READY_PLACEHOLDERS = ['customer', 'job', 'number', 'items', 'is', 'business', 'balance'];
export const DEFAULT_READY_MESSAGE =
  'Hello {customer}, your {job} {number} ({items}) {is} ready for collection at {business}. {balance}';

/** The jobs to mention: this one and the other ready jobs from the same sale. */
export function readyJobs(ledger, job) {
  if (!job.checkoutId) return [job];
  const same = ledger.jobs.filter(
    (j) =>
      j.checkoutId === job.checkoutId &&
      j.customerId === job.customerId &&
      (j.productionStatus === 'Completed' || partReady(j) > 0),
  );
  return same.some((j) => j.id === job.id) ? same : [job, ...same];
}

const itemText = (j) => {
  const name = (j.description || j.service || '').trim();
  const qty = Number(j.quantity);
  // Part of a part order: how many of how many.
  const part = partReady(j);
  if (part > 0) return `${name} × ${part} of ${qty}`;
  return qty > 1 ? `${name} × ${qty}` : name;
};

/** The "part ready" message for a part order with some items ready (not all done yet). */
function partReadyMessage(ledger, job, { business, messages }) {
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const { total, collected, ready } = jobParts(job);
  const balance = jobBalanceFast(ledger, job);
  const { short } = paymentNeeded(job, balance.paid, ready);
  const values = {
    ...customerNames(customer?.name, customer?.calledAs),
    ready: String(ready),
    total: String(total),
    collected: String(collected),
    item: (job.description || job.service || '').trim(),
    are: ready === 1 ? 'is' : 'are',
    number: `#${job.id.slice(0, 8).toUpperCase()}`,
    to_pay: short > 0 ? `Amount to pay for this part: ${currency(short)}.` : 'This part is paid.',
    balance:
      balance.outstanding > 0
        ? `Balance on the order: ${currency(balance.outstanding)}.`
        : 'The order is fully paid. Thank you!',
    business: business || 'our shop',
  };
  const text = messageText(messages, 'part_ready', values);
  return {
    text,
    link: whatsappLink(customer?.phone, text),
    phone: customer?.phone ?? '',
    jobs: [job],
    mode: messageMode(messages, 'part_ready'),
  };
}

/**
 * The message and WhatsApp link for a ready job, in the business's wording (Business Settings →
 * Messages; the older Jobs & payments wording still counts until Messages has its own).
 * @param {{ business: string, template?: string, terms?: { job: string, jobs: string }, messages?: any }} options
 */
export function readyMessage(ledger, job, { business, template, terms, messages, stage }) {
  const kind = messageFor(job);
  if (kind === 'resumed' || kind === 'update')
    return progressMessage(ledger, job, kind, { business, terms, messages, stage });
  if (job.hold) return heldMessage(ledger, job, { business, terms, messages });
  if (job.productionStatus === 'Collected')
    return collectedMessage(ledger, job, { business, terms, messages });
  // A part order with only some items ready: the "part ready" message.
  if (job.productionStatus !== 'Completed' && partReady(job) > 0)
    return partReadyMessage(ledger, job, { business, messages });
  const jobs = readyJobs(ledger, job);
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const owed = jobs.reduce((n, j) => n + jobBalanceFast(ledger, j).outstanding, 0);
  const word = jobs.length > 1 ? (terms?.jobs ?? 'jobs') : (terms?.job ?? 'job');
  const values = {
    ...customerNames(customer?.name, customer?.calledAs),
    job: word,
    jobs: word,
    is: jobs.length > 1 ? 'are' : 'is',
    number: jobs.map((j) => `#${j.id.slice(0, 8).toUpperCase()}`).join(', '),
    items: jobs.map(itemText).filter(Boolean).join(', '),
    business: business || 'our shop',
    balance: owed > 0 ? `Balance to pay: ${currency(owed)}.` : 'It is fully paid. Thank you!',
  };
  const text = messageText(messages, 'ready', values, template ?? '');
  return {
    text,
    link: whatsappLink(customer?.phone, text),
    phone: customer?.phone ?? '',
    jobs,
    mode: messageMode(messages, 'ready'),
  };
}

/** The "order collected" message: who collected it and when, and what is left to pay. */
export function collectedMessage(ledger, job, { business, terms, messages }) {
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const owed = jobBalanceFast(ledger, job).outstanding;
  const last = (job.progress?.handovers ?? []).at(-1);
  const by = (last?.collectedBy ?? '').trim();
  const day = new Date(last?.at ?? job.modifiedAt ?? Date.now());
  const values = {
    ...customerNames(customer?.name, customer?.calledAs),
    job: terms?.job ?? 'order',
    number: `#${job.id.slice(0, 8).toUpperCase()}`,
    items: itemText({ ...job, productionStatus: 'Collected' }),
    collected_by: by ? `by ${by}` : '',
    date: day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    balance: owed > 0 ? `Balance to pay: ${currency(owed)}.` : 'It is fully paid.',
    business: business || 'our shop',
  };
  const text = messageText(messages, 'collected', values);
  return {
    text,
    link: whatsappLink(customer?.phone, text),
    phone: customer?.phone ?? '',
    jobs: [job],
    mode: messageMode(messages, 'collected'),
  };
}

/**
 * "Work continues" (just back from a hold) or "order update" (any time): each open job of the sale
 * with its stage and progress, when it should be ready, and what is left to pay.
 * stage: the business's own stage names.
 */
export function progressMessage(
  ledger,
  job,
  kind,
  { business, terms, messages, stage = (s) => s },
  now = Date.now(),
) {
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const open = (j) => !['Cancelled', 'Collected'].includes(j.productionStatus ?? 'Added');
  const jobs =
    kind === 'update' && job.checkoutId
      ? [
          job,
          ...ledger.jobs.filter(
            (j) =>
              j.id !== job.id &&
              j.checkoutId === job.checkoutId &&
              j.customerId === job.customerId &&
              open(j),
          ),
        ]
      : [job];
  const line = (j) => {
    const { total, done } = jobParts(j);
    const name = (j.description || j.service || '').trim();
    const qty = total > 1 ? `${name} × ${total}` : name;
    const where = j.hold
      ? 'on hold'
      : j.productionStatus === 'Completed'
        ? 'ready for collection'
        : `at ${stage(j.productionStatus ?? 'Added')}`;
    const progress = done > 0 && done < total ? `, ${done} done, ${total - done} left` : '';
    return `${qty} ${where}${progress}`;
  };
  const { total, done } = jobParts(job);
  const owed = jobs.reduce((n, j) => n + jobBalanceFast(ledger, j).outstanding, 0);
  const latest = jobs
    .map((j) => j.dueAt)
    .filter((d) => d && !Number.isNaN(Date.parse(d)))
    .sort()
    .at(-1);
  const due = latest ? `Expected ready: ${dueWords({ dueAt: latest })}.` : '';
  const last = (job.holdHistory ?? []).at(-1);
  const word = jobs.length > 1 ? (terms?.jobs ?? 'orders') : (terms?.job ?? 'order');
  const values = {
    ...customerNames(customer?.name, customer?.calledAs),
    job: word,
    number: jobs.map((j) => `#${j.id.slice(0, 8).toUpperCase()}`).join(', '),
    items: kind === 'resumed' ? itemText(job) : jobs.map(line).join('; '),
    stage: stage(job.productionStatus ?? 'Added'),
    progress: done > 0 && done < total ? `${done} done, ${total - done} left` : '',
    done: String(done),
    left: String(Math.max(0, total - done)),
    total: String(total),
    due,
    late: latest && Date.parse(latest) < now ? 'Sorry, it is running late.' : '',
    moved:
      kind === 'resumed' && last?.extendDeadline && job.dueAt
        ? `Your collection date moved to ${dueWords(job)}.`
        : '',
    balance: owed > 0 ? `Balance to pay: ${currency(owed)}.` : 'It is fully paid.',
    business: business || 'our shop',
  };
  const text = messageText(messages, kind, values);
  return {
    text,
    link: whatsappLink(customer?.phone, text),
    phone: customer?.phone ?? '',
    jobs,
    mode: messageMode(messages, kind),
  };
}
