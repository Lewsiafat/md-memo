import { test } from 'node:test';
import assert from 'node:assert';

const { checkPassword, createAuth } = await import('../src/auth.js');

const basic = (user, pass) => 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

// Minimal Express-ish req/res/next doubles
function harness(req = {}) {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    send(b) { this.body = b; return this; },
  };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  return { req, res, next, nextCalled: () => nextCalled };
}

// --- checkPassword (pure) ---

test('checkPassword: correct password returns true', () => {
  assert.strictEqual(checkPassword(basic('anyone', 'secret'), 'secret'), true);
});

test('checkPassword: wrong password returns false', () => {
  assert.strictEqual(checkPassword(basic('anyone', 'nope'), 'secret'), false);
});

test('checkPassword: missing or empty header returns false', () => {
  assert.strictEqual(checkPassword(undefined, 'secret'), false);
  assert.strictEqual(checkPassword('', 'secret'), false);
  assert.strictEqual(checkPassword('Bearer xyz', 'secret'), false);
});

test('checkPassword: empty expected password returns false', () => {
  assert.strictEqual(checkPassword(basic('anyone', ''), ''), false);
});

test('checkPassword: password containing a colon is parsed correctly', () => {
  assert.strictEqual(checkPassword(basic('user', 'pa:ss:word'), 'pa:ss:word'), true);
});

// --- createAuth (middleware factory) ---

test('createAuth: disabled passes through', () => {
  const mw = createAuth({ enabled: false, password: 'secret', publicPrefix: '/md-memo/m/' });
  const h = harness({ path: '/md-memo/api/history', headers: {} });
  mw(h.req, h.res, h.next);
  assert.strictEqual(h.nextCalled(), true);
  assert.strictEqual(h.res.statusCode, null);
});

test('createAuth: enabled but no password passes through', () => {
  const mw = createAuth({ enabled: true, password: '', publicPrefix: '/md-memo/m/' });
  const h = harness({ path: '/md-memo/api/history', headers: {} });
  mw(h.req, h.res, h.next);
  assert.strictEqual(h.nextCalled(), true);
});

test('createAuth: enabled with no credentials returns 401 + WWW-Authenticate', () => {
  const mw = createAuth({ enabled: true, password: 'secret', publicPrefix: '/md-memo/m/' });
  const h = harness({ path: '/md-memo/', headers: {} });
  mw(h.req, h.res, h.next);
  assert.strictEqual(h.nextCalled(), false);
  assert.strictEqual(h.res.statusCode, 401);
  assert.match(h.res.headers['WWW-Authenticate'] || '', /^Basic realm=/);
});

test('createAuth: enabled with correct credentials passes through', () => {
  const mw = createAuth({ enabled: true, password: 'secret', publicPrefix: '/md-memo/m/' });
  const h = harness({ path: '/md-memo/api/history', headers: { authorization: basic('x', 'secret') } });
  mw(h.req, h.res, h.next);
  assert.strictEqual(h.nextCalled(), true);
  assert.strictEqual(h.res.statusCode, null);
});

test('createAuth: public prefix bypasses auth even without credentials', () => {
  const mw = createAuth({ enabled: true, password: 'secret', publicPrefix: '/md-memo/m/' });
  const h = harness({ path: '/md-memo/m/123', headers: {} });
  mw(h.req, h.res, h.next);
  assert.strictEqual(h.nextCalled(), true);
  assert.strictEqual(h.res.statusCode, null);
});
