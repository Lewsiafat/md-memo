# Agent over Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hand-built agent that does multi-step reasoning over the md-memo notebook — searching/reading memos live and proposing writes (create/merge/link/retag) confirmed by the user — streaming a real-time reasoning trace over SSE.

**Architecture:** A new `src/agent.js` runs an OpenRouter native-function-calling loop (no framework). Read tools execute live inside the loop; write tools only emit `proposal` events that the user confirms via `POST /api/agent/apply`. Persistence and tool handlers are extracted into `src/store.js` and `src/tools.js` so both the existing routes and the agent share one source of truth. The frontend gains a third "Agent" mode that consumes the SSE stream via `fetch().body.getReader()`.

**Tech Stack:** Node.js + Express (ES Modules), native `fetch`, OpenRouter `tools` (function calling), Server-Sent Events, vanilla JS frontend, `node:test` for unit tests (built-in, zero new dependencies). Design reference: `docs/plans/2026-06-19-agent-over-notes-design.md`.

---

## File Structure

| File | Responsibility | New/Modified |
|------|----------------|--------------|
| `src/store.js` | History persistence + entry helpers (`loadHistory`, `saveHistory`, `createEntry`, `insertEntry`), shared by routes + tools | **Create** |
| `src/tools.js` | Tool JSON schemas, kind table, read handlers, proposal builders, `applyProposal` | **Create** |
| `src/agent.js` | `callOpenRouter`, the `runAgent` loop (injectable model for tests), tool dispatch | **Create** |
| `src/index.js` | Wire to `store.js`; add `POST /api/agent` (SSE) + `POST /api/agent/apply` | **Modify** |
| `public/index.html` | Agent panel: toggle, input, SSE client, trace rendering, confirm cards | **Modify** |
| `scripts/smoke-agent.mjs` | Deterministic loop smoke test (fake model, no API key) | **Create** |
| `test/store.test.mjs`, `test/tools.test.mjs`, `test/agent.test.mjs` | `node:test` unit tests | **Create** |
| `package.json` | `test` + `smoke` scripts | **Modify** |
| `.env.sample`, `README.md`, `CLAUDE.md` | Document `AGENT_MODEL` + the agent feature | **Modify** |

**Notes on decomposition:** Extracting `store.js` is a *necessary* (not cosmetic) refactor — `agent.js` cannot import persistence from `index.js` because importing `index.js` would start the server. Keep the extracted behavior byte-for-byte identical to today's inline logic.

---

## Task 1: Extract `src/store.js` and wire `index.js` to it

**Files:**
- Create: `src/store.js`
- Create: `test/store.test.mjs`
- Modify: `src/index.js` (replace inline `loadHistory`/`saveHistory`/entry creation)
- Modify: `package.json` (add `test` script)

- [ ] **Step 1: Write the failing test**

Create `test/store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-store-test.json';
fs.rmSync(process.env.HISTORY_FILE, { force: true });

const { loadHistory, saveHistory, createEntry, insertEntry, HISTORY_LIMIT } =
  await import('../src/store.js');

test('loadHistory returns [] when file missing', () => {
  assert.deepStrictEqual(loadHistory(), []);
});

test('createEntry builds the canonical shape', () => {
  const e = createEntry({ raw: 'r', markdown: '# Title\n\nbody', tags: ['a'] });
  assert.strictEqual(e.markdown, '# Title\n\nbody');
  assert.strictEqual(e.preview, '# Title');
  assert.deepStrictEqual(e.tags, ['a']);
  assert.ok(typeof e.id === 'number');
  assert.ok(e.createdAt);
});

test('createEntry attaches optional sources/links only when given', () => {
  const plain = createEntry({ markdown: 'x' });
  assert.ok(!('sources' in plain));
  assert.ok(!('links' in plain));
  const rich = createEntry({ markdown: 'x', sources: [1], links: [2] });
  assert.deepStrictEqual(rich.sources, [1]);
  assert.deepStrictEqual(rich.links, [2]);
});

test('insertEntry prepends and enforces the limit', () => {
  saveHistory([]);
  for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
    insertEntry(createEntry({ markdown: `m${i}` }));
  }
  const h = loadHistory();
  assert.strictEqual(h.length, HISTORY_LIMIT);
  assert.strictEqual(h[0].markdown, `m${HISTORY_LIMIT + 4}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/store.test.mjs`
Expected: FAIL — `Cannot find module '../src/store.js'`.

- [ ] **Step 3: Create `src/store.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/store.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Add the `test` script to `package.json`**

In `package.json` `"scripts"`, add:

```json
"test": "node --test"
```

