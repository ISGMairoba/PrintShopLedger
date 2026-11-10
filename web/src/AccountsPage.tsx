import Icon from './Icon';
import AccountMethodsEditor from './AccountMethodsEditor';
import { accountMethodDetails, prepareAccountMethods, routingLabels, typeName } from './account-methods.mjs';
import { useState } from 'react';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { businessDay } from './dashboard.mjs';
import { accountBalance, accountBranch, moneyTransactions, operationEvent } from './operations.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import { accountSummary } from './account-summary.mjs';
import { MONEY_TYPES, lenderBalances } from './money-moves.mjs';
import type { Ledger, MoneyAccount, OperationsEvent, AccountPaymentMethod } from './types';
const today = () => businessDay(new Date().toISOString());
const NEW_LENDER = '__new';
export default function AccountsPage({
  ledger,
  busy,
  actor,
  onSave,
  canConfigure = false,
  canHide = false,
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
  /** General Managers and above: see, use and hide hidden (savings) accounts. */
  canHide?: boolean;
  configurationOnly?: boolean;
  actor: { id: string; label: string };
  onSave: (event: OperationsEvent) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [showArchived, setShowArchived] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [savingsShown, setSavingsShown] = useState(false),
    [editor, setEditor] = useState<MoneyAccount | 'new' | null>(null),
    [detail, setDetail] = useState<MoneyAccount | null>(null),
    [action, setAction] = useState<'transfer' | 'reconcile' | 'assign' | 'money' | null>(null),
    [moneyType, setMoneyType] = useState<keyof typeof MONEY_TYPES>('loan_in'),
    [lender, setLender] = useState(''),
    [fixing, setFixing] = useState<Record<string, any> | null>(null),
    [selected, setSelected] = useState(''),
    [on, setOn] = useState(today()),
    [error, setError] = useState('');
  const [methodDrafts, setMethodDrafts] = useState<AccountPaymentMethod[]>([]);
  function editAccount(account: MoneyAccount | 'new') {
    setError('');
    setMethodDrafts(
      account === 'new'
        ? [
            {
              id: crypto.randomUUID(),
              name: 'Transfer',
              label: '',
              kind: 'Transfer',
              enabled: true,
              aliases: [],
            },
          ]
        : accountMethodDetails(account, methods),
    );
    setEditor(account);
  }
  const configure = configurationOnly && canConfigure;
  // Hidden accounts (savings) exist only for General Managers and above.
  const accounts = (ledger.moneyAccounts ?? []).filter((a) => canHide || !a.hidden),
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
  const accountOptions = active
    // Payments can't be put in a hidden account; it takes transfers (and money in / out) only.
    .filter((a) => !(action === 'assign' && a.hidden))
    .map((a) => (
      <option key={a.id} value={a.id}>
        {a.name}
        {a.hidden ? ' (hidden)' : ''}
      </option>
    ));
  // Shared accounts hold other branches' money too: only those who see every branch count them.
  // Hidden accounts (savings) are left out of the totals and shown on their own.
  const counted = active.filter((a) => !a.hidden);
  const summary = accountSummary(
    ledger,
    counted.filter((a) => !(branches && accountBranch(a) === '*' && !seesAll)),
    today(),
  );
  const leftOut = counted.length - summary.accounts;
  const savings = active.filter((a) => a.hidden),
    savingsTotal = savings.reduce((sum, a) => sum + accountBalance(ledger, a.id).balance, 0);
  const payees = ledger.payees ?? [],
    owedTo = lenderBalances(ledger);
  return (
    <>
      {!configurationOnly && (
        <section className="stats" aria-label="Accounts summary">
          <article>
            <span>Current balance</span>
            <strong>{currency(summary.total)}</strong>
            <small>
              {summary.accounts === 1 ? '1 account' : `${summary.accounts} accounts`}
              {summary.cash !== 0 && summary.other !== 0
                ? ` · Cash ${currency(summary.cash)} · Bank and others ${currency(summary.other)}`
                : ''}
              {leftOut > 0 ? ` · ${leftOut} shared not counted` : ''}
            </small>
          </article>
          <article>
            <span>Money in this month</span>
            <strong>{currency(summary.moneyIn)}</strong>
            <small>
              {summary.otherIn
                ? `Customer payments, and ${currency(summary.otherIn)} loans, owner money or other income`
                : 'Customer payments into these accounts'}
            </small>
          </article>
          <article>
            <span>Money out this month</span>
            <strong>{currency(summary.moneyOut)}</strong>
            <small>
              {summary.otherOut
                ? `Expenses, refunds, and ${currency(summary.otherOut)} loan repayments or owner withdrawals`
                : 'Expenses paid and refunds'}
            </small>
          </article>
          <article>
            <span>Last reconciled</span>
            <strong>
              {summary.lastReconciled
                ? new Date(`${summary.lastReconciled}T12:00:00`).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })
                : 'Never'}
            </strong>
            <small>
              {summary.differenceMonth !== 0
                ? `Differences this month ${summary.differenceMonth > 0 ? '+' : '−'}${currency(Math.abs(summary.differenceMonth))}`
                : summary.neverReconciled > 0
                  ? `${summary.neverReconciled} account${summary.neverReconciled === 1 ? '' : 's'} never reconciled`
                  : 'No differences this month'}
            </small>
          </article>
          {savings.length > 0 && (
            <article>
              <span className="savings-head">
                Savings (hidden)
                <button
                  type="button"
                  className="icon-button"
                  aria-pressed={savingsShown}
                  aria-label={savingsShown ? 'Hide the savings amount' : 'Show the savings amount'}
                  title={savingsShown ? 'Hide amount' : 'Show amount'}
                  onClick={() => setSavingsShown(!savingsShown)}
                >
                  <Icon name={savingsShown ? 'hide' : 'show'} />
                </button>
              </span>
              <strong aria-live="polite">{savingsShown ? currency(savingsTotal) : '₦ ****'}</strong>
              <small>
                {savings.length === 1 ? savings[0].name : `${savings.length} hidden accounts`}, not counted in
                the current balance
              </small>
            </article>
          )}
          {summary.owedToLenders > 0 && (
            <article>
              <span>Owed to lenders</span>
              <strong>{currency(summary.owedToLenders)}</strong>
              <small>{summary.lenders === 1 ? '1 loan' : `${summary.lenders} lenders`} still to repay</small>
            </article>
          )}
          {summary.unassignedCount > 0 && (
            <article>
              <span>Not in an account</span>
              <strong>{summary.unassignedCount}</strong>
              <small>
                Payments worth {summary.unassignedNet < 0 ? '−' : ''}
                {currency(Math.abs(summary.unassignedNet))} not counted above
              </small>
            </article>
          )}
        </section>
      )}
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
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Show archived
          </label>
          {canHide && !configurationOnly && (
            <label className="check-label">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              Show hidden
            </label>
          )}
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
            disabled={busy || !active.length}
            onClick={() => {
              setMoneyType('loan_in');
              setLender('');
              open('money');
            }}
          >
            Money in / out
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
            Accounts imported from payment methods start at zero before their first recorded movement.
            Reconcile them against actual balances to include money held before records began.
          </p>
        )}
        {!!unassigned.length && (
          <p className="notice notice-warning">
            {unassigned.length} payment{unassigned.length === 1 ? '' : 's'} without an account. They are
            excluded from account balances until assigned. Opening balances should cover transactions before
            your chosen start date.
          </p>
        )}
        {!configurationOnly && Object.keys(owedTo).length > 0 && (
          <p className="panel-note">
            <strong>Loans still owed:</strong>{' '}
            {Object.entries(owedTo)
              .map(([id, n]) => {
                const p = payees.find((x) => x.id === id);
                return `${p?.name ?? 'Lender'} ${currency(n)}${p?.repaymentDue ? ` (next due ${p.repaymentDue})` : ''}`;
              })
              .join(' · ')}
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
                  (a) =>
                    (showArchived || !a.archived) &&
                    (showHidden || !a.hidden) &&
                    a.name.toLowerCase().includes(query.toLowerCase()),
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
                          {a.hidden ? ' · Hidden (savings): transfers only, not in totals' : ''}
                        </small>
                        <small>
                          Payment methods:{' '}
                          {a.paymentMethods
                            ?.map(
                              (m) =>
                                m.name + ' (' + typeName(m.kind) + ')' + (m.enabled ? '' : ' · disabled'),
                            )
                            .join(', ') ||
                            a.methods?.join(', ') ||
                            'None'}
                        </small>
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
                          {canHide && !configurationOnly && !a.archived && (
                            <button
                              className="text-button"
                              disabled={busy || partial}
                              title={
                                a.hidden
                                  ? 'Show it in lists and totals again'
                                  : 'Hide it: no payments, transfers only, left out of totals. Its payment-method links are removed.'
                              }
                              onClick={() =>
                                void save('account.visibility_changed', {
                                  id: a.id,
                                  baseVersion: a.version,
                                  hidden: !a.hidden,
                                })
                              }
                            >
                              {a.hidden ? 'Unhide' : 'Hide'}
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
                try {
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
                      openingDate: String(f.get('openingDate')),
                      openingBalance: opening,
                      paymentMethods: prepareAccountMethods(
                        String(f.get('name')).trim(),
                        methodDrafts,
                        editor === 'new' ? null : editor,
                      ),
                      methods: routingLabels(
                        prepareAccountMethods(
                          String(f.get('name')).trim(),
                          methodDrafts,
                          editor === 'new' ? null : editor,
                        ),
                      ),
                      ...(branches ? { branch: String(f.get('branch') || currentBranch) } : {}),
                    })
                  )
                    setEditor(null);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
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
                <AccountMethodsEditor
                  value={methodDrafts}
                  onChange={setMethodDrafts}
                  savedIds={editor === 'new' ? [] : (editor.paymentMethods ?? []).map((m) => m.id)}
                />
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
                  : action === 'money'
                    ? 'Money in / out'
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
                  if (action === 'money') {
                    let lenderId = '';
                    if (MONEY_TYPES[moneyType].lender) {
                      if (lender === NEW_LENDER) {
                        lenderId = crypto.randomUUID();
                        const name = String(f.get('lenderName') ?? '').trim();
                        if (!name) throw Error("Enter the lender's name.");
                        if (
                          !(await save('payee.created', {
                            id: lenderId,
                            name,
                            phone: '',
                            address: '',
                            note: 'Lender',
                          }))
                        )
                          return;
                      } else lenderId = lender;
                      if (!lenderId) throw Error('Choose the lender.');
                    }
                    const ok = await save('account.money_moved', {
                      ...base,
                      moneyType,
                      amount: money(String(f.get('amount'))),
                      ...(lenderId ? { lenderId } : {}),
                    });
                    if (ok) setAction(null);
                    return;
                  }
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
                              {a.hidden ? ' (hidden)' : ''}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Amount (₦)
                      <CurrencyInput name="amount" required />
                    </label>
                  </>
                ) : action === 'money' ? (
                  <>
                    <label>
                      What is it?
                      <select
                        aria-label="Kind of money"
                        value={moneyType}
                        onChange={(e) => {
                          setMoneyType(e.target.value as keyof typeof MONEY_TYPES);
                          setLender('');
                        }}
                      >
                        {(Object.keys(MONEY_TYPES) as (keyof typeof MONEY_TYPES)[]).map((k) => (
                          <option key={k} value={k}>
                            {MONEY_TYPES[k].label} ({MONEY_TYPES[k].direction > 0 ? 'in' : 'out'})
                          </option>
                        ))}
                      </select>
                      <small>
                        {moneyType === 'loan_in'
                          ? 'Adds to the account and is owed to the lender until repaid. Not income.'
                          : moneyType === 'loan_repayment'
                            ? 'Takes from the account and reduces what is owed. Record any interest as an expense.'
                            : moneyType === 'owner_in'
                              ? "The owner's own money put into the business. Not income."
                              : moneyType === 'owner_out'
                                ? 'Money the owner takes for personal use. Not an expense.'
                                : 'Money received that is not a sale, such as a gift or grant. Shown as other income in reports.'}
                      </small>
                    </label>
                    {MONEY_TYPES[moneyType].lender && (
                      <label>
                        Lender
                        <select
                          aria-label="Lender"
                          required
                          value={lender}
                          onChange={(e) => setLender(e.target.value)}
                        >
                          <option value="">Choose the lender</option>
                          {(moneyType === 'loan_in'
                            ? payees.filter((p) => !p.archived)
                            : payees.filter((p) => owedTo[p.id])
                          ).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {owedTo[p.id] ? ` · owed ${currency(owedTo[p.id])}` : ''}
                            </option>
                          ))}
                          {moneyType === 'loan_in' && <option value={NEW_LENDER}>New lender…</option>}
                        </select>
                        <small>Lenders are saved with your payees.</small>
                      </label>
                    )}
                    {lender === NEW_LENDER && MONEY_TYPES[moneyType].lender && (
                      <label>
                        Lender's name
                        <input aria-label="Lender's name" name="lenderName" required maxLength={160} />
                      </label>
                    )}
                    <label>
                      Amount (₦)
                      <CurrencyInput name="amount" required />
                    </label>
                  </>
                ) : action === 'reconcile' ? (
                  <>
                    <p>
                      Expected as of {on}:{' '}
                      <strong>
                        {selected ? currency(accountBalance(ledger, selected, on).balance) : '—'}
                      </strong>
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
                  {action === 'money' ? 'Note' : 'Reason / note'}
                  <textarea
                    aria-label="Account entry reason"
                    name="reason"
                    required
                    maxLength={500}
                    placeholder={
                      action === 'money' ? 'e.g. Loan from Moniepoint for the new printer' : undefined
                    }
                  />
                </label>
                <button type="submit">
                  Save{' '}
                  {action === 'transfer'
                    ? 'transfer'
                    : action === 'reconcile'
                      ? 'reconciliation'
                      : action === 'money'
                        ? MONEY_TYPES[moneyType].label.toLowerCase()
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
            <h3>Transfers, reconciliations and other money</h3>
            {accountBalance(ledger, detail.id)
              .entries.filter((e: Record<string, any>) => e.action !== 'assignment')
              .map((e: Record<string, any>) => (
                <div key={e.id} className={`account-entry${e.cancelled ? ' cancelled-entry' : ''}`}>
                  <p>
                    {e.paidOn} ·{' '}
                    {e.action === 'carried'
                      ? `Carried forward · in ${currency(e.received)}, out ${currency(e.paid)} · net `
                      : e.action === 'money'
                        ? `${MONEY_TYPES[e.moneyType as keyof typeof MONEY_TYPES]?.label ?? 'Money'}${
                            e.lenderId
                              ? ` · ${payees.find((p) => p.id === e.lenderId)?.name ?? 'Lender'}`
                              : ''
                          } · ${e.direction < 0 ? '−' : '+'}`
                        : `${e.action} · `}
                    {currency(e.amount)}
                    {e.action === 'transfer'
                      ? ` · ${accounts.find((a) => a.id === e.accountId)?.name} → ${accounts.find((a) => a.id === e.toAccountId)?.name}`
                      : ''}
                    <br />
                    {e.reason} · {e.modifiedByLabel}
                    {e.cancelled ? ' · Cancelled' : ''}
                  </p>
                  {(e.corrections ?? []).map((c: Record<string, any>, i: number) => (
                    <small key={i} className="entry-correction">
                      {c.cancelled ? 'Cancelled' : 'Corrected'} by {c.correctedByLabel} on{' '}
                      {new Date(c.correctedAt).toLocaleString('en-NG')}: was{' '}
                      {currency(c.before.actualBalance ?? c.before.amount)}
                      {c.before.paidOn && c.before.paidOn !== e.paidOn ? ` on ${c.before.paidOn}` : ''} ·{' '}
                      {c.reason}
                    </small>
                  ))}
                  {!e.cancelled && !e.carryForward && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() => setFixing(e)}
                    >
                      <Icon name="edit" /> Correct
                    </button>
                  )}
                </div>
              ))}
            {fixing && (
              <CorrectEntry
                entry={fixing}
                accounts={active}
                payees={payees}
                busy={busy}
                onClose={() => setFixing(null)}
                onSave={async (data) => {
                  if (await save('account.entry_corrected', data)) setFixing(null);
                }}
                error={error}
              />
            )}
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
    </>
  );
}

