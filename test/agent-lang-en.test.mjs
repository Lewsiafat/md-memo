import { test } from 'node:test';
import assert from 'node:assert';

// Runs in its own process (node --test isolation), so AGENT_LANG here
// doesn't leak into the other test files that rely on the zh-TW default.
process.env.HISTORY_FILE = '/tmp/md-memo-agent-lang-en-test.json';
process.env.AGENT_LANG = 'en';

const { buildProposal } = await import('../src/tools.js');
const { runAgent } = await import('../src/agent.js');

test('buildProposal summaries are English when AGENT_LANG is not zh', () => {
  assert.strictEqual(buildProposal('create_memo', { markdown: '# N', tags: ['a', 'b'] }).summary, 'New memo (a, b)');
  assert.strictEqual(buildProposal('create_memo', { markdown: '# N' }).summary, 'New memo (no tags)');
  assert.strictEqual(buildProposal('merge_memos', { source_ids: [1, 2], title: 'X' }).summary, 'Merge 2 memos into "X"');
  assert.strictEqual(buildProposal('merge_memos', { source_ids: [1] }).summary, 'Merge 1 memos into "Untitled"');
  assert.strictEqual(buildProposal('link_memos', { ids: [1, 2, 3] }).summary, 'Link 3 memos');
  assert.strictEqual(buildProposal('retag_memo', { id: 7, tags: ['x', 'y'] }).summary, 'Retag #7 to x, y');
});

test('max-steps fallback answer is English when AGENT_LANG is not zh', async () => {
  const fake = async () => ({ message: { role: 'assistant', content: 'again',
    tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_tags', arguments: '{}' } }] }, usage: {} });
  const events = [];
  await runAgent('loop forever', (e, d) => events.push([e, d]), { callModel: fake });
  const answer = events.find(e => e[0] === 'answer')[1];
  assert.strictEqual(answer.content, '(Reached the 8-step limit; partial progress above.)');
});
