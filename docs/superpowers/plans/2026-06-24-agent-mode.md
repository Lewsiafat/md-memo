# Agent Mode (modes, examples, saved sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Mode a first-class workspace: a "返回一般模式" (back) button, an explicit View / Edit / Agent / Combine mode indicator, a right-side rail of example prompts, a left-side list of saved sessions (persisted on the server), and a one-click "存成 memo" from any saved session.

**Architecture:** A new `src/sessions.js` store (mirrors `src/store.js`) persists agent runs to `data/sessions.json` via new `/api/sessions` routes. The agent panel becomes a 3-column layout (saved sessions ▏ trace+input ▏ examples). The front-end captures each completed agent run, can save/load/delete it, and converts a session's final answer into a memo by reusing the existing `POST /api/agent/apply` (`create_memo`). View modes are centralized in a `setMode()` helper that drives a footer badge; **"Combine Mode" is the existing editor+quickview side-by-side state, now named.**

**Tech Stack:** Node 20.12+ ESM, Express, vanilla JS (inline in `public/index.html`), `node:test`. No new dependencies.

## Global Constraints

- Node **20.12+**, ES Modules. **No new npm dependencies** (only `express`).
- All routes mount under `BASE_PATH`. Front-end paths in the agent IIFE come from `const BASE = '__BASE_PATH__'`; reuse it — never hard-code.
- The two inline `<script>` blocks in `index.html` are **classic scripts** sharing one global scope: `function`/`let`/`const` declared at the top level of the first script are visible to the second. This plan relies on that (e.g. `setMode`, `showToast`, `enterAgentMode`/`exitAgentMode` defined in script 1 are called from script 2).
- The agent's response language is server-controlled (`AGENT_LANG`, default `zh-TW`); UI strings added here are 繁體中文 to match.
- No front-end unit-test harness exists in this repo (no jsdom/browser deps, and we add none). Back-end logic is TDD'd with `node --test`; front-end tasks are verified manually (and optionally with the `playwright-skill`).
- Server binds `127.0.0.1` only.
- Do not touch `parseTags` (tags contract) or `renderPermalink` (dual-render contract).
- After cross-file changes, dispatch the `contract-reviewer` agent.

---

## File Structure

- `src/sessions.js` — **new.** Session persistence: `loadSessions`, `createSession`, `insertSession`, `deleteSession`, `SESSIONS_LIMIT`. File path overridable via `process.env.SESSIONS_FILE` (mirrors the `HISTORY_FILE` pattern in `src/store.js`).
- `test/sessions.test.mjs` — **new.** Unit tests for the session store.
- `src/index.js` — add `GET/POST /api/sessions` and `DELETE /api/sessions/:id`; import from `./sessions.js`.
- `public/index.html` — (a) add a `#mode-badge` to the editor footer and a `setMode()` state machine in script 1; (b) replace the agent panel HTML with a 3-column layout; (c) replace the agent panel layout CSS and add sidebar styles; (d) extend the agent IIFE with examples, saved-session list, capture/save, and save-to-memo.
- `demo/mock.js` — mock the three `/api/sessions` routes (in-memory) and make `create_memo` apply actually unshift into `state.history` so "存成 memo" shows up in the demo.
- `CLAUDE.md` — document the new module, routes, and modes.

---

### Task 1: Session store (`src/sessions.js`)

**Files:**
- Create: `src/sessions.js`
- Create test: `test/sessions.test.mjs`

**Interfaces:**
- Produces:
  - `SESSIONS_LIMIT: number` (50)
  - `loadSessions(): Session[]`
  - `createSession({ question, answer?, events? }): Session` where `Session = { id:number, createdAt:string, question:string, answer:string, events:Array<{event:string,data:object}> }`
  - `insertSession(session): Session` — prepends, enforces limit, persists
  - `deleteSession(id): { ok:true }`

- [ ] **Step 1: Write the failing tests**

Create `test/sessions.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

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
  const b = insertSession(createSession({ question: 'b' }));
  deleteSession(a.id);
  const ids = loadSessions().map(s => s.id);
  assert.deepStrictEqual(ids, [b.id]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sessions.test.mjs`
Expected: FAIL — cannot find module `../src/sessions.js`.

- [ ] **Step 3: Implement `src/sessions.js`**

