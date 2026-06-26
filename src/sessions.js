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
  try {
    const f = sessionsFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return [];
}

function saveSessions(sessions) {
  const f = sessionsFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(sessions, null, 2));
}

// Build a session record. answer/events default to empty.
export function createSession({ question, answer = '', events = [] }) {
  return { id: Date.now(), createdAt: new Date().toISOString(), question, answer, events };
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
