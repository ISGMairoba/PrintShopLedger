// Product variants (colours, sizes…). Each variant is its own item for sale with its own stock
// item, named "Product — Variant". Variants of one product share a group id, price and pack
// prices; changes to the product's name, price or pack prices are applied to every variant.
// Each variant is priced on its own, so pieces of different variants never make up a pack.
import { applyEvent } from './domain.mjs';
import { validPackPrices } from './pack-prices.mjs';
import { validPriceTiers } from './price-tiers.mjs';
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
function newVariant({
  group,
  product,
  variant,
  unit,
  price,
  packPrices,
  priceTiers = [],
  shelfItem,
  stock,
  minimum,
  audit,
}) {
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
        priceTiers,
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
  const priceTiers = validPriceTiers(input.priceTiers);
  const events = variants.flatMap((v, i) =>
    newVariant({
      group,
      product,
      variant: names[i],
      unit: input.unit,
      price: input.price,
      packPrices,
      priceTiers,
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
    priceTiers: first.service.priceTiers ?? [],
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
  { name, price, packPrices, priceTiers, unit },
  actor,
  now = new Date().toISOString(),
) {
  const group = variantGroups(ledger).find((g) => g.id === groupId);
  if (!group) throw Error('Choose a product with variants.');
  const product = cleanName(name, 'a name');
  const packs = validPackPrices(packPrices);
  const tiers = validPriceTiers(priceTiers === undefined ? group.members[0].service.priceTiers : priceTiers);
  const newUnit = unit === undefined ? null : String(unit).trim();
  if (newUnit !== null && (!newUnit || newUnit.length > 40)) throw Error('Choose a unit.');
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  /** @type {ProductEvents} */
  const events = [];
  for (const { service, material } of group.members) {
    const title = variantTitle(product, service.variantName);
    const samePacks = JSON.stringify(validPackPrices(service.packPrices ?? [])) === JSON.stringify(packs);
    const sameTiers = JSON.stringify(validPriceTiers(service.priceTiers ?? [])) === JSON.stringify(tiers);
    if (title !== service.description || price !== service.price || !samePacks || !sameTiers)
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
          priceTiers: tiers,
          variantGroup: service.variantGroup,
          variantName: service.variantName,
          ...audit,
        },
      });
    const rename = material && material.name === service.description && material.name !== title;
    const reunit = material && newUnit !== null && material.measurementUnit !== newUnit;
    if (rename || reunit)
      events.push({
        id: crypto.randomUUID(),
        kind: 'material.updated',
        data: {
          id: material.id,
          baseVersion: material.version,
          name: rename ? title : material.name,
          available: material.available,
          measurementUnit: reunit ? newUnit : material.measurementUnit,
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
    ...(newUnit !== null && group.members.some((m) => m.material && m.material.measurementUnit !== newUnit)
      ? [`Change the unit of all ${group.members.length} variants to ${newUnit}`]
      : []),
    ...(JSON.stringify(validPackPrices(first.packPrices ?? [])) !== JSON.stringify(packs)
      ? [`Change the pack prices of all ${group.members.length} variants`]
      : []),
    ...(JSON.stringify(validPriceTiers(first.priceTiers ?? [])) !== JSON.stringify(tiers)
      ? [`Change the quantity ranges of all ${group.members.length} variants`]
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

/** A service.updated event that keeps everything about the item except `patch`. */
function serviceUpdate(service, patch, audit) {
  return {
    id: crypto.randomUUID(),
    kind: 'service.updated',
    data: {
      id: service.id,
      baseVersion: service.version,
      description: service.description,
      materialId: service.materialId,
      price: service.price,
      shelfItem: service.shelfItem ?? false,
      private: service.private ?? false,
      costing: service.costing ?? null,
      packPrices: service.packPrices ?? [],
      ...patch,
      ...audit,
    },
  };
}
/** Rename the item's stock item along with it, when they share a name. */
function stockRename(ledger, service, name, audit) {
  const material = service.materialId ? ledger.materials.find((m) => m.id === service.materialId) : null;
  if (!material || material.name !== service.description || material.name === name) return [];
  return [
    {
      id: crypto.randomUUID(),
      kind: 'material.updated',
      data: {
        id: material.id,
        baseVersion: material.version,
        name,
        available: material.available,
        measurementUnit: material.measurementUnit,
        requireSize: material.requireSize,
        minimumStock: material.minimumStock ?? 0,
        ...audit,
      },
    },
  ];
}
/** An active item that is not yet a variant and has a stock item counted by number. */
function standalone(ledger, serviceId) {
  const service = ledger.services.find((s) => s.id === serviceId && !s.archived);
  if (!service) throw Error('Choose an active item.');
  if (service.variantGroup) throw Error('This item is already a variant.');
  const material = service.materialId ? ledger.materials.find((m) => m.id === service.materialId) : null;
  if (!material || material.archived) throw Error('Only items with their own stock item can have variants.');
  if (material.requireSize) throw Error('Items sold by size cannot have variants.');
  if (service.private) throw Error('Items used only in pricing templates cannot have variants.');
  return { service, material };
}

/**
 * Turn an existing item into a product with variants: it becomes one variant (keeping its stock)
 * and the new variants are added beside it with the same price, pack prices and unit.
 * input: { product, variant (this item's variant name), others: [{ name, stock, minimum }] }.
 * @returns {{ events: ProductEvents, summary: string[] }}
 */
export function makeVariantsEvents(ledger, serviceId, input, actor, now = new Date().toISOString()) {
  const { service, material } = standalone(ledger, serviceId);
  const product = cleanName(input.product, 'a product name');
  const variant = cleanName(input.variant, 'a variant name for this item');
  const others = (input.others ?? []).filter((v) => String(v.name ?? '').trim());
  if (!others.length) throw Error('Add at least one more variant.');
  const names = others.map((v) => cleanName(v.name, 'a variant name'));
  distinct([variant, ...names]);
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  const group = crypto.randomUUID();
  const title = variantTitle(product, variant);
  /** @type {ProductEvents} */
  const events = [
    serviceUpdate(service, { description: title, variantGroup: group, variantName: variant }, audit),
    ...stockRename(ledger, service, title, audit),
    ...others.flatMap((v, i) =>
      newVariant({
        group,
        product,
        variant: names[i],
        unit: material.measurementUnit,
        price: service.price,
        packPrices: service.packPrices ?? [],
        priceTiers: service.priceTiers ?? [],
        shelfItem: service.shelfItem ?? true,
        stock: v.stock,
        minimum: v.minimum,
        audit,
      }),
    ),
  ];
  check(ledger, events);
  return {
    events,
    summary: [
      `Make “${service.description}” the ${variant} variant of ${product} (its stock stays)`,
      `Add ${names.length} more variant${names.length === 1 ? '' : 's'}: ${names.join(', ')}`,
    ],
  };
}

/**
 * Make an existing item a variant of an existing product. It takes that product's price and pack
 * prices, keeps its own stock, and is renamed "Product — Variant". The units must match.
 * @returns {{ events: ProductEvents, summary: string[] }}
 */
export function joinVariantsEvents(
  ledger,
  serviceId,
  groupId,
  variantName,
  actor,
  now = new Date().toISOString(),
) {
  const { service, material } = standalone(ledger, serviceId);
  const group = variantGroups(ledger).find((g) => g.id === groupId);
  if (!group) throw Error('Choose a product with variants.');
  const variant = cleanName(variantName, 'a variant name');
  distinct([...group.members.map((m) => m.service.variantName), variant]);
  const first = group.members[0];
  const unit = first.material?.measurementUnit;
  if (unit && unit !== material.measurementUnit)
    throw Error(
      `This item is counted in ${material.measurementUnit} but ${group.name} in ${unit}. Change its unit first.`,
    );
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  const title = variantTitle(group.name, variant);
  const events = [
    serviceUpdate(
      service,
      {
        description: title,
        price: first.service.price,
        packPrices: first.service.packPrices ?? [],
        priceTiers: first.service.priceTiers ?? [],
        variantGroup: group.id,
        variantName: variant,
      },
      audit,
    ),
    ...stockRename(ledger, service, title, audit),
  ];
  check(ledger, events);
  const summary = [`Make “${service.description}” the ${variant} variant of ${group.name} (its stock stays)`];
  if (first.service.price !== service.price) summary.push(`Use ${group.name}'s price`);
  if (JSON.stringify(first.service.packPrices ?? []) !== JSON.stringify(service.packPrices ?? []))
    summary.push(`Use ${group.name}'s pack prices`);
  if (JSON.stringify(first.service.priceTiers ?? []) !== JSON.stringify(service.priceTiers ?? []))
    summary.push(`Use ${group.name}'s quantity ranges`);
  return { events, summary };
}

/**
 * Take a variant out of its product so it becomes an item of its own, with its stock, price and
 * pack prices as they are. If only one variant would be left, it becomes an item of its own too.
 * @returns {{ events: ProductEvents, summary: string[] }}
 */
export function separateVariantEvents(ledger, serviceId, newName, actor, now = new Date().toISOString()) {
  const service = ledger.services.find((s) => s.id === serviceId && !s.archived);
  if (!service?.variantGroup) throw Error('Choose a variant.');
  const group = variantGroups(ledger).find((g) => g.id === service.variantGroup);
  const name = cleanName(newName, 'a name for the separate item');
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  /** @type {ProductEvents} */
  const events = [
    serviceUpdate(service, { description: name, variantGroup: null, variantName: null }, audit),
    ...stockRename(ledger, service, name, audit),
  ];
  const summary = [`Make “${service.description}” a separate item named “${name}” (stock stays)`];
  const rest = group ? group.members.filter((m) => m.service.id !== service.id) : [];
  if (rest.length === 1) {
    const last = rest[0].service;
    events.push(serviceUpdate(last, { variantGroup: null, variantName: null }, audit));
    summary.push(`“${last.description}” is the only one left, so it becomes a separate item too`);
  }
  check(ledger, events);
  return { events, summary };
}
