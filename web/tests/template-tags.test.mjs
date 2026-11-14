import test from 'node:test';
import assert from 'node:assert/strict';
import { bookTemplate } from './pricing-fixture.mjs';
import { knownSpelling, templateTags, validateTemplate } from '../src/pricing-templates.mjs';

test('a category or tag takes the spelling already in use', () => {
  const known = ['Bags', 'Wedding cards'];
  assert.equal(knownSpelling('bag', known), 'Bags');
  assert.equal(knownSpelling('BAGS', known), 'Bags');
  assert.equal(knownSpelling('wedding card', known), 'Wedding cards');
  assert.equal(knownSpelling('  Banners ', known), 'Banners');
  assert.equal(knownSpelling('', known), '');
});

test('tags: each once, at most 10, kept on the template', () => {
  assert.deepEqual(templateTags(['Wedding', 'wedding', ' Gift  box ']), ['Wedding', 'Gift box']);
  assert.throws(() => templateTags(Array.from({ length: 11 }, (_, i) => `t${i}`)), /at most 10/);
  const t = validateTemplate({ ...bookTemplate(), tags: ['Wedding', 'Gift'] });
  assert.deepEqual(t.tags, ['Wedding', 'Gift']);
  assert.equal('tags' in validateTemplate({ ...bookTemplate(), tags: [] }), false);
});
