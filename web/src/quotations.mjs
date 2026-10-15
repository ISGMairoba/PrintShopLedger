// Quotations: priced offers for a customer. Saving one never touches stock, jobs or money.
// "Create order" opens a normal checkout filled from the quotation; once that sale is saved the
// quotation is marked converted and linked to it. Prices are worked out with the same rules as
// checkout (quantity, size, discounts), using the service prices at the time the quote is saved.
import { quoteLine } from './checkout.mjs';
import { applyOrderDiscount } from './discounts.mjs';
import { normalizeLedger } from './materials.mjs';
import { receiptBusiness, validLogo } from './business-branding.mjs';
import { currency, discountLines } from './receipts.mjs';
import { renameTerms } from './terms.mjs';
import { checkTemplateDiscount, templateSpecLines } from './pricing-templates.mjs';

export const quotationRef = (id) => 'Q-' + String(id).replace(/-/g, '').slice(0, 8).toUpperCase();
const lagosDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const addDays = (day, days) => {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The default "valid until": two weeks from today (Lagos). */
export const defaultValidUntil = (now = new Date().toISOString(), days = 14) => addDays(lagosDay(now), days);

/**
 * 'open', 'expired' (open but past its date), 'converted' or 'archived'.
 * @param {{ status?: string, validUntil: string }} quote
 * @returns {'open' | 'expired' | 'converted' | 'archived'}
 */
export function quotationState(quote, now = new Date().toISOString()) {
  if (quote.status === 'open' && quote.validUntil < lagosDay(now)) return 'expired';
  return /** @type {'open' | 'converted' | 'archived'} */ (quote.status ?? 'open');
}
export const stateLabels = { open: 'Open', expired: 'Expired', converted: 'Converted', archived: 'Archived' };

/**
 * Price the lines with today's services. Lines: { id, serviceId, description, quantity, width?,
 * height?, discount? }. With a policy, discounts are checked against the person's limits.
 */
/**
 * @param {any} ledger
 * @param {any[]} lines
 * @param {unknown} [orderDiscount]
 * @param {{ maxPercent: number, canFlat: boolean } | null} [policy]
 */
export function priceQuotation(ledger, lines, orderDiscount = null, policy = null) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 50)
    throw Error('Add 1 to 50 items to the quotation.');
  const quoted = lines.map((line) => {
    if (!line.id) throw Error('Each item needs an ID.');
    return quoteLine(ledger, { ...line, source: 'Quotation', sourceNote: '', dueAt: '' });
  });
  const priced = applyOrderDiscount(quoted, orderDiscount, policy);
  for (const job of priced.jobs) checkTemplateDiscount(job);
  const out = priced.jobs.map((j, index) => ({
    id: lines[index].id,
    serviceId: lines[index].serviceId,
    service: j.service,
    description: j.description,
    quantity: j.quantity,
    width: j.width,
    height: j.height,
    measurementUnit: j.measurementUnit,
    requireSize: j.requireSize,
    ...(j.discount ? { discount: j.discount } : {}),
    unitPrice: j.unitPrice,
    grossAmount: j.grossAmount ?? j.amount,
    lineDiscount: j.lineDiscount ?? 0,
    orderDiscountShare: j.orderDiscountShare ?? 0,
    discountAmount: j.discountAmount ?? 0,
    amount: j.amount,
    ...(j.templateSnapshot ? { templateInputs: j.templateInputs, templateSnapshot: j.templateSnapshot } : {}),
  }));
  const subtotal = out.reduce((n, l) => n + l.grossAmount, 0),
    total = out.reduce((n, l) => n + l.amount, 0);
  return { lines: out, orderDiscount: priced.order, subtotal, discountTotal: subtotal - total, total };
}

