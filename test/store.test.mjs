import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

process.env.HISTORY_FILE = '/tmp/md-memo-store-test.json';
fs.rmSync(process.env.HISTORY_FILE, { force: true });
process.env.HISTORY_LIMIT = '30';

const { loadHistory, saveHistory, createEntry, insertEntry, updateEntry, clearHistory, historyLimit, listEntries } =
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

test('listEntries paginates lightweight fields with total/all', () => {
  saveHistory([]);
  for (let i = 0; i < 5; i++) {
    insertEntry(createEntry({ raw: `raw${i}`, markdown: `# N${i}`, tags: i % 2 ? ['odd'] : ['even'] }));
  }
  const page = listEntries({ limit: 2, offset: 1 });
  assert.strictEqual(page.total, 5);
  assert.strictEqual(page.all, 5);
  assert.strictEqual(page.items.length, 2);
  assert.strictEqual(page.items[0].title, 'N3');       // newest-first, offset 1
  assert.ok(!('markdown' in page.items[0]), 'no full text in list items');
  assert.ok(!('raw' in page.items[0]), 'no raw in list items');
  assert.ok(page.items[0].slug, 'slug included');
});

test('listEntries filters by tag (total follows the filter, all does not)', () => {
  const r = listEntries({ tag: 'odd' });
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.all, 5);
  assert.ok(r.items.every(e => e.tags.includes('odd')));
});

test('listEntries order asc returns oldest first', () => {
  const r = listEntries({ order: 'asc', limit: 1 });
  assert.strictEqual(r.items[0].title, 'N0');
});

test('loadHistory quarantines a corrupted file and returns []', () => {
  const f = process.env.HISTORY_FILE;
  const dir = path.dirname(f);
  const prefix = path.basename(f).replace(/\.json$/, '') + '.corrupt-';
  // clean stale quarantine files from previous runs
  for (const n of fs.readdirSync(dir).filter(n => n.startsWith(prefix))) {
    fs.rmSync(path.join(dir, n), { force: true });
  }
  fs.writeFileSync(f, '{ not valid json');
  assert.deepStrictEqual(loadHistory(), []);
  assert.ok(!fs.existsSync(f), 'corrupted file moved away');
  const quarantined = fs.readdirSync(dir).filter(n => n.startsWith(prefix));
  assert.strictEqual(quarantined.length, 1);
  assert.match(quarantined[0], /\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  const qPath = path.join(dir, quarantined[0]);
  assert.strictEqual(fs.readFileSync(qPath, 'utf8'), '{ not valid json', 'original bytes preserved');
  fs.rmSync(qPath, { force: true });
});

test('loadHistory quarantines valid JSON that is not an array', () => {
  const f = process.env.HISTORY_FILE;
  const dir = path.dirname(f);
  const prefix = path.basename(f).replace(/\.json$/, '') + '.corrupt-';
  fs.writeFileSync(f, '"just a string"');
  assert.deepStrictEqual(loadHistory(), []);
  assert.ok(!fs.existsSync(f));
  for (const n of fs.readdirSync(dir).filter(n => n.startsWith(prefix))) {
    fs.rmSync(path.join(dir, n), { force: true });
  }
});

test('saveHistory writes atomically and leaves no .tmp residue', () => {
  saveHistory([createEntry({ markdown: '# atomic' })]);
  assert.ok(fs.existsSync(process.env.HISTORY_FILE));
  assert.ok(!fs.existsSync(process.env.HISTORY_FILE + '.tmp'));
  assert.strictEqual(loadHistory()[0].markdown, '# atomic');
});
