import { applyEvent } from './domain.mjs';

/** Build and validate a linked stock change and item save before persisting either. */
export function itemMaterialEvents(ledger, serviceEvent, draft) {
  const events = [];
  const audit = Object.fromEntries(
    ['modifiedBy', 'modifiedByLabel', 'modifiedAt'].map((key) => [key, serviceEvent.data[key]]),
  );
  const quantity = (value, label) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n < 0 || Math.abs(n * 1000 - Math.round(n * 1000)) > 0.000001)
      throw Error(`${label} must be zero or more, with up to three decimal places.`);
    return n;
  };
  if (draft) {
    const material = draft.id ? ledger.materials.find((m) => m.id === draft.id) : null;
    if (draft.id && (!material || material.archived)) throw Error('Choose an active base material.');
    if (material && serviceEvent.data.materialId !== material.id)
      throw Error('The base material has changed. Reopen its settings.');
    const name = String(draft.name || serviceEvent.data.description).trim();
    const unit = String(draft.unit || '').trim();
    if (!name) throw Error('Enter a material name.');
    if (!unit) throw Error('Choose a material unit.');
    const minimumStock = quantity(draft.minimum, 'Minimum stock');
    const materialId = material?.id ?? crypto.randomUUID();
    const requireSize = !!draft.requireSize;
    if (
      !material ||
      name !== material.name ||
      unit !== material.measurementUnit ||
      minimumStock !== (material.minimumStock ?? 0) ||
      requireSize !== material.requireSize
    ) {
      events.push({
        id: crypto.randomUUID(),
        kind: material ? 'material.updated' : 'material.created',
        data: {
          id: materialId,
          ...(material ? { baseVersion: material.version } : { reason: 'Opening stock' }),
          name,
          measurementUnit: unit,
          requireSize,
          minimumStock,
          available: material ? material.available : quantity(draft.quantity, 'Opening stock'),
          ...audit,
        },
      });
    }
    if (material && draft.mode !== 'none') {
      if (!['add', 'set'].includes(draft.mode)) throw Error('Choose how to change stock.');
      const amount = quantity(draft.quantity, 'Stock quantity');
      if (draft.mode === 'add' && amount === 0) throw Error('Enter a stock quantity greater than zero.');
      const reason = String(draft.reason || '').trim();
      if (!reason) throw Error('Give a reason for the stock change.');
      events.push({
        id: crypto.randomUUID(),
        kind: draft.mode === 'add' ? 'material.stock_added' : 'material.stock_set',
        data: {
          id: material.id,
          baseVersion: material.version + events.length,
          quantity: amount,
          reason,
          ...audit,
        },
      });
    }
    serviceEvent = { ...serviceEvent, data: { ...serviceEvent.data, materialId, materialOptions: [] } };
  }
  events.push(serviceEvent);
  events.reduce(applyEvent, ledger);
  return events;
}
