import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-tools-test.json';

const { saveHistory, insertEntry, createEntry } = await import('../src/store.js');
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

test('searchMemos results include the memo title', () => {
  saveHistory([]);
  insertEntry(createEntry({ markdown: '# Docker Deploy Notes\n\nsteps here', tags: ['deploy'] }));
  const r = searchMemos({ query: 'docker' });
  assert.strictEqual(r[0].title, 'Docker Deploy Notes');
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

test('applyProposal create_memo without markdown returns ok:false, does not throw', () => {
  saveHistory([]);
  const r = applyProposal({ action: 'create_memo', args: {} });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

test('applyProposal merge_memos without markdown returns ok:false, does not throw', () => {
  saveHistory([{ id: 1, markdown: 'a', tags: [], preview: 'a', createdAt: 't', raw: '' }]);
  const r = applyProposal({ action: 'merge_memos', args: { source_ids: [1] } });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
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

const { validateProposal } = await import('../src/tools.js');

test('validateProposal passes valid args for every action', () => {
  seed();
  assert.deepStrictEqual(validateProposal('create_memo', { markdown: '# x' }), { ok: true });
  assert.ok(validateProposal('merge_memos', { source_ids: [1, 2], markdown: 'm' }).ok);
  assert.ok(validateProposal('link_memos', { ids: [1, 3] }).ok);
  assert.ok(validateProposal('retag_memo', { id: 2, tags: [] }).ok);
});

test('validateProposal rejects empty markdown, unknown ids, unknown actions', () => {
  seed();
  assert.strictEqual(validateProposal('create_memo', {}).ok, false);
  assert.strictEqual(validateProposal('merge_memos', { source_ids: [1], markdown: '   ' }).ok, false);
  assert.match(validateProposal('merge_memos', { source_ids: [1, 999], markdown: 'm' }).error, /999/);
  assert.match(validateProposal('link_memos', { ids: [999] }).error, /999/);
  assert.strictEqual(validateProposal('retag_memo', { id: 999 }).ok, false);
  assert.strictEqual(validateProposal('delete_everything', {}).ok, false);
  // Lock error message parity: id converted to Number (undefined→NaN, '007'→7)
  assert.strictEqual(validateProposal('retag_memo', {}).error, 'No memo with id NaN');
  assert.strictEqual(validateProposal('retag_memo', { id: '007' }).error, 'No memo with id 7');
});
