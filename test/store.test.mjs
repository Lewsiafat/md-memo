import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-store-test.json';
fs.rmSync(process.env.HISTORY_FILE, { force: true });
process.env.HISTORY_LIMIT = '30';

const { loadHistory, saveHistory, createEntry, insertEntry, updateEntry, clearHistory, historyLimit } =
  await import('../src/store.js');

test('loadHistory returns [] when file missing', () => {
  assert.deepStrictEqual(loadHistory(), []);
});

test('createEntry builds the canonical shape', () => {
  const e = createEntry({ raw: 'r', markdown: '# Title\n\nbody', tags: ['a'] });
  assert.strictEqual(e.markdown, '# Title\n\nbody');
  assert.strictEqual(e.preview, '# Title');
  assert.deepStrictEqual(e.tags, ['a']);
  assert.ok(typeof e.id === 'number');
  assert.ok(e.createdAt);
});

test('createEntry attaches optional sources/links only when given', () => {
  const plain = createEntry({ markdown: 'x' });
  assert.ok(!('sources' in plain));
  assert.ok(!('links' in plain));
  const rich = createEntry({ markdown: 'x', sources: [1], links: [2] });
  assert.deepStrictEqual(rich.sources, [1]);
  assert.deepStrictEqual(rich.links, [2]);
});

test('historyLimit reads HISTORY_LIMIT env (default 1000 when unset)', () => {
  assert.strictEqual(historyLimit(), 30);   // set at top of this file
});

test('insertEntry: consecutive inserts yield distinct ids (no same-ms collision)', () => {
  saveHistory([]);
  const a = insertEntry(createEntry({ markdown: 'a' }));
  const b = insertEntry(createEntry({ markdown: 'b' }));
  assert.notStrictEqual(a.id, b.id);
});

test('insertEntry prepends and enforces the limit', () => {
  saveHistory([]);
  for (let i = 0; i < historyLimit() + 5; i++) {
    insertEntry(createEntry({ markdown: `m${i}` }));
  }
  const h = loadHistory();
  assert.strictEqual(h.length, historyLimit());
  assert.strictEqual(h[0].markdown, `m${historyLimit() + 4}`);
});

test('clearHistory backs up to a timestamped .bak.json then empties history', () => {
  saveHistory([createEntry({ markdown: 'keep me' }), createEntry({ markdown: 'and me' })]);
  const r = clearHistory();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.backedUp, true);
  assert.strictEqual(r.count, 2);
  assert.ok(typeof r.backupFile === 'string', 'backupFile is a string');
  assert.ok(/\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.bak\.json$/.test(r.backupFile), `backupFile is timestamped: ${r.backupFile}`);
  assert.ok(fs.existsSync(r.backupFile), 'backup file exists on disk');
  assert.strictEqual(JSON.parse(fs.readFileSync(r.backupFile, 'utf8')).length, 2);
  assert.deepStrictEqual(loadHistory(), []);
});

test('clearHistory on a missing file reports backedUp:false', () => {
  fs.rmSync(process.env.HISTORY_FILE, { force: true });
  const r = clearHistory();
  assert.strictEqual(r.backedUp, false);
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.backupFile, null);
  assert.deepStrictEqual(loadHistory(), []);
});

test('updateEntry overwrites markdown/tags in place and recomputes preview', () => {
  saveHistory([{ id: 42, createdAt: 'c', raw: 'r', markdown: '# Old\n\nbody', tags: ['x'], preview: '# Old' }]);
  const updated = updateEntry(42, { markdown: '# New\n\nnew body', tags: ['y', 'z'] });
  assert.strictEqual(updated.markdown, '# New\n\nnew body');
  assert.strictEqual(updated.preview, '# New');
  assert.deepStrictEqual(updated.tags, ['y', 'z']);
  assert.strictEqual(updated.id, 42);            // id preserved
  assert.strictEqual(updated.raw, 'r');          // raw preserved
  assert.strictEqual(loadHistory()[0].markdown, '# New\n\nnew body');
});

test('updateEntry returns null for an unknown id', () => {
  saveHistory([]);
  assert.strictEqual(updateEntry(99999, { markdown: 'x' }), null);
});

test('updateEntry keeps position (does not reorder)', () => {
  saveHistory([
    { id: 2, createdAt: 'b', raw: '', markdown: 'B', tags: [], preview: 'B' },
    { id: 1, createdAt: 'a', raw: '', markdown: 'A', tags: [], preview: 'A' },
  ]);
  updateEntry(1, { markdown: 'A2' });
  const h = loadHistory();
  assert.strictEqual(h[0].id, 2);                // top entry unchanged
  assert.strictEqual(h[1].markdown, 'A2');       // updated in place at index 1
});

test('createEntry derives title from markdown', () => {
  const e = createEntry({ markdown: '# My Note\n\nbody' });
  assert.strictEqual(e.title, 'My Note');
});

test('insertEntry assigns unique, stable slugs for duplicate titles', () => {
  saveHistory([]);
  const a = insertEntry(createEntry({ markdown: '# Same Title' }));
  const b = insertEntry(createEntry({ markdown: '# Same Title' }));
  assert.strictEqual(a.slug, 'same-title');
  assert.strictEqual(b.slug, 'same-title-2');
});

test('loadHistory lazily backfills title/slug on legacy entries and persists once', () => {
  fs.writeFileSync(process.env.HISTORY_FILE, JSON.stringify([
    { id: 1, createdAt: 'a', raw: '', markdown: '# Legacy\n\nx', tags: [], preview: '# Legacy' },
  ]));
  const h = loadHistory();
  assert.strictEqual(h[0].title, 'Legacy');
  assert.strictEqual(h[0].slug, 'legacy');
  // persisted, not just in-memory
  const onDisk = JSON.parse(fs.readFileSync(process.env.HISTORY_FILE, 'utf8'));
  assert.strictEqual(onDisk[0].slug, 'legacy');
});

test('updateEntry recomputes title but never touches slug', () => {
  saveHistory([]);
  const e = insertEntry(createEntry({ markdown: '# Before' }));
  const updated = updateEntry(e.id, { markdown: '# After' });
  assert.strictEqual(updated.title, 'After');
  assert.strictEqual(updated.slug, 'before');   // slug is identity — stable
});
