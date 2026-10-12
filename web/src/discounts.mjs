// Discounts. A job can have its own discount (a percentage or a flat naira amount), and a whole
// order can have one too; the order discount is shared across the order's jobs in proportion to
// their price, so every job keeps an exact balance. Amounts are integer kobo.
//
// Who may give what (business setting, enforced again by the server when the sale syncs):
// - each rank has a maximum discount, as a percentage of a job's price (Developer: 100%);
// - flat amounts and whole-order discounts need Admin or higher.

export const FLAT_DISCOUNT_RANK = 2;
export const discountDefaults = () => ({ maxPercent: { 1: 0, 2: 20, 3: 100 } });

export function validateDiscountSettings(input) {
  const value = { ...discountDefaults(), ...input };
  const maxPercent = { ...discountDefaults().maxPercent, ...value.maxPercent };
  for (const rank of ['1', '2', '3']) {
    const n = maxPercent[rank];
    if (!Number.isFinite(n) || n < 0 || n > 100 || Math.round(n * 100) !== n * 100)
      throw Error('Discount limits must be between 0% and 100%.');
  }
  return { maxPercent: { 1: maxPercent[1], 2: maxPercent[2], 3: maxPercent[3] } };
}

/** The most a rank may take off a job, in percent. */
export const maxDiscountPercent = (settings, rank) =>
  rank >= 4 ? 100 : Number(validateDiscountSettings(settings).maxPercent[String(rank)] ?? 0);

/** What a rank may do: the cap, and whether flat amounts and whole-order discounts are allowed. */
export const discountPolicy = (settings, rank) => ({
  maxPercent: maxDiscountPercent(settings, rank),
  canFlat: rank >= FLAT_DISCOUNT_RANK,
});

/** A discount as entered: none, or { kind: 'percent' | 'amount', value, reason }. */
export function validDiscount(spec) {
  if (spec === undefined || spec === null || spec === '') return null;
  if (typeof spec !== 'object' || !['percent', 'amount'].includes(spec.kind))
    throw Error('Choose a percentage or an amount for the discount.');
  const value = Number(spec.value);
  const reason = String(spec.reason ?? '').trim();
  if (reason.length > 200 || /[\x00-\x1f\x7f]/.test(reason))
    throw Error('Discount reason must be up to 200 characters.');
  if (spec.kind === 'percent') {
    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.round(value * 100) !== value * 100)
      throw Error('Discount percentage must be between 0 and 100, with at most two decimals.');
  } else if (!Number.isSafeInteger(value) || value < 0 || value > 100000000000)
    throw Error('Enter a valid discount amount.');
  if (value === 0) return null;
  return { kind: spec.kind, value, ...(reason ? { reason } : {}) };
}

/** Kobo taken off `base` by a discount (never more than the base). */
export function discountKobo(spec, base) {
  const d = validDiscount(spec);
  if (!d || base <= 0) return 0;
  return Math.min(base, d.kind === 'percent' ? Math.round((base * d.value) / 100) : d.value);
}

/** Split `total` across weights in proportion, whole kobo, largest remainders first. */
export function shareByWeight(total, weights) {
  const sum = weights.reduce((n, w) => n + w, 0);
  if (!total || !sum) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((n, s) => n + s, 0);
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (!left) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

/** Largest discount a rank may give on a job of this price (rounded up to the kobo). */
export const discountCap = (gross, maxPercent) => Math.ceil((gross * maxPercent) / 100);

/**
 * Apply an order discount to quoted jobs (each already carrying grossAmount, lineDiscount and
 * amount after its own discount). Returns the jobs with orderDiscountShare, discountAmount and
 * the final amount. With a policy, checks the giver's limits.
 */
/**
 * @template {{ amount: number, grossAmount?: number, lineDiscount?: number, discount?: { kind: string } }} J
 * @param {J[]} jobs
 * @param {unknown} orderSpec
 * @param {{ maxPercent: number, canFlat: boolean } | null} [policy]
 * @returns {{ jobs: (J & { grossAmount?: number, lineDiscount?: number, orderDiscountShare?: number, discountAmount?: number })[], order: { kind: string, value: number, reason?: string } | null, orderTotal: number, discountTotal: number }}
 */
export function applyOrderDiscount(jobs, orderSpec, policy = null) {
  const order = validDiscount(orderSpec);
  const subtotal = jobs.reduce((n, j) => n + j.amount, 0);
  const orderTotal = discountKobo(order, subtotal);
  const shares = shareByWeight(
    orderTotal,
    jobs.map((j) => j.amount),
  );
  const result = jobs.map((j, i) => {
    const discountAmount = j.lineDiscount + shares[i];
    const next = {
      ...j,
      orderDiscountShare: shares[i],
      discountAmount,
      amount: j.grossAmount - discountAmount,
    };
    if (!discountAmount) {
      delete next.orderDiscountShare;
      delete next.lineDiscount;
      delete next.discountAmount;
      delete next.grossAmount;
    }
    return next;
  });
  if (policy) {
    if (order && !policy.canFlat) throw Error('Only Admins and higher can discount a whole order.');
    for (const j of result) {
      if (!j.discountAmount) continue;
      if (j.discount?.kind === 'amount' && !policy.canFlat)
        throw Error('Only Admins and higher can give a flat discount. Use a percentage.');
      if (j.discountAmount > discountCap(j.grossAmount, policy.maxPercent))
        throw Error(
          policy.maxPercent
            ? `Your discount limit is ${policy.maxPercent}% of each job.`
            : 'Your rank cannot give discounts.',
        );
    }
  }
  return {
    jobs: result,
    order,
    orderTotal,
    discountTotal: result.reduce((n, j) => n + (j.discountAmount ?? 0), 0),
  };
}
