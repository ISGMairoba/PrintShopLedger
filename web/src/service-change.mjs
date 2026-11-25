// Changing a sold job's service when a pricing template is involved (owner, 25 Nov): a normal service
// to a template, a template to a normal service, or one template to another (or the same template
// with new inputs). Allowed while its materials are not confirmed. Stock: either the job's stock is
// put right (what it took goes back, what the new service needs is taken, as stock changes dated
// now), or it is kept as it is because it was really used. The money follows the new amount; money
// already paid beyond it becomes the customer's credit. Normal-to-normal stays sale.details_corrected.
// The server does the same (private.change_job_service); keep them in step.
import { quoteCorrectedJob } from './full-corrections.mjs';
import { quoteTemplate } from './pricing-templates.mjs';
import { stockCountEvent } from './checkout.mjs';

// Left behind by the old service: its template, materials to confirm, and its checkout discount.
const TEMPLATE_KEYS = [
  'templateSnapshot',
  'templateInputs',
  'materialChoice',
  'materialCheck',
  'materialCorrection',
  'discount',
  'lineDiscount',
  'grossAmount',
];
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Whether this id is an active pricing template. */
export const isTemplate = (ledger, id) =>
  !!ledger.pricing?.enabled && !!ledger.pricing.templates.some((t) => t.id === id && !t.archived);

/** Why the job's service can't be changed now ('' when it can). */
export function serviceChangeBlocked(job) {
  if (job.productionStatus === 'Cancelled') return 'This sale is already cancelled.';
  if (job.materialUsed || job.materialCheck?.status === 'confirmed')
    return 'Its materials are confirmed. Cancel the job and add the right one.';
  return '';
}

/** The job as it would be with the new service or template. */
export function quoteServiceChange(ledger, job, d) {
  const blocked = serviceChangeBlocked(job);
  if (blocked) throw Error(blocked);
  if (!d.description?.trim() || d.description.trim().length > 500)
    throw Error('Enter a job description (up to 500 characters).');
  const base = Object.fromEntries(Object.entries(job).filter(([k]) => !TEMPLATE_KEYS.includes(k)));
  if (d.target === 'template') {
    if (!isTemplate(ledger, d.serviceId)) throw Error('This pricing template is unavailable.');
    const priced = quoteTemplate(ledger, {
      serviceId: d.serviceId,
      quantity: d.quantity,
      templateInputs: d.templateInputs,
      templateStockIds: d.stockIds,
    });
    if (d.templateSnapshot && JSON.stringify(d.templateSnapshot) !== JSON.stringify(priced.templateSnapshot))
      throw Error('Template price, costs, inputs or stock changed. Reopen the correction.');
    return {
      ...base,
      ...priced,
      serviceId: d.serviceId,
      quantity: d.quantity,
      description: d.description.trim(),
      stockCountEventId: null,
    };
  }
  const service = ledger.services.find((s) => s.id === d.serviceId);
  if (service && (service.materialOptions?.length ?? 0) > 0)
    throw Error(
      'A service with a choice of materials can’t be switched to. Cancel the job and add it again.',
    );
  const after = quoteCorrectedJob(ledger, { ...base, serviceId: d.serviceId }, d);
  return {
    ...after,
    stockCountEventId: after.materialId ? stockCountEvent(ledger, after.materialId) : null,
  };
}

/** What the new service takes of each material. */
function needs(job) {
  /** @type {Map<string, number>} */
  const out = new Map();
  for (const s of job.templateSnapshot?.stock ?? [])
    out.set(s.materialId, round3((out.get(s.materialId) ?? 0) + Number(s.quantity)));
  if (job.materialId && job.materialNeeded)
    out.set(job.materialId, round3((out.get(job.materialId) ?? 0) + job.materialNeeded));
  return out;
}

/**
 * Stock to put right: per material, what the job took less what the new service needs (positive:
 * goes back to stock). [] when the stock is kept as used.
 */
