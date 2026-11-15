import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import CurrencyInput from './CurrencyInput';
import { currency } from './receipts.mjs';
import { money } from './domain.mjs';
import { myTransactions, saleDescription, salesSummary } from './my-sales.mjs';
import type { DrawerClosing, Ledger } from './types';

const when = (value?: string) =>
  value ? new Date(value).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : '';

/**
 * Conflict Inbox → drawers closed automatically overnight. The review shows the drawer's whole
 * sales summary and every sale in it; after checking them (and ticking that they did), an Admin
 * enters the cash actually found (or leaves it empty) and marks the drawer reviewed.
 */
export default function DrawerReviews({
  closings,
  ledger,
  online,
  onReview,
}: {
  closings: DrawerClosing[];
  ledger: Ledger;
  online: boolean;
  onReview: (id: string, counted: number | null, note: string) => Promise<void>;
}) {
  const pending = closings
    .filter((d) => d.autoClosed && d.reviewStatus !== 'reviewed')
    .sort((a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt));
  const [open, setOpen] = useState<DrawerClosing | null>(null);
  const [count, setCount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checked, setChecked] = useState(false);
  if (!pending.length) return null;
  const customerName = (id: string) => ledger.customers.find((c) => c.id === id)?.name ?? 'Walk-in';
  const sales = open
    ? myTransactions(ledger, open.fromUserId, true)
        .filter((r) => open.checkoutIds.includes(r.id))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    : [];
  const summary = salesSummary(sales);
  const missing = open ? open.checkoutIds.length - sales.length : 0;
  const save = async (counted: number | null) => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      await onReview(open.id, counted, note.trim());
      setOpen(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" aria-labelledby="drawer-reviews">
      <h2 id="drawer-reviews">Drawers closed automatically ({pending.length})</h2>
      <p className="muted">
        These drawers were still open the next day, so they were closed without a cash count. Enter the cash
        actually found, or mark them reviewed.
      </p>
      <div className="table-wrap">
        <table aria-label="Drawers closed automatically">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Sales</th>
              <th>Expected cash</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((d) => (
              <tr key={d.id}>
                <td>
                  <strong>{d.fromUserLabel}</strong>
                  <small>Closed {when(d.closedAt)}</small>
                </td>
                <td>
                  {d.checkoutIds.length} sales
                  <small>
                    POS {currency(d.posCollected)} · Transfer {currency(d.transferCollected)}
                  </small>
                </td>
                <td>
                  {currency(d.expectedCash)}
                  {d.openingCash > 0 && <small>Including {currency(d.openingCash)} opening cash</small>}
                </td>
                <td className="cell-fit">
                  <button
                    type="button"
                    className="text-button"
                    disabled={!online}
                    onClick={() => {
                      setOpen(d);
                      setCount('');
                      setNote('');
                      setError('');
                      setChecked(false);
                    }}
                  >
                    <Icon name="details" /> Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!online && <p className="muted">Connect to review drawers.</p>}
      {open && (
        <Modal
          title={`Review drawer · ${open.fromUserLabel}`}
          wide
          busy={busy}
          onClose={() => setOpen(null)}
        >
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          <p className="muted">
            Closed automatically {when(open.closedAt)}: {open.checkoutIds.length} sales. Check the summary and
            each sale below, then record what you found.
          </p>
          <div className="stats drawer-review-stats">
            <article>
              <span>Expected cash in the drawer</span>
              <strong>{currency(open.expectedCash)}</strong>
              <small>
                {open.openingCash > 0 ? `Opening cash ${currency(open.openingCash)} · ` : ''}
                Cash received {currency(summary.cash)}
                {open.cashRefunded ? ` · Cash refunds ${currency(open.cashRefunded)}` : ''}
              </small>
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
              <span>Sales value</span>
              <strong>{currency(summary.sales)}</strong>
              <small>
                {sales.length} sales · {summary.customers.length} customers
              </small>
            </article>
          </div>
          {missing > 0 && (
            <p className="notice notice-warning" role="status">
              {missing} of these sales are not on this device (it keeps recent history only). Review from a
              device that keeps everything to see them all.
            </p>
          )}
          <div className="table-wrap drawer-review-sales">
            <table aria-label="Sales in this drawer">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Customer</th>
                  <th>What</th>
                  <th>Sale</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {new Date(r.createdAt).toLocaleString('en-NG', {
                        timeZone: 'Africa/Lagos',
                        day: 'numeric',
                        month: 'short',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>{customerName(r.customerId)}</td>
                    <td>{saleDescription(r)}</td>
                    <td>{currency(r.total)}</td>
                    <td>
                      {currency(r.cashReceived)}
                      <small>
                        {r.methodLabel || r.method}
                        {r.walletUsed > 0 ? ` · wallet ${currency(r.walletUsed)}` : ''}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset disabled={busy}>
            <label>
              Cash found (₦)
              <CurrencyInput
                aria-label="Cash found"
                value={count}
                onValueChange={setCount}
                placeholder="Leave empty if not counted"
              />
            </label>
            {count && <p className="muted">Difference: {currency(money(count) - open.expectedCash)}</p>}
            <label>
              Note (optional)
              <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="check-label">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I have
              checked the sales and the summary above
            </label>
            <div className="material-actions">
              <button
                type="button"
                className="secondary"
                disabled={!checked}
                onClick={() => void save(null)}
              >
                Mark reviewed without a count
              </button>
              <button type="button" disabled={!checked || !count} onClick={() => void save(money(count))}>
                <Icon name="save" /> Save count and mark reviewed
              </button>
            </div>
          </fieldset>
        </Modal>
      )}
    </section>
  );
}
