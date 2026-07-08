# Agent Mode Hardening (C1+H1+H2+H3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修復 agent-mode 審查的四個確認問題——儲存層資料歸零路徑(C1)、proposal id 綁定(H1)、propose 階段驗證回饋(H2)、SSE 斷線真中止(H3)。

**Architecture:** 儲存層改原子寫入+損毀隔離;新增 in-memory 一次性 proposal registry(`src/proposals.js`),apply 只收 `{ id }`;從 `applyProposal` 抽出 `validateProposal` 讓 agent loop 在 propose 階段驗證並把錯誤餵回模型;AbortController 從 HTTP handler 貫穿 `runAgent` 到 `fetch`。「存成 memo」改走新的 `POST /api/history`。

**Tech Stack:** Node.js 22+ 內建(fs、crypto、node:test)、Express。**零新依賴。**

**Spec:** `docs/plans/2026-07-08-agent-mode-hardening-design.md`

## Global Constraints

- 零新依賴;只用 Node 內建模組。ESM(`import`),2-space 縮排、單引號、有分號——比照既有檔案。
- 測試框架:`node --test`(每個 test 檔獨立 process)。全部既有測試必須保持綠燈,不改既有斷言。
- 後端產生的使用者可見文案遵循 `AGENT_LANG` 慣例:zh 系用繁體中文,否則英文(比照 `src/tools.js` 的 `LANG_ZH` 寫法)。
- 前端 `public/index.html` 內任何 API 路徑一律用既有的 `BASE` 常數(源自 `__BASE_PATH__` placeholder),不得寫死 `/md-memo`。
- 錯誤訊息精確值(測試與前端顯示都依賴):
  - apply 未知/已用過 id → zh:`提案已失效或不存在` / en:`Proposal expired or unknown`
  - raw create 缺 markdown → `markdown (non-empty string) required`(沿用既有訊息)
- 每個 task 結尾 commit;commit message 用 conventional prefix(`fix:`/`feat:`/`test:`/`docs:`)。
- 只動 task 列出的檔案。不順手改排版、註解或無關程式碼。

---

### Task 1: C1 — `src/store.js` 損毀隔離 + 原子寫入

**Files:**
- Modify: `src/store.js:34-50`(`loadHistory`/`saveHistory`)
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: 無(第一個 task)。
- Produces: `loadHistory()`/`saveHistory()` 簽名不變,行為改變:parse 失敗時把損毀檔 rename 成 `<name去掉.json>.corrupt-<ISO時間戳,:.換->.json` 並回 `[]`;save 走 `<file>.tmp` + `fs.renameSync`。

- [ ] **Step 1: 在 `test/store.test.mjs` 加失敗測試**

檔案頂部 import 區加一行(在 `import fs from 'node:fs';` 之後):

```js
import path from 'node:path';
```

檔案結尾追加:

```js
test('loadHistory quarantines a corrupted file and returns []', () => {
  const f = process.env.HISTORY_FILE;
  const dir = path.dirname(f);
  const prefix = path.basename(f).replace(/\.json$/, '') + '.corrupt-';
  // clean stale quarantine files from previous runs
  for (const n of fs.readdirSync(dir).filter(n => n.startsWith(prefix))) {
    fs.rmSync(path.join(dir, n), { force: true });
  }
  fs.writeFileSync(f, '{ not valid json');
  assert.deepStrictEqual(loadHistory(), []);
  assert.ok(!fs.existsSync(f), 'corrupted file moved away');
  const quarantined = fs.readdirSync(dir).filter(n => n.startsWith(prefix));
  assert.strictEqual(quarantined.length, 1);
  assert.match(quarantined[0], /\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  const qPath = path.join(dir, quarantined[0]);
  assert.strictEqual(fs.readFileSync(qPath, 'utf8'), '{ not valid json', 'original bytes preserved');
  fs.rmSync(qPath, { force: true });
});

test('loadHistory quarantines valid JSON that is not an array', () => {
  const f = process.env.HISTORY_FILE;
  const dir = path.dirname(f);
  const prefix = path.basename(f).replace(/\.json$/, '') + '.corrupt-';
  fs.writeFileSync(f, '"just a string"');
  assert.deepStrictEqual(loadHistory(), []);
  assert.ok(!fs.existsSync(f));
  for (const n of fs.readdirSync(dir).filter(n => n.startsWith(prefix))) {
    fs.rmSync(path.join(dir, n), { force: true });
  }
});

test('saveHistory writes atomically and leaves no .tmp residue', () => {
  saveHistory([createEntry({ markdown: '# atomic' })]);
  assert.ok(fs.existsSync(process.env.HISTORY_FILE));
  assert.ok(!fs.existsSync(process.env.HISTORY_FILE + '.tmp'));
  assert.strictEqual(loadHistory()[0].markdown, '# atomic');
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/store.test.mjs`
Expected: 前兩個新測試 FAIL(現行 `loadHistory` 靜默回 `[]`、檔案原地不動,`corrupted file moved away` 斷言失敗)。第三個測試(`.tmp` residue)改動前後都會 PASS——它是防「留下殘檔」的回歸守門,不是紅燈驅動;紅燈由前兩個提供。

