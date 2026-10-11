import { stockLevel } from './material-display.mjs';
// All amounts remain integer kobo. Dates use the business day in Lagos.
export function businessDay(value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}
export function shiftDay(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function dashboardRange(preset, today = businessDay(new Date().toISOString())) {
  return {
    from:
      preset === 'today'
        ? today
        : preset === 'week'
          ? shiftDay(today, -6)
          : preset === 'month'
            ? today.slice(0, 8) + '01'
            : shiftDay(today, -29),
    to: today,
  };
}
export function validRange(from, to) {
  const valid = (day) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  return valid(from) && valid(to) && from <= to && Date.parse(to) - Date.parse(from) <= 3660 * 86400000;
}
export function rankDashboardRows(rows, metric = 'sales', limit = 5) {
  return [...rows]
    .filter((r) => r[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
export function dashboardSummary(ledger, from, to) {
  if (!validRange(from, to)) throw Error('Choose a valid date range of up to ten years.');
  const inRange = (value) => {
    const day = businessDay(value);
    return day >= from && day <= to;
  };
  const jobs = ledger.jobs.filter((j) => inRange(j.createdAt));
  const payments = ledger.payments.filter((p) => !p.refundId && inRange(p.paidOn));
  const refunds = ledger.saleAdjustments.filter(
    (a) => a.action === 'sale.refunded' && inRange(a.paidOn || a.changedAt),
  );
  const expenses = ledger.expenses.filter((e) => !e.voided);
  const periodExpenses = expenses.filter((e) => inRange(e.incurredOn));
  // Voiding an expense does not refund a payment already made.
  const expensePayments = ledger.expenses.flatMap((e) => e.payments).filter((p) => inRange(p.paidOn));
  const sum = (rows, key) => rows.reduce((n, r) => n + (r[key] || 0), 0);
  const sales = sum(jobs, 'amount'),
    collected = sum(payments, 'amount'),
    refunded = sum(refunds, 'refundAmount'),
    expensePaid = sum(expensePayments, 'amount');
  const paidByJob = new Map();
  for (const p of ledger.payments)
    for (const a of p.allocations) paidByJob.set(a.jobId, (paidByJob.get(a.jobId) || 0) + a.amount);
  const outstandingJobs = ledger.jobs
    .map((job) => ({ job, outstanding: Math.max(0, job.amount - (paidByJob.get(job.id) || 0)) }))
    .filter((x) => x.outstanding > 0);
  const serviceMap = new Map(),
    sourceMap = new Map(),
    customerMap = new Map();
  let missingQuantity = 0;
  const customerNames = new Map(ledger.customers.map((c) => [c.id, c.name]));
  for (const job of jobs) {
    if (job.productionStatus === 'Cancelled') continue;
    const quantity = Number.isFinite(job.quantity) && job.quantity > 0 ? job.quantity : 0;
    if (!quantity) missingQuantity++;
    const serviceKey = job.serviceId ? 'service:' + job.serviceId : 'legacy:' + job.service;
    const sourceName = job.source?.trim() || 'Not recorded';
    const customerKey = job.customerId || 'not-recorded',
      customerName =
        customerNames.get(customerKey) ||
        (job.customerId ? 'Customer ' + job.customerId.slice(0, 8).toUpperCase() : 'Customer not recorded');
    for (const [map, id, name] of [
      [serviceMap, serviceKey, job.service],
      [sourceMap, sourceName, sourceName],
      [customerMap, customerKey, customerName],
    ]) {
      const row = map.get(id) || { id, name, sales: 0, quantity: 0, jobs: 0 };
      row.sales += job.amount;
      row.quantity += quantity;
      row.jobs++;
      map.set(id, row);
    }
  }
  const methods = new Map();
  const addMethod = (row, amount) => {
    const name = row.methodLabel || row.method;
    methods.set(name, (methods.get(name) || 0) + amount);
  };
  payments.forEach((p) => addMethod(p, p.amount));
  refunds.forEach((r) => addMethod(r, -r.refundAmount));
  const monthly = Date.parse(to) - Date.parse(from) > 61 * 86400000;
  const bucketMap = new Map();
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const key = monthly ? day.slice(0, 7) : day;
    if (!bucketMap.has(key)) bucketMap.set(key, { date: key, sales: 0, collected: 0, expenses: 0 });
  }
  const bucket = (value) => bucketMap.get(businessDay(value).slice(0, monthly ? 7 : 10));
  jobs.forEach((j) => (bucket(j.createdAt).sales += j.amount));
  payments.forEach((p) => (bucket(p.paidOn).collected += p.amount));
  refunds.forEach((r) => (bucket(r.paidOn || r.changedAt).collected -= r.refundAmount));
  expensePayments.forEach((p) => (bucket(p.paidOn).expenses += p.amount));
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1,
    previousTo = shiftDay(from, -1),
    previousFrom = shiftDay(from, -days);
  const previous = (value) => {
    const day = businessDay(value);
    return day >= previousFrom && day <= previousTo;
  };
  return {
    sales,
    collected,
    refunded,
    netCollected: collected - refunded,
    expenseIncurred: sum(periodExpenses, 'amount'),
    netIncome: sales - sum(periodExpenses, 'amount'),
    expensePaid,
    netCashFlow: collected - refunded - expensePaid,
    jobs: jobs.filter((j) => j.productionStatus !== 'Cancelled').length,
    cancelled: jobs.filter((j) => j.productionStatus === 'Cancelled').length,
    outstanding: outstandingJobs.reduce((n, x) => n + x.outstanding, 0),
    outstandingJobs: outstandingJobs.length,
    expenseOutstanding: expenses.reduce((n, e) => n + Math.max(0, e.amount - sum(e.payments, 'amount')), 0),
    stockAlerts: ledger.materials
      .filter((m) => stockLevel(m))
      .sort(
        (a, b) =>
          (stockLevel(a) === 'Critical' ? 0 : 1) - (stockLevel(b) === 'Critical' ? 0 : 1) ||
          a.available - b.available ||
          a.name.localeCompare(b.name),
      ),
    stages: Object.entries(
      ledger.jobs.reduce((s, j) => {
        const key = j.productionStatus || 'Queued';
        s[key] = (s[key] || 0) + 1;
        return s;
      }, {}),
    ).map(([name, count]) => ({ name, count })),
    services: [...serviceMap.values()],
    sources: [...sourceMap.values()],
    customers: [...customerMap.values()],
    missingQuantity,
    methods: [...methods.entries()]
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount),
    trend: [...bucketMap.values()],
    monthly,
    previous: {
      from: previousFrom,
      to: previousTo,
      sales: sum(
        ledger.jobs.filter((j) => previous(j.createdAt)),
        'amount',
      ),
      netCollected:
        sum(
          ledger.payments.filter((p) => !p.refundId && previous(p.paidOn)),
          'amount',
        ) -
        sum(
          ledger.saleAdjustments.filter(
            (a) => a.action === 'sale.refunded' && previous(a.paidOn || a.changedAt),
          ),
          'refundAmount',
        ),
    },
  };
}
/** Whether a time falls in a period from PeriodFilter (an empty or invalid period matches everything). */
export function inPeriod(value, period) {
  if (!period || period.preset === 'all' || !validRange(period.from, period.to)) return true;
  const day = businessDay(value);
  return day >= period.from && day <= period.to;
}
