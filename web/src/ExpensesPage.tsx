import { useFeedbackMessage } from './Feedback';
import { paymentName } from './business-options.mjs';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useState } from 'react';
import ExpenseEditor from './ExpenseEditor';
import Modal from './Modal';
import Icon from './Icon';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useDateFilter } from './PeriodFilter';
import ResponsiveTable from './ResponsiveTable';
import { auditCells, auditHeaders } from './AuditColumns';
import { SortHeader, useTableSort } from './TableSort';
import { expenseCode, expensePaid, expenseStatus, expenseSummary, makeExpenseEvent } from './expenses.mjs';
import type { Expense, ExpenseEvent, Ledger, LedgerEvent } from './types';
import { useWords } from './Words';
import { renameActive as wt } from './Words';
import { alphabetical } from './alphabetical.mjs';
const currency = (value: number) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(value / 100);
const timestamp = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
const day = (value: string) =>
  new Date(value + 'T12:00:00+01:00').toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Africa/Lagos',
  });
export default function ExpensesPage({
  ledger,
  ready,
  busy,
  actor,
  pending,
  onSave,
}: {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  pending: LedgerEvent[];
  onSave: (event: ExpenseEvent) => Promise<void>;
}) {
  const { w } = useWords();
  const { expenseCategories } = useBusinessOptions();
  const [query, setQuery] = useState(''),
    [status, setStatus] = useState('active'),
    [category, setCategory] = useState(''),
    [staff, setStaff] = useState(''),
    [filtersOpen, setFiltersOpen] = useState(false);
  const dates = useDateFilter('expenses');
  const from = dates.period.preset === 'all' ? '' : dates.period.from,
    to = dates.period.preset === 'all' ? '' : dates.period.to;
  const [audit, setAudit] = useState(false),
    [editor, setEditor] = useState<Expense | 'new' | null>(null),
    [payment, setPayment] = useState<Expense | null>(null),
    [detail, setDetail] = useState<Expense | null>(null),
    [voiding, setVoiding] = useState<Expense | null>(null),
    [reason, setReason] = useState(''),
    [error, setError] = useFeedbackMessage('error');
  const sorting = useTableSort<Expense>('date', 'desc');
  const summary = expenseSummary(ledger, from, to);
  const visible = sorting.sortRows(
    ledger.expenses.filter((item) => {
      const state = expenseStatus(item),
        text = [
          expenseCode(item.id, ledger.expenses),
          item.id,
          item.description,
          item.category,
          item.payee,
          item.note,
          item.receiptReference,
          item.amount / 100,
          expensePaid(item) / 100,
          state,
          item.createdByLabel,
          item.modifiedByLabel,
          item.incurredOn,
          ...item.materials.map((m) => m.name),
          ...item.payments.map((p) => `${paymentName(p)} ${p.source} ${p.reference}`),
        ]
          .join(' ')
          .toLowerCase();
      return (
        text.includes(query.trim().toLowerCase()) &&
        (!category || item.category === category) &&
        (!staff || item.createdBy === staff) &&
        (!from || item.incurredOn >= from) &&
        (!to || item.incurredOn <= to) &&
        (status === 'all' || (status === 'active' && !item.voided) || status === state)
      );
    }),
    {
      id: (item) => expenseCode(item.id, ledger.expenses),
      description: (item) => item.description,
      category: (item) => item.category,
      payee: (item) => item.payee,
      date: (item) => item.incurredOn,
      amount: (item) => item.amount,
      paid: (item) => expensePaid(item),
      outstanding: (item) => (item.voided ? 0 : item.amount - expensePaid(item)),
      status: expenseStatus,
      createdBy: (item) => item.createdByLabel,
      createdAt: (item) => Date.parse(item.createdAt),
      modifiedBy: (item) => item.modifiedByLabel,
      modifiedAt: (item) => Date.parse(item.modifiedAt),
    },
  );
  const selected = detail && ledger.expenses.find((item) => item.id === detail.id);
  const history = selected
    ? ledger.expenseHistory
        .filter((entry) => entry.expenseId === selected.id)
        .slice()
        .reverse()
    : [];
  const activeFilters = (status !== 'active' ? 1 : 0) + (category ? 1 : 0) + (staff ? 1 : 0);
  const reset = () => {
    setQuery('');
    setStatus('active');
    setCategory('');
    setStaff('');
    dates.reset();
  };
  return (
    <>
      <section className="stats expense-stats">
        <article>
          <span>Expenses incurred</span>
          <strong>{currency(summary.incurred)}</strong>
          <small>Active expenses in the date range</small>
        </article>
        <article>
          <span>Money paid out</span>
          <strong>{currency(summary.paid)}</strong>
          <small>By payment date, including payments on voided records</small>
        </article>
        <article>
          <span>Unpaid expenses</span>
          <strong>{currency(summary.unpaid)}</strong>
          <small>Remaining balance on expenses in the date range</small>
        </article>
        <article>
          <span>Sales less expenses</span>
          <strong>{currency(summary.result)}</strong>
          <small>
            {w('Job sales')} {currency(summary.sales)} − expenses {currency(summary.incurred)}
          </small>
        </article>
      </section>
      <p className="footnote">
        {from || to ? `${from ? day(from) : 'Beginning'} – ${to ? day(to) : 'Present'}` : 'All dates'} · Sales
        less expenses counts purchases when incurred, including unused stock. It is an estimate of the
        period’s result. Category, staff and search filters apply to the list.
      </p>
      <section className="panel expense-panel">
        <div className="toolbar history-toolbar expense-toolbar">
          <input
            aria-label="Search expenses"
            placeholder={wt('Search description, ID, supplier, amount or material')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={`secondary filter-button${activeFilters ? ' filtered' : ''}`}
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <Icon name="sort" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
          {dates.button}
          <ToolbarActions
            more={
              <MenuToggle pressed={audit} icon="audit" onClick={() => setAudit(!audit)}>
                Audit view
              </MenuToggle>
            }
          >
            <button disabled={!ready || busy} onClick={() => setEditor('new')}>
              <Icon name="add" />
              Add expense
            </button>
          </ToolbarActions>
        </div>
        {filtersOpen && (
          <div className="period-panel filter-panel" role="group" aria-label="Expense filters">
            <label>
              Status
              <select aria-label="Expense status" value={status} onChange={(e) => setStatus(e.target.value)}>
                {['active', 'all', 'Unpaid', 'Partly paid', 'Paid', 'Voided'].map((value) => (
                  <option key={value} value={value}>
                    {value === 'active' ? 'Active expenses' : value === 'all' ? 'All expenses' : value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Category
              <select
                aria-label="Expense category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {[...new Set([...expenseCategories, ...ledger.expenses.map((item) => item.category)])]
                  .sort()
                  .map((value) => (
                    <option key={value}>{value}</option>
                  ))}
              </select>
            </label>
            <label>
              Recorded by
              <select aria-label="Recorded by" value={staff} onChange={(e) => setStaff(e.target.value)}>
                <option value="">All staff</option>
                {alphabetical(
                  [
                    ...new Map(
                      ledger.expenses.map((item) => [item.createdBy, item.createdByLabel]),
                    ).entries(),
                  ],
                  ([, label]) => label,
                ).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary history-filter-reset" onClick={reset}>
              <Icon name="sync" /> Reset filters
            </button>
          </div>
        )}
        {dates.panel}
        {!ready ? (
          <p className="empty">Loading expenses…</p>
        ) : !visible.length ? (
          <div className="empty">
            <h2>{ledger.expenses.length ? 'No matching expenses' : 'No expenses yet'}</h2>
            <p>{wt('Record shop expenses and optionally add purchased materials to stock.')}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: 'Expense', details: [1, 2, 4] },
                { index: 3, label: 'Amount' },
                { index: -1, label: 'Actions', actions: true },
              ]}
              extraSortOptions={[
                { key: 'id', label: 'ID' },
                { key: 'category', label: 'Category' },
                { key: 'paid', label: 'Paid' },
                { key: 'outstanding', label: 'Outstanding' },
              ]}
            >
              <table className="expenses-table">
                <thead>
                  <tr>
                    <SortHeader label="Expense" column="description" sort={sorting} />
                    <SortHeader label="Supplier / paid to" column="payee" sort={sorting} />
                    <SortHeader label="Date incurred" column="date" sort={sorting} />
                    <SortHeader label="Amount" column="amount" sort={sorting} />
                    <SortHeader label="Status" column="status" sort={sorting} />
                    {audit && auditHeaders(sorting)}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.description}</strong>
                        {item.materials.length > 0 && (
                          <small>
                            {item.materials
                              .map((m) => `${m.name}: ${m.quantity.toLocaleString()} ${m.measurementUnit}`)
                              .join(' · ')}
                          </small>
                        )}
                        <small>
                          {item.category} ·{' '}
                          <span className="record-id">{expenseCode(item.id, ledger.expenses)}</span>
                        </small>
                      </td>
                      <td>{item.payee || '—'}</td>
                      <td className="cell-fit">{day(item.incurredOn)}</td>
                      <td className="cell-fit">
                        {currency(item.amount)}
                        <small>Paid: {currency(expensePaid(item))}</small>
                        {!item.voided && item.amount - expensePaid(item) > 0 && (
                          <small>Outstanding: {currency(item.amount - expensePaid(item))}</small>
                        )}
                      </td>
                      <td className="cell-fit">
                        <span
                          className={`badge ${item.voided ? 'unpaid' : expenseStatus(item) === 'Paid' ? 'paid' : 'partial'}`}
                        >
                          {expenseStatus(item)}
                        </span>
                        {pending.some((e) => e.kind.startsWith('expense.') && e.data.id === item.id) && (
                          <small>Pending sync</small>
                        )}
                      </td>
                      {audit && auditCells(item, timestamp)}
                      <td>
                        <div className="material-actions">
                          <button className="text-button" onClick={() => setDetail(item)}>
                            <Icon name="details" />
                            Details
                          </button>
                          {!item.voided && (
                            <>
                              <button className="text-button" disabled={busy} onClick={() => setEditor(item)}>
                                <Icon name="edit" />
                                Edit
                              </button>
                              {expensePaid(item) < item.amount && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setPayment(item)}
                                >
                                  <Icon name="payments" />
                                  Record payment
                                </button>
                              )}
                              <button
                                className="text-button danger-text"
                                disabled={busy}
                                onClick={() => {
                                  setVoiding(item);
                                  setReason('');
                                  setError('');
                                }}
                              >
                                <Icon name="close" />
                                Void
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
          </div>
        )}
      </section>
      {editor && (
        <ExpenseEditor
          key={editor === 'new' ? 'new' : editor.id + ':' + editor.version}
          expense={editor === 'new' ? undefined : editor}
          expenses={ledger.expenses}
          payees={ledger.payees}
          accounts={ledger.moneyAccounts}
          materials={ledger.materials}
          actor={actor}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditor(null)}
        />
      )}
      {payment && (
        <ExpenseEditor
          key={payment.id + ':' + payment.version}
          expense={payment}
          mode="payment"
          expenses={ledger.expenses}
          payees={ledger.payees}
          accounts={ledger.moneyAccounts}
          materials={ledger.materials}
          actor={actor}
          busy={busy}
          onSave={onSave}
          onClose={() => setPayment(null)}
        />
      )}
      {voiding && (
        <Modal title="Void expense?" busy={busy} onClose={() => setVoiding(null)}>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p>
            <strong>{voiding.description}</strong> · {currency(voiding.amount)}
          </p>
          <p>
            This removes the expense from expense totals and reverses its stock additions. Recorded payments
            remain in money paid out; voiding does not refund money.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setError('');
              try {
                await onSave(makeExpenseEvent('expense.voided', { reason }, voiding, actor) as ExpenseEvent);
                setVoiding(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Could not void expense.');
              }
            }}
          >
            <label>
              Reason
              <textarea
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <button className="danger-button" disabled={busy}>
              <Icon name="close" />
              {busy ? 'Saving…' : 'Void expense'}
            </button>
          </form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`Expense ${expenseCode(selected.id, ledger.expenses)}`}
          wide
          onClose={() => setDetail(null)}
        >
          <h3>{selected.description}</h3>
          <p>
            {selected.category} · {day(selected.incurredOn)} · {selected.payee || 'No supplier recorded'}
          </p>
          <div className="detail-summary">
            <span>
              Total<strong>{currency(selected.amount)}</strong>
            </span>
            <span>
              Paid<strong>{currency(expensePaid(selected))}</strong>
            </span>
            <span>
              Outstanding
              <strong>
                {selected.voided ? 'Voided' : currency(selected.amount - expensePaid(selected))}
              </strong>
            </span>
          </div>
          {selected.voided && <p className="notice">Voided: {selected.voidReason}</p>}
          {selected.note && <p>Notes: {selected.note}</p>}
          {selected.receiptReference && <p>Receipt / invoice: {selected.receiptReference}</p>}
          {selected.materials.length > 0 && (
            <>
              <h3>{wt('Purchased materials')}</h3>
              {selected.materials.map((m) => (
                <p key={m.materialId}>
                  {m.name}:{' '}
                  <strong>
                    {m.quantity.toLocaleString()} {m.measurementUnit}
                  </strong>
                </p>
              ))}
            </>
          )}
          <h3>Payment history</h3>
          {!selected.payments.length ? (
            <p className="muted">No payments yet.</p>
          ) : (
            selected.payments.map((p) => (
              <div className="history" key={p.id}>
                <span>
                  {day(p.paidOn)} · {paymentName(p)}
                  <small>
                    {p.source} · {p.createdByLabel}
                    {p.reference && ` · ${p.reference}`}
                  </small>
                </span>
                <strong>{currency(p.amount)}</strong>
              </div>
            ))
          )}
          <h3>Change history</h3>
          {history.map((entry) => (
            <details key={entry.id} className="expense-change">
              <summary>
                {
                  {
                    'expense.created': 'Created',
                    'expense.updated': 'Edited',
                    'expense.payment_recorded': 'Payment recorded',
                    'expense.voided': 'Voided',
                  }[entry.action]
                }{' '}
                · {entry.changedByLabel} · {timestamp(entry.changedAt)}
              </summary>
              <p>
                Total: {entry.before ? currency(entry.before.amount) : '—'} → {currency(entry.after.amount)}
                <br />
                Paid: {entry.before ? currency(expensePaid(entry.before)) : '—'} →{' '}
                {currency(expensePaid(entry.after))}
              </p>
              <p>
                Before:{' '}
                {entry.before
                  ? `${entry.before.description} · ${entry.before.category} · ${entry.before.incurredOn} · ${entry.before.payee} · ${entry.before.note} · ${entry.before.receiptReference}`
                  : 'New expense'}
                <br />
                After: {entry.after.description} · {entry.after.category} · {entry.after.incurredOn} ·{' '}
                {entry.after.payee} · {entry.after.note} · {entry.after.receiptReference}
              </p>
              <p>
                {wt('Materials before')}:{' '}
                {entry.before?.materials
                  .map((m) => `${m.name}: ${m.quantity} ${m.measurementUnit}`)
                  .join(' · ') || 'None'}
                <br />
                {wt('Materials after')}:{' '}
                {entry.after.voided
                  ? 'Reversed'
                  : entry.after.materials
                      .map((m) => `${m.name}: ${m.quantity} ${m.measurementUnit}`)
                      .join(' · ') || 'None'}
              </p>
              {entry.after.voided && <p>Void reason: {entry.after.voidReason}</p>}
            </details>
          ))}
        </Modal>
      )}
    </>
  );
}
