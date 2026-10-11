import { resolveCatalogueState } from './catalogue-conflicts.mjs';
export function resolveServiceState(state, input, serviceId, choice, materialId, makeId, now) {
  return resolveCatalogueState(
    state,
    input,
    serviceId,
    'service',
    choice,
    (data) => ({ ...data, materialId: materialId === null ? null : materialId || data.materialId }),
    makeId,
    now,
  );
}
