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
  async function share(kind: 'pdf' | 'image' = 'pdf') {
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
          ? await createReceiptImage(record, business, pending, adjustments)
          : new File([createReceiptPdf(record, business, pending, adjustments, 'a4').output('blob')], `${ref}.pdf`, {
              type: 'application/pdf',
            });
      const result = await shareFile(
        file,
        {
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
        },
      );
      setMessage(shareResult(result, kind === 'image' ? 'picture' : 'PDF'));
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
        <button
          disabled={busy || !!warning}
          onClick={async () => {
            setBusy(true);
            try {
              await printReceipt(settings, record, business, pending, adjustments);
              setMessage('Receipt submitted to the printer.');
            } catch (cause) {
              setMessage(cause instanceof Error ? cause.message : String(cause), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="services" /> {busy ? 'Printing…' : 'Print receipt'}
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void share('pdf')}>
          <Icon name="share" /> Share PDF
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void share('image')}>
          <Icon name="share" /> Share as picture
        </button>
        <button
          className="secondary"
          disabled={busy || !!warning}
          onClick={async () => {
            setBusy(true);
            try {
              const [{ createReceiptImage }, { downloadFile }] = await Promise.all([
                import('./receipt-pdf'),
                import('./share-pdf'),
              ]);
              downloadFile(await createReceiptImage(record, business, pending, adjustments));
              setMessage('Picture downloaded.');
            } catch (error) {
              setMessage(error instanceof Error ? error.message : String(error), 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="export" /> Download picture
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void pdf('a4')}>
          <Icon name="export" /> Download PDF (A4)
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void pdf('roll')}>
          <Icon name="export" /> Download PDF (80mm)
        </button>
        {onCorrectPayment && (
          <button className="secondary" disabled={busy || pending} onClick={onCorrectPayment}>
            <Icon name="edit" /> Correct payment
          </button>
        )}
        <small>
          Printing uses the paper in Print Settings ({settings.paper}, {settings.orientation}): receipt rolls
          get the till-roll layout, larger paper gets the page layout — the same as the A4 PDF.
        </small>
      </div>
    </Modal>
  );
}