export function serviceChangePlan(ledger, job, after, mode) {
  if (!['reconcile', 'keep'].includes(mode))
    throw Error('Choose whether to correct the stock deduction or keep actual usage.');
  if (mode === 'keep') return [];
  const mine = ledger.materialHistory.filter(
    (h) =>
      h.jobId === job.id &&
      ['material.job_used', 'material.sale_returned', 'material.job_corrected'].includes(h.action),
  );
  const took = new Map();
  for (const h of mine)
    took.set(
      h.materialId,
      (took.get(h.materialId) ?? 0) + (h.beforeAvailable ?? h.afterAvailable) - h.afterAvailable,
    );
  const want = needs(after);
  const ids = [...new Set([...took.keys(), ...want.keys()])].sort();
  return ids
    .map((id) => {
      const used = round3(Math.max(0, took.get(id) ?? 0));
      const delta = round3(used - (want.get(id) ?? 0));
      if (delta > 0) {
        // Giving stock back after a stock count would count it twice.
        const first = mine.filter((h) => h.materialId === id).map((h) => Date.parse(h.changedAt));
        if (
          first.length &&
          ledger.materialHistory.some(
            (h) =>
              h.materialId === id &&
              h.action === 'material.stock_set' &&
              h.id !== job.stockCountEventId &&
              Date.parse(h.changedAt) >= Math.min(...first),
          )
        )
          throw Error(
            'A later stock count already reconciled this usage. Keep actual usage and current stock.',
          );
      }
      return { materialId: id, delta };
    })
    .filter((x) => x.delta !== 0);
}

/**
 * The sale.service_changed event. change: { target, serviceId, quantity, description, unitPrice,
 * width, height, materialId, templateInputs, stockMode, reason }.
 */
export function serviceChangeEvent(
  ledger,
  job,
  change,
  actor,
  expectedAccount,
  now = new Date().toISOString(),
) {
  const ids = new Set([
    ...ledger.materialHistory.filter((h) => h.jobId === job.id).map((h) => h.materialId),
    ...(change.target === 'template'
      ? ledger.materials.map((m) => m.id) // what the template takes is known once it is priced
      : change.materialId
        ? [change.materialId]
        : []),
  ]);
  const stockIds = Object.fromEntries([...ids].sort().map((m) => [m, crypto.randomUUID()]));
  const data = {
    jobId: job.id,
    baseVersion: job.version ?? 1,
    expectedAccount,
    reason: change.reason,
    modifiedBy: actor.id,
    modifiedByLabel: actor.label,
    modifiedAt: now,
    target: change.target,
    serviceId: change.serviceId,
    quantity: Number(change.quantity),
    description: change.description,
    stockMode: change.stockMode,
    ...(change.target === 'template'
      ? { templateInputs: change.templateInputs ?? {} }
      : {
          serviceVersion: ledger.services.find((s) => s.id === change.serviceId)?.version,
          materialId: change.materialId || undefined,
          unitPrice: change.unitPrice,
          width: Number(change.width ?? 1),
          height: Number(change.height ?? 1),
        }),
  };
  const after = quoteServiceChange(ledger, job, { ...data, stockIds });
  const plan = serviceChangePlan(ledger, job, after, data.stockMode);
  const used = new Set([
    ...plan.map((p) => p.materialId),
    ...(after.templateSnapshot?.stock ?? []).map((s) => s.materialId),
  ]);
  const keep = Object.fromEntries(Object.entries(stockIds).filter(([m]) => used.has(m)));
  return {
    id: crypto.randomUUID(),
    kind: 'sale.service_changed',
    data: {
      ...data,
      stockIds: keep,
      materialVersions: Object.fromEntries(
        Object.keys(keep).map((m) => [m, ledger.materials.find((x) => x.id === m)?.version ?? 1]),
      ),
      ...(change.target === 'template'
        ? {
            serviceVersion: after.serviceVersion,
            unitPrice: after.unitPrice,
            templateInputs: after.templateInputs,
            templateSnapshot: after.templateSnapshot,
            ...(after.materialChoice ? { materialChoice: after.materialChoice } : {}),
          }
        : {}),
    },
  };
}
