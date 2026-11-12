// Dashboard → Expenses by category and by payee for the chosen period: the expenses incurred in
// it (voided ones left out), largest first.

/** @returns {{ id: string, name: string, amount: number, count: number }[]} */
export function expenseBreakdown(ledger, from, to, by = 'category') {
  const payees = new Map((ledger.payees ?? []).map((p) => [p.id, p.name]));
  const groups = new Map();
  for (const e of ledger.expenses ?? []) {
    if (e.voided || e.incurredOn < from || e.incurredOn > to) continue;
    const name =
      by === 'payee'
        ? (e.payeeId && payees.get(e.payeeId)) || e.payee?.trim() || 'No payee'
        : e.category?.trim() || 'No category';
    const key = by === 'payee' && e.payeeId && payees.has(e.payeeId) ? e.payeeId : name.toLowerCase();
    const g = groups.get(key) ?? { id: key, name, amount: 0, count: 0 };
    g.amount += e.amount;
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}
