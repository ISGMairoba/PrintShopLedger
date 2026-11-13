// Materials check: every job that takes stock confirms, at its confirmation stage, what production
// really used. Each line the job took (its material, a template's stock lines, an item with a
// choice of materials) starts at the calculated amount; staff confirm it, change the amount, swap
// to another material of the same unit, or split it across several. Stock then moves by the
// difference from what the job has already taken (more used: taken; less: given back).
// * An Admin or higher confirms at once (mode "confirm").
// * Anyone else sends it for approval (mode "request"): nothing moves until an Admin confirms it,
//   as entered or changed. The job may move on meanwhile.
// The server applies the same rules (apply_job_check_event, private.job_check_lines,
// private.material_confirm_due); keep them in step.
import { materialSnapshot } from './material-display.mjs';

const round3 = (n) => Math.round(n * 1000) / 1000;
export const MAX_CHECK_USAGES = 60;
const OWN_ACTIONS = ['material.job_used', 'material.job_corrected', 'material.sale_returned'];

/** Whether a job confirms its materials in production. */
export const checksMaterials = (job) => !!job?.checkMaterials || !!job?.materialChoice;

/**
 * The lines a job confirms: what it took (or, for a choice of materials, what it is to take).
 * @returns {{ key: string, name: string, unit: string, expected: number, materialId: string | null, options: string[] | null }[]}
 */
export function checkLines(ledger, job) {
  if (!checksMaterials(job)) return [];
  const lines = [];
  const unitOf = (id) => ledger.materials.find((m) => m.id === id)?.measurementUnit ?? '';
  const nameOf = (id) => ledger.materials.find((m) => m.id === id)?.name ?? 'Material';
  const add = (materialId, quantity, unit) => {
    if (!materialId || !(quantity > 0)) return;
    const key = 'm:' + materialId;
    const line = lines.find((l) => l.key === key);
    if (line) line.expected = round3(line.expected + quantity);
    else
      lines.push({
        key,
        name: nameOf(materialId),
        unit: unit || unitOf(materialId),
        expected: round3(quantity),
        materialId,
        options: null,
      });
  };
  if (job.materialId) add(job.materialId, job.materialNeeded ?? 0, job.measurementUnit);
  for (const s of job.templateSnapshot?.stock ?? []) add(s.materialId, s.quantity, s.unit);
  const choice = job.materialChoice;
  if (choice) {
    const groups = choice.groups ?? [{ name: '', options: choice.options, unit: null, work: choice.work }];
    groups.forEach((g, i) =>
      lines.push({
        key: 'g:' + i,
        name: g.name || nameOf(choice.plannedMaterialId ?? g.options[0]),
        unit: g.unit ?? unitOf(g.options[0]),
        expected: round3(g.work),
        materialId: null,
        options: [...g.options],
      }),
    );
  }
  return lines;
}

