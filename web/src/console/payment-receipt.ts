// A receipt for a business's subscription payment, issued by PrintShopLedger (A4 PDF).
import { jsPDF } from 'jspdf';
import { PDF_FONT, pdfText, registerPdfFonts } from '../pdf-common';
import { currency } from '../receipts.mjs';
import type { Payment, ReceiptIssuer } from './console-api';
import { receiptRef } from './receipt-ref.mjs';

export { receiptRef };

const GREEN: [number, number, number] = [18, 75, 64];
const INK: [number, number, number] = [20, 24, 22];
const SUBTLE: [number, number, number] = [96, 104, 100];
const LINE: [number, number, number] = [222, 228, 224];
const TINT: [number, number, number] = [240, 246, 243];

const longDate = (value: string | null | undefined) =>
  value
    ? new Date(value.length === 10 ? `${value}T12:00:00+01:00` : value).toLocaleDateString('en-NG', {
        timeZone: 'Africa/Lagos',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

export function createPaymentReceipt(
  issuer: ReceiptIssuer,
  business: { name: string; ownerEmail: string | null },
  payment: Payment,
) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  registerPdfFonts(doc);
  const W = 210,
    L = 18,
    R = W - 18;
  const text = (
    value: unknown,
    x: number,
    y: number,
    size: number,
    style: 'normal' | 'bold' = 'normal',
    colour = INK,
    align: 'left' | 'right' | 'center' = 'left',
  ) => {
    doc.setFont(PDF_FONT, style);
    doc.setFontSize(size);
    doc.setTextColor(...colour);
    doc.text(pdfText(value), x, y, { align });
  };
  const wrap = (value: string, width: number, size: number) => {
    doc.setFontSize(size);
    return doc.splitTextToSize(pdfText(value), width) as string[];
  };

  // Brand band and mark.
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, W, 4, 'F');
  doc.roundedRect(L, 16, 13, 13, 3, 3, 'F');
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(issuer.name.trim()[0]?.toUpperCase() ?? 'P'), L + 6.5, 25, { align: 'center' });
  text(issuer.name, L + 17, 21.5, 15, 'bold');
  let y = 26.5;
  const contact = [issuer.phone, issuer.email].filter(Boolean).join('  ·  ');
  for (const line of [
    ...(issuer.address ? wrap(issuer.address, 90, 9) : []),
    ...(contact ? [contact] : []),
  ]) {
    text(line, L + 17, y, 9, 'normal', SUBTLE);
    y += 4.4;
  }

  // Title, number and date.
  text('RECEIPT', R, 22, 22, 'bold', GREEN, 'right');
  text(receiptRef(payment.receiptNo), R, 29, 10, 'bold', INK, 'right');
  text(`Paid ${longDate(payment.paidOn)}`, R, 34, 9, 'normal', SUBTLE, 'right');

  // Received from.
  y = Math.max(y, 40) + 8;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(L, y, R, y);
  y += 9;
  text('RECEIVED FROM', L, y, 8, 'bold', SUBTLE);
  text('AMOUNT PAID', R, y, 8, 'bold', SUBTLE, 'right');
  y += 7;
  text(business.name, L, y, 13, 'bold');
  text(currency(payment.amount), R, y + 1, 20, 'bold', GREEN, 'right');
  if (business.ownerEmail) text(business.ownerEmail, L, y + 5.5, 9, 'normal', SUBTLE);
  y += 18;

  // What it was for.
  doc.setFillColor(...TINT);
  doc.rect(L, y, R - L, 9, 'F');
  text('DESCRIPTION', L + 4, y + 6, 8, 'bold', SUBTLE);
  text('AMOUNT', R - 4, y + 6, 8, 'bold', SUBTLE, 'right');
  y += 16;
  const plan = payment.planName ? `${payment.planName} plan` : 'Subscription';
  text(`PrintShopLedger subscription — ${plan}`, L + 4, y, 10.5, 'bold');
  text(currency(payment.amount), R - 4, y, 10.5, 'normal', INK, 'right');
  if (payment.extendedTo) {
    y += 5.5;
    text(`Subscription runs until ${longDate(payment.extendedTo)}`, L + 4, y, 9, 'normal', SUBTLE);
  }
  for (const line of payment.note ? wrap(payment.note, R - L - 50, 9) : []) {
    y += 5;
    text(line, L + 4, y, 9, 'normal', SUBTLE);
  }
  y += 7;
  doc.line(L, y, R, y);
  y += 8;
  text('Total paid', R - 50, y, 10, 'bold', INK);
  text(currency(payment.amount), R - 4, y, 12, 'bold', INK, 'right');
  y += 4;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.6);
  doc.line(R - 50, y, R, y);

  // Paid stamp.
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.8);
  doc.roundedRect(L, y - 10, 30, 11, 2, 2, 'S');
  text('PAID', L + 15, y - 2.6, 13, 'bold', GREEN, 'center');

  // Payment details.
  y += 16;
  text('PAYMENT DETAILS', L, y, 8, 'bold', SUBTLE);
  y += 6;
  const rows: [string, string][] = [
    ['Date paid', longDate(payment.paidOn)],
    ['Method', payment.method || '—'],
    ['Reference', payment.reference || '—'],
    ['Received by', payment.recordedBy || '—'],
  ];
  for (const [label, value] of rows) {
    text(label, L, y, 9.5, 'normal', SUBTLE);
    text(value, L + 38, y, 9.5, 'normal', INK);
    y += 6;
  }

  // Footer.
  let f = 297 - 34;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(L, f, R, f);
  f += 7;
  if (issuer.bank) {
    text('Bank details:', L, f, 9, 'bold', INK);
    for (const line of wrap(issuer.bank, R - L - 30, 9)) {
      text(line, L + 28, f, 9, 'normal', INK);
      f += 4.6;
    }
    f += 1.5;
  }
  if (issuer.footer)
    for (const line of wrap(issuer.footer, R - L, 9)) {
      text(line, L, f, 9, 'normal', SUBTLE);
      f += 4.6;
    }
  doc.setFillColor(...GREEN);
  doc.rect(0, 293, W, 4, 'F');
  doc.setProperties({ title: `${issuer.name} receipt ${receiptRef(payment.receiptNo)}` });
  return doc;
}

export function downloadPaymentReceipt(...args: Parameters<typeof createPaymentReceipt>) {
  const [, business, payment] = args;
  const slug =
    business.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'business';
  createPaymentReceipt(...args).save(`${receiptRef(payment.receiptNo)}-${slug}.pdf`);
}
