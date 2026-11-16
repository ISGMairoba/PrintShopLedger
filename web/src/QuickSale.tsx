import { stockBelowZeroBlocked } from './stock-rule.mjs';
import { defaultMethod, defaultSource } from './business-options.mjs';
import { alphabetical } from './alphabetical.mjs';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import Icon from './Icon';
import ItemIcon from './ItemIcon';
import HeldSales from './HeldSales';
import CustomerEditor from './CustomerEditor';
import CurrencyInput from './CurrencyInput';
import ListedCombobox from './ListedCombobox';
import { useFeedbackMessage } from './Feedback';
import { useBusinessOptions } from './BusinessOptionsContext';
import { useWords } from './Words';
import { currency } from './receipts.mjs';
import { customerBalance, money } from './domain.mjs';
import { prepareCheckout, walletBalance } from './checkout.mjs';
import { applyCustomerEvent } from './customers.mjs';
import { packList, packSummary } from './pack-prices.mjs';
import { countPrice, tierList, tierPrice } from './price-tiers.mjs';
import { defaultDueAt, fromLocalInput, toLocalInput } from './job-deadlines.mjs';
import { jobSettingsDefaults } from './business-branding.mjs';
import {
  DiscountFields,
  discountSpec,
  noDiscount,
  type DiscountDraft,
  type HeldSale,
} from './CheckoutEditor';
import {
  WALK_IN_NAME,
  addToCart,
  collectedByDefault,
  laterWorkflow,
  pricedCart,
  productCategories,
  productTiles,
  quickSaleInput,
  setQuantity,
  shelfProducts,
  tilePrice,
  typeQuantity,
  walkInCustomer,
} from './quick-sale.mjs';
import type { CheckoutEvent, CheckoutRecord, CustomerEvent, Ledger } from './types';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
const label = (c: { name: string; phone: string }) => (c.phone ? `${c.name} — ${c.phone}` : c.name);
type Cart = { serviceId: string; quantity: number }[];
type Product = ReturnType<typeof shelfProducts>[number];

/**
 * Quick sale, the selling screen: search, category chips and a grid of items; the basket beside it
 * (a bar at the bottom on phones) with Clear and Hold; Pay opens the payment pop-up.
 * A retail shop uses it as Point of Service (`embedded`); elsewhere it opens full-page over the app.
 */
