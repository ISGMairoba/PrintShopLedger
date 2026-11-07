// Materials in production (services and pricing templates):
// * production.perItem: how much of the service's material one item uses (A2 lamination = 4 units
//   of "Lamination film (A4 units)"). Default 1.
// * production.extraMaterials: in production, staff may add any material from stock with the
//   amount used (paper bags: board, lamination, glue…). Stock moves at once; the price stays.
// * production.costCovered: the added materials' cost is already in the price (a template formula),
//   so it is not added to the job's cost again.
// The server applies the same rules (apply_service_event, apply_checkout_event,
// apply_job_extra_materials_event); keep them in step.
import { materialSnapshot } from './material-display.mjs';

const round3 = (n) => Math.round(n * 1000) / 1000;
export const MAX_EXTRA_MATERIALS = 30;

/**
 * The production settings to store for a service or template: only what differs from the
 * defaults. undefined keeps the existing value; null or {} clears it.
 * @returns {{ extraMaterials?: true, costCovered?: true, perItem?: number } | undefined}
 */
export function validProduction(value) {
  if (value === undefined) return undefined;
  if (value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid production settings.');
  for (const key of Object.keys(value))
    if (!['extraMaterials', 'costCovered', 'perItem'].includes(key))
      throw Error('Invalid production settings.');
  for (const key of ['extraMaterials', 'costCovered'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw Error('Invalid production settings.');
  const per = value.perItem ?? 1;
  if (typeof per !== 'number' || !(per > 0) || per > 10000 || round3(per) !== per)
    throw Error('Enter how much material one item uses: more than 0, up to three decimal places.');
  return {
    ...(value.extraMaterials ? { extraMaterials: true } : {}),
    ...(value.extraMaterials && value.costCovered ? { costCovered: true } : {}),
    ...(per !== 1 ? { perItem: per } : {}),
  };
}
/** How much of its material one item of a service uses. */
export const perItem = (service) => service?.production?.perItem ?? 1;

/** The production settings that apply to a job: its template's (as sold) or its service's (now). */
export function jobProduction(ledger, job) {
  if (job?.templateSnapshot) return job.templateSnapshot.template?.production ?? {};
  return ledger.services.find((s) => s.id === job?.serviceId)?.production ?? {};
}
/** Whether materials may be added to this job in production. */
export const acceptsExtraMaterials = (ledger, job) =>
  !!jobProduction(ledger, job).extraMaterials && !job.shelfItem;

/** The lowest rank that may add materials in production (Business Settings → Jobs & payments). */
export const extraMaterialsRank = (settings) => settings?.production?.extraMaterialsRank ?? 1;
export function validProductionSettings(value) {
  const rank = value?.extraMaterialsRank ?? 1;
  if (
    (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) ||
    Object.keys(value ?? {}).some((k) => k !== 'extraMaterialsRank') ||
    ![1, 2, 3].includes(rank)
  )
    throw Error('Invalid production settings.');
  return { extraMaterialsRank: rank };
}

/** Materials a job may not take as extras: its fixed material and its choice of materials. */
function ownMaterials(job) {
  return new Set(
    [
      job.materialId,
      ...(job.materialChoice?.options ?? []),
      ...(job.materialChoice?.groups ?? []).flatMap((g) => g.options),
      ...(job.templateSnapshot?.stock ?? []).map((s) => s.materialId),
    ].filter(Boolean),
  );
}
/**
 * The materials added to a job in production and how much of each (current totals).
 * @returns {{ materialId: string, quantity: number }[]}
 */
export const extraUsages = (job) => job?.extraMaterials?.usages ?? [];

/**
 * The event setting the materials added to a job: usages [{ materialId, quantity }], the new total
 * of each material (0 returns it all; a material left out stays as it is).
 * @returns {import('./types').JobExtraMaterialsEvent}
 */
export function extraMaterialsEvent(ledger, job, usages, actor, now = new Date().toISOString()) {
  const event = {
    id: crypto.randomUUID(),
    kind: 'job.extra_materials_set',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      usages: usages.map((u) => ({
        id: crypto.randomUUID(),
        materialId: u.materialId,
        quantity: round3(Number(u.quantity)),
      })),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
  applyJobExtraMaterials(ledger, event); // checks it exactly as saving will
  return /** @type {any} */ (event);
}

/** Apply job.extra_materials_set: move stock by the difference and record the totals on the job. */
export function applyJobExtraMaterials(ledger, event) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  if (!acceptsExtraMaterials(ledger, job)) throw Error('This job does not take added materials.');
  if (!Array.isArray(d.usages) || !d.usages.length || d.usages.length > MAX_EXTRA_MATERIALS)
    throw Error('Add the materials used.');
  const own = ownMaterials(job);
  const totals = new Map(extraUsages(job).map((u) => [u.materialId, u.quantity]));
  let materials = ledger.materials,
    history = ledger.materialHistory;
  const seen = new Set();
  for (const usage of d.usages) {
    if (!usage?.id || seen.has(usage.materialId)) throw Error('Add each material once.');
    seen.add(usage.materialId);
    if (own.has(usage.materialId))
      throw Error("This job's own material is recorded with the sale or its material confirmation.");
    const quantity = Number(usage.quantity);
    if (!(quantity >= 0) || quantity > 1000000000000 || round3(quantity) !== quantity)
      throw Error('Enter how much of each material was used (up to three decimal places).');
    const material = materials.find((m) => m.id === usage.materialId);
    if (!material) throw Error('Choose materials from this business.');
    const delta = round3(quantity - (totals.get(material.id) ?? 0));
    if (!delta) continue;
    if (delta > 0 && (material.archived || job.productionStatus === 'Cancelled'))
      throw Error(
        job.productionStatus === 'Cancelled'
          ? 'This job is cancelled: materials can only be returned.'
          : `${material.name} is archived.`,
      );
    const next = {
      ...material,
      available: round3(material.available - delta),
      version: material.version + 1,
      modifiedBy: d.modifiedBy,
      modifiedByLabel: d.modifiedByLabel,
      modifiedAt: d.modifiedAt,
      lastEventId: usage.id,
    };
    materials = materials.map((m) => (m.id === material.id ? next : m));
    history = [
      ...history,
      {
        id: usage.id,
        materialId: material.id,
        materialName: material.name,
        measurementUnit: material.measurementUnit,
        action: delta > 0 ? 'material.job_used' : 'material.job_corrected',
        beforeAvailable: material.available,
        afterAvailable: next.available,
        reason: `Job ${job.id} · material ${delta > 0 ? 'added' : 'returned'} in production`,
        jobId: job.id,
        checkoutId: job.checkoutId ?? null,
        changedBy: d.modifiedBy,
        changedByLabel: d.modifiedByLabel,
        changedAt: d.modifiedAt,
        before: materialSnapshot(material),
        after: materialSnapshot(next),
        detailsComplete: true,
      },
    ];
    totals.set(material.id, quantity);
  }
  const usages = [...totals]
    .filter(([, quantity]) => quantity > 0)
    .map(([materialId, quantity]) => ({ materialId, quantity }));
  if (usages.length > MAX_EXTRA_MATERIALS)
    throw Error(`Add at most ${MAX_EXTRA_MATERIALS} materials to a job.`);
  const next = {
    ...job,
    extraMaterials: {
      usages,
      ...(jobProduction(ledger, job).costCovered ? { costCovered: true } : {}),
      updatedBy: d.modifiedBy,
      updatedByLabel: d.modifiedByLabel,
      updatedAt: d.modifiedAt,
    },
    version: (job.version ?? 1) + 1,
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel,
    modifiedAt: d.modifiedAt,
    lastEventId: event.id,
  };
  return {
    ...ledger,
    materials,
    materialHistory: history,
    jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)),
  };
}

/**
 * The estimated cost (kobo) of the materials added to a job, from the costs linked to each material
 * (Pricing Templates → Costs). Materials with no linked cost are listed in `unpriced`.
 * @param {{ services: { materialId: string | null, archived?: boolean, costing?: { amount?: number, per?: number } | null }[] }} ledger
 */
export function extraMaterialsCost(ledger, usages) {
  let kobo = 0;
  const unpriced = [];
  for (const u of usages) {
    const costed = ledger.services.find(
      (s) => s.materialId === u.materialId && !s.archived && s.costing?.amount != null,
    );
    if (!costed) {
      unpriced.push(u.materialId);
      continue;
    }
    kobo += (u.quantity * costed.costing.amount) / (costed.costing.per || 1);
  }
  return { kobo: Math.round(kobo), unpriced };
}
