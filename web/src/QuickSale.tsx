import { alphabetical } from './alphabetical.mjs';
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
import { packList, packSummary, packTotal } from './pack-prices.mjs';
import { DiscountFields, discountSpec, noDiscount, type DiscountDraft } from './CheckoutEditor';
import {
  WALK_IN_NAME,
  addToCart,
  pricedCart,
  productTiles,
  quickSaleInput,
  setQuantity,
  typeQuantity,
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
  discountPolicy = { maxPercent: 0, canFlat: false },
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (event: CheckoutEvent) => Promise<CheckoutRecord>;
  onClose: () => void;
  onReceipt: (record: CheckoutRecord) => void;
  /** What this user may discount: the cap per item (%) and whether whole-sale/flat is allowed. */
  discountPolicy?: { maxPercent: number; canFlat: boolean };
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
  // What is typed in each quantity box, so clearing a box to retype does not drop the item.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState<DiscountDraft>(noDiscount());
  const [error, setError] = useFeedbackMessage('error');
  const customers = ledger.customers.filter((c) => !c.archived && c.id !== walkInCustomer(ledger)?.id);
  const customer = customers.find((c) => label(c) === customerText) ?? null;
  let priced: ReturnType<typeof pricedCart> | null = null,
    priceError = '';
  try {
    priced = pricedCart(ledger, cart, {
      discount: discountSpec(discount),
      policy: discountPolicy,
      source: options.jobSources[0],
    });
  } catch (cause) {
    priceError = cause instanceof Error ? cause.message : String(cause);
  }
  const total = priced?.total ?? 0;
  // Money received follows the total until someone types an amount.
  const tendered = (() => {
    try {
      return received === null ? total : money(received || '0');
    } catch {
      return null;
    }
  })();
  const change = !customer && tendered !== null && tendered > total ? tendered - total : 0;
  const tiles = productTiles(products, query);
  const left = (p: (typeof products)[number]) =>
    p.stock === null ? null : p.stock - (cart.find((l) => l.serviceId === p.id)?.quantity ?? 0);
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
        discount: discountSpec(discount),
        policy: discountPolicy,
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
    <Modal title="Quick sale" wide busy={busy} onClose={onClose} className="checkout-modal quick-sale-modal">
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <div className="quick-sale-layout">
        <section className="quick-sale-products" aria-label="Choose products">
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
                {tiles.map((tile) => {
                  if (tile.kind === 'group') {
                    const first = tile.variants[0];
                    const total = tile.variants.reduce((n, v) => n + (left(v) ?? 0), 0);
                    return (
                      <div
                        className="quick-product quick-variants"
                        key={tile.id}
                        role="group"
                        aria-label={tile.name}
                      >
                        <strong>{tile.name}</strong>
                        <span>{currency(first.price)}</span>
                        {first.packPrices.length > 0 && <small>{packList(first.packPrices)}</small>}
                        <small>
                          {total} {first.unit} left in all
                        </small>
                        <div className="variant-chips">
                          {tile.variants.map((v) => {
                            const n = left(v);
                            return (
                              <button
                                type="button"
                                key={v.id}
                                className={`secondary${n !== null && n <= 0 ? ' out' : ''}`}
                                aria-label={`Add ${v.name}${n === null ? '' : `, ${n} left`}`}
                                disabled={busy}
                                onClick={() => setCart((c) => addToCart(c, v.id))}
                              >
                                {v.variantName}
                                {n !== null && <small>{n <= 0 ? 'Out' : n}</small>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  const p = tile.product;
                  const remaining = left(p);
                  const out = remaining !== null && remaining <= 0;
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className={`quick-product secondary${out ? ' out' : ''}`}
                      disabled={busy}
                      onClick={() => setCart((c) => addToCart(c, p.id))}
                    >
                      <strong>{p.name}</strong>
                      <span>{currency(p.price)}</span>
                      {p.packPrices.length > 0 && <small>{packList(p.packPrices)}</small>}
                      <small>
                        {p.stock === null
                          ? 'Not stock-tracked'
                          : out
                            ? 'Out of stock'
                            : `${remaining} ${p.unit} left`}
                      </small>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
        <section className="quick-sale-cart" aria-label="Sale">
          {!cart.length && <p className="muted quick-cart-empty">Tap a product to add it to the sale.</p>}
          {cart.length > 0 && (
            <div className="table-wrap">
              <table aria-label="Cart" className="quick-cart">
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
                              onClick={() => {
                                setTyped(({ [line.serviceId]: _done, ...rest }) => rest);
                                setCart((c) => setQuantity(c, line.serviceId, line.quantity - 1));
                              }}
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputMode="decimal"
                              aria-label={`Quantity of ${p?.name}`}
                              value={typed[line.serviceId] ?? String(line.quantity)}
                              onChange={(e) => {
                                const text = e.target.value;
                                setTyped((t) => ({ ...t, [line.serviceId]: text }));
                                setCart((c) => typeQuantity(c, line.serviceId, Number(text)));
                              }}
                              onBlur={() => setTyped(({ [line.serviceId]: _done, ...rest }) => rest)}
                            />
                            <button
                              type="button"
                              className="secondary"
                              aria-label={`One more ${p?.name}`}
                              onClick={() => {
                                setTyped(({ [line.serviceId]: _done, ...rest }) => rest);
                                setCart((c) => addToCart(c, line.serviceId));
                              }}
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className="numeric">
                          {currency(packTotal(p?.price ?? 0, p?.packPrices, line.quantity))}
                          {p && packSummary(p.price, p.packPrices, line.quantity) && (
                            <small>{packSummary(p.price, p.packPrices, line.quantity)}</small>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => setCart((c) => setQuantity(c, line.serviceId, 0))}
                          >
                            <Icon name="close" /> Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {cart.length > 0 && (discountPolicy.maxPercent > 0 || discountPolicy.canFlat) && (
            <DiscountFields
              label="Discount"
              value={discount}
              allowFlat={discountPolicy.canFlat}
              maxPercent={discountPolicy.canFlat ? 100 : discountPolicy.maxPercent}
              onChange={setDiscount}
            />
          )}
          <div className="form-grid">
            <ListedCombobox
              label="Customer"
              emptyText="No matching customer. Add them on Customers, or use Walk-in customer."
              name="customer"
              options={[WALK_IN_NAME, ...customers.map(label)]}
              value={customerText}
              onChange={setCustomerText}
            />
            <label>
              Payment method
              <select value={methodLabel} onChange={(e) => setMethodLabel(e.target.value)}>
                {alphabetical(methods, (m) => m.label).map((m) => (
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
          {/* Total, change and Complete sale stay in view together while the cart scrolls. */}
          <div className="quick-sale-checkout">
            <div className="cart-total" role="status">
              {priced && priced.discountTotal > 0 && (
                <small>
                  Before discount {currency(priced.gross)} · Discount −{currency(priced.discountTotal)}
                </small>
              )}
              <span>
                Total <strong>{currency(total)}</strong>
              </span>
              {priceError && cart.length > 0 && (
                <small className="danger-text" role="alert">
                  {cart.some((l) => !(l.quantity > 0))
                    ? 'Enter a quantity for each item, or remove it.'
                    : priceError}
                </small>
              )}
              {change > 0 && (
                <small>
                  Change to give: <strong>{currency(change)}</strong>
                </small>
              )}
              {customer && tendered !== null && tendered < total && (
                <small>{currency(total - tendered)} will be owed on the customer's account.</small>
              )}
            </div>
            <button type="button" disabled={busy || !cart.length || !priced} onClick={() => void complete()}>
              <Icon name="complete" /> {busy ? 'Saving…' : `Complete sale · ${currency(total)}`}
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
