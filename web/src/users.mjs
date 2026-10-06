export const accessLevels = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier' };
export function userCode(id) { return `USR-${id.replaceAll('-', '').slice(0, 8).toUpperCase()}`; }
export function validateUser(input) {
  const name = String(input.name ?? '').trim();
  const username = String(input.username ?? '').trim().toLowerCase();
  const rank = String(input.rank ?? '').trim();
  if (!name || name.length > 160) throw new Error('Enter a name of up to 160 characters.');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) throw new Error('Username must be 3–40 characters: letters, numbers, dots, underscores or hyphens.');
  if (!rank || rank.length > 80) throw new Error('Enter a rank or job title of up to 80 characters.');
  if (!Object.hasOwn(accessLevels, input.role)) throw new Error('Choose an access level.');
  return { name, username, rank, role: input.role };
}
