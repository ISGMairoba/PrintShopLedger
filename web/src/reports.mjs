import { customerBalanceFast, jobBalanceFast } from './balances.mjs';
import { walletBalance } from './checkout.mjs';
import { businessDay, validRange, dashboardSummary } from './dashboard.mjs';
import { paymentName } from './business-options.mjs';
import { adjustmentLabels } from './sale-adjustments.mjs';
import { customerCode } from './customers.mjs';
import { materialActionLabels } from './material-display.mjs';

// Reports read the synced ledger only; they never create events.
// Money stays integer kobo. Days use the Africa/Lagos business day.

const inRange = (value, from, to) => {
  const day = businessDay(value);
  return !!day && day >= from && day <= to;
};
const shortId = (id) =>
  String(id ?? '')
    .slice(0, 8)
    .toUpperCase();
const byDate = (a, b) =>
  a.date.localeCompare(b.date) || String(a.sortKey ?? '').localeCompare(String(b.sortKey ?? ''));

/**
 * Customer statement for one customer.
 * Activity (jobs, payments, adjustments) is filtered to the period by its own date.
 * Balances (paid, outstanding, owed, credit) are current: they reflect every
 * payment and correction recorded so far, so the closing balance always equals
 * the customer's outstanding amount shown elsewhere in the app.
 */
export function customerStatement(
  ledger,
  customerId,
  from,
  to,
  { includePaid = true, now = new Date().toISOString() } = {},
) {
  if (!validRange(from, to)) throw Error('Choose a valid date range of up to ten years.');
  const customer = ledger.customers.find((c) => c.id === customerId);
  if (!customer) throw Error('Choose a customer.');
  const jobRow = (job) => {
    const b = jobBalanceFast(ledger, job);
    return {
      id: job.id,
      ref: shortId(job.id),
      date: businessDay(job.createdAt),
      sortKey: job.createdAt,
      service: job.service,
      description: job.description,
      amount: job.amount,
      paid: b.paid,
      outstanding: b.outstanding,
      status: b.status,
      stage: job.productionStatus ?? 'Added',
    };
  };
  const allJobs = ledger.jobs.filter((j) => j.customerId === customerId);
  const periodJobs = allJobs
    .filter((j) => inRange(j.createdAt, from, to))
    .map(jobRow)
    .sort(byDate);
  const jobs = includePaid ? periodJobs : periodJobs.filter((j) => j.outstanding !== 0);
  // Jobs created before the period that still have money owed, so the statement
  // explains the whole balance and not only this period's work.
  const earlierOwing = allJobs
    .filter((j) => businessDay(j.createdAt) < from)
    .map(jobRow)
    .filter((j) => j.outstanding !== 0)
    .sort(byDate);
  const laterOwing = allJobs
    .filter((j) => businessDay(j.createdAt) > to)
    .map(jobRow)
    .filter((j) => j.outstanding !== 0)
    .sort(byDate);
  const jobLabel = (id) => {
    const job = ledger.jobs.find((j) => j.id === id);
    return job ? `${job.description} (${shortId(id)})` : shortId(id);
  };
  const payments = ledger.payments
    .filter((p) => p.customerId === customerId && inRange(p.paidOn || p.createdAt, from, to))
    .map((p) => ({
      id: p.id,
      ref: shortId(p.id),
      date: businessDay(p.paidOn || p.createdAt),
      sortKey: p.createdAt,
      method: paymentName(p),
      reference: p.reference ?? '',
      refund: !!p.refundId,
      received: p.amount,
      creditUsed: p.walletUsed ?? 0,
      creditAdded: p.walletAdded ?? 0,
      jobsPaid: p.allocations.map((a) => ({ job: jobLabel(a.jobId), amount: a.amount })),
    }))
    .sort(byDate);
  const adjustments = ledger.saleAdjustments
    .filter((a) => a.customerId === customerId && !a.groupId && inRange(a.changedAt, from, to))
    .map((a) => ({
      id: a.id,
      ref: shortId(a.id),
      date: businessDay(a.changedAt),
      sortKey: a.changedAt,
      action: adjustmentLabels[a.action] ?? a.action,
      job: jobLabel(a.jobId),
      chargeBefore: a.before?.amount ?? 0,
      chargeAfter: a.after?.amount ?? 0,
      refund: a.refundAmount ?? 0,
      creditReleased: a.creditReleased ?? 0,
      reason: a.reason,
      approvedBy: a.changedByLabel,
    }))
    .sort(byDate);
  const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
  const totals = {
    charged: sum(periodJobs, 'amount'),
    received: sum(
      payments.filter((p) => !p.refund),
      'received',
    ),
    refunded: sum(
      payments.filter((p) => p.refund),
      'creditUsed',
    ),
    creditUsed: sum(
      payments.filter((p) => !p.refund),
      'creditUsed',
    ),
    owedNow: customerBalanceFast(ledger, customerId),
    creditNow: walletBalance(ledger, customerId),
  };
  return {
    customer: {
      id: customer.id,
      code: customerCode(customer.id, ledger.customers),
      name: customer.name,
      phone: customer.phone,
      address: customer.address,
      creditLimit: customer.creditLimit,
      archived: customer.archived,
    },
    from,
    to,
    generatedAt: now,
    includePaid,
    jobs,
    earlierOwing,
    laterOwing,
    payments,
    adjustments,
    totals,
  };
}

