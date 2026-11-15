// A delivery note for one handover of a part order: what the customer took this time, what was
// collected before and what is still to come. No prices. Drawn by the receipt PDF code.
import { resolveWatermark, logoPosition } from './document-logos.mjs';
import { receiptBusiness, validLogo } from './business-branding.mjs';

const longDate = (value) =>
  new Date(value).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
/** The note's number, from the handover, e.g. DN-6F2A91C4. */
export const deliveryRef = (handoverId) =>
  'DN-' + String(handoverId).replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * The handover as a document. details: { job, handover, customerName, customerPhone }.
 * Counts come from the job's handovers up to and including this one.
 * @param {{ job: import('./types').Job, handover: { id: string, quantity: number, collectedBy: string, note: string, at: string, byLabel: string }, customerName?: string, customerPhone?: string }} details
 * @param {string | import('./useBusinessBranding').Branding} business
 */
export function deliveryNoteModel({ job, handover, customerName = '', customerPhone = '' }, business) {
  const b = receiptBusiness(business),
    o = b.receiptPage;
  const list = job.progress?.handovers ?? [];
  const at = list.findIndex((h) => h.id === handover.id);
  if (at < 0) throw Error('Handover not found.');
  const before = list.slice(0, at).reduce((sum, h) => sum + h.quantity, 0);
  const total = job.quantity ?? 1;
  const left = Math.max(0, total - before - handover.quantity);
  const ref = deliveryRef(handover.id);
  const meta = [
    ['Delivery note', ref],
    ['Date', longDate(handover.at)],
    customerName ? ['Customer', customerName] : null,
    customerPhone ? ['Phone', customerPhone] : null,
    handover.collectedBy ? ['Collected by', handover.collectedBy] : null,
    ['Handed over by', handover.byLabel],
  ].filter(Boolean);
  return {
    business: {
      name: o.showBusinessName || !(o.showLogo && b.logo && validLogo(b.logo)) ? b.businessName : '',
      logoPosition: logoPosition(o.logoPosition),
      watermarkLogo: resolveWatermark(b),
      logo: o.showLogo && b.logo && validLogo(b.logo) ? b.logo : '',
      address: o.showAddress ? b.address : '',
      contacts: o.showContacts ? [b.phones, b.email, b.website, b.socials].filter(Boolean) : [],
      primary: b.primary || '#124b40',
      accent: b.accent || '#d9a126',
    },
    termsAndConditions: '',
    title: 'Delivery note',
    itemHeading: 'Item',
    amountHeading: 'QTY THIS TIME',
    amountLabel: 'Quantity this time',
    number: ref,
    date: longDate(handover.at),
    paidOn: '',
    customer: { name: customerName, phone: customerPhone },
    cashier: handover.byLabel,
    method: '',
    meta,
    show: { paidNow: false, balance: false, paidBefore: false },
    notices: [
      left
        ? `Part delivery: ${before + handover.quantity} of ${total} collected so far, ${left} still to come.`
        : `Final delivery: all ${total} collected.`,
    ],
    items: [
      {
        id: job.id,
        ref: '',
        description: job.description,
        service: job.service,
        title: job.description,
        subtitle: job.service,
        meta: [`Ordered ${total}`, `Collected before ${before}`, `Still to collect ${left}`],
        details: [],
        amount: String(handover.quantity),
        paidBefore: '',
        paidNow: '',
        balance: '',
        ok: true,
      },
    ],
    totals: [],
    account: [],
    note: [
      handover.note,
      'Received in good condition. Name: ____________________  Signature: ____________________',
    ]
      .filter(Boolean)
      .join(' · '),
    adjustments: [],
    footer: o.footer || '',
  };
}

/** The message sent with a shared delivery note. */
export const deliveryMessage = (job, handover, businessName) =>
  `${businessName ? businessName + ': ' : ''}delivery note ${deliveryRef(handover.id)} for ${handover.quantity} × ${job.description}. The PDF is attached.`;
