import { useEffect, useRef, useState } from 'react';
import type { jsPDF } from 'jspdf';
import Icon from './Icon';
import { loadPrintSettings } from './print-settings.mjs';
import { receiptLayout } from './receipts.mjs';
import type { DocSize, ReceiptMedia } from './receipt-pdf';

type Pdfs = typeof import('./receipt-pdf');
import type { ShareMode } from './share-choice';
import type { Branding } from './useBusinessBranding';

type Business = string | Branding;
export type DocumentNotice = (message: string, tone?: 'success' | 'error') => void;

const sizeLabel = (size: DocSize) => (size === 'roll' ? '80mm' : size.toUpperCase());

/**
 * Print, Share and Download for a document shaped like a receipt (a quotation, price options), the
 * same way receipts offer them (ReceiptView): each button opens its choices under the buttons.
 * - Print: on the printer in Print Settings (roll or page layout to suit its paper), or a PDF in a
 *   new tab to print from the browser.
 * - Share: a PDF (A4), a picture (80 mm, A5 or A4), or the text for clients who will not open files.
 * - Download: a PDF or a picture in each size.
 */
export default function DocumentActions({
  scope,
  business,
  title,
  fileName,
  disabled = false,
  pdf,
  picture,
  message,
  text,
  onNotice,
}: {
  /** Print Settings' scope (the shop and device). */
  scope: string;
  business: Business;
  /** e.g. "Quotation Q-6F2A91C4": the print job and share title. */
  title: string;
  /** e.g. "Quotation-Q-6F2A91C4": PDF names add -A5 or -80mm. */
  fileName: string;
  disabled?: boolean;
  /** The PDF for a paper, drawn with the PDF code (loaded when needed). */
  pdf: (pdfs: Pdfs, size: DocSize | ReceiptMedia, business: Business) => jsPDF;
  picture: (pdfs: Pdfs, size: DocSize) => Promise<File>;
  /** The message sent with a shared file, to whom, and how (Messages settings). */
  message: { text: string; phone?: string; mode?: ShareMode };
  /** The document as chat text: offered under Share when given. */
  text?: () => string;
  onNotice: DocumentNotice;
}) {
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./receipt-pdf');
    void import('./share-pdf');
    void import('./canvas-doc').then((m) => m.loadCanvasFonts());
  }, []);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<'' | 'print' | 'share' | 'download'>('');
  const toggle = (next: 'print' | 'share' | 'download') => setMenu((m) => (m === next ? '' : next));
  const choices = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    choices.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }, [menu]);
  const settings = loadPrintSettings(scope);
  const paperSize: DocSize = receiptLayout(settings.width) === 'narrow' ? 'roll' : 'a4';
  /** Do one of the choices, report its result, then close the choices. */
  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    try {
      const done = await action();
      if (done) onNotice(done, 'success');
      setMenu('');
    } catch (cause) {
      onNotice(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setBusy(false);
    }
  }
  /** The 80 mm PDF is printed on thermal printers, which need a solid black logo. */
  const brandFor = async (size: DocSize) =>
    size === 'roll' ? await (await import('./logo-ink')).withInkLogo(business) : business;
  const pdfName = (size: DocSize) =>
    `${fileName}${size === 'roll' ? '-80mm' : size === 'a5' ? '-A5' : ''}.pdf`;
  const print = () =>
    run(async () => {
      const { printDocumentPdf } = await import('./printing');
      const pdfs = await import('./receipt-pdf');
      await printDocumentPdf(settings, title, business, (media, brand) => pdf(pdfs, media, brand));
      return `${title} submitted to the printer.`;
    });
  const openPrintPage = () =>
    run(async () => {
      const doc = pdf(await import('./receipt-pdf'), paperSize, await brandFor(paperSize));
      // A new tab with the PDF: print it from there.
      window.open(String(doc.output('bloburl')), '_blank', 'noopener');
    });
  const download = (size: DocSize) =>
    run(async () => {
      pdf(await import('./receipt-pdf'), size, await brandFor(size)).save(pdfName(size));
      return 'PDF downloaded.';
    });
  const downloadPicture = (size: DocSize) =>
    run(async () => {
      const { downloadFile } = await import('./share-pdf');
      downloadFile(await picture(await import('./receipt-pdf'), size));
      return 'Picture downloaded.';
    });
  const share = (kind: 'pdf' | 'image', size: DocSize = 'a4') =>
    run(async () => {
      const [pdfs, { shareFile, shareResult }] = await Promise.all([
        import('./receipt-pdf'),
        import('./share-pdf'),
      ]);
      const file =
        kind === 'image'
          ? await picture(pdfs, size)
          : new File([pdf(pdfs, 'a4', business).output('blob')], pdfName('a4'), {
              type: 'application/pdf',
            });
      const result = await shareFile(file, { title, ...message });
      return shareResult(result, kind === 'image' ? 'picture' : 'PDF');
    });
  const shareChat = () =>
    run(async () => {
      const { shareText } = await import('./share-text');
      const result = await shareText(text!(), { title, phone: message.phone, mode: message.mode });
      return result === 'whatsapp' ? 'WhatsApp is open with the text ready to send.' : '';
    });
  const copy = () =>
    run(async () => {
      const { copyText } = await import('./share-text');
      if (!(await copyText(text!()))) throw Error('This browser would not copy. Use Share → Text instead.');
      return 'Text copied. Paste it into the chat.';
    });
  const off = busy || disabled;
  const sizes: DocSize[] = ['roll', 'a5', 'a4'];
  return (
    <>
      <div className="receipt-actions">
        <button type="button" disabled={off} aria-expanded={menu === 'print'} onClick={() => toggle('print')}>
          <Icon name="services" /> {busy ? 'Working…' : 'Print'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={off}
          aria-expanded={menu === 'share'}
          onClick={() => toggle('share')}
        >
          <Icon name="share" /> Share
        </button>
        <button
          type="button"
          className="secondary"
          disabled={off}
          aria-expanded={menu === 'download'}
          onClick={() => toggle('download')}
        >
          <Icon name="export" /> Download
        </button>
      </div>
      {menu === 'print' && (
        <div ref={choices} className="receipt-choices" role="group" aria-label="Print">
          <button type="button" disabled={off} onClick={() => void print()}>
            <Icon name="services" /> Print ({settings.paper})
          </button>
          <button type="button" className="secondary" disabled={off} onClick={() => void openPrintPage()}>
            <Icon name="details" /> Open print page
          </button>
          <small>
            Print uses Print Settings ({settings.paper}, {settings.orientation}): receipt rolls get the
            till-roll layout, larger paper the page layout. The print page opens the PDF to print from the
            browser.
          </small>
        </div>
      )}
      {menu === 'share' && (
        <div ref={choices} className="receipt-choices" role="group" aria-label="Share">
          <button type="button" disabled={off} onClick={() => void share('pdf')}>
            <Icon name="share" /> PDF
          </button>
          {sizes.map((size) => (
            <button
              key={size}
              type="button"
              className="secondary"
              disabled={off}
              onClick={() => void share('image', size)}
            >
              <Icon name="share" /> Picture ({sizeLabel(size)})
            </button>
          ))}
          {text && (
            <>
              <button type="button" className="secondary" disabled={off} onClick={() => void shareChat()}>
                <Icon name="share" /> Text
              </button>
              <button type="button" className="secondary" disabled={off} onClick={() => void copy()}>
                <Icon name="copy" /> Copy text
              </button>
            </>
          )}
          <small>
            Then choose WhatsApp (the customer's chat) or another app.
            {text ? ' Text suits clients who will not open a file.' : ''}
          </small>
        </div>
      )}
      {menu === 'download' && (
        <div ref={choices} className="receipt-choices" role="group" aria-label="Download">
          {(['a4', 'a5', 'roll'] as DocSize[]).map((size, n) => (
            <button
              key={size}
              type="button"
              className={n ? 'secondary' : undefined}
              disabled={off}
              onClick={() => void download(size)}
            >
              <Icon name="export" /> PDF ({sizeLabel(size)})
            </button>
          ))}
          {sizes.map((size) => (
            <button
              key={size}
              type="button"
              className="secondary"
              disabled={off}
              onClick={() => void downloadPicture(size)}
            >
              <Icon name="export" /> Picture ({sizeLabel(size)})
            </button>
          ))}
        </div>
      )}
    </>
  );
}
