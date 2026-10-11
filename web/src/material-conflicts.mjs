import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
// Reapply reviewed operations in their original order. Detail edits must not
// turn concurrent sales or deliveries into absolute stock replacements.
export function resolveMaterialState(state, cloudLedger, materialId, choice, makeId, now) {
  let ledger = normalizeLedger(cloudLedger);
  const pending = [],
    countIds = new Map();
  function append(kind, data) {
    const current = ledger.materials.find((item) => item.id === materialId);
    const event = {
      id: makeId(),
      kind,
      data: { ...data, id: materialId, baseVersion: current?.version, modifiedAt: now },
    };
    ledger = applyEvent(ledger, event);
    pending.push(event);
    return event;
  }
  for (const original of state.pending) {
    if (!original.kind.startsWith('material.') || original.data.id !== materialId) {
      const event =
        original.kind === 'checkout.completed'
          ? {
              ...original,
              data: {
                ...original.data,
                jobs: original.data.jobs.map((job) =>
                  countIds.has(job.stockCountEventId)
                    ? { ...job, stockCountEventId: countIds.get(job.stockCountEventId) }
                    : job,
                ),
              },
            }
          : original;
      ledger = applyEvent(ledger, event);
      pending.push(event);
      continue;
    }
    if (choice === 'cloud') continue;
    let current = ledger.materials.find((item) => item.id === materialId);
    if (original.kind === 'material.created') {
      if (current)
        throw Error(
          'This material already exists in the business. Keep the business version and edit it again.',
        );
      append(original.kind, original.data);
      continue;
    }
    if (!current) throw Error('The business material no longer exists. Keep the business version.');
    if (
      ['material.updated', 'material.stock_added', 'material.stock_set'].includes(original.kind) &&
      current.archived
    ) {
      append('material.restored', original.data);
      current = ledger.materials.find((item) => item.id === materialId);
    }
    if (
      (original.kind === 'material.archived' && current.archived) ||
      (original.kind === 'material.restored' && !current.archived)
    )
      continue;
    const rebased = append(
      original.kind,
      original.kind === 'material.updated'
        ? { ...original.data, available: current.available }
        : original.data,
    );
    if (original.kind === 'material.stock_set') countIds.set(original.id, rebased.id);
  }
  return { ...state, ledger, pending };
}
