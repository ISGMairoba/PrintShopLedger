// Quick sale: selling shelf items at the till. Staff tap products, set quantities and take the
// money; the sale is saved as a normal checkout, so stock, receipts, reports and drawer totals
// work exactly as for any other sale. Walk-in buyers share one "Walk-in customer" record.
import { quoteLine } from './checkout.mjs';
import { applyOrderDiscount, validDiscount } from './discounts.mjs';
import { countPrice } from './price-tiers.mjs';
import { perItem } from './production-materials.mjs';
import { variantBase } from './variants.mjs';
import { itemSteps, stepsWorkflow } from './workflow-steps.mjs';

export const WALK_IN_NAME = 'Walk-in customer';
/** A phone value with no digits: it never clashes with a real customer's number. */
export const WALK_IN_PHONE = 'Walk-in';

/**
 * Shelf items that can be sold now, with their stock (null when stock is not tracked).
 * @param {import('./types').Ledger} ledger
 */
export function shelfProducts(ledger) {
  return ledger.services
    .filter((s) => s.shelfItem && !s.archived && !s.private && !s.customPrice)
    .map((s) => {
      const material = s.materialId ? ledger.materials.find((m) => m.id === s.materialId) : null;
      // Stock in items: one item can use more or less than one unit of its material (half a sheet).
      const per = perItem(s);
      const items = (n) => Math.floor(n / per + 1e-9);
      return {
        id: s.id,
        name: s.description,
        icon: s.icon ?? null,
        category: s.category ?? '',
        code: s.code ?? '',
        tags: s.tags ?? [],
        price: s.price,
        packPrices: s.packPrices ?? [],
        priceTiers: s.priceTiers ?? [],
        variantGroup: s.variantGroup ?? null,
        variantName: s.variantName ?? null,
        productName: variantBase(s),
        material,
        stock: material ? (per === 1 ? material.available : items(material.available)) : null,
        minimum: per === 1 ? (material?.minimumStock ?? 0) : items(material?.minimumStock ?? 0),
        // The least sold in one sale (0: none); a first tap adds this many.
        minOrder: s.minQuantity ?? 0,
        unit: per === 1 ? (material?.measurementUnit ?? 'item') : 'item',
        // Sized materials need width and height, which a quick sale does not ask for.
        sellable: !s.materialId || (!!material && !material.archived && !material.requireSize),
      };
    })
    .filter((p) => p.sellable)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tiles for the product grid: a product with variants is one tile with a button per variant.
 * A search matches the product name or the variant name.
 * @template {{ id: string, name: string, productName: string, variantGroup: string | null, variantName: string | null }} P
 * @param {P[]} products
 * @param {string} [query]
 * @returns {({ kind: 'single', product: P } | { kind: 'group', id: string, name: string, variants: P[] })[]}
 */
export function productTiles(products, query = '', category = '') {
  const q = query.trim().toLowerCase();
  const tiles = [];
  const groups = new Map();
  for (const p of products) {
    // Search: name, category, item code or a tag.
    if (
      q &&
      ![p.name, p.category ?? '', p.code ?? '', ...(p.tags ?? [])].some((text) =>
        String(text).toLowerCase().includes(q),
      )
    )
      continue;
    if (category && (p.category ?? '') !== category) continue;
    if (!p.variantGroup) {
      tiles.push({ kind: 'single', product: p, sortName: p.name });
      continue;
    }
    let tile = groups.get(p.variantGroup);
    if (!tile) {
      tile = {
        kind: 'group',
        id: p.variantGroup,
        name: p.productName,
        variants: [],
        sortName: p.productName,
      };
      groups.set(p.variantGroup, tile);
      tiles.push(tile);
    }
    tile.variants.push(p);
  }
  for (const tile of groups.values())
    tile.variants.sort((a, b) => String(a.variantName).localeCompare(String(b.variantName)));
  return tiles
    .sort((a, b) => a.sortName.localeCompare(b.sortName))
    .map(({ sortName: _sort, ...tile }) => tile);
}

/** The categories of the shelf items, for the chips above the grid (most items first, then A–Z). */
export function productCategories(products) {
  const count = new Map();
  for (const p of products) if (p.category) count.set(p.category, (count.get(p.category) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ name, count: n }));
}

/** The lowest price a tile can sell at ("from ₦…" when packs, tiers or variants make it vary). */
/**
 * A tile's price: the price of one item (the lowest of its variants; from = the variants differ),
 * and whether cheaper pack prices or quantity ranges apply (deal: 'packs' | 'ranges' | null).
 */
