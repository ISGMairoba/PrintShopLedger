// Edit a product in one place: its name (and its stock item's name), price, minimum stock and stock
// level. The changes become the usual service and material events, in order, each checked against
// the ledger as it will be after the one before, so they save, sync and audit like any other edit.
import { applyEvent } from './domain.mjs';
import { validPackPrices } from './pack-prices.mjs';

/**
 * Services and products that can be edited here, with their stock item (if any).
 * @param {import('./types').Ledger} ledger
 * @returns {{ service: import('./types').Service, material: import('./types').Material | null, sharedWith: import('./types').Service[] }[]}
 */
export function editableProducts(ledger) {
  return ledger.services
    .filter((s) => !s.archived)
    .map((s) => {
      const material = s.materialId ? (ledger.materials.find((m) => m.id === s.materialId) ?? null) : null;
      return {
        service: s,
        material,
        /** Other active services that use the same stock item. */
        sharedWith: material
          ? ledger.services.filter((o) => o.id !== s.id && !o.archived && o.materialId === material.id)
          : [],
      };
    })
    .sort((a, b) => a.service.description.localeCompare(b.service.description));
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The events for one product edit.
 * changes: { name, price (kobo), renameStock, minimumStock, stock: { mode: 'none'|'add'|'set',
 * quantity, reason } }. Returns { events, summary } where summary lists what changes, in words.
 */
export function productEditEvents(ledger, serviceId, changes, actor, now = new Date().toISOString()) {
  const service = ledger.services.find((s) => s.id === serviceId && !s.archived);
  if (!service) throw Error('Choose an active product or service.');
  const material = service.materialId ? ledger.materials.find((m) => m.id === service.materialId) : null;
  if (material?.archived) throw Error('Its stock item is archived. Restore it on the Materials page first.');
  const name = String(changes.name ?? '').trim();
  if (!name) throw Error('Enter a name.');
  if (!Number.isSafeInteger(changes.price) || changes.price < 0)
    throw Error('Enter a price, with at most two decimal places.');
  const packs =
    changes.packPrices === undefined ? (service.packPrices ?? []) : validPackPrices(changes.packPrices);
  const packsChanged = JSON.stringify(packs) !== JSON.stringify(validPackPrices(service.packPrices ?? []));
  const audit = { modifiedBy: actor.id, modifiedByLabel: actor.label, modifiedAt: now };
  const events = [],
    summary = [];
  let working = ledger;
  const push = (event) => {
    working = applyEvent(working, event); // checks it exactly as saving will
    events.push(event);
  };
  if (name !== service.description || changes.price !== service.price || packsChanged) {
    push({
      id: crypto.randomUUID(),
      kind: 'service.updated',
      data: {
        id: service.id,
        baseVersion: service.version,
        description: name,
        materialId: service.materialId,
        price: changes.price,
        shelfItem: service.shelfItem ?? false,
        private: service.private ?? false,
        costing: service.costing ?? null,
        packPrices: packs,
        ...audit,
      },
    });
    if (name !== service.description) summary.push(`Rename “${service.description}” to “${name}”`);
    if (changes.price !== service.price) summary.push('Change the price');
    if (packsChanged) summary.push(packs.length ? 'Change the pack prices' : 'Remove the pack prices');
  }
  if (!material) {
    if (changes.stock && changes.stock.mode !== 'none') throw Error('This service has no stock item.');
    if (!events.length) throw Error('Nothing has changed.');
    return { events, summary };
  }
  const stockName = changes.renameStock ? name : material.name;
  const unit = changes.unit === undefined ? material.measurementUnit : String(changes.unit).trim();
  if (!unit || unit.length > 40) throw Error('Choose a unit.');
  const minimum = changes.minimumStock ?? material.minimumStock ?? 0;
  if (!Number.isFinite(minimum) || minimum < 0) throw Error('Minimum stock must be zero or more.');
  if (
    stockName !== material.name ||
    unit !== material.measurementUnit ||
    round3(minimum) !== (material.minimumStock ?? 0)
  ) {
    const current = working.materials.find((m) => m.id === material.id);
    push({
      id: crypto.randomUUID(),
      kind: 'material.updated',
      data: {
        id: material.id,
        baseVersion: current.version,
        name: stockName,
        available: current.available,
        measurementUnit: unit,
        requireSize: material.requireSize,
        minimumStock: round3(minimum),
        ...audit,
      },
    });
    if (stockName !== material.name)
      summary.push(`Rename the stock item “${material.name}” to “${stockName}”`);
    if (unit !== material.measurementUnit)
      summary.push(`Change the unit from ${material.measurementUnit} to ${unit}`);
    if (round3(minimum) !== (material.minimumStock ?? 0))
      summary.push(`Set minimum stock to ${round3(minimum)}`);
  }
  const stock = changes.stock ?? { mode: 'none' };
  if (stock.mode !== 'none') {
    const quantity = Number(stock.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || round3(quantity) !== quantity)
      throw Error('Enter a stock quantity with up to three decimal places.');
    if (stock.mode === 'add' && quantity === 0) throw Error('Enter a quantity greater than zero.');
    const reason = String(stock.reason ?? '').trim();
    if (!reason) throw Error('Give a reason for the stock change.');
    const current = working.materials.find((m) => m.id === material.id);
    if (stock.mode === 'add') {
      push({
        id: crypto.randomUUID(),
        kind: 'material.stock_added',
        data: { id: material.id, baseVersion: current.version, quantity, reason, ...audit },
      });
      summary.push(`Add ${quantity} ${unit} to stock (${round3(current.available + quantity)} after)`);
    } else if (stock.mode === 'set') {
      // A physical count, exactly as on the Materials page.
      push({
        id: crypto.randomUUID(),
        kind: 'material.stock_set',
        data: { id: material.id, baseVersion: current.version, quantity, reason, ...audit },
      });
      summary.push(`Set stock to ${quantity} ${unit} (was ${current.available})`);
    } else throw Error('Choose how to change the stock.');
  }
  if (!events.length) throw Error('Nothing has changed.');
  return { events, summary, after: working };
}
