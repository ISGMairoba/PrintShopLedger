import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { walletBalance } from './checkout.mjs';
import { money, customerBalance } from './domain.mjs';
import { currency } from './receipts.mjs';
import { paymentCorrectionEvent, previewPaymentCorrection } from './payment-correction.mjs';
import { useWords } from './Words';
import type { Ledger, Payment, SupervisedEvent } from './types';

/**
 * Correct a payment from the payment itself: amount, method, date and reference, with a reason.
 * ₦0 removes a duplicate. Admin, Manager or Developer, online (the server checks this too).
 */
export default function PaymentCorrectionDialog({
  ledger,
  payment,
  busy,
  actor,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  payment: Payment;
  busy: boolean;
  actor: { id: string; label: string };
  onClose: () => void;
  onSave: (event: SupervisedEvent) => Promise<void>;
}) {
  const { w } = useWords();
  const methods = useBusinessOptions().paymentMethods.filter((m) => m.enabled);
  const [amount, setAmount] = useState(String(payment.amount / 100)),
    [method, setMethod] = useState(payment.methodLabel ?? payment.method),
    [paidOn, setPaidOn] = useState(payment.paidOn),
    [reference, setReference] = useState(payment.reference),
    [reason, setReason] = useState(''),
    [error, setError] = useFeedbackMessage('error');
  const [id] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState<SupervisedEvent | null>(null);
  const formId = useId();
  const customer = ledger.customers.find((c) => c.id === payment.customerId);
  const jobName = (jobId: string) =>
    ledger.jobs.find((j) => j.id === jobId)?.description ?? jobId.slice(0, 8);

  function event(why = reason) {
    const chosen = methods.find((m) => m.label === method);
    return paymentCorrectionEvent(
      ledger,
      payment,
      {
        amount: money(amount),
        method: chosen?.kind ?? payment.method,
        methodLabel: chosen?.label ?? method,
        paidOn,
        reference,
        reason: why,
      },
      actor,
      id,
    );
  }
  // Before → after, worked out exactly as saving will.
  let next: Ledger | null = null,
    notice = '';
  try {
    next = previewPaymentCorrection(ledger, event(reason.trim() || 'Preview'));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message !== 'Nothing changed.') notice = message;
  }
  const after = next?.payments.find((p) => p.id === payment.id);
  const rows: [string, string, string][] = [
    ['Amount', currency(payment.amount), currency(after?.amount ?? payment.amount)],
    ['Method', payment.methodLabel ?? payment.method, after?.methodLabel ?? after?.method ?? '—'],
    ['Date', payment.paidOn, after?.paidOn ?? payment.paidOn],
    ['Reference', payment.reference || '—', (after ?? payment).reference || '—'],
  ];
  for (const jobId of new Set([
    ...payment.allocations.map((a) => a.jobId),
    ...(after?.allocations.map((a) => a.jobId) ?? []),
  ]))
    rows.push([
      `${w('Paid to')} ${jobName(jobId)}`,
      currency(payment.allocations.find((a) => a.jobId === jobId)?.amount ?? 0),
      currency(after?.allocations.find((a) => a.jobId === jobId)?.amount ?? 0),
    ]);
  if (next) {
    rows.push([
      'Customer credit',
      currency(walletBalance(ledger, payment.customerId)),
      currency(walletBalance(next, payment.customerId)),
    ]);
    rows.push([
      'Customer owes',
      currency(customerBalance(ledger, payment.customerId)),
      currency(customerBalance(next, payment.customerId)),
    ]);
  }
  const changed = rows.filter(([, a, b]) => a !== b);

  return (
    <Modal
      title="Correct payment"
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {submitted ? 'Retry same correction' : 'Save correction'}
        </DialogActions>
      }
    >
      <p>
        {customer?.name ?? 'Customer'} · {w('Payment')} #{payment.id.slice(0, 8).toUpperCase()} ·{' '}
        {currency(payment.amount)} · {payment.methodLabel ?? payment.method} · {payment.paidOn}
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
            const command = submitted ?? event();
            previewPaymentCorrection(ledger, command);
            setSubmitted(command);
            await onSave(command);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy || !!submitted}>
          <div className="form-grid">
            <label>
              Amount paid (₦)
              <CurrencyInput value={amount} onValueChange={setAmount} required />
            </label>
            <label>
              Payment method
              <select value={method} onChange={(e) => setMethod(e.target.value)} required>
                {!methods.some((m) => m.label === method) && method && <option>{method}</option>}
                {methods.map((m) => (
                  <option key={m.label}>{m.label}</option>
                ))}
              </select>
            </label>
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
              'Entered twice by mistake? Set the amount to ₦0: the jobs it paid show as owed again. A wrong amount: more pays what is owed, then becomes credit; less takes back unspent credit first. The original stays in Sale Adjustments history.',
            )}
          </p>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={500}
              placeholder={w('For example: recorded twice; customer paid by POS, not cash')}
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
