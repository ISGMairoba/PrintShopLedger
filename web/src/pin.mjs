// PIN lock (plans/ideas-pin-catalogue-marketplace.md, part 1). Each person sets a 4–6 digit PIN in
// My Account. Only a salted, slow hash of it is kept: on the server (so every device gets it) and,
// encrypted, on each device where that person signs in (pin-store.ts). When auto-lock runs out the
// screen locks without signing out; the PIN is checked on the device, so unlocking works offline.
// After MAX_TRIES wrong PINs the person signs in with their password again.

export const MAX_TRIES = 5;
const ITERATIONS = 150_000;
const PIN = /^[0-9]{4,6}$/;

/** A PIN that is easy to guess: one digit repeated, or digits in a row (1234, 6543…). */
function obvious(pin) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = [...pin].slice(1).map((d, i) => Number(d) - Number(pin[i]));
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** Why a new PIN can't be used ('' when it can). min: the business's minimum length (4 to 6). */
export function pinProblem(pin, again, min = 4) {
  const value = String(pin ?? '');
  if (!PIN.test(value) || value.length < min) return min === 6 ? 'Use 6 digits.' : `Use ${min} to 6 digits.`;
  if (obvious(value)) return 'Choose a PIN that is harder to guess (not 1111 or 1234).';
  if (again !== undefined && value !== String(again)) return 'The two PINs do not match.';
  return '';
}

/** Whether a stored hash looks right: v1$<iterations>$<salt base64>$<hash base64>. */
export const validPinHash = (value) =>
  typeof value === 'string' && /^v1\$[0-9]{5,7}\$[A-Za-z0-9+/=]{16,64}\$[A-Za-z0-9+/=]{40,64}$/.test(value);

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function derive(pin, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** The hash to keep for a PIN (a fresh random salt each time). */
export async function hashPin(pin, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `v1$${iterations}$${b64(salt)}$${b64(await derive(String(pin), salt, iterations))}`;
}

/** Whether a PIN matches a kept hash. */
export async function checkPin(pin, stored) {
  if (!validPinHash(stored) || !PIN.test(String(pin ?? ''))) return false;
  const [, iterations, salt, hash] = stored.split('$');
  const got = new Uint8Array(await derive(String(pin), unb64(salt), Number(iterations)));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i += 1) diff |= got[i] ^ want[i];
  return diff === 0;
}
