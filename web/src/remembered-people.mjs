// Who a device still remembers (device-people.ts): signed in here with their password within the
// last `days` days, at most `max` people (the most recently seen are kept).

/**
 * @typedef {{ userId: string, name: string, username: string, rank: number,
 *   session: unknown, passwordAt: string, seenAt: string }} RememberedPerson
 */

/**
 * @param {RememberedPerson[]} people
 * @param {{ days: number, max: number, now: string }} limits
 * @returns {RememberedPerson[]}
 */
export function keepPeople(people, { days, max, now }) {
  const cutoff = Date.parse(now) - days * 86_400_000;
  return [...people]
    .filter((p) => p && typeof p.userId === 'string' && Date.parse(p.passwordAt) >= cutoff)
    .sort((a, b) => (a.seenAt < b.seenAt ? 1 : a.seenAt > b.seenAt ? -1 : 0))
    .slice(0, max);
}
