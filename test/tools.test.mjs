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

const { buildProposal, applyProposal } = await import('../src/tools.js');

test('buildProposal summarizes each write action', () => {
  assert.match(buildProposal('merge_memos', { source_ids: [1, 2], title: 'X' }).summary, /合併 2 篇/);
  assert.strictEqual(buildProposal('retag_memo', { id: 1, tags: ['a'] }).action, 'retag_memo');
});

test('applyProposal create_memo inserts a memo', () => {
  saveHistory([]);
  const r = applyProposal({ action: 'create_memo', args: { markdown: '# New', tags: ['t'] } });
  assert.ok(r.ok && r.id);
  assert.strictEqual(readMemo({ id: r.id }).markdown, '# New');
});

test('applyProposal merge_memos records sources and validates ids', () => {
  saveHistory([
    { id: 1, markdown: 'a', tags: [], preview: 'a', createdAt: 't', raw: '' },
    { id: 2, markdown: 'b', tags: [], preview: 'b', createdAt: 't', raw: '' },
  ]);
  const ok = applyProposal({ action: 'merge_memos', args: { source_ids: [1, 2], title: 'M', markdown: 'merged', tags: ['m'] } });
  assert.ok(ok.ok);
  const bad = applyProposal({ action: 'merge_memos', args: { source_ids: [1, 999], markdown: 'x' } });
  assert.strictEqual(bad.ok, false);
});

test('applyProposal link_memos cross-links and validates', async () => {
  saveHistory([
    { id: 1, markdown: 'a', tags: [], preview: 'a', createdAt: 't', raw: '' },
    { id: 2, markdown: 'b', tags: [], preview: 'b', createdAt: 't', raw: '' },
  ]);
  const r = applyProposal({ action: 'link_memos', args: { ids: [1, 2] } });
  assert.ok(r.ok);
  const reread = (await import('../src/store.js')).loadHistory();
  assert.deepStrictEqual(reread.find(m => m.id === 1).links, [2]);
  assert.strictEqual(applyProposal({ action: 'link_memos', args: { ids: [1, 999] } }).ok, false);
});

test('applyProposal retag_memo replaces tags', () => {
  saveHistory([{ id: 1, markdown: 'a', tags: ['old'], preview: 'a', createdAt: 't', raw: '' }]);
  assert.ok(applyProposal({ action: 'retag_memo', args: { id: 1, tags: ['new'] } }).ok);
  assert.strictEqual(applyProposal({ action: 'retag_memo', args: { id: 999, tags: [] } }).ok, false);
});

test('applyProposal rejects unknown actions', () => {
  assert.strictEqual(applyProposal({ action: 'delete_everything', args: {} }).ok, false);
});
