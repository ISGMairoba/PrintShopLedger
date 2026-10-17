import { validDueAt } from './job-deadlines.mjs';
import { applyOrderDiscount, discountKobo, validDiscount } from './discounts.mjs';
import { packBreakdown, packTotal, usesPacks } from './pack-prices.mjs';
import { validateWorkflow, jobWorkflow } from './business-options.mjs';
import { applyCustomerEvent, phoneOwner } from './customers.mjs';
import { jobBalance, customerBalance } from './domain.mjs';
import { materialSnapshot } from './material-display.mjs';
import { checkTemplateDiscount, quoteTemplate } from './pricing-templates.mjs';
import {
  applyJobMaterial,
  choiceMaterials,
  hasMaterialChoice,
  materialChoiceFor,
  materialConfirmDue,
} from './material-choice.mjs';
export const jobStatuses = ['Added', 'In Queue', 'Printing', 'Completed', 'Collected'];
export const jobSources = ['In shop / USB', 'Shop network', 'WhatsApp', 'Email', 'Other'];
const maxMoney = 100000000000;
function amount(value, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > maxMoney)
    throw Error('Enter a valid amount with at most two decimal places.');
  return value;
}
export function units(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,3})?$/.test(text))
    throw Error('Quantities and dimensions allow up to three decimal places.');
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000)
    throw Error('Quantity and dimensions must be greater than zero and at most 1,000,000.');
  return n;
}
export const stockCountEvent = (ledger, materialId) =>
  ledger.materialHistory
    .filter((item) => item.materialId === materialId && item.action === 'material.stock_set')
    .sort((a, b) => Date.parse(b.changedAt) - Date.parse(a.changedAt) || b.id.localeCompare(a.id))[0]?.id ??
  null;
