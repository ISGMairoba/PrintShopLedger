import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
export function resolveCustomerState(state, input, customerId, choice, makeId, now) {
  const desired = state.ledger.customers.find(item => item.id === customerId);
  const pending = state.pending.filter(event => !(event.kind.startsWith('customer.') && event.data.id === customerId));
  let ledger = normalizeLedger(input);
  for (const event of pending) ledger = applyEvent(ledger, event);
  if (choice === 'local') {
    if (!desired) throw new Error('Local customer is missing.');
    let current = ledger.customers.find(item => item.id === customerId);
    function append(kind, values = {}) {
      const event = { id: makeId(), kind, data: { id: customerId, baseVersion: current?.version, modifiedBy: desired.modifiedBy,
        modifiedByLabel: desired.modifiedByLabel, modifiedAt: now, ...values } };
      ledger = applyEvent(ledger, event); pending.push(event); current = ledger.customers.find(item => item.id === customerId);
    }
    const values = { name: desired.name, phone: desired.phone, address: desired.address, creditLimit: desired.creditLimit };
    if (!current) append('customer.created', values);
    else {
      if (current.archived) append('customer.restored');
      append('customer.updated', values);
    }
    if (desired.archived) append('customer.archived');
  }
  return { ...state, ledger, pending };
}
