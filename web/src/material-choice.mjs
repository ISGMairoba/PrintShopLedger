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

/**
 * The items a job confirms materials for: its groups (a template using several items with a
 * choice of materials), or one group of all its options.
 * @returns {{ name: string, options: string[], unit: string | null, work: number }[]}
 */
export function choiceGroups(job) {
  const choice = job?.materialChoice;
  if (!choice) return [];
  return choice.groups ?? [{ name: '', options: choice.options, unit: null, work: choice.work }];
}

/** A suggested amount for a material: the job's size in material units (rounded). */
export const suggestedUsage = (job) => round3(job?.materialChoice?.work ?? 0);

/**
 * The event confirming the material(s) a choice job used.
 * usages: [{ materialId, quantity, group? }] — group: which item (a template job with several items
 * with a choice of materials; the same material may then be used for more than one item).
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
        ...(job.materialChoice?.groups ? { group: u.group } : {}),
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
  const groups = job.materialChoice.groups;
  const most = groups ? groups.reduce((n, g) => n + g.options.length, 0) : job.materialChoice.options.length;
  if (!Array.isArray(d.usages) || !d.usages.length || d.usages.length > most)
    throw Error('Choose the material or materials used.');
  const materials = ledger.materials.map((m) => ({ ...m })),
    history = [...ledger.materialHistory],
    seen = new Set();
  for (const usage of d.usages) {
    // With several items, each line names its item; a material may be used for more than one.
    if (groups) {
      const group = groups[usage.group];
      if (!Number.isInteger(usage.group) || !group || !group.options.includes(usage.materialId))
        throw Error('Choose a material linked to each item.');
    } else if ('group' in usage || !job.materialChoice.options.includes(usage.materialId))
      throw Error('Choose each material linked to this service at most once.');
    const key = `${usage.group ?? ''}:${usage.materialId}`;
    if (seen.has(key))
      throw Error(
        groups
          ? 'Choose each material once per item. To use more of one, raise its amount.'
          : 'Choose each material linked to this service at most once.',
      );
    seen.add(key);
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
  for (const [g, group] of (groups ?? []).entries())
    if (!d.usages.some((u) => u.group === g)) throw Error(`Confirm the material used for ${group.name}.`);
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

// ---- Corrections after the material was confirmed --------------------------------------------
// The stock a job really took is its recorded history (confirmed use, corrections, returns). A
// correction gives the new amount of each material really used; stock moves by the difference.
const USAGE_ACTIONS = ['material.job_used', 'material.sale_returned', 'material.job_corrected'];

/** How much of a material this job has taken from stock, net of returns and corrections. */
export function choiceUsed(ledger, jobId, materialId) {
  return Math.max(
    0,
    round3(
      ledger.materialHistory
        .filter((h) => h.jobId === jobId && h.materialId === materialId && USAGE_ACTIONS.includes(h.action))
        .reduce((n, h) => n + (h.beforeAvailable ?? h.afterAvailable) - h.afterAvailable, 0),
    ),
  );
}

/** The confirmed usage of each linked material, in link order (materials with none left out). */
export function currentChoiceUsages(ledger, job) {
  return (job.materialChoice?.options ?? [])
    .map((materialId) => ({ materialId, quantity: choiceUsed(ledger, job.id, materialId) }))
    .filter((u) => u.quantity > 0);
}

/**
 * The stock changes for new amounts used: usages [{ materialId, quantity }] (the new totals; a
 * material left out stays as it is). Returns [{ materialId, delta }]; a positive delta goes back
 * to stock. `returnsOnly`: when cancelling, nothing more can be taken.
 */
export function choiceUsagePlan(ledger, job, usages, returnsOnly = false) {
  if (!job.materialChoice) return [];
  if (!job.materialUsed)
    throw Error('The material for this job is not confirmed yet, so no stock was taken.');
  if (!Array.isArray(usages) || usages.length > job.materialChoice.options.length)
    throw Error('Enter how much of each material was really used.');
  const seen = new Set();
  const plan = [];
  for (const usage of usages) {
    if (!job.materialChoice.options.includes(usage?.materialId) || seen.has(usage.materialId))
      throw Error('Choose each material linked to this service at most once.');
    seen.add(usage.materialId);
    const target = Number(usage.quantity);
    if (!(target >= 0) || target > 1000000000000 || round3(target) !== target)
      throw Error('Enter how much of each material was really used (up to three decimal places).');
    const used = choiceUsed(ledger, job.id, usage.materialId),
      delta = round3(used - target);
    if (returnsOnly && delta < 0) throw Error('Returned stock cannot exceed recorded material usage.');
    if (!delta) continue;
    const first = ledger.materialHistory
      .filter(
        (h) =>
          h.jobId === job.id &&
          h.materialId === usage.materialId &&
          ['material.job_used', 'material.job_corrected'].includes(h.action),
      )
      .map((h) => Date.parse(h.changedAt));
    if (
      first.length &&
      ledger.materialHistory.some(
        (h) =>
          h.materialId === usage.materialId &&
          h.action === 'material.stock_set' &&
          Date.parse(h.changedAt) >= Math.min(...first),
      )
    )
      throw Error('A later stock count already reconciled this usage. Keep actual usage and current stock.');
    plan.push({ materialId: usage.materialId, delta });
  }
  return plan;
}

/**
 * Apply stock changes from a correction: each material moves by its delta, with a history entry.
 * ids and versions are per material (the stock event IDs and the material versions seen).
 */
export function applyStockDeltas(ledger, job, changes, ids, versions, audit, action) {
  let materials = ledger.materials,
    history = ledger.materialHistory;
  for (const change of changes) {
    const m = materials.find((x) => x.id === change.materialId),
      id = ids?.[change.materialId];
    if (!m || m.archived || versions?.[m.id] !== m.version || !id || history.some((h) => h.id === id))
      throw Error('Material changed. Sync and reopen the correction.');
    const next = {
      ...m,
      available: round3(m.available + change.delta),
      version: m.version + 1,
      modifiedBy: audit.changedBy,
      modifiedByLabel: audit.changedByLabel,
      modifiedAt: audit.changedAt,
      lastEventId: id,
    };
    materials = materials.map((x) => (x.id === m.id ? next : x));
    history = [
      ...history,
      {
        id,
        materialId: m.id,
        materialName: m.name,
        measurementUnit: m.measurementUnit,
        action,
        jobId: job.id,
        checkoutId: job.checkoutId ?? null,
        beforeAvailable: m.available,
        afterAvailable: next.available,
        reason: audit.reason,
        changedBy: audit.changedBy,
        changedByLabel: audit.changedByLabel,
        changedAt: audit.changedAt,
        before: materialSnapshot(m),
        after: materialSnapshot(next),
        detailsComplete: true,
      },
    ];
  }
  return { materials, materialHistory: history };
}
