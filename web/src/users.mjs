export const accessLevels = { cashier: 'Cashier', admin: 'Admin', manager: 'Manager', developer: 'Developer' };
export const rankValues = { cashier: 1, admin: 2, manager: 3, developer: 4 };
export function canManage(actor, target) {
  return actor.accessLevel > 0 && actor.rank >= 2 && (actor.rank === 4 || actor.userId === target.userId || actor.rank > target.rank);
}
export function userCode(id) { return `USR-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`; }
export function validateUser(input) {
  const name = String(input.name ?? '').trim();
  const username = String(input.username ?? '').trim().toLowerCase();
  if (!name || name.length > 160) throw new Error('Enter a name of up to 160 characters.');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new Error('Username must be 3–40 characters: letters, numbers, dots, underscores or hyphens.');
  if (!Object.hasOwn(accessLevels, input.role)) throw new Error('Choose an access level.');
  return { name, username, rank: rankValues[input.role], role: input.role };
}
