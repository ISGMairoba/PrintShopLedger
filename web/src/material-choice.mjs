// Material choices: a service can link several compatible materials (2 ft, 5 ft and 10 ft banner
// rolls; 12", 18" and 24" laminating film) at one selling price. Nothing is taken from stock at
// the sale. When the job moves past the service's confirmation stage, staff confirm which
// material(s) were really used and how much, and only then is the stock deducted.
// The server applies the same rules (apply_checkout_event, apply_job_status_event,
// apply_job_material_event); keep them in step.
import { jobWorkflow } from './business-options.mjs';
import { materialSnapshot } from './material-display.mjs';
import { progressEvents } from './job-progress.mjs';

const round3 = (n) => Math.round(n * 1000) / 1000;
const DEFAULT_STAGE = 'Printing';

/** True when the service offers a choice of materials. */
export const hasMaterialChoice = (service) => !!service?.materialOptions?.length;

/** The material that decides how a service is sized: its fixed material, or its first choice. */
export function serviceMaterial(ledger, service) {
  if (!service) return undefined;
  const id = service.materialOptions?.length ? service.materialOptions[0] : service.materialId;
  return id ? ledger.materials.find((m) => m.id === id) : undefined;
}
/** The linked materials of a choice service, in the order they were linked. */
export function choiceMaterials(ledger, service) {
  return (service?.materialOptions ?? [])
    .map((id) => ledger.materials.find((m) => m.id === id))
    .filter(Boolean);
}

/**
 * Check a list of linked materials: 2–10, from this workspace, active (or already linked), and all
 * with the same unit and size rule. Returns the ids, or [] for none.
 * @param {import('./types').Ledger} ledger
 * @param {string[] | undefined} options
 * @param {string[]} [existing]
 */
export function validMaterialOptions(ledger, options, existing = []) {
  if (options === undefined || options === null || (Array.isArray(options) && !options.length)) return [];
  if (!Array.isArray(options) || options.length < 2 || options.length > 10)
    throw Error('Link 2 to 10 materials for a choice of materials.');
  const seen = new Set();
  let rule = null;
  for (const id of options) {
    const m = ledger.materials.find((item) => item.id === id);
    if (!m) throw Error('Choose materials from this workspace.');
    if (seen.has(id)) throw Error('A material is linked twice.');
    if (m.archived && !existing.includes(id)) throw Error('Choose active materials.');
    if (!rule) rule = { size: !!m.requireSize, unit: m.measurementUnit };
    else if (!!m.requireSize !== rule.size || m.measurementUnit !== rule.unit)
      throw Error('Linked materials must use the same unit and size rule (all by size, or all by count).');
    seen.add(id);
  }
  return [...options];
}

/** The stage a choice service confirms after (the business's own stage name). */
export function validConfirmStage(stage) {
  const value = String(stage ?? '').trim() || DEFAULT_STAGE;
  if (value.length > 80 || /[\x00-\x1f\x7f]/.test(value) || ['Collected', 'Cancelled'].includes(value))
    throw Error('Choose the stage after which the material is confirmed.');
  return value;
}

/** What a choice job stores at checkout (the server rebuilds and compares it). */
export function materialChoiceFor(service, work, planned) {
  return {
    options: [...service.materialOptions],
    confirmStage: service.confirmStage ?? DEFAULT_STAGE,
    work: round3(work),
    ...(planned && service.materialOptions.includes(planned) ? { plannedMaterialId: planned } : {}),
  };
}

/** Whether a choice job still needs its material confirmed. */
export const materialPending = (job) => !!job?.materialChoice && !job.materialUsed;

/**
 * Whether moving the job to `next` needs its material confirmed first: `next` lies beyond the
 * confirmation stage (or beyond the stage before Completed, if that stage is not in its workflow).
 */
export function materialConfirmDue(job, next) {
  if (!materialPending(job)) return false;
  const flow = jobWorkflow(job);
  const to = flow.indexOf(next);
  let at = flow.indexOf(job.materialChoice.confirmStage);
  if (at < 0) at = flow.indexOf('Completed') - 1;
  return to > at;
}

