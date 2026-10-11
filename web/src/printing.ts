import {
  loadPrintSettings,
  validatePrintSettings,
  qzOptions,
  qzPdfOptions,
  receiptMedia,
  printDocument,
} from './print-settings.mjs';
import type { CheckoutRecord, SaleAdjustment } from './types';
import type { Branding } from './useBusinessBranding';
export type PrintSettings = {
  printer: string;
  paper: string;
  width: number;
  height: number;
  orientation: string;
  font: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
  copies: number;
  paperSource: string;
  autoPrint: boolean;
};
// QZ's package is bundled locally so connecting also works when the app is offline.
let connection: Promise<any> | null = null;
export async function connectPrinter() {
  if (connection) return connection;
  connection = (async () => {
    const { default: qz } = await import('qz-tray');
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 0 });
    return qz;
  })();
  try {
    return await connection;
  } finally {
    connection = null;
  }
}
export async function discoverPrinters(): Promise<{ printers: string[]; defaultPrinter: string }> {
  const qz = await connectPrinter();
  const printers = await qz.printers.find();
  let defaultPrinter = '';
  try {
    defaultPrinter = await qz.printers.getDefault();
  } catch {
    /* Manual selection remains available. */
  }
  return { printers, defaultPrinter };
}
export async function printHtml(settings: PrintSettings, title: string, body: string) {
  const s = validatePrintSettings(settings);
  if (!s.printer) throw new Error('Select a printer in Print Settings first.');
  const qz = await connectPrinter();
  const printers: string[] = await qz.printers.find();
  if (!printers.includes(s.printer))
    throw new Error('The saved printer is unavailable. Connect it or select another printer.');
  await qz.print(qz.configs.create(s.printer, qzOptions(s, title)), [
    { type: 'pixel', format: 'html', flavor: 'plain', data: printDocument(s, title, body) },
  ]);
}
async function readyPrinter(s: PrintSettings) {
  if (!s.printer) throw new Error('Select a printer in Print Settings first.');
  const qz = await connectPrinter();
  const printers: string[] = await qz.printers.find();
  if (!printers.includes(s.printer))
    throw new Error('The saved printer is unavailable. Connect it or select another printer.');
  return qz;
}
/** Print a PDF that is already laid out for the paper (no extra margins or scaling). */
export async function printPdf(
  settings: PrintSettings,
  title: string,
  base64: string,
  pageHeight: number | null = null,
) {
  const s = validatePrintSettings(settings);
  const qz = await readyPrinter(s);
  await qz.print(
    qz.configs.create(
      s.printer,
      (qzPdfOptions as (s: PrintSettings, name: string, height: number | null) => object)(
        s,
        title,
        pageHeight,
      ),
    ),
    [{ type: 'pixel', format: 'pdf', flavor: 'base64', data: base64 }],
  );
}
/**
 * Print a receipt drawn for the paper in Print Settings: till-roll layout on paper up to 90 mm
 * wide (cut to length), page layout otherwise — on A4 identical to the downloaded PDF.
 */
export async function printReceipt(
  settings: PrintSettings,
  record: CheckoutRecord,
  business: string | Branding,
  pending = false,
  adjustments: SaleAdjustment[] = [],
) {
  const s = validatePrintSettings(settings);
  await readyPrinter(s);
  const { createReceiptPdf } = await import('./receipt-pdf');
  const media = receiptMedia(s) as import('./receipt-pdf').ReceiptMedia;
  const doc = createReceiptPdf(record, business, pending, adjustments, media);
  const base64 = (doc.output('datauristring') as string).split(',')[1];
  const pageHeight = media.layout === 'roll' ? doc.internal.pageSize.getHeight() : null;
  await printPdf(s, `Receipt ${record.id.slice(0, 8).toUpperCase()}`, base64, pageHeight);
}
// Call only after a transaction is durably saved. Sync, refresh and replay must never call this.
// Returning a separate result lets checkout report print errors without undoing the transaction.
export async function printAfterTransaction(
  scope: string,
  requiresPrinting: boolean,
  job: (settings: PrintSettings) => Promise<void>,
) {
  if (!requiresPrinting) return { status: 'skipped' as const };
  try {
    const settings = loadPrintSettings(scope);
    if (!settings.autoPrint) return { status: 'skipped' as const };
    await job(settings);
    return { status: 'submitted' as const };
  } catch (error) {
    return { status: 'failed' as const, message: error instanceof Error ? error.message : String(error) };
  }
}
