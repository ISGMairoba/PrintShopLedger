import SearchSelect from './SearchSelect';
import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { walletBalance } from './checkout.mjs';
import { money, customerBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { splitCorrectionEvents } from './payment-correction.mjs';
import { useWords } from './Words';
import type { Ledger, Payment, SupervisedEvent } from './types';

type Part = { paymentId: string; amount: string; method: string };

/**
 * Correct a split sale as one: each part's amount and method, with one date, reference and reason. The
 * parts that change are saved together, all or none (each is a payment correction). ₦0 removes a part.
 */
export default function SplitCorrectionDialog({
  ledger,
  payments,
  busy,
  actor,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  payments: Payment[];
  busy: boolean;
  actor: { id: string; label: string };
  onClose: () => void;
  /** Saves every changed part together: all are saved or none. */
  onSave: (events: SupervisedEvent[]) => Promise<void>;
}) {
  const { w } = useWords();
  const methods = useBusinessOptions().paymentMethods.filter((m) => m.enabled);
  const first = payments[0];
  const [parts, setParts] = useState<Part[]>(() =>
    payments.map((p) => ({
      paymentId: p.id,
      amount: String(p.amount / 100),
      method: p.methodLabel ?? p.method,
    })),
  );
  const [paidOn, setPaidOn] = useState(first.paidOn),
    [reference, setReference] = useState(first.reference),
    [reason, setReason] = useState(''),
    [error, setError] = useFeedbackMessage('error');
  const formId = useId();
  const customer = ledger.customers.find((c) => c.id === first.customerId);
  const changes = () =>
    parts.map((part) => {
      const original = payments.find((p) => p.id === part.paymentId)!;
      const chosen = methods.find((m) => m.label === part.method);
      return {
        paymentId: part.paymentId,
        amount: money(part.amount || '0'),
        method: chosen?.kind ?? original.method,
        methodLabel: chosen?.label ?? part.method,
      };
    });
  let after: Ledger | null = null,
    notice = '';
  try {
    after = splitCorrectionEvents(
      ledger,
      changes(),
      { paidOn, reference, reason: reason.trim() || 'Preview' },
      actor,
    ).after;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message !== 'Nothing changed.') notice = message;
  }
  const total = (l: Ledger) =>
    payments.reduce((n, p) => n + (l.payments.find((x) => x.id === p.id)?.amount ?? 0), 0);
  const rows: [string, string, string][] = payments.map((p, i) => {
    const now = after?.payments.find((x) => x.id === p.id);
    return [
      `Part ${i + 1}`,
      `${p.methodLabel ?? p.method} ${currency(p.amount)}`,
      now
        ? `${now.methodLabel ?? now.method} ${currency(now.amount)}`
        : `${p.methodLabel ?? p.method} ${currency(p.amount)}`,
    ];
  });
  if (after) {
    rows.push(['Total paid', currency(total(ledger)), currency(total(after))]);
    rows.push(['Date', first.paidOn, paidOn]);
    rows.push(['Reference', first.reference || '—', reference.trim() || '—']);
    rows.push([
      'Customer credit',
      currency(walletBalance(ledger, first.customerId)),
      currency(walletBalance(after, first.customerId)),
    ]);
    rows.push([
      'Customer owes',
      currency(customerBalance(ledger, first.customerId)),
      currency(customerBalance(after, first.customerId)),
    ]);
  }
  const changed = rows.filter(([, a, b]) => a !== b);

  return (
    <Modal
      title="Correct split payment"
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save correction
        </DialogActions>
      }
    >
      <p>
        {customer?.name ?? 'Customer'} · Sale #{(first.checkoutId ?? first.id).slice(0, 8).toUpperCase()} ·{' '}
        {currency(total(ledger))} in {payments.length} parts · {first.paidOn}
      </p>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="supervisor-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            if (!reason.trim()) throw Error('Give a reason for the correction.');
            const { events } = splitCorrectionEvents(ledger, changes(), { paidOn, reference, reason }, actor);
            await onSave(events);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          {parts.map((part, index) => (
            <div className="form-grid" key={part.paymentId}>
              <label>
                {`Part ${index + 1}: amount (₦)`}
                <CurrencyInput
                  value={part.amount}
                  required
                  onValueChange={(amount) =>
                    setParts((all) => all.map((p, i) => (i === index ? { ...p, amount } : p)))
                  }
                />
              </label>
              <label>
                {`Part ${index + 1}: method`}
                <SearchSelect
                  label={`Part ${index + 1}: method`}
                  value={part.method}
                  required
                  onChange={(method) => setParts((all) => all.map((p, i) => (i === index ? { ...p, method } : p)))}
                  options={[
                    ...(methods.some((m) => m.label === part.method)
                      ? []
                      : [{ value: part.method, label: part.method }]),
                    ...methods.map((m) => ({ value: m.label, label: m.displayLabel || m.label })),
                  ]}
                />
              </label>
            </div>
          ))}
          <div className="form-grid">
            <label>
              Payment date
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
            </label>
            <label>
              Reference
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={500} />
            </label>
          </div>
          <p className="muted">
            {w(
              'Change the amount or method of any part; ₦0 removes a part. More pays what is owed, then becomes credit; less takes back unspent credit first. The original stays in Sale Adjustments history.',
            )}
          </p>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={500}
              placeholder={w('For example: the transfer part was POS; customer paid ₦1,000 more in cash')}
            />
          </label>
        </fieldset>
        <section className="correction-comparison" aria-label="Correction comparison">
          <h3>Review changes</h3>
          {changed.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col">Original</th>
                  <th scope="col">Corrected</th>
                </tr>
              </thead>
              <tbody>
                {changed.map(([label, before, value]) => (
                  <tr key={label} className="comparison-changed">
                    <th scope="row">{label}</th>
                    <td>{before}</td>
                    <td>
                      <strong>{value}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{w('Nothing changed yet.')}</p>
          )}
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
        </section>
      </form>
    </Modal>
  );
}