const naira = (kobo) => (kobo / 100).toFixed(2);
const lower = (value) => String(value ?? '').toLowerCase();
const matchesQuery = (query, values) => {
  const q = lower(query).trim();
  if (!q) return true;
  const text = values.map(lower).join(' ');
  return q.split(/\s+/).every((word) => text.includes(word));
};

/**
 * Narrow a statement to what the user searched for or filtered.
 * Totals stay account-level; only the listed records change.
 * show: 'all' | 'jobs' | 'payments' | 'adjustments'
 */
export function filterStatement(
  statement,
  { query = '', paymentStatus = '', stage = '', method = '', show = 'all' } = {},
  money = naira,
) {
  const jobOk = (j) =>
    (!paymentStatus || j.status === paymentStatus) &&
    (!stage || j.stage === stage) &&
    matchesQuery(query, [
      j.date,
      j.ref,
      j.service,
      j.description,
      j.stage,
      j.status,
      money(j.amount),
      money(j.paid),
      money(j.outstanding),
      naira(j.amount),
    ]);
  const paymentOk = (p) =>
    (!method || p.method === method) &&
    matchesQuery(query, [
      p.date,
      p.ref,
      p.method,
      p.reference,
      p.refund ? 'refund' : '',
      money(p.received),
      naira(p.received),
      ...p.jobsPaid.map((a) => a.job),
    ]);
  const adjustmentOk = (a) =>
    matchesQuery(query, [a.date, a.ref, a.action, a.job, a.reason, a.approvedBy, money(a.refund)]);
  const jobs = show === 'all' || show === 'jobs';
  const result = {
    ...statement,
    jobs: jobs ? statement.jobs.filter(jobOk) : [],
    earlierOwing: jobs ? statement.earlierOwing.filter(jobOk) : [],
    laterOwing: jobs ? statement.laterOwing.filter(jobOk) : [],
    payments: show === 'all' || show === 'payments' ? statement.payments.filter(paymentOk) : [],
    adjustments: show === 'all' || show === 'adjustments' ? statement.adjustments.filter(adjustmentOk) : [],
  };
  const count = (r) =>
    r.jobs.length + r.earlierOwing.length + r.laterOwing.length + r.payments.length + r.adjustments.length;
  const filters = [
    query.trim() && `search "${query.trim()}"`,
    paymentStatus && `payment status ${paymentStatus}`,
    stage && `stage ${stage}`,
    method && `method ${method}`,
    show !== 'all' && `showing ${show} only`,
  ].filter(Boolean);
  return { ...result, shown: count(result), total: count(statement), filters };
}

const jobLayout = { widths: [9, 8, 12, 24, 9, 10, 10, 10, 10], numeric: [5, 6, 7] };
/**
 * Statement as report sections: [{title, columns, rows, widths, numeric}].
 * money formats kobo for the output: plain naira numbers for spreadsheets (default),
 * or the app's currency format for PDFs. unit is appended to money column names.
 */
