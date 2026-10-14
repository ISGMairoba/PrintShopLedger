// A client comparison as a document: each priced option of one template, with only the details the
// client may see. Drawn by the same PDF code as quotations (A4, A5 or any page size).
import { receiptBusiness, validLogo } from './business-branding.mjs';
import { currency } from './receipts.mjs';
import { computedSpecs, valueLabel } from './pricing-templates.mjs';
import { renameTerms } from './terms.mjs';

const longDate = (value) =>
  new Date(value).toLocaleDateString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
/** A short reference for the document, e.g. CMP-6F2A91C4. */
export const comparisonRef = (seed = crypto.randomUUID()) =>
  'CMP-' + String(seed).replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * template: the pricing template. rows: [{ inputs (incl. quantity), amount (kobo), unit (kobo) }].
 * details: { customerName, customerPhone, preparedBy, note, ref, now, groupBy }. With groupBy (a
 * variable key), rows should already be in group order; each group gets a title.
 */
export function comparisonModel(template, rows, business, details = {}) {
  if (!rows.length || rows.some((r) => r.amount === undefined))
    throw Error('Compare prices first, and fix any option that cannot be priced.');
  const b = receiptBusiness(business),
    o = b.receiptPage;
  const now = details.now ?? new Date().toISOString();
  const ref = details.ref ?? comparisonRef();
  const visible = template.variables.filter((v) => v.clientVisible !== false);
  const group = details.groupBy ? template.variables.find((v) => v.key === details.groupBy) : null;
  const sizes = new Map();
  if (group) for (const r of rows) sizes.set(r.inputs[group.key], (sizes.get(r.inputs[group.key]) ?? 0) + 1);
  const items = rows.map((r, n) => ({
    ...(group && (n === 0 || rows[n - 1].inputs[group.key] !== r.inputs[group.key])
      ? {
          heading: `${group.label}: ${valueLabel(group, r.inputs[group.key])} · ${sizes.get(r.inputs[group.key])} option${sizes.get(r.inputs[group.key]) === 1 ? '' : 's'}`,
        }
      : {}),
    id: String(n),
    ref: '',
    description: `Option ${n + 1}`,
    service: template.name,
    title: `Option ${n + 1}`,
    subtitle: template.name,
    meta: [
      ...visible.map((v) => `${v.label}: ${valueLabel(v, r.inputs[v.key])}`),
      ...computedSpecs(template, r.outputs, true).map((s) => `${s.label}: ${s.value}`),
      `${currency(r.unit)} each`,
    ],
    details: [],
    amount: currency(r.amount),
    paidBefore: '',
    paidNow: '',
    balance: '',
    ok: true,
  }));
  const meta = [
    ['Reference', ref],
    ['Date', longDate(now)],
    details.customerName ? ['Customer', details.customerName] : null,
    details.customerPhone ? ['Phone', details.customerPhone] : null,
    details.preparedBy ? ['Prepared by', details.preparedBy] : null,
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
    title: 'Price options',
    itemHeading: renameTerms('Option', b.terms),
    number: ref,
    date: longDate(now),
    paidOn: '',
    customer: { name: details.customerName ?? '', phone: details.customerPhone ?? '' },
    cashier: details.preparedBy ?? '',
    method: '',
    meta,
    show: { paidNow: false, balance: false, paidBefore: false },
    notices: [`${rows.length} options for ${template.name}. Choose one: prices are not added together.`],
    items,
    totals: [],
    account: [],
    note: details.note ?? '',
    adjustments: [],
    footer: `Prices are for the options shown and may change.${o.footer ? ' ' + o.footer : ''}`,
  };
}

/** The message sent with a shared comparison. */
export const comparisonMessage = (template, rows, businessName) =>
  `${businessName ? businessName + ': ' : ''}price options for ${template.name} (${rows.length} options). The PDF is attached.`;
