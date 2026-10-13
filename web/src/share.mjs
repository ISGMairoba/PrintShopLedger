// Sharing documents with customers, usually on WhatsApp. On phones the share sheet sends the PDF
// itself; elsewhere the PDF is downloaded and WhatsApp opens with the customer's number and a
// short message, ready for the file to be attached.
import { currency } from './receipts.mjs';

/** A Nigerian phone number in international form for wa.me (digits only), or '' when unusable. */
export function whatsappNumber(phone) {
  let digits = String(phone ?? '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (/^0\d{10}$/.test(digits)) digits = '234' + digits.slice(1);
  else if (/^[789]\d{9}$/.test(digits)) digits = '234' + digits;
  digits = digits.replace(/\D/g, '');
  return /^\d{10,15}$/.test(digits) ? digits : '';
}

/** A WhatsApp link that opens a chat with the message (to the number when known). */
export function whatsappLink(phone, text) {
  const number = whatsappNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

const first = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] || 'there';
const from = (business) => (business ? ` from ${business}` : '');

export function receiptMessage(record, business) {
  const balance = record.outstandingAfter ?? 0;
  return [
    `Hello ${first(record.customerSnapshot?.name)}, here is your receipt ${record.id.slice(0, 8).toUpperCase()}${from(business)}.`,
    `Paid now: ${currency(record.cashReceived ?? 0)}.`,
    balance > 0 ? `Balance on your account: ${currency(balance)}.` : 'Thank you for your payment.',
  ].join(' ');
}

export function quotationMessage(quote, ref, business, validUntil) {
  return `Hello ${first(quote.customerName)}, here is quotation ${ref}${from(business)} for ${currency(quote.total)}, valid until ${validUntil}. Reply to go ahead or ask any questions.`;
}

export function statementMessage(name, owed, business) {
  return owed > 0
    ? `Hello ${first(name)}, here is your account statement${from(business)}. Amount owed: ${currency(owed)}. Thank you.`
    : `Hello ${first(name)}, here is your account statement${from(business)}. Thank you for your business.`;
}
