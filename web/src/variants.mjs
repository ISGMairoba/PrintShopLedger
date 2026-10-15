// Product variants (colours, sizes…). Each variant is its own item for sale with its own stock
// item, named "Product — Variant". Variants of one product share a group id, price and pack
// prices; changes to the product's name, price or pack prices are applied to every variant.
// Each variant is priced on its own, so pieces of different variants never make up a pack.
import { applyEvent } from './domain.mjs';
import { validPackPrices } from './pack-prices.mjs';
import { productEditEvents } from './product-edit.mjs';

const SEP = ' — ';
/** "Envelope — Blue" for product "Envelope" and variant "Blue". */
export const variantTitle = (product, variant) => `${product}${SEP}${variant}`;
/** The product name of a variant (its description without the variant name). */
export function variantBase(service) {
  if (!service?.variantGroup || !service.variantName) return service?.description ?? '';
  const suffix = SEP + service.variantName;
  return service.description.endsWith(suffix)
    ? service.description.slice(0, -suffix.length)
    : service.description;
}

/**
 * @typedef {{ id: string, name: string, members: { service: import('./types').Service, material: import('./types').Material | null }[] }} VariantGroup
 * @typedef {(import('./types').MaterialEvent | import('./types').ServiceEvent)[]} ProductEvents
 */
/**
 * Active variant groups: { id, name, members: [{ service, material }] }, members in name order.
 * @param {import('./types').Ledger} ledger
 * @returns {VariantGroup[]}
 */
export function variantGroups(ledger) {
  const groups = new Map();
  for (const service of ledger.services) {
    if (!service.variantGroup || service.archived) continue;
    const material = service.materialId
      ? (ledger.materials.find((m) => m.id === service.materialId) ?? null)
      : null;
    const group = groups.get(service.variantGroup) ?? {
      id: service.variantGroup,
      name: variantBase(service),
      members: [],
    };
    group.members.push({ service, material });
    groups.set(service.variantGroup, group);
  }
  for (const group of groups.values())
    group.members.sort((a, b) => a.service.variantName.localeCompare(b.service.variantName));
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
/** @returns {VariantGroup | null} */
export const variantGroupOf = (ledger, service) =>
  service?.variantGroup ? (variantGroups(ledger).find((g) => g.id === service.variantGroup) ?? null) : null;

const cleanName = (value, what) => {
  const name = String(value ?? '').trim();
  if (!name) throw Error(`Enter ${what}.`);
  return name;
};
const amount = (value, what) => {
  const n = Math.round(Number(value || 0) * 1000) / 1000;
  if (!Number.isFinite(n) || n < 0) throw Error(`${what} must be zero or more.`);
  return n;
};

/**
 * Events for one new variant (its stock item and its item for sale), checked against the ledger.
 * @returns {ProductEvents}
 */
function newVariant({ group, product, variant, unit, price, packPrices, shelfItem, stock, minimum, audit }) {
  const materialId = crypto.randomUUID();
  return [
    {
      id: crypto.randomUUID(),
      kind: 'material.created',
      data: {
        id: materialId,
        name: variantTitle(product, variant),
        available: amount(stock, 'Opening stock'),
        measurementUnit: unit,
        requireSize: false,
        minimumStock: amount(minimum, 'Minimum stock'),
        reason: 'Opening stock',
        ...audit,
      },
    },
    {
      id: crypto.randomUUID(),
      kind: 'service.created',
      data: {
        id: crypto.randomUUID(),
        description: variantTitle(product, variant),
        materialId,
        price,
        shelfItem,
        packPrices,
        variantGroup: group,
        variantName: variant,
        ...audit,
      },
    },
  ];
}
function check(ledger, events) {
  let working = ledger;
  for (const event of events) working = applyEvent(working, event);
  return working;
}
const distinct = (names) => {
  const seen = new Set();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) throw Error(`“${name}” is listed twice.`);
    seen.add(key);
  }
};

/**
 * A new product with variants: { name, unit, price (kobo), packPrices, variants: [{ name, stock, minimum }] }.
 * Returns the events (a stock item and an item for sale per variant).
 * @returns {ProductEvents}
 */
export function newVariantProductEvents(ledger, input, actor, now = new Date().toISOString()) {
  const product = cleanName(input.name, 'a product name');
  const variants = (input.variants ?? []).filter((v) => String(v.name ?? '').trim());
  if (variants.length < 2) throw Error('Add at least two variants, e.g. Pink and Blue.');
  if (variants.length > 50) throw Error('Add up to 50 variants.');
  const names = variants.map((v) => cleanName(v.name, 'a variant name'));
  distinct(names);
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  const group = crypto.randomUUID();
  const packPrices = validPackPrices(input.packPrices);
  const events = variants.flatMap((v, i) =>
    newVariant({
      group,
      product,
      variant: names[i],
      unit: input.unit,
      price: input.price,
      packPrices,
      shelfItem: input.shelfItem ?? true,
      stock: v.stock,
      minimum: v.minimum,
      audit,
    }),
  );
  check(ledger, events);
  return events;
}

