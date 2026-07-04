import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveTitle, slugify, uniqueSlug } from './slug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// History cap, from env (JSON 全檔重寫：量大時每次寫入成本隨檔案大小線性成長).
export function historyLimit() {
  return Number(process.env.HISTORY_LIMIT) || 1000;
}

// Computed lazily so tests can override via process.env.HISTORY_FILE.
function historyFile() {
  return process.env.HISTORY_FILE || path.join(__dirname, '..', 'data', 'history.json');
}

// Backfill title/slug on legacy entries (pre-Phase-0 data). Returns true
// when anything changed so the caller can persist once.
function backfillIdentity(history) {
  let changed = false;
  const taken = new Set(history.map(e => e.slug).filter(Boolean));
  for (const e of history) {
    if (e.title == null) { e.title = deriveTitle(e.markdown); changed = true; }
    if (e.slug == null) {
      e.slug = uniqueSlug(slugify(e.title), taken);
      taken.add(e.slug);
      changed = true;
    }
  }
  return changed;
}

export function loadHistory() {
  try {
    const f = historyFile();
    if (fs.existsSync(f)) {
      const history = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (backfillIdentity(history)) saveHistory(history);
      return history;
    }
  } catch {}
  return [];
}

export function saveHistory(history) {
  const f = historyFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(history, null, 2));
}

// Monotonic id generator: Date.now(), bumped by 1 when two calls land in the
// same millisecond, so rapid inserts never collide.
let lastId = 0;
function nextId() {
  const now = Date.now();
  lastId = now > lastId ? now : lastId + 1;
  return lastId;
}

// Build a history entry. sources/links are attached only when provided.
export function createEntry({ raw = '', markdown, tags = [], sources, links }) {
  const entry = {
    id: nextId(),
    createdAt: new Date().toISOString(),
    raw,
    markdown,
    tags,
    title: deriveTitle(markdown),
    preview: markdown.split('\n').find(l => l.trim()) || '(empty)',
  };
  if (sources) entry.sources = sources;
  if (links) entry.links = links;
  return entry;
}

// Prepend an entry, enforce the limit, persist. Returns the entry.
export function insertEntry(entry) {
  const history = loadHistory();
  entry.slug = uniqueSlug(slugify(entry.title ?? deriveTitle(entry.markdown)),
    new Set(history.map(e => e.slug).filter(Boolean)));
  history.unshift(entry);
  saveHistory(history.slice(0, historyLimit()));
  return entry;
}

// Overwrite an existing entry's markdown/tags in place (no reorder, no new id).
// Recomputes preview. Returns the entry, or null when id is not found.
export function updateEntry(id, { markdown, tags }) {
  const history = loadHistory();
  const entry = history.find(e => e.id === id);
  if (!entry) return null;
  if (markdown != null) {
    entry.markdown = markdown;
    entry.title = deriveTitle(markdown);
    entry.preview = markdown.split('\n').find(l => l.trim()) || '(empty)';
  }
  if (tags != null) entry.tags = tags;
  saveHistory(history);
  return entry;
}

// Back up the current history file to a timestamped sibling
// <name>.<timestamp>.bak.json (one per clear, never overwriting an older
// backup), then write an empty history. backedUp is false when there was no
// file to copy (nothing to lose). Returns { ok, backedUp, count, backupFile }.
export function clearHistory() {
  const f = historyFile();
  let backedUp = false;
  let count = 0;
  let backupFile = null;
  if (fs.existsSync(f)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    backupFile = f.replace(/\.json$/, '') + `.${ts}.bak.json`;
    fs.copyFileSync(f, backupFile);
    backedUp = true;
    try { count = JSON.parse(fs.readFileSync(f, 'utf8')).length; } catch {}
  }
  saveHistory([]);
  return { ok: true, backedUp, count, backupFile };
}