- [ ] **Step 6: Wire `src/index.js` to `store.js`**

In `src/index.js`:

1. Add near the other imports:
   ```js
   import { loadHistory, saveHistory, createEntry, insertEntry } from './store.js';
   ```
2. Delete these now-duplicated pieces from `src/index.js`:
   - the `HISTORY_FILE` and `HISTORY_LIMIT` consts
   - the `fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });` line
   - the local `loadHistory()` function
   - the local `saveHistory()` function
   (Keep `parseTags` — it is still used by `/api/format`.)
3. Replace the entry-creation block inside `POST /api/format` (the `const entry = { ... }; history.unshift(entry); saveHistory(history.slice(0, HISTORY_LIMIT));`) with:
   ```js
   const entry = insertEntry(createEntry({ raw: text, markdown, tags }));
   ```
   Leave the surrounding `res.json({ markdown, tags, id: entry.id });` unchanged.

- [ ] **Step 7: Verify the server still boots and existing endpoints work**

Run: `node src/index.js` (in another shell, with a `data/history.json` present — `cp data/history.sample.json data/history.json` if needed), then:
`curl -s localhost:10026/md-memo/api/history | head -c 80`
Expected: JSON array prints; server logged its startup line; no crash.

- [ ] **Step 8: Commit**

```bash
git add src/store.js test/store.test.mjs src/index.js package.json
git commit -m "refactor: extract history persistence into src/store.js"
```

---

## Task 2: Read tools (`search_memos`, `read_memo`, `list_tags`)

**Files:**
- Create: `src/tools.js`
- Create: `test/tools.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/tools.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

process.env.HISTORY_FILE = '/tmp/md-memo-tools-test.json';

const { saveHistory } = await import('../src/store.js');
const { searchMemos, readMemo, listTags, runReadTool, TOOLS, TOOL_KIND } =
  await import('../src/tools.js');

function seed() {
  saveHistory([
    { id: 1, createdAt: 't', raw: 'project alpha kickoff', markdown: '# Alpha\n\nkickoff notes', tags: ['work'], preview: '# Alpha' },
    { id: 2, createdAt: 't', raw: 'grocery list', markdown: '# Groceries\n\nmilk', tags: ['home'], preview: '# Groceries' },
    { id: 3, createdAt: 't', raw: 'alpha retro', markdown: '# Alpha retro\n\nwhat went well', tags: ['work'], preview: '# Alpha retro' },
  ]);
}

test('searchMemos ranks title hits higher and filters non-matches', () => {
  seed();
  const r = searchMemos({ query: 'alpha' });
  assert.deepStrictEqual(r.map(x => x.id), [1, 3]);   // both match, none of #2
  assert.ok(r[0].snippet.length > 0);
});

test('searchMemos respects limit and empty query', () => {
  seed();
  assert.strictEqual(searchMemos({ query: 'alpha', limit: 1 }).length, 1);
  assert.deepStrictEqual(searchMemos({ query: '   ' }), []);
});

test('readMemo returns full memo or an error object', () => {
  seed();
  assert.strictEqual(readMemo({ id: 2 }).markdown, '# Groceries\n\nmilk');
  assert.ok(readMemo({ id: 999 }).error);
});

test('listTags counts and sorts descending', () => {
  seed();
  const tags = listTags();
  assert.deepStrictEqual(tags[0], { tag: 'work', count: 2 });
});

test('TOOLS/TOOL_KIND are consistent', () => {
  const names = TOOLS.map(t => t.function.name);
  assert.deepStrictEqual(new Set(names), new Set(Object.keys(TOOL_KIND)));
  assert.strictEqual(TOOL_KIND.search_memos, 'read');
  assert.strictEqual(TOOL_KIND.merge_memos, 'write');
});

test('runReadTool dispatches by name', () => {
  seed();
  assert.ok(Array.isArray(runReadTool('search_memos', { query: 'alpha' })));
  assert.ok(runReadTool('nope', {}).error);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tools.test.mjs`
Expected: FAIL — `Cannot find module '../src/tools.js'`.

- [ ] **Step 3: Create `src/tools.js` with schemas + read handlers**

