import { useMemo, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import CurrencyInput from './CurrencyInput';
import ListedCombobox from './ListedCombobox';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { money } from './domain.mjs';
import { prepareCheckout } from './checkout.mjs';
import {
  WALK_IN_NAME,
  addToCart,
  cartTotal,
  quickSaleInput,
  setQuantity,
  shelfProducts,
  walkInCustomer,
} from './quick-sale.mjs';
import type { CheckoutEvent, CheckoutRecord, Ledger } from './types';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const label = (c: { name: string; phone: string }) => (c.phone ? `${c.name} — ${c.phone}` : c.name);

/** Sell shelf items quickly: tap products, set quantities, take the money. */
export default function QuickSale({
  ledger,
  actor,
  busy,
  onSave,
  onClose,
  onReceipt,
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (event: CheckoutEvent) => Promise<CheckoutRecord>;
  onClose: () => void;
  onReceipt: (record: CheckoutRecord) => void;
}) {
  const { w } = useWords();
  const options = useBusinessOptions();
  const methods = options.paymentMethods.filter((m) => m.enabled);
  const products = useMemo(() => shelfProducts(ledger), [ledger]);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<{ serviceId: string; quantity: number }[]>([]);
  const [customerText, setCustomerText] = useState(WALK_IN_NAME);
  const [methodLabel, setMethodLabel] = useState(methods[0]?.label ?? 'Cash');
  const [received, setReceived] = useState<string | null>(null);
  const [error, setError] = useFeedbackMessage('error');
  const customers = ledger.customers.filter((c) => !c.archived && c.id !== walkInCustomer(ledger)?.id);
  const customer = customers.find((c) => label(c) === customerText) ?? null;
  const total = (() => {
    try {
      return cartTotal(ledger, cart);
    } catch {
      return 0;
    }
  })();
  // Money received follows the total until someone types an amount.
  const tendered = (() => {
    try {
      return received === null ? total : money(received || '0');
    } catch {
      return null;
    }
  })();
  const change = !customer && tendered !== null && tendered > total ? tendered - total : 0;
  const visible = products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  async function complete() {
    if (busy) return;
    setError('');
    try {
      if (tendered === null) throw Error('Enter the money received.');
      const method = methods.find((m) => m.label === methodLabel);
      if (!method) throw Error('Choose a payment method.');
      if (customerText.trim() && customerText !== WALK_IN_NAME && !customer)
        throw Error('Choose a customer from the list, or use Walk-in customer.');
      const { input } = quickSaleInput(ledger, cart, {
        customerId: customer?.id ?? null,
        tendered,
        method: method.kind,
        methodLabel: method.label,
        paidOn: today(),
        source: options.jobSources[0],
        actor,
        now: new Date().toISOString(),
      });
      const event = prepareCheckout(ledger, input, actor) as CheckoutEvent;
      const record = await onSave(event);
      onClose();
      onReceipt(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <Modal title="Quick sale" wide busy={busy} onClose={onClose} className="checkout-modal">
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {!products.length ? (
        <p className="empty">
          {w(
            'No shelf items yet. Tick “Sold off the shelf” on a service, or use Add product on the Services page.',
          )}
        </p>
      ) : (
        <>
          <input
            aria-label="Search products"
            placeholder="Search products"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="quick-products" role="group" aria-label="Products">
            {visible.map((p) => {
              const inCart = cart.find((l) => l.serviceId === p.id)?.quantity ?? 0;
              const out = p.stock !== null && p.stock - inCart <= 0;
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`quick-product${out ? ' out' : ''}`}
                  disabled={busy}
                  onClick={() => setCart((c) => addToCart(c, p.id))}
                >
                  <strong>{p.name}</strong>
                  <span>{currency(p.price)}</span>
                  <small>
                    {p.stock === null
                      ? 'Not stock-tracked'
                      : out
                        ? 'Out of stock'
                        : `${p.stock - inCart} ${p.unit} left`}
                  </small>
                </button>
              );
            })}
          </div>
        </>
      )}
      {cart.length > 0 && (
        <div className="table-wrap">
          <table aria-label="Cart">
            <thead>
              <tr>
                <th>Product</th>
                <th className="numeric">Qty</th>
                <th className="numeric">Amount</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {cart.map((line) => {
                const p = products.find((x) => x.id === line.serviceId);
                const short = p?.stock != null && line.quantity > p.stock;
                return (
                  <tr key={line.serviceId}>
                    <td>
                      {p?.name}
                      <small>
                        {currency(p?.price ?? 0)} each
                        {short && (
                          <span className="stock-near-text"> · More than the {p!.stock} in stock</span>
                        )}
                      </small>
                    </td>
                    <td className="numeric">
                      <div className="quick-qty">
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`One less ${p?.name}`}
                          onClick={() => setCart((c) => setQuantity(c, line.serviceId, line.quantity - 1))}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          aria-label={`Quantity of ${p?.name}`}
                          value={line.quantity}
                          onChange={(e) =>
                            setCart((c) => setQuantity(c, line.serviceId, Number(e.target.value || 0)))
                          }
                        />
                        <button
                          type="button"
                          className="secondary"
                          aria-label={`One more ${p?.name}`}
                          onClick={() => setCart((c) => addToCart(c, line.serviceId))}
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="numeric">{currency(Math.round((p?.price ?? 0) * line.quantity))}</td>
                    <td>
                      <button
                        type="button"
                        className="text-button danger-text"
                        onClick={() => setCart((c) => setQuantity(c, line.serviceId, 0))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="form-grid">
        <ListedCombobox
          label="Customer"
          name="customer"
          options={[WALK_IN_NAME, ...customers.map(label)]}
          value={customerText}
          onChange={setCustomerText}
        />
        <label>
          Payment method
          <select value={methodLabel} onChange={(e) => setMethodLabel(e.target.value)}>
            {methods.map((m) => (
              <option key={m.label}>{m.label}</option>
            ))}
          </select>
        </label>
        <label>
          Money received (₦)
          <CurrencyInput
            aria-label="Money received (₦)"
            value={received ?? (total / 100).toFixed(2)}
            onValueChange={setReceived}
          />
        </label>
      </div>
      <div className="cart-total" role="status">
        <span>
          Total <strong>{currency(total)}</strong>
        </span>
        {change > 0 && (
          <small>
            Change to give: <strong>{currency(change)}</strong>
          </small>
        )}
        {customer && tendered !== null && tendered < total && (
          <small>{currency(total - tendered)} will be owed on the customer's account.</small>
        )}
      </div>
      <button type="button" disabled={busy || !cart.length} onClick={() => void complete()}>
        <Icon name="complete" /> {busy ? 'Saving…' : `Complete sale · ${currency(total)}`}
      </button>
    </Modal>
  );
}
