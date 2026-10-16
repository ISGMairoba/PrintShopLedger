import { normalizeLedger } from './materials.mjs';
import { materialCode } from './material-display.mjs';
import { hasCost, validCosting } from './pricing-templates.mjs';
import { validPackPrices } from './pack-prices.mjs';
export const serviceCode = (id, services = []) => materialCode(id, services).replace('MAT-', 'SVC-');
export const servicePrice = (price) =>
  new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(price / 100);
export function serviceMatches(service, materials, services, query) {
  const material = materials.find((item) => item.id === service.materialId);
  return [
    service.description,
    service.id,
    serviceCode(service.id, services),
    service.materialId === null ? 'No material' : (material?.name ?? ''),
    material?.id ?? '',
    material ? materialCode(material.id, materials) : '',
    (service.price / 100).toFixed(2),
    servicePrice(service.price),
    service.shelfItem ? 'shelf' : '',
    service.private ? 'private templates only' : '',
    service.costing?.key ?? '',
  ]
    .join(' ')
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
export function validateService(data, ledger, existing) {
  if (
    typeof data.description !== 'string' ||
    !data.description.trim() ||
    data.description.trim().length > 500
  )
    throw new Error('Enter a service description (up to 500 characters).');
  if (!Number.isSafeInteger(data.price) || data.price < 0 || data.price > 100000000000)
    throw new Error('Price must be zero or greater, with at most two decimal places.');
  if (data.shelfItem !== undefined && typeof data.shelfItem !== 'boolean')
    throw new Error('Choose whether this is sold off the shelf.');
  if (data.private !== undefined && typeof data.private !== 'boolean')
    throw new Error('Choose whether this is used in templates only.');
  const packs = validPackPrices(data.packPrices);
  if (
    !!data.variantGroup !== !!data.variantName ||
    (data.variantName !== undefined &&
      data.variantName !== null &&
      (typeof data.variantName !== 'string' ||
        !data.variantName.trim() ||
        data.variantName.trim().length > 60))
  )
    throw new Error('Give each variant a name of up to 60 characters.');
  const costing = validCosting(data.costing);
  if (data.private && !hasCost(costing)) throw new Error('A templates-only item needs a template cost.');
  if (
    costing &&
    ledger.services.some((s) => s.id !== data.id && !s.archived && s.costing?.key === costing.key)
  )
    throw new Error(`The formula name "${costing.key}" is already used by another item.`);
  if (data.materialId === null) return;
  const material = ledger.materials.find((item) => item.id === data.materialId);
  if (!material) throw new Error('Choose a base material from this workspace.');
  if (material.requireSize && (data.packPrices === undefined ? existing?.packPrices?.length : packs.length))
    throw new Error('Pack prices are for items sold by count, not by size.');
  if (material.archived && existing?.materialId !== material.id)
    throw new Error('Choose an active base material.');
}
export function applyServiceEvent(input, event) {
  const ledger = normalizeLedger(input);
  const data = event.data;
  if (
    !event.id ||
    !data.id ||
    !data.modifiedBy ||
    !data.modifiedAt ||
    Number.isNaN(Date.parse(data.modifiedAt))
  )
    throw new Error('Service identity and audit information are required.');
  const existing = ledger.services.find((item) => item.id === data.id);
  if (existing?.lastEventId === event.id) return ledger;
  const audit = {
    modifiedBy: data.modifiedBy,
    modifiedByLabel: data.modifiedByLabel ?? data.modifiedBy,
    modifiedAt: data.modifiedAt,
    lastEventId: event.id,
  };
  if (event.kind === 'service.created') {
    if (existing) throw new Error('This service ID is already in use.');
    validateService(data, ledger);
    const next = {
      id: data.id,
      description: data.description.trim(),
      materialId: data.materialId,
      price: data.price,
      shelfItem: data.shelfItem ?? false,
      private: data.private ?? false,
      costing: validCosting(data.costing),
      packPrices: validPackPrices(data.packPrices),
      ...(data.variantGroup
        ? { variantGroup: data.variantGroup, variantName: String(data.variantName).trim() }
        : {}),
      archived: false,
      version: 1,
      createdBy: data.modifiedBy,
      createdByLabel: audit.modifiedByLabel,
      createdAt: data.modifiedAt,
      ...audit,
    };
    return { ...ledger, services: [...ledger.services, next] };
  }
  if (!existing) throw new Error('Service not found.');
  if (data.baseVersion !== existing.version)
    throw new Error('This service changed elsewhere. Sync and review the latest version.');
  let next;
  if (event.kind === 'service.updated') {
    if (existing.archived) throw new Error('Restore this service before editing it.');
    validateService(data, ledger, existing);
    next = {
      ...existing,
      description: data.description.trim(),
      materialId: data.materialId,
      price: data.price,
      shelfItem: data.shelfItem ?? existing.shelfItem ?? false,
      private: data.private ?? existing.private ?? false,
      costing: data.costing === undefined ? (existing.costing ?? null) : validCosting(data.costing),
      packPrices:
        data.packPrices === undefined ? (existing.packPrices ?? []) : validPackPrices(data.packPrices),
      ...audit,
      version: existing.version + 1,
    };
    // Joining or leaving a product's variants: null clears the link (left out keeps it).
    if (data.variantGroup !== undefined) {
      delete next.variantGroup;
      delete next.variantName;
      if (data.variantGroup)
        Object.assign(next, {
          variantGroup: data.variantGroup,
          variantName: String(data.variantName).trim(),
        });
    }
  } else if (event.kind === 'service.archived' || event.kind === 'service.restored') {
    const archived = event.kind === 'service.archived';
    if (existing.archived === archived)
      throw new Error(archived ? 'Service is already archived.' : 'Service is already active.');
    if (
      !archived &&
      existing.costing &&
      ledger.services.some(
        (s) => s.id !== existing.id && !s.archived && s.costing?.key === existing.costing.key,
      )
    )
      throw new Error(`Another item now uses the formula name "${existing.costing.key}". Rename one first.`);
    next = { ...existing, archived, ...audit, version: existing.version + 1 };
  } else throw new Error('Unknown service operation.');
  return { ...ledger, services: ledger.services.map((item) => (item.id === data.id ? next : item)) };
}

/** Services and products that can be sold: active and not templates-only. */
export const sellable = (services) => services.filter((s) => !s.archived && !s.private);
