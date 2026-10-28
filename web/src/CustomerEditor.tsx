import DialogActions from './DialogActions';
import { phoneProblem } from './input-guard.mjs';
import { useFeedbackMessage } from './Feedback';
import CurrencyInput from './CurrencyInput';
import { useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { money } from './domain.mjs';
import { createCustomerEvent, customerCode, phoneKey, phoneOwner } from './customers.mjs';
import type { Customer, CustomerEvent } from './types';
type Props = {
  customer?: Customer;
  customers?: Customer[];
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (event: CustomerEvent) => Promise<void>;
  onClose: () => void;
  onSaved?: (customerId: string) => void;
};
export default function CustomerEditor({
  customer,
  customers = [],
  actor,
  busy,
  onSave,
  onClose,
  onSaved,
}: Props) {
  const formId = useId();
  const [error, setError] = useFeedbackMessage('error');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  // Each number belongs to one customer; an older shared number may be kept unchanged.
  const phoneTakenBy =
    customer && phoneKey(phone) === phoneKey(customer.phone)
      ? null
      : phoneOwner(customers, phone, customer?.id);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setError('');
    const form = new FormData(e.currentTarget);
    try {
      const fields = {
        name: String(form.get('name') ?? '').trim(),
        phone: String(form.get('phone') ?? '').trim(),
        address: String(form.get('address') ?? '').trim(),
        creditLimit: money(String(form.get('creditLimit') ?? '0')),
      };
      const operation: CustomerEvent = customer
        ? {
            id: crypto.randomUUID(),
            kind: 'customer.updated',
            data: {
              id: customer.id,
              baseVersion: customer.version,
              ...fields,
              modifiedBy: actor.id,
              modifiedByLabel: actor.label,
              modifiedAt: new Date().toISOString(),
            },
          }
        : (createCustomerEvent(fields, actor) as CustomerEvent);
      const phoneIssue = phoneProblem(fields.phone);
      if (phoneIssue) throw new Error(phoneIssue);
      if (phoneTakenBy)
        throw new Error(
          `This phone number already belongs to ${phoneTakenBy.name}. Use that customer or enter a different number.`,
        );
      await onSave(operation);
      onSaved?.(operation.data.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save customer.');
    }
  }
  return (
    <Modal
      title={customer ? 'Edit customer' : 'Add customer'}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save customer
        </DialogActions>
      }
    >
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {customer && <p className="material-id">Customer ID: {customerCode(customer.id, customers)}</p>}
      <form id={formId} onSubmit={submit}>
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Full name
              <input
                name="name"
                maxLength={160}
                defaultValue={customer?.name ?? ''}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Phone number
              <input
                name="phone"
                type="tel"
                maxLength={40}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel"
                placeholder="e.g. 0803 123 4567"
                aria-invalid={!!phoneTakenBy}
                required
              />
              {phoneTakenBy && (
                <small className="field-error" role="alert">
                  Already used by {phoneTakenBy.name} ({customerCode(phoneTakenBy.id, customers)})
                  {phoneTakenBy.archived ? ', archived' : ''}.
                </small>
              )}
            </label>
            <label>
              Address
              <input
                name="address"
                maxLength={500}
                defaultValue={customer?.address ?? ''}
                autoComplete="street-address"
                placeholder="Optional"
              />
            </label>
            <label>
              Credit limit (₦)
              <CurrencyInput
                name="creditLimit"
                defaultValue={customer ? (customer.creditLimit / 100).toFixed(2) : '0.00'}
                required
              />
            </label>
          </div>
          <p className="muted">The credit limit is saved for later use during checkout.</p>
        </fieldset>
      </form>
    </Modal>
  );
}
