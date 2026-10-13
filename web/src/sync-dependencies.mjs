import { applyEvent } from './domain.mjs';
import { normalizeLedger } from './materials.mjs';
export function eventResources(event, ledger) {
  const d = event.data,
    result = new Set(),
    add = (kind, id) => {
      if (id) result.add(kind + ':' + id);
    };
  const family = event.kind.split('.')[0];
  if (event.kind === 'checkout.completed') {
    add('customer', d.customerId);
    add('checkout', event.id);
    for (const job of d.jobs) {
      add('job', job.id);
      add('service', job.serviceId);
      add('material', job.materialId);
      for (const r of job.templateSnapshot?.references ?? []) add('service', r.serviceId);
      for (const s of job.templateSnapshot?.stock ?? []) {
        add('service', s.serviceId);
        add('material', s.materialId);
      }
      add('material', ledger.services.find((s) => s.id === job.serviceId)?.materialId);
    }
    for (const item of d.allocations ?? []) add('job', item.jobId);
  } else if (event.kind === 'material.wasted') {
    add('material', d.materialId);
    add('job', d.jobId);
  } else if (family === 'sale') {
    add('job', d.jobId);
    const job = ledger.jobs.find((j) => j.id === d.jobId);
    add('customer', job?.customerId);
    add('material', job?.materialId);
  } else if (family === 'material') add('material', d.id);
  else if (family === 'service') {
    add('service', d.id);
    add('material', d.materialId);
    add('material', ledger.services.find((s) => s.id === d.id)?.materialId);
  } else if (event.kind === 'customer.reminded') add('reminder', d.id);
  else if (family === 'customer') add('customer', d.id);
  else if (family === 'quotation') add('quotation', d.id);
  else if (family === 'expense') {
    add('expense', d.id);
    for (const item of [
      ...(d.materials ?? []),
      ...(ledger.expenses.find((e) => e.id === d.id)?.materials ?? []),
    ])
      add('material', item.materialId);
  } else if (family === 'job') {
    add('job', d.id);
    const job = ledger.jobs.find((j) => j.id === d.id);
    add('customer', job?.customerId ?? d.customerId);
    add('material', job?.materialId ?? d.materialId);
    add('service', job?.serviceId ?? d.serviceId);
  } else if (family === 'payment') {
    add('customer', d.customerId);
    for (const item of d.allocations ?? []) add('job', item.jobId);
  } else result.add('*');
  return result;
}
export function overlaps(a, b) {
  return a.has('*') || b.has('*') || [...a].some((key) => b.has(key));
}
export function blockedWork(state) {
  const roots = new Set(Object.keys(state.syncConflicts ?? {})),
    resources = new Set(),
    eventIds = new Set();
  for (const event of state.pending) {
    const keys = eventResources(event, state.ledger);
    if (roots.has(event.id) || overlaps(keys, resources)) {
      eventIds.add(event.id);
      for (const key of keys) {
        if (
          event.kind === 'checkout.completed' &&
          key.startsWith('service:') &&
          !/service|price/i.test(state.syncConflicts?.[event.id] ?? '')
        )
          continue;
        resources.add(key);
      }
    }
  }
  return { resources, eventIds };
}
export function assertIndependent(state, event) {
  if (overlaps(eventResources(event, state.ledger), blockedWork(state).resources))
    throw Error(
      'This job uses stock, a service or a customer account awaiting Admin review. Choose unaffected records or wait for the review.',
    );
}
// Show saved offline work without applying a disputed deduction to the current cloud count.
// Only disputed resources use the local projection; independent records use current cloud data.
export function projectPending(cloud, state) {
  let ledger = normalizeLedger(cloud);
  const blocked = blockedWork(state);
  for (const event of state.pending) if (!blocked.eventIds.has(event.id)) ledger = applyEvent(ledger, event);
  const has = (kind, id) => blocked.resources.has(kind + ':' + id) || blocked.resources.has('*');
  const overlay = (name, kind) => {
    const local = state.ledger[name].filter((item) => has(kind, item.id));
    const ids = new Set(local.map((item) => item.id));
    ledger[name] = [...ledger[name].filter((item) => !ids.has(item.id)), ...local];
  };
  for (const [name, kind] of [
    ['customers', 'customer'],
    ['materials', 'material'],
    ['services', 'service'],
    ['expenses', 'expense'],
  ])
    overlay(name, kind);
  for (const [name, kind] of [
    ['jobs', 'job'],
    ['payments', 'checkout'],
    ['checkouts', 'checkout'],
  ]) {
    const local = state.ledger[name].filter((item) => has(kind, item.id) || has('customer', item.customerId));
    const ids = new Set(local.map((item) => item.id));
    ledger[name] = [...ledger[name].filter((item) => !ids.has(item.id)), ...local];
  }
  for (const [name, kind, key] of [
    ['materialHistory', 'material', 'materialId'],
    ['expenseHistory', 'expense', 'expenseId'],
  ]) {
    const local = state.ledger[name].filter((item) => has(kind, item[key]));
    const ids = new Set(local.map((item) => item.id));
    ledger[name] = [...ledger[name].filter((item) => !ids.has(item.id)), ...local];
  }
  return ledger;
}
// Replace the old local receipt with the remotely committed receipt before projecting later holds.
export function acknowledgeReviews(state, cloud, reviews) {
  const resolved = new Set(reviews.map((item) => item.event_id));
  // Keeping the business status for a job also settles the stage changes this device queued
  // after it offline: they were based on the same outdated job and would each be held for
  // review in turn. Status changes based on the current job version are still sent.
  const keptJobs = new Set(
    reviews
      .filter((item) => item.source.kind === 'job.status_changed' && !item.replacements?.length)
      .map((item) => item.source.data.id),
  );
  for (const event of state.pending)
    if (
      event.kind === 'job.status_changed' &&
      keptJobs.has(event.data.id) &&
      (event.data.baseVersion ?? 0) < (cloud.jobs.find((job) => job.id === event.data.id)?.version ?? 1)
    )
      resolved.add(event.id);
  let ledger = normalizeLedger(state.ledger);
  const affected = new Set();
  const receiptIds = new Set(),
    jobIds = new Set();
  for (const item of reviews) {
    for (const event of [item.source, ...(item.replacements ?? [])]) {
      for (const key of eventResources(event, ledger)) affected.add(key);
      if (event.kind === 'checkout.completed') {
        receiptIds.add(event.id);
        for (const job of event.data.jobs) jobIds.add(job.id);
      }
    }
  }
  for (const [name, kind] of [
    ['materials', 'material'],
    ['services', 'service'],
    ['customers', 'customer'],
    ['expenses', 'expense'],
  ]) {
    const rows = cloud[name].filter((item) => affected.has(kind + ':' + item.id));
    const ids = new Set(rows.map((item) => item.id));
    ledger[name] = [...ledger[name].filter((item) => !ids.has(item.id)), ...rows];
  }
  for (const name of ['checkouts', 'payments'])
    ledger[name] = [
      ...ledger[name].filter((item) => !receiptIds.has(item.id)),
      ...cloud[name].filter((item) => receiptIds.has(item.id)),
    ];
  ledger.jobs = [
    ...ledger.jobs.filter((item) => !jobIds.has(item.id)),
    ...cloud.jobs.filter((item) => jobIds.has(item.id)),
  ];
  for (const name of ['materialHistory', 'expenseHistory']) {
    const rows = cloud[name];
    const ids = new Set(rows.map((item) => item.id));
    ledger[name] = [
      ...ledger[name].filter((item) => !ids.has(item.id) && !resolved.has(item.id) && !jobIds.has(item.id)),
      ...rows,
    ];
  }
  return {
    ...state,
    ledger,
    pending: state.pending.filter((event) => !resolved.has(event.id)),
    syncConflicts: Object.fromEntries(
      Object.entries(state.syncConflicts ?? {}).filter(([id]) => !resolved.has(id)),
    ),
  };
}