Create `src/sessions.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/sessions.test.mjs`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/sessions.js test/sessions.test.mjs
git commit -m "feat(sessions): server-side session store"
```

---

### Task 2: Session API routes

**Files:**
- Modify: `src/index.js` — import + three routes (place after the history routes, ~line 141)

**Interfaces:**
- Consumes: `loadSessions`, `createSession`, `insertSession`, `deleteSession` from `./sessions.js`.
- Produces:
  - `GET ${BASE_PATH}/api/sessions` → `Session[]`
  - `POST ${BASE_PATH}/api/sessions` body `{ question, answer?, events? }` → `{ ok:true, id }` (400 if no `question`)
  - `DELETE ${BASE_PATH}/api/sessions/:id` → `{ ok:true }`

- [ ] **Step 1: Add the import**

In `src/index.js`, after the existing `import { applyProposal } from './tools.js';` (line 7), add:

```js
import { loadSessions, createSession, insertSession, deleteSession } from './sessions.js';
```

- [ ] **Step 2: Add the routes**

In `src/index.js`, after the `DELETE /md-memo/api/history/:id` handler (~line 141) and before `app.listen(...)`:

```js
// GET /md-memo/api/sessions — list saved agent sessions
app.get(`${BASE_PATH}/api/sessions`, (req, res) => res.json(loadSessions()));

// POST /md-memo/api/sessions — save one agent session
app.post(`${BASE_PATH}/api/sessions`, (req, res) => {
  const { question, answer, events } = req.body || {};
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });
  const s = insertSession(createSession({ question, answer, events }));
  res.json({ ok: true, id: s.id });
});

// DELETE /md-memo/api/sessions/:id — remove a saved session
app.delete(`${BASE_PATH}/api/sessions/:id`, (req, res) => res.json(deleteSession(req.params.id)));
```

- [ ] **Step 3: Verify the routes by hand**

```bash
SESSIONS_FILE=/tmp/md-memo-sess-route.json PORT=10099 node src/index.js &
sleep 1
curl -s -X POST http://127.0.0.1:10099/md-memo/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"question":"hello","answer":"hi","events":[{"event":"answer","data":{"content":"hi"}}]}'
curl -s http://127.0.0.1:10099/md-memo/api/sessions
kill %1
```

Expected: POST prints `{"ok":true,"id":<number>}`; GET prints an array with one session whose `question` is `"hello"`.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(api): /api/sessions list/save/delete routes"
```

---

### Task 3: View-mode state machine (View / Edit / Agent / Combine)

**Files:**
- Modify: `public/index.html` — add `#mode-badge` to the footer; add `setMode`/enter/exit helpers in script 1; call `setMode` at each transition; wire `agentToggle` through enter/exit.

**Interfaces:**
- Produces (global, used by script 2 in later tasks): `setMode(mode)`, `enterAgentMode()`, `exitAgentMode()`, `restoreEditorMode()`, and the var `currentMode`.

- [ ] **Step 1: Add the mode badge to the footer**

In `public/index.html`, change the `#editor-footer` opening (line ~549-553) from:

```html
      <div id="editor-footer">
        <span id="char-count">0 chars</span>
        <div id="current-tags"></div>
        <span id="status-text"></span>
      </div>
```

to:

```html
      <div id="editor-footer">
        <span id="mode-badge">✏️ Edit Mode</span>
        <span id="char-count">0 chars</span>
        <div id="current-tags"></div>
        <span id="status-text"></span>
      </div>
```

- [ ] **Step 2: Add a style for the badge**

In the `<style>` block, directly after the `#char-count { font-family: var(--mono); }` rule (line ~304), add:

```css
    #mode-badge {
      font-size: 11px; font-weight: 700; letter-spacing: .03em;
      padding: 2px 9px; border-radius: 20px;
      background: var(--accent-dim); color: var(--accent-h); border: 1px solid #7c6af730;
    }
```

- [ ] **Step 3: Add the state machine helpers**

In script 1, immediately after the DOM const block (after `const toast = document.getElementById('toast');`, line ~635), add:

