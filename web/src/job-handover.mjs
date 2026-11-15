// Part orders: a job of many items (200 jotters) made and collected in batches. Production records
// how many are done so far; each handover records how many the customer took, who collected them
// and when, and prints a delivery note. The last handover closes the job (Completed → Collected).
// Payment stays per job; the business decides whether a handover needs that part paid first
// (options.handoverPayment: 'warn' or 'require'). The server applies the same rules
// (apply_job_handover_event); keep them in step.

const closed = ['Collected', 'Cancelled'];

/** Jobs that can be made and collected in parts: whole numbers of 2 or more items. */
export const partsAllowed = (job) =>
  Number.isInteger(job.quantity) && job.quantity >= 2 && !closed.includes(job.productionStatus ?? 'Added');

/**
 * Where a job stands: items in all, done so far, collected so far, ready to hand over now.
 * @param {import('./types').Job} job
 */
export function jobParts(job) {
  const total = Number.isInteger(job.quantity) ? Number(job.quantity) : 1;
  const handovers = job.progress?.handovers ?? [];
  const collected =
    job.productionStatus === 'Collected' ? total : handovers.reduce((sum, h) => sum + h.quantity, 0);
  const finished = ['Completed', 'Collected'].includes(job.productionStatus ?? 'Added');
  const done = finished ? total : Math.max(job.progress?.done ?? 0, collected);
  return { total, done, collected, ready: Math.max(0, done - collected), handovers, finished };
}

/** True when the job has any part progress worth showing on its card. */
export const hasParts = (job) =>
  !!job.progress && (job.progress.done > 0 || !!job.progress.handovers?.length);

/** Money a handover needs paid (kobo): the job's price for everything collected after it. */
export function paymentNeeded(job, paid, quantity) {
  const { total, collected } = jobParts(job);
  const due = Math.ceil((job.amount * (collected + quantity)) / total);
  return { due, short: Math.max(0, due - paid) };
}

/** The event recording how many are done so far. */
export function doneEvent(job, done, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: 'job.done_recorded',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      done,
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/** The event handing part of the job to the customer. */
export function handoverEvent(job, { quantity, collectedBy, note }, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: 'job.handed_over',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      handoverId: crypto.randomUUID(),
      quantity,
      collectedBy: String(collectedBy ?? '').trim(),
      note: String(note ?? '').trim(),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/** Why a handover of this many cannot happen now ('' when it can). Payment is checked apart. */
export function handoverProblem(job, quantity) {
  const parts = jobParts(job);
  if (!partsAllowed(job)) return 'This job cannot be handed over in parts.';
  if (job.hold) return 'This job is on hold. Resume it first.';
  if (!Number.isInteger(quantity) || quantity < 1) return 'Enter how many the customer is taking.';
  if (quantity > parts.ready)
    return parts.ready
      ? `Only ${parts.ready} ${parts.ready === 1 ? 'is' : 'are'} ready to hand over.`
      : 'Record how many are done first.';
  if (parts.collected + quantity >= parts.total && !parts.finished)
    return 'This hands over everything. Mark the job Completed first; the last handover then closes it.';
  return '';
}

/** Why "done so far" cannot be this number ('' when it can). */
export function doneProblem(job, done) {
  const parts = jobParts(job);
  if (!partsAllowed(job) || parts.finished) return 'This job is already finished.';
  if (!Number.isInteger(done) || done < 0 || done > parts.total)
    return `Enter a whole number from 0 to ${parts.total}.`;
  if (done < parts.collected) return `${parts.collected} are already collected.`;
  return '';
}

/** The event taking back the latest handover (admins and managers), with a reason. */
export function removeHandoverEvent(job, handoverId, reason, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: 'job.handover_removed',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      handoverId,
      reason: String(reason ?? '').trim(),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

/** Why this handover cannot be removed ('' when it can). Only the latest one, with a reason. */
export function removeProblem(job, handoverId, reason) {
  const list = job.progress?.handovers ?? [];
  if (job.productionStatus === 'Cancelled') return 'This job is cancelled.';
  if (!list.length || list[list.length - 1].id !== handoverId) return 'Only the latest handover can be removed.';
  const sum = list.reduce((total, h) => total + h.quantity, 0);
  if (job.productionStatus === 'Collected' && sum !== job.quantity)
    return 'This job was collected in full, not by handovers.';
  const why = String(reason ?? '').trim();
  if (!why || why.length > 200) return 'Give a short reason (up to 200 characters).';
  return '';
}

/**
 * Apply a done-so-far or handover event. The payment rule is checked on screen before saving and
 * by the server, which knows the business's setting.
 */
export function applyJobHandover(ledger, event) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  const progress = job.progress ?? { done: 0, handovers: [] };
  let next;
  if (event.kind === 'job.done_recorded') {
    const problem = doneProblem(job, d.done);
    if (problem) throw Error(problem);
    next = {
      ...job,
      progress: { ...progress, done: d.done, doneByLabel: d.modifiedByLabel, doneAt: d.modifiedAt },
    };
  } else if (event.kind === 'job.handed_over') {
    const problem = handoverProblem(job, d.quantity);
    if (problem) throw Error(problem);
    const who = String(d.collectedBy ?? '').trim(),
      note = String(d.note ?? '').trim();
    if (who.length > 80 || note.length > 300)
      throw Error('Keep the name to 80 and the note to 300 characters.');
    const { total, collected } = jobParts(job);
    const last = collected + d.quantity >= total;
    next = {
      ...job,
      progress: {
        ...progress,
        handovers: [
          ...progress.handovers,
          {
            id: d.handoverId,
            quantity: d.quantity,
            collectedBy: who,
            note,
            at: d.modifiedAt,
            byLabel: d.modifiedByLabel,
          },
        ].slice(-200),
      },
      ...(last ? { productionStatus: 'Collected', stageAt: d.modifiedAt, stageHeldMs: 0 } : {}),
    };
  } else if (event.kind === 'job.handover_removed') {
    const problem = removeProblem(job, d.handoverId, d.reason);
    if (problem) throw Error(problem);
    const gone = progress.handovers[progress.handovers.length - 1];
    const reopen = job.productionStatus === 'Collected';
    next = {
      ...job,
      progress: {
        ...progress,
        handovers: progress.handovers.slice(0, -1),
        removed: [
          ...(progress.removed ?? []),
          { ...gone, removedAt: d.modifiedAt, removedByLabel: d.modifiedByLabel, reason: String(d.reason).trim() },
        ].slice(-50),
      },
      ...(reopen ? { productionStatus: 'Completed', stageAt: d.modifiedAt, stageHeldMs: 0 } : {}),
    };
  } else throw Error('Unknown handover operation.');
  next = {
    ...next,
    version: (job.version ?? 1) + 1,
    modifiedBy: d.modifiedBy,
    modifiedByLabel: d.modifiedByLabel,
    modifiedAt: d.modifiedAt,
    lastEventId: event.id,
  };
  return { ...ledger, jobs: ledger.jobs.map((j) => (j.id === job.id ? next : j)) };
}
