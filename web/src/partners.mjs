// Partners (plans/partners.md; owner, 26 Nov): finished stock kept for regular clients. A partner item
// is a service made for one partner (production.partnerOf), with its agreement and stock on hand
// (ledger.partnerItems, id = the service's id). The server keeps the same rules
// (public.apply_partner_event); keep them in step.

/** The active partner item for a service, or null. */
export const partnerItem = (ledger, serviceId) =>
  (ledger.partnerItems ?? []).find((p) => p.id === serviceId && p.status !== 'ended') ?? null;

/**
 * How an order of a partner item is filled: from stock first, the rest made. What is made is
 * rounded up to the best batch size while stock is below the agreed level (the extra goes back
 * into stock when the job is Completed), otherwise just what is needed (decision 5).
 * @returns {{ itemId: string, fromStock: number, toMake: number, made: number, design: number }}
 */
export function partnerSplit(item, quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  const onHand = Math.max(0, item?.onHand ?? 0);
  const fromStock = Math.min(onHand, qty);
  const toMake = qty - fromStock;
  const left = onHand - fromStock;
  const batch = Math.max(1, item?.batchSize ?? 1);
  const made = toMake > 0 && left < (item?.agreedStock ?? 0) ? Math.ceil(toMake / batch) * batch : toMake;
  return { itemId: item?.id ?? '', fromStock, toMake, made, design: item?.design ?? 1 };
}

/** Stock on hand after a sale would be below the refill point: what to prepare (a whole batch). */
export function refillNeeded(item, afterSale = item?.onHand ?? 0) {
  if (!item || item.status === 'ended' || item.refillPrompt === 'never') return null;
  if (afterSale >= item.refillAt) return null;
  const batch = Math.max(1, item.batchSize);
  return Math.max(batch, Math.ceil((item.agreedStock - afterSale) / batch) * batch);
}

/** Jobs whose stock is ready to go into the partner's stock (Completed, not added yet). */
export function readyToStock(ledger) {
  return (ledger.jobs ?? []).filter((j) => {
    if (j.partnerCredited || !['Completed', 'Collected'].includes(j.productionStatus)) return false;
    if (j.partnerBuild?.itemId) return true;
    return !!j.partner?.itemId && (j.partner.made ?? 0) > (j.partner.toMake ?? 0);
  });
}
/** What a ready job adds to stock. */
export const stockFrom = (job) =>
  job.partnerBuild ? job.partnerBuild.quantity : Math.max(0, (job.partner?.made ?? 0) - (job.partner?.toMake ?? 0));

const audit = (event) => {
  const d = event.data;
  if (!event.id || !d?.id || !d.modifiedBy || !d.modifiedAt) throw Error('Partner identity and audit information are required.');
  return d;
};
const whole = (n, label, min = 0) => {
  if (!Number.isInteger(n) || n < min || n > 1e8) throw Error(`Enter ${label} as a whole number.`);
  return n;
};
export const END_RULES = /** @type {const} */ ([
  ['partnerPays', 'The partner pays for the stock left'],
  ['writeOff', 'Written off (cost recorded as waste)'],
  ['sellToOthers', 'Sold to other customers'],
]);

/** Apply a partner change to this device's copy (the server decides again when it syncs). */
export function applyPartnerEvent(ledger, event) {
  const d = audit(event);
  const items = ledger.partnerItems ?? [];
  const item = items.find((p) => p.id === d.id);
  const who = { byLabel: d.modifiedByLabel ?? '', at: d.modifiedAt };
  const put = (next) => ({
    ...ledger,
    partnerItems: item ? items.map((p) => (p.id === next.id ? next : p)) : [...items, next],
  });
  const moved = (next, move) => ({
    ...next,
    version: next.version + 1,
    moves: [...(next.moves ?? []), { ...move, ...who, onHand: next.onHand }].slice(-300),
  });
  if (event.kind === 'partner.item_saved') {
    if (item && (d.baseVersion ?? -1) !== item.version)
      throw Error('This agreement changed on another device. Reopen it to see the latest.');
    const rec = {
      id: d.id,
      customerId: d.customerId,
      agreedStock: whole(d.agreedStock, 'the agreed stock'),
      refillAt: whole(d.refillAt, 'the refill point'),
      batchSize: whole(d.batchSize, 'the best batch size', 1),
      endRule: d.endRule,
      collectRule: d.collectRule,
      refillPrompt: d.refillPrompt,
      costTiming: d.costTiming ?? 'used',
      reviewOn: d.reviewOn ?? null,
      notes: String(d.notes ?? '').trim(),
      design: item?.design ?? 1,
      modifiedByLabel: d.modifiedByLabel,
      modifiedAt: d.modifiedAt,
    };
    return put(
      item
        ? { ...item, ...rec, status: 'active', version: item.version + 1 }
        : { ...rec, status: 'active', version: 1, onHand: 0, moves: [], createdAt: d.modifiedAt },
    );
  }
  if (!item) throw Error('Partner item not found.');
  if (item.status === 'ended') throw Error('This partner agreement has ended.');
  if (event.kind === 'partner.ended')
    return put(moved({ ...item, status: 'ended', endRule: d.endRule }, { kind: 'ended', endRule: d.endRule }));
  if (event.kind === 'partner.stock_adjusted') {
    const qty = whole(d.quantity, 'the stock on hand');
    if (!String(d.reason ?? '').trim()) throw Error('Enter a reason.');
    return put(moved({ ...item, onHand: qty }, { kind: 'set', quantity: qty - item.onHand, reason: d.reason.trim() }));
  }
  if (event.kind === 'partner.design_changed')
    return put(
      moved(
        { ...item, design: (item.design ?? 1) + 1, oldDesignStock: item.onHand },
        { kind: 'design', design: (item.design ?? 1) + 1, reason: String(d.reason ?? '').trim() },
      ),
    );
  if (event.kind === 'partner.build_started')
    // The job itself comes from the server with the next sync.
    return put(moved(item, { kind: 'build', jobId: d.jobId, quantity: 0, planned: d.quantity }));
  const job = (ledger.jobs ?? []).find((j) => j.id === d.jobId);
  if (!job) throw Error('Job not found.');
  const mark = (flag) => (ledger.jobs ?? []).map((j) => (j.id === job.id ? { ...j, [flag]: true } : j));
  if (event.kind === 'partner.stock_taken') {
    const qty = job.partner?.fromStock ?? 0;
    if (job.partnerTaken) throw Error('Already taken from stock.');
    if (qty > item.onHand) throw Error(`Only ${item.onHand} in stock for this partner now. Review the job.`);
    return {
      ...put(moved({ ...item, onHand: item.onHand - qty }, { kind: 'sold', jobId: job.id, quantity: -qty })),
      jobs: mark('partnerTaken'),
    };
  }
  if (event.kind === 'partner.stock_built') {
    if (job.partnerCredited) throw Error('Already added to stock.');
    const qty = stockFrom(job);
    return {
      ...put(
        moved(
          { ...item, onHand: item.onHand + qty },
          { kind: job.partnerBuild ? 'built' : 'leftover', jobId: job.id, quantity: qty },
        ),
      ),
      jobs: mark('partnerCredited'),
    };
  }
  throw Error('Unknown partner change.');
}
