import { customerBalanceFast } from './balances.mjs';
import { useFeedbackMessage } from './Feedback';
import { walletBalance } from './checkout.mjs';
import CustomerAccount from './CustomerAccount';
import ResponsiveTable from './ResponsiveTable';
import { auditCells, auditHeaders } from './AuditColumns';
import Icon from './Icon';
import ToolbarActions, { MenuToggle } from './ToolbarActions';
import { useState } from 'react';
import Modal from './Modal';
import CustomerEditor from './CustomerEditor';
import { customerCode, customerMatches } from './customers.mjs';
import { servicePrice } from './services.mjs';
import { SortHeader, useTableSort } from './TableSort';
import type { Customer, CustomerEvent, Ledger } from './types';
import { useWords } from './Words';
type Props = {
  ledger: Ledger;
  ready: boolean;
  busy: boolean;
  actor: { id: string; label: string };
  onSave: (event: CustomerEvent) => Promise<void>;
  onRecordPayment: (id: string) => void;
  onStatement?: (id: string) => void;
  /** The owner's view: each branch's records (customer accounts in every branch). */
  branches?: { id: string; name: string; ledger: Ledger }[];
};
const date = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
export default function CustomersPage({
  ledger,
  ready,
  busy,
  actor,
  onSave,
  onRecordPayment,
  onStatement,
  branches,
}: Props) {
  const { w } = useWords();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [audit, setAudit] = useState(false);
  const [account, setAccount] = useState<Customer | null>(null);
  const [editor, setEditor] = useState<Customer | 'new' | null>(null);
  const [confirmation, setConfirmation] = useState<Customer | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const sorting = useTableSort<Customer>('name');
  const jobs = (id: string) => ledger.jobs.filter((item) => item.customerId === id).length;
  const visible = sorting.sortRows(
    ledger.customers.filter(
      (customer) =>
        (filter === 'all' || customer.archived === (filter === 'archived')) &&
        customerMatches(customer, query, ledger.customers, [
          jobs(customer.id),
          (customerBalanceFast(ledger, customer.id) / 100).toFixed(2),
          servicePrice(customerBalanceFast(ledger, customer.id)),
          servicePrice(walletBalance(ledger, customer.id)),
          (walletBalance(ledger, customer.id) / 100).toFixed(2),
        ]),
    ),
    {
      id: (item) => customerCode(item.id, ledger.customers),
      name: (item) => item.name,
      phone: (item) => item.phone,
      address: (item) => item.address,
      creditLimit: (item) => item.creditLimit,
      wallet: (item) => walletBalance(ledger, item.id),
      jobs: (item) => jobs(item.id),
      outstanding: (item) => customerBalanceFast(ledger, item.id),
      status: (item) => (item.archived ? 'Archived' : 'Active'),
      createdBy: (item) => item.createdByLabel,
      createdAt: (item) => Date.parse(item.createdAt),
      modifiedBy: (item) => item.modifiedByLabel,
      modifiedAt: (item) => Date.parse(item.modifiedAt),
    },
  );
  const heading = (column: string, label: string) => (
    <SortHeader column={column} label={w(label)} sort={sorting} />
  );
  async function changeStatus() {
    if (!confirmation || busy) return;
    setError('');
    try {
      await onSave({
        id: crypto.randomUUID(),
        kind: confirmation.archived ? 'customer.restored' : 'customer.archived',
        data: {
          id: confirmation.id,
          baseVersion: confirmation.version,
          modifiedBy: actor.id,
          modifiedByLabel: actor.label,
          modifiedAt: new Date().toISOString(),
        },
      });
      setConfirmation(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save customer.');
    }
  }
  return (
    <>
      <section className="panel">
        <div className="toolbar customer-toolbar">
          <input
            aria-label="Search customers"
            placeholder="Search any customer field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Customer status" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All customers</option>
          </select>
          <ToolbarActions
            more={
              <MenuToggle pressed={audit} icon="audit" onClick={() => setAudit(!audit)}>
                Audit view
              </MenuToggle>
            }
          >
            <button
              disabled={!ready || busy}
              onClick={() => {
                setEditor('new');
                setError('');
              }}
            >
              <Icon name="add" /> Add customer
            </button>
          </ToolbarActions>
        </div>
        {!ready ? (
          <div className="empty">Loading customers.</div>
        ) : !visible.length ? (
          <div className="empty">
            <h2>
              {query
                ? 'No matching customers'
                : filter === 'archived'
                  ? 'No archived customers'
                  : 'No customers yet'}
            </h2>
            <p>Add a customer with their full name and phone number.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 0, label: 'Customer', details: [1, 5] },
                { index: 4, label: 'Outstanding', details: [2, 3] },
                { index: -1, label: 'Actions', actions: true },
              ]}
              extraSortOptions={[
                { key: 'id', label: 'Customer ID' },
                { key: 'phone', label: 'Phone' },
                { key: 'wallet', label: 'Wallet' },
              ]}
            >
              <table className="customers-table">
                <thead>
                  <tr>
                    {heading('name', 'Customer')}
                    {heading('address', 'Address')}
                    {heading('creditLimit', 'Credit limit')}
                    {heading('jobs', 'Jobs')}
                    {heading('outstanding', 'Outstanding · wallet')}
                    {heading('status', 'Status')}
                    {audit && auditHeaders(sorting)}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <strong>{customer.name}</strong>
                        {customer.phone && customer.phone !== customer.name && (
                          <small>{customer.phone}</small>
                        )}
                        <small className="record-id">{customerCode(customer.id, ledger.customers)}</small>
                      </td>
                      <td>{customer.address || '-'}</td>
                      <td className="cell-fit">{servicePrice(customer.creditLimit)}</td>
                      <td className="cell-fit">{jobs(customer.id)}</td>
                      <td className="cell-fit">
                        {servicePrice(customerBalanceFast(ledger, customer.id))}
                        <small>Wallet: {servicePrice(walletBalance(ledger, customer.id))}</small>
                      </td>
                      <td className="cell-fit">
                        <span className={`badge ${customer.archived ? 'unpaid' : 'paid'}`}>
                          {customer.archived ? 'Archived' : 'Active'}
                        </span>
                      </td>
                      {audit && auditCells(customer, date)}
                      <td>
                        <div className="material-actions">
                          <button className="text-button" onClick={() => setAccount(customer)}>
                            <Icon name="customers" /> Account records
                          </button>
                          {onStatement && (
                            <button className="text-button" onClick={() => onStatement(customer.id)}>
                              <Icon name="reports" /> Statement
                            </button>
                          )}
                          {!customer.archived && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => setEditor(customer)}
                            >
                              <Icon name="edit" /> Edit
                            </button>
                          )}
                          <button
                            className={`text-button ${customer.archived ? '' : 'danger-text'}`}
                            disabled={busy}
                            onClick={() => {
                              setConfirmation(customer);
                              setError('');
                            }}
                          >
                            <Icon name={customer.archived ? 'restore' : 'archive'} />{' '}
                            {customer.archived ? 'Restore' : 'Archive'}
                          </button>
                          <button
                            className="text-button"
                            disabled={busy || customer.archived}
                            onClick={() => onRecordPayment(customer.id)}
                          >
                            <Icon name="payments" /> Record payment
                          </button>
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
      {account && (
        <CustomerAccount
          customer={account}
          ledger={ledger}
          branches={branches}
          onClose={() => setAccount(null)}
        />
      )}
      {editor && (
        <CustomerEditor
          key={editor === 'new' ? 'new' : editor.id + ':' + editor.version}
          customer={editor === 'new' ? undefined : editor}
          customers={ledger.customers}
          actor={actor}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditor(null)}
        />
      )}
      {confirmation && (
        <Modal
          title={`${confirmation.archived ? 'Restore' : 'Archive'} ${confirmation.name}?`}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <p>
            {confirmation.archived
              ? 'The customer will be active again.'
              : w(
                  'Their details and existing jobs and payments will be retained. You can restore them later.',
                )}
          </p>
          <div className="material-actions">
            <button
              className={confirmation.archived ? '' : 'danger-button'}
              disabled={busy}
              onClick={() => void changeStatus()}
            >
              <Icon name="archive" />{' '}
              {busy ? 'Saving...' : confirmation.archived ? 'Restore customer' : 'Archive customer'}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              <Icon name="close" /> Cancel
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
