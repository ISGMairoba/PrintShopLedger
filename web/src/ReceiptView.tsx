import { AdjustmentHistory } from './SaleAdjustmentsPage';
import { useFeedbackMessage, FeedbackBanner } from './Feedback';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { receiptHtml, receiptIntegrityError, correctedReceipt, receiptLayout } from './receipts.mjs';
import { loadPrintSettings } from './print-settings.mjs';
import { printReceipt } from './printing';
import type { CheckoutRecord } from './types';
import { receiptMessage } from './share.mjs';
export default function ReceiptView({
  record: originalRecord,
  ledger,
  business,
  scope,
  pending,
  onClose,
  adjustments = [],
}: {
  record: CheckoutRecord;
  ledger?: import('./types').Ledger;
  business: string | import('./useBusinessBranding').Branding;
  scope: string;
  pending: boolean;
  adjustments?: import('./types').SaleAdjustment[];
  onClose: () => void;
}) {
  // Load the PDF and share code now: phones only open the share sheet straight after the tap.
  useEffect(() => {
    void import('./receipt-pdf');
    void import('./share-pdf');
  }, []);
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
  async function share() {
    setBusy(true);
    try {
      const [{ createReceiptPdf }, { sharePdf, shareResult }] = await Promise.all([
        import('./receipt-pdf'),
        import('./share-pdf'),
      ]);
      const name = typeof business === 'string' ? business : business.businessName;
      const result = await sharePdf(
        createReceiptPdf(record, business, pending, adjustments, 'a4'),
        `Receipt-${record.id.slice(0, 8).toUpperCase()}`,
        {
          title: `Receipt ${record.id.slice(0, 8).toUpperCase()}`,
          text: receiptMessage(record, name),
          phone: record.customerSnapshot?.phone,
        },
      );
      setMessage(shareResult(result));
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
                {corrected ? 'Original receipt' : 'Corrected receipt'}
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
        <button className="secondary" disabled={busy || !!warning} onClick={() => void share()}>
          <Icon name="share" /> Share
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void pdf('a4')}>
          Download PDF (A4)
        </button>
        <button className="secondary" disabled={busy || !!warning} onClick={() => void pdf('roll')}>
          Download PDF (80mm)
        </button>
        <small>
          Printing uses the paper in Print Settings ({settings.paper}, {settings.orientation}): receipt rolls
          get the till-roll layout, larger paper gets the page layout — the same as the A4 PDF.
        </small>
      </div>
    </Modal>
  );
}
