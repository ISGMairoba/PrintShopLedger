import {routeMoneyEvent,routeMoneyResult} from './account-methods.mjs';
import { applyOperation } from './operations.mjs';
import { applySaleAdjustment, applyWaste } from './sale-adjustments.mjs';
import { normalizeAmount } from './currency-input.mjs';
import { applyExpenseEvent } from './expenses.mjs';
import { applyCheckout, applyJobMaterial, applyJobStatus } from './checkout.mjs';
import { applyCustomerEvent } from './customers.mjs';
import { applyServiceEvent } from './services.mjs';
import { applyMaterialEvent, normalizeLedger } from './materials.mjs';
import { applyQuotationEvent } from './quotations.mjs';
import { applyReminderEvent } from './reminders.mjs';
import { tagNewRecords } from './branches.mjs';

// Money is stored as integer kobo. Customer balances are derived from jobs.
export const emptyLedger = () => ({
  payees: [],
  moneyAccounts: [],
  accountEntries: [],
  operationHistory: [],
  saleAdjustments: [],
  materialWaste: [],
  expenses: [],
  expenseHistory: [],
  drawerClosings: [],
  customers: [],
  jobs: [],
  payments: [],
  materials: [],
  materialHistory: [],
  services: [],
  checkouts: [],
  quotations: [],
  reminders: [],
});
export function money(value) {
  const text = normalizeAmount(String(value).trim());
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount > 100_000_000_000) throw new Error('Amount is too large.');
  return amount;
}
export function jobBalance(ledger, job) {
  const paid = ledger.payments.reduce(
    (sum, payment) =>
      sum +
      payment.allocations.reduce(
        (subtotal, allocation) => subtotal + (allocation.jobId === job.id ? allocation.amount : 0),
        0,
      ),
    0,
  );
  return {
    paid,
    outstanding: job.amount - paid,
    status:
      job.productionStatus === 'Cancelled'
        ? 'Cancelled'
        : paid === job.amount
          ? 'Fully paid'
          : paid === 0
            ? 'Unpaid'
            : 'Partially paid',
  };
}
export function customerBalance(ledger, customerId) {
  return ledger.jobs
    .filter((job) => job.customerId === customerId)
    .reduce((sum, job) => sum + jobBalance(ledger, job).outstanding, 0);
}
function positiveAmount(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000_000)
    throw new Error('Amount must be greater than zero and within the supported limit.');
}
/** Apply one operation; records it adds are tagged with this device's branch (branches.mjs). */
function applyRawEvent(ledger, event) {
  return tagNewRecords(ledger, applyEventCore(ledger, event));
}
function applyEventCore(ledger, event) {
  ledger = normalizeLedger(ledger);
  if (
    event.kind === 'job.due_changed' ||
    event.kind.startsWith('payee.') ||
    event.kind.startsWith('account.')
  )
    return applyOperation(ledger, event);
  if (event.kind.startsWith('sale.') || event.kind === 'payment.corrected')
    return applySaleAdjustment(ledger, event);
  if (event.kind === 'material.wasted') return applyWaste(ledger, event);
  if (event.kind.startsWith('expense.')) return applyExpenseEvent(ledger, event);
  if (event.kind.startsWith('quotation.')) return applyQuotationEvent(ledger, event);
  if (event.kind === 'customer.reminded') return applyReminderEvent(ledger, event);
  if (event.kind.startsWith('customer.')) return applyCustomerEvent(ledger, event);
  if (event.kind.startsWith('service.')) return applyServiceEvent(ledger, event);
  if (event.kind.startsWith('material.')) return applyMaterialEvent(ledger, event);
  if (event.kind === 'checkout.completed') return applyCheckout(ledger, event);
  if (event.kind === 'job.status_changed') return applyJobStatus(ledger, event);
  if (event.kind === 'job.material_used') return applyJobMaterial(ledger, event);
  const data = event.data;
  if (!event.id || !data.id) throw new Error('Missing record identifier.');
  if (event.kind === 'job.created') {
    if (ledger.jobs.some((job) => job.id === data.id)) return ledger;
    if (!ledger.customers.some((customer) => customer.id === data.customerId))
      throw new Error('Customer does not exist.');
    if (!data.description?.trim() || !data.service?.trim())
      throw new Error('Job description and service are required.');
    if (data.description.length > 500 || data.service.length > 160)
      throw new Error('Job description or service is too long.');
    positiveAmount(data.amount);
    return { ...ledger, jobs: [...ledger.jobs, data] };
  }
  if (event.kind === 'payment.recorded') {
    const existing = ledger.payments.find((payment) => payment.id === data.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(data))
        throw new Error('Payment ID already used for different data.');
      return ledger;
    }
    positiveAmount(data.amount);
    if (!['Cash', 'POS', 'Transfer', 'Other'].includes(data.method)) throw new Error('Choose a payment method.');
    if (!ledger.customers.some((customer) => customer.id === data.customerId))
      throw new Error('Customer does not exist.');
    if (!Array.isArray(data.allocations) || !data.allocations.length)
      throw new Error('Allocate the payment to at least one job.');
    const seen = new Set();
    let allocated = 0;
    for (const allocation of data.allocations) {
      positiveAmount(allocation.amount);
      if (seen.has(allocation.jobId)) throw new Error('A job can appear only once per payment.');
      seen.add(allocation.jobId);
      const job = ledger.jobs.find((item) => item.id === allocation.jobId);
      if (!job || job.customerId !== data.customerId)
        throw new Error('Every allocated job must belong to the selected customer.');
      if (allocation.amount > jobBalance(ledger, job).outstanding)
        throw new Error('The allocated amount exceeds the outstanding job balance.');
      allocated += allocation.amount;
    }
    if (allocated !== data.amount) throw new Error('Allocated amounts must equal the payment total.');
    const parsedDate = new Date(data.paidOn);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(data.paidOn) ||
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== data.paidOn
    )
      throw new Error('Choose a valid payment date.');
    if ((data.reference ?? '').length > 200) throw new Error('Payment reference is too long.');
    return { ...ledger, payments: [...ledger.payments, data] };
  }
  throw new Error('Unknown operation.');
}

export function applyEvent(ledger,event){const routed=routeMoneyEvent(ledger,event);return routeMoneyResult(ledger,applyRawEvent(ledger,routed),routed);}
