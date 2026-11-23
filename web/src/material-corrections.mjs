// Correcting confirmed materials (plans/job-assignment.md, owner's rule of 23 Nov). Once a job's
// materials are confirmed, a change is a correction with a reason:
// * saved at once by someone cleared to correct (Team work → correctRank, default Admin);
// * sent for approval otherwise; an entry recorded by a higher rank needs that rank or above;
// * a Manager correcting a higher rank's entry goes through, and whoever recorded it is told;
// * if a material was stock-counted since, it always needs an approver (someone else);
// * up to correctionDays (default 7) after the job is collected.
// Stock history is never rewritten: the difference is a new stock change dated today, linked to the job.
// The server applies the same rules (private.apply_job_material_correction_core); keep them in step.
import { materialSnapshot } from './material-display.mjs';
import { checkPlan, checkLines } from './material-check.mjs';
import { teamSettings } from './team.mjs';

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Who recorded the current usages, and their rank. */
export function entryOwner(ledger, job) {
  const mc = job.materialCheck;
  const id = mc?.recordedBy ?? mc?.requestedBy ?? mc?.confirmedBy ?? null;
  const rank =
    mc?.recordedByRank ??
    (ledger.teamPeople ?? []).find((p) => p.id === id && p.member)?.rank ??
    (ledger.teamPeople ?? []).find((p) => p.id === id)?.rank ??
    0;
  return { id, rank: rank ?? 0 };
}

/** Whether a material of the plan was stock-counted since the usages were last set. */
export function countedSince(ledger, job, usages) {
  const mc = job.materialCheck;
  const since = mc?.correctedAt ?? mc?.confirmedAt ?? '';
  const ids = new Set(checkPlan(ledger, job, usages).map((p) => p.materialId));
  return ledger.materialHistory.some(
    (h) => h.action === 'material.stock_set' && ids.has(h.materialId) && h.changedAt > since,
  );
}

/** When the window has closed: the date it closed, or null while open. */
export function windowClosed(job, settings, now = Date.now()) {
  if (job.productionStatus !== 'Collected') return null;
  const days = teamSettings(settings).correctionDays;
  const from = Date.parse(job.stageAt ?? job.modifiedAt ?? '') || now;
  return from < now - days * 86400000 ? days : null;
}

/**
 * How a correction goes: 'direct' (saved at once), 'request' (for approval) or 'alert' (a Manager
 * correcting a higher rank's entry: saved, and whoever recorded it is told). counted: stock was counted since.
 */
export function materialRoute(ledger, job, actor, settings, counted) {
  const { correctRank } = teamSettings(settings);
  const level = actor.level ?? 0;
  const owner = entryOwner(ledger, job).rank;
  if (counted) return 'request';
  if (owner > level && level === 3 && level >= correctRank) return 'alert';
  if (owner > level) return 'request';
  return level >= correctRank ? 'direct' : 'request';
}

/** Whether this person can decide a pending correction. */
export const canDecide = (request, actor) =>
  !!request && (actor.level ?? 0) >= request.approverRank && request.requestedBy !== actor.id;

/** Whether the confirmed materials can be corrected now (else the message to show). */
export function correctionBlocked(job, settings) {
  if (job.materialCheck?.status !== 'confirmed') return 'Only confirmed materials are corrected.';
  if (job.productionStatus === 'Cancelled') return 'This job is cancelled.';
  if (job.materialCorrection) return 'A correction of these materials is waiting for approval.';
  const days = windowClosed(job, settings);
  if (days !== null) return `Materials can be corrected up to ${days} days after the job is collected.`;
  return '';
}

const stockIdsFor = (ledger, job, usages) =>
  Object.fromEntries(checkPlan(ledger, job, usages).map((p) => [p.materialId, crypto.randomUUID()]));
const sameUsages = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The correction of a job's confirmed materials. usages: [{ line, materialId, quantity }]. */
export function materialCorrectionEvent(
  ledger,
  job,
  usages,
  reason,
  actor,
  settings,
  now = new Date().toISOString(),
) {
  const clean = usages.map((u) => ({
    id: crypto.randomUUID(),
    line: u.line,
    materialId: u.materialId,
    quantity: round3(Number(u.quantity)),
  }));
  const counted = countedSince(ledger, job, clean);
  const route = materialRoute(ledger, job, actor, settings, counted);
  const event = {
    id: crypto.randomUUID(),
    kind: 'job.materials_corrected',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      requestId: crypto.randomUUID(),
      route,
      reason: reason.trim(),
      usages: clean,
      ...(route === 'request' ? {} : { stockIds: stockIdsFor(ledger, job, clean) }),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedByRank: actor.level,
      counted,
      modifiedAt: now,
    },
  };
  applyMaterialCorrection(ledger, event, settings); // checks it exactly as saving will
  return event;
}

