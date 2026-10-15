// Auto-lock: after a set number of minutes without a tap, click or key press, the staff user is
// signed out. Activity is shared between tabs through localStorage, so using the app in one tab
// keeps the others unlocked. Offline, the lock waits for a connection: nobody could sign back in.

export const ACTIVITY_KEY = 'printshopledger-last-activity';

/**
 * Whether to lock now.
 * @param {{ now: number, lastActivity: number, minutes: number, online: boolean, busy?: boolean }} state
 */
export function shouldLock({ now, lastActivity, minutes, online, busy = false }) {
  if (!(minutes > 0) || !online || busy) return false;
  return now - lastActivity >= minutes * 60_000;
}

/** The latest activity time from this tab and the shared value from other tabs. */
export function latestActivity(local, shared) {
  const other = Number(shared);
  return Number.isFinite(other) && other > local ? other : local;
}
