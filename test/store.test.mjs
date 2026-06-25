import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-store-test.json';
fs.rmSync(process.env.HISTORY_FILE, { force: true });

const { loadHistory, saveHistory, createEntry, insertEntry, clearHistory, HISTORY_LIMIT } =
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

test('insertEntry prepends and enforces the limit', () => {
  saveHistory([]);
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    insertEntry(createEntry({ markdown: `m${i}` }));
  }
  const h = loadHistory();
  assert.strictEqual(h.length, HISTORY_LIMIT);
  assert.strictEqual(h[0].markdown, `m${HISTORY_LIMIT + 4}`);
});

test('clearHistory backs up to a .bak file then empties history', () => {
  saveHistory([createEntry({ markdown: 'keep me' }), createEntry({ markdown: 'and me' })]);
  const r = clearHistory();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.backedUp, true);
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(loadHistory(), []);
  const bak = process.env.HISTORY_FILE.replace(/\.json$/, '') + '.bak.json';
  assert.ok(fs.existsSync(bak), 'backup file exists');
  assert.strictEqual(JSON.parse(fs.readFileSync(bak, 'utf8')).length, 2);
});

test('clearHistory on a missing file reports backedUp:false', () => {
  fs.rmSync(process.env.HISTORY_FILE, { force: true });
  const r = clearHistory();
  assert.strictEqual(r.backedUp, false);
  assert.strictEqual(r.count, 0);
  assert.deepStrictEqual(loadHistory(), []);
});
