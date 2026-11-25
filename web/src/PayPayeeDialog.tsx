import { useMemo, useState } from 'react';
import Modal from './Modal';
import DialogActions from './DialogActions';
import CurrencyInput from './CurrencyInput';
import SearchSelect from './SearchSelect';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { expenseCode, fromLagosLocal, lagosLocal } from './expenses.mjs';
import { advanceHeld, payeePaymentEvents, spreadPayment, unpaidExpenses } from './payee-payments.mjs';
import { operationEvent } from './operations.mjs';
import { usePaidFromOptions } from './paid-from';
import { usePayeeRules } from './PayeeRulesContext';
import { useFeedbackMessage } from './Feedback';
import type { Expense, ExpenseEvent, Ledger, OperationsEvent, Payee } from './types';

type Save = (event: OperationsEvent | ExpenseEvent) => Promise<void>;

/** Paying a payee once: one amount over their unpaid expenses, oldest first; the rest kept as an advance. */
export function PayPayeeDialog({
  ledger,
  payee,
  actor,
  busy,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  payee: Payee;
  actor: { id: string; label: string };
  busy: boolean;
  onSave: Save;
  onClose: () => void;
}) {
  const rules = usePayeeRules();
  const owing = useMemo(() => unpaidExpenses(ledger, payee.id), [ledger, payee.id]) as {
    expense: Expense;
    owed: number;
  }[];
  const totalOwed = owing.reduce((n, u) => n + u.owed, 0);
  const paidFrom = usePaidFromOptions(ledger.moneyAccounts ?? []);
  const [amount, setAmount] = useState(totalOwed ? String(totalOwed / 100) : '');
  const [from, setFrom] = useState(paidFrom[0]?.key ?? 'personal');
  const [when, setWhen] = useState(lagosLocal(new Date().toISOString()));
  const [reference, setReference] = useState('');
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const { shares } = spreadPayment(ledger, payee.id, totalOwed);
    return Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, String((v as number) / 100)]));
  });
  const [keep, setKeep] = useState(rules.payeeExtra === 'advance');
  const [error, setError] = useFeedbackMessage('error');
  const formId = `pay-payee-${payee.id}`;
  const paid = money(amount || '0');
  const used = Object.values(shares).reduce((n, v) => n + money(v || '0'), 0);
  const rest = Math.max(0, paid - used);
  const chosen = paidFrom.find((o) => o.key === from) ?? paidFrom[0];
  const respread = (value: string) => {
    setAmount(value);
    const { shares } = spreadPayment(ledger, payee.id, money(value || '0'));
    setShares(
      Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, String((v as number) / 100)])),
    );
  };
  return (
    <Modal
      title={`Pay ${payee.name}`}
      wide
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Pay {currency(paid)}
        </DialogActions>
      }
    >
      <p className="muted">
        Owed {currency(totalOwed)} on {owing.length} {owing.length === 1 ? 'expense' : 'expenses'}
        {advanceHeld(ledger, payee.id) > 0 && ` · advance held ${currency(advanceHeld(ledger, payee.id))}`}
      </p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            const paidOn = when.slice(0, 10);
            const out = payeePaymentEvents(
              ledger,
              {
                payeeId: payee.id,
                amount: paid,
                shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, money(v || '0')])),
                paidOn,
                paidAt: fromLagosLocal(when),
                method: chosen.kind,
                methodLabel: chosen.label,
                accountId: chosen.accountId,
                source: chosen.source,
                reference,
                keepRest: keep,
              },
              actor,
            );
            for (const event of out.expenseEvents) await onSave(event as ExpenseEvent);
            if (out.advanceEvent) await onSave(out.advanceEvent as OperationsEvent);
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <label>
          Amount paid (₦)
          <CurrencyInput value={amount} onValueChange={respread} required />
        </label>
        <label>
          Paid from
          <SearchSelect
            label="Paid from"
            value={from}
            options={paidFrom.map((o) => ({ value: o.key, label: o.text }))}
            onChange={setFrom}
          />
        </label>
        <label>
          When
          <input type="datetime-local" value={when} required onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label>
          Reference (optional)
          <input value={reference} maxLength={160} onChange={(e) => setReference(e.target.value)} />
        </label>
        {owing.length > 0 && (
          <fieldset className="full-width">
            <legend>Paid towards (oldest first)</legend>
            {owing.map(({ expense, owed }) => (
              <label key={expense.id}>
                {expenseCode(expense.id, ledger.expenses)} · {expense.description} · {expense.incurredOn} · owes{' '}
                {currency(owed)}
                <CurrencyInput
                  value={shares[expense.id] ?? ''}
                  onValueChange={(v) => setShares({ ...shares, [expense.id]: v })}
                />
              </label>
            ))}
          </fieldset>
        )}
        <p className="full-width" role="status">
          To expenses {currency(Math.min(used, paid))}
          {rest > 0 && ` · left over ${currency(rest)}`}
        </p>
        {rest > 0 &&
          (rules.payeeExtra === 'ask' ? (
            <label className="check-label full-width">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Keep {currency(rest)} as an advance with {payee.name}
            </label>
          ) : (
            <p className="muted full-width">
              {currency(rest)} is kept as an advance with {payee.name}, for their next expenses.
            </p>
          ))}
      </form>
    </Modal>
  );
}

/** An advance paid to a payee, or money they give back from it. */
export function PayeeAdvanceDialog({
  ledger,
  payee,
  actor,
  busy,
  onSave,
  onClose,
}: {
  ledger: Ledger;
  payee: Payee;
  actor: { id: string; label: string };
  busy: boolean;
  onSave: Save;
  onClose: () => void;
}) {
  const held = advanceHeld(ledger, payee.id);
  const accounts = (ledger.moneyAccounts ?? []).filter((a) => !a.archived && !a.hidden);
  const [type, setType] = useState<'payee_advance' | 'advance_returned'>('payee_advance');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState(accounts[0]?.id ?? '');
  const [on, setOn] = useState(lagosLocal(new Date().toISOString()).slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useFeedbackMessage('error');
  const formId = `payee-advance-${payee.id}`;
  return (
    <Modal
      title={`Advance · ${payee.name}`}
      busy={busy}
      onClose={onClose}
      footer={
        <DialogActions form={formId} busy={busy} onCancel={onClose}>
          Save
        </DialogActions>
      }
    >
      <p className="muted">Advance held {currency(held)}</p>
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      <form
        id={formId}
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setError('');
          try {
            if (!account) throw Error('Choose the account.');
            await onSave(
              operationEvent(
                'account.money_moved',
                {
                  id: crypto.randomUUID(),
                  accountId: account,
                  paidOn: on,
                  reason:
                    note.trim() ||
                    (type === 'payee_advance' ? `Advance to ${payee.name}` : `Advance returned by ${payee.name}`),
                  moneyType: type,
                  amount: money(amount || '0'),
                  payeeId: payee.id,
                },
                actor,
              ) as OperationsEvent,
            );
            onClose();
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <label>
          What happened
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="payee_advance">Advance paid to {payee.name}</option>
            {held > 0 && <option value="advance_returned">{payee.name} gave money back</option>}
          </select>
        </label>
        <label>
          Amount (₦)
          <CurrencyInput value={amount} onValueChange={setAmount} required />
        </label>
        <label>
          {type === 'payee_advance' ? 'Paid from account' : 'Received into account'}
          <select value={account} required onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" value={on} required onChange={(e) => setOn(e.target.value)} />
        </label>
        <label className="full-width">
          Note (optional)
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}
