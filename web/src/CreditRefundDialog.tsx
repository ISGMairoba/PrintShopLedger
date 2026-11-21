import SearchSelect from './SearchSelect';
import { useId, useState } from 'react';
import DialogActions from './DialogActions';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { walletBalance } from './checkout.mjs';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { applySaleAdjustment, creditRefundEvent } from './sale-adjustments.mjs';
import type { Ledger, SupervisedEvent } from './types';

/**
 * Give a customer back credit they have not used (a deposit with no job, or credit left over): the
 * money goes out of the chosen method's account (the drawer, when cash) and their credit goes down.
 * Who may do it: Business Settings → Corrections (the same ranks as correcting a deposit).
 */
export default function CreditRefundDialog({
  ledger,
  customerId,
  busy,
  actor,
  onClose,
  onSave,
}: {
  ledger: Ledger;
  customerId: string;
  busy: boolean;
  actor: { id: string; label: string };
  onClose: () => void;
  onSave: (event: SupervisedEvent) => Promise<void>;
}) {
  const methods = useBusinessOptions().paymentMethods.filter((m) => m.enabled);
  const credit = walletBalance(ledger, customerId);
  const customer = ledger.customers.find((c) => c.id === customerId);
  const [amount, setAmount] = useState(String(credit / 100)),
    [method, setMethod] = useState(methods.find((m) => m.kind === 'Cash')?.label ?? methods[0]?.label ?? ''),
    [reason, setReason] = useState(''),
    [error, setError] = useFeedbackMessage('error');
  const [id] = useState(() => crypto.randomUUID());
  const [submitted, setSubmitted] = useState<SupervisedEvent | null>(null);
  const formId = useId();
  const event = (why = reason) => {
    const chosen = methods.find((m) => m.label === method);
    if (!chosen) throw Error('Choose a refund payment method.');
    return creditRefundEvent(
      ledger,
      customerId,
      { amount: money(amount || '0'), method: chosen.kind, methodLabel: chosen.label, reason: why },
      actor,
      id,
    ) as SupervisedEvent;
  };
  let left: number | null = null,
    notice = '';
  try {
    left = walletBalance(
      applySaleAdjustment(ledger, event(reason.trim() || 'Preview')) as Ledger,
      customerId,
    );
  } catch (cause) {
    notice = cause instanceof Error ? cause.message : String(cause);
  }
  return (
    <Modal
      title="Refund customer credit"
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          {submitted ? 'Retry same refund' : 'Refund'}
        </DialogActions>
      }
    >
      <p>
        {customer?.name ?? 'Customer'} has <strong>{currency(credit)}</strong> credit (money paid ahead and
        not used).
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
            if (!reason.trim()) throw Error('Give a reason for the refund.');
            const command = submitted ?? event();
            applySaleAdjustment(ledger, command);
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
              Amount to give back (₦)
              <CurrencyInput value={amount} onValueChange={setAmount} required />
            </label>
            <label>
              Paid back by
              <SearchSelect
                label="Paid back by"
                value={method}
                onChange={setMethod}
                required
                options={methods.map((m) => ({ value: m.label, label: m.displayLabel || m.label }))}
              />
            </label>
          </div>
          <label>
            Reason
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              maxLength={500}
              placeholder="For example: customer cancelled before we started; collected the balance in cash"
            />
          </label>
        </fieldset>
        {left !== null ? (
          <p className="muted">
            Credit after the refund: <strong>{currency(left)}</strong>. Recorded today. Cash refunds come out
            of your drawer.
          </p>
        ) : (
          notice && <p className="notice">{notice}</p>
        )}
      </form>
    </Modal>
  );
}