- [ ] **Step 3: 改 `src/store.js`**

把現有的 `loadHistory`/`saveHistory`(第 34-50 行)整段換成:

```js
export function loadHistory() {
  const f = historyFile();
  if (!fs.existsSync(f)) return [];
  let history;
  try {
    history = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(history)) throw new Error('history is not an array');
  } catch (err) {
    // Corrupted file: move it aside so no later save can overwrite the bytes,
    // then continue with an empty library. Recovery = inspect the .corrupt file.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const quarantine = f.replace(/\.json$/, '') + `.corrupt-${ts}.json`;
    fs.renameSync(f, quarantine);
    console.error(`history file corrupted — moved to ${quarantine}:`, err.message);
    return [];
  }
  if (backfillIdentity(history)) saveHistory(history);
  return history;
}

export function saveHistory(history) {
  const f = historyFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // tmp + rename so the real file is never half-written on disk.
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2));
  fs.renameSync(tmp, f);
}
```

注意:backfill 的 `saveHistory(history)` 在 try 之外——backfill 寫回失敗要照舊拋出,不得被 catch 吞掉(spec §2.1)。

- [ ] **Step 4: 跑測試確認全綠**

Run: `node --test test/store.test.mjs`
Expected: 全部 PASS(含既有 18 個測試)。

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.mjs
git commit -m "fix: quarantine corrupted history.json and write atomically (C1)"
```

---

### Task 2: C1 — `src/sessions.js` 同款修復

**Files:**
- Modify: `src/sessions.js:13-25`(`loadSessions`/`saveSessions`)
- Test: `test/sessions.test.mjs`

**Interfaces:**
- Consumes: 無。
- Produces: `loadSessions()` 行為同 Task 1 的 `loadHistory`(隔離+回 `[]`);`saveSessions`(模組私有)改 tmp+rename。

- [ ] **Step 1: 在 `test/sessions.test.mjs` 加失敗測試**

檔案頂部 import 區加(在 `import fs from 'fs';` 之後):

```js
import path from 'node:path';
```

檔案結尾追加:

```js
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
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/sessions.test.mjs`
Expected: quarantine 測試 FAIL(`corrupted file moved away` 斷言失敗)。

- [ ] **Step 3: 改 `src/sessions.js`**

把現有的 `loadSessions`/`saveSessions`(第 13-25 行)整段換成:

```js
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
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `node --test test/sessions.test.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/sessions.js test/sessions.test.mjs
git commit -m "fix: quarantine corrupted sessions.json and write atomically (C1)"
```

---

### Task 3: H2(前半)— 從 `applyProposal` 抽出 `validateProposal`

**Files:**
- Modify: `src/tools.js:192-243`(`existingIds`/`applyProposal` 一帶)
- Test: `test/tools.test.mjs`

**Interfaces:**
- Consumes: 無。
- Produces: `export function validateProposal(action, args = {}) -> { ok: true } | { ok: false, error: string }`(from `src/tools.js`)。`applyProposal({ action, args })` 對外行為與回傳格式完全不變。

- [ ] **Step 1: 在 `test/tools.test.mjs` 加失敗測試**

檔案結尾追加:

```js
const { validateProposal } = await import('../src/tools.js');

test('validateProposal passes valid args for every action', () => {
  seed();
  assert.deepStrictEqual(validateProposal('create_memo', { markdown: '# x' }), { ok: true });
  assert.ok(validateProposal('merge_memos', { source_ids: [1, 2], markdown: 'm' }).ok);
  assert.ok(validateProposal('link_memos', { ids: [1, 3] }).ok);
  assert.ok(validateProposal('retag_memo', { id: 2, tags: [] }).ok);
});

test('validateProposal rejects empty markdown, unknown ids, unknown actions', () => {
  seed();
  assert.strictEqual(validateProposal('create_memo', {}).ok, false);
  assert.strictEqual(validateProposal('merge_memos', { source_ids: [1], markdown: '   ' }).ok, false);
  assert.match(validateProposal('merge_memos', { source_ids: [1, 999], markdown: 'm' }).error, /999/);
  assert.match(validateProposal('link_memos', { ids: [999] }).error, /999/);
  assert.strictEqual(validateProposal('retag_memo', { id: 999 }).ok, false);
  assert.strictEqual(validateProposal('delete_everything', {}).ok, false);
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/tools.test.mjs`
Expected: FAIL — `validateProposal` is not a function(尚未 export)。

