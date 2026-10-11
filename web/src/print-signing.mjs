// Trusted printing with QZ Tray. Each business has its own key pair: the private key stays on the
// server (the print-signing edge function), the certificate is public. A computer that installs the
// business certificate as QZ Tray's override.crt trusts print requests signed with that key, so QZ
// Tray stops asking for approval. Shared by the edge function (Deno) and the unit tests (Node).

const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' };
const pem = (label, bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/.{1,64}/g, '$&\n');
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
};
const unpem = (text) => {
  const binary = atob(String(text).replace(/-----[^-]+-----|\s/g, ''));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

/** X.509 subject values must be short; keep the business name readable in QZ Tray's dialogs. */
export const certificateName = (name) =>
  String(name ?? '')
    .replace(/[\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'PrintShopLedger business';

/**
 * Create a 2048-bit RSA key and a self-signed certificate (valid 10 years) for one business.
 * `forge` is node-forge, passed in so Deno and Node can each load it their own way.
 */
export async function createPrintSigningKey(forge, { businessName, now = new Date() }) {
  const keys = await crypto.subtle.generateKey(
    { ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  let raw = '';
  for (const byte of pkcs8) raw += String.fromCharCode(byte);
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(raw));
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  const serial = new Uint8Array(16);
  crypto.getRandomValues(serial);
  serial[0] &= 0x7f; // positive serial number
  cert.serialNumber = Array.from(serial, (byte) => byte.toString(16).padStart(2, '0')).join('');
  cert.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(now.getTime());
  cert.validity.notAfter.setFullYear(now.getFullYear() + 10);
  const subject = [
    { shortName: 'CN', value: certificateName(businessName) },
    { shortName: 'O', value: 'PrintShopLedger' },
  ];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  // QZ Tray treats override.crt as a root certificate, like its own demo certificates.
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(privateKey, forge.md.sha256.create());
  return { certificate: forge.pki.certificateToPem(cert), privateKey: pem('PRIVATE KEY', pkcs8) };
}

/** Load a PKCS#8 PEM private key for signing (keep the result; importing is the slow part). */
export const importSigningKey = (privateKeyPem) =>
  crypto.subtle.importKey('pkcs8', unpem(privateKeyPem), algorithm, false, ['sign']);

/** Sign the text QZ Tray asks for (qz.security.setSignatureAlgorithm('SHA512')); base64 result. */
export async function signForQz(key, toSign) {
  const signature = new Uint8Array(
    await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(toSign)),
  );
  let binary = '';
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}
