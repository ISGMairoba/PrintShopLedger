// Messages the app sends for the business (Business Settings → Messages): each has wording the
// business can change, with {placeholders} filled in when sent, and how it goes out:
// * 'whatsapp': WhatsApp opens on the customer's number with the message ready to send (with a
//   document, the PDF downloads first so it can be attached);
// * 'share': the phone's share sheet (WhatsApp, SMS, email…), with the PDF attached when there is one.
// Customer names: {customer} is the "Called as" name (else the first name), {customer_full} the name as saved,
// {customer_first} / {customer_last} the first / last word of it.
// Where from: {business} is the business name; {branch} the branch name, {address} and {phone} the
// branch's address and phone (the business's when the branch has none, or without branches).

export const SEND_MODES = ['whatsapp', 'share'];

const customerHolders = [
  ['customer', 'First name'],
  ['customer_full', 'Full name'],
  ['customer_first', 'First word of the name'],
  ['customer_last', 'Last word of the name'],
];

const placeHolders = [
  ['branch', 'Branch name (empty without branches)'],
  ['address', 'Branch address (else the business address)'],
  ['phone', 'Branch phone number (else the business number)'],
];

/** Every message, in the order the settings show them. */
export const MESSAGE_KINDS = [
  {
    key: 'ready',
    name: 'Order ready (Tell customer)',
    hint: 'When a job is Completed. Jobs from the same sale that are ready go in one message.',
    file: false,
    text: 'Hello {customer}, your {job} {number} ({items}) {is} ready for collection at {business}. {balance}',
    holders: [
      ...customerHolders,
      ['job', '"order" or "orders"'],
      ['is', '"is" or "are"'],
      ['number', 'Order numbers'],
      ['items', 'Items and quantities'],
      ['balance', 'What is left to pay, or "fully paid"'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: {
      job: 'order',
      is: 'is',
      number: '#3222F0C8',
      items: 'Nylon bag × 100',
      balance: 'Balance to pay: ₦9,025.00.',
    },
  },
  {
    key: 'part_ready',
    name: 'Part of an order ready (Tell customer)',
    hint: 'When some of a big order (made in parts) is ready to collect.',
    file: false,
    text: 'Hello {customer}, {ready} of your {total} {item} (order {number}) {are} ready for collection at {business}. {to_pay} {balance}',
    holders: [
      ...customerHolders,
      ['ready', 'How many are ready now'],
      ['total', 'How many in the order'],
      ['collected', 'How many collected so far'],
      ['item', 'Item'],
      ['are', '"is" or "are"'],
      ['number', 'Order number'],
      ['to_pay', 'What to pay before collecting this part, or "This part is paid."'],
      ['balance', 'Balance on the whole order, or "fully paid"'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: {
      ready: '60',
      total: '200',
      collected: '0',
      item: 'Jotter soft cover',
      are: 'are',
      number: '#3222F0C8',
      to_pay: 'Amount to pay for this part: ₦45,000.00.',
      balance: 'Balance on the order: ₦150,000.00.',
    },
  },
  {
    key: 'receipt',
    name: 'Receipt',
    hint: 'Sent with the receipt PDF.',
    file: true,
    text: 'Hello {customer}, here is your receipt {receipt} from {business}. Paid now: {paid}. {balance}',
    holders: [
      ...customerHolders,
      ['receipt', 'Receipt number'],
      ['paid', 'Amount paid now'],
      ['balance', 'Balance on the account, or a thank-you'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { receipt: 'B8E634D3', paid: '₦23,000.00', balance: 'Balance on your account: ₦2,500.00.' },
  },
  {
    key: 'quotation',
    name: 'Quotation',
    hint: 'Sent with the quotation PDF.',
    file: true,
    text: 'Hello {customer}, here is quotation {quotation} from {business} for {total}, valid until {valid_until}. Reply to go ahead or ask any questions.',
    holders: [
      ...customerHolders,
      ['quotation', 'Quotation number'],
      ['total', 'Quotation total'],
      ['valid_until', 'Valid until'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { quotation: 'Q-1042', total: '₦75,050.00', valid_until: '30 Nov 2026' },
  },
  {
    key: 'reminder',
    name: 'Payment reminder',
    hint: 'Payment Reminders → Share statement. Sent with the statement PDF.',
    file: true,
    text: 'Hello {customer}, this is a friendly reminder from {business} that {owed} is outstanding on your account (the oldest from {oldest}). Your statement is attached. Thank you.',
    holders: [
      ...customerHolders,
      ['owed', 'Amount owed'],
      ['oldest', 'Date of the oldest unpaid order'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { owed: '₦104,000.00', oldest: '9 Nov 2026' },
  },
  {
    key: 'statement',
    name: 'Customer statement',
    hint: 'Reports → Customer statement. Sent with the statement PDF.',
    file: true,
    text: 'Hello {customer}, here is your account statement from {business}. {owed_line}',
    holders: [
      ...customerHolders,
      ['owed', 'Amount owed'],
      ['owed_line', '"Amount owed: …" or a thank-you'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { owed: '₦104,000.00', owed_line: 'Amount owed: ₦104,000.00. Thank you.' },
  },
  {
    key: 'delivery',
    name: 'Delivery note',
    hint: 'A part of a big order handed over. Sent with the delivery note PDF.',
    file: true,
    text: 'Hello {customer}, here is delivery note {note} from {business} for {quantity} × {item}. The PDF is attached.',
    holders: [
      ...customerHolders,
      ['note', 'Delivery note number'],
      ['quantity', 'Quantity handed over'],
      ['item', 'Item'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { note: 'DN-C8D2E3F4', quantity: '60', item: 'Jotter soft cover' },
  },
  {
    key: 'options',
    name: 'Price options',
    hint: 'Pricing Templates → share options. Sent with the options PDF.',
    file: true,
    text: '{business}: price options for {template} ({count} options). The PDF is attached.',
    holders: [
      ['template', 'Template name'],
      ['count', 'How many options'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { template: 'Paper bag', count: '3' },
  },
  {
    key: 'reorder',
    name: 'Order list to a supplier',
    hint: 'Products / Materials → Reorder list → Share.',
    file: false,
    text: 'Order from {business}:\n{list}\nPlease confirm prices and delivery. Thank you.',
    holders: [
      ['list', 'The items and quantities, one per line'],
      ['business', 'Business name'],
      ...placeHolders,
    ],
    sample: { list: '- SAV paper: 10 rolls\n- Lamination film: 2 rolls' },
  },
];
export const messageKind = (key) => MESSAGE_KINDS.find((k) => k.key === key);

export const messagesDefaults = () => ({ send: 'whatsapp', items: {} });

/** Saved Messages settings: the business default and each message's own wording and sending. */
export function validateMessages(input) {
  const value = messagesDefaults();
  if (input === undefined || input === null) return value;
  if (typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid message settings.');
  value.send = input.send === 'share' ? 'share' : 'whatsapp';
  const items = input.items && typeof input.items === 'object' ? input.items : {};
  for (const kind of MESSAGE_KINDS) {
    const item = items[kind.key];
    if (!item || typeof item !== 'object') continue;
    const text = typeof item.text === 'string' ? item.text.replace(/\r\n/g, '\n').trim() : '';
    if (text.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      throw Error(`Keep the ${kind.name} message to 1,000 characters of plain text.`);
    const send = SEND_MODES.includes(item.send) ? item.send : 'default';
    if (text || send !== 'default') value.items[kind.key] = { ...(text ? { text } : {}), send };
  }
  return value;
}

/** The name placeholders from a customer's saved name ({customer}: their "Called as" name, if set). */
export function customerNames(name, calledAs = '') {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0] ?? 'there';
  return {
    customer: String(calledAs ?? '').trim() || first,
    customer_full: words.join(' ') || 'there',
    customer_first: first,
    customer_last: words.at(-1) ?? first,
  };
}

/** Where this device's messages come from: its branch's name, address and phone (App sets it). */
let sender = { branch: '', address: '', phone: '' };
export function setMessageSender(next) {
  sender = {
    branch: String(next?.branch ?? '').trim(),
    address: String(next?.address ?? '').trim(),
    phone: String(next?.phone ?? '').trim(),
  };
}

/** Fill a template: known {placeholders} are replaced; tidy spaces around what came out empty. */
export function fillMessage(template, values) {
  return String(template)
    .replace(/\{(\w+)\}/g, (found, key) => (key in values ? String(values[key] ?? '') : found))
    .replace(/\(\)\s?/g, '')
    .replace(/[ \t]+([.,])/g, '$1')
    // "at {business}, {address}." with no address: no stray comma.
    .replace(/,[ \t]*(?=[.,!?]|$)/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * The message for one kind, in the business's wording (or the app's), with these values.
 * settings: the saved Messages settings; legacyReady: the old Jobs & payments wording, if any.
 */
export function messageText(settings, key, values, legacyReady = '') {
  const kind = messageKind(key);
  if (!kind) throw Error('Unknown message.');
  const own = settings?.items?.[key]?.text;
  const template = own || (key === 'ready' && legacyReady.trim()) || kind.text;
  return fillMessage(template, { ...sender, ...values });
}

/** How a message goes out: its own choice, else the business default. */
export function messageMode(settings, key) {
  const own = settings?.items?.[key]?.send;
  return SEND_MODES.includes(own) ? own : settings?.send === 'share' ? 'share' : 'whatsapp';
}

/** The sample text the settings preview shows. */
export const sampleMessage = (settings, key, business, legacyReady = '') =>
  messageText(
    settings,
    key,
    {
      ...customerNames('Sara Aminu Bello'),
      business: business || 'Your business',
      branch: sender.branch || 'Ikeja branch',
      address: sender.address || '12 Allen Avenue, Ikeja',
      phone: sender.phone || '0803 000 0000',
      ...messageKind(key)?.sample,
    },
    legacyReady,
  );
