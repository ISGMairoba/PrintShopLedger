// Remember people on this device (Business Settings → Security, off by default; plans/lock-screen.md).
// When on, the device keeps the sign-in of each person who signs in here with their password, so
// Switch user on the lock screen can change over with their PIN, even offline. Each person's work is
// kept and synced under their own sign-in. Kept encrypted with the device key that protects PINs
// (pin-store.ts). The pure rules (who is still remembered, who drops off) are in device-people.mjs.
import type { Session } from '@supabase/supabase-js';
import { readSealed, writeSealed } from './pin-store';
import { keepPeople, type RememberedPerson } from './device-people.mjs';

export type { RememberedPerson };
const name = (shopId: string) => `people:${shopId}`;

export async function listPeople(shopId: string, days: number, max: number, now = new Date()) {
  const all = (await readSealed<RememberedPerson[]>(name(shopId))) ?? [];
  const kept = keepPeople(all, { days, max, now: now.toISOString() });
  if (kept.length !== all.length) await writeSealed(name(shopId), kept);
  return kept;
}

/** Keep (or refresh) this person's sign-in. password: they just signed in with their password. */
export async function rememberPerson(
  shopId: string,
  person: Omit<RememberedPerson, 'passwordAt' | 'seenAt' | 'session'> & { session: Session },
  {
    password,
    days,
    max,
    seen = true,
    now = new Date(),
  }: { password: boolean; days: number; max: number; seen?: boolean; now?: Date },
) {
  const all = (await readSealed<RememberedPerson[]>(name(shopId))) ?? [];
  const before = all.find((p) => p.userId === person.userId);
  // Only someone who signed in here with their password is remembered.
  if (!before && !password) return;
  const at = now.toISOString();
  const next: RememberedPerson = {
    ...person,
    passwordAt: password ? at : (before?.passwordAt ?? at),
    // Only using the app counts as being seen (not their work syncing in the background).
    seenAt: seen || !before ? at : before.seenAt,
  };
  const kept = keepPeople([next, ...all.filter((p) => p.userId !== person.userId)], { days, max, now: at });
  await writeSealed(name(shopId), kept);
}

export async function forgetPerson(shopId: string, userId: string) {
  const all = (await readSealed<RememberedPerson[]>(name(shopId))) ?? [];
  await writeSealed(
    name(shopId),
    all.filter((p) => p.userId !== userId),
  );
}

export const forgetEveryone = (shopId: string) => writeSealed(name(shopId), null);
