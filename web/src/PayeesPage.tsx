import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { operationEvent } from './operations.mjs';
import { expensePaid } from './expenses.mjs';
import { currency } from './receipts.mjs';
import type { Ledger, Payee, OperationsEvent } from './types';
import { SortHeader, useTableSort } from './TableSort';
export default function PayeesPage({
  ledger,
  busy,
  actor,
  onSave,
  branches,
}: {
  /** The owner's view: each branch's records, to show what each branch owes a payee. */
  branches?: { id: string; name: string; ledger: Ledger }[];
  ledger: Ledger;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: OperationsEvent) => Promise<void>;
}) {
  const [query, setQuery] = useState(''),
    [archived, setArchived] = useState(false),
    [editing, setEditing] = useState<Payee | 'new' | null>(null),
    [view, setView] = useState<Payee | null>(null),
    [error, setError] = useState('');
  const sorting = useTableSort<Payee>('name');
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
        [p.name, p.phone, p.address, p.note, p.id].join(' ').toLowerCase().includes(query.toLowerCase()),
    ),
    { name: (p) => p.name, owed: (p) => totals(p.id).owed },
  );
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
    <section className="panel">
      <div className="toolbar">
        <input
          aria-label="Search payees"
          placeholder="Search name, phone, address or ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check-label">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Show archived
        </label>
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
                  </td>
                  <td>
                    <strong>Outstanding {currency(t.owed)}</strong>
                    <small>Incurred {currency(t.incurred)}</small>
                    <small>Paid {currency(t.paid)}</small>
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
                <textarea name="note" maxLength={1000} defaultValue={editing === 'new' ? '' : editing.note} />
              </label>
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
                            {p.paidOn} · {currency(p.amount)} · {p.methodLabel || p.method}
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
  );
}