/** Approving or declining a pending correction. */
export function materialDecisionEvent(ledger, job, approve, note, actor, now = new Date().toISOString()) {
  const request = job.materialCorrection;
  if (!request) throw Error('This request is not waiting for a decision.');
  const event = {
    id: crypto.randomUUID(),
    kind: 'job.material_correction_decided',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      requestId: request.id,
      approve,
      note: note ?? '',
      ...(approve ? { stockIds: stockIdsFor(ledger, job, request.usages) } : {}),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedByRank: actor.level,
      modifiedAt: now,
    },
  };
  applyMaterialCorrection(ledger, event);
  return event;
}

/** Moves stock by the difference, as new stock changes linked to the job. */
function moveStock(ledger, job, usages, stockIds, reason, by) {
  let materials = ledger.materials,
    history = ledger.materialHistory;
  for (const { materialId, delta } of checkPlan(ledger, job, usages)) {
    const m = materials.find((x) => x.id === materialId);
    const id = stockIds?.[materialId];
    if (!m) throw Error('Material not found.');
    if (!id || history.some((h) => h.id === id)) throw Error('Invalid stock change ID.');
    const after = {
      ...m,
      available: round3(m.available - delta),
      version: m.version + 1,
      modifiedBy: by.id,
      modifiedByLabel: by.label,
      modifiedAt: by.at,
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
        reason: `Correction: ${Math.abs(delta)} ${m.measurementUnit} ${delta > 0 ? 'more' : 'fewer'} used on job #${job.id.slice(0, 8).toUpperCase()} · ${reason}`,
        jobId: job.id,
        checkoutId: job.checkoutId ?? null,
        changedBy: by.id,
        changedByLabel: by.label,
        changedAt: by.at,
        before: materialSnapshot(m),
        after: materialSnapshot(after),
        detailsComplete: true,
      },
    ];
  }
  return { materials, materialHistory: history };
}

/** Apply job.materials_corrected or job.material_correction_decided on this device. */
export function applyMaterialCorrection(ledger, event, settings) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  if (job.productionStatus === 'Cancelled') throw Error('This job is cancelled.');
  const mc = job.materialCheck;
  if (mc?.status !== 'confirmed') throw Error('Only confirmed materials are corrected.');
  const at = d.modifiedAt;
  const bump = (fields) => ({
    ...job,
    ...fields,
    version: (job.version ?? 1) + 1,
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel,
    modifiedAt: at,
    lastEventId: event.id,
  });
  const put = (next, extra = {}) => ({
    ...ledger,
    ...extra,
    jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)),
  });
  let usages, entry, by;
  if (event.kind === 'job.materials_corrected') {
    const blocked = correctionBlocked(job, settings);
    if (blocked) throw Error(blocked);
    if (!d.reason || d.reason.trim().length < 3 || d.reason.length > 300)
      throw Error('Give a reason for the correction.');
    validate(ledger, job, d.usages);
    if (sameUsages(d.usages.map(strip), mc.usages.map(strip)))
      throw Error('Change at least one amount or material.');
    if (d.route === 'request') {
      const owner = entryOwner(ledger, job);
      return put(
        bump({
          materialCorrection: {
            id: d.requestId,
            usages: d.usages,
            before: mc.usages,
            reason: d.reason,
            requestedBy: d.modifiedBy,
            requestedByLabel: d.modifiedByLabel,
            requestedByRank: d.modifiedByRank,
            requestedAt: at,
            approverRank: Math.max(teamSettings(settings).correctRank, owner.rank),
            counted: !!d.counted,
          },
        }),
      );
    }
    usages = d.usages;
    by = { id: d.modifiedBy, label: d.modifiedByLabel, rank: d.modifiedByRank };
    entry = {
      id: d.requestId,
      status: 'applied',
      at,
      by: by.id,
      byLabel: by.label,
      byRank: by.rank,
      reason: d.reason,
      before: mc.usages,
      after: usages,
      alert: d.route === 'alert',
      ...(d.route === 'alert' ? { alertFor: entryOwner(ledger, job).id } : {}),
    };
  } else {
    const req = job.materialCorrection;
    if (!req || req.id !== d.requestId) throw Error('This request is not waiting for a decision.');
    if (!canDecide(req, { id: d.modifiedBy, level: d.modifiedByRank }))
      throw Error(
        req.requestedBy === d.modifiedBy
          ? 'Someone else decides your own correction.'
          : 'This correction needs someone of a higher rank.',
      );
    const record = {
      id: req.id,
      at: req.requestedAt,
      by: req.requestedBy,
      byLabel: req.requestedByLabel,
      byRank: req.requestedByRank,
      reason: req.reason,
      before: req.before,
      after: req.usages,
    };
    if (!d.approve) {
      const next = bump({
        materialCheck: {
          ...mc,
          corrections: [
            ...(mc.corrections ?? []),
            {
              ...record,
              status: 'declined',
              decidedBy: d.modifiedBy,
              decidedByLabel: d.modifiedByLabel,
              decidedAt: at,
              note: (d.note ?? '').trim(),
            },
          ],
        },
      });
      delete next.materialCorrection;
      return put(next);
    }
    if (!sameUsages(req.before, mc.usages))
      throw Error('The materials changed after this request. Decline it and ask again.');
    usages = req.usages;
    by = { id: req.requestedBy, label: req.requestedByLabel, rank: req.requestedByRank };
    entry = {
      ...record,
      status: 'applied',
      counted: !!req.counted,
      approvedBy: d.modifiedBy,
      approvedByLabel: d.modifiedByLabel,
      approvedAt: at,
      alert: false,
    };
  }
  const stock = moveStock(ledger, job, usages, d.stockIds, entry.reason, {
    id: d.modifiedBy,
    label: d.modifiedByLabel,
    at,
  });
  const next = bump({
    materialCheck: {
      ...mc,
      usages,
      recordedBy: by.id,
      recordedByLabel: by.label,
      recordedByRank: by.rank,
      correctedAt: at,
      corrections: [...(mc.corrections ?? []), entry],
    },
    ...(job.materialChoice && job.materialUsed
      ? {
          materialUsed: {
            ...job.materialUsed,
            usages: usages.map((u) => ({ id: u.id, materialId: u.materialId, quantity: u.quantity })),
          },
        }
      : {}),
  });
  delete next.materialCorrection;
  return put(next, stock);
}

