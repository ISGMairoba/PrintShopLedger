import { useMessages } from './MessagesContext';
import { AdjustmentHistory } from './SaleAdjustmentsPage';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import {
  receiptHtml,
  receiptIntegrityError,
  correctedReceipt,
  receiptLayout,
  currency,
} from './receipts.mjs';
import { loadPrintSettings } from './print-settings.mjs';
import { printReceipt } from './printing';
import type { CheckoutRecord } from './types';
import type { ReceiptPictureSize } from './receipt-pdf';
export default function ReceiptView({
  record: originalRecord,
  ledger,
  business,
  scope,
  pending,
  onClose,
  onCorrectPayment,
  adjustments = [],
}: {
  record: CheckoutRecord;
  ledger?: import('./types').Ledger;
  business: string | import('./useBusinessBranding').Branding;
  scope: string;
  pending: boolean;
  adjustments?: import('./types').SaleAdjustment[];
  onClose: () => void;
  /** Admin or higher: correct the payment on this receipt (amount, method, date, reference). */
  onCorrectPayment?: () => void;
}) {
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./receipt-pdf');
    void import('./share-pdf');
    void import('./canvas-doc').then((m) => m.loadCanvasFonts());
  }, []);
  const messages = useMessages();
  const [busy, setBusy] = useState(false),
    [message, setMessage, messageTone] = useFeedbackMessage('success');
  const [corrected, setCorrected] = useState(false);
  const record =
    corrected && ledger ? (correctedReceipt(originalRecord, ledger) as CheckoutRecord) : originalRecord;
  const warning = receiptIntegrityError(record);
  const settings = loadPrintSettings(scope),
    layout = receiptLayout(settings.width) as 'narrow' | 'wide';
  const html = receiptHtml(record, business, pending, adjustments, { layout });
  async function pdf(size: 'a4' | 'roll') {
    setBusy(true);
    try {
      const { downloadReceiptPdf } = await import('./receipt-pdf');
      // The 80 mm PDF is printed on thermal printers, which need a solid black logo.
      const brand = size === 'roll' ? await (await import('./logo-ink')).withInkLogo(business) : business;
      downloadReceiptPdf(record, brand, pending, adjustments, size);
      setMessage('PDF downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  /** Share the receipt as a PDF (A4) or a picture (phone-shaped), with the receipt message. */
  async function share(kind: 'pdf' | 'image' = 'pdf', picture: ReceiptPictureSize = 'roll') {
    setBusy(true);
    try {
      const [{ createReceiptPdf, createReceiptImage }, { shareFile, shareResult }] = await Promise.all([
        import('./receipt-pdf'),
        import('./share-pdf'),
      ]);
      const name = typeof business === 'string' ? business : business.businessName;
      const ref = `Receipt-${record.id.slice(0, 8).toUpperCase()}`;
      const file =
        kind === 'image'
          ? await createReceiptImage(record, business, pending, adjustments, picture)
          : new File(
              [createReceiptPdf(record, business, pending, adjustments, 'a4').output('blob')],
              `${ref}.pdf`,
              {
                type: 'application/pdf',
              },
            );
      const result = await shareFile(file, {
        title: `Receipt ${record.id.slice(0, 8).toUpperCase()}`,
        text: messages.text(
          'receipt',
          {
            receipt: record.id.slice(0, 8).toUpperCase(),
            paid: currency(record.cashReceived ?? 0),
            balance:
              (record.outstandingAfter ?? 0) > 0
                ? `Balance on your account: ${currency(record.outstandingAfter ?? 0)}.`
                : 'Thank you for your payment.',
            business: name,
          },
          { id: record.customerId, name: record.customerSnapshot?.name ?? '' },
        ),
        phone: record.customerSnapshot?.phone,
        mode: messages.mode('receipt'),
      });
      setMessage(shareResult(result, kind === 'image' ? 'picture' : 'PDF'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  const [menu, setMenu] = useState<'' | 'print' | 'share' | 'download'>('');
  const toggle = (next: 'print' | 'share' | 'download') => setMenu((m) => (m === next ? '' : next));
  /** Do one of the choices, then close the choices. */
  async function run(action: () => Promise<void>) {
    await action();
    setMenu('');
  }
  async function print() {
    setBusy(true);
    try {
      await printReceipt(settings, record, business, pending, adjustments);
      setMessage('Receipt submitted to the printer.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause), 'error');
    } finally {
      setBusy(false);
    }
  }
  /** The receipt on its own page, printed with the browser's printing (any printer it knows). */
  async function openPrintPage() {
    const page = window.open('', '_blank');
    if (!page) {
      setMessage('Allow pop-ups for this app to open the print page.', 'error');
      return;
    }
    page.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Receipt ${record.id
        .slice(0, 8)
        .toUpperCase()}</title><style>body{margin:0;padding:12px;background:#fff;color:#000;font-family:system-ui,sans-serif}</style></head><body><div class="receipt-sheet ${layout}">${html}</div><script>window.onload=function(){window.print()}</script></body></html>`,
    );
    page.document.close();
  }
  async function downloadPicture(picture: ReceiptPictureSize = 'roll') {
    setBusy(true);
    try {
      const [{ createReceiptImage }, { downloadFile }] = await Promise.all([
        import('./receipt-pdf'),
        import('./share-pdf'),
      ]);
      downloadFile(await createReceiptImage(record, business, pending, adjustments, picture));
      setMessage('Picture downloaded.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Receipt ${record.id.slice(0, 8).toUpperCase()}`} wide busy={busy} onClose={onClose}>
      {warning && (
        <p className="notice" role="alert">
          {warning}
        </p>
      )}
      <>
        {adjustments.length > 0 && (
          <section className="panel">
            <p className="notice notice-warning">
              {corrected
                ? 'Corrected receipt with current balances. The original remains available.'
                : 'This is the original receipt. It has later adjustments shown below.'}
            </p>
            {ledger && (
              <button className="secondary" disabled={busy} onClick={() => setCorrected((v) => !v)}>
                <Icon name="details" /> {corrected ? 'Original receipt' : 'Corrected receipt'}
              </button>
            )}
            <AdjustmentHistory records={adjustments} />
          </section>
        )}
      </>
      <div className={`receipt-sheet ${layout}`} dangerouslySetInnerHTML={{ __html: html }} />
      <FeedbackBanner message={message} tone={messageTone} />
      <div className="receipt-actions">
        <button disabled={busy || !!warning} aria-expanded={menu === 'print'} onClick={() => toggle('print')}>
          <Icon name="services" /> {busy ? 'Working…' : 'Print'}
        </button>
        <button
          className="secondary"
          disabled={busy || !!warning}
          aria-expanded={menu === 'share'}
          onClick={() => toggle('share')}
        >
          <Icon name="share" /> Share
        </button>
        <button
          className="secondary"
          disabled={busy || !!warning}
          aria-expanded={menu === 'download'}
          onClick={() => toggle('download')}
        >
          <Icon name="export" /> Download
        </button>
        {onCorrectPayment && (
          <button className="secondary" disabled={busy || pending} onClick={onCorrectPayment}>
            <Icon name="edit" /> Correct payment
          </button>
        )}
      </div>
      {menu === 'print' && (
        <div className="receipt-choices" role="group" aria-label="Print">
          <button disabled={busy} onClick={() => void run(print)}>
            <Icon name="services" /> Print ({settings.paper})
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(openPrintPage)}>
            <Icon name="details" /> Open print page
          </button>
          <small>
            Print uses Print Settings ({settings.paper}, {settings.orientation}): receipt rolls get the
            till-roll layout, larger paper the page layout. The print page opens the browser's own printing.
          </small>
        </div>
      )}
      {menu === 'share' && (
        <div className="receipt-choices" role="group" aria-label="Share">
          <button disabled={busy} onClick={() => void run(() => share('pdf'))}>
            <Icon name="share" /> PDF
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => share('image', 'roll'))}
          >
            <Icon name="share" /> Picture (80mm)
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => share('image', 'a5'))}>
            <Icon name="share" /> Picture (A5)
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => share('image', 'a4'))}>
            <Icon name="share" /> Picture (A4)
          </button>
          <small>Then choose WhatsApp (the customer's chat) or another app.</small>
        </div>
      )}
      {menu === 'download' && (
        <div className="receipt-choices" role="group" aria-label="Download">
          <button disabled={busy} onClick={() => void run(() => pdf('a4'))}>
            <Icon name="export" /> PDF (A4)
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => pdf('roll'))}>
            <Icon name="export" /> PDF (80mm)
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run(() => downloadPicture('roll'))}
          >
            <Icon name="export" /> Picture (80mm)
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => downloadPicture('a5'))}>
            <Icon name="export" /> Picture (A5)
          </button>
          <button className="secondary" disabled={busy} onClick={() => void run(() => downloadPicture('a4'))}>
            <Icon name="export" /> Picture (A4)
          </button>
        </div>
      )}
    </Modal>
  );
}
