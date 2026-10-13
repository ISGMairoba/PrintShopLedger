import { paymentName } from './business-options.mjs';
import { templateSpecLines } from './pricing-templates.mjs';
import { escapeHtml } from './print-settings.mjs';
import { receiptBusiness, validLogo } from './business-branding.mjs';
import { renameTerms } from './terms.mjs';
export const currency = (n) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(n / 100);
const validMoney = (n) => Number.isSafeInteger(n) && n >= 0;
export function balancedReceiptJob(job) {
  return (
    [job.amount, job.paidBefore, job.paidThisCheckout, job.outstandingAfter].every(validMoney) &&
    job.amount === job.paidBefore + job.paidThisCheckout + job.outstandingAfter
  );
}
export function balancedReceiptTotal(record) {
  return (
    validMoney(record.total) &&
    (record.jobs ?? []).every((job) => validMoney(job.amount)) &&
    record.total === (record.jobs ?? []).reduce((sum, job) => sum + job.amount, 0)
  );
}
export function receiptIntegrityError(record) {
  if ((record.jobBalances ?? []).some((job) => !balancedReceiptJob(job)))
    return 'Receipt amounts do not match the saved payment breakdown. Sync and verify this receipt before printing.';
  if (!balancedReceiptTotal(record))
    return 'Receipt job total does not match its saved jobs. Sync and verify this receipt before printing.';
  return '';
}
const shortRef = (id) =>
  String(id ?? '')
    .slice(0, 8)
    .toUpperCase();
const lagos = (value) =>
  new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const adjustmentNames = {
  'sale.combined_corrected': 'Job and payments corrected',
  'sale.details_corrected': 'Job details corrected',
  'payment.corrected': 'Payment corrected',
  'sale.corrected': 'Sale corrected',
  'sale.cancelled': 'Sale cancelled',
  'sale.refunded': 'Customer refunded',
};

const percent = (value) => `${Number(value).toLocaleString('en-NG', { maximumFractionDigits: 2 })}%`;
/**
 * A discounted job's price and discount, in plain words for the receipt. Printed text uses a plain
 * hyphen for minus: receipt fonts and printers may not have the − sign.
 */
export function discountLines(item) {
  if (!(item?.discountAmount > 0)) return [];
  const share = item.orderDiscountShare ?? 0;
  const own = item.lineDiscount ?? item.discountAmount - share;
  return [
    `Price ${currency(item.grossAmount ?? item.amount + item.discountAmount)}`,
    own > 0
      ? `Discount ${item.discount?.kind === 'percent' ? `${percent(item.discount.value)} ` : ''}-${currency(own)}`
      : '',
    share > 0 ? `Order discount -${currency(share)}` : '',
  ].filter(Boolean);
}

/**
 * Everything a receipt shows, in display order, independent of where it is printed.
 * What appears and which line leads each job follow the business's receipt settings.
 * Amounts that fail the integrity checks are replaced by "Needs verification" and never shown as confirmed.
 */