- [ ] **Step 3: 改 `src/tools.js`**

在 `existingIds()`(第 192-194 行)之後、`applyProposal` 之前插入:

```js
// Validate a write proposal's args against the current history. Runs at
// propose time (agent loop — the error feeds back to the model so it can
// self-correct) and again at apply time (history may have changed between
// propose and apply).
export function validateProposal(action, args = {}) {
  switch (action) {
    case 'create_memo': {
      if (typeof args.markdown !== 'string' || !args.markdown.trim())
        return { ok: false, error: 'markdown (non-empty string) required' };
      return { ok: true };
    }
    case 'merge_memos': {
      if (typeof args.markdown !== 'string' || !args.markdown.trim())
        return { ok: false, error: 'markdown (non-empty string) required' };
      const ids = (args.source_ids || []).map(Number);
      const have = existingIds();
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown source ids: ${missing.join(', ')}` };
      return { ok: true };
    }
    case 'link_memos': {
      const ids = (args.ids || []).map(Number);
      const have = existingIds();
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown ids: ${missing.join(', ')}` };
      return { ok: true };
    }
    case 'retag_memo': {
      if (!existingIds().has(Number(args.id)))
        return { ok: false, error: `No memo with id ${args.id}` };
      return { ok: true };
    }
    default:
      return { ok: false, error: `Unknown action ${action}` };
  }
}
```

然後把整個 `applyProposal`(原第 197-243 行)換成(驗證邏輯移除、改為開頭統一呼叫 `validateProposal`,錯誤訊息與回傳格式不變):

```js
// ---- Apply a user-confirmed proposal. Mutates history. ----
export function applyProposal({ action, args = {} }) {
  const v = validateProposal(action, args);
  if (!v.ok) return { ok: false, error: v.error };
  switch (action) {
    case 'create_memo': {
      const entry = insertEntry(createEntry({ markdown: args.markdown, tags: args.tags || [] }));
      return { ok: true, id: entry.id };
    }
    case 'merge_memos': {
      const ids = (args.source_ids || []).map(Number);
      const md = args.title ? `# ${args.title}\n\n${args.markdown}` : args.markdown;
      const entry = insertEntry(createEntry({ markdown: md, tags: args.tags || [], sources: ids }));
      return { ok: true, id: entry.id };
    }
    case 'link_memos': {
      const ids = (args.ids || []).map(Number);
      const history = loadHistory();
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
      m.tags = args.tags || [];
      saveHistory(history);
      return { ok: true, id };
    }
    default:
      return { ok: false, error: `Unknown action ${action}` };
  }
}
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `node --test test/tools.test.mjs`
Expected: 全部 PASS(既有 applyProposal 測試不動照過——驗證行為與錯誤訊息一字不差)。

- [ ] **Step 5: Commit**

```bash
git add src/tools.js test/tools.test.mjs
git commit -m "refactor: extract validateProposal from applyProposal (H2 groundwork)"
```

---

### Task 4: H1(前半)— `src/proposals.js` 一次性 registry

**Files:**
- Create: `src/proposals.js`
- Test: `test/proposals.test.mjs`(新檔)

**Interfaces:**
- Consumes: 無。
- Produces: `registerProposal(proposal: object) -> string`(UUID)、`takeProposal(id: string|undefined) -> object | null`(取出即刪,一次性),from `src/proposals.js`。

- [ ] **Step 1: 建 `test/proposals.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert';

const { registerProposal, takeProposal } = await import('../src/proposals.js');

test('registerProposal returns an id; takeProposal consumes exactly once', () => {
  const p = { action: 'create_memo', args: { markdown: '# x' }, summary: 's' };
  const id = registerProposal(p);
  assert.ok(typeof id === 'string' && id.length > 0);
  assert.strictEqual(takeProposal(id), p);
  assert.strictEqual(takeProposal(id), null);   // one-time: second take misses
});

test('takeProposal returns null for unknown or missing ids', () => {
  assert.strictEqual(takeProposal('nope'), null);
  assert.strictEqual(takeProposal(undefined), null);
});

test('registry evicts the oldest entry beyond 200 pending', () => {
  const first = registerProposal({ action: 'create_memo', args: {}, summary: 'first' });
  for (let i = 0; i < 200; i++) {
    registerProposal({ action: 'create_memo', args: {}, summary: `p${i}` });
  }
  assert.strictEqual(takeProposal(first), null);   // evicted, not consumable
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/proposals.test.mjs`
Expected: FAIL — Cannot find module '../src/proposals.js'。

