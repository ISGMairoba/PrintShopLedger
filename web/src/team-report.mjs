// Reports → Team (plans/job-assignment.md): each person's work over a period — stages done, time per
// stage against its target, on time, rework, late recording and the value credited to them.
import { businessDay } from './dashboard.mjs';
import { personName, recordedLate, teamPeople, myWork, termsOf } from './team.mjs';

/** A person's part of one work record, 0 to 1 (percent of 100, or quantity of the job's). */
export function shareOf(record, job, personId) {
  const own = (record.shares ?? []).find((s) => s.personId === personId);
  if (!own) return 0;
  if (record.unit === 'quantity') {
    const total = job?.quantity > 0 ? job.quantity : record.shares.reduce((n, s) => n + s.share, 0);
    return total > 0 ? Math.min(1, own.share / total) : 0;
  }
  return own.share / 100;
}
const counted = (job) => ['Completed', 'Collected'].includes(job?.productionStatus ?? '');

/**
 * The Team report. Records count by their Done at (Lagos day), confirmed only unless
 * `includeRecorded`. A job's value is credited when it is Completed or Collected, split equally
 * between the people credited on it (each counted once, however many stages they did).
 */
export function teamReport(ledger, from, to, { includeRecorded = false } = {}) {
  const jobs = new Map((ledger.jobs ?? []).map((j) => [j.id, j]));
  const all = (ledger.workRecords ?? []).filter((r) => includeRecorded || r.status === 'confirmed');
  const inPeriod = all.filter((r) => {
    const day = businessDay(r.doneAt);
    return day >= from && day <= to;
  });
  // How long each stage took: from the job's previous stage record (or when it was added) to Done at.
  const byJob = new Map();
  for (const r of all) byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r]);
  const hoursFor = new Map();
  for (const [jobId, records] of byJob) {
    const job = jobs.get(jobId);
    const sorted = [...records].sort((a, b) => a.doneAt.localeCompare(b.doneAt));
    let start = job?.createdAt;
    for (const r of sorted) {
      if (start) hoursFor.set(r.id, Math.max(0, (Date.parse(r.doneAt) - Date.parse(start)) / 3600000));
      start = r.doneAt;
    }
  }
  const rows = new Map();
  const row = (personId) => {
    if (!rows.has(personId))
      rows.set(personId, {
        personId,
        name: personName(ledger, personId),
        stages: 0,
        share: 0,
        timed: 0,
        onTime: 0,
        hours: 0,
        rework: 0,
        late: 0,
        jobs: new Set(),
        countedJobs: 0,
        countedStages: 0,
        units: 0,
        value: 0,
        sold: 0,
      });
    return rows.get(personId);
  };
  for (const r of inPeriod) {
    const job = jobs.get(r.jobId);
    for (const s of r.shares ?? []) {
      const p = row(s.personId);
      p.stages += 1;
      p.share += shareOf(r, job, s.personId);
      // Pay per stage and per unit count only work on completed jobs.
      if (counted(job)) {
        p.countedStages += 1;
        p.units += r.unit === 'quantity' ? s.share : (job?.quantity ?? 1) * (s.share / 100);
      }
      p.jobs.add(r.jobId);
      if (recordedLate(r)) p.late += 1;
      const hours = hoursFor.get(r.id);
      const target = job?.stageHours?.[r.stage];
      if (hours !== undefined && target > 0) {
        p.timed += 1;
        p.hours += hours;
        if (hours <= target) p.onTime += 1;
      }
    }
    const responsible = r.redo?.responsibleId;
    if (responsible) row(responsible).rework += 1;
  }
  // Value: each counted job split equally between everyone credited on it (in the period).
  const credited = new Map();
  for (const r of inPeriod)
    for (const s of r.shares ?? [])
      credited.set(r.jobId, new Set([...(credited.get(r.jobId) ?? []), s.personId]));
  for (const [jobId, people] of credited) {
    const job = jobs.get(jobId);
    if (!counted(job) || !people.size) continue;
    const each = Math.floor(job.amount / people.size);
    for (const id of people) {
      row(id).value += each;
      row(id).countedJobs += 1;
    }
  }
  // Sales commission: jobs a person sold (added), sold in the period and since completed.
  for (const job of ledger.jobs ?? []) {
    const day = businessDay(job.createdAt);
    if (!job.createdBy || day < from || day > to || !counted(job)) continue;
    if (!termsOf(ledger, job.createdBy)?.salesRate) continue;
    row(job.createdBy).sold += job.amount;
  }
  for (const person of teamPeople(ledger))
    if (!rows.has(person.id) && myWork(ledger, person.id).length) row(person.id);
  const commissionOf = (p) => {
    const t = termsOf(ledger, p.personId);
    if (!t) return null;
    const work =
      t.kind === 'percent'
        ? Math.round((p.value * t.rate) / 100)
        : t.kind === 'perJob'
          ? p.countedJobs * t.rate
          : t.kind === 'perStage'
            ? p.countedStages * t.rate
            : t.kind === 'perUnit'
              ? Math.round(p.units * t.rate)
              : 0;
    return work + Math.round((p.sold * (t.salesRate ?? 0)) / 100);
  };
  const list = [...rows.values()]
    .map((p) => ({
      ...p,
      commission: commissionOf(p),
      units: Math.round(p.units * 100) / 100,
      jobs: p.jobs.size,
      assignedNow: myWork(ledger, p.personId).length,
      share: Math.round(p.share * 100) / 100,
      averageHours: p.timed ? Math.round((p.hours / p.timed) * 10) / 10 : null,
      onTimeRate: p.timed ? Math.round((p.onTime / p.timed) * 100) : null,
    }))
    .sort((a, b) => b.value - a.value || b.stages - a.stages || a.name.localeCompare(b.name));
  const vendors = inPeriod
    .filter((r) => r.vendor)
    .map((r) => ({
      id: r.id,
      jobId: r.jobId,
      stage: r.stage,
      name: r.vendor.name,
      cost: r.vendor.cost,
      doneAt: r.doneAt,
    }));
  return {
    from,
    to,
    rows: list,
    vendors,
    waiting: (ledger.workRecords ?? []).filter((r) => r.status !== 'confirmed').length,
  };
}

/** The report as sections for PDF and CSV. */
export function teamSections(report, { money, commission = false }) {
  return [
    {
      title: 'Team performance',
      columns: [
        'Person',
        'Assigned now',
        'Stages done',
        'Jobs',
        'Average hours per stage',
        'On time',
        'Rework caused',
        'Recorded late',
        'Value credited',
        ...(commission ? ['Sold', 'Commission due'] : []),
      ],
      numeric: [1, 2, 3, 4, 6, 7, 8, ...(commission ? [9, 10] : [])],
      rows: report.rows.map((r) => [
        r.name,
        r.assignedNow,
        r.stages,
        r.jobs,
        r.averageHours ?? '—',
        r.onTimeRate === null ? '—' : `${r.onTimeRate}%`,
        r.rework,
        r.late,
        money(r.value),
        ...(commission ? [money(r.sold), r.commission === null ? '—' : money(r.commission)] : []),
      ]),
    },
    ...(report.vendors.length
      ? [
          {
            title: 'Outside work',
            columns: ['Vendor', 'Stage', 'Done', 'Cost'],
            numeric: [3],
            rows: report.vendors.map((v) => [v.name, v.stage, businessDay(v.doneAt), money(v.cost)]),
          },
        ]
      : []),
  ];
}