```js
import { loadHistory, saveHistory, createEntry, insertEntry } from './store.js';

// ---- Tool schemas (OpenRouter `tools` / function-calling format) ----
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memos',
      description: 'Search the notebook for memos relevant to a query. Returns matching memos with id, preview, tags, and a snippet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search for.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_memo',
      description: 'Read the full markdown of a single memo by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tags',
      description: 'List all tags in the notebook with their counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: 'Propose creating a new memo. Provide the full markdown and tags.',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_memos',
      description: 'Propose merging several memos into one new memo. Read them first, then write the synthesized markdown yourself.',
      parameters: {
        type: 'object',
        properties: {
          source_ids: { type: 'array', items: { type: 'number' } },
          title: { type: 'string' },
          markdown: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['source_ids', 'markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_memos',
      description: 'Propose linking several memos together as related.',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'number' } } },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retag_memo',
      description: 'Propose replacing the tags of a memo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tags'],
      },
    },
  },
];

// Which tools mutate (write) vs. read. Drives loop dispatch.
export const TOOL_KIND = {
  search_memos: 'read',
  read_memo: 'read',
  list_tags: 'read',
  create_memo: 'write',
  merge_memos: 'write',
  link_memos: 'write',
  retag_memo: 'write',
};

// ---- Read handlers ----
function scoreMemo(memo, terms) {
  const hay = `${memo.raw || ''}\n${memo.markdown || ''}\n${(memo.tags || []).join(' ')}`.toLowerCase();
  const title = (memo.preview || '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    score += hay.split(t).length - 1;          // body hits
    score += (title.split(t).length - 1) * 3;  // title hits weighted
  }
  return score;
}

export function searchMemos({ query, limit = 5 }) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return loadHistory()
    .map(m => ({ m, s: scoreMemo(m, terms) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ m }) => ({
      id: m.id,
      preview: m.preview,
      tags: m.tags || [],
      snippet: (m.markdown || '').replace(/\s+/g, ' ').slice(0, 160),
      createdAt: m.createdAt,
    }));
}

export function readMemo({ id }) {
  const m = loadHistory().find(e => e.id === Number(id));
  if (!m) return { error: `No memo with id ${id}` };
  return { id: m.id, markdown: m.markdown, tags: m.tags || [], links: m.links || [], createdAt: m.createdAt };
}

export function listTags() {
  const counts = {};
  for (const m of loadHistory()) for (const t of (m.tags || [])) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function runReadTool(name, args) {
  switch (name) {
    case 'search_memos': return searchMemos(args);
    case 'read_memo': return readMemo(args);
    case 'list_tags': return listTags();
    default: return { error: `Unknown read tool ${name}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tools.test.mjs`
Expected: PASS — read-tool tests pass. (`buildProposal`/`applyProposal` arrive in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add src/tools.js test/tools.test.mjs
git commit -m "feat: agent read tools (search/read/list_tags) + tool schemas"
```

---

## Task 3: Write proposals + `applyProposal`

**Files:**
- Modify: `src/tools.js` (append `buildProposal` + `applyProposal`)
- Modify: `test/tools.test.mjs` (append apply tests)

- [ ] **Step 1: Write the failing test**

Append to `test/tools.test.mjs`:

```js
const { buildProposal, applyProposal } = await import('../src/tools.js');

test('buildProposal summarizes each write action', () => {
  assert.match(buildProposal('merge_memos', { source_ids: [1, 2], title: 'X' }).summary, /合併 2 篇/);
  assert.strictEqual(buildProposal('retag_memo', { id: 1, tags: ['a'] }).action, 'retag_memo');
});

test('applyProposal create_memo inserts a memo', () => {
  saveHistory([]);
  const r = applyProposal({ action: 'create_memo', args: { markdown: '# New', tags: ['t'] } });
  assert.ok(r.ok && r.id);
  assert.strictEqual(readMemo({ id: r.id }).markdown, '# New');
});

test('applyProposal merge_memos records sources and validates ids', () => {
  saveHistory([
    { id: 1, markdown: 'a', tags: [], preview: 'a', createdAt: 't', raw: '' },
    { id: 2, markdown: 'b', tags: [], preview: 'b', createdAt: 't', raw: '' },
  ]);
  const ok = applyProposal({ action: 'merge_memos', args: { source_ids: [1, 2], title: 'M', markdown: 'merged', tags: ['m'] } });
  assert.ok(ok.ok);
  const bad = applyProposal({ action: 'merge_memos', args: { source_ids: [1, 999], markdown: 'x' } });
  assert.strictEqual(bad.ok, false);
});

test('applyProposal link_memos cross-links and validates', () => {
  saveHistory([
    { id: 1, markdown: 'a', tags: [], preview: 'a', createdAt: 't', raw: '' },
    { id: 2, markdown: 'b', tags: [], preview: 'b', createdAt: 't', raw: '' },
  ]);
  const r = applyProposal({ action: 'link_memos', args: { ids: [1, 2] } });
  assert.ok(r.ok);
  const reread = (await import('../src/store.js')).loadHistory();
  assert.deepStrictEqual(reread.find(m => m.id === 1).links, [2]);
  assert.strictEqual(applyProposal({ action: 'link_memos', args: { ids: [1, 999] } }).ok, false);
});

test('applyProposal retag_memo replaces tags', () => {
  saveHistory([{ id: 1, markdown: 'a', tags: ['old'], preview: 'a', createdAt: 't', raw: '' }]);
  assert.ok(applyProposal({ action: 'retag_memo', args: { id: 1, tags: ['new'] } }).ok);
  assert.strictEqual(applyProposal({ action: 'retag_memo', args: { id: 999, tags: [] } }).ok, false);
});

test('applyProposal rejects unknown actions', () => {
  assert.strictEqual(applyProposal({ action: 'delete_everything', args: {} }).ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/tools.test.mjs`
