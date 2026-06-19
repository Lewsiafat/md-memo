// Smoke test for the agent loop. Uses a fake model so it needs no API key.
// Run: npm run smoke
import assert from 'node:assert';

process.env.HISTORY_FILE = process.env.HISTORY_FILE || '/tmp/md-memo-smoke.json';
const { saveHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');

saveHistory([{ id: 1, markdown: '# Demo', tags: ['demo'], preview: '# Demo', createdAt: 't', raw: 'hello world' }]);

let turn = 0;
const fakeModel = async () => {
  turn++;
  if (turn === 1) return {
    message: { role: 'assistant', content: 'looking it up',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_memos', arguments: '{"query":"hello"}' } }] },
    usage: { total_tokens: 12 },
  };
  return { message: { role: 'assistant', content: 'all done' }, usage: { total_tokens: 8 } };
};

const events = [];
await runAgent('smoke', (e, d) => events.push([e, d]), { callModel: fakeModel });
const names = events.map(e => e[0]);

assert(names.includes('tool_call'), 'expected a tool_call event');
assert(names.includes('tool_result'), 'expected a tool_result event');
assert(names.includes('answer'), 'expected an answer event');
assert(names.includes('done'), 'expected a done event');
assert(!names.includes('error'), 'unexpected error event');

console.log('✓ smoke-agent passed:', names.join(' → '));
