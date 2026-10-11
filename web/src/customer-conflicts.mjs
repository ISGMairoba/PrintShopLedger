import { resolveCatalogueState } from './catalogue-conflicts.mjs';
export function resolveCustomerState(state, input, customerId, choice, makeId, now) {
  return resolveCatalogueState(state, input, customerId, 'customer', choice, (data) => data, makeId, now);
}
