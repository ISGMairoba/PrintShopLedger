import { documentHeaderGeometry, resolveWatermark } from './document-logos.mjs';
import { jsPDF, GState } from 'jspdf';
import { poweredByLine, receiptBusiness } from './business-branding.mjs';
import { receiptIntegrityError, receiptModel } from './receipts.mjs';
import { registerPdfFonts, pdfText, PDF_FONT, rgb } from './pdf-common';
import type { CheckoutRecord, Quotation, SaleAdjustment } from './types';
import { quotationModel, quotationRef } from './quotations.mjs';
import { comparisonModel } from './comparison-doc.mjs';
import type { Branding } from './useBusinessBranding';

/** The paper a receipt is drawn for (see receiptMedia in print-settings.mjs). */
export type ReceiptMedia = {
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  layout: 'roll' | 'page';
  color: boolean;
  fontScale: number;
};
export type ReceiptPdfSize = 'a4' | 'roll' | ReceiptMedia;
type Model = ReturnType<typeof receiptModel>;
type Colour = [number, number, number];
type Style = 'normal' | 'bold' | 'italic';
const BLACK: Colour = [0, 0, 0];

export const A4_RECEIPT: ReceiptMedia = {
  width: 210,
  height: 297,
  margins: { top: 14, right: 16, bottom: 12, left: 16 },
  layout: 'page',
  color: true,
  fontScale: 1,
};
export const A5_DOCUMENT: ReceiptMedia = {
  width: 148,
  height: 210,
  margins: { top: 10, right: 11, bottom: 9, left: 11 },
  layout: 'page',
  color: true,
  fontScale: 1,
};
export const ROLL_80_RECEIPT: ReceiptMedia = {
  width: 80,
  height: 200,
  margins: { top: 5, right: 4, bottom: 5, left: 4 },
  layout: 'roll',
  color: true,
  fontScale: 1,
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function imageInfo(doc: jsPDF, data: string) {
  try {
    const p = doc.getImageProperties(data);
    return { type: p.fileType, w: p.width, h: p.height };
  } catch {
    return null;
  }
}

/**
 * Page receipt (A4, A5, Letter…). Everything is proportional to the printable width, as a
 * fraction of the A4 design, so smaller pages shrink evenly; long receipts continue on new pages.
 */
function drawPage(doc: jsPDF, m: Model, media: ReceiptMedia, watermark: string, credit: string) {
  const W = media.width,
    H = media.height,
    L = media.margins.left,
    R = W - media.margins.right,
    U = R - L,
    TOP = media.margins.top + 4,
    k = clamp(U / 178, 0.6, 1.25) * media.fontScale,
    // The installer credit has its own line at the foot of every page, above the page details.
    creditY = H - media.margins.bottom - 2 - 3.6 * k,
    bottom = H - media.margins.bottom - 8 - (credit ? 3.6 * k : 0);
  const INK: Colour = media.color ? [29, 43, 39] : BLACK,
    MUTED: Colour = media.color ? [95, 108, 103] : [70, 70, 70],
    RULE: Colour = media.color ? [220, 226, 222] : [190, 190, 190];
  const brand = media.color ? rgb(m.business.primary) : BLACK,
    accent = media.color ? rgb(m.business.accent) : BLACK;
  const logo = m.business.logo ? imageInfo(doc, m.business.logo) : null;
  const watermarkInfo = watermark ? imageInfo(doc, watermark) : null;
  const mark = () => {
    if (!watermarkInfo) return;
    const s = Math.min((U * 0.73) / watermarkInfo.w, (H * 0.34) / watermarkInfo.h);
    doc.setGState(new GState({ opacity: 0.06 }));
    doc.addImage(
      watermark,
      watermarkInfo.type,
      (W - watermarkInfo.w * s) / 2,
      (H - watermarkInfo.h * s) / 2,
      watermarkInfo.w * s,
      watermarkInfo.h * s,
      'wm',
      'FAST',
    );
    doc.setGState(new GState({ opacity: 1 }));
  };
  mark();
  let y = TOP;
  const page = (need: number) => {
    if (y + need > bottom) {
      doc.addPage([W, H], H >= W ? 'portrait' : 'landscape');
      mark();
      y = TOP;
      return true;
    }
    return false;
  };
  const text = (
    t: string,
    x: number,
    size: number,
    style: Style = 'normal',
    colour: Colour = INK,
    align: 'left' | 'right' | 'center' = 'left',
    width?: number,
  ) => {
    const s = size * k;
    doc.setFont(PDF_FONT, style);
    doc.setFontSize(s);
    doc.setTextColor(...colour);
    const lines = width ? (doc.splitTextToSize(pdfText(t), width) as string[]) : [pdfText(t)];
    lines.forEach((line, i) => doc.text(line, x, y + i * s * 0.42, { align }));
    return lines.length * s * 0.42;
  };
  let textX = L,
    textW = U,
    logoBottom = TOP - 4;
  y = TOP + 2 * k;
  if (logo) {
    const scale = Math.min((U * (m.business.name ? 0.34 : 0.5)) / logo.w, (28 * k) / logo.h);
    const layout = documentHeaderGeometry(
      m.business.logoPosition,
      L,
      TOP - 4,
      U,
      logo.w * scale,
      logo.h * scale,
      8 * k,
    );
    doc.addImage(
      m.business.logo,
      logo.type,
      layout.x,
      layout.y,
      logo.w * scale,
      logo.h * scale,
      'logo',
      'FAST',
    );
    logoBottom = layout.bottom;
    textX = layout.textX;
    textW = layout.textWidth;
    y = layout.textY + 6 * k;
  }
  if (m.business.name) y += text(m.business.name, textX, 17, 'bold', brand, 'left', textW) + 1 * k;
  for (const line of [m.business.address, m.business.contacts.join('  |  ')].filter(Boolean))
    y += text(line, textX, 8.8, 'normal', MUTED, 'left', textW);
  y = Math.max(y, logoBottom) + 5 * k;
  // Title band
  const band = 11 * k;
  doc.setFillColor(...brand);
  doc.rect(L, y, U, band, 'F');
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(13 * k);
  doc.setTextColor(255, 255, 255);
  doc.text(pdfText(m.title.toUpperCase()), L + 4 * k, y + band * 0.67);
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(10 * k);
  doc.text(pdfText(`No. ${m.number}`), R - 4 * k, y + band * 0.65, { align: 'right' });
  y += band + 6 * k;
  for (const n of m.notices) {
    doc.setFillColor(...(media.color ? ([253, 247, 232] as Colour) : ([238, 238, 238] as Colour)));
    doc.rect(L, y - 4 * k, U, 7.5 * k, 'F');
    doc.setDrawColor(...accent);
    doc.setLineWidth(1.2 * k);
    doc.line(L, y - 4 * k, L, y + 3.5 * k);
    doc.setLineWidth(0.2);
    text(n, L + 4 * k, 9.5, 'bold');
    y += 10 * k;
  }
  // Details, two columns
  const half = U / 2,
    key = 24 * k;
  const order = ['Customer', 'Date', 'Phone', 'Payment date', 'Cashier'];
  const meta = (m.meta as [string, string][])
    .filter(([label]) => label !== 'Receipt no.')
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  for (let i = 0; i < meta.length; i += 2) {
    let h = 0;
    for (const [j, [label, value]] of meta.slice(i, i + 2).entries()) {
      const x = L + j * half;
      text(label, x, 8.5, 'normal', MUTED);
      h = Math.max(h, text(value, x + key, 9.5, 'normal', INK, 'left', half - key - 4 * k));
    }
    y += Math.max(h, 6 * k);
  }
  y += 5 * k;
  // Items
  if (m.items.length) {
    // Amount columns from the business's settings, right-aligned from the right edge.
    const step = U * 0.157,
      cols: { head: string; value: (i: Model['items'][number]) => string; bold?: boolean }[] = [
        { head: 'AMOUNT', value: (i) => i.amount },
        ...(m.show.paidNow ? [{ head: 'PAID NOW', value: (i: Model['items'][number]) => i.paidNow }] : []),
        ...(m.show.balance
          ? [{ head: 'BALANCE', value: (i: Model['items'][number]) => i.balance, bold: true }]
          : []),
      ];
    const xs = cols.map((_, n) => R - step * (cols.length - 1 - n)),
      descW = xs[0] - U * 0.126 - L - 4 * k;
    const head = () => {
      doc.setDrawColor(...brand);
      doc.setLineWidth(0.6 * k);
      doc.line(L, y + 2 * k, R, y + 2 * k);
      doc.setLineWidth(0.2);
      text((m.itemHeading ?? 'Job').toUpperCase(), L, 8, 'bold', MUTED);
      cols.forEach((c, n) => text(c.head, xs[n], 8, 'bold', MUTED, 'right'));
      y += 7 * k;
    };
    head();
    for (const i of m.items) {
      const subline = [i.subtitle, ...i.meta].filter(Boolean).join(' · ');
      doc.setFont(PDF_FONT, 'bold');
      doc.setFontSize(10 * k);
      const name = doc.splitTextToSize(pdfText(i.title), descW) as string[];
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(8.2 * k);
      const sub = subline ? (doc.splitTextToSize(pdfText(subline), descW) as string[]) : [];
      const h = name.length * 4.2 * k + sub.length * 3.5 * k + (i.paidBefore ? 3.6 * k : 0) + 4.5 * k;
      const heading = (i as { heading?: string }).heading;
      // A group title (comparisons): a tinted band that always stays with its first option.
      if (heading) {
        if (page(h + 16 * k)) head();
        y += 2 * k;
        doc.setFillColor(...(media.color ? ([240, 245, 243] as Colour) : ([238, 238, 238] as Colour)));
        doc.rect(L, y - 4.5 * k, U, 8.5 * k, 'F');
        doc.setDrawColor(...brand);
        doc.setLineWidth(1.4 * k);
        doc.line(L, y - 4.5 * k, L, y + 4 * k);
        doc.setLineWidth(0.2);
        text(heading, L + 4 * k, 10, 'bold', media.color ? brand : INK, 'left', U - 8 * k);
        y += 9 * k;
      } else if (page(h + 4 * k)) head();
      const top = y;
      y += text(i.title, L, 10, 'bold', INK, 'left', descW);
      if (sub.length) text(sub.join('\n'), L, 8.2, 'normal', MUTED);
      y = top;
      cols.forEach((c, n) =>
        text(
          c.value(i),
          xs[n],
          10,
          c.bold ? 'bold' : 'normal',
          n === 0 && !i.ok ? (media.color ? [170, 40, 30] : BLACK) : INK,
          'right',
        ),
      );
      if (i.paidBefore) {
        y += 4.4 * k;
        text(`Paid before ${i.paidBefore}`, xs[0], 7.8, 'normal', MUTED, 'right');
      }
      y = top + h;
      doc.setDrawColor(...RULE);
      doc.line(L, y - 1.5 * k, R, y - 1.5 * k);
      y += 3 * k;
    }
  }
  // Totals and account panel
  page((m.totals.length * 6 + 30) * k);
  y += 2 * k;
  const sx = L + U * 0.48;
  m.totals.forEach((t, n) => {
    const last = n === m.totals.length - 1 && t.strong;
    if (last) {
      y += 1.5 * k;
      doc.setDrawColor(...brand);
      doc.setLineWidth(0.6 * k);
      doc.line(sx, y - 5 * k, R, y - 5 * k);
      doc.setLineWidth(0.2);
    }
    const lh = text(
      t.label,
      sx,
      last ? 11 : 9.8,
      t.strong ? 'bold' : 'normal',
      last ? brand : INK,
      'left',
      R - sx - 32 * k,
    );
    text(t.value, R, last ? 11 : 9.8, t.strong ? 'bold' : 'normal', last ? brand : INK, 'right');
    y += Math.max(lh + 1.6 * k, (last ? 7 : 5.8) * k);
  });
  y += 3 * k;
  if (m.account.length) {
    doc.setFillColor(...(media.color ? ([243, 246, 244] as Colour) : ([240, 240, 240] as Colour)));
    doc.rect(L, y - 4.5 * k, U, m.account.length * 5.6 * k + 2.5 * k, 'F');
    m.account.forEach((a) => {
      text(a.label, L + 4 * k, 9.5, 'normal', MUTED);
      text(a.value, R - 4 * k, 9.5, 'bold', INK, 'right');
      y += 5.6 * k;
    });
  }
  y += 4 * k;
  if (m.note) {
    page(8 * k);
    y += text(`Note: ${m.note}`, L, 9, 'italic', MUTED, 'left', U) + 2 * k;
  }
  if (m.adjustments.length) {
    page(14 * k);
    y += 3 * k;
    text('Later adjustments', L, 11, 'bold', brand);
    y += 6 * k;
    for (const a of m.adjustments) {
      page((a.lines.length + 1) * 3.8 * k + 3 * k);
      text(`${a.label} · ${a.ref} · ${m.itemHeading ?? 'Job'} ${a.job}`, L, 9, 'bold');
      y += 4.2 * k;
      for (const line of a.lines) {
        y += text(line, L + 3 * k, 8.2, 'normal', MUTED, 'left', U - 3 * k);
      }
      y += 2 * k;
    }
  }
  if (m.termsAndConditions) {
    page(14 * k);
    y += 5 * k;
    text('Terms & conditions', L, 10, 'bold');
    y += 5 * k;
    const rows = doc.splitTextToSize(pdfText(m.termsAndConditions), U) as string[];
    for (const row of rows) {
      page(4.5 * k);
      y += text(row || ' ', L, 8.5, 'normal', MUTED);
    }
  }
  if (m.footer) {
    page(14 * k);
    y += 6 * k;
    doc.setDrawColor(...RULE);
    doc.line(L, y - 4 * k, R, y - 4 * k);
    text(m.footer, W / 2, 10, 'normal', MUTED, 'center', U);
  }
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(7.5 * k);
    doc.setTextColor(...MUTED);
    doc.text(pdfText(`${m.title} ${m.number}`), L, H - media.margins.bottom - 2);
    if (pages > 1) doc.text(`Page ${p} of ${pages}`, R, H - media.margins.bottom - 2, { align: 'right' });
    // Anchored to the bottom margin, smaller than the business's own footer.
    if (credit) doc.text(pdfText(credit), W / 2, creditY, { align: 'center', maxWidth: U });
  }
}

