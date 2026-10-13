import { useFeedbackMessage } from './Feedback';
import { paymentName } from './business-options.mjs';
import { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import CurrencyInput from './CurrencyInput';
import ResponsiveTable from './ResponsiveTable';
import { SortHeader, useTableSort } from './TableSort';
import { money } from './domain.mjs';
import { currency } from './receipts.mjs';
import { myTransactions, drawerSnapshot, salesSummary, saleDay, saleDescription } from './my-sales.mjs';
import type { Ledger, CheckoutRecord, DrawerClosing, DrawerCommand, SaleAdjustment } from './types';
import { useWords } from './Words';
type Props = {
  ledger: Ledger;
  userId: string;
  username: string;
  name: string;
  ready: boolean;
  busy: boolean;
  online: boolean;
  demo: boolean;
  pending: number;
  onReceipt: (record: CheckoutRecord) => void;
  onHandover: (command: DrawerCommand) => Promise<void>;
};
const date = (value: string) => new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
export default function MySalesPage({
  ledger,
  userId,
  username,
  name,
  ready,
  busy,
  online,
  demo,
  pending,
  onReceipt,
  onHandover,
}: Props) {
  const { w } = useWords();
  const [query, setQuery] = useState(''),
    [day, setDay] = useState(saleDay(new Date().toISOString())),
    [status, setStatus] = useState('open'),
    [history, setHistory] = useState(false);
  const [closing, setClosing] = useState<string | null>(null),
    [details, setDetails] = useState<DrawerClosing | null>(null),
    [error, setError] = useFeedbackMessage('error'),
    [count, setCount] = useState('');
  const sorting = useTableSort<CheckoutRecord>('date', 'desc'),
    drawerSort = useTableSort<DrawerClosing>('date', 'desc');
  const snapshot = drawerSnapshot(ledger, userId),
    openIds = new Set(snapshot.checkoutIds);
  const records = sorting.sortRows(
    myTransactions(ledger, userId, true).filter(
      (r: CheckoutRecord) =>
        (!day || saleDay(r.createdAt) === day) &&
        (status === 'all' || (status === 'open' ? openIds.has(r.id) : !openIds.has(r.id))) &&
        [
          r.id,
          r.customerSnapshot.name,
          r.customerSnapshot.phone,
          saleDescription(r),
          paymentName(r),
          r.cashReceived / 100,
          r.total / 100,
          r.reference,
          r.createdAt,
        ]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    {
      id: (r) => r.id,
      customer: (r) => r.customerSnapshot.name,
      description: saleDescription,
      sales: (r) => r.total,
      received: (r) => r.cashReceived,
      wallet: (r) => r.walletUsed,
      method: paymentName,
      date: (r) => Date.parse(r.createdAt),
      status: (r) => (openIds.has(r.id) ? 'Open' : 'Closed'),
    },
  );
  const summary = salesSummary(records);
  const drawers = drawerSort.sortRows(
    ledger.drawerClosings.filter(
      (d) =>
        (d.fromUserId === userId || d.toUserId === userId) &&
        (!day || saleDay(d.closedAt) === day) &&
        [d.id, d.fromUserLabel, d.toUserLabel, d.countedCash / 100, d.note, d.closedAt]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    {
      id: (d) => d.id,
      date: (d) => Date.parse(d.closedAt),
      from: (d) => d.fromUserLabel,
      to: (d) => d.toUserLabel,
      expected: (d) => d.expectedCash,
      counted: (d) => d.countedCash,
      difference: (d) => d.difference,
    },
  );
  let difference: number | null = null;
  try {
    difference = money(count) - snapshot.expectedCash;
  } catch {}
  return (
    <>
      <div className="stats">
        <article>
          <span>
            <Icon name="payments" /> Cash received
          </span>
          <strong>{currency(summary.cash)}</strong>
          <small>Corrected recorded cash in the displayed transactions</small>
        </article>
        <article>
          <span>Total money received</span>
          <strong>{currency(summary.collected)}</strong>
          <small>
            POS {currency(summary.pos)} · Transfer {currency(summary.transfer)} · Wallet used{' '}
            {currency(summary.walletUsed)}
          </small>
        </article>
        <article>
          <span>Customers served</span>
          <strong>{summary.customers.length}</strong>
          <small>
            {w('New jobs')}: {currency(summary.sales)} · {records.length} transactions
          </small>
        </article>
      </div>
      <section className="panel">
        <div className="toolbar">
          <input
            aria-label="Search my sales"
            placeholder="Search customer, transaction, amount or method"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <label>
            Date
            <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <button className="secondary" onClick={() => setDay('')}>
            All dates
          </button>
          <select aria-label="My sales status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open">Unclosed</option>
            <option value="closed">Closed</option>
            <option value="all">All transactions</option>
          </select>
          <button className="secondary" onClick={() => setHistory((v) => !v)}>
            <Icon name="history" /> {history ? 'Transactions' : 'Drawer history'}
          </button>
          <button
            disabled={!ready || busy || !online || demo}
            onClick={() => {
              setClosing(crypto.randomUUID());
              setCount('');
              setError('');
            }}
          >
            <Icon name="drawer" /> Close drawer
          </button>
        </div>
        {demo && (
          <p className="drawer-info">
            Sign in to a business to verify both users and record a drawer handover.
          </p>
        )}
        {snapshot.corrections.length > 0 && (
          <section className="panel">
            <h3>Unclosed payment corrections</h3>
            {snapshot.corrections.map((r: SaleAdjustment) => (
              <p key={r.id}>
                Cash effect {currency(r.cashDelta ?? 0)} · {r.reason}
                <small>
                  Approved by {r.changedByLabel} · {date(r.changedAt)}
                </small>
              </p>
            ))}
          </section>
        )}
        {snapshot.refunds.length > 0 && (
          <section className="panel">
            <h3>Unclosed refunds from your drawer</h3>
            {snapshot.refunds.map((r: SaleAdjustment) => (
              <p key={r.id}>
                {ledger.customers.find((c) => c.id === r.customerId)?.name} · {currency(r.refundAmount)} ·{' '}
                {r.methodLabel ?? r.method}
                <small>
                  {r.reason} · {date(r.changedAt)}
                </small>
              </p>
            ))}
          </section>
        )}
        {!online && (
          <p className="drawer-info">
            Your saved sales remain available. Connect to verify both users and close the drawer.
          </p>
        )}
        {!ready ? (
          <p className="empty">Loading your sales…</p>
        ) : history ? (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 1, label: 'Handover', details: [0, 2, 6] },
                { index: 4, label: 'Cash', details: [3, 5] },
                { index: 7, label: 'Actions' },
              ]}
              labels={{ 0: 'ID', 2: 'Received by', 3: 'Expected', 5: 'Difference', 6: 'Date' }}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Closing ID" column="id" sort={drawerSort} />
                    <SortHeader label="Closed by" column="from" sort={drawerSort} />
                    <SortHeader label="Received by" column="to" sort={drawerSort} />
                    <SortHeader label="Expected cash" column="expected" sort={drawerSort} />
                    <SortHeader label="Counted cash" column="counted" sort={drawerSort} />
                    <SortHeader label="Difference" column="difference" sort={drawerSort} />
                    <SortHeader label="Date" column="date" sort={drawerSort} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {drawers.map((d) => (
                    <tr key={d.id}>
                      <td>{d.id.slice(0, 8).toUpperCase()}</td>
                      <td>{d.fromUserLabel}</td>
                      <td>{d.toUserLabel}</td>
                      <td>{currency(d.expectedCash)}</td>
                      <td>{currency(d.countedCash)}</td>
                      <td>{currency(d.difference)}</td>
                      <td>{date(d.closedAt)}</td>
                      <td>
                        <button className="text-button" onClick={() => setDetails(d)}>
                          <Icon name="details" /> Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            {!drawers.length && <p className="empty">No matching drawer handovers.</p>}
          </div>
        ) : (
          <div className="table-wrap">
            <ResponsiveTable
              columns={[
                { index: 2, label: 'Transaction', details: [0, 1, 6, 7, 8] },
                { index: 4, label: 'Received', details: [3, 5] },
                { index: 9, label: 'Actions' },
              ]}
              labels={{
                0: 'ID',
                1: 'Customer',
                3: w('New jobs'),
                5: 'Wallet used',
                6: 'Method',
                7: 'Status',
                8: 'Date',
              }}
            >
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Transaction ID" column="id" sort={sorting} />
                    <SortHeader label="Customer" column="customer" sort={sorting} />
                    <SortHeader label="Description" column="description" sort={sorting} />
                    <SortHeader label={w('New jobs')} column="sales" sort={sorting} />
                    <SortHeader label="Money received" column="received" sort={sorting} />
                    <SortHeader label="Wallet used" column="wallet" sort={sorting} />
                    <SortHeader label="Method" column="method" sort={sorting} />
                    <SortHeader label="Drawer status" column="status" sort={sorting} />
                    <SortHeader label="Date" column="date" sort={sorting} />
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id.slice(0, 8).toUpperCase()}</td>
                      <td>
                        {r.customerSnapshot.name}
                        <small>{r.customerSnapshot.phone}</small>
                      </td>
                      <td>{saleDescription(r)}</td>
                      <td>{currency(r.total)}</td>
                      <td>{currency(r.cashReceived)}</td>
                      <td>{currency(r.walletUsed)}</td>
                      <td>{paymentName(r)}</td>
                      <td>
                        <span className={`badge ${openIds.has(r.id) ? 'unpaid' : 'paid'}`}>
                          {openIds.has(r.id) ? 'Open' : 'Closed'}
                        </span>
                      </td>
                      <td>{date(r.createdAt)}</td>
                      <td>
                        <button className="text-button" onClick={() => onReceipt(r)}>
                          <Icon name="services" /> Receipt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ResponsiveTable>
            {!records.length && <p className="empty">No matching transactions for your account.</p>}
          </div>
        )}
      </section>
      {closing && (
        <Modal title="Close drawer" wide busy={busy} onClose={() => setClosing(null)}>
          <p>
            Hand over <strong>{name}</strong>’s drawer to another user. All {snapshot.records.length} unclosed
            transactions will be included, regardless of the list filters.
          </p>
          <div className="checkout-summary">
            <p>
              Opening cash <strong>{currency(snapshot.openingCash)}</strong>
            </p>
            <p>
              Cash collected <strong>{currency(snapshot.cash)}</strong>
            </p>
            <p>
              Payment cash corrections <strong>{currency(snapshot.cashCorrection)}</strong>
            </p>
            <p>
              Cash refunded <strong>{currency(snapshot.cashRefunded)}</strong>
            </p>
            <p>
              Total refunds <strong>{currency(snapshot.totalRefunded)}</strong>
            </p>
            <p>
              Expected drawer cash <strong>{currency(snapshot.expectedCash)}</strong>
            </p>
            <p>
              POS / Transfer{' '}
              <strong>
                {currency(snapshot.pos)} / {currency(snapshot.transfer)}
              </strong>
            </p>
            <p>
              Total money collected <strong>{currency(snapshot.collected)}</strong>
            </p>
          </div>
          {pending > 0 && (
            <p className="notice">Pending sales will be synced before the handover is recorded.</p>
          )}
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setError('');
              const form = new FormData(e.currentTarget);
              try {
                await onHandover({
                  id: closing,
                  currentPassword: String(form.get('currentPassword')),
                  nextUsername: String(form.get('nextUsername')).trim(),
                  nextPassword: String(form.get('nextPassword')),
                  countedCash: money(count),
                  checkoutIds: snapshot.checkoutIds,
                  refundIds: snapshot.refundIds,
                  openingId: snapshot.openingId,
                  note: String(form.get('note') ?? '').trim(),
                });
                setClosing(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            <fieldset disabled={busy}>
              <div className="form-grid">
                <label>
                  Current username
                  <input value={username} readOnly autoComplete="off" />
                </label>
                <label>
                  Current user password
                  <input name="currentPassword" type="password" autoComplete="off" required />
                </label>
                <label>
                  Receiving username
                  <input name="nextUsername" autoComplete="off" maxLength={40} required />
                </label>
                <label>
                  Receiving user password
                  <input name="nextPassword" type="password" autoComplete="off" required />
                </label>
                <label>
                  Cash counted / handed over (₦)
                  <CurrencyInput value={count} onValueChange={setCount} required />
                </label>
                <label>
                  Handover note
                  <input name="note" maxLength={500} placeholder="Optional discrepancy or handover note" />
                </label>
              </div>
              {difference !== null && (
                <p className={difference ? 'notice notice-warning' : 'muted'} role="status">
                  Difference: <strong>{currency(difference)}</strong>
                  {difference < 0
                    ? ' — cash shortage'
                    : difference > 0
                      ? ' — cash surplus'
                      : ' — matches expected cash'}
                </p>
              )}
              <label className="check-label">
                <input type="checkbox" required /> Both users confirm the counted cash and handover.
              </label>
              <button disabled={!online}>
                <Icon name="drawer" /> {busy ? 'Saving handover…' : 'Close drawer and switch user'}
              </button>
            </fieldset>
          </form>
        </Modal>
      )}
      {details && (
        <Modal title={`Drawer ${details.id.slice(0, 8).toUpperCase()}`} onClose={() => setDetails(null)}>
          <p>
            Closed by: {details.fromUserLabel}
            <br />
            Received by: {details.toUserLabel}
            <br />
            Closed at: {date(details.closedAt)}
          </p>
          <div className="checkout-summary">
            <p>
              Opening cash <strong>{currency(details.openingCash)}</strong>
            </p>
            <p>
              Cash collected <strong>{currency(details.cashCollected)}</strong>
            </p>
            <p>
              Payment cash corrections <strong>{currency(details.cashCorrection ?? 0)}</strong>
            </p>
            <p>
              Cash refunded <strong>{currency(details.cashRefunded ?? 0)}</strong>
            </p>
            <p>
              Total refunds <strong>{currency(details.totalRefunded ?? 0)}</strong>
            </p>
            <p>
              Expected cash <strong>{currency(details.expectedCash)}</strong>
            </p>
            <p>
              Counted cash <strong>{currency(details.countedCash)}</strong>
            </p>
            <p>
              Difference <strong>{currency(details.difference)}</strong>
            </p>
            <p>
              All collections <strong>{currency(details.totalCollected)}</strong>
            </p>
            <p>
              {w('New job sales')} <strong>{currency(details.jobSales)}</strong>
            </p>
          </div>
          {ledger.saleAdjustments.some((a) => a.historicalClosingId === details.id) && (
            <section className="panel">
              <h3>Corrections after handover</h3>
              {ledger.saleAdjustments
                .filter((a) => a.historicalClosingId === details.id)
                .map((a) => (
                  <p key={a.id}>
                    {a.reason} · Cash correction {currency(a.cashDelta ?? 0)} · {a.changedByLabel}
                  </p>
                ))}
              <p>
                Revised historical expected cash:{' '}
                {currency(
                  details.expectedCash +
                    ledger.saleAdjustments
                      .filter((a) => a.historicalClosingId === details.id)
                      .reduce((n, a) => n + (a.cashDelta ?? 0), 0),
                )}
                <br />
                Revised variance:{' '}
                {currency(
                  details.difference -
                    ledger.saleAdjustments
                      .filter((a) => a.historicalClosingId === details.id)
                      .reduce((n, a) => n + (a.cashDelta ?? 0), 0),
                )}
              </p>
              <small>The original handover and counted cash remain unchanged.</small>
            </section>
          )}
          <p>
            {details.checkoutIds.length} transactions · {details.note || 'No handover note'}
          </p>
        </Modal>
      )}
    </>
  );
}
