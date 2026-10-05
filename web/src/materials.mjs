export function normalizeLedger(ledger) {
  return { ...ledger, materials: ledger.materials ?? [] };
}
export function validateMaterial(data) {
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 160) throw new Error('Enter a material name (up to 160 characters).');
  if (typeof data.measurementUnit !== 'string' || !data.measurementUnit.trim() || data.measurementUnit.trim().length > 40) throw new Error('Enter a measurement unit (up to 40 characters).');
  if (typeof data.requireSize !== 'boolean') throw new Error('Require Size must be Yes or No.');
  if (typeof data.available !== 'number' || !Number.isFinite(data.available) || data.available < 0 || data.available > 1000000000000 ||
      Math.abs(data.available * 1000 - Math.round(data.available * 1000)) > 0.001) throw new Error('Available must be zero or greater, with at most three decimal places.');
}
export function applyMaterialEvent(input, event) {
  const ledger = normalizeLedger(input);
  const data = event.data;
  if (!event.id || !data.id || !data.modifiedBy || !data.modifiedAt || Number.isNaN(Date.parse(data.modifiedAt))) throw new Error('Material identity and audit information are required.');
  const existing = ledger.materials.find(material => material.id === data.id);
  if (existing?.lastEventId === event.id) return ledger;
  const audit = { modifiedBy: data.modifiedBy, modifiedByLabel: data.modifiedByLabel ?? data.modifiedBy, modifiedAt: data.modifiedAt, lastEventId: event.id };
  let next;
  if (event.kind === 'material.created') {
    if (existing) throw new Error('This material ID is already in use.');
    validateMaterial(data);
    next = { id: data.id, name: data.name.trim(), available: data.available, measurementUnit: data.measurementUnit.trim(), requireSize: data.requireSize,
      archived: false, version: 1, createdBy: data.modifiedBy, createdByLabel: audit.modifiedByLabel, createdAt: data.modifiedAt, ...audit };
    return { ...ledger, materials: [...ledger.materials, next] };
  }
  if (!existing) throw new Error('Material not found.');
  if (data.baseVersion !== existing.version) throw new Error('This material changed elsewhere. Sync and reopen it before editing.');
  if (event.kind === 'material.updated') {
    if (existing.archived) throw new Error('Restore this material before editing it.');
    validateMaterial(data);
    next = { ...existing, name: data.name.trim(), available: data.available, measurementUnit: data.measurementUnit.trim(), requireSize: data.requireSize, ...audit, version: existing.version + 1 };
  } else if (event.kind === 'material.archived' || event.kind === 'material.restored') {
    const archived = event.kind === 'material.archived';
    if (archived === existing.archived) throw new Error(archived ? 'Material is already archived.' : 'Material is already active.');
    next = { ...existing, archived, ...audit, version: existing.version + 1 };
  } else throw new Error('Unknown material operation.');
  return { ...ledger, materials: ledger.materials.map(material => material.id === data.id ? next : material) };
}
