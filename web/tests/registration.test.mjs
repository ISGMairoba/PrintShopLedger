import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSignup,
  validateBusinessRegistration,
  validateNewPassword,
  validActivationToken,
  developerActivationEmail,
} from '../src/registration.mjs';
test('signup validates names, email, passwords and excludes privilege fields', () => {
  const values = {
    businessName: ' Shop ',
    ownerName: ' Owner ',
    email: ' Owner@Example.com ',
    password: 'example-password',
    confirmPassword: 'example-password',
    role: 'developer',
    developerEmail: 'attacker@example.com',
  };
  assert.deepEqual(validateSignup(values), {
    businessName: 'Shop',
    ownerName: 'Owner',
    email: 'owner@example.com',
    password: 'example-password',
  });
  for (const change of [
    { businessName: '' },
    { ownerName: '' },
    { email: 'bad' },
    { email: 'a b@example.com' },
    { password: 'short' },
    { confirmPassword: 'other' },
    { businessName: 'x'.repeat(161) },
  ])
    assert.throws(() => validateSignup({ ...values, ...change }));
  assert.throws(() => validateBusinessRegistration({ businessName: 'Shop' }));
  assert.throws(() => validateNewPassword('x'.repeat(129)));
});
test('activation tokens are bounded and notification content safely escapes business data', () => {
  assert.equal(validActivationToken('a'.repeat(64)), true);
  for (const token of ['', null, 'a'.repeat(63), 'g'.repeat(64)])
    assert.equal(validActivationToken(token), false);
  const mail = developerActivationEmail({
    business_name: '<img src=x onerror=alert(1)>',
    shop_id: 'id',
    owner_email: 'owner@example.com',
    activation_url: 'https://print-shop-ledger.vercel.app/#developer_activation=' + 'a'.repeat(64),
  });
  assert.ok(!mail.html.includes('<img'));
  assert.ok(mail.html.includes('&lt;img'));
  assert.ok(mail.text.includes('Developer username: developer'));
  assert.ok(!mail.text.includes('Password:'));
});