export default function QuickSale({
  ledger,
  actor,
  busy,
  onSave,
  onClose,
  onReceipt,
  discountPolicy = { maxPercent: 0, canFlat: false },
  held,
  onHold,
  heldList = [],
  onResumeHeld,
  onDiscardHeld,
  embedded = false,
  onOrders,
  jobSettings = jobSettingsDefaults(),
  canChooseWorkflow = false,
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  onSave: (event: CheckoutEvent) => Promise<CheckoutRecord>;
  /** Back to the app (full-page) or, embedded, after a sale is completed. */
  onClose: () => void;
  onReceipt: (record: CheckoutRecord) => void;
  /** What this user may discount: the cap per item (%) and whether whole-sale/flat is allowed. */
  discountPolicy?: { maxPercent: number; canFlat: boolean };
  /** Resume a held basket. */
  held?: HeldSale;
  /** Put this basket aside on this device to serve someone else. */
  onHold?: (sale: HeldSale) => void;
  /** Baskets held on this device (the Held (N) button). */
  heldList?: HeldSale[];
  onResumeHeld?: (sale: HeldSale) => void;
  onDiscardHeld?: (sale: HeldSale) => void;
  /** Shown as the page itself (retail shops' Point of Service), not over the app. */
  embedded?: boolean;
  /** Retail Point of Service: open the orders list. */
  onOrders?: () => void;
  jobSettings?: { defaultDuration: number };
  /** Admins and above may give a sale collected later another saved workflow. */
  canChooseWorkflow?: boolean;
}) {
  const resumed =
    held?.kind === 'quick'
      ? (held.data as {
          cart: Cart;
          customerText: string;
          discount: DiscountDraft;
          newCustomer?: CustomerEvent | null;
        })
      : null;
  const { w, stage } = useWords();
  const options = useBusinessOptions();
  const methods = options.paymentMethods.filter((m) => m.enabled);
  const products = useMemo(() => shelfProducts(ledger), [ledger]);
  const categories = useMemo(() => productCategories(products), [products]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<Cart>(() =>
    (resumed?.cart ?? []).filter((l) => products.some((p) => p.id === l.serviceId)),
  );
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState<DiscountDraft>(resumed?.discount ?? noDiscount());
  const [customerText, setCustomerText] = useState(resumed?.customerText ?? WALK_IN_NAME);
  const [newCustomer, setNewCustomer] = useState<CustomerEvent | null>(resumed?.newCustomer ?? null);
  const [paying, setPaying] = useState(false);
  const [picking, setPicking] = useState<{ name: string; variants: Product[] } | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [basketOpen, setBasketOpen] = useState(false);
  const [error, setError] = useFeedbackMessage('error');
  const blocked = stockBelowZeroBlocked();
  const anyShort = cart.some((line) => {
    const p = products.find((x) => x.id === line.serviceId);
    return p?.stock != null && line.quantity > p.stock;
  });
  let priced: ReturnType<typeof pricedCart> | null = null,
    priceError = '';
  try {
    priced = pricedCart(ledger, cart, {
      discount: discountSpec(discount),
      policy: discountPolicy,
      source: defaultSource(options),
    });
  } catch (cause) {
    priceError = cause instanceof Error ? cause.message : String(cause);
  }
  const total = priced?.total ?? 0;
  const pieces = cart.reduce((n, l) => n + l.quantity, 0);
  const tiles = productTiles(products, query, category);
  const left = (p: Product) =>
    p.stock === null ? null : p.stock - (cart.find((l) => l.serviceId === p.id)?.quantity ?? 0);
  const add = (id: string) => {
    setTyped(({ [id]: _done, ...rest }) => rest);
    setCart((c) => addToCart(c, id));
  };
  // Full-page: the app behind does not scroll, and Escape goes back when nothing else is open.
  useEffect(() => {
    if (embedded) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = before;
      window.removeEventListener('keydown', onKey);
    };
  }, [embedded, onClose]);
  const reset = () => {
    setCart([]);
    setTyped({});
    setDiscount(noDiscount());
    setCustomerText(WALK_IN_NAME);
    setNewCustomer(null);
    setBasketOpen(false);
  };
  const hold = () => {
    onHold?.({
      id: held?.id ?? String(crypto.randomUUID()),
      kind: 'quick',
      heldAt: new Date().toISOString(),
      heldBy: actor.label,
      customerName: customerText === WALK_IN_NAME ? '' : customerText.split(' — ')[0],
      items: cart.map((l) => {
        const p = products.find((x) => x.id === l.serviceId);
        return `${l.quantity} × ${p?.name ?? 'Item'}`;
      }),
      total: priced ? total : null,
      data: { cart, customerText, discount, newCustomer },
    });
    // Embedded (retail Point of Service) the screen stays: start a fresh basket.
    if (embedded) reset();
  };
  const quickHeld = heldList.filter((h) => h.kind === 'quick');
  const screen = (
    <div
      className={`pos-screen${embedded ? ' pos-embedded' : ' pos-overlay'}`}
      role={embedded ? undefined : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label="Quick sale"
    >
      <header className="pos-toolbar">
        {!embedded && (
          <button type="button" className="secondary pos-back" onClick={onClose}>
            <Icon name="back" /> Back
          </button>
        )}
        <h2>Quick sale</h2>
        <label className="pos-search">
          <Icon name="search" />
          <input
            type="search"
            aria-label="Search items"
            placeholder="Search items or categories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="pos-toolbar-actions">
          {onOrders && (
            <button type="button" className="secondary" onClick={onOrders}>
              <Icon name="orders" /> {w('Orders')}
            </button>
          )}
          {onResumeHeld && (
            <button
              type="button"
              className="secondary"
              disabled={!quickHeld.length}
              aria-label={`Held baskets (${quickHeld.length})`}
              onClick={() => setShowHeld(true)}
            >
              <Icon name="pause" /> Held ({quickHeld.length})
            </button>
          )}
        </div>
      </header>
      {error && !paying && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <div className="pos-body">
        <section className="pos-items" aria-label="Choose items">
          {categories.length > 0 && (
            <div className="pos-chips" role="group" aria-label="Categories">
              <button
                type="button"
                className={`chip${category === '' ? ' active' : ''}`}
                aria-pressed={category === ''}
                onClick={() => setCategory('')}
              >
                All <small>{products.length}</small>
              </button>
              {categories.map((c) => (
                <button
                  type="button"
                  key={c.name}
                  className={`chip${category === c.name ? ' active' : ''}`}
                  aria-pressed={category === c.name}
                  onClick={() => setCategory(category === c.name ? '' : c.name)}
                >
                  {c.name} <small>{c.count}</small>
                </button>
              ))}
            </div>
          )}
          {!products.length ? (
            <p className="empty">
              {w(
                'No shelf items yet. Tick “Sold off the shelf” on a service, or use Add product on the Services page.',
              )}
            </p>
          ) : !tiles.length ? (
            <p className="empty">No items match. Try another word or category.</p>
          ) : (
            <div className="pos-grid" role="group" aria-label="Items">
              {tiles.map((tile) => {
                const variants = tile.kind === 'group' ? tile.variants : [tile.product];
                const first = variants[0];
                const name = tile.kind === 'group' ? tile.name : first.name;
                const { price, from } = tilePrice(variants);
                const stocked = variants.filter((v) => v.stock !== null);
                const remaining = stocked.length ? stocked.reduce((n, v) => n + (left(v) ?? 0), 0) : null;
                const out = remaining !== null && remaining <= 0;
                const inCart = cart
                  .filter((l) => variants.some((v) => v.id === l.serviceId))
                  .reduce((n, l) => n + l.quantity, 0);
                return (
                  <button
                    type="button"
                    key={tile.kind === 'group' ? tile.id : first.id}
                    className={`pos-tile${out ? ' out' : ''}${inCart ? ' in-basket' : ''}`}
                    disabled={busy}
                    aria-label={`${name}, ${from ? 'from ' : ''}${currency(price)}${
                      remaining === null ? '' : out ? ', out of stock' : `, ${remaining} left`
                    }${tile.kind === 'group' ? `, ${variants.length} options` : ''}${
                      inCart ? `, ${inCart} in the basket` : ''
                    }`}
                    onClick={() =>
                      tile.kind === 'group' ? setPicking({ name, variants: tile.variants }) : add(first.id)
                    }
                  >
                    {inCart > 0 && (
                      <span className="pos-tile-count" aria-hidden="true">
                        {inCart}
                      </span>
                    )}
                    <span className="pos-tile-icon" aria-hidden="true">
                      <ItemIcon name={first.icon} />
                    </span>
                    {first.category && <small className="pos-tile-category">{first.category}</small>}
                    <strong className="pos-tile-name">{name}</strong>
                    <span className="pos-tile-price">
                      {from && <small>from </small>}
                      {currency(price)}
                    </span>
                    <small className={`pos-tile-stock${out ? ' danger-text' : ''}`}>
                      {remaining === null
                        ? tile.kind === 'group'
                          ? `${variants.length} options`
                          : 'Not stock-tracked'
                        : out
                          ? 'Out of stock'
                          : `${remaining} ${first.unit === 'item' ? 'left' : `${first.unit} left`}`}
                      {tile.kind === 'group' && remaining !== null ? ` · ${variants.length} options` : ''}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <aside className={`pos-basket${basketOpen ? ' open' : ''}`} aria-label="Basket">
          <div className="pos-basket-head">
            <h3>
              <Icon name="basket" /> Basket
              {cart.length > 0 && <small>{pieces} pieces</small>}
            </h3>
            <button
              type="button"
              className="secondary pos-basket-close"
              aria-label="Back to the items"
              onClick={() => setBasketOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          {!cart.length ? (
            <p className="muted pos-basket-empty">Tap an item to add it to the basket.</p>
          ) : (
            <ul className="pos-lines">
              {cart.map((line) => {
                const p = products.find((x) => x.id === line.serviceId);
                const short = p?.stock != null && line.quantity > p.stock;
                const pack = p ? packSummary(p.price, p.packPrices, line.quantity) : '';
                return (
                  <li key={line.serviceId}>
                    <span className="pos-line-icon" aria-hidden="true">
                      <ItemIcon name={p?.icon} />
                    </span>
                    <span className="pos-line-name">
                      <strong>{p?.name}</strong>
                      <small>
                        {currency(tierPrice(p?.price ?? 0, p?.priceTiers, line.quantity))} each
                        {pack ? ` · ${pack}` : ''}
                      </small>
                      {short && (
                        <small className={blocked ? 'danger-text' : 'stock-near-text'}>
                          More than the {p!.stock} in stock
                          {blocked ? '. Ask an admin to update the stock first.' : ''}
                        </small>
                      )}
                    </span>
                    <span className="pos-line-amount">{p ? currency(countPrice(p, line.quantity)) : ''}</span>
                    <span className="quick-qty">
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
                        onClick={() => add(line.serviceId)}
                      >
                        +
                      </button>
                    </span>
                    <button
                      type="button"
                      className="text-button danger-text pos-line-remove"
                      aria-label={`Remove ${p?.name}`}
                      onClick={() => setCart((c) => setQuantity(c, line.serviceId, 0))}
                    >
                      <Icon name="close" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="pos-basket-foot">
            {priceError && cart.length > 0 && (
              <small className="danger-text" role="alert">
                {cart.some((l) => !(l.quantity > 0))
                  ? 'Enter a quantity for each item, or remove it.'
                  : priceError}
              </small>
            )}
            <div className="pos-total" role="status">
              <span>Total</span>
              <strong>{currency(total)}</strong>
            </div>
            <div className="pos-basket-actions">
              <button
                type="button"
                className="secondary danger-text"
                disabled={busy || !cart.length}
                onClick={() => {
                  if (!confirmClear) return setConfirmClear(true);
                  setConfirmClear(false);
                  reset();
                }}
                onBlur={() => setConfirmClear(false)}
              >
                <Icon name="waste" /> {confirmClear ? 'Yes, clear it' : 'Clear basket'}
              </button>
              {onHold && (
                <button type="button" className="secondary" disabled={busy || !cart.length} onClick={hold}>
                  <Icon name="pause" /> Hold basket
                </button>
              )}
            </div>
            <button
              type="button"
              className="pos-pay"
              disabled={busy || !cart.length || !priced || (blocked && anyShort)}
              onClick={() => {
                setError('');
                setPaying(true);
              }}
            >
              <Icon name="payments" /> Pay {currency(total)}
            </button>
          </div>
        </aside>
      </div>
      {/* Phones: the basket is a bar at the bottom that opens over the items. */}
      <div className="pos-phone-bar">
        <button type="button" className="secondary" onClick={() => setBasketOpen(true)}>
          <Icon name="basket" /> Basket ({cart.length}) · {currency(total)}
        </button>
        <button
          type="button"
          disabled={busy || !cart.length || !priced || (blocked && anyShort)}
          onClick={() => {
            setError('');
            setPaying(true);
          }}
        >
          Pay
        </button>
      </div>
      {picking && (
        <Modal title={picking.name} onClose={() => setPicking(null)} className="pos-variant-modal">
          <p className="muted">Choose one to add it to the basket.</p>
          <div className="pos-variant-list">
            {picking.variants.map((v) => {
              const n = left(v);
              const inCart = cart.find((l) => l.serviceId === v.id)?.quantity ?? 0;
              return (
                <button
                  type="button"
                  key={v.id}
                  className={`pos-variant${n !== null && n <= 0 ? ' out' : ''}`}
                  onClick={() => add(v.id)}
                >
                  <strong>{v.variantName}</strong>
                  <span>{currency(v.price)}</span>
                  {v.packPrices.length > 0 && <small>{packList(v.packPrices)}</small>}
                  {v.priceTiers.length > 0 && <small>{tierList(v.price, v.priceTiers)}</small>}
                  <small>
                    {n === null ? 'Not stock-tracked' : n <= 0 ? 'Out of stock' : `${n} left`}
                    {inCart ? ` · ${inCart} in the basket` : ''}
                  </small>
                </button>
              );
            })}
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => setPicking(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}
      {showHeld && onResumeHeld && onDiscardHeld && (
        <Modal title={`Held baskets (${quickHeld.length})`} onClose={() => setShowHeld(false)}>
          {quickHeld.length ? (
            <HeldSales
              held={quickHeld}
              busy={busy}
              onResume={(sale) => {
                setShowHeld(false);
                onResumeHeld(sale);
              }}
              onDiscard={onDiscardHeld}
            />
          ) : (
            <p className="muted">No baskets held on this device.</p>
          )}
        </Modal>
      )}
      {paying && priced && (
        <PayDialog
          ledger={ledger}
          actor={actor}
          busy={busy}
          cart={cart}
          priced={priced}
          discount={discount}
          onDiscount={setDiscount}
          discountPolicy={discountPolicy}
          customerText={customerText}
          onCustomerText={setCustomerText}
          newCustomer={newCustomer}
          onNewCustomer={setNewCustomer}
          methods={methods}
          jobSettings={jobSettings}
          canChooseWorkflow={canChooseWorkflow}
          stageName={stage}
          w={w}
          onClose={() => setPaying(false)}
          onComplete={async (event) => {
            const record = await onSave(event);
            setPaying(false);
            reset();
            if (!embedded || held) onClose();
            onReceipt(record);
          }}
        />
      )}
    </div>
  );
  return embedded ? screen : createPortal(screen, document.body);
}

/** The payment pop-up: who, how, collected now or later, and the money. */
function PayDialog({
  ledger,
  actor,
  busy,
  cart,
  priced,
  discount,
  onDiscount,
  discountPolicy,
  customerText,
  onCustomerText,
  newCustomer,
  onNewCustomer,
  methods,
  jobSettings,
  canChooseWorkflow,
  stageName,
  w,
  onClose,
  onComplete,
}: {
  ledger: Ledger;
  actor: { id: string; label: string };
  busy: boolean;
  cart: Cart;
  priced: ReturnType<typeof pricedCart>;
  discount: DiscountDraft;
  onDiscount: (d: DiscountDraft) => void;
  discountPolicy: { maxPercent: number; canFlat: boolean };
  customerText: string;
  onCustomerText: (text: string) => void;
  newCustomer: CustomerEvent | null;
  onNewCustomer: (event: CustomerEvent | null) => void;
  methods: { label: string; kind: string }[];
  jobSettings: { defaultDuration: number };
  canChooseWorkflow: boolean;
  stageName: (s: string) => string;
  w: (s: string) => string;
  onClose: () => void;
  onComplete: (event: CheckoutEvent) => Promise<void>;
}) {
  const options = useBusinessOptions();
  const [error, setError] = useFeedbackMessage('error');
  const working: Ledger =
    newCustomer && !ledger.customers.some((c) => c.id === newCustomer.data.id)
      ? (applyCustomerEvent(ledger, newCustomer) as Ledger)
      : ledger;
  const walkInId = walkInCustomer(ledger)?.id;
  const customers = working.customers.filter((c) => !c.archived && c.id !== walkInId);
  const customer = customers.find((c) => label(c) === customerText) ?? null;
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState(defaultSource(options));
  const [methodLabel, setMethodLabel] = useState(
    defaultMethod(methods, options.defaultIncomeMethod)?.label ?? methods[0]?.label ?? 'Cash',
  );
  const [received, setReceived] = useState<string | null>(null);
  const [collected, setCollected] = useState(() => collectedByDefault(options));
  const [workflowId, setWorkflowId] = useState('');
  const [dueAt, setDueAt] = useState(() => defaultDueAt(jobSettings.defaultDuration));
  const [useWallet, setUseWallet] = useState(true);
  const [paidOn, setPaidOn] = useState(today());
  const [reference, setReference] = useState('');
  const total = priced.total;
  const wallet = customer ? walletBalance(working, customer.id) : 0;
  const owes = customer ? customerBalance(working, customer.id) : 0;
  const walletUsed = customer && useWallet ? Math.min(wallet, total) : 0;
  const due = total - walletUsed;
  const tendered = (() => {
    try {
      return received === null ? due : money(received || '0');
    } catch {
      return null;
    }
  })();
  const change = !customer && tendered !== null && tendered > total ? tendered - total : 0;
  const delivered = stageName('Collected');
  async function complete() {
    if (busy) return;
    setError('');
    try {
      if (tendered === null) throw Error('Enter the money received.');
      const method = methods.find((m) => m.label === methodLabel);
      if (!method) throw Error('Choose a payment method.');
      if (customerText.trim() && customerText !== WALK_IN_NAME && !customer)
        throw Error('Choose a customer from the list, add a new one, or use Walk-in customer.');
      const added = newCustomer && customer?.id === newCustomer.data.id ? newCustomer : null;
      const { input } = quickSaleInput(ledger, cart, {
        customerId: added ? null : (customer?.id ?? null),
        newCustomer: added,
        tendered,
        method: method.kind,
        methodLabel: method.label,
        paidOn: paidOn || today(),
        source,
        actor,
        now: new Date().toISOString(),
        discount: discountSpec(discount),
        policy: discountPolicy,
        collected,
        dueAt,
        workflowFor: collected ? null : (id: string) => laterWorkflow(ledger, options, id, workflowId),
        useWallet: wallet > 0 && useWallet,
        reference,
      });
      await onComplete(prepareCheckout(ledger, input, actor) as CheckoutEvent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return (
    <>
      <Modal
        title="Payment"
        busy={busy}
        onClose={onClose}
        className="pos-pay-modal"
        footer={
          <>
            <button type="button" className="secondary" onClick={onClose}>
              Back to basket
            </button>
            <button type="button" disabled={busy} onClick={() => void complete()}>
              <Icon name="complete" /> {busy ? 'Saving…' : `Complete sale · ${currency(total)}`}
            </button>
          </>
        }
      >
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        <div className="pos-pay-total" role="status">
          <span>Total to pay</span>
          <strong>{currency(total)}</strong>
          {priced.discountTotal > 0 && (
            <small>
              Before discount {currency(priced.gross)} · Discount −{currency(priced.discountTotal)}
            </small>
          )}
        </div>
        <div className="pos-pay-customer">
          <ListedCombobox
            label="Customer"
            emptyText="No matching customer. Add a new one, or use Walk-in customer."
            name="customer"
            options={[WALK_IN_NAME, ...alphabetical(customers, (c) => c.name).map(label)]}
            value={customerText}
            onChange={onCustomerText}
          />
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            <Icon name="addUser" /> Add new customer
          </button>
        </div>
        {customer && (owes > 0 || wallet > 0) && (
          <div className="pos-pay-account">
            {owes > 0 && (
              <span>
                Previous balance <strong className="danger-text">{currency(owes)}</strong>
              </span>
            )}
            {wallet > 0 && (
              <label className="check-label">
                <input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />
                Use wallet credit ({currency(wallet)})
              </label>
            )}
          </div>
        )}
        <div className="form-grid">
          <label>
            {w('Source')}
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              {options.jobSources.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Payment method
            <select value={methodLabel} onChange={(e) => setMethodLabel(e.target.value)}>
              {alphabetical(methods, (m) => m.label).map((m) => (
                <option key={m.label}>{m.label}</option>
              ))}
            </select>
          </label>
        </div>
        {(discountPolicy.maxPercent > 0 || discountPolicy.canFlat) && (
          <DiscountFields
            label="Discount"
            value={discount}
            allowFlat={discountPolicy.canFlat}
            maxPercent={discountPolicy.canFlat ? 100 : discountPolicy.maxPercent}
            onChange={onDiscount}
          />
        )}
        <div className="pos-collected" role="group" aria-label={delivered}>
          <label className="check-label">
            <input type="checkbox" checked={collected} onChange={(e) => setCollected(e.target.checked)} />
            <span>
              <strong>{delivered} now</strong>
              <small>
                {collected
                  ? `The customer takes the items now; they are marked ${delivered}.`
                  : `The items are ready later: they follow a workflow and finish as ${delivered}. Stock is taken now.`}
              </small>
            </span>
          </label>
          {!collected && (
            <div className="form-grid">
              {canChooseWorkflow && (options.workflows ?? []).length > 0 && (
                <label>
                  {w('Workflow')}
                  <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
                    <option value="">Each item's usual steps</option>
                    {(options.workflows ?? []).map((wf) => (
                      <option key={wf.id} value={wf.id}>
                        {wf.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Due
                <input
                  type="datetime-local"
                  value={toLocalInput(dueAt)}
                  onChange={(e) => setDueAt(fromLocalInput(e.target.value))}
                />
                <small>{dueAt ? 'Clear it for no deadline.' : 'No deadline.'}</small>
              </label>
            </div>
          )}
          {!collected && !customer && (
            <small className="stock-near-text">
              Choose or add a saved customer for a sale collected later.
            </small>
          )}
        </div>
        <div className="form-grid">
          <label>
            Money received (₦)
            <CurrencyInput
              aria-label="Money received (₦)"
              value={received ?? (due / 100).toFixed(2)}
              onValueChange={setReceived}
            />
          </label>
          <div className="pos-pay-change" role="status">
            {change > 0 ? (
              <>
                <span>Change to give</span>
                <strong>{currency(change)}</strong>
              </>
            ) : customer && tendered !== null && tendered < due ? (
              <>
                <span>Owed on the account</span>
                <strong className="danger-text">{currency(due - tendered)}</strong>
              </>
            ) : customer && tendered !== null && tendered > due ? (
              <>
                <span>Extra kept as wallet credit</span>
                <strong>{currency(tendered - due)}</strong>
              </>
            ) : (
              <>
                <span>Change</span>
                <strong>{currency(0)}</strong>
              </>
            )}
          </div>
        </div>
        <details className="pos-more">
          <summary>More options</summary>
          <div className="form-grid">
            <label>
              Date
              <input type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} />
            </label>
            <label>
              Reference
              <input
                value={reference}
                maxLength={120}
                placeholder="Transfer or POS reference"
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </div>
        </details>
      </Modal>
      {adding && (
        <CustomerEditor
          customers={working.customers}
          actor={actor}
          busy={busy}
          onClose={() => setAdding(false)}
          onSave={async (event) => {
            if (event.kind !== 'customer.created') throw Error('Add a new customer.');
            onNewCustomer(event);
            onCustomerText(label({ name: event.data.name!, phone: event.data.phone ?? '' }));
          }}
        />
      )}
    </>
  );
}