const strip = (u) => ({ line: u.line, materialId: u.materialId, quantity: u.quantity });

/** The corrected usages must cover the job's lines with active materials of the right unit. */
function validate(ledger, job, usages) {
  const lines = checkLines(ledger, job);
  if (!Array.isArray(usages) || !usages.length || usages.length > 60)
    throw Error('Enter the materials used.');
  const seen = new Set();
  for (const u of usages) {
    const line = lines.find((l) => l.key === u.line);
    if (!line) throw Error('Enter the materials used for this job.');
    const key = `${u.line}|${u.materialId}`;
    if (seen.has(key))
      throw Error('Choose each material once per line. To use more of one, raise its amount.');
    seen.add(key);
    if (!(u.quantity >= 0) || u.quantity > 1000000000000 || round3(u.quantity) !== u.quantity)
      throw Error('Enter how much of each material was used (up to three decimal places).');
    const m = ledger.materials.find((x) => x.id === u.materialId);
    if (!m || m.archived) throw Error('Choose an active material for each line.');
    if (m.measurementUnit !== line.unit)
      throw Error(`${m.name} is measured in ${m.measurementUnit}; this line is in ${line.unit}.`);
  }
  for (const line of lines)
    if (!usages.some((u) => u.line === line.key)) throw Error(`Enter what was used for ${line.name}.`);
}

/** Jobs with a material correction waiting, oldest first. */
export const pendingMaterialCorrections = (ledger) =>
  ledger.jobs
    .filter((j) => j.materialCorrection && j.productionStatus !== 'Cancelled')
    .sort((a, b) =>
      (a.materialCorrection.requestedAt ?? '').localeCompare(b.materialCorrection.requestedAt ?? ''),
    );

/** Manager corrections of this person's materials entries (they are told), newest first. */
export function materialCorrectionAlerts(ledger, userId, since = '') {
  return ledger.jobs
    .flatMap((job) =>
      (job.materialCheck?.corrections ?? [])
        .filter((c) => c.alert && c.alertFor === userId && (c.at ?? '') > since)
        .map((c) => ({ job, c })),
    )
    .sort((a, b) => (b.c.at ?? '').localeCompare(a.c.at ?? ''));
}

/** "Paper 12 sheet, Card 2 sheet": usages in words. */
export function usagesText(ledger, usages) {
  return (
    (usages ?? [])
      .filter((u) => u.quantity > 0)
      .map((u) => {
        const m = ledger.materials.find((x) => x.id === u.materialId);
        return `${m?.name ?? 'Material'} ${u.quantity.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${m?.measurementUnit ?? ''}`.trim();
      })
      .join(', ') || 'nothing'
  );
}
