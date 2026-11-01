import AccountMethodsEditor from './AccountMethodsEditor';
import {accountMethodDetails,prepareAccountMethods,routingLabels,typeName} from './account-methods.mjs';
import { useState } from 'react';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { businessDay } from './dashboard.mjs';
import { accountBalance, accountBranch, moneyTransactions, operationEvent } from './operations.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import type { Ledger, MoneyAccount, OperationsEvent,AccountPaymentMethod } from './types';
const today = () => businessDay(new Date().toISOString());
export default function AccountsPage({
  ledger,
  busy,
  actor,
  onSave,
  canConfigure = false,
  configurationOnly = false,
  branches,
  seesAll = false,
  currentBranch = 'main',
}: {
  /** With branches: every open branch, for whose account it is. */
  branches?: { id: string; name: string }[];
  /** The owner's view: every account with its full balance. */
  seesAll?: boolean;
  /** The branch this device works in (new accounts belong to it). */
  currentBranch?: string;
  ledger: Ledger;
  busy: boolean;
  canConfigure?: boolean;
  configurationOnly?: boolean;
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
  const [methodDrafts,setMethodDrafts]=useState<AccountPaymentMethod[]>([]);
  function editAccount(account:MoneyAccount|'new'){setError('');setMethodDrafts(account==='new'?[{id:crypto.randomUUID(),name:'Transfer',label:'',kind:'Transfer',enabled:true,aliases:[]}]:accountMethodDetails(account,methods));setEditor(account);}
  const configure = configurationOnly && canConfigure;
  const accounts = ledger.moneyAccounts ?? [],
    active = accounts.filter((a) => !a.archived),
    methods = useBusinessOptions().paymentMethods.filter((m) => m.enabled),
    unassigned = moneyTransactions(ledger).filter((t) => !t.accountId && !t.personal);
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
    <section
      className={configurationOnly ? 'panel account-settings' : 'panel'}
      aria-label={configurationOnly ? 'Account settings' : 'Accounts'}
    >
      <p hidden={configurationOnly}>
        Expected balances are opening balances plus recorded money movements. Cash drawer handovers stay
        within the same account. Transfers between these accounts do not count as sales or expenses.
      </p>
      {!configurationOnly && (
        <p className="muted">Account setup is under Business Settings → Accounts (Developer).</p>
      )}
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
        {configure && (
          <button
            disabled={busy}
            onClick={() => {
              setError('');
              editAccount('new');
            }}
          >
            Add account
          </button>
        )}
        <button
          className="secondary"
          hidden={configurationOnly}
          disabled={busy || active.length < 2}
          onClick={() => open('transfer')}
        >
          Transfer
        </button>
        <button
          className="secondary"
          hidden={configurationOnly}
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
      {accounts.some(
        (a) =>
          a.importedFromPaymentMethod &&
          !(ledger.accountEntries ?? []).some((e) => e.action === 'reconciliation' && e.accountId === a.id),
      ) && (
        <p className="notice">
          Accounts imported from payment methods start at zero before their first recorded movement. Reconcile
          them against actual balances to include money held before records began.
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
              {!configurationOnly && <th>Expected balance</th>}
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
                // A shared account's full balance includes other branches' money: only the owner sees it.
                const partial = !!branches && accountBranch(a) === '*' && !seesAll;
                return (
                  <tr key={a.id}>
                    <td>
                      <strong>{a.name}</strong>
                      <small>
                        {a.accountType}
                        {a.archived ? ' · Archived' : ''}
                      </small>
                      <small>Payment methods: {a.paymentMethods?.map(m=>m.name+' ('+typeName(m.kind)+')'+(m.enabled?'':' · disabled')).join(', ')||a.methods?.join(', ')||'None'}</small>
                      {branches && (
                        <small>
                          {accountBranch(a) === '*'
                            ? 'Shared by all branches'
                            : (branches.find((b) => b.id === accountBranch(a))?.name ?? 'Main branch')}
                        </small>
                      )}
                    </td>
                    <td hidden={configurationOnly}>
                      {partial ? (
                        <>
                          <strong>Shared account</strong>
                          <small>
                            This branch: received {currency(t.received)} · paid {currency(t.paid)}
                          </small>
                          <small>The business owner sees the full balance.</small>
                        </>
                      ) : (
                        <>
                          <strong>{currency(t.balance)}</strong>
                          <small>
                            Received {currency(t.received)} · Paid {currency(t.paid)}
                          </small>
                          <small>
                            Opening {currency(a.openingBalance)} · {a.openingDate}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="material-actions">
                        <button
                          className="text-button"
                          hidden={configurationOnly}
                          onClick={() => setDetail(a)}
                        >
                          Transactions
                        </button>
                        <button
                          className="text-button"
                          hidden={configurationOnly}
                          disabled={busy || a.archived || partial}
                          onClick={() => open('reconcile', a.id)}
                        >
                          Reconcile
                        </button>
                        {configure && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setError('');
                              editAccount(a);
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          hidden={configurationOnly}
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
      {configure && editor && (
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
              try{const f = new FormData(e.currentTarget);
              const opening =
                money(String(f.get('openingBalance') || '0')) *
                (f.get('openingSign') === 'negative' ? -1 : 1);
              if (
                await save(editor === 'new' ? 'account.created' : 'account.updated', {
                  id: editor === 'new' ? crypto.randomUUID() : editor.id,
                  baseVersion: editor === 'new' ? undefined : editor.version,
                  name: String(f.get('name')),
                  accountType: String(f.get('type')),
                  openingDate: String(f.get('openingDate')),
                  openingBalance: opening,
                  paymentMethods:prepareAccountMethods(String(f.get('name')).trim(),methodDrafts,editor==='new'?null:editor),
                  methods:routingLabels(prepareAccountMethods(String(f.get('name')).trim(),methodDrafts,editor==='new'?null:editor)),
                  ...(branches ? { branch: String(f.get('branch') || currentBranch) } : {}),
                })
              )
                setEditor(null);
              }catch(e){setError(e instanceof Error?e.message:String(e));}
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
              {branches && (
                <label>
                  Belongs to
                  <select
                    aria-label="Belongs to"
                    name="branch"
                    defaultValue={editor === 'new' ? currentBranch : accountBranch(editor)}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                    <option value="*">Shared by all branches</option>
                  </select>
                  <small>
                    A branch's accounts (its POS terminal, till, own bank accounts) are used only there. A
                    shared account, such as the general business account, can be used by every branch.
                  </small>
                </label>
              )}
              {
                <>
                  <label>
                    Opening date
                    <input
                      type="date"
                      name="openingDate"
                      required
                      defaultValue={editor === 'new' ? today() : editor.openingDate}
                    />
                  </label>
                  <label>
                    Opening balance (₦)
                    <CurrencyInput
                      name="openingBalance"
                      required
                      defaultValue={editor === 'new' ? '0' : String(Math.abs(editor.openingBalance) / 100)}
                    />
                  </label>
                  <label>
                    Balance type
                    <select
                      aria-label="Balance type"
                      name="openingSign"
                      defaultValue={editor !== 'new' && editor.openingBalance < 0 ? 'negative' : 'positive'}
                    >
                      <option value="positive">Positive / zero</option>
                      <option value="negative">Overdrawn / negative</option>
                    </select>
                  </label>
                  <small>
                    Enter the actual balance immediately before transactions on the opening date. Earlier
                    payments stay outside this balance.
                  </small>
                </>
              }
              {editor !== 'new' && (
                <p className="notice notice-warning">
                  Changing opening balance or date recalculates expected balances. Use Reconcile on Accounts
                  for a counted difference today.
                </p>
              )}
              <AccountMethodsEditor value={methodDrafts} onChange={setMethodDrafts} savedIds={editor==='new'?[]:(editor.paymentMethods??[]).map(m=>m.id)}/>
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
                      <small>
                        {t.label} · {t.method}
                      </small>
                      {t.paidOn < detail.openingDate && (
                        <small>Before opening date · already covered by opening balance</small>
                      )}
                    </td>
                    <td>{t.direction > 0 ? currency(t.amount) : '—'}</td>
                    <td>{t.direction < 0 ? currency(t.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Transfers and reconciliations</h3>
          {accountBalance(ledger, detail.id)
            .entries.filter((e: Record<string, any>) => e.action !== 'assignment')
            .map((e: Record<string, any>) => (
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