/** A suggested amount for a material: the job's size in material units (rounded). */
export const suggestedUsage = (job) => round3(job?.materialChoice?.work ?? 0);

/**
 * The event confirming the material(s) a choice job used.
 * usages: [{ materialId, quantity }]
 * @returns {import('./types').JobMaterialEvent}
 */
export function materialUsedEvent(ledger, job, usages, actor, now = new Date().toISOString()) {
  const event = {
    id: crypto.randomUUID(),
    kind: 'job.material_used',
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
  applyJobMaterial(ledger, event); // checks it exactly as saving will
  return /** @type {any} */ (event);
}

/** Apply a job.material_used event: record the usage on the job and take it from stock. */
export function applyJobMaterial(ledger, event) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if (!job.materialChoice) throw Error('This job does not need its material confirmed.');
  if (job.materialUsed) throw Error('The material for this job is already confirmed.');
  if (job.productionStatus === 'Cancelled') throw Error('This job is cancelled.');
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  if (!Array.isArray(d.usages) || !d.usages.length || d.usages.length > job.materialChoice.options.length)
    throw Error('Choose the material or materials used.');
  const materials = ledger.materials.map((m) => ({ ...m })),
    history = [...ledger.materialHistory],
    seen = new Set();
  for (const usage of d.usages) {
    if (!job.materialChoice.options.includes(usage.materialId) || seen.has(usage.materialId))
      throw Error('Choose each material linked to this service at most once.');
    seen.add(usage.materialId);
    const quantity = Number(usage.quantity);
    if (!(quantity > 0) || quantity > 1000000000000 || round3(quantity) !== quantity)
      throw Error('Enter how much of each material was used (up to three decimal places).');
    if (!usage.id) throw Error('Invalid material usage ID.');
    const material = materials.find((m) => m.id === usage.materialId);
    if (!material) throw Error('Material not found.');
    const before = materialSnapshot(material),
      previous = material.available,
      available = round3(material.available - quantity);
    Object.assign(material, {
      available,
      version: material.version + 1,
      modifiedBy: d.modifiedBy,
      modifiedByLabel: d.modifiedByLabel,
      modifiedAt: d.modifiedAt,
      lastEventId: usage.id,
    });
    history.push({
      id: usage.id,
      materialId: material.id,
      materialName: material.name,
      measurementUnit: material.measurementUnit,
      action: 'material.job_used',
      beforeAvailable: previous,
      afterAvailable: available,
      reason: `Job ${job.id} · material used, confirmed in production`,
      jobId: job.id,
      checkoutId: job.checkoutId ?? null,
      changedBy: d.modifiedBy,
      changedByLabel: d.modifiedByLabel,
      changedAt: d.modifiedAt,
      before,
      after: materialSnapshot(material),
      detailsComplete: true,
    });
  }
  const next = {
    ...job,
    materialUsed: {
      usages: d.usages,
      confirmedBy: d.modifiedBy,
      confirmedByLabel: d.modifiedByLabel,
      confirmedAt: d.modifiedAt,
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
 * The events to move a job to `target`: the material confirmation first when the move needs it
 * (usages must then be given), then each stage in order.
 * @param {any} ledger
 * @param {import('./types').Job} job
 * @param {string} target
 * @param {{ id: string, label: string }} actor
 * @param {{ materialId: string, quantity: number }[] | null} [usages]
 * @param {string} [now]
 * @returns {any[]}
 */
export function stageMoveEvents(ledger, job, target, actor, usages = null, now = new Date().toISOString()) {
  if (!materialConfirmDue(job, target)) return progressEvents(job, target, actor, now);
  if (!usages?.length) throw Error('Confirm the material used for this job before moving it on.');
  const confirm = materialUsedEvent(ledger, job, usages, actor, now);
  const after = { ...job, version: (job.version ?? 1) + 1, materialUsed: { usages: confirm.data.usages } };
  return [confirm, ...progressEvents(after, target, actor, now)];
}
