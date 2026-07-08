import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SESSIONS_LIMIT = 50;

// Computed lazily so tests can override via process.env.SESSIONS_FILE.
function sessionsFile() {
  return process.env.SESSIONS_FILE || path.join(__dirname, '..', 'data', 'sessions.json');
}

export function loadSessions() {
  const f = sessionsFile();
  if (!fs.existsSync(f)) return [];
  try {
    const sessions = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(sessions)) throw new Error('sessions is not an array');
    return sessions;
  } catch (err) {
    // Corrupted file: move it aside so no later save can overwrite the bytes.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = f.replace(/\.json$/, '') + `.corrupt-${ts}.json`;
    fs.renameSync(f, quarantine);
    console.error(`sessions file corrupted — moved to ${quarantine}:`, err.message);
    return [];
  }
}

function saveSessions(sessions) {
  const f = sessionsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // tmp + rename so the real file is never half-written on disk.
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(sessions, null, 2));
  fs.renameSync(tmp, f);
}

// Monotonic id generator: Date.now(), bumped by 1 when two calls land in the
// same millisecond, so rapid inserts never collide.
let lastId = 0;
function nextId() {
  const now = Date.now();
  lastId = now > lastId ? now : lastId + 1;
  return lastId;
}

// Build a session record. answer/events default to empty.
export function createSession({ question, answer = '', events = [] }) {
  return { id: nextId(), createdAt: new Date().toISOString(), question, answer, events };
}

// Prepend, enforce the limit, persist. Returns the session.
export function insertSession(session) {
  const all = loadSessions();
  all.unshift(session);
  saveSessions(all.slice(0, SESSIONS_LIMIT));
  return session;
}

export function deleteSession(id) {
  saveSessions(loadSessions().filter(s => s.id !== Number(id)));
  return { ok: true };
}