/** The materials a line may be confirmed as: any active material measured in the same unit. */
export function lineOptions(ledger, line) {
  const same = ledger.materials.filter((m) => !m.archived && m.measurementUnit === line.unit);
  // The line's own materials first, then the rest by name.
  const own = new Set([line.materialId, ...(line.options ?? [])].filter(Boolean));
  return [
    ...same.filter((m) => own.has(m.id)),
    ...same.filter((m) => !own.has(m.id)).sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

/** A first draft: each line as calculated (a choice: its planned or first material). */
export function checkDraft(ledger, job) {
  const saved = job.materialCheck?.usages;
  if (saved?.length)
    return saved.map((u) => ({ line: u.line, materialId: u.materialId, quantity: String(u.quantity) }));
  return checkLines(ledger, job).map((l) => ({
    line: l.key,
    materialId: l.materialId ?? job.materialChoice?.plannedMaterialId ?? l.options?.[0] ?? '',
    quantity: String(l.expected),
  }));
}

/** How much of a material the job itself has taken from stock (not counting added materials). */
export function ownTaken(ledger, job, materialId) {
  const taken = ledger.materialHistory
    .filter((h) => h.jobId === job.id && h.materialId === materialId && OWN_ACTIONS.includes(h.action))
    .reduce((n, h) => n + (h.beforeAvailable ?? h.afterAvailable) - h.afterAvailable, 0);
  const extra = (job.extraMaterials?.usages ?? []).find((u) => u.materialId === materialId)?.quantity ?? 0;
  return round3(taken - extra);
}

/** The materials the job has taken itself (for the stock plan). */
function takenMaterials(ledger, job) {
  return [
    ...new Set(
      ledger.materialHistory
        .filter((h) => h.jobId === job.id && OWN_ACTIONS.includes(h.action))
        .map((h) => h.materialId),
    ),
  ];
}

/** Totals per material of a confirmation. */
function totals(usages) {
  const map = new Map();
  for (const u of usages) map.set(u.materialId, round3((map.get(u.materialId) ?? 0) + u.quantity));
  return map;
}

/** Stock moves for confirmed usages: [{ materialId, delta }] (delta > 0 takes more from stock). */
export function checkPlan(ledger, job, usages) {
  const sum = totals(usages);
  const ids = new Set([...sum.keys(), ...takenMaterials(ledger, job)]);
  return [...ids]
    .map((materialId) => ({
      materialId,
      delta: round3((sum.get(materialId) ?? 0) - Math.max(0, ownTaken(ledger, job, materialId))),
    }))
    .filter((p) => p.delta !== 0);
}

/** Check usages against the job's lines; returns them cleaned or throws a message to show. */
function validUsages(ledger, job, usages) {
  const lines = checkLines(ledger, job);
  if (!lines.length) throw Error('This job has no materials to confirm.');
  if (!Array.isArray(usages) || !usages.length || usages.length > MAX_CHECK_USAGES)
    throw Error('Enter the materials used.');
  const seen = new Set();
  for (const u of usages) {
    const line = lines.find((l) => l.key === u?.line);
    if (!line) throw Error('Enter the materials used for this job.');
    if (!u.id) throw Error('Invalid material usage ID.');
    const key = `${u.line}|${u.materialId}`;
    if (seen.has(key)) throw Error('Choose each material once per line. To use more of one, raise its amount.');
    seen.add(key);
    const quantity = Number(u.quantity);
    if (!(quantity >= 0) || quantity > 1000000000000 || round3(quantity) !== quantity)
      throw Error('Enter how much of each material was used (up to three decimal places).');
    const material = ledger.materials.find((m) => m.id === u.materialId);
    if (!material || material.archived) throw Error('Choose an active material for each line.');
    if (material.measurementUnit !== line.unit)
      throw Error(`${material.name} is measured in ${material.measurementUnit}; this line is in ${line.unit}.`);
  }
  for (const line of lines)
    if (!usages.some((u) => u.line === line.key)) throw Error(`Enter what was used for ${line.name}.`);
}

/**
 * The event confirming (Admin or higher) or sending for approval (others) the materials a job used.
 * usages: [{ line, materialId, quantity }].
 */
export function materialsCheckEvent(ledger, job, usages, actor, now = new Date().toISOString()) {
  const mode = (actor.level ?? 0) >= 2 ? 'confirm' : 'request';
  const clean = usages.map((u) => ({
    id: crypto.randomUUID(),
    line: u.line,
    materialId: u.materialId,
    quantity: round3(Number(u.quantity)),
  }));
  const stockIds =
    mode === 'confirm'
      ? Object.fromEntries(
          [...new Set([...clean.map((u) => u.materialId), ...takenMaterials(ledger, job)])].map((id) => [
            id,
            crypto.randomUUID(),
          ]),
        )
      : {};
  const event = {
    id: crypto.randomUUID(),
    kind: 'job.materials_checked',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      mode,
      usages: clean,
      ...(mode === 'confirm' ? { stockIds } : {}),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
  applyMaterialsCheck(ledger, event); // checks it exactly as saving will
  return event;
}

/** Apply job.materials_checked. */
export function applyMaterialsCheck(ledger, event) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  if (job.productionStatus === 'Cancelled') throw Error('This job is cancelled.');
  if (!['confirm', 'request'].includes(d.mode)) throw Error('Invalid materials check.');
  if (d.mode === 'request' && job.materialCheck?.status === 'confirmed')
    throw Error('The materials for this job are already confirmed. Ask an Admin to change them.');
  validUsages(ledger, job, d.usages);
  const audit = { by: d.modifiedBy, byLabel: d.modifiedByLabel, at: d.modifiedAt };
  if (d.mode === 'request') {
    const next = {
      ...job,
      materialCheck: {
        status: 'pending',
        usages: d.usages,
        requestedBy: audit.by,
        requestedByLabel: audit.byLabel,
        requestedAt: audit.at,
      },
      version: (job.version ?? 1) + 1,
      modifiedBy: audit.by,
      modifiedByLabel: audit.byLabel,
      modifiedAt: audit.at,
      lastEventId: event.id,
    };
    return { ...ledger, jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)) };
  }
  let materials = ledger.materials,
    history = ledger.materialHistory;
  for (const { materialId, delta } of checkPlan(ledger, job, d.usages)) {
    const m = materials.find((x) => x.id === materialId);
    const id = d.stockIds?.[materialId];
    if (!m) throw Error('Material not found.');
    if (!id || history.some((h) => h.id === id)) throw Error('Invalid stock change ID.');
    const after = {
      ...m,
      available: round3(m.available - delta),
      version: m.version + 1,
      modifiedBy: audit.by,
      modifiedByLabel: audit.byLabel,
      modifiedAt: audit.at,
      lastEventId: id,
    };
    materials = materials.map((x) => (x.id === m.id ? after : x));
    history = [
      ...history,
      {
        id,
        materialId: m.id,
        materialName: m.name,
        measurementUnit: m.measurementUnit,
        action: delta > 0 ? 'material.job_used' : 'material.job_corrected',
        beforeAvailable: m.available,
        afterAvailable: after.available,
        reason: `Job ${job.id} · materials confirmed in production`,
        jobId: job.id,
        checkoutId: job.checkoutId ?? null,
        changedBy: audit.by,
        changedByLabel: audit.byLabel,
        changedAt: audit.at,
        before: materialSnapshot(m),
        after: materialSnapshot(after),
        detailsComplete: true,
      },
    ];
  }
  const pending = job.materialCheck?.status === 'pending' ? job.materialCheck : null;
  const next = {
    ...job,
    materialCheck: {
      status: 'confirmed',
      usages: d.usages,
      ...(pending
        ? {
            requestedBy: pending.requestedBy,
            requestedByLabel: pending.requestedByLabel,
            requestedAt: pending.requestedAt,
          }
        : {}),
      confirmedBy: audit.by,
      confirmedByLabel: audit.byLabel,
      confirmedAt: audit.at,
    },
    ...(job.materialChoice && !job.materialUsed
      ? {
          materialUsed: {
            usages: d.usages.map((u) => ({ id: u.id, materialId: u.materialId, quantity: u.quantity })),
            confirmedBy: audit.by,
            confirmedByLabel: audit.byLabel,
            confirmedAt: audit.at,
          },
        }
      : {}),
    version: (job.version ?? 1) + 1,
    modifiedBy: audit.by,
    modifiedByLabel: audit.byLabel,
    modifiedAt: audit.at,
    lastEventId: event.id,
  };
  return {
    ...ledger,
    materials,
    materialHistory: history,
    jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)),
  };
}

/** Jobs whose materials wait for an Admin's approval, oldest first. */
export const pendingChecks = (ledger) =>
  ledger.jobs
    .filter((j) => j.materialCheck?.status === 'pending' && j.productionStatus !== 'Cancelled')
    .sort((a, b) => Date.parse(a.materialCheck.requestedAt) - Date.parse(b.materialCheck.requestedAt));
