import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { operationEvent } from './operations.mjs';
import { expensePaid, expenseDay } from './expenses.mjs';
import { payeeListSections } from './reports.mjs';
import { downloadCsv } from './export-csv';
import { currency } from './receipts.mjs';
import { lenderIds, lenderSummary } from './lenders.mjs';
import type { Ledger, Payee, OperationsEvent } from './types';
import { SortHeader, useTableSort } from './TableSort';
export default function PayeesPage({
  ledger,
  busy,
  actor,
  onSave,
  branches,
  businessName = '',
  onStatement,
}: {
  businessName?: string;
  /** Open this payee's statement in Reports. */
  onStatement?: (id: string) => void;
  /** The owner's view: each branch's records, to show what each branch owes a payee. */
  branches?: { id: string; name: string; ledger: Ledger }[];
  ledger: Ledger;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: OperationsEvent) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [kind, setKind] = useState<'all' | 'suppliers' | 'lenders'>('all'),
    [editing, setEditing] = useState<Payee | 'new' | null>(null),
    [view, setView] = useState<Payee | null>(null),
    [error, setError] = useState('');
  const sorting = useTableSort<Payee>('name');
  const lenders = lenderIds(ledger);
  const expenses = (id: string) => ledger.expenses.filter((e) => e.payeeId === id);
  const totals = (id: string) => {
    const rows = expenses(id);
    const incurred = rows.filter((e) => !e.voided).reduce((n, e) => n + e.amount, 0),
      paid = rows.reduce((n, e) => n + expensePaid(e), 0),
      owed = rows.filter((e) => !e.voided).reduce((n, e) => n + Math.max(0, e.amount - expensePaid(e)), 0);
    return { incurred, paid, owed };
  };
  const rows = sorting.sortRows(
    (ledger.payees ?? []).filter(
      (p) =>
        (archived || !p.archived) &&
        (kind === 'all' || (kind === 'lenders') === lenders.has(p.id)) &&
        [p.name, p.phone, p.address, p.note, p.id].join(' ').toLowerCase().includes(query.toLowerCase()),
    ),
    { name: (p) => p.name, owed: (p) => totals(p.id).owed },
  );
  // Summary cards: what is owed to payees, and what was spent and paid this month (Lagos).
  const month = expenseDay(new Date().toISOString()).slice(0, 7);
  const linked = ledger.expenses.filter((e) => e.payeeId);
  const owedTotal = linked
    .filter((e) => !e.voided)
    .reduce((n, e) => n + Math.max(0, e.amount - expensePaid(e)), 0);
  const owedPayees = new Set(
    linked.filter((e) => !e.voided && e.amount > expensePaid(e)).map((e) => e.payeeId),
  ).size;
  const spentMonth = linked
    .filter((e) => !e.voided && e.incurredOn.startsWith(month))
    .reduce((n, e) => n + e.amount, 0);
  const paidMonth = linked
    .flatMap((e) => e.payments)
    .filter((p) => p.paidOn.startsWith(month))
    .reduce((n, p) => n + p.amount, 0);
  const activeCount = (ledger.payees ?? []).filter((p) => !p.archived).length;
  const exportTitle = [
    businessName,
    'Payees',
    `As of ${new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })}`,
  ].filter(Boolean);
  const exportCsv = () => {
    setError('');
    try {
      downloadCsv('Payees', exportTitle, payeeListSections(ledger, { archived }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const exportPdf = async () => {
    setError('');
    try {
      const { downloadReportPdf } = await import('./report-pdf');
      downloadReportPdf('Payees', businessName, {
        title: 'Payees',
        subtitle: exportTitle.slice(2),
        sections: payeeListSections(ledger, { archived, money: currency, unit: '' }),
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
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
  return (
    <>
      <section className="stats" aria-label="Payee summary">
        <article>
          <span>Owed to payees</span>
          <strong>{currency(owedTotal)}</strong>
          <small>{owedPayees === 1 ? '1 payee is owed' : `${owedPayees} payees are owed`}</small>
        </article>
        <article>
          <span>Spent this month</span>
          <strong>{currency(spentMonth)}</strong>
          <small>Expenses with a saved payee</small>
        </article>
        <article>
          <span>Paid this month</span>
          <strong>{currency(paidMonth)}</strong>
          <small>Payments to saved payees</small>
        </article>
        <article>
          <span>Active payees</span>
          <strong>{activeCount}</strong>
        </article>
      </section>
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search payees"
            placeholder="Search name, phone, address or ID"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {lenders.size > 0 && (
            <select
              aria-label="Payee kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="all">All payees</option>
              <option value="suppliers">Suppliers</option>
              <option value="lenders">Lenders</option>
            </select>
          )}
          <label className="check-label">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            Show archived
          </label>
          <button className="secondary" onClick={exportCsv}>
            <Icon name="export" /> Spreadsheet
          </button>
          <button className="secondary" onClick={() => void exportPdf()}>
            <Icon name="export" /> Print / PDF
          </button>
          <button disabled={busy} onClick={() => setEditing('new')}>
            <Icon name="add" />
            Add payee
          </button>
        </div>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <SortHeader label="Payee" column="name" sort={sorting} />
                <SortHeader label="Expenses / payments" column="owed" sort={sorting} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const t = totals(p.id);
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>{p.phone}</small>
                      <small>{p.address}</small>
                      {p.archived && <small>Archived</small>}
                      {lenders.has(p.id) && <span className="badge">Lender</span>}
                    </td>
                    <td>
                      <strong>Outstanding {currency(t.owed)}</strong>
                      <small>Incurred {currency(t.incurred)}</small>
                      <small>Paid {currency(t.paid)}</small>
                      {lenders.has(p.id) &&
                        (() => {
                          const loan = lenderSummary(ledger, p.id);
                          return (
                            <>
                              <small>
                                <strong>Loan owed {currency(loan.owed)}</strong> · borrowed{' '}
                                {currency(loan.borrowed)} · repaid {currency(loan.repaid)}
                              </small>
                              {loan.owed > 0 && p.repaymentDue && (
                                <small>Next repayment due {p.repaymentDue}</small>
                              )}
                            </>
                          );
                        })()}
                      {branches &&
                        branches.length > 1 &&
                        branches.map((b) => {
                          const owed = b.ledger.expenses
                            .filter((e) => e.payeeId === p.id && !e.voided)
                            .reduce((n, e) => n + Math.max(0, e.amount - expensePaid(e)), 0);
                          return (
                            <small key={b.id}>
                              {b.name}: owes {currency(owed)}
                            </small>
                          );
                        })}
                    </td>
                    <td>
                      <div className="material-actions">
                        <button className="text-button" disabled={busy} onClick={() => setView(p)}>
                          Transactions
                        </button>
                        {onStatement && (
                          <button className="text-button" onClick={() => onStatement(p.id)}>
                            <Icon name="reports" /> Statement
                          </button>
                        )}
                        <button className="text-button" disabled={busy} onClick={() => setEditing(p)}>
                          Edit
                        </button>
                        <button
                          className={`text-button ${p.archived ? '' : 'danger-text'}`}
                          disabled={busy}
                          onClick={() =>
                            void save(p.archived ? 'payee.restored' : 'payee.archived', {
                              id: p.id,
                              baseVersion: p.version,
                            })
                          }
                        >
                          {p.archived ? 'Restore' : 'Archive'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!rows.length && <p className="muted">No matching payees.</p>}
        {editing && (
          <Modal
            title={editing === 'new' ? 'Add payee' : 'Edit payee'}
            busy={busy}
            onClose={() => setEditing(null)}
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
                if (
                  await save(editing === 'new' ? 'payee.created' : 'payee.updated', {
                    id: editing === 'new' ? crypto.randomUUID() : editing.id,
                    baseVersion: editing === 'new' ? undefined : editing.version,
                    name: String(f.get('name')),
                    phone: String(f.get('phone')),
                    address: String(f.get('address')),
                    note: String(f.get('note')),
                    ...(editing !== 'new' && lenders.has(editing.id)
                      ? { repaymentDue: String(f.get('repaymentDue') ?? '') }
                      : {}),
                  })
                )
                  setEditing(null);
              }}
            >
              <fieldset disabled={busy}>
                <label>
                  Payee name
                  <input
                    name="name"
                    aria-label="Payee name"
                    maxLength={160}
                    required
                    defaultValue={editing === 'new' ? '' : editing.name}
                  />
                </label>
                <label>
                  Phone
                  <input name="phone" maxLength={40} defaultValue={editing === 'new' ? '' : editing.phone} />
                </label>
                <label>
                  Address
                  <textarea
                    name="address"
                    maxLength={500}
                    defaultValue={editing === 'new' ? '' : editing.address}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    name="note"
                    maxLength={1000}
                    defaultValue={editing === 'new' ? '' : editing.note}
                  />
                </label>
                {editing !== 'new' && lenders.has(editing.id) && (
                  <label>
                    Next loan repayment due
                    <input type="date" name="repaymentDue" defaultValue={editing.repaymentDue ?? ''} />
                    <small>
                      Optional. Admins get a reminder three days before. Clear it when there is none.
                    </small>
                  </label>
                )}
                <button type="submit">Save payee</button>
              </fieldset>
            </form>
          </Modal>
        )}
        {view && (
          <Modal title={`Payee transactions · ${view.name}`} wide busy={busy} onClose={() => setView(null)}>
            <p>
              {view.phone} · {view.address}
            </p>
            <div className="detail-summary">
              <span>
                Incurred <strong>{currency(totals(view.id).incurred)}</strong>
              </span>
              <span>
                Paid <strong>{currency(totals(view.id).paid)}</strong>
              </span>
              <span>
                Outstanding <strong>{currency(totals(view.id).owed)}</strong>
              </span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Expense</th>
                    <th>Amount / balance</th>
                    <th>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses(view.id)
                    .sort((a, b) => b.incurredOn.localeCompare(a.incurredOn))
                    .map((e) => (
                      <tr key={e.id}>
                        <td>
                          {e.description}
                          <small>
                            {e.incurredOn} · {e.category}
                          </small>
                          <small>Recorded as: {e.payee}</small>
                          {e.voided && <small>Voided · payments retained</small>}
                        </td>
                        <td>
                          {currency(e.amount)}
                          <small>
                            Outstanding {currency(e.voided ? 0 : Math.max(0, e.amount - expensePaid(e)))}
                          </small>
                        </td>
                        <td>
                          {e.payments.map((p) => (
                            <small key={p.id}>
                              {p.paidAt
                                ? new Date(p.paidAt).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' })
                                : p.paidOn}{' '}
                              · {currency(p.amount)} · {p.methodLabel || p.method}
                            </small>
                          ))}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>Audit history</summary>
              {(ledger.operationHistory ?? [])
                .filter((h) => h.recordId === view.id)
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
