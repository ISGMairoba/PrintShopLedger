import { useState } from 'react';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { businessDay } from './dashboard.mjs';
import { accountBalance, moneyTransactions, operationEvent } from './operations.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import type { Ledger, MoneyAccount, OperationsEvent } from './types';
const today = () => businessDay(new Date().toISOString());
export default function AccountsPage({
  ledger,
  busy,
  actor,
  onSave,
}: {
  ledger: Ledger;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: OperationsEvent) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [editor, setEditor] = useState<MoneyAccount | 'new' | null>(null),
    [detail, setDetail] = useState<MoneyAccount | null>(null),
    [action, setAction] = useState<'transfer' | 'reconcile' | 'assign' | null>(null),
    [selected, setSelected] = useState(''),
    [on, setOn] = useState(today()),
    [error, setError] = useState('');
  const accounts = ledger.moneyAccounts ?? [],
    active = accounts.filter((a) => !a.archived),
    methods = useBusinessOptions().paymentMethods.filter((m) => m.enabled),
    unassigned = moneyTransactions(ledger).filter((t) => !t.accountId);
  const save = async (kind: OperationsEvent['kind'], data: Record<string, any>) => {
    setError('');
    try {
      await onSave(operationEvent(kind, data, actor) as OperationsEvent);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  };
  const open = (kind: typeof action, id = '') => {
    setSelected(id || active[0]?.id || '');
    setOn(today());
    setAction(kind);
    setError('');
  };
  const accountOptions = active.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ));
  return (
    <section className="panel">
      <p>
        Expected balances are opening balances plus recorded money movements. Cash drawer handovers stay
        within the same account. Transfers between these accounts do not count as sales or expenses.
      </p>
      <div className="toolbar">
        <input
          aria-label="Search accounts"
          placeholder="Search accounts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check-label">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
        <button
          disabled={busy}
          onClick={() => {
            setError('');
            setEditor('new');
          }}
        >
          Add account
        </button>
        <button className="secondary" disabled={busy || active.length < 2} onClick={() => open('transfer')}>
          Transfer
        </button>
        <button
          className="secondary"
          disabled={busy || !active.length || !unassigned.length}
          onClick={() => open('assign')}
        >
          Assign previous payment
        </button>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {!!unassigned.length && (
        <p className="notice notice-warning">
          {unassigned.length} payment{unassigned.length === 1 ? '' : 's'} without an account. They are
          excluded from account balances until assigned. Opening balances should cover transactions before
          your chosen start date.
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Expected balance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {accounts
              .filter(
                (a) => (showArchived || !a.archived) && a.name.toLowerCase().includes(query.toLowerCase()),
              )
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((a) => {
                const t = accountBalance(ledger, a.id);
                return (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <small>
                        {a.accountType}
                        {a.archived ? ' · Archived' : ''}
                      </small>
                      <small>Default for: {a.methods?.join(', ') || 'None'}</small>
                    </td>
                    <td>
                      <strong>{currency(t.balance)}</strong>
                      <small>
                        Received {currency(t.received)} · Paid {currency(t.paid)}
                      </small>
                      <small>
                        Opening {currency(a.openingBalance)} · {a.openingDate}
                      </small>
                    </td>
                    <td>
                      <div className="material-actions">
                        <button className="text-button" onClick={() => setDetail(a)}>
                          Transactions
                        </button>
                        <button
                          className="text-button"
                          disabled={busy || a.archived}
                          onClick={() => open('reconcile', a.id)}
                        >
                          Reconcile
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            setError('');
                            setEditor(a);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className={`text-button ${a.archived ? '' : 'danger-text'}`}
                          disabled={busy}
                          onClick={() =>
                            void save(a.archived ? 'account.restored' : 'account.archived', {
                              id: a.id,
                              baseVersion: a.version,
                            })
                          }
                        >
                          {a.archived ? 'Restore' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {editor && (
        <Modal
          title={editor === 'new' ? 'Add account' : 'Edit account'}
          busy={busy}
          onClose={() => setEditor(null)}
        >
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const opening =
                money(String(f.get('openingBalance') || '0')) *
                (f.get('openingSign') === 'negative' ? -1 : 1);
              if (
                await save(editor === 'new' ? 'account.created' : 'account.updated', {
                  id: editor === 'new' ? crypto.randomUUID() : editor.id,
                  baseVersion: editor === 'new' ? undefined : editor.version,
                  name: String(f.get('name')),
                  accountType: String(f.get('type')),
                  openingDate: editor === 'new' ? String(f.get('openingDate')) : editor.openingDate,
                  openingBalance: editor === 'new' ? opening : editor.openingBalance,
                  methods: f.getAll('methods').map(String),
                })
              )
                setEditor(null);
            }}
          >
            <fieldset disabled={busy}>
              <label>
                Account name
                <input
                  aria-label="Account name"
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editor === 'new' ? '' : editor.name}
                />
              </label>
              <label>
                Account type
                <select
                  aria-label="Account type"
                  name="type"
                  defaultValue={editor === 'new' ? 'bank' : editor.accountType}
                >
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                  <option value="pos">POS / settlement</option>
                  <option value="other">Other</option>
                </select>
              </label>
              {editor === 'new' ? (
                <>
                  <label>
                    Opening date
                    <input type="date" name="openingDate" required defaultValue={today()} />
                  </label>
                  <label>
                    Opening balance (₦)
                    <CurrencyInput name="openingBalance" required />
                  </label>
                  <label>
                    Balance type
                    <select aria-label="Balance type" name="openingSign">
                      <option value="positive">Positive / zero</option>
                      <option value="negative">Overdrawn / negative</option>
                    </select>
                  </label>
                  <small>
                    Enter the actual balance immediately before transactions on the opening date. Earlier
                    payments stay outside this balance.
                  </small>
                </>
              ) : (
                <small>
                  Opening balance and date are retained. Use Reconcile to record a counted difference.
                </small>
              )}
              <fieldset>
                <legend>Default account for new payments</legend>
                {methods.map((m) => (
                  <label className="check-label" key={m.label}>
                    <input
                      type="checkbox"
                      name="methods"
                      value={m.label}
                      defaultChecked={editor !== 'new' && editor.methods?.includes(m.label)}
                    />
                    {m.label}
                  </label>
                ))}
              </fieldset>
              <button type="submit">Save account</button>
            </fieldset>
          </form>
        </Modal>
      )}
      {action && (
        <Modal
          title={
            action === 'transfer'
              ? 'Transfer between accounts'
              : action === 'reconcile'
                ? 'Reconcile account'
                : 'Assign previous payment'
          }
          busy={busy}
          onClose={() => setAction(null)}
        >
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const f = new FormData(e.currentTarget),
                  base = {
                    id: crypto.randomUUID(),
                    accountId: selected,
                    paidOn: on,
                    reason: String(f.get('reason')),
                  };
                const kind =
                  action === 'transfer'
                    ? 'account.transferred'
                    : action === 'reconcile'
                      ? 'account.reconciled'
                      : 'account.assigned';
                const data =
                  action === 'transfer'
                    ? {
                        ...base,
                        toAccountId: String(f.get('destination')),
                        amount: money(String(f.get('amount'))),
                      }
                    : action === 'reconcile'
                      ? {
                          ...base,
                          expectedBalance: accountBalance(ledger, selected, on).balance,
                          actualBalance:
                            money(String(f.get('actual'))) * (f.get('sign') === 'negative' ? -1 : 1),
                        }
                      : { ...base, transactionId: String(f.get('transaction')) };
                if (await save(kind, data)) setAction(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            <fieldset disabled={busy}>
              <label>
                {action === 'transfer' ? 'From account' : 'Account'}
                <select
                  aria-label="Source account"
                  required
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {accountOptions}
                </select>
              </label>
              <label>
                Date
                <input
                  aria-label="Account entry date"
                  type="date"
                  required
                  value={on}
                  onChange={(e) => setOn(e.target.value)}
                />
              </label>
              {action === 'transfer' ? (
                <>
                  <label>
                    To account
                    <select aria-label="Destination account" name="destination" required>
                      <option value="">Choose another account</option>
                      {active
                        .filter((a) => a.id !== selected)
                        .map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Amount (₦)
                    <CurrencyInput name="amount" required />
                  </label>
                </>
              ) : action === 'reconcile' ? (
                <>
                  <p>
                    Expected as of {on}:{' '}
                    <strong>{selected ? currency(accountBalance(ledger, selected, on).balance) : '—'}</strong>
                  </p>
                  <label>
                    Actual balance (₦)
                    <CurrencyInput name="actual" required />
                  </label>
                  <label>
                    Balance type
                    <select aria-label="Balance type" name="sign">
                      <option value="positive">Positive / zero</option>
                      <option value="negative">Overdrawn / negative</option>
                    </select>
                  </label>
                  <p className="muted">
                    The difference is recorded as an account adjustment, not sales or an expense.
                  </p>
                </>
              ) : (
                <label>
                  Unassigned payment
                  <select aria-label="Unassigned payment" name="transaction" required>
                    <option value="">Choose a payment</option>
                    {unassigned
                      .filter(
                        (t) =>
                          !selected ||
                          t.paidOn >= (accounts.find((a) => a.id === selected)?.openingDate ?? ''),
                      )
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.paidOn} · {t.direction > 0 ? 'Received' : 'Paid'} {currency(t.amount)} ·{' '}
                          {t.label}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                Reason / note
                <textarea aria-label="Account entry reason" name="reason" required maxLength={500} />
              </label>
              <button type="submit">
                Save{' '}
                {action === 'transfer'
                  ? 'transfer'
                  : action === 'reconcile'
                    ? 'reconciliation'
                    : 'assignment'}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal
          title={`Account transactions · ${detail.name}`}
          wide
          busy={busy}
          onClose={() => setDetail(null)}
        >
          <p>
            Opening {currency(detail.openingBalance)} on {detail.openingDate} · Expected now{' '}
            <strong>{currency(accountBalance(ledger, detail.id).balance)}</strong>
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date / movement</th>
                  <th>Received</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {accountBalance(ledger, detail.id).transactions.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {t.paidOn}
                      <small>{t.label}</small>
                    </td>
                    <td>{t.direction > 0 ? currency(t.amount) : '—'}</td>
                    <td>{t.direction < 0 ? currency(t.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Transfers and reconciliations</h3>
          {accountBalance(ledger, detail.id).entries.map((e: Record<string, any>) => (
            <p key={e.id}>
              {e.paidOn} · {e.action} · {currency(e.amount)}
              {e.action === 'transfer'
                ? ` · ${accounts.find((a) => a.id === e.accountId)?.name} → ${accounts.find((a) => a.id === e.toAccountId)?.name}`
                : ''}
              <br />
              {e.reason} · {e.modifiedByLabel}
            </p>
          ))}
          <details>
            <summary>Audit history</summary>
            {(ledger.operationHistory ?? [])
              .filter((h) => h.recordId === detail.id)
              .map((h) => (
                <p key={h.id}>
                  {h.action} · {h.modifiedByLabel} · {new Date(h.modifiedAt).toLocaleString('en-NG')}
                </p>
              ))}
          </details>
        </Modal>
      )}
    </section>
  );
}