- [ ] **Step 3: 建 `src/proposals.js`**

```js
import crypto from 'crypto';

// In-memory one-time registry for agent write proposals (H1). The apply
// endpoint consumes proposals by id, so replays (double-click, restored
// sessions, tampered args) get nothing. Server restart drops pending
// proposals by design — the user just re-runs the agent.
const MAX_PENDING = 200;
const pending = new Map();

// Store a proposal, return its one-time id. Oldest entries are evicted
// beyond MAX_PENDING so abandoned streams can't grow the map forever.
export function registerProposal(proposal) {
  const id = crypto.randomUUID();
  pending.set(id, proposal);
  if (pending.size > MAX_PENDING) {
    pending.delete(pending.keys().next().value);   // Map iterates in insertion order
  }
  return id;
}

// Retrieve and consume. Unknown or already-used ids return null.
export function takeProposal(id) {
  const proposal = pending.get(id) ?? null;
  pending.delete(id);
  return proposal;
}
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `node --test test/proposals.test.mjs`
Expected: 3 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/proposals.js test/proposals.test.mjs
git commit -m "feat: one-time in-memory proposal registry (H1 groundwork)"
```

---

### Task 5: H2+H1(agent loop)— propose 階段驗證回饋 + proposal 帶 id

**Files:**
- Modify: `src/agent.js:1`(import)、`src/agent.js:61-75`(write 分支)
- Test: `test/agent.test.mjs`

**Interfaces:**
- Consumes: `validateProposal`(Task 3)、`registerProposal`(Task 4)。
- Produces: SSE `proposal` 事件 data 形狀變為 `{ id, action, args, summary }`(前端 Task 8、demo Task 9 依賴);無效 write args 改 emit `tool_result` 事件 `{ name, result: { error } }` 且錯誤進入 messages 餵回模型。

- [ ] **Step 1: 在 `test/agent.test.mjs` 加失敗測試**

檔案結尾追加:

```js
test('invalid write args feed the error back to the model (no proposal)', async () => {
  saveHistory([]);   // empty library → source id 999 is invalid
  let secondTurnMessages = null;
  let turn = 0;
  const fake = async (messages) => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'merge_memos', arguments: '{"source_ids":[999],"markdown":"m"}' } }] },
      usage: {} };
    secondTurnMessages = messages;
    return { message: { role: 'assistant', content: 'corrected' }, usage: {} };
  };
  const c = collector();
  await runAgent('merge stuff', c.emit, { callModel: fake });
  assert.ok(!c.names().includes('proposal'), 'invalid args never become a proposal');
  const tr = c.events.find(e => e[0] === 'tool_result')[1];
  assert.match(tr.result.error, /999/);
  const toolMsg = secondTurnMessages.find(m => m.role === 'tool');
  assert.match(toolMsg.content, /999/, 'model saw the validation error');
});

test('valid write proposal event carries a one-time registered id', async () => {
  saveHistory([]);
  let turn = 0;
  const fake = async () => {
    turn++;
    if (turn === 1) return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_memo', arguments: '{"markdown":"# New"}' } }] },
      usage: {} };
    return { message: { role: 'assistant', content: 'done' }, usage: {} };
  };
  const c = collector();
  await runAgent('make a memo', c.emit, { callModel: fake });
  const prop = c.events.find(e => e[0] === 'proposal')[1];
  assert.ok(typeof prop.id === 'string' && prop.id.length > 0);
  assert.strictEqual(prop.action, 'create_memo');
  const { takeProposal } = await import('../src/proposals.js');
  const stored = takeProposal(prop.id);
  assert.strictEqual(stored.action, 'create_memo');
  assert.strictEqual(takeProposal(prop.id), null);   // consumed
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/agent.test.mjs`
Expected: 兩個新測試 FAIL(現行無效 args 照樣 emit proposal;proposal 事件沒有 `id`)。既有 3 個測試 PASS。

- [ ] **Step 3: 改 `src/agent.js`**

第 1 行 import 改成:

```js
import { TOOLS, TOOL_KIND, runReadTool, buildProposal, validateProposal } from './tools.js';
import { registerProposal } from './proposals.js';
```

`runAgent` 內 write 分支(原本的 `if (TOOL_KIND[name] === 'write') { ... } else { ... }`)換成:

```js
      if (TOOL_KIND[name] === 'write') {
        const valid = validateProposal(name, args);
        if (valid.ok) {
          const proposal = buildProposal(name, args);
          emit('proposal', { id: registerProposal(proposal), ...proposal });
          toolContent = 'Proposed to the user for confirmation. Assume not yet applied.';
        } else {
          // Invalid args never reach the user — the error goes back to the
          // model as a tool result so it can self-correct within this run.
          emit('tool_result', { name, result: { error: valid.error } });
          toolContent = JSON.stringify({ error: valid.error });
        }
      } else {
        const result = runReadTool(name, args);
        emit('tool_result', { name, result });
        toolContent = JSON.stringify(result);
      }
```