export function receiptModel(record, business, pending = false, adjustments = [], layout = 'page') {
  adjustments = adjustments.filter(
    (item) => !item.groupId || !adjustments.some((parent) => parent.id === item.groupId),
  );
  const b = receiptBusiness(business),
    // Receipt printers (roll) and full pages each have their own content settings.
    o = layout === 'roll' ? b.receipt : b.receiptPage,
    c = record.customerSnapshot;
  const balancedTotal = balancedReceiptTotal(record);
  const balances = record.jobBalances ?? [];
  const allBalanced = balances.every(balancedReceiptJob);
  const show = { paidNow: o.showPaidNow, balance: o.showItemBalance, paidBefore: o.showPaidBefore };
  const items = balances.map((j) => {
    const item = (record.jobs ?? []).find((n) => n.id === j.id);
    const ok = balancedReceiptJob(j);
    const [title, other] = o.headline === 'service' ? [j.service, j.description] : [j.description, j.service];
    const meta = [
      o.showJobId ? (j.ref ?? shortRef(j.id)) : '',
      o.showQuantity && item?.quantity !== undefined && item?.quantity !== null ? `Qty ${item.quantity}` : '',
      o.showSize && item?.requireSize ? `Size ${item.width} × ${item.height}` : '',
      ...templateSpecLines(item),
      o.showSource && item?.source
        ? `Received: ${item.source}${item.sourceNote ? ' — ' + item.sourceNote : ''}`
        : '',
      o.showDueDate && item?.dueAt && !Number.isNaN(Date.parse(item.dueAt)) ? `Due ${lagos(item.dueAt)}` : '',
      ...discountLines(item),
    ].filter(Boolean);
    return {
      id: j.id,
      ref: shortRef(j.id),
      description: j.description,
      service: j.service,
      title,
      subtitle: o.showSubline && other && other !== title ? other : '',
      meta,
      details: meta,
      amount: ok ? currency(j.amount) : 'Needs verification',
      paidBefore: show.paidBefore && ok && j.paidBefore ? currency(j.paidBefore) : '',
      paidNow: show.paidNow ? currency(j.paidThisCheckout) : '',
      balance: show.balance ? currency(j.outstandingAfter) : '',
      ok,
    };
  });
  const totals = [];
  // With discounts: price before discounts, the discount, then what the new jobs cost.
  if (record.discountTotal > 0 && balancedTotal) {
    totals.push({ label: 'Subtotal', value: currency(record.total + record.discountTotal) });
    const reason = record.orderDiscount?.reason;
    totals.push({
      label: reason ? `Discount (${reason})` : 'Discount',
      value: `-${currency(record.discountTotal)}`,
    });
  }
  if ((record.jobs ?? []).length)
    totals.push({
      label: renameTerms(record.discountTotal > 0 ? 'Total for new jobs' : 'New jobs', b.terms),
      value: balancedTotal ? currency(record.total) : 'Needs verification',
    });
  totals.push({
    label: o.showPaymentMethod ? `Paid now (${paymentName(record)})` : 'Paid now',
    value: currency(record.cashReceived),
    strong: true,
  });
  if (o.showWalletMovements && record.walletUsed)
    totals.push({ label: 'Wallet used', value: currency(record.walletUsed) });
  if (o.showWalletMovements && record.walletAdded)
    totals.push({ label: 'Added to wallet', value: currency(record.walletAdded) });
  if (show.balance && balances.length && allBalanced)
    totals.push({
      label: renameTerms('Balance on these jobs', b.terms),
      value: currency(balances.reduce((n, j) => n + j.outstandingAfter, 0)),
      strong: true,
    });
  const account = o.showAccountBalances
    ? [
        { label: 'Customer outstanding', value: currency(record.outstandingAfter) },
        { label: 'Wallet balance', value: currency(record.walletAfter) },
      ]
    : [];
  const notices = [];
  if (record.corrected)
    notices.push(renameTerms('Corrected receipt — current job and payment balances', b.terms));
  else if (adjustments.length) notices.push('Original receipt — later adjustments listed below');
  if (pending) notices.push('Pending confirmation — saved on this device');
  const contacts = o.showContacts ? [b.phones, b.email, b.website, b.socials].filter(Boolean) : [];
  const meta = [
    ['Receipt no.', shortRef(record.id)],
    ['Date', lagos(record.createdAt)],
    ['Customer', c?.name ?? record.customerId],
    o.showCustomerPhone && c?.phone ? ['Phone', c.phone] : null,
    o.showCashier ? ['Cashier', record.createdByLabel] : null,
    o.showPaymentDate ? ['Payment date', record.paidOn] : null,
  ].filter(Boolean);
  return {
    business: {
      // A wordmark logo can stand in for the name; the name always shows when there is no logo.
      name: o.showBusinessName || !(o.showLogo && b.logo && validLogo(b.logo)) ? b.businessName : '',
      logo: o.showLogo && b.logo && validLogo(b.logo) ? b.logo : '',
      address: o.showAddress ? b.address : '',
      contacts,
      primary: b.primary || '#124b40',
      accent: b.accent || '#d9a126',
    },
    title: record.corrected ? 'Corrected receipt' : 'Receipt',
    /** Heading for the item lines: "Job", or the business's word for it. */
    itemHeading: renameTerms('Job', b.terms),
    number: shortRef(record.id),
    date: lagos(record.createdAt),
    paidOn: record.paidOn,
    customer: { name: c?.name ?? record.customerId, phone: o.showCustomerPhone ? (c?.phone ?? '') : '' },
    cashier: o.showCashier ? record.createdByLabel : '',
    method: paymentName(record),
    meta,
    show,
    notices,
    items,
    totals,
    account,
    note: o.showNote ? record.reference || '' : '',
    adjustments: adjustments.map((a) => ({
      ref: shortRef(a.id),
      label: renameTerms(adjustmentNames[a.action] ?? a.action.replace('sale.', ''), b.terms),
      job: shortRef(a.jobId),
      lines: [
        `Charge: ${currency(a.before.amount)} → ${currency(a.after.amount)}`,
        `Quantity: ${a.before.quantity ?? '—'} → ${a.after.quantity ?? '—'}`,
        `Size: ${a.before.width ?? '—'} × ${a.before.height ?? '—'} → ${a.after.width ?? '—'} × ${a.after.height ?? '—'}`,
        `Service: ${a.before.service} → ${a.after.service}`,
        ...a.paymentChanges.map(
          (p) =>
            `Payment: ${p.before.methodLabel ?? p.before.method} ${currency(p.before.amount)} → ${p.after.methodLabel ?? p.after.method} ${currency(p.after.amount)}`,
        ),
        `Credit released: ${currency(a.creditReleased)}`,
        `Money refunded: ${currency(a.refundAmount)}${a.refundAmount ? ` (${a.methodLabel ?? a.method})` : ''}`,
        `Material returned: ${a.returnQuantity}`,
        `Reason: ${a.reason}`,
        `Approved by: ${a.changedByLabel} · ${lagos(a.changedAt)}`,
      ],
    })),
    footer: o.footer || '',
  };
}