export function statementSections(statement, { money = naira, unit = ' (NGN)' } = {}) {
  const jobColumns = [
    'Date',
    'Job ID',
    'Service',
    'Description',
    'Stage',
    `Amount${unit}`,
    `Paid${unit}`,
    `Outstanding${unit}`,
    'Payment status',
  ];
  const jobCells = (j) => [
    j.date,
    j.ref,
    j.service,
    j.description,
    j.stage,
    money(j.amount),
    money(j.paid),
    money(j.outstanding),
    j.status,
  ];
  const t = statement.totals;
  const sections = [
    {
      title: 'Account summary',
      columns: ['Item', 'Value'],
      widths: [2, 3],
      numeric: [],
      rows: [
        ['Customer', statement.customer.name],
        ['Customer ID', statement.customer.code],
        ['Phone', statement.customer.phone],
        ['Address', statement.customer.address],
        ['Period', `${statement.from} to ${statement.to}`],
        [`Credit limit${unit}`, money(statement.customer.creditLimit)],
        [`Jobs charged in period${unit}`, money(t.charged)],
        [`Money received in period${unit}`, money(t.received)],
        [`Credit used in period${unit}`, money(t.creditUsed)],
        [`Refunds paid in period${unit}`, money(t.refunded)],
        [`Total owed now${unit}`, money(t.owedNow)],
        [`Credit balance now${unit}`, money(t.creditNow)],
      ],
    },
  ];
  const show = statement.filters?.find?.((f) => f.startsWith('showing '));
  if (!show || show.includes('jobs'))
    sections.push({
      title: 'Jobs in this period',
      columns: jobColumns,
      ...jobLayout,
      rows: statement.jobs.map(jobCells),
    });
  if (statement.earlierOwing.length)
    sections.push({
      title: 'Earlier jobs still owing',
      columns: jobColumns,
      ...jobLayout,
      rows: statement.earlierOwing.map(jobCells),
    });
  if (statement.laterOwing.length)
    sections.push({
      title: 'Later jobs still owing',
      columns: jobColumns,
      ...jobLayout,
      rows: statement.laterOwing.map(jobCells),
    });
  if (!show || show.includes('payments'))
    sections.push({
      title: 'Payments in this period',
      columns: [
        'Date',
        'Payment ID',
        'Method',
        'Reference',
        `Money received${unit}`,
        `Credit used${unit}`,
        `Credit added${unit}`,
        'Jobs paid',
      ],
      widths: [9, 9, 12, 12, 11, 10, 10, 27],
      numeric: [4, 5, 6],
      rows: statement.payments.map((p) => [
        p.date,
        p.ref,
        p.refund ? `${p.method} (refund to customer)` : p.method,
        p.reference,
        money(p.received),
        money(p.creditUsed),
        money(p.creditAdded),
        p.jobsPaid.map((a) => `${a.job}: ${money(a.amount)}`).join('; '),
      ]),
    });
  if (statement.adjustments.length)
    sections.push({
      title: 'Corrections and refunds in this period',
      columns: [
        'Date',
        'Adjustment ID',
        'Type',
        'Job',
        `Charge before${unit}`,
        `Charge after${unit}`,
        `Refunded${unit}`,
        'Reason',
        'Approved by',
      ],
      widths: [9, 9, 12, 16, 10, 10, 10, 15, 10],
      numeric: [4, 5, 6],
      rows: statement.adjustments.map((a) => [
        a.date,
        a.ref,
        a.action,
        a.job,
        money(a.chargeBefore),
        money(a.chargeAfter),
        money(a.refund),
        a.reason,
        a.approvedBy,
      ]),
    });
  return sections;
}

export const transactionTypes = [
  'Job created',
  'Payment received',
  'Refund paid',
  'Expense payment',
  'Sale correction',
  'Stock change',
];
const typeAccess = {
  'Job created': 'jobs',
  'Payment received': 'payments',
  'Refund paid': 'payments',
  'Expense payment': 'expenses',
  'Sale correction': 'jobs',
  'Stock change': 'stock',
};

/**
 * Every recorded activity in the period, newest first: jobs, money in and out, corrections and stock changes.
 * access: {jobs, payments, expenses, stock, customers} limits rows to what the user can see elsewhere.
 * Money columns never double count: corrections show what changed but carry no money
 * (corrected payments already show their current amount), and refunds appear once as a refund paid.
 */