- [ ] **Step 4: 跑測試確認全綠**

Run: `node --test test/agent.test.mjs && npm run smoke`
Expected: agent 測試全 PASS;smoke 印出 `✓ smoke-agent passed: start → message → tool_call → tool_result → message → answer → done`。

- [ ] **Step 5: Commit**

```bash
git add src/agent.js test/agent.test.mjs
git commit -m "feat: validate write proposals at propose time, emit one-time proposal ids (H1+H2)"
```

---

### Task 6: H3 — AbortController 貫穿 runAgent 與 fetch

**Files:**
- Modify: `src/agent.js:17-37`(`callOpenRouter`)、`src/agent.js:47-52`(`runAgent` 簽名與迴圈開頭)
- Modify: `src/index.js:104-125`(`POST /api/agent` handler)
- Test: `test/agent.test.mjs`

**Interfaces:**
- Consumes: 無新依賴。
- Produces: `runAgent(message, emit, { callModel, priorTurns, signal })`——`signal?.aborted` 時在下一 step 前靜默 return;`callOpenRouter(messages, tools, { signal } = {})` 第三參數傳進 `fetch`。注入式 `callModel` 同簽名(第三參數可忽略)。

- [ ] **Step 1: 在 `test/agent.test.mjs` 加失敗測試**

檔案結尾追加:

```js
test('aborted signal stops the loop before the next step', async () => {
  const ac = new AbortController();
  let calls = 0;
  const fake = async () => {
    calls++;
    ac.abort();   // client "disconnects" right after the first model call
    return { message: { role: 'assistant', content: '',
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'list_tags', arguments: '{}' } }] }, usage: {} };
  };
  const c = collector();
  await runAgent('loop forever', c.emit, { callModel: fake, signal: ac.signal });
  assert.strictEqual(calls, 1, 'no second model call after abort');
  assert.ok(!c.names().includes('done'), 'run ends silently, no done event');
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/agent.test.mjs`
Expected: 新測試 FAIL(`calls` 會跑到 8——現行迴圈不看 signal)。

- [ ] **Step 3: 改 `src/agent.js`**

`callOpenRouter` 簽名與 fetch options 改成(其餘內容不動):

```js
export async function callOpenRouter(messages, tools, { signal } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const model = process.env.AGENT_MODEL || process.env.AI_MODEL || 'deepseek/deepseek-v4-pro';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Lewsiafat/md-memo',
      'X-Title': 'md-memo',
    },
    body: JSON.stringify({ model, messages, tools, temperature: 0.3, max_tokens: 4096 }),
    signal,
  });
```

`runAgent` 簽名與迴圈開頭改成:

```js
export async function runAgent(message, emit, { callModel = callOpenRouter, priorTurns = [], signal } = {}) {
  const messages = [{ role: 'system', content: SYSTEM }, ...priorTurns, { role: 'user', content: message }];
  let totalTokens = 0;
  emit('start', {});
  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal?.aborted) return;   // client gone — stop burning tokens
    const { message: msg, usage } = await callModel(messages, TOOLS, { signal });
```

- [ ] **Step 4: 改 `src/index.js` 的 `/api/agent` handler**

把 handler 內 `try/catch/finally` 一帶(原第 117-124 行)換成,並在 `const emit = ...` 之後加 AbortController 接線:

```js
  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  // Abort the loop (and any in-flight OpenRouter request) when the client
  // disconnects mid-stream. A normal end also fires 'close', hence the guard.
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });
  try {
    await runAgent(message, emit, { signal: ac.signal });
  } catch (err) {
    if (ac.signal.aborted) {
      console.log('Agent run aborted: client disconnected');
    } else {
      console.error('Agent error:', err);
      emit('error', { message: err.message });
    }
  } finally {
    res.end();
  }
```

- [ ] **Step 5: 跑測試確認全綠**

Run: `npm test && npm run smoke`
Expected: 全部 PASS;smoke 通過。

- [ ] **Step 6: Commit**

```bash
git add src/agent.js src/index.js test/agent.test.mjs
git commit -m "fix: abort agent loop and in-flight OpenRouter call on SSE disconnect (H3)"
```

---

### Task 7: H1(後半)— apply 改收 `{ id }` + 新增 `POST /api/history`

**Files:**
- Modify: `src/index.js:8-9`(import)、`src/index.js:20`(語言常數)、`src/index.js:127-134`(apply handler)、`src/index.js:186-193` 之後(新 endpoint)