```js
    // ── VIEW MODE STATE (View / Edit / Combine / Agent) ──
    let currentMode = 'edit';
    const modeBadge = document.getElementById('mode-badge');
    function setMode(mode) {
      currentMode = mode;
      const labels = { edit: '✏️ Edit Mode', view: '👁 View Mode', combine: '⊟ Combine Mode', agent: '🤖 Agent Mode' };
      if (modeBadge) modeBadge.textContent = labels[mode] || mode;
    }
    function restoreEditorMode() {
      setMode(quickViewEntry ? 'combine' : (isPreviewMode ? 'view' : 'edit'));
    }
    function enterAgentMode() { document.body.classList.add('agent-open'); setMode('agent'); }
    function exitAgentMode() { document.body.classList.remove('agent-open'); restoreEditorMode(); }
```

- [ ] **Step 4: Call `setMode` at each transition**

Make these five edits in script 1:

1. In `showPreview(md)`, add `setMode('view');` as the last line before the closing `}` (after `btnFormat.textContent = '✨ Re-format';`).
2. In `resetToNew()`, add `setMode('edit');` right before `rawInput.focus();`.
3. In the `btnEdit` click handler, add `setMode('edit');` right before `rawInput.focus();`.
4. In `openQuickView(entry)`, add `setMode('combine');` right after `qvPanel.classList.add('open');`.
5. In `closeQuickView()`, add `setMode(isPreviewMode ? 'view' : 'edit');` as the last line before the closing `}`.

Then at the very end of script 1, after `rawInput.focus();` (line ~990), add:

```js
    setMode('edit');
```

- [ ] **Step 5: Route the agent toggle through enter/exit**

In script 2 (the agent IIFE), replace:

```js
    toggle && toggle.addEventListener('click', () => document.body.classList.toggle('agent-open'));
```

with:

```js
    toggle && toggle.addEventListener('click', () => {
      if (document.body.classList.contains('agent-open')) exitAgentMode(); else enterAgentMode();
    });
```

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

Open http://localhost:10026/md-memo/ and watch the footer badge:
1. Fresh load → **✏️ Edit Mode**.
2. Type + Format → **👁 View Mode**.
3. Click **✏️ Edit** → **✏️ Edit Mode**.
4. With raw text in the editor (Edit mode), click a history item on the right → quickview opens side-by-side and badge reads **⊟ Combine Mode**. Close quickview → back to **✏️ Edit Mode**.
5. Click 🤖 → **🤖 Agent Mode** (panel shows). Click 🤖 again → returns to the prior editor mode.

Expected: all five transitions show the right label; no console errors.

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): explicit View/Edit/Combine/Agent mode indicator"
```

---

### Task 4: Agent panel 3-column layout + back button + examples rail

**Files:**
- Modify: `public/index.html` — agent panel CSS, agent panel HTML, and example/back wiring in script 2.

**Interfaces:**
- Consumes: `exitAgentMode` (Task 3), `el`/`esc` helpers (already in script 2).
- Produces: elements `#agentSessions`/`#agentSessionList`, `#agentMain`, `#agentBack`, `#agentSaveSession`, `#agentExamples`/`#agentExampleList`; functions `renderExamples()` (used now), and the element refs consumed by Task 5/6.

- [ ] **Step 1: Replace the agent panel layout CSS**

In the `<style>` block, replace the current agent layout rules (lines ~465-472, from `#agentPanel { display: none; ...}` through `#agentSend:disabled {...}`) with:

