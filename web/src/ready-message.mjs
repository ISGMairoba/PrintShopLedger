// "Your order is ready": a WhatsApp message to the customer when a job is Completed. Jobs from the
// same sale that are also ready go in one message, with what is left to pay on them.
// The business can write its own wording (Business Settings → Jobs & payments) with these
// placeholders: {customer} {job} {number} {items} {is} {business} {balance} ({job} and {is} follow
// how many jobs are ready: "order is" / "orders are").
import { jobBalanceFast } from './balances.mjs';
import { currency } from './receipts.mjs';
import { whatsappLink } from './share.mjs';

export const READY_PLACEHOLDERS = ['customer', 'job', 'number', 'items', 'is', 'business', 'balance'];
export const DEFAULT_READY_MESSAGE =
  'Hello {customer}, your {job} {number} ({items}) {is} ready for collection at {business}. {balance}';

/** The jobs to mention: this one and the other ready jobs from the same sale. */
export function readyJobs(ledger, job) {
  if (!job.checkoutId) return [job];
  const same = ledger.jobs.filter(
    (j) => j.checkoutId === job.checkoutId && j.customerId === job.customerId && j.productionStatus === 'Completed',
  );
  return same.some((j) => j.id === job.id) ? same : [job, ...same];
}

const itemText = (j) => {
  const name = (j.description || j.service || '').trim();
  const qty = Number(j.quantity);
  return qty > 1 ? `${name} × ${qty}` : name;
};

/**
 * The message and WhatsApp link for a ready job.
 * @param {{ business: string, template?: string, terms?: { job: string, jobs: string } }} options
 */
export function readyMessage(ledger, job, { business, template, terms }) {
  const jobs = readyJobs(ledger, job);
  const customer = ledger.customers.find((c) => c.id === job.customerId);
  const owed = jobs.reduce((n, j) => n + jobBalanceFast(ledger, j).outstanding, 0);
  const first = String(customer?.name ?? '').trim().split(/\s+/)[0] || 'there';
  const word = jobs.length > 1 ? (terms?.jobs ?? 'jobs') : (terms?.job ?? 'job');
  const values = {
    customer: first,
    job: word,
    jobs: word,
    is: jobs.length > 1 ? 'are' : 'is',
    number: jobs.map((j) => `#${j.id.slice(0, 8).toUpperCase()}`).join(', '),
    items: jobs.map(itemText).filter(Boolean).join(', '),
    business: business || 'our shop',
    balance: owed > 0 ? `Balance to pay: ${currency(owed)}.` : 'It is fully paid. Thank you!',
  };
  const text = String(template?.trim() || DEFAULT_READY_MESSAGE)
    .replace(/\{(\w+)\}/g, (found, key) => (key in values ? values[key] : found))
    .replace(/\(\)\s?/g, '')
    .replace(/\s+([.,])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return { text, link: whatsappLink(customer?.phone, text), phone: customer?.phone ?? '', jobs };
}
