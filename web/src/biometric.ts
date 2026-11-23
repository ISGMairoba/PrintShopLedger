// Face/fingerprint unlock (plans/lock-screen.md): the device's own unlock (Face ID, Touch ID,
// Android face or fingerprint, Windows Hello) through the browser's passkey feature (WebAuthn).
// It belongs to one person on this device: whoever unlocks with it is signed in as them. The check
// happens on the device, so it works offline; it only stands in for the PIN on the lock screen,
// never for the password. It is tied to that person's PIN: when the PIN changes or is cleared, it
// stops working until it is turned on again. After too many wrong PINs or a password sign-in the
// next unlock asks for the PIN once (needsPin).
import { readSealed, writeSealed } from './pin-store';

export type BiometricOwner = {
  userId: string;
  name: string;
  username: string;
  credentialId: string;
  pinHash: string;
  needsPin: boolean;
};
const key = (shopId: string) => `biometric:${shopId}`;
const bytes = (text: string) => new TextEncoder().encode(text);
const toBase64 = (buffer: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const challenge = () => crypto.getRandomValues(new Uint8Array(32));

/** Whether this device has a face/fingerprint unlock the browser can use. */
export async function biometricSupported() {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export const biometricOwner = (shopId: string) => readSealed<BiometricOwner>(key(shopId));
export const removeBiometric = (shopId: string) => writeSealed(key(shopId), null);
export async function setNeedsPin(shopId: string, needsPin: boolean) {
  const owner = await biometricOwner(shopId);
  if (owner && owner.needsPin !== needsPin) await writeSealed(key(shopId), { ...owner, needsPin });
}

/** Turn it on for this person on this device (replacing anyone before). */
export async function registerBiometric(
  shopId: string,
  person: { userId: string; name: string; username: string; pinHash: string },
) {
  const created = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { name: 'PrintShopLedger', id: location.hostname },
      user: { id: bytes(person.userId), name: person.username || person.name, displayName: person.name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!created) throw Error('Face/fingerprint unlock was not set up.');
  await writeSealed(key(shopId), {
    userId: person.userId,
    name: person.name,
    username: person.username,
    credentialId: toBase64(created.rawId),
    pinHash: person.pinHash,
    needsPin: false,
  } satisfies BiometricOwner);
}

/** Ask the device to check the owner's face or fingerprint; true when it was them. */
export async function verifyBiometric(owner: BiometricOwner) {
  try {
    const got = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge(),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromBase64(owner.credentialId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    const response = got?.response as AuthenticatorAssertionResponse | undefined;
    if (!response) return false;
    // The device says the person was checked (user verified: flag bit 2 of the authenticator data).
    const flags = new Uint8Array(response.authenticatorData)[32];
    return (flags & 0x04) !== 0;
  } catch {
    return false;
  }
}
