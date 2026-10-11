import {
  loadPrintSettings,
  validatePrintSettings,
  qzOptions,
  qzPdfOptions,
  directPrintLayout,
  printDocument,
  printerMedia,
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
// Trusted printing: QZ Tray requests are signed with the business key on the server (see
// src/print-signing.mjs). Without a signer, offline, or on failure, requests go unsigned and
// QZ Tray asks for approval as before.
type Signer = { shopId: string; invoke: (body: object) => Promise<{ data: any; error: unknown }> };
let signer: Signer | null = null;
const certificateKey = (shopId: string) => `printshopledger:qz-certificate:v1:${shopId}`;
/** The business whose certificate QZ Tray is shown; call when the workspace changes. */
export function setPrintSigner(next: Signer | null) {
  if (next?.shopId === signer?.shopId) {
    signer = next;
    return;
  }
  signer = next;
  // QZ Tray reads the certificate when connecting, so reconnect for a different business.
  void import('qz-tray').then(({ default: qz }) => {
    if (qz.websocket.isActive()) void qz.websocket.disconnect().catch(() => {});
  });
}
/** The business printing certificate (PEM), cached on this device so it also works offline. */
export async function printCertificate(): Promise<string> {
  const current = signer;
  if (!current) throw new Error('Sign in to a business workspace first.');
  let cached = '';
  try {
    cached = localStorage.getItem(certificateKey(current.shopId)) ?? '';
  } catch {
    /* Storage unavailable. */
  }
  if (cached && !navigator.onLine) return cached;
  const { data, error } = await current.invoke({ shopId: current.shopId, action: 'certificate' });
  if (error || typeof data?.certificate !== 'string') {
    if (cached) return cached;
    throw new Error('Could not load the printing certificate. Check your connection and try again.');
  }
  try {
    localStorage.setItem(certificateKey(current.shopId), data.certificate);
  } catch {
    /* Storage unavailable. */
  }
  return data.certificate;
}
let securityReady = false;
function configureSecurity(qz: any) {
  if (securityReady) return;
  securityReady = true;
  qz.security.setCertificatePromise((resolve: (value?: string) => void) => {
    if (!signer) return resolve();
    printCertificate().then(resolve, () => resolve());
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign: string) => (resolve: (value?: string) => void) => {
    const current = signer;
    if (!current || !navigator.onLine) return resolve();
    current.invoke({ shopId: current.shopId, action: 'sign', toSign }).then(
      ({ data, error }) =>
        resolve(!error && typeof data?.signature === 'string' ? data.signature : undefined),
      () => resolve(),
    );
  });
}
// QZ's package is bundled locally so connecting also works when the app is offline.
let connection: Promise<any> | null = null;
export async function connectPrinter() {
  if (connection) return connection;
  connection = (async () => {
    const { default: qz } = await import('qz-tray');
    configureSecurity(qz);
    if (!qz.websocket.isActive()) await qz.websocket.connect({ retries: 0 });
    return qz;
  })();
  try {
    return await connection;
  } finally {
    connection = null;
  }
}
export type PrinterMedia = { sizes: { name: string; width: number; height: number }[]; trays: string[] };
export async function discoverPrinters(): Promise<{
  printers: string[];
  defaultPrinter: string;
  media: Record<string, PrinterMedia>;
}> {
  const qz = await connectPrinter();
  const printers = await qz.printers.find();
  let defaultPrinter = '';
  try {
    defaultPrinter = await qz.printers.getDefault();
  } catch {
    /* Manual selection remains available. */
  }
  // Paper sizes and trays come from the printer driver (QZ Tray 2.2.3+). Older versions or a
  // failed lookup leave the list empty and Print Settings falls back to common sizes.
  const media: Record<string, PrinterMedia> = {};
  try {
    const details: { name: string }[] = await qz.printers.details();
    for (const item of Array.isArray(details) ? details : [])
      if (item?.name) media[item.name] = printerMedia(item) as PrinterMedia;
  } catch {
    /* Sizes stay unavailable. */
  }
  return { printers, defaultPrinter, media };
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
  // Drawn for the area the printer can reach, so roll printers do not shift or cut the right side.
  const media = (directPrintLayout(s) as { media: import('./receipt-pdf').ReceiptMedia }).media;
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