/** Till-roll receipt for paper up to 90 mm wide, black only, scaled to the paper width. Returns the content height. */
function drawRoll(doc: jsPDF, m: Model, media: ReceiptMedia, credit: string) {
  const W = media.width,
    L = media.margins.left,
    R = W - media.margins.right,
    U = R - L,
    C = L + U / 2;
  const k = clamp(U / 72, 0.85, 1.3) * media.fontScale; // narrow rolls keep text legible and wrap instead
  let y = media.margins.top;
  const text = (
    t: string,
    x: number,
    size: number,
    style: Style = 'normal',
    align: 'left' | 'right' | 'center' = 'left',
    width = U,
  ) => {
    const s = size * k;
    doc.setFont(PDF_FONT, style);
    doc.setFontSize(s);
    doc.setTextColor(0, 0, 0);
    const lines = doc.splitTextToSize(pdfText(t), width) as string[];
    lines.forEach((line, i) => doc.text(line, x, y + s * 0.35 + i * s * 0.4, { align }));
    return lines.length * s * 0.4;
  };
  // Label left, value right; a value too long for one line moves under its label and wraps, right-aligned.
  const pair = (label: string, value: string, size = 8, style: 'normal' | 'bold' = 'normal') => {
    doc.setFont(PDF_FONT, style);
    doc.setFontSize(size * k);
    const vw = doc.getTextWidth(pdfText(value));
    if (vw > U * 0.62) {
      y += text(label, L, size, style) + 0.2 * k;
      y += text(value, R, size, style, 'right', U * 0.9) + 0.8 * k;
      return;
    }
    const h = text(label, L, size, style, 'left', Math.max(U * 0.3, U - vw - 3 * k));
    text(value, R, size, style, 'right', vw + 1);
    y += Math.max(h, size * k * 0.4) + 0.8 * k;
  };
  const rule = (dash = true) => {
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(dash ? 0.2 : 0.5);
    if (dash) doc.setLineDashPattern([0.8, 0.8], 0);
    doc.line(L, y, R, y);
    doc.setLineDashPattern([], 0);
    doc.setLineWidth(0.2);
    y += 2.5 * k;
  };
  const logo = m.business.logo ? imageInfo(doc, m.business.logo) : null;
  if (logo) {
    const s = Math.min((U * 0.64) / logo.w, (20 * k) / logo.h);
    doc.addImage(m.business.logo, logo.type, C - (logo.w * s) / 2, y, logo.w * s, logo.h * s, 'logo', 'FAST');
    y += logo.h * s + 2 * k;
  }
  if (m.business.name) y += text(m.business.name.toUpperCase(), C, 12, 'bold', 'center') + 0.5 * k;
  for (const line of [m.business.address, ...m.business.contacts].filter(Boolean))
    y += text(line, C, 7.2, 'normal', 'center');
  y += 1.5 * k;
  rule(false);
  y += text(m.title.toUpperCase(), C, 10.5, 'bold', 'center') + 0.5 * k;
  rule(false);
  for (const n of m.notices) {
    y += text(n, C, 7.5, 'bold', 'center') + 1 * k;
  }
  for (const [label, value] of m.meta as [string, string][]) pair(label, value);
  y += 0.5 * k;
  rule();
  for (const i of m.items) {
    y += text(i.title, L, 8.6, 'bold') + 0.3 * k;
    const subline = [i.subtitle, ...i.meta].filter(Boolean).join(' · ');
    if (subline) y += text(subline, L, 6.8) + 0.6 * k;
    pair('Amount', i.amount, 7.8);
    if (i.paidBefore) pair('Paid before', i.paidBefore, 7.8);
    if (i.paidNow) pair('Paid now', i.paidNow, 7.8);
    if (i.balance) pair('Balance', i.balance, 7.8, 'bold');
    y += 1 * k;
  }
  if (m.items.length) rule();
  m.totals.forEach((t, n) => {
    const last = n === m.totals.length - 1 && t.strong;
    if (last) {
      y += 0.5 * k;
      rule(false);
    }
    pair(t.label, t.value, last ? 9.6 : 8, t.strong ? 'bold' : 'normal');
  });
  if (m.account.length) {
    rule();
    for (const a of m.account) pair(a.label, a.value, 7.8);
  }
  if (m.note) {
    y += 1 * k;
    y += text(`Note: ${m.note}`, L, 7, 'italic');
  }
  if (m.adjustments.length) {
    y += 1.5 * k;
    y += text('LATER ADJUSTMENTS', L, 7.8, 'bold') + 0.5 * k;
    for (const a of m.adjustments) {
      y += text(`${a.label} · ${a.ref} · ${m.itemHeading ?? 'Job'} ${a.job}`, L, 7, 'bold');
      for (const line of a.lines) y += text(line, L + 1.5 * k, 6.5, 'normal', 'left', U - 1.5 * k);
      y += 1 * k;
    }
  }
  if (m.termsAndConditions) {
    y += 2.5 * k;
    y += text('Terms & conditions', L, 8, 'bold');
    for (const row of m.termsAndConditions.split('\n')) y += text(row || ' ', L, 7, 'normal', 'left', U);
  }
  if (m.footer) {
    y += 2.5 * k;
    y += text(m.footer, C, 8, 'normal', 'center');
  }
  y += 1.5 * k;
  y += text(`${m.title} ${m.number}`, C, 6.5, 'normal', 'center');
  if (credit) {
    y += 1 * k;
    y += text(credit, C, 6.5, 'normal', 'center');
  }
  return y + media.margins.bottom;
}