const safeColour = (value) => (/^#[0-9a-f]{6}$/i.test(value) ? value : '#124b40');
/**
 * Receipt markup for the screen preview. layout 'narrow' mirrors the till-roll print; 'wide' the page print.
 * Long text wraps (overflow-wrap) instead of running past the edge. All values are escaped.
 */
export function receiptHtml(record, business, pending = false, adjustments = [], { layout = 'wide' } = {}) {
  const m = receiptModel(record, business, pending, adjustments, layout === 'narrow' ? 'roll' : 'page'),
    e = escapeHtml;
  const brand = safeColour(m.business.primary);
  const row = (label, value, cls = '') =>
    `<tr class="${cls}"><td>${e(label)}</td><td class="r">${e(value)}</td></tr>`;
  const logo = m.business.logo ? `<img class="logo" src="${e(m.business.logo)}" alt="Business logo"/>` : '';
  const contact = [m.business.address, ...m.business.contacts].filter(Boolean).map(e).join('<br>');
  const notices = m.notices.map((n) => `<p class="notice"><strong>${e(n)}</strong></p>`).join('');
  const adjustmentsHtml = m.adjustments.length
    ? `<h3>Later adjustments</h3>${m.adjustments.map((a) => `<p class="adj"><strong>${e(a.label)} · ${e(a.ref)}</strong><br>${e(m.itemHeading ?? 'Job')}: ${e(a.job)}<br>${a.lines.map(e).join('<br>')}</p>`).join('')}`
    : '';
  const sub = (i) => [i.subtitle, ...i.meta].filter(Boolean).map(e).join(' · ');
  const totals = m.totals
    .map((t, k) =>
      row(t.label, t.value, k === m.totals.length - 1 && t.strong ? 'total' : t.strong ? 'strong' : ''),
    )
    .join('');
  if (layout === 'narrow') {
    const css = `.psl-r{font-size:1em;line-height:1.35;color:#000;width:100%;overflow-wrap:anywhere}.psl-r *{box-sizing:border-box}.psl-r .r{text-align:right;white-space:nowrap;padding-left:6px}.psl-r .logo{display:block;margin:0 auto 4px;max-width:64%;max-height:22mm}.psl-r h1{font-size:1.35em;margin:2px 0;text-align:center;text-transform:uppercase;letter-spacing:.5px}.psl-r .contact{font-size:.82em;text-align:center;margin:0 0 4px}.psl-r .title{text-align:center;font-weight:bold;font-size:1.1em;letter-spacing:2px;border-top:2px solid #000;border-bottom:2px solid #000;padding:3px 0;margin:6px 0}.psl-r table{width:100%;border-collapse:collapse}.psl-r td{padding:1px 0;vertical-align:top;border:0}.psl-r .meta td{font-size:.9em}.psl-r .rule{border-top:1px dashed #000;margin:5px 0}.psl-r .item-name{font-weight:bold;padding-top:4px}.psl-r .item-sub{font-size:.82em}.psl-r .amt td{font-size:.92em}.psl-r .strong td{font-weight:bold}.psl-r .total td{font-weight:bold;font-size:1.15em;border-top:2px solid #000;padding-top:3px}.psl-r .notice{border:1px solid #000;padding:3px;text-align:center;font-size:.85em;margin:4px 0}.psl-r h3{font-size:.95em;margin:6px 0 2px;text-transform:uppercase}.psl-r .adj{font-size:.8em;margin:3px 0}.psl-r .foot{text-align:center;margin-top:8px;font-size:.9em}`;
    const items = m.items
      .map(
        (i) =>
          `<tr><td colspan="2" class="item-name">${e(i.title)}</td></tr>${sub(i) ? `<tr><td colspan="2" class="item-sub">${sub(i)}</td></tr>` : ''}${row('Amount', i.amount, 'amt')}${i.paidBefore ? row('Paid before', i.paidBefore, 'amt') : ''}${i.paidNow ? row('Paid now', i.paidNow, 'amt') : ''}${i.balance ? row('Balance', i.balance, 'amt strong') : ''}`,
      )
      .join('');
    return `<style>${css}</style><div class="psl-r">${logo}${m.business.name ? `<h1>${e(m.business.name)}</h1>` : ''}${contact ? `<p class="contact">${contact}</p>` : ''}<div class="title">${e(m.title.toUpperCase())}</div>${notices}<table class="meta">${m.meta.map(([k, v]) => row(k, v)).join('')}</table><div class="rule"></div><table>${items}</table><div class="rule"></div><table>${totals}</table>${m.account.length ? `<div class="rule"></div><table class="meta">${m.account.map((a) => row(a.label, a.value)).join('')}</table>` : ''}${m.note ? `<p class="item-sub">Note: ${e(m.note)}</p>` : ''}${adjustmentsHtml}${m.footer ? `<p class="foot">${e(m.footer)}</p>` : ''}<p class="foot item-sub">${e(m.title)} ${e(m.number)}</p></div>`;
  }
  const css = `.psl-w{color:#1d2b27;line-height:1.45;font-size:1em;overflow-wrap:anywhere}.psl-w *{box-sizing:border-box}.psl-w table{width:100%;border-collapse:collapse}.psl-w td,.psl-w th{border:0;padding:0;vertical-align:top;text-align:left}.psl-w .r{text-align:right;white-space:nowrap}.psl-w .head td{padding-bottom:10px}.psl-w h1{font-size:1.6em;margin:0 0 4px;color:${brand}}.psl-w .contact{font-size:.85em;color:#55635e;margin:0}.psl-w .logo{max-width:200px;max-height:90px}.psl-w .band{background:${brand};color:#fff;margin:6px 0 12px}.psl-w .band td{color:#fff;padding:8px 12px;vertical-align:middle}.psl-w .band .t{font-size:1.25em;font-weight:bold;letter-spacing:2px;text-transform:uppercase}.psl-w .meta td{padding:2px 12px 2px 0;font-size:.92em}.psl-w .meta .k{color:#6b7873;width:110px}.psl-w .items{margin-top:12px}.psl-w .items th{font-size:.75em;text-transform:uppercase;letter-spacing:.6px;color:#6b7873;border-bottom:2px solid ${brand};padding:6px 6px}.psl-w .items td{padding:8px 6px;border-bottom:1px solid #e3e8e5}.psl-w .items .name{font-weight:bold}.psl-w .items small{display:block;color:#6b7873;font-size:.8em;margin-top:2px}.psl-w .sum{width:55%;margin:12px 0 0 auto}.psl-w .sum td{padding:4px 6px}.psl-w .sum .strong td{font-weight:bold}.psl-w .sum .total td{font-weight:bold;font-size:1.15em;border-top:2px solid ${brand};color:${brand};padding-top:6px}.psl-w .acct{margin-top:14px;background:#f3f6f4}.psl-w .acct td{padding:4px 12px}.psl-w .notice{border-left:4px solid ${safeColour(m.business.accent)};background:#fdf7e8;padding:6px 10px;margin:6px 0}.psl-w h3{color:${brand};margin:16px 0 4px;font-size:1em}.psl-w .adj{font-size:.85em;margin:4px 0;color:#3c4a45}.psl-w .foot{text-align:center;margin-top:18px;color:#55635e;border-top:1px solid #e3e8e5;padding-top:10px}`;
  const cols = [
    ['Amount', (i) => `${e(i.amount)}${i.paidBefore ? `<small>Paid before ${e(i.paidBefore)}</small>` : ''}`],
    ...(m.show.paidNow ? [['Paid now', (i) => e(i.paidNow)]] : []),
    ...(m.show.balance ? [['Balance', (i) => e(i.balance)]] : []),
  ];
  const items = m.items
    .map(
      (i) =>
        `<tr><td><span class="name">${e(i.title)}</span>${sub(i) ? `<small>${sub(i)}</small>` : ''}</td>${cols.map(([, cell]) => `<td class="r">${cell(i)}</td>`).join('')}</tr>`,
    )
    .join('');
  const order = ['Customer', 'Date', 'Phone', 'Payment date', 'Cashier'];
  const meta = m.meta
    .filter(([k]) => k !== 'Receipt no.')
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  const metaRows = [];
  for (let i = 0; i < meta.length; i += 2)
    metaRows.push(
      `<tr>${meta
        .slice(i, i + 2)
        .map(([k, v]) => `<td class="k">${e(k)}</td><td>${e(v)}</td>`)
        .join('')}</tr>`,
    );
  return `<style>${css}</style><div class="psl-w"><table class="head"><tr>${m.business.name ? `<td><h1>${e(m.business.name)}</h1>${contact ? `<p class="contact">${contact}</p>` : ''}</td><td class="r">${logo}</td>` : `<td>${logo}${contact ? `<p class="contact">${contact}</p>` : ''}</td>`}</tr></table><table class="band"><tr><td class="t">${e(m.title)}</td><td class="r">No. ${e(m.number)}</td></tr></table>${notices}<table class="meta">${metaRows.join('')}</table>${m.items.length ? `<table class="items"><thead><tr><th>${e(m.itemHeading ?? 'Job')}</th>${cols.map(([h]) => `<th class="r">${h}</th>`).join('')}</tr></thead><tbody>${items}</tbody></table>` : ''}<table class="sum">${totals}</table>${m.account.length ? `<table class="acct">${m.account.map((a) => row(a.label, a.value)).join('')}</table>` : ''}${m.note ? `<p class="adj">Note: ${e(m.note)}</p>` : ''}${adjustmentsHtml}${m.footer ? `<p class="foot">${e(m.footer)}</p>` : ''}</div>`;
}

/** Narrow receipt layout for roll paper up to 90mm wide. */
export const receiptLayout = (paperWidth) =>
  Number(paperWidth) > 0 && Number(paperWidth) <= 90 ? 'narrow' : 'wide';

export function correctedReceipt(record, ledger) {
  const jobs = record.jobs.map((j) => ({ ...j, ...(ledger.jobs.find((x) => x.id === j.id) ?? {}) }));
  const payment = ledger.payments.find((p) => p.id === record.id || p.checkoutId === record.id);
  const jobBalances = record.jobBalances.map((balance) => {
    const job = ledger.jobs.find((j) => j.id === balance.id);
    if (!job) return balance;
    const paid = ledger.payments
      .flatMap((p) => p.allocations)
      .filter((a) => a.jobId === job.id)
      .reduce((n, a) => n + a.amount, 0);
    const paidThisCheckout = payment?.allocations.find((a) => a.jobId === job.id)?.amount ?? 0;
    return {
      ...balance,
      description: job.description,
      service: job.service,
      amount: job.amount,
      paidBefore: Math.max(0, paid - paidThisCheckout),
      paidThisCheckout,
      outstandingAfter: Math.max(0, job.amount - paid),
    };
  });
  return {
    ...record,
    corrected: true,
    jobs,
    jobBalances,
    total: jobs.reduce((n, j) => n + j.amount, 0),
    cashReceived: payment?.amount ?? record.cashReceived,
    method: payment?.method ?? record.method,
    methodLabel: payment?.methodLabel ?? record.methodLabel,
    walletUsed: payment?.walletUsed ?? record.walletUsed,
    walletAdded: payment?.walletAdded ?? record.walletAdded,
    reference: payment?.reference ?? record.reference,
    walletAfter: ledger.payments
      .filter((p) => p.customerId === record.customerId)
      .reduce((n, p) => n + (p.walletAdded ?? 0) - (p.walletUsed ?? 0), 0),
    outstandingAfter: ledger.jobs
      .filter((j) => j.customerId === record.customerId)
      .reduce(
        (n, j) =>
          n +
          Math.max(
            0,
            j.amount -
              ledger.payments
                .flatMap((p) => p.allocations)
                .filter((a) => a.jobId === j.id)
                .reduce((n, a) => n + a.amount, 0),
          ),
        0,
      ),
  };
}