Expected: FAIL — `buildProposal`/`applyProposal` are `undefined` / not exported.

- [ ] **Step 3: Append write proposals + apply logic to `src/tools.js`**

```js
// ---- Write proposals (loop emits these; nothing is mutated until apply) ----
export function buildProposal(name, args) {
  switch (name) {
    case 'create_memo':
      return { action: name, args, summary: `建立新筆記（${(args.tags || []).join(', ') || '無標籤'}）` };
    case 'merge_memos':
      return { action: name, args, summary: `合併 ${(args.source_ids || []).length} 篇為「${args.title || '未命名'}」` };
    case 'link_memos':
      return { action: name, args, summary: `連結 ${(args.ids || []).length} 篇筆記` };
    case 'retag_memo':
      return { action: name, args, summary: `重設 #${args.id} 標籤為 ${(args.tags || []).join(', ')}` };
    default:
      return { action: name, args, summary: name };
  }
}

function existingIds() {
  return new Set(loadHistory().map(e => e.id));
}

// ---- Apply a user-confirmed proposal. Mutates history. ----
export function applyProposal({ action, args = {} }) {
  switch (action) {
    case 'create_memo': {
      const entry = insertEntry(createEntry({ markdown: args.markdown, tags: args.tags || [] }));
      return { ok: true, id: entry.id };
    }
    case 'merge_memos': {
      const ids = (args.source_ids || []).map(Number);
      const have = existingIds();
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown source ids: ${missing.join(', ')}` };
      const md = args.title ? `# ${args.title}\n\n${args.markdown}` : args.markdown;
      const entry = insertEntry(createEntry({ markdown: md, tags: args.tags || [], sources: ids }));
      return { ok: true, id: entry.id };
    }
    case 'link_memos': {
      const ids = (args.ids || []).map(Number);
      const history = loadHistory();
      const have = new Set(history.map(e => e.id));
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown ids: ${missing.join(', ')}` };
      for (const m of history) {
        if (ids.includes(m.id)) {
          const others = ids.filter(x => x !== m.id);
          m.links = Array.from(new Set([...(m.links || []), ...others]));
        }
      }
      saveHistory(history);
      return { ok: true, ids };
    }
    case 'retag_memo': {
      const id = Number(args.id);
      const history = loadHistory();
      const m = history.find(e => e.id === id);
      if (!m) return { ok: false, error: `No memo with id ${id}` };
      m.tags = args.tags || [];
      saveHistory(history);
      return { ok: true, id };
    }
    default:
      return { ok: false, error: `Unknown action ${action}` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/tools.test.mjs`
Expected: PASS — all read + write tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools.js test/tools.test.mjs
git commit -m "feat: agent write proposals + applyProposal (create/merge/link/retag)"
```

---

## Task 4: The agent loop (`src/agent.js`)

**Files:**
- Create: `src/agent.js`
- Create: `test/agent.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `test/agent.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';

process.env.HISTORY_FILE = '/tmp/md-memo-agent-test.json';

const { saveHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');

function collector() {
  const events = [];
  return { emit: (e, d) => events.push([e, d]), events, names: () => events.map(e => e[0]) };
}

test('read tool executes live, then agent answers', async () => {
  saveHistory([{ id: 1, markdown: '# A', tags: ['x'], preview: '# A', createdAt: 't', raw: 'alpha' }]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: 'searching',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_memos', arguments: '{"query":"alpha"}' } }] },
      usage: { total_tokens: 10 } };
    return { message: { role: 'assistant', content: 'final answer' }, usage: { total_tokens: 5 } };
  };
  const c = collector();
  await runAgent('find alpha', c.emit, { callModel: fake });
  assert.deepStrictEqual(c.names(), ['start', 'message', 'tool_call', 'tool_result', 'message', 'answer', 'done']);
  const done = c.events.find(e => e[0] === 'done')[1];
  assert.strictEqual(done.tokens, 15);
});

test('write tool emits a proposal and is NOT applied', async () => {
  saveHistory([]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_memo', arguments: '{"markdown":"# New","tags":["t"]}' } }] },
      usage: {} };
    return { message: { role: 'assistant', content: 'proposed' }, usage: {} };
  };
  const c = collector();
  await runAgent('make a memo', c.emit, { callModel: fake });
  assert.ok(c.names().includes('proposal'));
  assert.ok(!c.names().includes('tool_result'));   // writes never execute in-loop
  assert.strictEqual((await import('../src/store.js')).loadHistory().length, 0); // nothing written
});

test('stops at MAX_STEPS without infinite loop', async () => {
  const fake = async () => ({ message: { role: 'assistant', content: 'again',
    tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_tags', arguments: '{}' } }] }, usage: {} });
  const c = collector();
  await runAgent('loop forever', c.emit, { callModel: fake });
  const done = c.events.find(e => e[0] === 'done')[1];
  assert.strictEqual(done.steps, 8);
  assert.ok(c.events.some(e => e[0] === 'answer'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agent.test.mjs`
Expected: FAIL — `Cannot find module '../src/agent.js'`.

- [ ] **Step 3: Create `src/agent.js`**

```js
import { TOOLS, TOOL_KIND, runReadTool, buildProposal } from './tools.js';

const MAX_STEPS = 8;

const SYSTEM = `You are an agent that helps the user manage a markdown notebook.
You can search and read memos, and propose changes (create/merge/link/retag).
Plan your steps. Use search_memos and read_memo to gather context before answering or proposing changes.
When the user wants something synthesized or merged, read the relevant memos first, then write the result yourself.
Write tools only PROPOSE changes — the user confirms them; never assume a proposed change has been applied.
Answer in the user's language and cite the memo ids you used.`;

// Real OpenRouter call. Returns { message, usage }.
export async function callOpenRouter(messages, tools) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const model = process.env.AGENT_MODEL || process.env.AI_MODEL || 'openai/gpt-4o-mini';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Lewsiafat/md-memo',
      'X-Title': 'md-memo',
    },
    body: JSON.stringify({ model, messages, tools, temperature: 0.3, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return { message: data.choices?.[0]?.message || {}, usage: data.usage || {} };
}

function parseArgs(tc) {
  const a = tc.function?.arguments;
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a || '{}'); } catch { return {}; }
}

// Run the agent loop. emit(event, data) streams events.
// callModel is injectable for tests; priorTurns allows multi-turn context.
export async function runAgent(message, emit, { callModel = callOpenRouter, priorTurns = [] } = {}) {
  const messages = [{ role: 'system', content: SYSTEM }, ...priorTurns, { role: 'user', content: message }];
  let totalTokens = 0;
  emit('start', {});
  for (let step = 0; step < MAX_STEPS; step++) {
    const { message: msg, usage } = await callModel(messages, TOOLS);
    totalTokens += usage?.total_tokens || 0;
    if (msg.content) emit('message', { content: msg.content });
    if (!msg.tool_calls?.length) {
      emit('answer', { content: msg.content || '' });
      emit('done', { steps: step + 1, tokens: totalTokens });
      return;
    }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const args = parseArgs(tc);
      emit('tool_call', { name, args });
      let toolContent;
      if (TOOL_KIND[name] === 'write') {
        emit('proposal', buildProposal(name, args));
        toolContent = 'Proposed to the user for confirmation. Assume not yet applied.';
      } else {
        const result = runReadTool(name, args);
        emit('tool_result', { name, result });
        toolContent = JSON.stringify(result);
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent });
    }
  }
  emit('answer', { content: `（已達 ${MAX_STEPS} 步上限，未能完成；以上為目前進度。）` });
  emit('done', { steps: MAX_STEPS, tokens: totalTokens });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/agent.test.mjs`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: PASS — store + tools + agent suites all green.

- [ ] **Step 6: Commit**

```bash
git add src/agent.js test/agent.test.mjs
git commit -m "feat: hand-built agent loop with injectable model + SSE event emission"
```

---

## Task 5: Wire the routes (`POST /api/agent`, `POST /api/agent/apply`)

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Add imports**

Near the top of `src/index.js`, add:

```js
import { runAgent } from './agent.js';
import { applyProposal } from './tools.js';
```

- [ ] **Step 2: Add the SSE agent route**

Insert after the existing `POST /api/format` handler:

```js
// POST /md-memo/api/agent — run the agent loop, stream events as SSE
app.post(`${BASE_PATH}/api/agent`, async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'No message provided' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    await runAgent(message, emit);
  } catch (err) {
    console.error('Agent error:', err);
    emit('error', { message: err.message });
  } finally {
    res.end();
  }
});