export function transactionRegister(
  ledger,
  from,
  to,
  access = { jobs: true, payments: true, expenses: true, stock: true, customers: true },
) {
  if (!validRange(from, to)) throw Error('Choose a valid date range of up to ten years.');
  const customerName = (id) =>
    access.customers ? (ledger.customers.find((c) => c.id === id)?.name ?? 'Unknown customer') : 'Customer';
  const checkout = (id) => (id ? ledger.checkouts.find((c) => c.id === id) : undefined);
  const row = (r) => ({
    charge: 0,
    moneyIn: 0,
    moneyOut: 0,
    stock: '',
    method: '',
    staff: '',
    drawer: '',
    ...r,
    day: businessDay(r.at),
  });
  const rows = [];
  if (access.jobs)
    for (const j of ledger.jobs)
      if (inRange(j.createdAt, from, to)) {
        const c = checkout(j.checkoutId);
        rows.push(
          row({
            id: 'job-' + j.id,
            at: j.createdAt,
            type: 'Job created',
            ref: shortId(j.id),
            party: customerName(j.customerId),
            details: `${j.service} - ${j.description}${j.productionStatus === 'Cancelled' ? ' (cancelled)' : ''}`,
            charge: j.amount,
            staff: c?.createdByLabel ?? '',
          }),
        );
      }
  if (access.payments)
    for (const p of ledger.payments) {
      const day = p.paidOn || p.createdAt;
      if (!inRange(day, from, to)) continue;
      const c = checkout(p.checkoutId);
      const drawer = c?.drawerClosingId ? shortId(c.drawerClosingId) : c ? 'Open' : '';
      if (p.refundId)
        rows.push(
          row({
            id: 'pay-' + p.id,
            at: p.createdAt && businessDay(p.createdAt) === businessDay(day) ? p.createdAt : day,
            type: 'Refund paid',
            ref: shortId(p.id),
            party: customerName(p.customerId),
            details: p.reference || 'Refund to customer',
            moneyOut: p.walletUsed ?? 0,
            method: paymentName(p),
          }),
        );
      else
        rows.push(
          row({
            id: 'pay-' + p.id,
            at: p.createdAt && businessDay(p.createdAt) === businessDay(day) ? p.createdAt : day,
            type: 'Payment received',
            ref: shortId(p.id),
            party: customerName(p.customerId),
            details: [
              p.reference,
              (p.walletUsed ?? 0) ? `credit used ${naira(p.walletUsed)}` : '',
              (p.walletAdded ?? 0) ? `credit added ${naira(p.walletAdded)}` : '',
            ]
              .filter(Boolean)
              .join('; '),
            moneyIn: p.amount,
            method: paymentName(p),
            staff: c?.createdByLabel ?? '',
            drawer,
          }),
        );
    }
  if (access.expenses)
    for (const e of ledger.expenses)
      for (const pay of e.payments ?? []) {
        if (!inRange(pay.paidOn || pay.createdAt, from, to)) continue;
        rows.push(
          row({
            id: 'exp-' + e.id + '-' + pay.id,
            at:
              pay.createdAt && businessDay(pay.createdAt) === businessDay(pay.paidOn)
                ? pay.createdAt
                : pay.paidOn,
            type: 'Expense payment',
            ref: shortId(e.id),
            party: e.payee || 'Not recorded',
            details: `${e.category} - ${e.description}${e.voided ? ' (expense voided)' : ''}`,
            moneyOut: pay.amount,
            method: pay.methodLabel || pay.method || '',
            staff: pay.createdByLabel ?? '',
          }),
        );
      }
  if (access.jobs)
    for (const a of ledger.saleAdjustments) {
      if (a.groupId || a.action === 'sale.refunded' || !inRange(a.changedAt, from, to)) continue;
      rows.push(
        row({
          id: 'adj-' + a.id,
          at: a.changedAt,
          type: 'Sale correction',
          ref: shortId(a.id),
          party: customerName(a.customerId),
          details: `${adjustmentLabels[a.action] ?? a.action}: ${naira(a.before?.amount ?? 0)} to ${naira(a.after?.amount ?? 0)}. ${a.reason}`,
          staff: a.changedByLabel ?? '',
        }),
      );
    }
  if (access.stock)
    for (const h of ledger.materialHistory) {
      if (!inRange(h.changedAt, from, to)) continue;
      const delta = Math.round(((h.afterAvailable ?? 0) - (h.beforeAvailable ?? 0)) * 1000) / 1000;
      if (delta === 0) continue; // edits that do not change the quantity (names, prices, empty new materials)
      rows.push(
        row({
          id: 'stock-' + h.id,
          at: h.changedAt,
          type: 'Stock change',
          ref: shortId(h.id),
          party: h.materialName,
          details: `${materialActionLabels[h.action] ?? h.action}${h.reason ? ': ' + h.reason : ''}`,
          stock: `${delta > 0 ? '+' : ''}${delta} ${h.measurementUnit} (now ${h.afterAvailable})`,
          stockDelta: delta,
          staff: h.changedByLabel ?? '',
        }),
      );
    }
  rows.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return { from, to, rows, types: transactionTypes.filter((t) => access[typeAccess[t]]) };
}

