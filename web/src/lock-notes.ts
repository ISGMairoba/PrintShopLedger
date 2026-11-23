// Small device notes for the lock screen (plans/lock-screen.md).

const SWITCHED = 'printshopledger:switched-in';
/**
 * The person just switched to on the lock screen with their PIN: the app opens for them without
 * locking again. Read it (no argument), or set or clear it. Kept for this tab only.
 */
export function switchedIn(userId?: string | null) {
  try {
    if (userId === undefined) return sessionStorage.getItem(SWITCHED);
    if (userId) sessionStorage.setItem(SWITCHED, userId);
    else sessionStorage.removeItem(SWITCHED);
  } catch {}
  return null;
}

const LOCKOUTS = 'printshopledger:pin-lockouts:v1';
type Lockout = { shopId: string; userId: string; at: string };
const read = (): Lockout[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCKOUTS) ?? '[]');
  } catch {
    return [];
  }
};
const write = (all: Lockout[]) => {
  try {
    localStorage.setItem(LOCKOUTS, JSON.stringify(all.slice(-20)));
  } catch {}
};
/** Someone used up their PIN tries here: remembered until it reaches the server (sendLockouts). */
export const noteLockout = (shopId: string, userId: string) =>
  write([...read(), { shopId, userId, at: new Date().toISOString() }]);

/** This device's name in the notice: what the browser says it is. */
export function deviceName() {
  const agent = navigator.userAgent;
  const kind = /iPhone/.test(agent)
    ? 'iPhone'
    : /iPad/.test(agent)
      ? 'iPad'
      : /Android/.test(agent)
        ? 'Android device'
        : /Windows/.test(agent)
          ? 'Windows computer'
          : /Mac/.test(agent)
            ? 'Mac'
            : 'a device';
  return kind;
}

/** Send the noted lockouts for this business (when online). Kept for next time if it fails. */
export async function sendLockouts(
  shopId: string,
  send: (userId: string, device: string) => Promise<{ error: { message: string } | null }>,
) {
  const all = read();
  const mine = all.filter((item) => item.shopId === shopId);
  if (!mine.length) return;
  const left: Lockout[] = all.filter((item) => item.shopId !== shopId);
  for (const item of mine) {
    const { error } = await send(item.userId, deviceName());
    if (error) left.push(item);
  }
  write(left);
}