```css
    /* ── AGENT PANEL (3-column: sessions | main | examples) ── */
    #agentPanel { display: none; flex: 1; min-height: 0; width: 100%; overflow: hidden; }
    body.agent-open #main { display: none; }
    body.agent-open #agentPanel { display: flex; flex-direction: row; }

    #agentSessions, #agentExamples {
      width: 220px; flex-shrink: 0; display: flex; flex-direction: column;
      background: var(--surface); overflow-y: auto;
    }
    #agentSessions { border-right: 1px solid var(--border); }
    #agentExamples { border-left: 1px solid var(--border); }
    .ag-side-head {
      padding: 10px 13px; font-size: 12px; font-weight: 700; letter-spacing: .06em;
      text-transform: uppercase; color: var(--text2); border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: var(--surface);
    }
    .ag-side-empty { padding: 16px 13px; font-size: 12.5px; color: var(--text3); line-height: 1.6; }

    #agentMain { flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 14px 20px; max-width: 820px; margin: 0 auto; }
    #agentHeader { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-shrink: 0; }
    #agentModeLabel { font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: .04em; }

    #agentTrace { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
    #agentBar { display: flex; gap: 8px; flex-shrink: 0; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    #agentInput { flex: 1; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; font-size: 15px; background: var(--surface); color: var(--text); }
    #agentSend { padding: 10px 18px; border: none; border-radius: 8px; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
    #agentSend:disabled { opacity: .5; cursor: default; }

    .ag-session-item, .ag-example-item {
      padding: 9px 13px; border-bottom: 1px solid var(--border); cursor: pointer;
      font-size: 13px; color: var(--text); line-height: 1.45; transition: background .12s; position: relative;
    }
    .ag-session-item:hover, .ag-example-item:hover { background: var(--surface2); }
    .ag-session-q { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-right: 18px; }
    .ag-session-time { font-size: 10.5px; color: var(--text3); font-family: var(--mono); margin-top: 3px; }
    .ag-session-tomemo { display: inline-block; margin-top: 6px; font-size: 11.5px; color: var(--accent); }
    .ag-session-del {
      position: absolute; right: 8px; top: 8px; opacity: 0; color: var(--red);
      background: var(--surface); border: 1px solid var(--border); border-radius: 4px;
      padding: 1px 6px; font-size: 10.5px; cursor: pointer; transition: opacity .15s;
    }
    .ag-session-item:hover .ag-session-del { opacity: 1; }
```

- [ ] **Step 2: Add responsive rules**

Inside the existing `@media (max-width: 700px)` block (lines ~490-497), add before its closing `}`:

```css
      body.agent-open #agentPanel { flex-direction: column; overflow: auto; }
      #agentSessions, #agentExamples { width: 100%; max-height: 22vh; border: none; border-bottom: 1px solid var(--border); }
      #agentMain { max-width: none; padding: 12px 14px; }
```

- [ ] **Step 3: Replace the agent panel HTML**

Replace the current `<section id="agentPanel">...</section>` block (lines ~583-589) with:

```html
  <section id="agentPanel">
    <aside id="agentSessions">
      <div class="ag-side-head">已存 Session</div>
      <div id="agentSessionList"><div class="ag-side-empty">尚無已存 session</div></div>
    </aside>

    <div id="agentMain">
      <div id="agentHeader">
        <span id="agentModeLabel">🤖 Agent Mode</span>
        <button class="btn btn-ghost" id="agentBack">← 返回一般模式</button>
      </div>
      <div id="agentTrace" class="md-render-host"></div>
      <div id="agentBar">
        <input id="agentInput" type="text" placeholder="問你的筆記庫，或請它整理／合併…（⌘/Ctrl + Enter 送出）" />
        <button id="agentSend">送出</button>
        <button class="btn btn-ghost" id="agentSaveSession" disabled>💾 存 Session</button>
      </div>
    </div>

    <aside id="agentExamples">
      <div class="ag-side-head">範例</div>
      <div id="agentExampleList"></div>
    </aside>
  </section>
```

- [ ] **Step 4: Wire the back button + examples in script 2**

In script 2, after the existing element consts (after `const trace = document.getElementById('agentTrace');`, line ~999), add:

```js
    const backBtn = document.getElementById('agentBack');
    const exampleList = document.getElementById('agentExampleList');

    backBtn && backBtn.addEventListener('click', () => exitAgentMode());

    const AGENT_EXAMPLES = [
      '幫我把標籤相近的筆記整理成一篇總結',
      '搜尋跟「部署」有關的筆記並條列重點',
      '把最近的會議筆記合併成一份摘要',
      '列出目前所有標籤與數量',
      '找出彼此相關的筆記並建議連結',
    ];
    function renderExamples() {
      exampleList.innerHTML = '';
      for (const ex of AGENT_EXAMPLES) {
        const item = el('div', 'ag-example-item', esc(ex));
        item.addEventListener('click', () => { input.value = ex; input.focus(); });
        exampleList.appendChild(item);
      }
    }
    renderExamples();
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Open the app, click 🤖:
1. Panel shows three columns — **已存 Session** (left, "尚無已存 session"), trace+input (center), **範例** (right, 5 example rows).
2. Click an example → it fills the input box.
3. Click **← 返回一般模式** → returns to the editor (mode badge restores).
4. Narrow the window < 700px → columns stack vertically; no horizontal overflow.

Expected: all four behaviors hold; no console errors.

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): 3-column agent panel with back button + example rail"
```