export function filterTransactions(
  register,
  { query = '', type = '', method = '', staff = '' } = {},
  money = naira,
) {
  const rows = register.rows.filter(
    (r) =>
      (!type || r.type === type) &&
      (!method || r.method === method) &&
      (!staff || r.staff === staff) &&
      matchesQuery(query, [
        r.day,
        r.type,
        r.ref,
        r.party,
        r.details,
        r.method,
        r.staff,
        r.stock,
        r.drawer,
        r.charge ? money(r.charge) : '',
        r.moneyIn ? money(r.moneyIn) : '',
        r.moneyOut ? money(r.moneyOut) : '',
      ]),
  );
  const totals = rows.reduce(
    (t, r) => ({
      charge: t.charge + r.charge,
      moneyIn: t.moneyIn + r.moneyIn,
      moneyOut: t.moneyOut + r.moneyOut,
    }),
    { charge: 0, moneyIn: 0, moneyOut: 0 },
  );
  const filters = [
    query.trim() && `search "${query.trim()}"`,
    type && `type ${type}`,
    method && `method ${method}`,
    staff && `staff ${staff}`,
  ].filter(Boolean);
  return {
    ...register,
    rows,
    totals: { ...totals, net: totals.moneyIn - totals.moneyOut },
    shown: rows.length,
    total: register.rows.length,
    filters,
  };
}

