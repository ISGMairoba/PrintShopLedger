import assert from 'node:assert/strict';
import test from 'node:test';
import { entryKind, isAllowed, keepAllowed, phoneProblem } from '../src/input-guard.mjs';

const field = (attrs = {}, extra = {}) => ({
  tagName: 'INPUT',
  readOnly: false,
  dataset: {},
  getAttribute: (name) => attrs[name] ?? null,
  ...extra,
});

test('fields are told apart by type and inputmode', () => {
  assert.equal(entryKind(field({ type: 'tel' })), 'phone');
  assert.equal(entryKind(field({ type: 'text', inputmode: 'tel' })), 'phone');
  assert.equal(entryKind(field({ type: 'number' })), 'number');
  assert.equal(entryKind(field({ inputmode: 'decimal' })), 'decimal');
  assert.equal(entryKind(field({ inputmode: 'numeric' })), 'whole');
  assert.equal(entryKind(field({ type: 'text' })), null);
  assert.equal(entryKind(field({ type: 'tel' }, { readOnly: true })), null);
  assert.equal(entryKind(field({ type: 'tel' }, { dataset: { anyText: '' } })), null);
  assert.equal(entryKind({ tagName: 'TEXTAREA', getAttribute: () => null }), null);
});

test('letters are refused; digits and number signs are not', () => {
  assert.equal(isAllowed('phone', '+234 (803) 123-4567'), true);
  assert.equal(isAllowed('phone', 'Ada'), false);
  assert.equal(isAllowed('decimal', '1,250.50'), true);
  assert.equal(isAllowed('decimal', '12a'), false);
  assert.equal(isAllowed('whole', '12'), true);
  assert.equal(isAllowed('whole', '1.5'), false);
  assert.equal(isAllowed('number', '-2.5'), true);
  assert.equal(keepAllowed('phone', 'Tel: 0803 123 4567'), ' 0803 123 4567');
});

test('phone numbers must look complete', () => {
  assert.equal(phoneProblem(''), '');
  assert.equal(phoneProblem('08031234567'), '');
  assert.equal(phoneProblem('+234 803 123 4567'), '');
  assert.equal(phoneProblem('Mr Bayo'), 'Phone numbers can only have digits, spaces, + and -.');
  assert.equal(phoneProblem('0803'), 'This phone number is too short.');
  assert.equal(phoneProblem('0803123456789012345'), 'This phone number is too long.');
});