export function tilePrice(variants) {
  const prices = variants.map((p) => p.price).filter((n) => Number.isFinite(n));
  const deal = variants.some((p) => (p.priceTiers ?? []).length)
    ? 'ranges'
    : variants.some((p) => (p.packPrices ?? []).length)
      ? 'packs'
      : null;
  return { price: Math.min(...prices), from: new Set(prices).size > 1, deal };
}

/**
 * Whether the Collected tick starts ticked: yes, unless the business set a workflow for shelf items
 * (Business Settings → Dropdowns & workflow), in which case its shelf sales usually go through it.
 */
export const collectedByDefault = (options) => !options?.defaultShelfWorkflowId;

/**
 * The workflow fields for a shelf item sold now and collected later: a saved workflow chosen at the
 * sale (for the whole sale), else the item's own steps, else the business's steps for shelf items.
 * @param {any} ledger
 * @param {any} options business options
 * @param {string} serviceId
 * @param {string} [chosenId] a saved workflow's id, or '' for each item's usual steps
 */
export function laterWorkflow(ledger, options, serviceId, chosenId = '') {
  const chosen = chosenId ? (options.workflows ?? []).find((w) => w.id === chosenId) : null;
  const service = ledger.services.find((s) => s.id === serviceId);
  const flow = stepsWorkflow(chosen ? chosen.steps : itemSteps(options, service?.production, 'shelf'));
  return {
    workflow: flow.stages,
    ...(chosen ? { workflowName: chosen.name, workflowId: chosen.id } : {}),
    ...(Object.keys(flow.hours).length ? { stageHours: flow.hours } : {}),
    ...(flow.shares ? { stageShares: flow.shares } : {}),
  };
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

/** Add one of a product to the cart (or one more); the first adds `first` (the minimum order). */
export function addToCart(cart, productId, step = 1, first = step) {
  const found = cart.find((l) => l.serviceId === productId);
  if (!found) return [...cart, { serviceId: productId, quantity: Math.max(step, first) }];
  return cart.map((l) => (l.serviceId === productId ? { ...l, quantity: round(l.quantity + step) } : l));
}
const round = (n) => Math.round(n * 1000) / 1000;
/** Set a line's quantity; zero or less removes it (the − button and Remove). */
export const setQuantity = (cart, productId, quantity) =>
  quantity > 0
    ? cart.map((l) => (l.serviceId === productId ? { ...l, quantity: round(quantity) } : l))
    : cart.filter((l) => l.serviceId !== productId);
/** A quantity being typed: the line stays in the cart even at zero or blank, until Remove. */
export const typeQuantity = (cart, productId, quantity) =>
  cart.map((l) =>
    l.serviceId === productId
      ? { ...l, quantity: Number.isFinite(quantity) && quantity > 0 ? round(quantity) : 0 }
      : l,
  );

/** Price of the cart at today's prices, in kobo. */
export function cartTotal(ledger, cart) {
  let total = 0;
  for (const line of cart) {
    const service = ledger.services.find((s) => s.id === line.serviceId);
    if (!service) throw Error('A product in the cart is no longer available.');
    total += countPrice(service, line.quantity);
  }
  return total;
}

/**
 * The cart's lines and price after a discount.
 * A discount from someone who may discount whole orders (policy.canFlat) is an order discount;
 * otherwise it is the same percentage on each line, which is what their rank allows.
 * Returns { lines, orderDiscount, gross, total, discountTotal }.
 * @param {any} ledger
 * @param {{ serviceId: string, quantity: number, id?: string }[]} cart
 * @param {{ discount?: { kind: string, value: number, reason?: string } | null, policy?: { maxPercent: number, canFlat: boolean } | null, source?: string }} [options]
 */
export function pricedCart(ledger, cart, { discount = null, policy = null, source = 'In shop / USB' } = {}) {
  const spec = validDiscount(discount);
  const perLine = !!spec && !!policy && !policy.canFlat;
  const lines = cart.map((line) => {
    const service = ledger.services.find((s) => s.id === line.serviceId);
    if (!service) throw Error('A product in the cart is no longer available.');
    return {
      id: line.id ?? crypto.randomUUID(),
      serviceId: line.serviceId,
      description: service.description.slice(0, 500),
      quantity: String(line.quantity),
      width: '',
      height: '',
      source,
      sourceNote: 'Quick sale',
      ...(perLine ? { discount: spec } : {}),
    };
  });
  const orderDiscount = spec && !perLine ? spec : null;
  const priced = applyOrderDiscount(
    lines.map((line) => quoteLine(ledger, line)),
    orderDiscount,
    policy,
  );
  const total = priced.jobs.reduce((n, j) => n + j.amount, 0);
  return {
    lines,
    orderDiscount,
    gross: total + priced.discountTotal,
    total,
    discountTotal: priced.discountTotal,
  };
}

/**
 * What to hand to prepareCheckout for this quick sale.
 * walk-in (no customerId): the sale must be paid in full; extra money is change, not credit.
 * A named customer can pay part (the rest is owed) or more (the extra becomes wallet credit).
 * Returns { input, total, change }.
 * @param {any} ledger
 * @param {{ serviceId: string, quantity: number }[]} cart
 * Not collected now: each item follows `workflowFor(serviceId)` (workflow fields, see laterWorkflow)
 * with an optional deadline, and a saved customer is needed.
 * newCustomer: a customer.created event for a customer added during the sale (they buy it).
 * useWallet: a saved customer's wallet credit pays first.
 * termsAndConditions: terms changed for this sale (left out, the receipt uses the business terms).
 * @param {{ customerId: string | null, tendered: number, method: string, methodLabel: string, paidOn: string, source: string, actor: { id: string, label: string }, now: string, discount?: { kind: string, value: number, reason?: string } | null, policy?: { maxPercent: number, canFlat: boolean } | null, collected?: boolean, dueAt?: string, workflowFor?: ((serviceId: string) => Record<string, unknown>) | null, newCustomer?: any, useWallet?: boolean, reference?: string, splits?: { method: string, methodLabel: string, accountId?: string, amount: number }[] | null, termsAndConditions?: string }} options
 */
export function quickSaleInput(
  ledger,
  cart,
  {
    customerId,
    tendered,
    method,
    methodLabel,
    paidOn,
    source,
    actor,
    now,
    discount = null,
    policy = null,
    collected = true,
    dueAt = '',
    workflowFor = null,
    newCustomer: added = null,
    useWallet = false,
    reference = '',
    splits = null,
    termsAndConditions = undefined,
  },
) {
  if (!cart.length) throw Error('Add at least one product.');
  for (const line of cart)
    if (!(line.quantity > 0) || Math.abs(Math.round(line.quantity * 1000) - line.quantity * 1000) > 1e-6)
      throw Error('Quantities must be more than zero, with up to three decimal places.');
  if (!Number.isSafeInteger(tendered) || tendered < 0) throw Error('Enter the money received.');
  const { lines, orderDiscount, total } = pricedCart(ledger, cart, { discount, policy, source });
  if (added && added.kind !== 'customer.created') throw Error('Add a new customer.');
  const named = added?.data.id ?? customerId;
  const walkIn = named ? null : walkInCustomer(ledger);
  const newCustomer = added ?? (named || walkIn ? null : walkInEvent(actor, now));
  const buyer = named || walkIn?.id || newCustomer.data.id;
  const isWalkIn = !named;
  if (!collected && isWalkIn) throw Error('Choose a saved customer for a sale that is collected later.');
  if (isWalkIn && tendered < total)
    throw Error('Walk-in sales are paid in full. Choose a customer to sell on credit.');
  const cashReceived = isWalkIn ? total : tendered;
  // Split, walk-in: change comes out of the cash part (the rest must add up to the total).
  let parts = splits;
  if (parts && isWalkIn && tendered > total) {
    const cash = parts.findIndex((p) => p.method === 'Cash' && p.amount > tendered - total);
    if (cash < 0) throw Error('Walk-in split payments must add up to the total; change comes from cash.');
    parts = parts.map((p, i) => (i === cash ? { ...p, amount: p.amount - (tendered - total) } : p));
  }
  return {
    total,
    change: isWalkIn ? tendered - total : 0,
    input: {
      customerId: buyer,
      newCustomer,
      lines: collected
        ? lines
        : lines.map((line) => ({
            ...line,
            ...(dueAt ? { dueAt } : {}),
            ...(workflowFor ? workflowFor(line.serviceId) : {}),
          })),
      ...(collected ? {} : { collected: false }),
      ...(orderDiscount ? { orderDiscount } : {}),
      ...(policy ? { discountPolicy: policy } : {}),
      cashReceived,
      useWallet: !isWalkIn && !!useWallet,
      override: null,
      method,
      methodLabel,
      paidOn,
      reference: String(reference ?? '')
        .trim()
        .slice(0, 120),
      ...(parts ? { splits: parts } : {}),
      // Terms changed for this sale (More options); otherwise the receipt uses the business's.
      ...(termsAndConditions === undefined ? {} : { termsAndConditions }),
    },
  };
}