const day = /^\d{4}-\d{2}-\d{2}$/;
const cleanText = (value, max, label) => {
  const text = String(value ?? '').trim();
  if (text.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
    throw Error(`${label} must be up to ${max} characters.`);
  return text;
};

/**
 * Build a quotation save. input: { id?, baseVersion?, customerId?, customerName, customerPhone,
 * lines, orderDiscount, validUntil, note }. With a customer, the name and phone come from them.
 */
/**
 * @param {any} ledger
 * @param {any} input
 * @param {{ id: string, label: string }} actor
 * @param {{ maxPercent: number, canFlat: boolean } | null} [policy]
 * @param {string} [now]
 */
export function prepareQuotation(ledger, input, actor, policy = null, now = new Date().toISOString()) {
  if (!actor?.id || !actor.label) throw Error('Sign in before saving a quotation.');
  const customer = input.customerId
    ? ledger.customers.find((c) => c.id === input.customerId && !c.archived)
    : null;
  if (input.customerId && !customer) throw Error('Choose an active customer, or type a name instead.');
  const customerName = cleanText(customer?.name ?? input.customerName, 160, 'Customer name');
  if (!customerName) throw Error('Choose a customer or type the customer’s name.');
  const customerPhone = cleanText(customer?.phone ?? input.customerPhone, 40, 'Phone');
  const note = cleanText(input.note, 1000, 'Note');
  if (!day.test(input.validUntil ?? '') || Number.isNaN(Date.parse(input.validUntil)))
    throw Error('Choose the date the quotation is valid until.');
  const priced = priceQuotation(ledger, input.lines, input.orderDiscount, policy);
  const id = input.id ?? crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    kind: 'quotation.saved',
    data: {
      id,
      ...(input.baseVersion ? { baseVersion: input.baseVersion } : {}),
      customerId: customer?.id ?? null,
      customerName,
      customerPhone,
      ...priced,
      validUntil: input.validUntil,
      note,
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/** Apply a quotation event to the local ledger (mirrors the server). */
export function applyQuotationEvent(input, event) {
  const ledger = normalizeLedger(input);
  const d = event.data;
  if (!event.id || !d?.id || !d.modifiedBy || !d.modifiedAt) throw Error('Quotation identity is required.');
  const old = ledger.quotations.find((q) => q.id === d.id);
  if (old?.lastEventId === event.id) return ledger;
  const audit = {
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel ?? d.modifiedBy,
    modifiedAt: d.modifiedAt,
    lastEventId: event.id,
  };
  let next;
  if (event.kind === 'quotation.saved') {
    if (!Array.isArray(d.lines) || !d.lines.length || d.lines.length > 50)
      throw Error('A quotation needs 1 to 50 items.');
    const sum = d.lines.reduce((n, l) => n + l.amount, 0);
    if (sum !== d.total || d.total !== d.subtotal - d.discountTotal)
      throw Error('Quotation totals do not add up.');
    const { baseVersion: _base, ...fields } = d;
    next = {
      ...old,
      ...fields,
      orderDiscount: d.orderDiscount ?? null,
      status: old?.status ?? 'open',
      version: (old?.version ?? 0) + 1,
      createdBy: old?.createdBy ?? d.modifiedBy,
      createdByLabel: old?.createdByLabel ?? audit.modifiedByLabel,
      createdAt: old?.createdAt ?? d.modifiedAt,
      ...audit,
    };
  } else if (['quotation.archived', 'quotation.restored', 'quotation.converted'].includes(event.kind)) {
    if (!old) throw Error('Quotation not found.');
    const status =
      event.kind === 'quotation.converted' || old.status === 'converted'
        ? 'converted'
        : event.kind === 'quotation.archived'
          ? 'archived'
          : 'open';
    next = { ...old, ...audit, status, version: old.version + 1 };
    if (event.kind === 'quotation.converted') {
      if (!d.checkoutId) throw Error('Converted quotation needs its checkout.');
      next.checkoutId = old.checkoutId ?? d.checkoutId;
      next.convertedAt = old.convertedAt ?? d.modifiedAt;
      next.convertedByLabel = old.convertedByLabel ?? audit.modifiedByLabel;
    }
  } else throw Error('Unknown quotation operation.');
  return {
    ...ledger,
    quotations: old ? ledger.quotations.map((q) => (q.id === d.id ? next : q)) : [...ledger.quotations, next],
  };
}

/**
 * What checkout starts with for "Create order": the customer (or a new-customer draft) and the
 * lines, plus any lines whose price changed since the quote.
 */
export function quotationCheckout(ledger, quote) {
  const customer = quote.customerId
    ? ledger.customers.find((c) => c.id === quote.customerId && !c.archived)
    : (ledger.customers.find((c) => !c.archived && quote.customerPhone && c.phone === quote.customerPhone) ??
      null);
  const changes = [];
  const lines = quote.lines.map((l) => {
    const service = ledger.services.find((s) => s.id === l.serviceId);
    if (l.templateSnapshot) {
      try {
        const priced = quoteLine(ledger, {
          ...l,
          source: 'Quotation',
          templateStockIds: Object.fromEntries(
            l.templateSnapshot.stock.map((s) => [s.materialId, crypto.randomUUID()]),
          ),
        });
        if (
          priced.grossAmount !== l.grossAmount ||
          JSON.stringify(priced.templateSnapshot.template) !== JSON.stringify(l.templateSnapshot.template)
        )
          changes.push(`${l.description}: the template or its costs changed; review the new total.`);
      } catch (e) {
        changes.push(`${l.description}: ${e.message}`);
      }
    } else if (!service || service.archived)
      changes.push(`${l.description}: ${l.service} is no longer available`);
    else if (service.price !== l.unitPrice)
      changes.push(
        `${l.description}: price changed from ${currency(l.unitPrice)} to ${currency(service.price)}`,
      );
    return {
      serviceId: l.serviceId,
      description: l.description,
      quantity: l.quantity,
      width: l.width,
      height: l.height,
      ...(l.discount ? { discount: l.discount } : {}),
      ...(l.templateSnapshot
        ? { templateInputs: l.templateInputs, templateSnapshot: l.templateSnapshot }
        : {}),
    };
  });
  return {
    customerId: customer?.id ?? '',
    newCustomer: customer ? null : { name: quote.customerName, phone: quote.customerPhone },
    lines,
    orderDiscount: quote.orderDiscount ?? null,
    changes,
  };
}

const longDate = (value) =>
  new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

/** The quotation laid out like a receipt, so the same PDF and print layouts can draw it. */
export function quotationModel(quote, business, layout = 'page', now = new Date().toISOString()) {
  const b = receiptBusiness(business, layout === 'roll' ? 'roll' : 'page'),
    o = layout === 'roll' ? b.receipt : b.receiptPage;
  const state = quotationState(quote, now);
  const items = quote.lines.map((l) => ({
    id: l.id,
    ref: '',
    description: l.description,
    service: l.service,
    title: l.description,
    subtitle: l.service !== l.description ? l.service : '',
    meta: [
      `Qty ${l.quantity}`,
      l.requireSize && l.width && l.height ? `Size ${l.width} × ${l.height}` : '',
      ...templateSpecLines(l),
      `${currency(l.unitPrice)} each`,
      ...discountLines(l),
    ].filter(Boolean),
    details: [],
    amount: currency(l.amount),
    paidBefore: '',
    paidNow: '',
    balance: '',
    ok: true,
  }));
  const totals = [];
  if (quote.discountTotal > 0) {
    totals.push({ label: 'Subtotal', value: currency(quote.subtotal) });
    const reason = quote.orderDiscount?.reason;
    totals.push({
      label: reason ? `Discount (${reason})` : 'Discount',
      value: `-${currency(quote.discountTotal)}`,
    });
  }
  totals.push({ label: 'Total', value: currency(quote.total), strong: true });
  const notices = [];
  if (state === 'expired') notices.push(`This quotation expired on ${longDate(quote.validUntil)}`);
  if (state === 'archived') notices.push('This quotation was withdrawn');
  const meta = [
    ['Quotation no.', quotationRef(quote.id)],
    ['Date', longDate(quote.modifiedAt ?? quote.createdAt)],
    ['Valid until', longDate(quote.validUntil)],
    ['Customer', quote.customerName],
    quote.customerPhone ? ['Phone', quote.customerPhone] : null,
    ['Prepared by', quote.modifiedByLabel ?? quote.createdByLabel],
  ].filter(Boolean);
  return {
    business: {
      name: o.showBusinessName || !(o.showLogo && b.logo && validLogo(b.logo)) ? b.businessName : '',
      logo: o.showLogo && b.logo && validLogo(b.logo) ? b.logo : '',
      address: o.showAddress ? b.address : '',
      contacts: o.showContacts ? [b.phones, b.email, b.website, b.socials].filter(Boolean) : [],
      primary: b.primary || '#124b40',
      accent: b.accent || '#d9a126',
    },
    title: 'Quotation',
    itemHeading: renameTerms('Item', b.terms),
    number: quotationRef(quote.id),
    date: longDate(quote.modifiedAt ?? quote.createdAt),
    paidOn: '',
    customer: { name: quote.customerName, phone: quote.customerPhone },
    cashier: quote.modifiedByLabel ?? '',
    method: '',
    meta,
    show: { paidNow: false, balance: false, paidBefore: false },
    notices,
    items,
    totals,
    account: [],
    note: quote.note ?? '',
    adjustments: [],
    footer: `Prices are valid until ${longDate(quote.validUntil)}.${o.footer ? ' ' + o.footer : ''}`,
  };
}
