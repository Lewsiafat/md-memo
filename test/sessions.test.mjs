import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'node:path';

process.env.SESSIONS_FILE = '/tmp/md-memo-sessions-test.json';
fs.rmSync(process.env.SESSIONS_FILE, { force: true });

const { loadSessions, createSession, insertSession, deleteSession, SESSIONS_LIMIT } =
  await import('../src/sessions.js');

test('loadSessions returns [] when file missing', () => {
  assert.deepStrictEqual(loadSessions(), []);
});

test('createSession builds the canonical shape', () => {
  const s = createSession({ question: 'q', answer: 'a', events: [{ event: 'answer', data: { content: 'a' } }] });
  assert.strictEqual(s.question, 'q');
  assert.strictEqual(s.answer, 'a');
  assert.strictEqual(s.events.length, 1);
  assert.ok(typeof s.id === 'number' && s.createdAt);
});

test('createSession defaults answer/events when omitted', () => {
  const s = createSession({ question: 'q' });
  assert.strictEqual(s.answer, '');
  assert.deepStrictEqual(s.events, []);
});

test('insertSession: consecutive inserts yield distinct ids (no same-ms collision)', () => {
  fs.rmSync(process.env.SESSIONS_FILE, { force: true });
  const a = insertSession(createSession({ question: 'a' }));
  const b = insertSession(createSession({ question: 'b' }));
  assert.notStrictEqual(a.id, b.id);
});

test('insertSession prepends and enforces the limit', () => {
  fs.rmSync(process.env.SESSIONS_FILE, { force: true });
  for (let i = 0; i < SESSIONS_LIMIT + 3; i++) insertSession(createSession({ question: `q${i}` }));
  const all = loadSessions();
  assert.strictEqual(all.length, SESSIONS_LIMIT);
  assert.strictEqual(all[0].question, `q${SESSIONS_LIMIT + 2}`);
});

test('deleteSession removes by id', () => {
  fs.rmSync(process.env.SESSIONS_FILE, { force: true });
  const a = insertSession(createSession({ question: 'a' }));
  // Ensure distinct timestamp by spinning until time advances
  const startTime = Date.now();
  while (Date.now() === startTime) {}
  const b = insertSession(createSession({ question: 'b' }));
  deleteSession(a.id);
  const remaining = loadSessions();
  assert.strictEqual(remaining.length, 1);
  assert.strictEqual(remaining[0].question, 'b');
  assert.ok(!remaining.some(s => s.question === 'a'));
});

test('loadSessions quarantines a corrupted file and returns []', () => {
  const f = process.env.SESSIONS_FILE;
  const dir = path.dirname(f);
  const prefix = path.basename(f).replace(/\.json$/, '') + '.corrupt-';
  for (const n of fs.readdirSync(dir).filter(n => n.startsWith(prefix))) {
    fs.rmSync(path.join(dir, n), { force: true });
  }
  fs.writeFileSync(f, '[{ broken');
  assert.deepStrictEqual(loadSessions(), []);
  assert.ok(!fs.existsSync(f), 'corrupted file moved away');
  const quarantined = fs.readdirSync(dir).filter(n => n.startsWith(prefix));
  assert.strictEqual(quarantined.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), '[{ broken');
  fs.rmSync(path.join(dir, quarantined[0]), { force: true });
});

test('insertSession persists atomically (no .tmp residue)', () => {
  fs.rmSync(process.env.SESSIONS_FILE, { force: true });
  insertSession(createSession({ question: 'atomic?' }));
  assert.ok(fs.existsSync(process.env.SESSIONS_FILE));
  assert.ok(!fs.existsSync(process.env.SESSIONS_FILE + '.tmp'));
});
