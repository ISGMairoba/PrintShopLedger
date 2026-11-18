import DialogActions from './DialogActions';
import { MAIN, localBranchId } from './branches.mjs';
import { phoneProblem } from './input-guard.mjs';
import { useFeedback, useFeedbackMessage } from './Feedback';
import { customerLink } from './customer-link';
import CurrencyInput from './CurrencyInput';
import { useEffect, useId, useState, type FormEvent } from 'react';
import Modal from './Modal';
import { money } from './domain.mjs';
import { createCustomerEvent, customerCode, phoneKey, phoneOwner } from './customers.mjs';
import type { Customer, CustomerEvent, FieldEvent } from './types';
import { calledAsEvent } from './item-fields.mjs';
type Props = {
  customer?: Customer;
  customers?: Customer[];
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (event: CustomerEvent) => Promise<void>;
  onClose: () => void;
  onSaved?: (customerId: string) => void;
  /** Saves "Called as" (its own operation); without it the field is not shown. */
  onSaveCalledAs?: (event: FieldEvent) => Promise<void>;
};
export default function CustomerEditor({
  customer,
  customers = [],
  actor,
  busy,
  onSave,
  onClose,
  onSaved,
  onSaveCalledAs,
}: Props) {
  const formId = useId();
  const [error, setError] = useFeedbackMessage('error');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  // Each number belongs to one customer; an older shared number may be kept unchanged.
  const phoneTakenBy =
    customer && phoneKey(phone) === phoneKey(customer.phone)
      ? null
      : phoneOwner(customers, phone, customer?.id);
  // At a branch with its own customers the number may be another branch's customer, which this
  // device does not have: the server says only yes or no, and the name shows once it is added here.
  const link = customerLink();
  const notify = useFeedback();
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const askServer =
    !!link && !phoneTakenBy && !phoneProblem(phone) && !(customer && phoneKey(phone) === phoneKey(customer.phone));
  useEffect(() => {
    if (!askServer || !link) return;
    let live = true;
    const timer = window.setTimeout(() => {
      link
        .elsewhere(phone)
        .then((yes) => live && setElsewhere(yes ? phoneKey(phone) : null))
        .catch(() => {});
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [askServer, link, phone]);
  const usedElsewhere = askServer && elsewhere === phoneKey(phone);
  async function addHere() {
    if (!link || linking) return;
    setLinking(true);
    setError('');
    try {
      const found = await link.link(phone);
      notify(`${found.name} is now a customer at this branch.`, 'success');
      onSaved?.(found.id);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the customer to this branch.');
    } finally {
      setLinking(false);
    }
  }
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
      } as Record<string, any>;
      // At a branch the limit typed is this branch's own; the customer's own limit stays as it was
      // (a customer added at a branch starts with it as both).
      if (localBranchId() !== MAIN) {
        fields.branchCreditLimit = fields.creditLimit;
        if (customer) fields.creditLimit = customer.baseCreditLimit ?? customer.creditLimit;
      }
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
      if (usedElsewhere || (askServer && link && (await link.elsewhere(fields.phone))))
        throw new Error(
          'This phone number already belongs to a customer at another branch. Add them to this branch, or enter a different number.',
        );
      await onSave(operation);
      const calledAs = String(form.get('calledAs') ?? '').trim();
      if (onSaveCalledAs && calledAs !== (customer?.calledAs ?? '')) {
        // After the save above the customer is one version on (a new one starts at 1).
        const saved = { id: operation.data.id, version: customer ? customer.version + 1 : 1 };
        await onSaveCalledAs(calledAsEvent(saved, calledAs, actor) as FieldEvent);
      }
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
            {onSaveCalledAs && (
              <label>
                Called as
                <input
                  name="calledAs"
                  maxLength={80}
                  defaultValue={customer?.calledAs ?? ''}
                  placeholder="Optional, e.g. Baban Suhaila"
                />
                <small>The name messages greet them by. Empty: their first name.</small>
              </label>
            )}
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
                aria-invalid={!!phoneTakenBy || usedElsewhere}
                required
              />
              {phoneTakenBy && (
                <small className="field-error" role="alert">
                  Already used by {phoneTakenBy.name} ({customerCode(phoneTakenBy.id, customers)})
                  {phoneTakenBy.archived ? ', archived' : ''}.
                </small>
              )}
              {usedElsewhere && (
                <span className="field-error customer-elsewhere" role="alert">
                  <small>This number belongs to a customer at another branch.</small>
                  <button type="button" className="secondary" onClick={addHere} disabled={linking || busy}>
                    {linking ? 'Adding…' : 'Add them to this branch'}
                  </button>
                </span>
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
