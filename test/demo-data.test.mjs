import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(path.join(dir, '..', p), 'utf8'));

const history = read('demo/data/history.json');

test('history has 10 memos with the canonical shape and unique ids', () => {
  assert.strictEqual(history.length, 10);
  const ids = new Set();
  for (const e of history) {
    assert.ok(typeof e.id === 'number', `id is number: ${e.id}`);
    assert.ok(typeof e.markdown === 'string' && e.markdown.length > 0);
    assert.ok(Array.isArray(e.tags));
    assert.ok(typeof e.preview === 'string' && e.preview.length > 0);
    assert.ok(!Number.isNaN(Date.parse(e.createdAt)));
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
  }
});

test('history is sorted newest-first', () => {
  for (let i = 1; i < history.length; i++) {
    assert.ok(
      Date.parse(history[i - 1].createdAt) >= Date.parse(history[i].createdAt),
      `entry ${i} out of order`
    );
  }
});

test('the four ids referenced by the agent trace exist', () => {
  const ids = new Set(history.map(e => e.id));
  for (const id of [108, 107, 106, 104]) assert.ok(ids.has(id), `missing ${id}`);
});

const fmt = read('demo/data/format-samples.json');
const trace = read('demo/data/agent-trace.json');

test('format-samples has prefill text and a canned result', () => {
  assert.ok(typeof fmt.prefill === 'string' && fmt.prefill.trim().length > 0);
  assert.ok(typeof fmt.result.markdown === 'string' && fmt.result.markdown.length > 0);
  assert.ok(Array.isArray(fmt.result.tags) && fmt.result.tags.length > 0);
});

test('agent trace is a well-formed event sequence', () => {
  assert.ok(typeof trace.question === 'string' && trace.question.length > 0);
  const kinds = trace.events.map(e => e.event);
  assert.strictEqual(kinds[0], 'start');
  assert.strictEqual(kinds.at(-1), 'done');
  assert.strictEqual(kinds.filter(k => k === 'proposal').length, 1, 'exactly one proposal');
  assert.ok(kinds.includes('answer'));
});

test('every id the trace references exists in history; applyId does not collide', () => {
  const ids = new Set(history.map(e => e.id));
  const referenced = new Set();
  for (const ev of trace.events) {
    if (ev.event === 'tool_call' && ev.data.name === 'read_memo') referenced.add(ev.data.args.id);
    if (ev.event === 'tool_result' && Array.isArray(ev.data.result)) {
      for (const r of ev.data.result) if (typeof r.id === 'number') referenced.add(r.id);
    }
    if (ev.event === 'proposal') for (const id of ev.data.args.source_ids) referenced.add(id);
  }
  for (const id of referenced) assert.ok(ids.has(id), `trace references missing id ${id}`);
  assert.ok(!ids.has(trace.apply.id), `applyId ${trace.apply.id} collides with a seed id`);
  assert.ok(!Number.isNaN(Date.parse(trace.apply.createdAt)));
});

test('proposal is a merge_memos write with full markdown', () => {
  const prop = trace.events.find(e => e.event === 'proposal').data;
  assert.strictEqual(prop.action, 'merge_memos');
  assert.ok(prop.args.markdown.length > 0);
  assert.ok(Array.isArray(prop.args.source_ids) && prop.args.source_ids.length >= 2);
  assert.ok(typeof prop.summary === 'string' && prop.summary.length > 0);
});
