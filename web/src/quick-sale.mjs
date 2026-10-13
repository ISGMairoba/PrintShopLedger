// Quick sale: selling shelf items at the till. Staff tap products, set quantities and take the
// money; the sale is saved as a normal checkout, so stock, receipts, reports and drawer totals
// work exactly as for any other sale. Walk-in buyers share one "Walk-in customer" record.

export const WALK_IN_NAME = 'Walk-in customer';
/** A phone value with no digits: it never clashes with a real customer's number. */
export const WALK_IN_PHONE = 'Walk-in';

/**
 * Shelf items that can be sold now, with their stock (null when stock is not tracked).
 * @param {import('./types').Ledger} ledger
 */
export function shelfProducts(ledger) {
  return ledger.services
    .filter((s) => s.shelfItem && !s.archived)
    .map((s) => {
      const material = s.materialId ? ledger.materials.find((m) => m.id === s.materialId) : null;
      return {
        id: s.id,
        name: s.description,
        price: s.price,
        material,
        stock: material ? material.available : null,
        unit: material?.measurementUnit ?? 'item',
        // Sized materials need width and height, which a quick sale does not ask for.
        sellable: !s.materialId || (!!material && !material.archived && !material.requireSize),
      };
    })
    .filter((p) => p.sellable)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The shared walk-in customer, if the business has one. */
export const walkInCustomer = (ledger) =>
  ledger.customers.find(
    (c) =>
      !c.archived && c.name.trim().toLowerCase() === WALK_IN_NAME.toLowerCase() && !/\d/.test(c.phone ?? ''),
  ) ?? null;

/** The customer.created event for the walk-in customer, made with the first walk-in sale. */
export const walkInEvent = (actor, now = new Date().toISOString(), id = crypto.randomUUID()) => ({
  id: crypto.randomUUID(),
  kind: 'customer.created',
  data: {
    id,
    name: WALK_IN_NAME,
    phone: WALK_IN_PHONE,
    address: '',
    creditLimit: 0,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
  },
});

/** Add one of a product to the cart (or one more). */
export function addToCart(cart, productId, step = 1) {
  const found = cart.find((l) => l.serviceId === productId);
  if (!found) return [...cart, { serviceId: productId, quantity: step }];
  return cart.map((l) => (l.serviceId === productId ? { ...l, quantity: round(l.quantity + step) } : l));
}
const round = (n) => Math.round(n * 1000) / 1000;
/** Set a line's quantity; zero or less removes it. */
export const setQuantity = (cart, productId, quantity) =>
  quantity > 0
    ? cart.map((l) => (l.serviceId === productId ? { ...l, quantity: round(quantity) } : l))
    : cart.filter((l) => l.serviceId !== productId);

/** Price of the cart at today's prices, in kobo. */
export function cartTotal(ledger, cart) {
  let total = 0;
  for (const line of cart) {
    const service = ledger.services.find((s) => s.id === line.serviceId);
    if (!service) throw Error('A product in the cart is no longer available.');
    total += Math.round(service.price * line.quantity);
  }
  return total;
}

/**
 * What to hand to prepareCheckout for this quick sale.
 * walk-in (no customerId): the sale must be paid in full; extra money is change, not credit.
 * A named customer can pay part (the rest is owed) or more (the extra becomes wallet credit).
 * Returns { input, total, change }.
 */
export function quickSaleInput(
  ledger,
  cart,
  { customerId, tendered, method, methodLabel, paidOn, source, actor, now },
) {
  if (!cart.length) throw Error('Add at least one product.');
  for (const line of cart)
    if (!(line.quantity > 0) || Math.round(line.quantity * 1000) !== line.quantity * 1000)
      throw Error('Quantities must be more than zero, with up to three decimal places.');
  if (!Number.isSafeInteger(tendered) || tendered < 0) throw Error('Enter the money received.');
  const total = cartTotal(ledger, cart);
  const walkIn = customerId ? null : walkInCustomer(ledger);
  const newCustomer = customerId || walkIn ? null : walkInEvent(actor, now);
  const buyer = customerId || walkIn?.id || newCustomer.data.id;
  const isWalkIn = !customerId;
  if (isWalkIn && tendered < total)
    throw Error('Walk-in sales are paid in full. Choose a customer to sell on credit.');
  const cashReceived = isWalkIn ? total : tendered;
  return {
    total,
    change: isWalkIn ? tendered - total : 0,
    input: {
      customerId: buyer,
      newCustomer,
      lines: cart.map((line) => {
        const service = ledger.services.find((s) => s.id === line.serviceId);
        return {
          id: crypto.randomUUID(),
          serviceId: line.serviceId,
          description: service.description.slice(0, 500),
          quantity: String(line.quantity),
          width: '',
          height: '',
          source,
          sourceNote: 'Quick sale',
        };
      }),
      cashReceived,
      useWallet: false,
      override: null,
      method,
      methodLabel,
      paidOn,
      reference: '',
    },
  };
}