const quoteShelf = (ledger, serviceId) => !!ledger.services.find((s) => s.id === serviceId)?.shelfItem;
export function quoteLine(ledger, line) {
  if (line.templateSnapshot || ledger.pricing?.templates.some((t) => t.id === line.serviceId)) {
    const priced = quoteTemplate(ledger, line);
    if (!line.description?.trim() || line.description.trim().length > 500)
      throw Error('Enter a job description (up to 500 characters).');
    if (
      typeof line.source !== 'string' ||
      !line.source.trim() ||
      line.source.length > 80 ||
      /[\x00-\x1f\x7f]/.test(line.source) ||
      String(line.sourceNote ?? '').length > 200
    )
      throw Error('Choose how the job was received.');
    const discount = validDiscount(line.discount),
      lineDiscount = discountKobo(discount, priced.amount);
    const { shelfItem: _s, discount: _d, dueAt: rawDue, templateStockIds: _stockIds, ...rest } = line;
    const dueAt = validDueAt(rawDue);
    return {
      ...rest,
      ...priced,
      quantity: units(line.quantity),
      description: line.description.trim(),
      sourceNote: String(line.sourceNote ?? '').trim(),
      stockCountEventId: null,
      ...(line.workflow ? { workflow: validateWorkflow(line.workflow) } : {}),
      ...(dueAt ? { dueAt } : {}),
      ...(discount ? { discount } : {}),
      grossAmount: priced.amount,
      lineDiscount,
      amount: priced.amount - lineDiscount,
    };
  }
  const service = ledger.services.find((s) => s.id === line.serviceId && !s.archived);
  if (service?.private) throw Error(`${service.description} is used in templates only and cannot be sold.`);
  // A choice of materials: priced and sized like its materials, but no stock is taken now.
  const choice = hasMaterialChoice(service);
  const material = choice
    ? choiceMaterials(ledger, service)[0]
    : ledger.materials.find((m) => m.id === service?.materialId && !m.archived);
  if (!service || ((service.materialId !== null || choice) && !material))
    throw Error('Select an active service with an active base material, or a service without material.');
  if (choice && service.shelfItem)
    throw Error('Items with a choice of materials cannot be sold off the shelf.');
  if (!line.description?.trim() || line.description.trim().length > 500)
    throw Error('Enter a job description (up to 500 characters).');
  const quantity = units(line.quantity),
    width = material?.requireSize ? units(line.width) : null,
    height = material?.requireSize ? units(line.height) : null;
  let raw = BigInt(Math.round(quantity * 1000)),
    divisor = 1000n;
  if (material?.requireSize) {
    raw *= BigInt(Math.round(width * 1000)) * BigInt(Math.round(height * 1000));
    divisor = 1000000000n;
  }
  const needed = Number((raw * 1000n + divisor / 2n) / divisor) / 1000;
  // Products with pack prices are priced as packs plus loose pieces.
  const packs = usesPacks(service, material) ? packBreakdown(service.packPrices, quantity) : [];
  const total = usesPacks(service, material)
    ? packTotal(service.price, service.packPrices, quantity)
    : Number((BigInt(service.price) * raw + divisor / 2n) / divisor);
  amount(total);
  if (!Number.isFinite(needed) || needed <= 0 || needed > 1000000000000)
    throw Error('Material usage is outside the supported range.');
  if (
    typeof line.source !== 'string' ||
    !line.source.trim() ||
    line.source.length > 80 ||
    /[\x00-\x1f\x7f]/.test(line.source) ||
    String(line.sourceNote ?? '').length > 200
  )
    throw Error('Choose how the job was received.');
  // An empty deadline is left off the job rather than stored as ''.
  const {
    dueAt: rawDue,
    shelfItem: _shelf,
    discount: rawDiscount,
    grossAmount: _gross,
    lineDiscount: _line,
    orderDiscountShare: _share,
    discountAmount: _discount,
    packBreakdown: _packs,
    materialChoice: givenChoice,
    ...rest
  } = line;
  // Shelf items are handed over at the till: no deadline, no production stages.
  const shelfItem = !!service.shelfItem;
  const dueAt = shelfItem ? '' : validDueAt(rawDue);
  // The job's own discount; a whole-order discount is added by applyOrderDiscount.
  const discount = validDiscount(rawDiscount);
  const lineDiscount = discountKobo(discount, total);
  return {
    ...rest,
    ...(dueAt ? { dueAt } : {}),
    ...(discount ? { discount } : {}),
    stockCountEventId: material && !choice ? stockCountEvent(ledger, material.id) : null,
    ...(line.workflow ? { workflow: validateWorkflow(line.workflow) } : {}),
    ...(shelfItem ? { shelfItem: true } : {}),
    description: line.description.trim(),
    quantity,
    width,
    height,
    amount: total - lineDiscount,
    grossAmount: total,
    lineDiscount,
    unitPrice: service.price,
    ...(packs.length ? { packBreakdown: packs } : {}),
    service: service.description,
    materialId: choice ? null : (material?.id ?? null),
    materialNeeded: material && !choice ? needed : 0,
    ...(choice ? { materialChoice: materialChoiceFor(service, needed, givenChoice?.plannedMaterialId) } : {}),
    measurementUnit: material?.measurementUnit ?? 'item',
    requireSize: material?.requireSize ?? false,
    serviceVersion: service.version,
    sourceNote: String(line.sourceNote ?? '').trim(),
  };
}
export function walletBalance(ledger, customerId) {
  return ledger.payments
    .filter((p) => p.customerId === customerId)
    .reduce((sum, p) => sum + (p.walletAdded ?? 0) - (p.walletUsed ?? 0), 0);
}
export function accountToken(ledger, customerId) {
  return (
    'wallet=' +
    walletBalance(ledger, customerId) +
    ';' +
    ledger.jobs
      .filter((j) => j.customerId === customerId)
      .map((j) => [j.id, jobBalance(ledger, j).outstanding])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, n]) => id + ':' + n)
      .join(',')
  );
}
export function unpaidJobs(ledger, customerId) {
  return ledger.jobs
    .filter((j) => j.customerId === customerId && jobBalance(ledger, j).outstanding > 0)
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        (a.checkoutPosition ?? 0) - (b.checkoutPosition ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
export function paymentPlan(ledger, customerId, cash, useWallet, override = null) {
  amount(cash);
  const wallet = walletBalance(ledger, customerId);
  if (wallet < 0) throw Error('Wallet balance is invalid. Sync and review the account.');
  const jobs = unpaidJobs(ledger, customerId),
    debt = customerBalance(ledger, customerId);
  let allocations = [];
  if (override !== null) {
    const seen = new Set();
    for (const a of override) {
      amount(a.amount, false);
      const job = jobs.find((j) => j.id === a.jobId);
      if (!job || seen.has(a.jobId) || a.amount > jobBalance(ledger, job).outstanding)
        throw Error('Each allocation must fit an unpaid job belonging to this customer.');
      seen.add(a.jobId);
      allocations.push({ ...a });
    }
  } else {
    let remaining = Math.min(debt, cash + (useWallet ? wallet : 0));
    for (const job of jobs) {
      const n = Math.min(remaining, jobBalance(ledger, job).outstanding);
      if (n > 0) allocations.push({ jobId: job.id, amount: n });
      remaining -= n;
    }
  }
  const allocated = allocations.reduce((sum, a) => sum + a.amount, 0);
  if (allocated > cash + (useWallet ? wallet : 0))
    throw Error('Allocated amounts exceed the payment and available wallet credit.');
  const walletUsed = Math.max(0, allocated - cash),
    walletAdded = Math.max(0, cash - allocated);
  amount(wallet - walletUsed + walletAdded);
  return {
    allocations,
    allocated,
    walletUsed,
    walletAdded,
    walletAfter: wallet - walletUsed + walletAdded,
    outstandingBefore: debt,
    outstandingAfter: debt - allocated,
  };
}
export function prepareCheckout(
  ledger,
  input,
  actor,
  id = String(crypto.randomUUID()),
  now = new Date().toISOString(),
) {
  if (!actor?.id || !actor.label || !id || Number.isNaN(Date.parse(now)))
    throw Error('Checkout identity and audit information are required.');
  if (
    input.newCustomer &&
    (input.newCustomer.kind !== 'customer.created' || input.newCustomer.data.id !== input.customerId)
  )
    throw Error('New customer must match this checkout.');
  let working = ledger;
  if (input.newCustomer) working = applyCustomerEvent(working, input.newCustomer);
  const customer = working.customers.find((c) => c.id === input.customerId && !c.archived);
  if (!customer) throw Error('Select an active customer or add a new one.');
  if (!Array.isArray(input.lines) || input.lines.length > 50)
    throw Error('A checkout can contain at most 50 jobs.');
  const expectedAccount = accountToken(working, customer.id);
  const quoted = input.lines.map((line, index) => ({
    ...quoteLine(working, line),
    customerId: customer.id,
    createdAt: now,
    checkoutId: id,
    checkoutPosition: index,
    productionStatus: line.serviceId && quoteShelf(working, line.serviceId) ? 'Collected' : 'Added',
    version: 1,
    createdBy: actor.id,
    createdByLabel: actor.label,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
  }));
  // Order discount shared by price; with a policy, the giver's limits are checked here too.
  const discounts = applyOrderDiscount(quoted, input.orderDiscount, input.discountPolicy ?? null);
  const jobs = discounts.jobs;
  for (const job of jobs) checkTemplateDiscount(job);
  const ids = new Set(jobs.map((j) => j.id));
  if (
    ids.size !== jobs.length ||
    jobs.some((j) => !j.id || j.id === id || working.jobs.some((old) => old.id === j.id))
  )
    throw Error('Each job needs a unique ID.');
  working = { ...working, jobs: [...working.jobs, ...jobs] };
  const plan = paymentPlan(
    working,
    customer.id,
    input.cashReceived,
    !!input.useWallet,
    input.override ?? null,
  );
  if (!jobs.length && input.cashReceived === 0 && plan.walletUsed === 0)
    throw Error('Add a job, receive a payment or allocate wallet credit.');
  const date = new Date(input.paidOn);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn) ||
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.paidOn
  )
    throw Error('Choose a valid payment date.');
  if (!['Cash', 'POS', 'Transfer'].includes(input.method) || String(input.reference ?? '').length > 200)
    throw Error('Choose a payment method and a note up to 200 characters.');
  if (
    input.methodLabel !== undefined &&
    (typeof input.methodLabel !== 'string' ||
      !input.methodLabel.trim() ||
      input.methodLabel.length > 80 ||
      /[\x00-\x1f\x7f]/.test(input.methodLabel))
  )
    throw Error('Choose a valid payment method name.');
  if (
    input.countedMaterialJobs !== undefined &&
    (!Array.isArray(input.countedMaterialJobs) ||
      new Set(input.countedMaterialJobs).size !== input.countedMaterialJobs.length ||
      input.countedMaterialJobs.some(
        (id) => !jobs.some((job) => job.id === id && job.materialId !== null && job.stockCountEventId),
      ))
  )
    throw Error('Only jobs with a reviewed stock count can skip a stock deduction.');
  const total = jobs.reduce((sum, j) => sum + j.amount, 0);
  amount(total);
  const jobBalances = working.jobs
    .filter((j) => jobs.some((n) => n.id === j.id) || plan.allocations.some((a) => a.jobId === j.id))
    .map((j) => ({
      id: j.id,
      description: j.description,
      service: j.service,
      amount: j.amount,
      paidBefore: jobBalance(working, j).paid,
      paidThisCheckout: plan.allocations.find((a) => a.jobId === j.id)?.amount ?? 0,
      outstandingAfter:
        jobBalance(working, j).outstanding - (plan.allocations.find((a) => a.jobId === j.id)?.amount ?? 0),
    }));
  return {
    id,
    kind: 'checkout.completed',
    data: {
      id,
      customerId: customer.id,
      newCustomer: input.newCustomer ?? null,
      customerSnapshot: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
      },
      jobBalances,
      jobs,
      ...(input.countedMaterialJobs?.length ? { countedMaterialJobs: [...input.countedMaterialJobs] } : {}),
      expectedAccount,
      cashReceived: input.cashReceived,
      useWallet: !!input.useWallet,
      override: input.override ?? null,
      method: input.method,
      ...(input.methodLabel ? { methodLabel: input.methodLabel.trim() } : {}),
      paidOn: input.paidOn,
      reference: input.reference ?? '',
      createdBy: actor.id,
      createdByLabel: actor.label,
      createdAt: now,
      total,
      ...(discounts.order ? { orderDiscount: discounts.order } : {}),
      ...(discounts.discountTotal ? { discountTotal: discounts.discountTotal } : {}),
      ...plan,
    },
  };
}
export { applyJobMaterial };
export function applyCheckout(ledger, event) {
  const data = event.data;
  if ((ledger.checkouts ?? []).some((c) => c.id === data.id)) return ledger;
  const rebuilt = prepareCheckout(
    ledger,
    {
      customerId: data.customerId,
      newCustomer: data.newCustomer,
      lines: data.jobs,
      countedMaterialJobs: data.countedMaterialJobs,
      cashReceived: data.cashReceived,
      useWallet: data.useWallet,
      override: data.override,
      method: data.method,
      ...(data.methodLabel ? { methodLabel: data.methodLabel } : {}),
      paidOn: data.paidOn,
      reference: data.reference,
      orderDiscount: data.orderDiscount ?? null,
    },
    { id: data.createdBy, label: data.createdByLabel },
    data.id,
    data.createdAt,
  );
  for (let index = 0; index < data.jobs.length; index++)
    if (
      data.jobs[index].templateSnapshot &&
      JSON.stringify(data.jobs[index].templateSnapshot) !==
        JSON.stringify(rebuilt.data.jobs[index].templateSnapshot)
    )
      throw Error('Template price, inputs or stock count changed. Review the checkout.');
  for (let index = 0; index < data.jobs.length; index++)
    for (const key of [
      'amount',
      'unitPrice',
      'materialNeeded',
      'materialId',
      'requireSize',
      'serviceVersion',
    ])
      if (data.jobs[index][key] !== rebuilt.data.jobs[index][key])
        throw Error('Job price or material changed. Review the checkout.');
  for (let index = 0; index < data.jobs.length; index++)
    if (
      JSON.stringify(data.jobs[index].materialChoice ?? null) !==
      JSON.stringify(rebuilt.data.jobs[index].materialChoice ?? null)
    )
      throw Error('The materials for this service changed. Review the checkout.');
  for (let index = 0; index < data.jobs.length; index++)
    if ((data.jobs[index].stockCountEventId ?? null) !== (rebuilt.data.jobs[index].stockCountEventId ?? null))
      throw Error('Stock count changed. Supervisor review is required before deducting these materials.');
  if (data.expectedAccount !== rebuilt.data.expectedAccount)
    throw Error('The customer account changed. Review the latest balances.');
  for (const key of [
    'total',
    'walletUsed',
    'walletAdded',
    'walletAfter',
    'outstandingBefore',
    'outstandingAfter',
  ])
    if (data[key] !== rebuilt.data[key]) throw Error('Checkout amounts changed. Review the checkout.');
  if (JSON.stringify(data.allocations) !== JSON.stringify(rebuilt.data.allocations))
    throw Error('Checkout allocations changed.');
  let next = data.newCustomer ? applyCustomerEvent(ledger, data.newCustomer) : ledger;
  const materials = next.materials.map((m) => ({ ...m })),
    history = [...next.materialHistory];
  for (const job of rebuilt.data.jobs) {
    const usages = job.templateSnapshot
      ? job.templateSnapshot.stock.map((s) => ({
          materialId: s.materialId,
          materialNeeded: s.quantity,
          stockEventId: s.stockEventId,
        }))
      : [{ ...job, stockEventId: job.id }];
    for (const usage of usages) {
      if (usage.materialId === null || usage.materialNeeded === 0) continue;
      const material = materials.find((m) => m.id === usage.materialId);
      const before = materialSnapshot(material),
        available =
          Math.round(
            (material.available -
              ((data.countedMaterialJobs ?? []).includes(job.id) ? 0 : usage.materialNeeded)) *
              1000,
          ) / 1000;
      if (Math.abs(available) > 1000000000000) throw Error('Material stock is outside the supported range.');
      const previous = material.available;
      Object.assign(material, {
        available,
        version: material.version + 1,
        modifiedBy: data.createdBy,
        modifiedByLabel: data.createdByLabel,
        modifiedAt: data.createdAt,
        lastEventId: usage.stockEventId,
      });
      history.push({
        id: usage.stockEventId,
        materialId: material.id,
        materialName: material.name,
        measurementUnit: material.measurementUnit,
        action: 'material.job_used',
        beforeAvailable: previous,
        afterAvailable: available,
        reason:
          'Checkout ' +
          data.id +
          ' / Job ' +
          job.id +
          ((data.countedMaterialJobs ?? []).includes(job.id) ? ' · Already included in physical count' : ''),
        jobId: job.id,
        checkoutId: data.id,
        changedBy: data.createdBy,
        changedByLabel: data.createdByLabel,
        changedAt: data.createdAt,
        before,
        after: materialSnapshot(material),
        detailsComplete: true,
      });
    }
  }
  const payment =
    data.cashReceived > 0 || data.walletUsed > 0
      ? {
          id: data.id,
          checkoutId: data.id,
          customerId: data.customerId,
          amount: data.cashReceived,
          walletUsed: data.walletUsed,
          walletAdded: data.walletAdded,
          method: data.method,
          ...(data.methodLabel ? { methodLabel: data.methodLabel } : {}),
          paidOn: data.paidOn,
          reference: data.reference,
          allocations: data.allocations,
          createdAt: data.createdAt,
        }
      : null;
  return {
    ...next,
    materials,
    materialHistory: history,
    jobs: [...next.jobs, ...rebuilt.data.jobs],
    payments: payment ? [...next.payments, payment] : next.payments,
    checkouts: [...(next.checkouts ?? []), rebuilt.data],
  };
}
export function applyJobStatus(ledger, event) {
  const data = event.data,
    job = ledger.jobs.find((j) => j.id === data.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if (
    (job.version ?? 1) !== data.baseVersion ||
    data.status !== jobWorkflow(job)[jobWorkflow(job).indexOf(job.productionStatus ?? 'Added') + 1]
  )
    throw Error('Review the latest job status before proceeding.');
  if (materialConfirmDue(job, data.status))
    throw Error('Confirm the material used for this job before moving it on.');
  const next = {
    ...job,
    version: (job.version ?? 1) + 1,
    productionStatus: data.status,
    modifiedBy: data.modifiedBy,
    modifiedByLabel: data.modifiedByLabel,
    modifiedAt: data.modifiedAt,
    lastEventId: event.id,
  };
  return { ...ledger, jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)) };
}

/**
 * Why a customer added offline with a checkout can no longer be created against the current
 * ledger (for example, its phone number now belongs to another customer), or null if it can.
 * The owner is the existing customer with the same phone number, when there is one.
 * @param {import('./types').Ledger} ledger
 * @param {import('./types').CustomerEvent | null} event
 * @returns {{ message: string, owner: import('./types').Customer | null } | null}
 */
export function offlineCustomerClash(ledger, event) {
  if (!event || ledger.customers.some((c) => c.id === event.data.id)) return null;
  try {
    applyCustomerEvent(ledger, event);
    return null;
  } catch (cause) {
    return {
      message: cause instanceof Error ? cause.message : String(cause),
      owner: phoneOwner(ledger.customers, event.data.phone ?? '', event.data.id),
    };
  }
}
