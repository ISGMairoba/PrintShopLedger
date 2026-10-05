import { applyEvent } from './domain.mjs';
// Resolve only the reviewed material; retain unrelated pending work.
export function resolveMaterialState(state, cloudLedger, materialId, choice, makeId, now) {
  const desired = state.ledger.materials.find(item => item.id === materialId);
  const pending = state.pending.filter(event => !(event.kind.startsWith('material.') && event.data.id === materialId));
  let ledger = cloudLedger;
  for (const event of pending) ledger = applyEvent(ledger, event);
  if (choice === 'local') {
    if (!desired) throw new Error('Local material is missing.');
    const remote = ledger.materials.find(item => item.id === materialId);
    if (!remote) throw new Error('The cloud material is missing. Please sync again.');
    function append(kind, values = {}) {
      const current = ledger.materials.find(item => item.id === materialId);
      const event = { id: makeId(), kind, data: { id: materialId, baseVersion: current.version,
        modifiedBy: desired.modifiedBy, modifiedByLabel: desired.modifiedByLabel, modifiedAt: now, ...values } };
      ledger = applyEvent(ledger, event); pending.push(event);
    }
    if (remote.archived) append('material.restored');
    append('material.updated', { name: desired.name, available: desired.available, measurementUnit: desired.measurementUnit, requireSize: desired.requireSize });
    if (desired.available !== remote.available) append('material.stock_set', { quantity: desired.available, reason: 'Reviewed conflicting stock changes' });
    if (desired.archived) append('material.archived');
  }
  return { ...state, ledger, pending };
}