export function transactionSections(register, { money = naira, unit = ' (NGN)' } = {}) {
  const blank = (value) => (value ? money(value) : '');
  const t = register.totals;
  return [
    {
      title: 'Totals',
      columns: ['Item', 'Value'],
      widths: [2, 3],
      numeric: [],
      rows: [
        ['Period', `${register.from} to ${register.to}`],
        ['Records', String(register.rows.length)],
        [`Job charges${unit}`, money(t.charge)],
        [`Money in${unit}`, money(t.moneyIn)],
        [`Money out${unit}`, money(t.moneyOut)],
        [`Net (in minus out)${unit}`, money(t.net)],
      ],
    },
    {
      title: 'Transactions',
      columns: [
        'Date and time',
        'Type',
        'Reference',
        'Customer / payee / material',
        'Details',
        `Charge${unit}`,
        `Money in${unit}`,
        `Money out${unit}`,
        'Stock change',
        'Method',
        'Staff',
        'Drawer',
      ],
      widths: [11, 8, 9.5, 13, 19.5, 9, 9, 9, 11, 8, 9, 7],
      numeric: [5, 6, 7],
      rows: register.rows.map((r) => [
        /^\d{4}-\d{2}-\d{2}$/.test(r.at)
          ? r.at
          : new Date(r.at).toLocaleString('en-NG', {
              timeZone: 'Africa/Lagos',
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
        r.type,
        r.ref,
        r.party,
        r.details,
        blank(r.charge),
        blank(r.moneyIn),
        blank(r.moneyOut),
        r.stock,
        r.method,
        r.staff,
        r.drawer,
      ]),
    },
  ];
}

/** CSV text (RFC 4180) for report sections, with a title block. Excel-friendly with a BOM added at download. */
export function sectionsToCsv(titleLines, sections) {
  const cell = (value) => {
    let text = value == null ? '' : String(value);
    // Spreadsheet formula injection: a cell starting with = + - @ is treated as a formula by Excel.
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = "'" + text;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const line = (cells) => cells.map(cell).join(',');
  const out = titleLines.map((t) => line([t]));
  for (const s of sections) {
    out.push('', line([s.title]), line(s.columns));
    for (const r of s.rows) out.push(line(r));
    if (!s.rows.length) out.push(line(['None']));
  }
  return out.join('\r\n') + '\r\n';
}

export const reportFileName = (...parts) =>
  parts
    .filter(Boolean)
    .join(' - ')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);

const AGE_BUCKETS = [
  ['0 to 30 days', 0, 30],
  ['31 to 60 days', 31, 60],
  ['61 to 90 days', 61, 90],
  ['Over 90 days', 91, Infinity],
];
const daysBetween = (from, to) =>
  Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);

/**
 * Business summary for a period, built on the Dashboard's calculations so both always agree.
 * access: {jobs, payments, expenses, stock, customers}; sections the user cannot see are left out.
 * today: the Lagos business day used for the age of amounts owed.
 */
export function summaryReport(
  ledger,
  from,
  to,
  access = { jobs: true, payments: true, expenses: true, stock: true, customers: true },
  { compare = false, today = businessDay(new Date().toISOString()) } = {},
) {
  const base = dashboardSummary(ledger, from, to);
  const prev = compare ? dashboardSummary(ledger, base.previous.from, base.previous.to) : null;
  const figures = [];
  const add = (key, label, value, note, previous) =>
    figures.push({ key, label, value, note, previous: prev ? previous : null });
  if (access.jobs) {
    add('sales', 'Sales value', base.sales, `${base.jobs} jobs, ${base.cancelled} cancelled`, prev?.sales);
    add(
      'discounts',
      'Discounts given',
      base.discounts,
      `${base.discountedJobs} discounted jobs; sales value is after discounts`,
      prev?.discounts,
    );
  }
  if (access.payments) {
    add(
      'collected',
      'Money received',
      base.collected,
      'Customer payments dated in the period',
      prev?.collected,
    );
    add('refunded', 'Refunds paid', base.refunded, 'Money returned to customers', prev?.refunded);
    add('netCollected', 'Net collected', base.netCollected, 'Received minus refunds', prev?.netCollected);
  }
  if (access.expenses) {
    add(
      'expenseIncurred',
      'Expenses incurred',
      base.expenseIncurred,
      'Expenses dated in the period; voided excluded',
      prev?.expenseIncurred,
    );
    add(
      'expensePaid',
      'Expenses paid',
      base.expensePaid,
      'Expense payments made in the period',
      prev?.expensePaid,
    );
  }
  if (access.jobs && access.expenses)
    add(
      'netIncome',
      'Income minus expenses',
      base.netIncome,
      'Sales value minus expenses incurred',
      prev?.netIncome,
    );
  if (access.payments && access.expenses)
    add(
      'netCashFlow',
      'Money in minus money out',
      base.netCashFlow,
      'Net collected minus expenses paid; not a bank balance',
      prev?.netCashFlow,
    );
  const result = {
    from,
    to,
    today,
    compare,
    previous: prev ? { from: base.previous.from, to: base.previous.to } : null,
    figures,
    access,
  };
  if (access.payments) result.methods = base.methods;
  if (access.expenses) {
    const map = new Map();
    for (const e of ledger.expenses)
      if (!e.voided && inRange(e.incurredOn, from, to)) {
        const row = map.get(e.category) ?? { name: e.category, count: 0, amount: 0, paid: 0 };
        row.count++;
        row.amount += e.amount;
        row.paid += (e.payments ?? []).reduce((n, p) => n + p.amount, 0);
        map.set(e.category, row);
      }
    result.expenseCategories = [...map.values()].sort(
      (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
    );
    result.expenseOutstanding = base.expenseOutstanding;
  }
  if (access.jobs && access.payments) {
    // Age of money owed now, by when each job was created.
    const buckets = AGE_BUCKETS.map(([label]) => ({ label, jobs: 0, amount: 0 }));
    const debtors = new Map();
    for (const job of ledger.jobs) {
      const owed = jobBalanceFast(ledger, job).outstanding;
      if (owed <= 0) continue;
      const age = Math.max(0, daysBetween(businessDay(job.createdAt), today));
      const i = AGE_BUCKETS.findIndex(([, lo, hi]) => age >= lo && age <= hi);
      buckets[i].jobs++;
      buckets[i].amount += owed;
      const d = debtors.get(job.customerId) ?? {
        id: job.customerId,
        name: access.customers
          ? (ledger.customers.find((c) => c.id === job.customerId)?.name ?? 'Unknown customer')
          : 'Customer ' + shortId(job.customerId),
        jobs: 0,
        amount: 0,
        oldest: age,
      };
      d.jobs++;
      d.amount += owed;
      d.oldest = Math.max(d.oldest, age);
      debtors.set(job.customerId, d);
    }
    result.aging = buckets;
    result.owedTotal = buckets.reduce((n, b) => n + b.amount, 0);
    result.debtors = [...debtors.values()]
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      .slice(0, 10);
  }
  if (access.jobs) {
    const rank = (rows) =>
      [...rows].sort((a, b) => b.sales - a.sales || a.name.localeCompare(b.name)).slice(0, 10);
    result.services = rank(base.services);
    result.sources = rank(base.sources);
    if (access.customers) result.customers = rank(base.customers);
  }
  if (access.jobs) result.discounts = discountBreakdown(ledger, from, to, access.customers);
  if (access.stock) {
    const usage = new Map(
      ledger.materials
        .filter((m) => !m.archived)
        .map((m) => [
          m.id,
          {
            id: m.id,
            name: m.name,
            unit: m.measurementUnit,
            used: 0,
            wasted: 0,
            added: 0,
            now: m.available,
            minimum: m.minimumStock ?? 0,
            level: '',
          },
        ]),
    );
    for (const h of ledger.materialHistory) {
      if (!inRange(h.changedAt, from, to)) continue;
      const row = usage.get(h.materialId);
      if (!row) continue;
      const delta = (h.afterAvailable ?? 0) - (h.beforeAvailable ?? 0);
      if (
        h.action === 'material.job_used' ||
        h.action === 'material.job_corrected' ||
        h.action === 'material.sale_returned'
      )
        row.used -= delta;
      else if (h.action === 'material.wasted') row.wasted -= delta;
      else if (delta > 0) row.added += delta;
    }
    const round = (n) => Math.round(n * 1000) / 1000;
    result.materials = [...usage.values()]
      .map((r) => ({
        ...r,
        used: round(r.used),
        wasted: round(r.wasted),
        added: round(r.added),
        level:
          (r.now <= r.minimum && r.minimum > 0) || r.now < 0
            ? 'Critical'
            : r.minimum > 0 && r.now <= r.minimum * 1.2
              ? 'Near minimum'
              : 'OK',
      }))
      .filter((r) => r.used || r.wasted || r.added || r.level !== 'OK')
      .sort((a, b) => b.used - a.used || a.name.localeCompare(b.name));
  }
  return result;
}

/**
 * Discounts on jobs created in the period, by who gave them (the staff member who recorded the
 * sale) and job by job. Cancelled jobs are left out. Reasons come from the job's own discount,
 * then the whole-order discount it shared in.
 */
export function discountBreakdown(ledger, from, to, showCustomers = true) {
  const orderReasons = new Map(
    (ledger.checkouts ?? [])
      .filter((c) => c.orderDiscount?.reason)
      .map((c) => [c.id, c.orderDiscount.reason]),
  );
  const names = new Map(ledger.customers.map((c) => [c.id, c.name]));
  const jobs = ledger.jobs
    .filter(
      (j) =>
        j.productionStatus !== 'Cancelled' && (j.discountAmount ?? 0) > 0 && inRange(j.createdAt, from, to),
    )
    .map((j) => {
      const order = j.orderDiscountShare ?? 0;
      return {
        id: j.id,
        day: businessDay(j.createdAt),
        customer: showCustomers
          ? (names.get(j.customerId) ?? 'Unknown customer')
          : 'Customer ' + shortId(j.customerId ?? ''),
        service: j.service,
        givenBy: j.createdByLabel || 'Not recorded',
        price: j.grossAmount ?? j.amount + j.discountAmount,
        discount: j.discountAmount,
        kind: order && order === j.discountAmount ? 'Whole order' : order ? 'Job and whole order' : 'Job',
        reason: [j.discount?.reason, order ? orderReasons.get(j.checkoutId) : ''].filter(Boolean).join('; '),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day) || b.discount - a.discount);
  const staff = new Map();
  for (const j of jobs) {
    const row = staff.get(j.givenBy) ?? { name: j.givenBy, jobs: 0, price: 0, discount: 0 };
    row.jobs++;
    row.price += j.price;
    row.discount += j.discount;
    staff.set(j.givenBy, row);
  }
  return {
    total: jobs.reduce((n, j) => n + j.discount, 0),
    byStaff: [...staff.values()].sort((a, b) => b.discount - a.discount || a.name.localeCompare(b.name)),
    jobs,
  };
}
const percentOf = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) + '%' : '0%');

const change = (value, previous) =>
  previous === 0
    ? value === 0
      ? 'No change'
      : 'New'
    : `${value >= previous ? '+' : ''}${(((value - previous) / Math.abs(previous)) * 100).toFixed(1)}%`;
export function summarySections(summary, { money = naira, unit = ' (NGN)' } = {}) {
  const sections = [];
  const p = summary.previous;
  sections.push(
    p
      ? {
          title: 'Financial summary',
          columns: ['Figure', `This period${unit}`, `Previous period${unit}`, 'Change', 'Notes'],
          widths: [16, 11, 11, 8, 26],
          numeric: [1, 2, 3],
          rows: summary.figures.map((f) => [
            f.label,
            money(f.value),
            money(f.previous ?? 0),
            change(f.value, f.previous ?? 0),
            f.note,
          ]),
        }
      : {
          title: 'Financial summary',
          columns: ['Figure', `Amount${unit}`, 'Notes'],
          widths: [16, 12, 30],
          numeric: [1],
          rows: summary.figures.map((f) => [f.label, money(f.value), f.note]),
        },
  );
  if (summary.methods)
    sections.push({
      title: 'Collections by payment method',
      columns: ['Method', `Net collected${unit}`],
      widths: [3, 2],
      numeric: [1],
      rows: summary.methods.map((m) => [m.name, money(m.amount)]),
    });
  if (summary.expenseCategories)
    sections.push({
      title: 'Expenses by category',
      columns: ['Category', 'Expenses', `Amount${unit}`, `Paid${unit}`, `Unpaid${unit}`],
      widths: [4, 2, 3, 3, 3],
      numeric: [1, 2, 3, 4],
      rows: summary.expenseCategories.map((c) => [
        c.name,
        String(c.count),
        money(c.amount),
        money(c.paid),
        money(c.amount - c.paid),
      ]),
    });
  if (summary.aging) {
    sections.push({
      title: `Amounts owed by age (as of ${summary.today})`,
      columns: ['Age', 'Jobs', `Amount owed${unit}`],
      widths: [3, 2, 3],
      numeric: [1, 2],
      rows: [
        ...summary.aging.map((b) => [b.label, String(b.jobs), money(b.amount)]),
        ['Total', String(summary.aging.reduce((n, b) => n + b.jobs, 0)), money(summary.owedTotal)],
      ],
    });
    sections.push({
      title: 'Customers owing the most',
      columns: ['Customer', 'Jobs owing', `Amount owed${unit}`, 'Oldest (days)'],
      widths: [5, 2, 3, 2],
      numeric: [1, 2, 3],
      rows: summary.debtors.map((d) => [d.name, String(d.jobs), money(d.amount), String(d.oldest)]),
    });
  }
  const top = (title, rows) => ({
    title,
    columns: ['Name', 'Jobs', 'Quantity', `Sales${unit}`],
    widths: [6, 2, 2, 3],
    numeric: [1, 2, 3],
    rows: rows.map((r) => [r.name, String(r.jobs), String(r.quantity), money(r.sales)]),
  });
  if (summary.services) sections.push(top('Top services', summary.services));
  if (summary.customers) sections.push(top('Top customers', summary.customers));
  if (summary.sources) sections.push(top('How jobs came in', summary.sources));
  if (summary.discounts) {
    const d = summary.discounts;
    sections.push({
      title: 'Discounts by staff',
      columns: ['Given by', 'Jobs', `Price before discount${unit}`, `Discount${unit}`, 'Share of price'],
      widths: [5, 2, 3, 3, 2],
      numeric: [1, 2, 3, 4],
      rows: d.byStaff.length
        ? [
            ...d.byStaff.map((s) => [
              s.name,
              String(s.jobs),
              money(s.price),
              money(s.discount),
              percentOf(s.discount, s.price),
            ]),
            [
              'Total',
              String(d.jobs.length),
              money(d.byStaff.reduce((n, s) => n + s.price, 0)),
              money(d.total),
              percentOf(
                d.total,
                d.byStaff.reduce((n, s) => n + s.price, 0),
              ),
            ],
          ]
        : [],
    });
    sections.push({
      title: 'Discounted jobs',
      columns: [
        'Date',
        'Customer',
        'Service',
        'Given by',
        'Type',
        `Price${unit}`,
        `Discount${unit}`,
        'Reason',
      ],
      widths: [2.2, 4, 4, 3, 2.6, 2.4, 2.4, 4.4],
      numeric: [5, 6],
      rows: d.jobs.map((j) => [
        j.day,
        j.customer,
        j.service,
        j.givenBy,
        j.kind,
        money(j.price),
        money(j.discount),
        j.reason || '—',
      ]),
    });
  }
  if (summary.materials)
    sections.push({
      title: 'Materials used and stock',
      columns: ['Material', 'Unit', 'Used on jobs', 'Wasted', 'Added', 'In stock now', 'Minimum', 'Status'],
      widths: [6, 3, 2.5, 2, 2, 2.5, 2, 3],
      numeric: [2, 3, 4, 5, 6],
      rows: summary.materials.map((m) => [
        m.name,
        m.unit,
        String(m.used),
        String(m.wasted),
        String(m.added),
        String(m.now),
        String(m.minimum),
        m.level,
      ]),
    });
  return sections;
}
