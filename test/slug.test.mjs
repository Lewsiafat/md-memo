import { test } from 'node:test';
import assert from 'node:assert';
import { deriveTitle, slugify, uniqueSlug } from '../src/slug.js';

test('deriveTitle picks the first heading line, stripped', () => {
  assert.strictEqual(deriveTitle('intro text\n\n## **Real** `Title`\n\nbody'), 'Real Title');
});

test('deriveTitle falls back to the first non-empty line', () => {
  assert.strictEqual(deriveTitle('\n\njust a plain line\nmore'), 'just a plain line');
});

test('deriveTitle handles empty/blank markdown', () => {
  assert.strictEqual(deriveTitle(''), '(untitled)');
  assert.strictEqual(deriveTitle('   \n  '), '(untitled)');
});

test('slugify kebab-cases and strips punctuation', () => {
  assert.strictEqual(slugify('Hello,  World! v2.0'), 'hello-world-v2-0');
});

test('slugify keeps CJK characters', () => {
  assert.strictEqual(slugify('Claude Code 使用心得'), 'claude-code-使用心得');
});

test('slugify returns "memo" when nothing survives', () => {
  assert.strictEqual(slugify('!!! ...'), 'memo');
});

test('uniqueSlug appends -2, -3… on collision', () => {
  assert.strictEqual(uniqueSlug('a', new Set()), 'a');
  assert.strictEqual(uniqueSlug('a', new Set(['a'])), 'a-2');
  assert.strictEqual(uniqueSlug('a', new Set(['a', 'a-2'])), 'a-3');
});
