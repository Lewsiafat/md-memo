import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const HISTORY_LIMIT = 50;

// Computed lazily so tests can override via process.env.HISTORY_FILE.
function historyFile() {
  return process.env.HISTORY_FILE || path.join(__dirname, '..', 'data', 'history.json');
}

export function loadHistory() {
  try {
    const f = historyFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {}
  return [];
}

export function saveHistory(history) {
  const f = historyFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(history, null, 2));
}

// Build a history entry. sources/links are attached only when provided.
export function createEntry({ raw = '', markdown, tags = [], sources, links }) {
  const entry = {
    id: Date.now(),
    createdAt: new Date().toISOString(),
    raw,
    markdown,
    tags,
    preview: markdown.split('\n').find(l => l.trim()) || '(empty)',
  };
  if (sources) entry.sources = sources;
  if (links) entry.links = links;
  return entry;
}

// Prepend an entry, enforce the limit, persist. Returns the entry.
export function insertEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  saveHistory(history.slice(0, HISTORY_LIMIT));
  return entry;
}
