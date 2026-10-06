import { loadPrintSettings, validatePrintSettings, qzOptions, printDocument } from './print-settings.mjs';
export type PrintSettings = {
  printer: string; paper: string; width: number; height: number; orientation: string;
  font: string; fontSize: number; bold: boolean; italic: boolean; color: boolean;
  margins: { top: number; right: number; bottom: number; left: number };
  copies: number; paperSource: string; autoPrint: boolean;
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
  try { return await connection; } finally { connection = null; }
}
export async function discoverPrinters(): Promise<{ printers: string[]; defaultPrinter: string }> {
  const qz = await connectPrinter();
  const printers = await qz.printers.find();
  let defaultPrinter = '';
  try { defaultPrinter = await qz.printers.getDefault(); } catch { /* Manual selection remains available. */ }
  return { printers, defaultPrinter };
}
export async function printHtml(settings: PrintSettings, title: string, body: string) {
  const s = validatePrintSettings(settings);
  if (!s.printer) throw new Error('Select a printer in Print Settings first.');
  const qz = await connectPrinter();
  const printers: string[] = await qz.printers.find();
  if (!printers.includes(s.printer)) throw new Error('The saved printer is unavailable. Connect it or select another printer.');
  await qz.print(qz.configs.create(s.printer, qzOptions(s, title)), [
    { type: 'pixel', format: 'html', flavor: 'plain', data: printDocument(s, title, body) },
  ]);
}
// Call only after a transaction is durably saved. Sync, refresh and replay must never call this.
// Returning a separate result lets checkout report print errors without undoing the transaction.
export async function printAfterTransaction(scope: string, title: string, body: string, requiresPrinting: boolean) {
  if (!requiresPrinting) return { status: 'skipped' as const };
  try {
    const settings = loadPrintSettings(scope);
    if (!settings.autoPrint) return { status: 'skipped' as const };
    await printHtml(settings, title, body);
    return { status: 'submitted' as const };
  } catch (error) { return { status: 'failed' as const, message: error instanceof Error ? error.message : String(error) }; }
}
