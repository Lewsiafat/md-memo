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

test('invalid write args feed the error back to the model (no proposal)', async () => {
  saveHistory([]);   // empty library → source id 999 is invalid
  let secondTurnMessages = null;
  let turn = 0;
  const fake = async (messages) => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'merge_memos', arguments: '{"source_ids":[999],"markdown":"m"}' } }] },
      usage: {} };
    secondTurnMessages = messages;
    return { message: { role: 'assistant', content: 'corrected' }, usage: {} };
  };
  const c = collector();
  await runAgent('merge stuff', c.emit, { callModel: fake });
  assert.ok(!c.names().includes('proposal'), 'invalid args never become a proposal');
  const tr = c.events.find(e => e[0] === 'tool_result')[1];
  assert.match(tr.result.error, /999/);
  const toolMsg = secondTurnMessages.find(m => m.role === 'tool');
  assert.match(toolMsg.content, /999/, 'model saw the validation error');
});

test('valid write proposal event carries a one-time registered id', async () => {
  saveHistory([]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_memo', arguments: '{"markdown":"# New"}' } }] },
      usage: {} };
    return { message: { role: 'assistant', content: 'done' }, usage: {} };
  };
  const c = collector();
  await runAgent('make a memo', c.emit, { callModel: fake });
  const prop = c.events.find(e => e[0] === 'proposal')[1];
  assert.ok(typeof prop.id === 'string' && prop.id.length > 0);
  assert.strictEqual(prop.action, 'create_memo');
  const { takeProposal } = await import('../src/proposals.js');
  const stored = takeProposal(prop.id);
  assert.strictEqual(stored.action, 'create_memo');
  assert.strictEqual(takeProposal(prop.id), null);   // consumed
});
