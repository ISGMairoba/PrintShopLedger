// On hold: a job waiting on something (design approval, a balance payment, materials…). It stays
// at its stage; the stage clock stops until it is resumed. Anyone who can move jobs may hold and
// resume them. The server applies the same rules (apply_job_hold_event).

export const HOLD_REASONS = [
  'Waiting for design approval',
  'Waiting for balance payment',
  'Waiting for materials',
  'Customer not reachable',
  'Other',
];
const finished = ['Completed', 'Collected', 'Cancelled'];

/** The event putting a job on hold, or resuming it. */
export function holdEvent(job, hold, actor, now = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    kind: hold ? 'job.held' : 'job.resumed',
    data: {
      id: job.id,
      baseVersion: job.version ?? 1,
      ...(hold ? { reason: hold.reason, note: String(hold.note ?? '').trim() } : {}),
      modifiedBy: actor.id,
      modifiedByLabel: actor.label,
      modifiedAt: now,
    },
  };
}

export function applyJobHold(ledger, event) {
  const d = event.data;
  const job = ledger.jobs.find((j) => j.id === d.id);
  if (!job) throw Error('Job not found.');
  if (job.lastEventId === event.id) return ledger;
  if ((job.version ?? 1) !== d.baseVersion) throw Error('Job changed. Review the latest version.');
  let next;
  if (event.kind === 'job.held') {
    if (job.hold) throw Error('This job is already on hold.');
    if (finished.includes(job.productionStatus ?? 'Added')) throw Error('Only jobs still in production can be put on hold.');
    if (!HOLD_REASONS.includes(d.reason)) throw Error('Choose why the job is on hold.');
    const note = String(d.note ?? '').trim();
    if (note.length > 300) throw Error('Keep the note to 300 characters.');
    if (d.reason === 'Other' && !note) throw Error('Say what the job is waiting for.');
    next = {
      ...job,
      hold: { reason: d.reason, note, heldBy: d.modifiedBy, heldByLabel: d.modifiedByLabel, heldAt: d.modifiedAt, stage: job.productionStatus ?? 'Added' },
    };
  } else if (event.kind === 'job.resumed') {
    if (!job.hold) throw Error('This job is not on hold.');
    const { hold, ...rest } = job;
    const held = Math.max(0, Date.parse(d.modifiedAt) - Date.parse(hold.heldAt));
    next = {
      ...rest,
      // Time on hold at this stage does not count towards its time.
      stageHeldMs: (job.stageHeldMs ?? 0) + (hold.stage === (job.productionStatus ?? 'Added') ? held : 0),
      holdHistory: [
        ...(job.holdHistory ?? []),
        { ...hold, resumedBy: d.modifiedBy, resumedByLabel: d.modifiedByLabel, resumedAt: d.modifiedAt },
      ].slice(-50),
    };
  } else throw Error('Unknown hold operation.');
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