**Interfaces:**
- Consumes: `takeProposal`(Task 4)、`applyProposal`(Task 3)、`insertEntry`/`createEntry`(既有)。
- Produces: HTTP 契約——`POST /api/agent/apply` body `{ id: string }`,成功回 `applyProposal` 原格式(`{ ok:true, id }` 或 `{ ok:true, ids }`),id 未知/已用回 `400 { ok:false, error }`;`POST /api/history` body `{ markdown: string, tags?: string[] }` 回 `{ ok:true, id }` 或 `400`。前端(Task 8)與 demo(Task 9)依賴此契約。

- [ ] **Step 1: 改 `src/index.js`**

import 區(第 9 行 `sessions.js` import 之後)加:

```js
import { takeProposal } from './proposals.js';
```

`RESPONSE_LANG` 定義(第 20 行)之後加:

```js
const LANG_ZH = RESPONSE_LANG.startsWith('zh');
```

apply handler(原第 127-134 行)整段換成:

```js
// POST /md-memo/api/agent/apply — execute a user-confirmed write proposal.
// Takes the one-time proposal id issued during the SSE stream; the args live
// server-side, so double-clicks, replayed sessions, and tampered args all 400.
app.post(`${BASE_PATH}/api/agent/apply`, (req, res) => {
  const { id } = req.body || {};
  const proposal = id ? takeProposal(id) : null;
  if (!proposal) {
    return res.status(400).json({ ok: false, error: LANG_ZH ? '提案已失效或不存在' : 'Proposal expired or unknown' });
  }
  const result = applyProposal(proposal);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});
```

`PUT /api/history/:id` handler 區塊(原第 186-193 行)之後加:

```js
// POST /md-memo/api/history — raw create without the LLM (agent panel's
// "save session as memo" uses this; /api/agent/apply is proposals-only).
app.post(`${BASE_PATH}/api/history`, (req, res) => {
  const { markdown, tags } = req.body || {};
  if (typeof markdown !== 'string' || !markdown.trim())
    return res.status(400).json({ ok: false, error: 'markdown (non-empty string) required' });
  const entry = insertEntry(createEntry({ markdown, tags: tags || [] }));
  res.json({ ok: true, id: entry.id });
});
```

- [ ] **Step 2: 跑既有測試確認沒弄壞**

Run: `npm test`
Expected: 全 PASS(此 task 無單元測試——專案沒有 HTTP 層測試基建,不為此新建;用下一步的 curl 實測驗證)。

- [ ] **Step 3: 起 server 用 curl 實測**

```bash
HISTORY_FILE=/tmp/md-memo-task7.json PORT=10099 node src/index.js & SERVER_PID=$!
sleep 1
# 1) raw create 成功
curl -s -X POST localhost:10099/md-memo/api/history -H 'Content-Type: application/json' -d '{"markdown":"# Manual test","tags":["t"]}'
# 期望:{"ok":true,"id":<數字>}
# 2) raw create 缺 markdown → 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:10099/md-memo/api/history -H 'Content-Type: application/json' -d '{}'
# 期望:400
# 3) 舊契約(action+args)已關閉 → 400
curl -s -X POST localhost:10099/md-memo/api/agent/apply -H 'Content-Type: application/json' -d '{"action":"create_memo","args":{"markdown":"# X"}}'
# 期望:{"ok":false,"error":"提案已失效或不存在"}
# 4) 未知 id → 400
curl -s -X POST localhost:10099/md-memo/api/agent/apply -H 'Content-Type: application/json' -d '{"id":"bogus"}'
# 期望:{"ok":false,"error":"提案已失效或不存在"}
kill $SERVER_PID
rm -f /tmp/md-memo-task7.json
```