/** Correct a transfer, reconciliation or money in / out entry, keeping what it was before. */
function CorrectEntry({
  entry,
  accounts,
  payees,
  busy,
  error,
  onClose,
  onSave,
}: {
  entry: Record<string, any>;
  accounts: MoneyAccount[];
  payees: { id: string; name: string; archived?: boolean }[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (data: Record<string, any>) => Promise<void>;
}) {
  const [cancel, setCancel] = useState(false);
  const [problem, setProblem] = useState('');
  const recon = entry.action === 'reconciliation';
  const kind =
    entry.action === 'money'
      ? (MONEY_TYPES[entry.moneyType as keyof typeof MONEY_TYPES]?.label ?? 'Money in / out')
      : recon
        ? 'Reconciliation'
        : 'Transfer';
  const shown = recon ? entry.actualBalance : entry.amount;
  return (
    <Modal title={`Correct entry · ${kind}`} busy={busy} onClose={onClose}>
      {(problem || error) && (
        <p role="alert" className="notice">
          {problem || error}
        </p>
      )}
      <p className="muted">
        Now: {currency(shown)} on {entry.paidOn}. The entry keeps what it was before, who corrected it and
        why.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setProblem('');
          const f = new FormData(e.currentTarget);
          try {
            const data: Record<string, any> = {
              id: entry.id,
              baseVersion: entry.version ?? 1,
              correctionReason: String(f.get('why') ?? ''),
              reason: String(f.get('note') ?? entry.reason),
            };
            if (cancel) data.cancel = true;
            else if (recon)
              data.actualBalance = money(String(f.get('amount'))) * (f.get('sign') === 'negative' ? -1 : 1);
            else {
              data.amount = money(String(f.get('amount')));
              data.paidOn = String(f.get('paidOn'));
              data.accountId = String(f.get('account'));
              if (entry.action === 'transfer') data.toAccountId = String(f.get('to'));
              if (entry.lenderId) data.lenderId = String(f.get('lender'));
            }
            await onSave(data);
          } catch (cause) {
            setProblem(cause instanceof Error ? cause.message : String(cause));
          }
        }}
      >
        <fieldset disabled={busy}>
          <label className="check-label">
            <input type="checkbox" checked={cancel} onChange={(e) => setCancel(e.target.checked)} />
            Cancel this entry (it was not meant to be recorded)
          </label>
          {!cancel && (
            <>
              <label>
                {recon ? 'Counted balance (₦)' : 'Amount (₦)'}
                <CurrencyInput name="amount" required defaultValue={(Math.abs(shown) / 100).toFixed(2)} />
              </label>
              {recon ? (
                <label>
                  Balance type
                  <select
                    aria-label="Balance type"
                    name="sign"
                    defaultValue={shown < 0 ? 'negative' : 'positive'}
                  >
                    <option value="positive">Positive / zero</option>
                    <option value="negative">Overdrawn / negative</option>
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Date
                    <input type="date" name="paidOn" required defaultValue={entry.paidOn} />
                  </label>
                  <label>
                    {entry.action === 'transfer' ? 'From account' : 'Account'}
                    <select aria-label="Entry account" name="account" defaultValue={entry.accountId}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {entry.action === 'transfer' && (
                    <label>
                      To account
                      <select
                        aria-label="Entry destination account"
                        name="to"
                        defaultValue={entry.toAccountId}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {entry.lenderId && (
                    <label>
                      Lender
                      <select aria-label="Entry lender" name="lender" defaultValue={entry.lenderId}>
                        {payees
                          .filter((p) => !p.archived || p.id === entry.lenderId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              <label>
                Note
                <textarea
                  aria-label="Entry note"
                  name="note"
                  required
                  maxLength={500}
                  defaultValue={entry.reason}
                />
              </label>
            </>
          )}
          <label>
            Why are you correcting it?
            <textarea
              aria-label="Correction reason"
              name="why"
              required
              maxLength={500}
              placeholder="e.g. Typed ₦50,000 instead of ₦5,000"
            />
          </label>
          <button type="submit">{cancel ? 'Cancel entry' : 'Save correction'}</button>
        </fieldset>
      </form>
    </Modal>
  );
}
