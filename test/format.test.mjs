import { test } from 'node:test';
import assert from 'node:assert';
import { parseFormatResult } from '../src/format.js';

test('parseFormatResult: complete response (finish_reason stop) → not truncated, tags parsed, tags line stripped', () => {
  const data = {
    choices: [{
      finish_reason: 'stop',
      message: { content: '# Title\n\nSome body text.\n\n<!-- tags: alpha, beta -->' },
    }],
  };
  const result = parseFormatResult(data);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.tags, ['alpha', 'beta']);
  assert.equal(result.markdown, '# Title\n\nSome body text.');
});

test('parseFormatResult: truncated response (finish_reason length, no tags line) → truncated, empty tags, content kept', () => {
  const data = {
    choices: [{
      finish_reason: 'length',
      message: { content: '# Title\n\nSome long body that got cut off mid-sen' },
    }],
  };
  const result = parseFormatResult(data);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.tags, []);
  assert.equal(result.markdown, '# Title\n\nSome long body that got cut off mid-sen');
});