---

### Task 5: Capture, save, list, and delete sessions

**Files:**
- Modify: `public/index.html` — script 2: capture in `run()`, save button, session list render/load.

**Interfaces:**
- Consumes: `BASE`, `el`, `esc`, `renderEvent`, `showToast` (global), the new `#agentSessionList`/`#agentSaveSession` elements.
- Produces (used by Task 6): `openSession(session)`, `loadSessions()`, and the var `currentSession`.

- [ ] **Step 1: Add element refs + state**

In script 2, after the `renderExamples();` line you added in Task 4, add:

```js
    const sessionList = document.getElementById('agentSessionList');
    const saveSessionBtn = document.getElementById('agentSaveSession');
    let currentSession = null;
```

- [ ] **Step 2: Replace `run()` to capture the session**

Replace the entire `async function run() { ... }` (lines ~1048-1075) with:

```js
    async function run() {
      const message = input.value.trim();
      if (!message) return;
      sendBtn.disabled = true;
      saveSessionBtn.disabled = true;
      currentSession = null;
      const events = [];
      let answer = '';
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
            if (evM && dataM) {
              let data; try { data = JSON.parse(dataM[1]); } catch { continue; }
              const ev = evM[1].trim();
              if (ev !== 'start') events.push({ event: ev, data });
              if (ev === 'answer') answer = data.content || '';
              renderEvent(ev, data);
            }
          }
        }
        if (events.length) { currentSession = { question: message, answer, events }; saveSessionBtn.disabled = false; }
      } catch (e) { renderEvent('error', { message: e.message }); }
      finally { sendBtn.disabled = false; }
    }
```

(The `start` event is excluded from the saved `events` because `renderEvent('start', …)` clears the trace — replaying a saved session clears once up front instead.)

- [ ] **Step 3: Add save / list / open / load functions**

In script 2, directly after the new `run()` function, add:

```js
    saveSessionBtn && saveSessionBtn.addEventListener('click', async () => {
      if (!currentSession) return;
      saveSessionBtn.disabled = true;
      try {
        const r = await fetch(`${BASE}/api/sessions`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(currentSession),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || '儲存失敗');
        showToast('Session 已儲存', 'success');
        loadSessions();
      } catch (e) { showToast('Error: ' + e.message, 'error'); saveSessionBtn.disabled = false; }
    });

    function openSession(session) {
      trace.innerHTML = '';
      for (const e of session.events) renderEvent(e.event, e.data);
      trace.scrollTop = trace.scrollHeight;
    }

    function renderSessionList(list) {
      sessionList.innerHTML = '';
      if (!list.length) { sessionList.innerHTML = '<div class="ag-side-empty">尚無已存 session</div>'; return; }
      for (const s of list) {
        const item = el('div', 'ag-session-item');
        const d = new Date(s.createdAt);
        const t = d.toLocaleDateString('en', { month: 'short', day: 'numeric' }) + ' ' +
          d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
        item.innerHTML =
          `<div class="ag-session-q">${esc(s.question)}</div>` +
          `<div class="ag-session-time">${t}</div>` +
          `<button class="ag-session-del" title="刪除">✕</button>`;
        item.addEventListener('click', (e) => {
          if (e.target.closest('.ag-session-del')) return;
          openSession(s);
        });
        item.querySelector('.ag-session-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          await fetch(`${BASE}/api/sessions/${s.id}`, { method: 'DELETE' });
          loadSessions();
        });
        sessionList.appendChild(item);
      }
    }

    async function loadSessions() {
      try {
        const r = await fetch(`${BASE}/api/sessions`);
        renderSessionList(await r.json());
      } catch {}
    }
    loadSessions();
```

- [ ] **Step 4: Manual verification**

```bash
npm run dev
```

Requires `OPENROUTER_API_KEY` set for a live run (or use the demo build in Task 7). With a key:
1. Enter agent mode, ask a question, let it finish → **💾 存 Session** becomes enabled.
2. Click **存 Session** → toast "Session 已儲存"; the left column lists it (question + time).
3. Click the saved item → the trace re-renders that run.
4. Hover the item → ✕ appears; click it → the item disappears; `data/sessions.json` updates.