// POST /md-memo/api/agent/apply — execute a user-confirmed write proposal
app.post(`${BASE_PATH}/api/agent/apply`, (req, res) => {
  const { action, args } = req.body || {};
  if (!action || !args) return res.status(400).json({ error: 'action and args required' });
  const result = applyProposal({ action, args });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});
```

- [ ] **Step 3: Manually verify the SSE stream end-to-end**

Requires `OPENROUTER_API_KEY` in `.env` and a tool-capable `AGENT_MODEL` (default `openai/gpt-4o-mini`). Ensure `data/history.json` exists (`cp data/history.sample.json data/history.json`).

Run the server: `npm start`
Then in another shell:
```bash
curl -N -s -X POST localhost:10026/md-memo/api/agent \
  -H 'Content-Type: application/json' \
  -d '{"message":"我之前寫過哪些筆記？挑一個主題告訴我"}'
```
Expected: a stream of `event: start`, `event: tool_call` (e.g. `search_memos`/`list_tags`), `event: tool_result`, `event: answer`, `event: done` frames. No `event: error`.

- [ ] **Step 4: Verify apply works**

```bash
curl -s -X POST localhost:10026/md-memo/api/agent/apply \
  -H 'Content-Type: application/json' \
  -d '{"action":"create_memo","args":{"markdown":"# Smoke\n\nfrom curl","tags":["smoke"]}}'
