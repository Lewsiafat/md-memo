# History Clear (backup + double confirm) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Clear all history" safe — back up `data/history.json` to a `.bak` file on the server before wiping, and require a two-step (double) confirmation in the UI instead of one native `confirm()`.

**Architecture:** Add a single server-side `clearHistory()` in the store that copies the history file to `history.bak.json` then writes `[]`, expose it via `POST /api/history/clear`, and replace the front-end per-id DELETE loop with one call to that endpoint behind an arm-then-confirm button. The demo (no backend) clears its in-memory state through the same endpoint shape.

**Tech Stack:** Node 20.12+ ESM, Express, vanilla JS (inline in `public/index.html`), `node:test`. No new dependencies.

## Global Constraints

- Node **20.12+**, ES Modules. **No new npm dependencies** (only `express`).
- All routes mount under `BASE_PATH` (default `/md-memo`). Front-end path strings MUST come from the existing `API` / `BASE` consts (derived from the `__BASE_PATH__` placeholder) — never hard-code a path.
- Backend store logic is tested with `node --test`; the history file path is overridable via `process.env.HISTORY_FILE` (already supported in `src/store.js`).
- Server binds `127.0.0.1` only.
- Do not touch the tags contract (`parseTags`) or the permalink renderer — this feature is unrelated to them.
- After cross-file changes, dispatch the `contract-reviewer` agent to confirm the BASE_PATH/tags/dual-render contracts are intact.

---

## File Structure

- `src/store.js` — add `clearHistory()` next to `loadHistory`/`saveHistory`. Owns the backup-then-wipe logic and the backup path derivation.
- `src/index.js` — add one route `POST ${BASE_PATH}/api/history/clear`; import `clearHistory`.
- `public/index.html` — replace the `btnClearAll` click handler (lines ~973-983) with an arm-then-confirm handler that calls the new endpoint once.
- `demo/mock.js` — add a `POST /api/history/clear` branch that clears `state.history` in memory.
- `test/store.test.mjs` — add two tests for `clearHistory` (backup written + empty; missing file → `backedUp:false`).

---

### Task 1: `clearHistory()` in the store (backup then wipe)

**Files:**
- Modify: `src/store.js` (add function after `insertEntry`, ~line 48)
- Test: `test/store.test.mjs` (append)

**Interfaces:**
- Consumes: existing `historyFile()`, `saveHistory()`, `fs`, `path` already in `src/store.js`.
- Produces: `clearHistory(): { ok: true, backedUp: boolean, count: number }` — `backedUp` is `false` when there was no history file to copy; `count` is how many entries were in the backup.

- [ ] **Step 1: Write the failing tests**

Append to `test/store.test.mjs` (the file already sets `process.env.HISTORY_FILE` and imports from `../src/store.js` — extend that import to include `clearHistory`):

```js
test('clearHistory backs up to a .bak file then empties history', () => {
  saveHistory([createEntry({ markdown: 'keep me' }), createEntry({ markdown: 'and me' })]);
  const r = clearHistory();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.backedUp, true);
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(loadHistory(), []);
  const bak = process.env.HISTORY_FILE.replace(/\.json$/, '') + '.bak.json';
  assert.ok(fs.existsSync(bak), 'backup file exists');
  assert.strictEqual(JSON.parse(fs.readFileSync(bak, 'utf8')).length, 2);
});

test('clearHistory on a missing file reports backedUp:false', () => {
  fs.rmSync(process.env.HISTORY_FILE, { force: true });
  const r = clearHistory();
  assert.strictEqual(r.backedUp, false);
  assert.strictEqual(r.count, 0);
  assert.deepStrictEqual(loadHistory(), []);
});
```

Update the existing import line in `test/store.test.mjs` from:

```js
const { loadHistory, saveHistory, createEntry, insertEntry, HISTORY_LIMIT } =
  await import('../src/store.js');
```

to:

