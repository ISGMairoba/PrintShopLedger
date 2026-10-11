import type { jsPDF } from 'jspdf';
import { regular, bold, italic } from './fonts/pdf-fonts';

export const PDF_FONT = 'LedgerSans';
/** Register the embedded font (Latin-1, punctuation and the naira sign) on a document. */
export function registerPdfFonts(doc: jsPDF) {
  doc.addFileToVFS('LedgerSans-Regular.ttf', regular);
  doc.addFont('LedgerSans-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('LedgerSans-Bold.ttf', bold);
  doc.addFont('LedgerSans-Bold.ttf', PDF_FONT, 'bold');
  doc.addFileToVFS('LedgerSans-Italic.ttf', italic);
  doc.addFont('LedgerSans-Italic.ttf', PDF_FONT, 'italic');
  doc.setFont(PDF_FONT, 'normal');
}
// Characters outside the embedded font become "?" rather than an empty box.
export const pdfText = (value: unknown) =>
  String(value ?? '').replace(/[^\x20-\x7e\xa0-\xff\n₦→–—‘’“”…•€×]/g, '?');
/** '#124b40' → [18,75,64]; falls back to the app's green. */
export function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [18, 75, 64];
}
