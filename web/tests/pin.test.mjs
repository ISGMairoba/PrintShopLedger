import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPin, hashPin, pinProblem, validPinHash } from '../src/pin.mjs';

test('PIN rules: 4 to 6 digits, not easy to guess, typed twice the same', () => {
  assert.equal(pinProblem('2580'), '');
  assert.equal(pinProblem('859302', '859302'), '');
  assert.match(pinProblem('123'), /4 to 6 digits/);
  assert.match(pinProblem('1234567'), /4 to 6 digits/);
  assert.match(pinProblem('12a4'), /4 to 6 digits/);
  assert.match(pinProblem('1111'), /harder to guess/);
  assert.match(pinProblem('4321'), /harder to guess/);
  assert.match(pinProblem('2580', '2581'), /do not match/);
});

test('a PIN is kept only as a salted hash, and checks against it', async () => {
  const stored = await hashPin('2580', 20000);
  assert.ok(validPinHash(stored), stored);
  assert.ok(!stored.includes('2580'));
  assert.notEqual(stored, await hashPin('2580', 20000), 'a fresh salt each time');
  assert.equal(await checkPin('2580', stored), true);
  assert.equal(await checkPin('2581', stored), false);
  assert.equal(await checkPin('2580', 'nonsense'), false);
});
