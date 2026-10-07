import { normalizeCustomer } from './customers.mjs';
import { materialSnapshot } from './material-display.mjs';
export function normalizeLedger(ledger) {
  return { ...ledger, expenses: ledger.expenses ?? [], expenseHistory: ledger.expenseHistory ?? [], drawerClosings: ledger.drawerClosings ?? [], checkouts: ledger.checkouts ?? [], customers: (ledger.customers ?? []).map(normalizeCustomer), materials: ledger.materials ?? [], materialHistory: ledger.materialHistory ?? [], services: ledger.services ?? [] };
}
export function validateMaterial(data) {
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 160) throw new Error('Enter a material name (up to 160 characters).');
  if (typeof data.measurementUnit !== 'string' || !data.measurementUnit.trim() || data.measurementUnit.trim().length > 40) throw new Error('Enter a measurement unit (up to 40 characters).');
  if (typeof data.requireSize !== 'boolean') throw new Error('Require Size must be Yes or No.');
  if (typeof data.available !== 'number' || !Number.isFinite(data.available) || data.available < -1000000000000 || data.available > 1000000000000 ||
      Math.abs(data.available * 1000 - Math.round(data.available * 1000)) > 0.001) throw new Error('Available must be within the supported range, with at most three decimal places.');
}
export function applyMaterialEvent(input, event) {
  const ledger = normalizeLedger(input);
  const data = event.data;
  if (!event.id || !data.id || !data.modifiedBy || !data.modifiedAt || Number.isNaN(Date.parse(data.modifiedAt))) throw new Error('Material identity and audit information are required.');
  if (ledger.materialHistory.some(entry => entry.id === event.id)) return ledger;
  const existing = ledger.materials.find(material => material.id === data.id);
  if (existing?.lastEventId === event.id) return ledger;
  const audit = { modifiedBy: data.modifiedBy, modifiedByLabel: data.modifiedByLabel ?? data.modifiedBy, modifiedAt: data.modifiedAt, lastEventId: event.id };
  const record = (next) => ({ id: event.id, materialId: next.id, materialName: next.name, measurementUnit: next.measurementUnit,
    action: event.kind, beforeAvailable: existing?.available ?? null, afterAvailable: next.available,
    reason: data.reason?.trim() ?? '', changedBy: next.modifiedBy, changedByLabel: next.modifiedByLabel, changedAt: next.modifiedAt,
    before: materialSnapshot(existing), after: materialSnapshot(next), detailsComplete: true });
  let next;
  if (event.kind === 'material.created') {
    if (existing) throw new Error('This material ID is already in use.');
    validateMaterial(data);
    next = { id: data.id, name: data.name.trim(), available: data.available, measurementUnit: data.measurementUnit.trim(), requireSize: data.requireSize,
      archived: false, version: 1, createdBy: data.modifiedBy, createdByLabel: audit.modifiedByLabel, createdAt: data.modifiedAt, ...audit };
    return { ...ledger, materials: [...ledger.materials, next], materialHistory: [...ledger.materialHistory, record(next)] };
  }
  if (!existing) throw new Error('Material not found.');
  if (data.baseVersion !== existing.version) throw new Error('This material changed elsewhere. Sync and reopen it before editing.');
  if (event.kind === 'material.updated') {
    if (existing.archived) throw new Error('Restore this material before editing it.');
    validateMaterial(data);
    next = { ...existing, name: data.name.trim(), available: existing.available, measurementUnit: data.measurementUnit.trim(), requireSize: data.requireSize, ...audit, version: existing.version + 1 };
  } else if (event.kind === 'material.stock_added' || event.kind === 'material.stock_set') {
    if (existing.archived) throw new Error('Restore this material before changing stock.');
    validateMaterial({ ...existing, available: data.quantity });
    if (event.kind === 'material.stock_added' && data.quantity <= 0) throw new Error('Enter a quantity greater than zero to add to stock.');
    if (data.reason && (typeof data.reason !== 'string' || data.reason.length > 500)) throw new Error('Stock note must be up to 500 characters.');
    const available = event.kind === 'material.stock_added' ? Math.round((existing.available + data.quantity) * 1000) / 1000 : data.quantity;
    validateMaterial({ ...existing, available });
    next = { ...existing, available, ...audit, version: existing.version + 1 };
  } else if (event.kind === 'material.archived' || event.kind === 'material.restored') {
    const archived = event.kind === 'material.archived';
    if (archived === existing.archived) throw new Error(archived ? 'Material is already archived.' : 'Material is already active.');
    next = { ...existing, archived, ...audit, version: existing.version + 1 };
  } else throw new Error('Unknown material operation.');
  return { ...ledger, materials: ledger.materials.map(material => material.id === data.id ? next : material), materialHistory: [...ledger.materialHistory, record(next)] };
}