```
Expected: `{"ok":true,"id":<number>}`; the new memo appears at `GET /md-memo/api/history` and at `/md-memo/m/<id>`.

- [ ] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: POST /api/agent (SSE) and /api/agent/apply routes"
```

---

## Task 6: Frontend agent panel (`public/index.html`)

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: Read the current markup to find anchors**

Run: open `public/index.html` and locate (a) the top toolbar where the dark/light toggle button lives, and (b) the main content container that holds the editor/preview. Note their ids/classes — you will add a sibling toggle button and a sibling `<section>`.

- [ ] **Step 2: Add the toggle button to the toolbar**

In the toolbar (next to the existing theme toggle), add:

```html
<button id="agentToggle" title="Agent" class="icon-btn">🤖</button>
```

Match the existing toolbar button's class so it inherits styling. If the existing buttons use a different class name than `icon-btn`, use that class instead.

- [ ] **Step 3: Add the agent panel markup**

Add as a sibling of the main content container (so `body.agent-open` can show one and hide the other). Use the `__BASE_PATH__` placeholder for any link you add later:

```html
<section id="agentPanel">
  <div id="agentBar">
    <input id="agentInput" type="text" placeholder="問你的筆記庫，或請它整理／合併…（⌘/Ctrl + Enter 送出）" />
    <button id="agentSend">送出</button>
  </div>
  <div id="agentTrace" class="md-render-host"></div>
</section>
```

- [ ] **Step 4: Add CSS**

Add inside the existing `<style>` block:

```css
#agentPanel { display: none; max-width: 760px; margin: 24px auto; padding: 0 20px; }
body.agent-open #agentPanel { display: block; }
#agentBar { display: flex; gap: 8px; margin-bottom: 16px; }
#agentInput { flex: 1; padding: 10px 14px; border: 1px solid var(--border, #ccc); border-radius: 8px; font-size: 15px; background: var(--surface, #fff); color: var(--text, #111); }
#agentSend { padding: 10px 18px; border: none; border-radius: 8px; background: var(--accent, #6c5ce7); color: #fff; font-weight: 600; cursor: pointer; }
#agentSend:disabled { opacity: .5; cursor: default; }
#agentTrace { display: flex; flex-direction: column; gap: 8px; }
.ag-msg { color: var(--text2, #666); font-size: 14px; }
.ag-tool { font-family: var(--mono, monospace); font-size: 12.5px; background: #6c5ce715; color: var(--accent, #6c5ce7); padding: 4px 10px; border-radius: 6px; align-self: flex-start; }
.ag-result { font-size: 12px; }
.ag-result pre { background: #00000008; padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
.ag-proposal { border: 1px solid var(--accent, #6c5ce7); border-radius: 10px; padding: 12px 14px; background: #6c5ce70a; }
.ag-proposal-title { font-weight: 600; margin-bottom: 8px; }
.ag-proposal-actions { display: flex; gap: 8px; }
.ag-proposal-actions button { padding: 6px 14px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; }
.ag-apply { background: var(--accent, #6c5ce7); color: #fff; }
.ag-skip { background: #00000010; color: var(--text, #333); }
.ag-skipped { opacity: .5; }
.ag-permalink { display: inline-block; margin-top: 8px; color: var(--accent, #6c5ce7); }
.ag-answer { margin-top: 8px; }
.ag-done { font-size: 12px; color: var(--text2, #888); }
.ag-error { color: #d63031; font-weight: 600; }
```

