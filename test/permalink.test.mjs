import { test } from 'node:test';
import assert from 'node:assert';
import { renderPermalink } from '../src/permalink.js';

const entry = {
  id: 101,
  markdown: '# Hello\n\nBody **bold**',
  tags: ['alpha', 'beta'],
  createdAt: '2026-06-20T08:00:00.000Z',
  preview: '# Hello',
};

test('renderPermalink embeds title, tags, markdown, and base path', () => {
  const html = renderPermalink(entry, '/md-memo');
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<title>Hello — md-memo</title>'));
  assert.ok(html.includes('<span class="tag">alpha</span>'));
  assert.ok(html.includes('<span class="tag">beta</span>'));
  // markdown is embedded as a JSON string literal for the client-side marked.parse
  assert.ok(html.includes(JSON.stringify(entry.markdown)));
  // every internal link uses the base path
  assert.ok(html.includes('href="/md-memo/"'));
});

test('renderPermalink strips heading marks and escapes angle brackets in the title', () => {
  const html = renderPermalink({ ...entry, preview: '## A <x> B' }, '/md-memo');
  assert.ok(html.includes('<title>A &lt;x&gt; B — md-memo</title>'));
});

test('renderPermalink escapes XSS vectors in markdown, tags, and preview', () => {
  const html = renderPermalink({
    ...entry,
    markdown: '</script><script>alert(1)</script>',
    tags: ['<img src=x onerror=1>'],
    preview: 'x" onload="alert(1)',
  }, '/md-memo');
  assert.ok(!html.includes('</script><script>'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('content="x" onload='));
});

test('renderPermalink loads DOMPurify and sanitizes the marked output (S-02)', () => {
  const html = renderPermalink({ ...entry, markdown: '<img src=x onerror=alert(1)>' }, '/md-memo');
  assert.ok(html.includes('https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js'));
  assert.ok(html.includes('DOMPurify.sanitize(marked.parse(raw))'));
  // the raw markdown stays inert inside a JSON string literal until sanitized client-side
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});