/**
 * Add one variant to an existing product, with the product's price, pack prices and unit.
 * @returns {ProductEvents}
 */
export function addVariantEvents(ledger, groupId, input, actor, now = new Date().toISOString()) {
  const group = variantGroups(ledger).find((g) => g.id === groupId);
  if (!group) throw Error('Choose a product with variants.');
  const variant = cleanName(input.name, 'a variant name');
  distinct([...group.members.map((m) => m.service.variantName), variant]);
  const first = group.members[0];
  const events = newVariant({
    group: group.id,
    product: group.name,
    variant,
    unit: first.material?.measurementUnit ?? 'piece',
    price: first.service.price,
    packPrices: first.service.packPrices ?? [],
    shelfItem: first.service.shelfItem ?? true,
    stock: input.stock,
    minimum: input.minimum,
    audit: { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now },
  });
  check(ledger, events);
  return events;
}

/**
 * Apply the product's name, price and pack prices to every variant (and rename their stock items).
 * Only variants that actually change get an event. Returns { events, summary }.
 * @returns {{ events: ProductEvents, summary: string[] }}
 */
export function syncVariantEvents(
  ledger,
  groupId,
  { name, price, packPrices },
  actor,
  now = new Date().toISOString(),
) {
  const group = variantGroups(ledger).find((g) => g.id === groupId);
  if (!group) throw Error('Choose a product with variants.');
  const product = cleanName(name, 'a name');
  const packs = validPackPrices(packPrices);
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  /** @type {ProductEvents} */
  const events = [];
  for (const { service, material } of group.members) {
    const title = variantTitle(product, service.variantName);
    const samePacks = JSON.stringify(validPackPrices(service.packPrices ?? [])) === JSON.stringify(packs);
    if (title !== service.description || price !== service.price || !samePacks)
      events.push({
        id: crypto.randomUUID(),
        kind: 'service.updated',
        data: {
          id: service.id,
          baseVersion: service.version,
          description: title,
          materialId: service.materialId,
          price,
          shelfItem: service.shelfItem ?? false,
          private: service.private ?? false,
          costing: service.costing ?? null,
          packPrices: packs,
          variantGroup: service.variantGroup,
          variantName: service.variantName,
          ...audit,
        },
      });
    if (material && material.name === service.description && material.name !== title)
      events.push({
        id: crypto.randomUUID(),
        kind: 'material.updated',
        data: {
          id: material.id,
          baseVersion: material.version,
          name: title,
          available: material.available,
          measurementUnit: material.measurementUnit,
          requireSize: material.requireSize,
          minimumStock: material.minimumStock ?? 0,
          ...audit,
        },
      });
  }
  const first = group.members[0].service;
  const summary = [
    ...(product !== group.name
      ? [`Rename “${group.name}” to “${product}” (all ${group.members.length} variants)`]
      : []),
    ...(price !== first.price ? [`Change the price of all ${group.members.length} variants`] : []),
    ...(JSON.stringify(validPackPrices(first.packPrices ?? [])) !== JSON.stringify(packs)
      ? [`Change the pack prices of all ${group.members.length} variants`]
      : []),
  ];
  check(ledger, events);
  return { events, summary };
}

/**
 * Edit one variant from the product editor. The product name, price and pack prices go to every
 * variant; minimum stock and stock changes are for this variant only.
 * changes: { name (product name), price, packPrices, minimumStock, stock }. Returns { events, summary }.
 * @returns {{ events: ProductEvents, summary: string[] }}
 */
export function variantEditEvents(ledger, serviceId, changes, actor, now = new Date().toISOString()) {
  const service = ledger.services.find((s) => s.id === serviceId && !s.archived);
  if (!service?.variantGroup) throw Error('Choose a product with variants.');
  const shared = syncVariantEvents(ledger, service.variantGroup, changes, actor, now);
  const working = check(ledger, shared.events);
  const own = working.services.find((s) => s.id === serviceId);
  let mine = { events: [], summary: [] };
  try {
    mine = productEditEvents(
      working,
      serviceId,
      {
        name: own.description,
        price: own.price,
        packPrices: own.packPrices ?? [],
        renameStock: false,
        minimumStock: changes.minimumStock,
        stock: changes.stock,
      },
      actor,
      now,
    );
  } catch (cause) {
    if (!(cause instanceof Error) || cause.message !== 'Nothing has changed.') throw cause;
  }
  const events = [...shared.events, ...mine.events];
  if (!events.length) throw Error('Nothing has changed.');
  const label = service.variantName;
  return {
    events,
    summary: [...shared.summary, ...mine.summary.map((line) => `${label}: ${line}`)],
  };
}
