// Dashboard → Trend: dates grouped into days, weeks or months so every bar stays readable.
// "auto" picks the finest grouping that fits the room the chart has (fewer groups on phones).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Monday of the week a YYYY-MM-DD date falls in. */
function weekStart(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** The grouping "auto" chooses: days if they fit, else weeks, else months. */
export function autoGrouping(rows, maxGroups) {
  if (rows.length <= maxGroups) return 'day';
  const weeks = new Set(rows.map((r) => weekStart(r.date))).size;
  return weeks <= maxGroups ? 'week' : 'month';
}

/** Sums each numeric field per group; each group keeps its first date and a short label. */
export function groupTrend(rows, grouping) {
  if (grouping === 'day') return rows.map((r) => ({ ...r, label: r.date.slice(5) }));
  const groups = new Map();
  for (const row of rows) {
    const key = grouping === 'week' ? weekStart(row.date) : row.date.slice(0, 7);
    const group = groups.get(key) ?? { date: key };
    for (const [field, value] of Object.entries(row))
      if (field !== 'date' && typeof value === 'number') group[field] = (group[field] ?? 0) + value;
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({
    ...g,
    label:
      grouping === 'week'
        ? `w/c ${g.date.slice(8)} ${MONTHS[Number(g.date.slice(5, 7)) - 1]}`
        : `${MONTHS[Number(g.date.slice(5, 7)) - 1]} ${g.date.slice(2, 4)}`,
  }));
}