const mediaFor = (size: ReceiptPdfSize): ReceiptMedia =>
  size === 'a4' ? A4_RECEIPT : size === 'roll' ? ROLL_80_RECEIPT : size;

/** Build the receipt for a paper size. Roll pages are cut to the content's length. */
export function createReceiptPdf(
  record: CheckoutRecord,
  business: string | Branding,
  pending = false,
  adjustments: SaleAdjustment[] = [],
  size: ReceiptPdfSize = 'a4',
) {
  const warning = receiptIntegrityError(record);
  if (warning) throw Error(warning);
  const media = mediaFor(size);
  return modelPdf(receiptModel(record, business, pending, adjustments, media.layout), media, business);
}
/**
 * Draw a receipt-shaped model (a receipt, quotation or comparison) on a page or a roll, with the
 * business's watermark and, where Developer turned it on, the installer credit.
 */
function modelPdf(m: Model, media: ReceiptMedia, business: string | Branding) {
  const watermark = resolveWatermark(receiptBusiness(business));
  const credit = poweredByLine(business, media.layout === 'roll' ? 'receipts' : 'pages');
  if (media.layout === 'roll') {
    // Measure on a long strip, then draw again on a page exactly as tall as the content.
    const probe = new jsPDF({ unit: 'mm', format: [media.width, 3000] });
    registerPdfFonts(probe);
    const height = Math.max(media.width, Math.ceil(drawRoll(probe, m, media, credit)));
    const doc = new jsPDF({
      unit: 'mm',
      format: [media.width, height],
      orientation: height >= media.width ? 'portrait' : 'landscape',
    });
    registerPdfFonts(doc);
    drawRoll(doc, m, media, credit);
    return doc;
  }
  const doc = new jsPDF({
    unit: 'mm',
    format: [media.width, media.height],
    orientation: media.height >= media.width ? 'portrait' : 'landscape',
  });
  registerPdfFonts(doc);
  drawPage(doc, m, media, watermark, credit);
  return doc;
}
/** A quotation as a PDF, on A4 or an 80 mm roll, with the business's receipt look. */
export function createQuotationPdf(
  quote: Quotation,
  business: string | Branding,
  size: ReceiptPdfSize = 'a4',
) {
  const media = mediaFor(size);
  return modelPdf(quotationModel(quote, business, media.layout) as unknown as Model, media, business);
}
export function downloadQuotationPdf(
  quote: Quotation,
  business: string | Branding,
  size: 'a4' | 'roll' = 'a4',
) {
  createQuotationPdf(quote, business, size).save(
    `Quotation-${quotationRef(quote.id)}${size === 'roll' ? '-80mm' : ''}.pdf`,
  );
}
/** Open the quotation PDF in a new tab, where it can be printed or shared. */
export function openQuotationPdf(quote: Quotation, business: string | Branding, size: 'a4' | 'roll' = 'a4') {
  const url = createQuotationPdf(quote, business, size).output('bloburl');
  window.open(String(url), '_blank', 'noopener');
}
export function downloadReceiptPdf(
  record: CheckoutRecord,
  business: string | Branding,
  pending = false,
  adjustments: SaleAdjustment[] = [],
  size: 'a4' | 'roll' = 'a4',
) {
  createReceiptPdf(record, business, pending, adjustments, size).save(
    `Receipt-${record.id.slice(0, 8).toUpperCase()}${record.corrected ? '-corrected' : ''}${size === 'roll' ? '-80mm' : ''}.pdf`,
  );
}

/** A client comparison of template options as a PDF on A4 or A5, with the business's look. */
export function createComparisonPdf(
  template: Parameters<typeof comparisonModel>[0],
  rows: Parameters<typeof comparisonModel>[1],
  business: string | Branding,
  details: Parameters<typeof comparisonModel>[3],
  size: 'a4' | 'a5' = 'a4',
) {
  return modelPdf(
    comparisonModel(template, rows, business, details) as unknown as Model,
    size === 'a5' ? A5_DOCUMENT : A4_RECEIPT,
    business,
  );
}