Expected: all four behaviors hold; `data/sessions.json` exists with the saved record.

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): capture, save, list, replay, delete agent sessions"
```

---

### Task 6: Save a session's answer as a memo

**Files:**
- Modify: `public/index.html` — script 2: add a "存成 memo" affordance per saved session (reuses `create_memo` apply).

**Interfaces:**
- Consumes: `BASE`, `showToast`, existing `POST /api/agent/apply` with `{ action:'create_memo', args:{ markdown, tags } }`.
- Produces: `saveToMemo(session)`.

- [ ] **Step 1: Add `saveToMemo` + a list affordance**

In script 2, add `saveToMemo` directly above `renderSessionList` (from Task 5):

```js
    async function saveToMemo(session) {
      const md = (session.answer || '').trim() || session.question;
      try {
        const r = await fetch(`${BASE}/api/agent/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_memo', args: { markdown: md, tags: ['agent'] } }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || '失敗');
        showToast('已存成 memo', 'success');
      } catch (e) { showToast('Error: ' + e.message, 'error'); }
    }
```

Then in `renderSessionList`, change the item's `innerHTML` to include a "存成 memo" link (add the `ag-session-tomemo` span before the delete button):

```js
        item.innerHTML =
          `<div class="ag-session-q">${esc(s.question)}</div>` +
          `<div class="ag-session-time">${t}</div>` +
          `<span class="ag-session-tomemo">📝 存成 memo</span>` +
          `<button class="ag-session-del" title="刪除">✕</button>`;
```

And update the item click guard + wire the link. Replace the item's `click` listener and add the link listener so the relevant block reads:

```js
        item.addEventListener('click', (e) => {
          if (e.target.closest('.ag-session-del') || e.target.closest('.ag-session-tomemo')) return;
          openSession(s);
        });
        item.querySelector('.ag-session-tomemo').addEventListener('click', (e) => {
          e.stopPropagation();
          saveToMemo(s);
        });
        item.querySelector('.ag-session-del').addEventListener('click', async (e) => {
          e.stopPropagation();
          await fetch(`${BASE}/api/sessions/${s.id}`, { method: 'DELETE' });
          loadSessions();
        });
```

- [ ] **Step 2: Manual verification**

```bash
npm run dev
```

1. With at least one saved session, click its **📝 存成 memo** link.
2. Toast reads "已存成 memo".
3. Click **← 返回一般模式** and check the History list (right of the editor) — a new memo holding the session's answer appears, tagged `agent`.

Expected: the memo is created and visible in history; clicking the session item still re-renders the trace (the link does not trigger replay).

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): save a session's answer as a memo"
```

---

### Task 7: Demo mock for sessions + create_memo visibility

**Files:**
- Modify: `demo/mock.js` — add `state.sessions`, mock the three `/api/sessions` routes, and make `create_memo` apply unshift into `state.history`.

**Interfaces:**
- Consumes: `state`, `json()`, `method`, `p`, `body`.
- Produces: in-demo `GET/POST/DELETE /api/sessions` and a `create_memo` apply that shows up in the history list.

- [ ] **Step 1: Add a sessions slot to demo state**

In `demo/mock.js`, change the state initializer (line ~5) from:

```js
  const state = { history: [], format: null, trace: null };
```

to:

```js
  const state = { history: [], format: null, trace: null, sessions: [] };
```

- [ ] **Step 2: Mock the sessions routes**

In `demo/mock.js`, inside `window.fetch`, add these branches before the final `return json({ error: 'unmocked: ' + p }, 404);` (line ~104):

```js
    if (p.endsWith('/api/sessions') && method === 'GET') return json(state.sessions);
    if (p.endsWith('/api/sessions') && method === 'POST') {
      const s = { id: Date.now(), createdAt: new Date().toISOString(),
        question: body.question || '', answer: body.answer || '', events: body.events || [] };
      state.sessions.unshift(s);
      return json({ ok: true, id: s.id });
    }
    if (p.includes('/api/sessions/') && method === 'DELETE') {
      const id = Number(p.split('/').pop());
      state.sessions = state.sessions.filter(s => s.id !== id);
      return json({ ok: true });
    }
```

- [ ] **Step 3: Make `create_memo` apply show in the demo history**

In `demo/mock.js`, in the `/api/agent/apply` branch (lines ~95-102), replace:

```js
    if (p.endsWith('/api/agent/apply') && method === 'POST') {
      if (body.action === 'merge_memos') {
        const entry = mergedNoteFrom(body.args || {}, state.trace.apply);
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      return json({ ok: true, id: Date.now() });
    }
```

with:

```js
    if (p.endsWith('/api/agent/apply') && method === 'POST') {
      if (body.action === 'merge_memos') {
        const entry = mergedNoteFrom(body.args || {}, state.trace.apply);
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      if (body.action === 'create_memo') {
        const a = body.args || {};
        const entry = {
          id: Date.now(), createdAt: new Date().toISOString(), raw: '',
          markdown: a.markdown || '', tags: a.tags || [],
          preview: (a.markdown || '').split('\n').find(l => l.trim()) || '(empty)',
        };
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      return json({ ok: true, id: Date.now() });
    }
```

- [ ] **Step 4: Build and verify the demo**

```bash
npm run build:demo
```

Serve `dist-demo/` (e.g. `npx --yes http-server dist-demo -p 8081`) and open `/md-memo/`:
1. Click 🤖 → the prerecorded run replays. After **done**, click **💾 存 Session** → it appears in the left list.
2. Click **📝 存成 memo** on it → toast "已存成 memo".
3. Click **← 返回一般模式** → the new memo is in History.

Expected: sessions save/list/delete in-memory; create_memo appears in history; no console errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites (including `sessions.test.mjs` and the existing demo-data tests) green.

- [ ] **Step 6: Commit**

```bash
git add demo/mock.js
git commit -m "feat(demo): mock /api/sessions and create_memo history visibility"
```

---

### Task 8: Docs + contract review

**Files:**
- Modify: `CLAUDE.md` — document the sessions module, routes, and the named modes.

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, under `### 路由`, add after the sessions-adjacent history lines:

```markdown
- `GET/POST /md-memo/api/sessions`、`DELETE /md-memo/api/sessions/:id` — 已存 agent session 的列出／儲存／刪除（`src/sessions.js`，存 `data/sessions.json`）
```

Under `### Agent` (or a new short note near it), add:

```markdown
前端 agent 面板為三欄：左側已存 session 清單（可重播、可「存成 memo」，後者重用 `create_memo` apply）、中間 trace+輸入、右側範例 prompt。檢視模式由 `setMode()` 集中管理：View / Edit / Agent / Combine（Combine = 編輯時開 quickview 的左右並排）。
```

- [ ] **Step 2: Dispatch the contract-reviewer agent**

Dispatch `contract-reviewer` over the diff (`src/index.js`, `src/sessions.js`, `public/index.html`, `demo/mock.js`). Expected: BASE_PATH paths all derive from `BASE`/`API`; tags + permalink contracts untouched.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: agent sessions, routes, and view modes"
```

---

## Self-Review

- **Spec coverage:**
  - "Back to Normal Mode button" → Task 4 `#agentBack` + Task 3 `exitAgentMode`. ✓
  - "Clarify View/Edit/Agent/Combine" → Task 3 `setMode` + footer badge; Combine = the existing quickview side-by-side, per the user's clarification. ✓
  - "More examples on the right side" → Task 4 `#agentExamples` rail. ✓
  - "Save session results + left-side list of saved sessions" → Tasks 1/2/5. ✓
  - "Saved session → memo" → Task 6 (reuses `create_memo` apply). ✓
- **Placeholder scan:** none — every code step shows full code; every verify step has a command + expected result.
- **Type consistency:** `Session = { id, createdAt, question, answer, events }` is identical across `src/sessions.js` (Task 1), the POST route (Task 2), the front-end capture (Task 5), and the demo mock (Task 7). `events[]` items are `{ event, data }` everywhere. The save-to-memo payload matches the existing `applyProposal('create_memo', { markdown, tags })` contract in `src/tools.js`. ✓
- **Cross-script scope:** `setMode`/`enterAgentMode`/`exitAgentMode`/`showToast` are declared at top level of script 1 and called from script 2 — valid for classic scripts sharing global scope (noted in Global Constraints). ✓
