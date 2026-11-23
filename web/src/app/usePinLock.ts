import { useCallback, useEffect, useState } from 'react';
import { checkPin, MAX_TRIES } from '../pin.mjs';
import { lockedFlag, readPin, setLockedFlag, writePin } from '../pin-store';

/**
 * PIN lock for the signed-in staff member on this device (pin.mjs). It keeps this device's copy of
 * their PIN hash up to date from the server, says whether they have a PIN, locks the screen
 * without signing out, and unlocks with the PIN (no server needed).
 * signOut: sign the staff member out on this device (too many wrong PINs, or the stored lock data
 * went missing).
 */
export default function usePinLock({
  scope,
  userId,
  online,
  fetchHash,
  signOut,
  maxTries = MAX_TRIES,
  minLength = 4,
  onLockout,
}: {
  scope: string;
  userId: string;
  online: boolean;
  /** The person's PIN hash from the server (null: none set). Throws when it can't be read. */
  fetchHash: () => Promise<string | null>;
  signOut: (message: string) => void;
  /** Wrong PINs before the password is needed (Business Settings → Security). */
  maxTries?: number;
  /** The business's minimum PIN length: a shorter PIN still unlocks, then a new one is asked for. */
  minLength?: number;
  /** The tries ran out (before signing out): Admins are told (lock-notes.ts). */
  onLockout?: () => void;
}) {
  const [shortPin, setShortPin] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [locked, setLocked] = useState(false);
  const [checked, setChecked] = useState('');

  // On sign-in (and when the connection comes back): this device's copy, and a lock left from before.
  useEffect(() => {
    if (!scope || !userId) {
      setHasPin(false);
      setLocked(false);
      return;
    }
    let live = true;
    void (async () => {
      let record = await readPin(scope, userId);
      // Decide from this device's copy first, so the app never waits on the server before it knows
      // whether to show the lock screen. The server's copy below only refreshes it.
      if (!live) return;
      const flaggedFirst = lockedFlag(scope) === userId;
      if (record || !flaggedFirst) {
        setHasPin(!!record);
        setLocked(!!record && (record.locked || flaggedFirst));
        setChecked(`${scope}:${userId}`);
      }
      if (online)
        try {
          const hash = await fetchHash();
          // Read the device's copy again: the person may have unlocked while the server answered.
          const now = await readPin(scope, userId);
          if (!hash) {
            if (now && !now.locked) await writePin(scope, userId, null);
            record = now && !now.locked ? null : now;
          } else if (!now || now.hash !== hash) {
            record = { hash, tries: now?.tries ?? 0, locked: now?.locked ?? false };
            await writePin(scope, userId, record);
          } else record = now;
        } catch {
          /* Offline or the server is busy: the device's copy stands. */
        }
      if (!live) return;
      const flagged = lockedFlag(scope) === userId;
      if (flagged && !record) {
        // Locked, but the device's PIN data is gone: the password is needed again.
        setLockedFlag(scope, null);
        signOut('This device was locked. Sign in with your password to continue.');
        return;
      }
      setHasPin(!!record);
      setLocked(!!record && (record.locked || flagged));
      setChecked(`${scope}:${userId}`);
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId, online]);

  /** Lock now; false when this person has no PIN on this device (sign out instead). */
  const lock = useCallback(async () => {
    const record = scope && userId ? await readPin(scope, userId) : null;
    if (!record) return false;
    await writePin(scope, userId, { ...record, locked: true });
    setLockedFlag(scope, userId);
    setLocked(true);
    return true;
  }, [scope, userId]);

  /** Unlock with the PIN: '' when unlocked, else what went wrong. */
  const unlock = useCallback(
    async (pin: string) => {
      const record = await readPin(scope, userId);
      if (!record) {
        setLockedFlag(scope, null);
        signOut('Sign in with your password to continue.');
        return 'Sign in with your password.';
      }
      if (await checkPin(pin, record.hash)) {
        await writePin(scope, userId, { ...record, tries: 0, locked: false });
        setLockedFlag(scope, null);
        setLocked(false);
        if (pin.length < minLength) setShortPin(true);
        return '';
      }
      const tries = record.tries + 1;
      if (tries >= maxTries) {
        onLockout?.();
        await writePin(scope, userId, { ...record, tries: 0, locked: false });
        setLockedFlag(scope, null);
        setLocked(false);
        signOut(`${maxTries} wrong PINs. Sign in with your password to continue.`);
        return 'Too many wrong PINs.';
      }
      await writePin(scope, userId, { ...record, tries });
      const left = maxTries - tries;
      return `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left before your password is needed.`;
    },
    [scope, userId, signOut, maxTries, minLength, onLockout],
  );

  /** Unlocked another way the device trusts (its face/fingerprint unlock, for this person). */
  const unlockTrusted = useCallback(async () => {
    const record = await readPin(scope, userId);
    if (!record) return 'Sign in with your password.';
    await writePin(scope, userId, { ...record, tries: 0, locked: false });
    setLockedFlag(scope, null);
    setLocked(false);
    return '';
  }, [scope, userId]);

  /** After saving a new PIN (or removing it) in My Account. */
  const saved = useCallback(
    async (hash: string | null) => {
      await writePin(scope, userId, hash ? { hash, tries: 0, locked: false } : null);
      setHasPin(!!hash);
      setShortPin(false);
    },
    [scope, userId],
  );

  /** Leaving the lock screen another way (Switch user / sign out): forget the lock. */
  const clear = useCallback(async () => {
    const record = await readPin(scope, userId);
    if (record) await writePin(scope, userId, { ...record, locked: false });
    setLockedFlag(scope, null);
    setLocked(false);
  }, [scope, userId]);

  return {
    hasPin,
    locked,
    /** The PIN just used is shorter than the business now requires: ask for a new one. */
    shortPin,
    ready: checked === `${scope}:${userId}`,
    lock,
    unlock,
    unlockTrusted,
    saved,
    clear,
  };
}
