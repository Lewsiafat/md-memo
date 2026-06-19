import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-tools-test.json';

const { saveHistory } = await import('../src/store.js');
const { searchMemos, readMemo, listTags, runReadTool, TOOLS, TOOL_KIND } =
  await import('../src/tools.js');

function seed() {
  saveHistory([
    { id: 1, createdAt: 't', raw: 'project alpha kickoff', markdown: '# Alpha\n\nkickoff notes', tags: ['work'], preview: '# Alpha' },
    { id: 2, createdAt: 't', raw: 'grocery list', markdown: '# Groceries\n\nmilk', tags: ['home'], preview: '# Groceries' },
    { id: 3, createdAt: 't', raw: 'alpha retro', markdown: '# Alpha retro\n\nwhat went well', tags: ['work'], preview: '# Alpha retro' },
  ]);
}

test('searchMemos ranks title hits higher and filters non-matches', () => {
  seed();
  const r = searchMemos({ query: 'alpha' });
  assert.deepStrictEqual(r.map(x => x.id), [1, 3]);   // both match, none of #2
  assert.ok(r[0].snippet.length > 0);
});

test('searchMemos respects limit and empty query', () => {
  seed();
  assert.strictEqual(searchMemos({ query: 'alpha', limit: 1 }).length, 1);
  assert.deepStrictEqual(searchMemos({ query: '   ' }), []);
});

test('readMemo returns full memo or an error object', () => {
  seed();
  assert.strictEqual(readMemo({ id: 2 }).markdown, '# Groceries\n\nmilk');
  assert.ok(readMemo({ id: 999 }).error);
});

test('listTags counts and sorts descending', () => {
  seed();
  const tags = listTags();
  assert.deepStrictEqual(tags[0], { tag: 'work', count: 2 });
});

test('TOOLS/TOOL_KIND are consistent', () => {
  const names = TOOLS.map(t => t.function.name);
  assert.deepStrictEqual(new Set(names), new Set(Object.keys(TOOL_KIND)));
  assert.strictEqual(TOOL_KIND.search_memos, 'read');
  assert.strictEqual(TOOL_KIND.merge_memos, 'write');
});

test('runReadTool dispatches by name', () => {
  seed();
  assert.ok(Array.isArray(runReadTool('search_memos', { query: 'alpha' })));
  assert.ok(runReadTool('nope', {}).error);
});
