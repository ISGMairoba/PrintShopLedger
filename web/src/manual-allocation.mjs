// Integer-kobo allocations: cashier edits determine priority, not the job date.
/**
 * @param {Record<string, number>} values
 * @param {Record<string, number>} limits
 * @param {number} budget
 * @param {string[]} editedOrder
 * @param {string|null} editedJobId
 */
export function rebalanceManualAllocations(values, limits, budget, editedOrder = [], editedJobId = null) {
  const validAmount = (value) => Number.isSafeInteger(value) && value >= 0;
  if (!validAmount(budget)) throw new Error('Invalid allocation budget.');
  const ids = Object.keys(limits);
  const amounts = Object.fromEntries(
    ids.map((id) => {
      const value = values[id] ?? 0;
      if (!validAmount(limits[id]) || !validAmount(value)) throw new Error('Invalid job allocation.');
      return [id, Math.min(value, limits[id])];
    }),
  );
  let order = [...new Set(editedOrder)].filter((id) => ids.includes(id));
  if (editedJobId !== null) {
    if (!ids.includes(editedJobId)) throw new Error('Job is no longer available for allocation.');
    order = [...order.filter((id) => id !== editedJobId), editedJobId];
    amounts[editedJobId] = Math.min(amounts[editedJobId], budget);
  }
  const total = Object.values(amounts).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error('Allocation total is too large.');
  let excess = Math.max(0, total - budget);
  // Unedited automatic defaults yield first. Automatic deductions never count as edits.
  for (const id of [...ids.filter((id) => !order.includes(id)), ...order]) {
    const deduction = Math.min(amounts[id], excess);
    amounts[id] -= deduction;
    excess -= deduction;
    if (!excess) break;
  }
  return { amounts, editedOrder: order };
}
