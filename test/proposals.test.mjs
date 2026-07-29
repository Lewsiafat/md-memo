import { test } from 'node:test';
import assert from 'node:assert';

const { registerProposal, takeProposal } = await import('../src/proposals.js');

test('registerProposal returns an id; takeProposal consumes exactly once', () => {
  const p = { action: 'create_memo', args: { markdown: '# x' }, summary: 's' };
  const id = registerProposal(p);
  assert.ok(typeof id === 'string' && id.length > 0);
  assert.strictEqual(takeProposal(id), p);
  assert.strictEqual(takeProposal(id), null);   // one-time: second take misses
});

test('takeProposal returns null for unknown or missing ids', () => {
  assert.strictEqual(takeProposal('nope'), null);
  assert.strictEqual(takeProposal(undefined), null);
});

test('registry evicts the oldest entry beyond 200 pending', () => {
  const first = registerProposal({ action: 'create_memo', args: {}, summary: 'first' });
  for (let i = 0; i < 200; i++) {
    registerProposal({ action: 'create_memo', args: {}, summary: `p${i}` });
  }
  assert.strictEqual(takeProposal(first), null);   // evicted, not consumable
});
