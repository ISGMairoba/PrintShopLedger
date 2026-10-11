import test from 'node:test';
import assert from 'node:assert/strict';
import { certificateName, importSigningKey, signForQz } from '../src/print-signing.mjs';

test('certificate names are single-line and at most 64 characters', () => {
  assert.equal(certificateName('  SMGraphics\n2  '), 'SMGraphics 2');
  assert.equal(certificateName('x'.repeat(80)).length, 64);
  assert.equal(certificateName(''), 'PrintShopLedger business');
});

test('QZ signatures are SHA-512 RSA over the exact text, base64 encoded', async () => {
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' };
  const pair = await crypto.subtle.generateKey(
    { ...algorithm, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.replace(/.{1,64}/g, '$&\n')}-----END PRIVATE KEY-----\n`;
  const key = await importSigningKey(pem);
  const text = '{"call":"print","timestamp":1}';
  const signature = await signForQz(key, text);
  const bytes = Buffer.from(signature, 'base64');
  assert.equal(bytes.length, 256);
  assert.ok(await crypto.subtle.verify(algorithm, pair.publicKey, bytes, new TextEncoder().encode(text)));
  assert.ok(
    !(await crypto.subtle.verify(algorithm, pair.publicKey, bytes, new TextEncoder().encode(text + ' '))),
  );
});
