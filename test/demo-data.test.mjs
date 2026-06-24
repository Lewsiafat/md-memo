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
