import { test } from 'node:test';
import assert from 'node:assert';

process.env.HISTORY_FILE = '/tmp/md-memo-agent-test.json';

const { saveHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');

function collector() {
  const events = [];
  return { emit: (e, d) => events.push([e, d]), events, names: () => events.map(e => e[0]) };
}

test('read tool executes live, then agent answers', async () => {
  saveHistory([{ id: 1, markdown: '# A', tags: ['x'], preview: '# A', createdAt: 't', raw: 'alpha' }]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: 'searching',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_memos', arguments: '{"query":"alpha"}' } }] },
      usage: { total_tokens: 10 } };
    return { message: { role: 'assistant', content: 'final answer' }, usage: { total_tokens: 5 } };
  };
  const c = collector();
  await runAgent('find alpha', c.emit, { callModel: fake });
  assert.deepStrictEqual(c.names(), ['start', 'message', 'tool_call', 'tool_result', 'message', 'answer', 'done']);
  const done = c.events.find(e => e[0] === 'done')[1];
  assert.strictEqual(done.tokens, 15);
});

test('write tool emits a proposal and is NOT applied', async () => {
  saveHistory([]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_memo', arguments: '{"markdown":"# New","tags":["t"]}' } }] },
      usage: {} };
    return { message: { role: 'assistant', content: 'proposed' }, usage: {} };
  };
  const c = collector();
  await runAgent('make a memo', c.emit, { callModel: fake });
  assert.ok(c.names().includes('proposal'));
  assert.ok(!c.names().includes('tool_result'));   // writes never execute in-loop
  assert.strictEqual((await import('../src/store.js')).loadHistory().length, 0); // nothing written
});

test('stops at MAX_STEPS without infinite loop', async () => {
  const fake = async () => ({ message: { role: 'assistant', content: 'again',
    tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_tags', arguments: '{}' } }] }, usage: {} });
  const c = collector();
  await runAgent('loop forever', c.emit, { callModel: fake });
  const done = c.events.find(e => e[0] === 'done')[1];
  assert.strictEqual(done.steps, 8);
  assert.ok(c.events.some(e => e[0] === 'answer'));
});