- [ ] **Step 5: Add the agent client script**

Add a `<script>` just before `</body>` (after `marked` is loaded so `marked.parse` is available):

```html
<script>
(function () {
  const BASE = '__BASE_PATH__';
  const toggle = document.getElementById('agentToggle');
  const input = document.getElementById('agentInput');
  const sendBtn = document.getElementById('agentSend');
  const trace = document.getElementById('agentTrace');

  toggle && toggle.addEventListener('click', () => document.body.classList.toggle('agent-open'));

  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function renderProposal(data) {
    const card = el('div', 'ag-proposal');
    card.appendChild(el('div', 'ag-proposal-title', `提案：${esc(data.summary)}`));
    const actions = el('div', 'ag-proposal-actions');
    const apply = el('button', 'ag-apply', '✓ 套用');
    const skip = el('button', 'ag-skip', '✗ 略過');
    actions.appendChild(apply); actions.appendChild(skip);
    card.appendChild(actions); trace.appendChild(card);

    skip.addEventListener('click', () => { card.classList.add('ag-skipped'); apply.disabled = skip.disabled = true; });
    apply.addEventListener('click', async () => {
      apply.disabled = skip.disabled = true; apply.textContent = '套用中…';
      try {
        const r = await fetch(`${BASE}/api/agent/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: data.action, args: data.args }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || '套用失敗');
        apply.textContent = '✓ 已套用';
        if (j.id) { const a = el('a', 'ag-permalink', '開啟筆記 →'); a.href = `${BASE}/m/${j.id}`; a.target = '_blank'; card.appendChild(a); }
      } catch (e) { apply.textContent = '✗ ' + e.message; apply.disabled = skip.disabled = false; }
    });
  }

  function renderEvent(ev, data) {
    if (ev === 'start') { trace.innerHTML = ''; return; }
    if (ev === 'message') trace.appendChild(el('div', 'ag-msg', `💭 ${esc(data.content)}`));
    else if (ev === 'tool_call') trace.appendChild(el('div', 'ag-tool', `🔧 ${esc(data.name)}(${esc(JSON.stringify(data.args))})`));
    else if (ev === 'tool_result') {
      const d = el('details', 'ag-result'); d.appendChild(el('summary', null, '結果'));
      d.appendChild(el('pre', null, esc(JSON.stringify(data.result, null, 2)))); trace.appendChild(d);
    } else if (ev === 'proposal') renderProposal(data);
    else if (ev === 'answer') {
      const a = el('div', 'ag-answer md-render');
      a.innerHTML = window.marked ? marked.parse(data.content || '') : esc(data.content || '');
      trace.appendChild(a);
    } else if (ev === 'done') trace.appendChild(el('div', 'ag-done', `⏱ ${data.steps} 步 · ${data.tokens} tokens`));
    else if (ev === 'error') trace.appendChild(el('div', 'ag-error', `⚠ ${esc(data.message)}`));
    trace.scrollTop = trace.scrollHeight;
  }

  async function run() {
    const message = input.value.trim();
    if (!message) return;
    sendBtn.disabled = true;
    try {
      const res = await fetch(`${BASE}/api/agent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) { renderEvent('error', { message: `HTTP ${res.status}` }); return; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const evM = frame.match(/^event: (.+)$/m);
          const dataM = frame.match(/^data: (.+)$/m);
          if (evM && dataM) { try { renderEvent(evM[1].trim(), JSON.parse(dataM[1])); } catch {} }
        }
      }
    } catch (e) { renderEvent('error', { message: e.message }); }
    finally { sendBtn.disabled = false; }
  }

  sendBtn && sendBtn.addEventListener('click', run);
  input && input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); });
})();
</script>
```

- [ ] **Step 6: Manually verify in the browser**

Run: `npm start`, open `http://localhost:10026/md-memo/`. Click 🤖, type "幫我找跟『專案』有關的筆記並整理成一篇". Confirm: trace renders step cards live; a proposal card appears for the merge; clicking ✓ 套用 creates the memo and shows the "開啟筆記 →" permalink; the answer renders as markdown. (Optional: use the `playwright-skill` to script this and capture a screenshot.)

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: agent panel UI with live SSE reasoning trace + confirm cards"
```

---

## Task 7: Smoke script + docs

**Files:**
- Create: `scripts/smoke-agent.mjs`
- Modify: `package.json` (add `smoke` script)
- Modify: `.env.sample`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Create the smoke script**

`scripts/smoke-agent.mjs` — deterministic, no API key, runs the loop with a fake model:

```js
// Smoke test for the agent loop. Uses a fake model so it needs no API key.
// Run: npm run smoke
import assert from 'node:assert';

process.env.HISTORY_FILE = process.env.HISTORY_FILE || '/tmp/md-memo-smoke.json';
const { saveHistory } = await import('../src/store.js');
const { runAgent } = await import('../src/agent.js');

saveHistory([{ id: 1, markdown: '# Demo', tags: ['demo'], preview: '# Demo', createdAt: 't', raw: 'hello world' }]);

let turn = 0;
const fakeModel = async () => {
  turn++;
  if (turn === 1) return {
    message: { role: 'assistant', content: 'looking it up',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_memos', arguments: '{"query":"hello"}' } }] },
    usage: { total_tokens: 12 },
  };
  return { message: { role: 'assistant', content: 'all done' }, usage: { total_tokens: 8 } };
};

const events = [];
await runAgent('smoke', (e, d) => events.push([e, d]), { callModel: fakeModel });
const names = events.map(e => e[0]);

assert(names.includes('tool_call'), 'expected a tool_call event');
assert(names.includes('tool_result'), 'expected a tool_result event');
assert(names.includes('answer'), 'expected an answer event');
assert(names.includes('done'), 'expected a done event');
assert(!names.includes('error'), 'unexpected error event');

console.log('✓ smoke-agent passed:', names.join(' → '));
```

- [ ] **Step 2: Add the `smoke` script to `package.json`**

In `"scripts"`, add:

```json
"smoke": "node scripts/smoke-agent.mjs"
```

- [ ] **Step 3: Run the smoke script**

Run: `npm run smoke`
Expected: `✓ smoke-agent passed: start → message → tool_call → tool_result → message → answer → done`

- [ ] **Step 4: Document `AGENT_MODEL` in `.env.sample`**

Add a line:

```
# Model for the agent loop — MUST support tool/function calling. Falls back to AI_MODEL.
AGENT_MODEL=openai/gpt-4o-mini
```

- [ ] **Step 5: Update `README.md`**

(a) In the Configuration table, add a row:

```
| `AGENT_MODEL` | `openai/gpt-4o-mini` | Model for the agent loop (must support tool calling) |
```

(b) Add a Features bullet:

```
- 🧠 **Agent over your notes** — ask questions or give commands ("merge this week's meeting notes"); the agent searches, reads, and proposes changes with a live reasoning trace (confirm before any write)
```

- [ ] **Step 6: Update `CLAUDE.md`**

Under 架構, add a short subsection so future sessions know the agent layout:

```markdown
### Agent（對筆記庫的多步推理）

`src/agent.js` 是 hand-built 的 agent loop（無框架），用 OpenRouter 原生 function calling。讀取類工具（`search_memos`/`read_memo`/`list_tags`）在 loop 內即時執行；寫入類工具（`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）只 emit `proposal`，由 `POST /api/agent/apply` 在使用者確認後落地。工具與持久化分別在 `src/tools.js`、`src/store.js`。`POST /api/agent` 以 SSE 串流事件（start/message/tool_call/tool_result/proposal/answer/done/error）。前端 agent 面板在 `public/index.html`，用 `fetch().body.getReader()` 讀 SSE。模型由 `AGENT_MODEL` 控制（須支援 tools）。測試：`node --test`（`test/`），loop 用注入式 `callModel`；`npm run smoke` 跑無 API key 的整合 smoke。
```

- [ ] **Step 7: Run the full verification suite**

Run: `node --test && npm run smoke`
Expected: all unit tests PASS and smoke prints its success line.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke-agent.mjs package.json .env.sample README.md CLAUDE.md
git commit -m "test: agent smoke script; docs: AGENT_MODEL + agent feature"
```

---

## Final Verification

- [ ] `node --test` — all suites green
- [ ] `npm run smoke` — prints `✓ smoke-agent passed`
- [ ] Manual: `npm start`, click 🤖, run a read query (search+answer) and a write query (proposal → 套用 → permalink); confirm no `event: error` for a well-formed request
- [ ] Manual: existing flows untouched — `/api/format`, `/api/history`, `/m/:id`, DELETE still work
```
