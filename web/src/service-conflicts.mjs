import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
export function resolveServiceState(state, input, serviceId, choice, materialId, makeId, now) {
  const desired = state.ledger.services.find(item => item.id === serviceId);
  const pending = state.pending.filter(event => !(event.kind.startsWith('service.') && event.data.id === serviceId));
  let ledger = normalizeLedger(input);
  for (const event of pending) ledger = applyEvent(ledger, event);
  if (choice === 'local') {
    if (!desired) throw new Error('Local service is missing.');
    let current = ledger.services.find(item => item.id === serviceId);
    function append(kind, values = {}) {
      const event = { id: makeId(), kind, data: { id: serviceId, baseVersion: current?.version, modifiedBy: desired.modifiedBy,
        modifiedByLabel: desired.modifiedByLabel, modifiedAt: now, ...values } };
      ledger = applyEvent(ledger, event); pending.push(event); current = ledger.services.find(item => item.id === serviceId);
    }
    const values = { description: desired.description, price: desired.price, materialId: materialId === null ? null : materialId || desired.materialId };
    if (!current) append('service.created', values);
    else {
      if (current.archived) append('service.restored');
      append('service.updated', values);
    }
    if (desired.archived) append('service.archived');
  }
  return { ...state, ledger, pending };
}