```js
const { loadHistory, saveHistory, createEntry, insertEntry, clearHistory, HISTORY_LIMIT } =
  await import('../src/store.js');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `clearHistory is not a function` (TypeError) in the two new tests.

- [ ] **Step 3: Implement `clearHistory`**

Add to `src/store.js` immediately after `insertEntry` (the current last function, ~line 48):

```js
// Back up the current history file to <name>.bak.json (overwriting any prior
// backup), then write an empty history. backedUp is false when there was no
// file to copy (nothing to lose). Returns { ok, backedUp, count }.
export function clearHistory() {
  const f = historyFile();
  let backedUp = false;
  let count = 0;
  if (fs.existsSync(f)) {
    const bak = f.replace(/\.json$/, '') + '.bak.json';
    fs.copyFileSync(f, bak);
    backedUp = true;
    try { count = JSON.parse(fs.readFileSync(f, 'utf8')).length; } catch {}
  }
  saveHistory([]);
  return { ok: true, backedUp, count };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all store tests green (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.mjs
git commit -m "feat(store): clearHistory backs up to .bak.json then wipes"
```

---

### Task 2: `POST /api/history/clear` route

**Files:**
- Modify: `src/index.js` (import + route near the DELETE handler, ~line 135)

**Interfaces:**
- Consumes: `clearHistory` from `./store.js`.
- Produces: `POST ${BASE_PATH}/api/history/clear` → JSON `{ ok, backedUp, count }`.

- [ ] **Step 1: Add the import**

In `src/index.js`, extend the store import (currently line 5):

```js
import { loadHistory, saveHistory, createEntry, insertEntry, clearHistory } from './store.js';
```

- [ ] **Step 2: Add the route**

In `src/index.js`, directly above the existing `DELETE /md-memo/api/history/:id` handler (~line 135):

```js
// POST /md-memo/api/history/clear — back up to history.bak.json, then wipe
app.post(`${BASE_PATH}/api/history/clear`, (req, res) => {
  res.json(clearHistory());
});
```

- [ ] **Step 3: Verify the route by hand**

Run the server against a throwaway history file so you don't disturb real data:

```bash
HISTORY_FILE=/tmp/md-memo-route-test.json node -e "import('./src/store.js').then(m=>{m.saveHistory([m.createEntry({markdown:'x'})]);})"
HISTORY_FILE=/tmp/md-memo-route-test.json PORT=10099 node src/index.js &
sleep 1
curl -s -X POST http://127.0.0.1:10099/md-memo/api/history/clear
curl -s http://127.0.0.1:10099/md-memo/api/history
kill %1
ls -l /tmp/md-memo-route-test.bak.json
```

Expected: first curl prints `{"ok":true,"backedUp":true,"count":1}`; second prints `[]`; `ls` shows the `.bak.json` exists.

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat(api): POST /api/history/clear endpoint"
```

---

### Task 3: Arm-then-confirm Clear button (front-end)

**Files:**
- Modify: `public/index.html` — replace the `btnClearAll` handler (current lines ~973-983)

**Interfaces:**
- Consumes: existing `API` const, `history` array, `renderTagCloud`, `renderHistoryItems`, `closeQuickView`, `showToast`, `btnClearAll` element.
- Produces: clicking `#btn-clear-all` once arms it (label → "Confirm?"); a second click within 4s calls `POST ${API}/history/clear`; otherwise it disarms.

- [ ] **Step 1: Replace the handler**

In `public/index.html`, replace the entire current `btnClearAll.addEventListener('click', async () => { ... })` block (lines ~973-983) with:

```js
    // ── CLEAR ALL (arm → confirm; backs up server-side) ──
    let clearArmed = false;
    let clearTimer;
    function disarmClear() {
      clearArmed = false;
      clearTimeout(clearTimer);
      btnClearAll.textContent = 'Clear';
      btnClearAll.style.color = '';
    }
    btnClearAll.addEventListener('click', async () => {
      if (!history.length) return;
      if (!clearArmed) {
        clearArmed = true;
        btnClearAll.textContent = 'Confirm?';
        btnClearAll.style.color = 'var(--red)';
        clearTimer = setTimeout(disarmClear, 4000);
        return;
      }
      disarmClear();
      try {
        const res = await fetch(`${API}/history/clear`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Clear failed');
        history = [];
        activeTagFilter = null;
        renderTagCloud();
        renderHistoryItems();
        closeQuickView();
        showToast(data.backedUp ? `Cleared — backed up ${data.count} memo(s)` : 'History cleared', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
```

- [ ] **Step 2: Manual verification (no front-end test harness in this repo)**

```bash
npm run dev
```

Open http://localhost:10026/md-memo/ . With at least one memo in history:
1. Click **Clear** once → button turns red and reads **Confirm?**.
2. Wait > 4s without clicking → it reverts to **Clear** (disarmed). ✓
3. Click **Clear** → **Confirm?** → click again → history empties, toast reads "Cleared — backed up N memo(s)".
4. Confirm `data/history.bak.json` now exists and holds the pre-clear memos.

Expected: all four behaviors hold; no console errors.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat(ui): arm-then-confirm Clear via /api/history/clear"
```

---

### Task 4: Demo mock for the clear endpoint

**Files:**
- Modify: `demo/mock.js` — add a `POST /api/history/clear` branch

**Interfaces:**
- Consumes: existing `state.history`, `json()` helper, `method`, `p`.
- Produces: in the demo, `POST /api/history/clear` clears `state.history` and returns `{ ok, backedUp, count }` (no real file backup — the demo has no backend).

- [ ] **Step 1: Add the branch**

In `demo/mock.js`, inside `window.fetch`, add this branch directly **before** the existing `/api/history/` DELETE branch (~line 87):

```js
    if (p.endsWith('/api/history/clear') && method === 'POST') {
      const count = state.history.length;
      state.history = [];
      return json({ ok: true, backedUp: count > 0, count });
    }
```

- [ ] **Step 2: Build and verify the demo**

```bash
npm run build:demo
npx --yes http-server dist-demo -p 8081 >/dev/null 2>&1 &
sleep 1
echo "open http://127.0.0.1:8081/md-memo/ and exercise Clear"
```

(If `http-server` is unavailable, open `dist-demo/md-memo/index.html` via any static server you have.)
Open the demo, click **Clear → Confirm?** → again. Expected: the 10 seeded memos disappear, toast shows "Cleared — backed up 10 memo(s)", no console errors. Stop the static server when done (`kill %1`).

- [ ] **Step 3: Run the full test suite (demo-data consistency unaffected)**

Run: `npm test`
Expected: PASS — all suites green.

- [ ] **Step 4: Commit**

```bash
git add demo/mock.js
git commit -m "feat(demo): mock POST /api/history/clear"
```

---

### Task 5: Contract review + CLAUDE.md route note

**Files:**
- Modify: `CLAUDE.md` — add the new route to the Routes list (~the `### 路由` section)

- [ ] **Step 1: Document the route**

In `CLAUDE.md`, under `### 路由`, add a line after the `DELETE /md-memo/api/history/:id` bullet:

```markdown
- `POST /md-memo/api/history/clear` — 先把 `data/history.json` 複製成 `data/history.bak.json`，再清空（前端兩段式確認）
```

- [ ] **Step 2: Dispatch the contract-reviewer agent**

Dispatch the `contract-reviewer` agent over the diff (`src/index.js`, `public/index.html`, `demo/mock.js`). Expected: no contract violations (BASE_PATH uses `API` const; tags/permalink untouched).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note /api/history/clear route"
```

---

## Self-Review

- **Spec coverage:** "double confirmation" → Task 3 arm-then-confirm. "copy history.json to a .bak then clear" → Task 1 `clearHistory` (copy to `history.bak.json`, then `saveHistory([])`). ✓
- **Placeholder scan:** none — every step has exact code/commands.
- **Type consistency:** `clearHistory()` returns `{ ok, backedUp, count }` in Task 1; Task 2 returns it verbatim; Task 3 reads `data.backedUp`/`data.count`; Task 4 mirrors the same shape. ✓
- **Backup path:** derived identically in `src/store.js` (`f.replace(/\.json$/, '') + '.bak.json'`) and asserted with the same expression in the test. ✓