四個輸出都要符合期望才算過。

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: apply consumes one-time proposal ids; add raw-create POST /api/history (H1)"
```

---

### Task 8: 前端 — apply 送 `{ id }`、「存成 memo」改走 `POST /api/history`

**Files:**
- Modify: `public/index.html:1802-1805`(`renderProposal` 的 apply fetch)、`public/index.html:1913-1915`(`saveToMemo` 的 fetch)

**Interfaces:**
- Consumes: Task 5 的 proposal 事件 `{ id, action, args, summary }`、Task 7 的 HTTP 契約。
- Produces: 前端行為——套用送 `{ id: data.id }`;重播舊 session(事件裡沒有 id 或 id 已失效)按套用 → server 400,錯誤文字經既有 `✗ <message>` 路徑顯示(即原設計的「來源已變動」);存成 memo 打 `POST ${BASE}/api/history`。

- [ ] **Step 1: 改 `renderProposal` 的 apply fetch body**

`public/index.html` 內找到(約 1802-1805 行):

```js
          const r = await fetch(`${BASE}/api/agent/apply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: data.action, args: data.args }),
          });
```

把 body 那行改成:

```js
            body: JSON.stringify({ id: data.id }),
```

- [ ] **Step 2: 改 `saveToMemo` 的 fetch**

找到(約 1913-1915 行):

```js
        const r = await fetch(`${BASE}/api/agent/apply`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_memo', args: { markdown: md, tags: ['agent'] } }),
        });
```

換成:

```js
        const r = await fetch(`${BASE}/api/history`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: md, tags: ['agent'] }),
        });
```

- [ ] **Step 3: 驗證**

```bash
npm test
grep -c 'api/agent/apply' public/index.html
```

Expected: 測試全綠;grep 輸出 `1`(只剩 `renderProposal` 一處呼叫 apply)。

- [ ] **Step 4: Commit**

```bash
git add public/index.html
git commit -m "feat: frontend applies proposals by one-time id; save-as-memo uses POST /api/history (H1)"
```

---

### Task 9: Demo 同步 — trace 加 id、mock 依 id 套用、補 raw-create handler

**Files:**
- Modify: `demo/data/agent-trace.json:25-34`(proposal 事件)
- Modify: `demo/mock.js:5`(state)、`demo/mock.js:19-33`(`ensureData`)、`demo/mock.js:87-98` 之後(raw-create handler)、`demo/mock.js:176-194`(apply handler)
- Test: `test/demo-data.test.mjs`

**Interfaces:**
- Consumes: Task 5 的 proposal 事件形狀、Task 7/8 的 HTTP 契約(mock 必須模仿 server 行為,demo 才能流經真前端 code)。
- Produces: demo bundle 在新前端契約下可運作。

- [ ] **Step 1: 在 `test/demo-data.test.mjs` 加失敗測試**

檔案結尾追加:

```js
test('every proposal event carries an apply id (frontend sends { id })', () => {
  const props = trace.events.filter(e => e.event === 'proposal');
  assert.ok(props.length > 0);
  for (const ev of props) {
    assert.ok(typeof ev.data.id === 'string' && ev.data.id.length > 0);
  }
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `node --test test/demo-data.test.mjs`
Expected: 新測試 FAIL(trace 的 proposal data 還沒有 `id`)。

- [ ] **Step 3: 改 `demo/data/agent-trace.json`**

proposal 事件的 data(第 25 行起)加 `id` 欄位——`"action"` 之前插入一行:

```json
    { "event": "proposal", "data": {
      "id": "demo-proposal-1",
      "action": "merge_memos",
```

(其餘內容不動。)

- [ ] **Step 4: 改 `demo/mock.js`**

(a) 第 5 行 state 加 `proposals`:

```js
  const state = { history: [], format: null, trace: null, sessions: [], proposals: {} };
```

(b) `ensureData` 內 `state.trace = t;` 之後加(建 id → proposal 查表;不刪除,demo trace 可重播):

```js
        for (const ev of t.events) {
          if (ev.event === 'proposal') state.proposals[ev.data.id] = ev.data;
        }
```

(c) `GET /api/history` 區塊(約第 87-98 行)之後加 raw-create handler:

```js
    if (p.endsWith('/api/history') && method === 'POST') {
      const md = body.markdown || '';
      if (!md.trim()) return json({ ok: false, error: 'markdown (non-empty string) required' }, 400);
      const entry = {
        id: Date.now(), createdAt: new Date().toISOString(), raw: '',
        markdown: md, tags: body.tags || [],
        preview: md.split('\n').find(l => l.trim()) || '(empty)',
        title: demoTitle(md),
      };
      state.history.unshift(entry);
      return json({ ok: true, id: entry.id });
    }
```

(d) apply handler(原第 176-194 行)整段換成(依 id 查表;查不到回與 server 相同的 400;demo 刻意**不**做一次性消費,同一段 trace 重播後仍可套用):

```js
    if (p.endsWith('/api/agent/apply') && method === 'POST') {
      const prop = body.id ? state.proposals[body.id] : null;
      if (!prop) return json({ ok: false, error: '提案已失效或不存在' }, 400);
      if (prop.action === 'merge_memos') {
        const entry = mergedNoteFrom(prop.args || {}, state.trace.apply);
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      if (prop.action === 'create_memo') {
        const a = prop.args || {};
        const entry = {
          id: Date.now(), createdAt: new Date().toISOString(), raw: '',
          markdown: a.markdown || '', tags: a.tags || [],
          preview: (a.markdown || '').split('\n').find(l => l.trim()) || '(empty)',
          title: demoTitle(a.markdown || ''),
        };
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      return json({ ok: true, id: Date.now() });
    }
```

- [ ] **Step 5: 跑測試 + build 驗證**

Run: `npm test && npm run build:demo`
Expected: 全 PASS;build 成功產出 `dist-demo/`(含 `m/200/index.html`)。

- [ ] **Step 6: Commit**

```bash
git add demo/data/agent-trace.json demo/mock.js test/demo-data.test.mjs
git commit -m "feat: demo mock follows the id-based apply contract (H1)"
```

---

### Task 10: 文件同步 + 全量驗證

**Files:**
- Modify: `CLAUDE.md`(路由段、Agent 段、資料儲存段)

**Interfaces:**
- Consumes: Task 1-9 全部落地後的實際行為。
- Produces: CLAUDE.md 與現況一致;全套驗證輸出。

- [ ] **Step 1: 改 `CLAUDE.md`**

先 Read 全檔取得精確原文,做三處修改(以下為目標內容;實際 old_string 以 Read 結果為準):

(a) 路由段——`POST /md-memo/api/agent/apply` 那一行改成,並在其後加一行:

```markdown
- `POST /md-memo/api/agent/apply` — 以一次性 proposal id 落地 agent 的寫入 proposal(body `{ id }`;args 存 server 端 registry,id 未知/已用過/server 重啟後回 400,防重複套用與竄改)
- `POST /md-memo/api/history` — raw create,不跑 LLM(body `{ markdown, tags? }`;agent session「存成 memo」用)
```

(b) Agent 段——「寫入類工具(…)只 emit `proposal`,由 `POST /api/agent/apply` 在使用者確認後落地」句子之後補上:

```markdown
寫入提案在 propose 階段先以 `validateProposal`(`src/tools.js`)驗證,失敗時錯誤以 tool_result 餵回模型自我修復、不會顯示給使用者;通過的提案由 `src/proposals.js`(in-memory 一次性 registry,上限 200 筆 FIFO)發 id,SSE `proposal` 事件帶 `{ id, action, args, summary }`。SSE 斷線時 `/api/agent` 以 AbortController 中止 loop 與 in-flight OpenRouter 請求。
```

(c) 資料儲存段——「`loadHistory()`/`saveHistory()` 直接讀寫整個檔案」句子處補上:

```markdown
寫入為原子操作(先寫 `<file>.tmp` 再 rename);讀檔 parse 失敗時把損毀檔隔離成 `<name>.corrupt-<時間戳>.json` 後以空庫繼續(原始內容保留可人工救回),`sessions.json` 同款處理。
```

- [ ] **Step 2: 全量驗證**

```bash
npm test 2>&1 | tail -5
npm run smoke
npm run build:demo
```

Expected: `npm test` 顯示 `fail 0`;smoke 印 `✓ smoke-agent passed`;build:demo 成功。

- [ ] **Step 3: C1 端到端手動驗證(spec 驗收 #2)**

```bash
echo '{broken' > /tmp/md-memo-c1-e2e.json
HISTORY_FILE=/tmp/md-memo-c1-e2e.json PORT=10099 node src/index.js & SERVER_PID=$!
sleep 1
curl -s localhost:10099/md-memo/api/history | head -c 120
# 期望:{"items":[],"total":0,"all":0}(server 正常起,空庫)
ls /tmp/md-memo-c1-e2e.corrupt-*.json && cat /tmp/md-memo-c1-e2e.corrupt-*.json
# 期望:隔離檔存在、內容是 {broken
kill $SERVER_PID
rm -f /tmp/md-memo-c1-e2e*.json
```

同時確認 server console 印出 `history file corrupted — moved to …`。

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: sync CLAUDE.md with hardened agent-mode contracts (C1+H1+H2+H3)"
```

- [ ] **Step 5(orchestrator 執行): dispatch `contract-reviewer` agent**

本次改了 `src/index.js`、`src/tools.js`、`public/index.html`——依專案 CLAUDE.md 規定,由 orchestrator dispatch 專案的 `contract-reviewer` subagent 檢查三個隱性契約(tags 格式、BASE_PATH、雙套渲染)未被破壞。

---

## 已知不做(與 spec §6 一致)

- spec 驗收 #3(瀏覽器連點兩下套用)與 #5(關分頁後 OpenRouter 停止請求)需要真 API key 跑出真 proposal 才能端到端觀察——一次性消費與 abort 行為已由單元測試(Task 4/5/6)與 curl(Task 7)覆蓋,實機驗證留給部署後抽查。
- demo mock 重複套用會產生重複 id 200 的筆記是**既有**行為(前端按鈕 disable 擋第一層),本次不修——只換契約,不擴大 demo 範圍。
- H4 多輪、M1-M3、L1-L3:不在本計畫。
