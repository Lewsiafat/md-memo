# Memo 地基與列表可用性（Phase 0 + 0.5）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解除 50 筆上限、給 memo 加上 title/slug 身分、API 分頁輕量化，並讓 Memo List 在 1,000 筆規模下可搜尋、可篩選、可分頁、可鍵盤操作。

**Architecture:** 後端把分頁/篩選邏輯放進 `src/store.js` 的純函式（`listEntries`）以便 `node --test` 直測，`src/index.js` 只做薄路由；title/slug 推導獨立成 `src/slug.js`（Phase 1 wikilink 會重用）；全庫搜尋直接重用 `src/tools.js` 的 `searchMemos`。前端 SPA 從「一次抓全量」改為「輕量分頁＋單篇按需抓全文」，搜尋為兩層（已載入項即時過濾＋Enter 全庫搜尋）。

**Tech Stack:** Node >=22.9（內建 `node --test`）、Express、vanilla JS inline SPA（無框架無 build）、demo 用 monkeypatched fetch mock。

**Spec:** `specs/memo-foundation-and-list.md`

## Global Constraints

- 零新依賴（`package.json` dependencies 只有 express）；SPA 無 build step，所有 JS/CSS inline 在 `public/index.html`。
- `public/index.html` 新增任何路徑相關字串必須經由既有常數 `API`（=`'__BASE_PATH__/api'`，index.html:760）或 `BASE` 組出，**絕不出現裸路徑**。
- 不碰 tags 契約：`/api/format` 的 system prompt 與 `src/format.js` 的 `parseTags()` 一律不改。
- 不碰 `src/permalink.js`（permalink 用 `entry.markdown` 全文，不受列表輕量化影響）。
- Express 路由順序：`GET /api/history/search` 必須註冊在 `GET /api/history/:id` 之前。
- `node --test` 每個測試檔跑在獨立 child process——測試檔頂部設 `process.env.*` 再 `await import` 是安全的既有模式（見 `test/store.test.mjs:5-9`），照抄。
- Commit message 用中文 conventional style（如 `feat: …`），結尾加上：
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 完成每個 task 後把 `specs/memo-foundation-and-list.md` 對應的 checkbox 打勾。

---

### Task 1: `HISTORY_LIMIT` 改環境變數（預設 1000）

**Files:**
- Modify: `src/store.js:6`（`HISTORY_LIMIT` 常數）、`src/store.js:55`（`insertEntry` 的 slice）
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces: `export function historyLimit(): number`——讀 `process.env.HISTORY_LIMIT`，無效或未設回 1000。`HISTORY_LIMIT` 常數移除（全 repo 只有 store.js 與 store.test.mjs 用到，已確認）。

- [ ] **Step 1: 改寫測試**

`test/store.test.mjs` 頂部（`HISTORY_FILE` 設定之後、import 之前）加：

```js
process.env.HISTORY_LIMIT = '30';
```

import 行把 `HISTORY_LIMIT` 換成 `historyLimit`：

```js
const { loadHistory, saveHistory, createEntry, insertEntry, updateEntry, clearHistory, historyLimit } =
  await import('../src/store.js');
```

新增測試，並把既有 `insertEntry prepends and enforces the limit` 測試裡的 `HISTORY_LIMIT` 全部換成 `historyLimit()`：

```js
test('historyLimit reads HISTORY_LIMIT env (default 1000 when unset)', () => {
  assert.strictEqual(historyLimit(), 30);   // set at top of this file
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/store.test.mjs`
Expected: FAIL——`historyLimit` is not a function（named export 不存在）

- [ ] **Step 3: 實作**

`src/store.js` 第 6 行替換：

```js
// History cap, from env (JSON 全檔重寫：量大時每次寫入成本隨檔案大小線性成長).
export function historyLimit() {
  return Number(process.env.HISTORY_LIMIT) || 1000;
}
```

`insertEntry` 內 `HISTORY_LIMIT` → `historyLimit()`：

```js
export function insertEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  saveHistory(history.slice(0, historyLimit()));
  return entry;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/store.test.mjs` → PASS；再跑 `npm test` 全綠（確認沒有其他檔案還 import `HISTORY_LIMIT`）。

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.mjs
git commit -m "feat: HISTORY_LIMIT 改環境變數（預設 1000），解除 50 筆硬上限"
```

---

### Task 2: `src/slug.js` — title 推導與 slug 產生

**Files:**
- Create: `src/slug.js`
- Test: `test/slug.test.mjs`

**Interfaces:**
- Produces:
  - `deriveTitle(markdown: string): string`——第一個標題行（去 `#`、去 `**`/反引號），無標題行則第一個非空行，全空回 `'(untitled)'`。
  - `slugify(text: string): string`——小寫、非「unicode 字母/數字」連段轉 `-`、去頭尾 `-`；空結果回 `'memo'`。CJK 保留（`claude-code-使用心得`）。
  - `uniqueSlug(base: string, taken: Set<string>): string`——`base` 未占用直接回；否則 `base-2`、`base-3`…

- [ ] **Step 1: 寫失敗測試**

Create `test/slug.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { deriveTitle, slugify, uniqueSlug } from '../src/slug.js';

test('deriveTitle picks the first heading line, stripped', () => {
  assert.strictEqual(deriveTitle('intro text\n\n## **Real** `Title`\n\nbody'), 'Real Title');
});

test('deriveTitle falls back to the first non-empty line', () => {
  assert.strictEqual(deriveTitle('\n\njust a plain line\nmore'), 'just a plain line');
});

test('deriveTitle handles empty/blank markdown', () => {
  assert.strictEqual(deriveTitle(''), '(untitled)');
  assert.strictEqual(deriveTitle('   \n  '), '(untitled)');
});

test('slugify kebab-cases and strips punctuation', () => {
  assert.strictEqual(slugify('Hello,  World! v2.0'), 'hello-world-v2-0');
});

test('slugify keeps CJK characters', () => {
  assert.strictEqual(slugify('Claude Code 使用心得'), 'claude-code-使用心得');
});

test('slugify returns "memo" when nothing survives', () => {
  assert.strictEqual(slugify('!!! ...'), 'memo');
});

test('uniqueSlug appends -2, -3… on collision', () => {
  assert.strictEqual(uniqueSlug('a', new Set()), 'a');
  assert.strictEqual(uniqueSlug('a', new Set(['a'])), 'a-2');
  assert.strictEqual(uniqueSlug('a', new Set(['a', 'a-2'])), 'a-3');
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/slug.test.mjs`
Expected: FAIL——Cannot find module `src/slug.js`

- [ ] **Step 3: 實作**

Create `src/slug.js`:

```js
// Title & slug derivation — the memo's wiki identity (Phase 1 wikilinks
// resolve against slugs, so a slug must stay stable once assigned).

// First markdown heading line (hashes/bold/backticks stripped); falls back
// to the first non-empty line.
export function deriveTitle(markdown) {
  const lines = String(markdown || '').split('\n');
  const line = lines.find(l => /^#{1,6}\s+\S/.test(l.trim())) ?? lines.find(l => l.trim());
  if (!line) return '(untitled)';
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim() || '(untitled)';
}

// Kebab-case keeping unicode letters/digits, so CJK titles stay readable.
export function slugify(text) {
  const s = String(text || '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'memo';
}

export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/slug.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/slug.js test/slug.test.mjs
git commit -m "feat: src/slug.js — memo title 推導與 CJK 友善 slug 產生"
```

---

### Task 3: store 接上 title/slug ＋ 舊資料 lazy 補齊

**Files:**
- Modify: `src/store.js`（`loadHistory`、`createEntry`、`insertEntry`、`updateEntry`）
- Test: `test/store.test.mjs`

**Interfaces:**
- Consumes: Task 2 的 `deriveTitle`/`slugify`/`uniqueSlug`。
- Produces: entry 形狀新增 `title`（`createEntry` 產生、`updateEntry` 改 markdown 時重算）與 `slug`（`insertEntry` 落庫時對現有 slug 唯一化，之後**永不變**）。`loadHistory()` 對缺 title/slug 的舊條目就地補齊並持久化一次（舊 `history.json` 免手動遷移）。

- [ ] **Step 1: 寫失敗測試**

`test/store.test.mjs` 追加：

```js
test('createEntry derives title from markdown', () => {
  const e = createEntry({ markdown: '# My Note\n\nbody' });
  assert.strictEqual(e.title, 'My Note');
});

test('insertEntry assigns unique, stable slugs for duplicate titles', () => {
  saveHistory([]);
  const a = insertEntry(createEntry({ markdown: '# Same Title' }));
  const b = insertEntry(createEntry({ markdown: '# Same Title' }));
  assert.strictEqual(a.slug, 'same-title');
  assert.strictEqual(b.slug, 'same-title-2');
});

test('loadHistory lazily backfills title/slug on legacy entries and persists once', () => {
  fs.writeFileSync(process.env.HISTORY_FILE, JSON.stringify([
    { id: 1, createdAt: 'a', raw: '', markdown: '# Legacy\n\nx', tags: [], preview: '# Legacy' },
  ]));
  const h = loadHistory();
  assert.strictEqual(h[0].title, 'Legacy');
  assert.strictEqual(h[0].slug, 'legacy');
  // persisted, not just in-memory
  const onDisk = JSON.parse(fs.readFileSync(process.env.HISTORY_FILE, 'utf8'));
  assert.strictEqual(onDisk[0].slug, 'legacy');
});

test('updateEntry recomputes title but never touches slug', () => {
  saveHistory([]);
  const e = insertEntry(createEntry({ markdown: '# Before' }));
  const updated = updateEntry(e.id, { markdown: '# After' });
  assert.strictEqual(updated.title, 'After');
  assert.strictEqual(updated.slug, 'before');   // slug is identity — stable
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/store.test.mjs`
Expected: FAIL——`e.title` 為 undefined 等

- [ ] **Step 3: 實作**

`src/store.js` 頂部加 import：

```js
import { deriveTitle, slugify, uniqueSlug } from './slug.js';
```

`loadHistory` 改為（含 backfill）：

```js
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
```

`createEntry` 的 entry literal 加 `title`（放在 `preview` 上面一行）：

```js
    title: deriveTitle(markdown),
```

`insertEntry` 在 unshift 前指派 slug：

```js
export function insertEntry(entry) {
  const history = loadHistory();
  entry.slug = uniqueSlug(slugify(entry.title ?? deriveTitle(entry.markdown)),
    new Set(history.map(e => e.slug).filter(Boolean)));
  history.unshift(entry);
  saveHistory(history.slice(0, historyLimit()));
  return entry;
}
```

`updateEntry` 的 markdown 分支加 title 重算（slug 不動）：

```js
  if (markdown != null) {
    entry.markdown = markdown;
    entry.title = deriveTitle(markdown);
    entry.preview = markdown.split('\n').find(l => l.trim()) || '(empty)';
  }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/store.test.mjs` → PASS；`npm test` 全綠（其他測試手工塞的 entry 會被 backfill 補上 title/slug，不影響既有斷言）。

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.mjs
git commit -m "feat: memo 加上 title/slug 身分，舊資料 lazy 補齊免遷移"
```

---

### Task 4: `listEntries` — 分頁/篩選/排序的輕量列表（store）

**Files:**
- Modify: `src/store.js`（新增 export）
- Test: `test/store.test.mjs`

**Interfaces:**
- Produces: `listEntries({ limit = 50, offset = 0, tag = null, order = 'desc' }): { items, total, all }`——`items` 只含 `id`/`title`/`slug`/`preview`/`tags`/`createdAt`（**無** `markdown`/`raw`）；`total` 為 tag 篩選後總數；`all` 為全庫筆數。儲存序是新→舊，`order:'asc'` 反轉。

- [ ] **Step 1: 寫失敗測試**

`test/store.test.mjs` 追加：

```js
test('listEntries paginates lightweight fields with total/all', () => {
  saveHistory([]);
  for (let i = 0; i < 5; i++) {
    insertEntry(createEntry({ raw: `raw${i}`, markdown: `# N${i}`, tags: i % 2 ? ['odd'] : ['even'] }));
  }
  const page = listEntries({ limit: 2, offset: 1 });
  assert.strictEqual(page.total, 5);
  assert.strictEqual(page.all, 5);
  assert.strictEqual(page.items.length, 2);
  assert.strictEqual(page.items[0].title, 'N3');       // newest-first, offset 1
  assert.ok(!('markdown' in page.items[0]), 'no full text in list items');
  assert.ok(!('raw' in page.items[0]), 'no raw in list items');
  assert.ok(page.items[0].slug, 'slug included');
});

test('listEntries filters by tag (total follows the filter, all does not)', () => {
  const r = listEntries({ tag: 'odd' });
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.all, 5);
  assert.ok(r.items.every(e => e.tags.includes('odd')));
});

test('listEntries order asc returns oldest first', () => {
  const r = listEntries({ order: 'asc', limit: 1 });
  assert.strictEqual(r.items[0].title, 'N0');
});
```

並把 `listEntries` 加進檔案頂部的 import destructuring。

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/store.test.mjs` → FAIL（`listEntries` undefined）

- [ ] **Step 3: 實作**

`src/store.js` 末尾新增：

```js
// Paginated, lightweight listing for the Memo List UI. total counts after
// the tag filter; all is the whole library (the "全部 N" in the count line).
export function listEntries({ limit = 50, offset = 0, tag = null, order = 'desc' } = {}) {
  const history = loadHistory();
  let filtered = tag ? history.filter(e => (e.tags || []).includes(tag)) : history;
  if (order === 'asc') filtered = filtered.slice().reverse();
  const items = filtered.slice(offset, offset + limit).map(e => ({
    id: e.id, title: e.title, slug: e.slug, preview: e.preview,
    tags: e.tags || [], createdAt: e.createdAt,
  }));
  return { items, total: filtered.length, all: history.length };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/store.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.mjs
git commit -m "feat: listEntries — 分頁/tag 篩選/排序的輕量列表查詢"
```

---

### Task 5: `searchMemos` 回傳補 `title`

**Files:**
- Modify: `src/tools.js`（`searchMemos` 的結果 map，約 :132）
- Test: `test/tools.test.mjs`

**Interfaces:**
- Produces: `searchMemos()` 每筆結果多一個 `title` 欄位（agent 的 `search_memos` 與 Task 6 的 `/api/history/search` 同時受益）。

- [ ] **Step 1: 寫失敗測試**

`test/tools.test.mjs` 追加（沿用該檔既有的 HISTORY_FILE seeding 模式；若該檔用 `saveHistory` 準備資料就照抄同款）：

```js
test('searchMemos results include the memo title', () => {
  saveHistory([]);
  insertEntry(createEntry({ markdown: '# Docker Deploy Notes\n\nsteps here', tags: ['deploy'] }));
  const r = searchMemos({ query: 'docker' });
  assert.strictEqual(r[0].title, 'Docker Deploy Notes');
});
```

（若 `tools.test.mjs` 尚未 import `saveHistory`/`insertEntry`/`createEntry`，從 `../src/store.js` 補進 import。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/tools.test.mjs` → FAIL（`title` undefined）

- [ ] **Step 3: 實作**

`src/tools.js` `searchMemos` 的 `.map(({ m }) => ({ ... }))` 加一行：

```js
      title: m.title,
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/tools.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add src/tools.js test/tools.test.mjs
git commit -m "feat: searchMemos 結果補 title 欄位（agent 與 UI 搜尋共用）"
```

---

### Task 6: API 路由 — 分頁列表、全庫搜尋、單篇、tags

**Files:**
- Modify: `src/index.js`（import 行 :5、:8；替換 `GET /api/history` handler :127-130；新增三條路由）

**Interfaces:**
- Consumes: `listEntries`（Task 4）、`searchMemos`/`listTags`（`src/tools.js`）。
- Produces:
  - `GET {BASE_PATH}/api/history?limit&offset&tag&order` → `{ items, total, all }`（limit 預設 50、上限 200；order 只認 `asc`，其他一律 `desc`）
  - `GET {BASE_PATH}/api/history/search?q=&limit=` → `{ items }`（searchMemos 結果；limit 預設 20、上限 50）
  - `GET {BASE_PATH}/api/history/:id` → 單篇完整 entry；非數字或不存在 → 404 `{ error }`
  - `GET {BASE_PATH}/api/tags` → `[{ tag, count }]`（listTags 原樣）

- [ ] **Step 1: 實作**

`src/index.js` import 改為：

```js
import { loadHistory, saveHistory, createEntry, insertEntry, updateEntry, clearHistory, listEntries } from './store.js';
import { applyProposal, searchMemos, listTags } from './tools.js';
```

把現有 `GET /api/history`（:127-130）整段替換為（**順序即註冊順序：search 在 :id 之前**）：

```js
// GET /md-memo/api/history — paginated, lightweight list: { items, total, all }
app.get(`${BASE_PATH}/api/history`, (req, res) => {
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const order = req.query.order === 'asc' ? 'asc' : 'desc';
  const tag = req.query.tag || null;
  res.json(listEntries({ limit, offset, tag, order }));
});

// GET /md-memo/api/history/search — full-library search, same scoring as the
// agent's search_memos tool. Must be registered before /api/history/:id.
app.get(`${BASE_PATH}/api/history/search`, (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
  res.json({ items: searchMemos({ query: req.query.q || '', limit }) });
});

// GET /md-memo/api/history/:id — full entry (quickview / restore need markdown+raw)
app.get(`${BASE_PATH}/api/history/:id`, (req, res) => {
  const id = Number(req.params.id);
  const entry = Number.isFinite(id) ? loadHistory().find(e => e.id === id) : null;
  if (!entry) return res.status(404).json({ error: 'Memo not found' });
  res.json(entry);
});

// GET /md-memo/api/tags — all tags with counts (memo list tag cloud)
app.get(`${BASE_PATH}/api/tags`, (req, res) => res.json(listTags()));
```

- [ ] **Step 2: curl 驗證（邏輯已在 Task 4/5 單測覆蓋，這裡驗路由接線與順序）**

```bash
node -e "
const a=[];for(let i=0;i<5;i++)a.push({id:100+i,createdAt:new Date(1700000000000+i*1e6).toISOString(),raw:'r'+i,markdown:'# Seed '+i,tags:[i%2?'odd':'even'],preview:'# Seed '+i});
require('fs').writeFileSync('/tmp/claude-1002/-home-lewsi-Documents-workspaceSide-md-memo/3c1d5794-162d-4626-b14d-93e49f0db80b/scratchpad/api-check.json',JSON.stringify(a.reverse()))"
HISTORY_FILE=/tmp/claude-1002/-home-lewsi-Documents-workspaceSide-md-memo/3c1d5794-162d-4626-b14d-93e49f0db80b/scratchpad/api-check.json PORT=10199 node src/index.js &
sleep 1
curl -s 'http://127.0.0.1:10199/md-memo/api/history?limit=2&offset=1&order=asc'   # items[0].title == "Seed 1"；total:5 all:5；items 無 markdown
curl -s 'http://127.0.0.1:10199/md-memo/api/history?tag=odd'                      # total:2 all:5
curl -s 'http://127.0.0.1:10199/md-memo/api/history/search?q=seed'                # { items: [...] } 含 title/snippet
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:10199/md-memo/api/history/999'  # 404
curl -s 'http://127.0.0.1:10199/md-memo/api/history/102'                          # 完整 entry 含 markdown/raw
curl -s 'http://127.0.0.1:10199/md-memo/api/tags'                                 # [{tag:"even",count:3},{tag:"odd",count:2}]
kill %1
```

Expected: 如各行註解；特別確認 `search` 沒有被 `:id` 路由吃掉（回 `{items:[…]}` 而非 404）。

- [ ] **Step 3: 全測試**

Run: `npm test` → 全綠

- [ ] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: history API 分頁輕量化＋search/單篇/tags 端點"
```

---

### Task 7: SPA 資料層改造（封套、分頁狀態、單篇按需抓全文、tags 端點、計數列）

> 本 task 後 SPA 恢復可用（外觀不變、行為等價），是後續 UI task 的地基。SPA 無單元測試——驗證一律用 seeded dev server 手動走查。

**Files:**
- Modify: `public/index.html`——
  - i18n 兩份字典（en 約 :804「Memo list」區、zh-TW 約 :916 同區）
  - State 區（:1019-1026）
  - `loadHistoryData`（:1350-1357）、`getFilteredHistory`（:1359-1362）、`renderTagCloud`（:1364-1388）、`renderHistoryItems`（:1390-1452）、`handleHistoryClick`（:1454-1472）、`deleteEntry`（:1474-1479）、clear handler（:1490-1513）

**Interfaces:**
- Consumes: Task 6 的四個端點。
- Produces（供 Task 8-12 使用的全域）: `history`（已載入輕量項，累積分頁）、`historyTotal`、`libraryTotal`、`sortOrder`、`searchText`、`searchResults`（非 null＝全庫搜尋模式）、`tagCounts`、`PAGE_SIZE=50`、`fetchEntry(id)`、`loadHistoryData(reset=true)`、`loadTagCloud()`、`getDisplayItems()`、`renderHistoryCount()`。

- [ ] **Step 1: i18n 字串（en 與 zh-TW 的「Memo list (history) panel」區各加）**

en：

```js
        countTotal: '{total} memos',
        countMatched: '{n} / {total} memos',
```

zh-TW：

```js
        countTotal: '共 {total} 筆',
        countMatched: '符合 {n}／全部 {total}',
```

- [ ] **Step 2: State 區（:1019-1026）替換為**

```js
    // State
    let currentMarkdown = '';
    let currentTags = [];
    let currentId = null;
    let isPreviewMode = false;
    let history = [];          // loaded lightweight items (pages accumulate)
    let historyTotal = 0;      // total after tag filter (server-side)
    let libraryTotal = 0;      // whole library size
    let sortOrder = 'desc';
    let searchText = '';       // live filter over loaded items
    let searchResults = null;  // non-null → full-library search mode
    let tagCounts = [];        // [{tag, count}] from /api/tags
    let activeTagFilter = null;
    let quickViewEntry = null;
    const PAGE_SIZE = 50;
```

- [ ] **Step 3: 資料層函式（:1350-1362 的 `loadHistoryData`＋`getFilteredHistory`）替換為**

```js
    async function fetchEntry(id) {
      try {
        const res = await fetch(`${API}/history/${id}`);
        if (!res.ok) return null;
        return await res.json();
      } catch { return null; }
    }

    async function loadHistoryData(reset = true) {
      try {
        const offset = reset ? 0 : history.length;
        const params = new URLSearchParams({ limit: PAGE_SIZE, offset, order: sortOrder });
        if (activeTagFilter) params.set('tag', activeTagFilter);
        const res = await fetch(`${API}/history?${params}`);
        const data = await res.json();
        history = reset ? data.items : history.concat(data.items);
        historyTotal = data.total;
        libraryTotal = data.all;
        renderHistoryItems();
      } catch {}
    }

    async function loadTagCloud() {
      try { tagCounts = await (await fetch(`${API}/tags`)).json(); } catch {}
      renderTagCloud();
    }

    // What the list shows: search results > live-filtered loaded items > loaded items.
    function getDisplayItems() {
      if (searchResults) return searchResults;
      if (!searchText) return history;
      const q = searchText.toLowerCase();
      return history.filter(e =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.preview || '').toLowerCase().includes(q) ||
        (e.tags || []).some(t => t.toLowerCase().includes(q)));
    }

    function renderHistoryCount() {
      const filtered = !!(searchResults || searchText || activeTagFilter);
      const n = searchResults ? searchResults.length
        : (searchText ? getDisplayItems().length : historyTotal);
      historyCount.textContent = filtered ? tf('countMatched', { n, total: libraryTotal })
        : (libraryTotal ? tf('countTotal', { total: libraryTotal }) : '');
    }
```

- [ ] **Step 4: `renderTagCloud`（:1364-1388）改吃 `tagCounts`/`libraryTotal`**

整個函式替換為（結構同原版，只換資料來源；「All」chip 計數用 `libraryTotal`）：

```js
    function renderTagCloud() {
      tagCloud.innerHTML = '';
      if (!tagCounts.length) {
        tagCloud.innerHTML = '<span data-i18n="noTagsYet" style="font-size:12px;color:var(--text3);padding:4px 0">' + escHtml(t('noTagsYet')) + '</span>';
        return;
      }

      const allChip = document.createElement('span');
      allChip.className = 'tag-filter-chip' + (!activeTagFilter ? ' active' : '');
      allChip.innerHTML = `${escHtml(t('tagAll'))} <span class="tag-count">${libraryTotal}</span>`;
      allChip.addEventListener('click', () => setTagFilter(null));
      tagCloud.appendChild(allChip);

      tagCounts.forEach(({ tag, count }) => {
        const chip = document.createElement('span');
        chip.className = 'tag-filter-chip' + (activeTagFilter === tag ? ' active' : '');
        chip.innerHTML = `${escHtml(tag)} <span class="tag-count">${count}</span>`;
        chip.addEventListener('click', () => setTagFilter(tag));
        tagCloud.appendChild(chip);
      });
    }
```

- [ ] **Step 5: `renderHistoryItems`（:1390-1452）改吃 `getDisplayItems()`＋title 優先顯示**

函式開頭與 item 標題行改為（其餘 share/delete/click handler 結構不動）：

```js
    function renderHistoryItems() {
      const shown = getDisplayItems();
      renderHistoryCount();
      historyList.querySelectorAll('.history-item').forEach(el => el.remove());

      if (!shown.length) {
        historyEmpty.style.display = '';
        historyEmpty.textContent = activeTagFilter
          ? tf('historyEmptyTagged', { tag: activeTagFilter })
          : t('historyEmpty');
        return;
      }
      historyEmpty.style.display = 'none';

      shown.forEach(entry => {
```

item 內文的 `rawPreview` 行改為 title 優先：

```js
        const rawPreview = (entry.title || entry.preview || '')
          .replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/`/g, '');
```

（`filtered.forEach` → `shown.forEach`；其餘 innerHTML/listener 全保留。）

- [ ] **Step 6: 點擊項目改為先抓全文（`handleHistoryClick` :1454-1472）**

```js
    async function handleHistoryClick(entry, itemEl) {
      const full = await fetchEntry(entry.id);
      if (!full) { showToast(tf('toastErrorPrefix', { message: t('errFormatFailed') }), 'error'); return; }
      const hasContent = rawInput.value.trim().length > 0 && !isPreviewMode;
      if (hasContent) {
        document.querySelectorAll('.history-item.active').forEach(el => el.classList.remove('active'));
        itemEl.classList.add('active');
        openQuickView(full);
      } else {
        currentMarkdown = full.markdown;
        currentTags = full.tags || [];
        currentId = full.id;
        rawInput.value = full.raw;
        charCount.textContent = tf('charCount', { count: full.raw.length.toLocaleString() });
        showPreview(full.markdown);
        renderCurrentTags(currentTags);
        statusText.textContent = t('statusRestored');
        showToast(t('toastMemoRestored'), 'success');
        closeQuickView();
      }
    }
```

（`openQuickView`/`btnQvRestore` 收到的 `quickViewEntry` 已是完整 entry，不用改。）

- [ ] **Step 7: 寫入後刷新一律走 server（`deleteEntry`、clear handler、其他呼叫點）**

`deleteEntry` 替換：

```js
    async function deleteEntry(id) {
      await fetch(`${API}/history/${id}`, { method: 'DELETE' });
      await loadHistoryData(true);
      loadTagCloud();
    }
```

clear handler 成功分支（:1504-1507 的 `history = []; activeTagFilter = null; renderTagCloud(); renderHistoryItems();`）替換：

```js
        activeTagFilter = null;
        await loadHistoryData(true);
        loadTagCloud();
```

`doFormat` 成功分支（:1148 `loadHistoryData();`）改為：

```js
        loadHistoryData(true);
        loadTagCloud();
```

第二個 script（agent IIFE）的 apply 成功處（:1622 `loadHistoryData();`）改為：

```js
          loadHistoryData(true); loadTagCloud();
```

檔尾初始化（:1519 `loadHistoryData();`）改為：

```js
    loadHistoryData(true);
    loadTagCloud();
```

- [ ] **Step 8: 手動驗證（seeded dev server）**

```bash
node -e "
const a=[];const now=1750000000000;
for(let i=0;i<1000;i++)a.push({id:now+i,createdAt:new Date(now-i*36e5).toISOString(),raw:'raw note '+i,markdown:'# Seed memo '+i+'\n\ncontent body '+i,tags:['seed','t'+(i%7)],preview:'# Seed memo '+i});
require('fs').writeFileSync('/tmp/claude-1002/-home-lewsi-Documents-workspaceSide-md-memo/3c1d5794-162d-4626-b14d-93e49f0db80b/scratchpad/seed-1000.json',JSON.stringify(a))"
HISTORY_FILE=/tmp/claude-1002/-home-lewsi-Documents-workspaceSide-md-memo/3c1d5794-162d-4626-b14d-93e49f0db80b/scratchpad/seed-1000.json HISTORY_LIMIT=2000 npm run dev
```

開 http://localhost:10026/md-memo/ 檢查：列表顯示前 50 筆、計數列「共 1000 筆」（zh）或「1000 memos」（en）、點某筆能開 quickview（全文有載入）、tag cloud 有計數、點 tag chip 能篩選（計數列變「符合 …」）、刪除一筆後列表與 tags 都刷新、Edit→Save 流程正常。

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: SPA 接分頁輕量 API——單篇按需抓全文、tags 端點、計數列"
```

---

### Task 8: 搜尋框——即時過濾＋Enter 全庫搜尋＋Esc 清除

**Files:**
- Modify: `public/index.html`——HTML（`#history-header` 之後、`#history-list` 之前插入）、CSS（`#history-list` 樣式區附近）、i18n 兩份、JS（Task 7 資料層函式之後）

**Interfaces:**
- Consumes: Task 7 的 `searchText`/`searchResults`/`renderHistoryItems`、Task 6 的 `/api/history/search`。
- Produces: `searchInput` 元素（id `history-search`）、`clearSearch()`（Task 12 鍵盤用）。

- [ ] **Step 1: HTML——`</div>`（history-header 收尾，:722）與 `<div id="history-list">` 之間插入**

```html
      <div id="history-search-wrap">
        <input id="history-search" type="text" data-i18n-ph="searchPlaceholder" placeholder="Search memos…  ( / )">
      </div>
```

- [ ] **Step 2: CSS——`#history-list` 規則（:461）前插入**

```css
    #history-search-wrap { display: flex; gap: 6px; align-items: center; padding: 0 13px 10px; }
    #history-search {
      flex: 1; min-width: 0; background: transparent; color: var(--text);
      border: 1px solid var(--border); border-radius: var(--radius);
      padding: 6px 9px; font-family: var(--mono); font-size: 12px; outline: none;
    }
    #history-search:focus { border-color: var(--accent-line); }
    #history-search::placeholder { color: var(--text3); }
```

- [ ] **Step 3: i18n——en／zh-TW 各加**

```js
        searchPlaceholder: 'Search memos…  ( / )',
        searchEmpty: 'No memos match "{q}"',
```

```js
        searchPlaceholder: '搜尋筆記…（/）',
        searchEmpty: '沒有符合「{q}」的筆記',
```

- [ ] **Step 4: JS——Task 7 的 `renderHistoryCount` 之後插入**

```js
    // ── MEMO LIST SEARCH ──
    const searchInput = document.getElementById('history-search');
    let searchDebounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        searchText = searchInput.value.trim();
        if (!searchText) searchResults = null;   // emptying the box exits search mode
        renderHistoryItems();
      }, 150);
    });
    searchInput.addEventListener('keydown', async e => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (!q) return;
        try {
          const res = await fetch(`${API}/history/search?` + new URLSearchParams({ q, limit: 50 }));
          searchResults = (await res.json()).items;
          renderHistoryItems();
        } catch {}
      } else if (e.key === 'Escape') { clearSearch(); }
    });
    function clearSearch() {
      searchInput.value = '';
      searchText = '';
      searchResults = null;
      renderHistoryItems();
    }
```

- [ ] **Step 5: 空結果訊息——`renderHistoryItems` 的 empty 分支改為**

```js
      if (!shown.length) {
        historyEmpty.style.display = '';
        historyEmpty.textContent = (searchResults || searchText)
          ? tf('searchEmpty', { q: searchResults ? searchInput.value.trim() : searchText })
          : (activeTagFilter ? tf('historyEmptyTagged', { tag: activeTagFilter }) : t('historyEmpty'));
        return;
      }
```

- [ ] **Step 6: 手動驗證**

Seeded dev server（同 Task 7 Step 8）：輸入 `memo 3` 即時過濾已載入項（計數列變「符合 n／全部 1000」）；輸入只存在於後段筆記的內文詞按 Enter → 全庫搜尋命中（即時過濾找不到、Enter 找得到，證明兩層行為）；Esc 清空恢復列表；清空輸入框也恢復。

- [ ] **Step 7: Commit**

```bash
git add public/index.html
git commit -m "feat: Memo List 搜尋框——即時過濾已載入項＋Enter 全庫搜尋"
```

---

### Task 9: tag 篩選——列表項 tag 可點、篩選 chip、server 端篩選

**Files:**
- Modify: `public/index.html`——HTML（search-wrap 內加 chip）、CSS、`setTagFilter`（:1343-1347）、`renderHistoryItems` 的 item listener 區

**Interfaces:**
- Consumes: Task 7 的 `loadHistoryData`/`renderTagCloud`、Task 8 的 `#history-search-wrap`。
- Produces: `setTagFilter(tag)`（async，server 篩選版；tag cloud 與列表項共用）、`updateFilterChip()`。

- [ ] **Step 1: HTML——`#history-search-wrap` 內、input 之後加**

```html
        <span id="history-filter-chip" style="display:none"></span>
```

- [ ] **Step 2: CSS——search 樣式區之後加**

```css
    #history-filter-chip {
      display: inline-flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap;
      font-family: var(--mono); font-size: 11px; color: var(--accent);
      border: 1px solid var(--accent-line); border-radius: var(--radius); padding: 4px 8px;
    }
    .hi-tag { cursor: pointer; }
    .hi-tag:hover { color: var(--accent); }
```

- [ ] **Step 3: `setTagFilter`（:1343-1347）替換＋新增 `updateFilterChip`**

```js
    // ── TAG FILTER (server-side once the list is paginated) ──
    async function setTagFilter(tag) {
      activeTagFilter = activeTagFilter === tag ? null : tag;
      updateFilterChip();
      renderTagCloud();
      await loadHistoryData(true);
    }

    function updateFilterChip() {
      const chip = document.getElementById('history-filter-chip');
      if (!activeTagFilter) { chip.style.display = 'none'; return; }
      chip.style.display = '';
      chip.textContent = `# ${activeTagFilter} ✕`;
    }
    document.getElementById('history-filter-chip').addEventListener('click', () => setTagFilter(activeTagFilter));
```

- [ ] **Step 4: 列表項 tag 可點——`renderHistoryItems` 的 item innerHTML 之後（share listener 之前）加**

```js
        item.querySelectorAll('.hi-tag').forEach(tagEl => {
          tagEl.addEventListener('click', e => {
            e.stopPropagation();
            setTagFilter(tagEl.textContent);
          });
        });
```

- [ ] **Step 5: 手動驗證**

點列表項上的 tag → 列表只剩該 tag（計數列「符合 …」、chip 出現）；再點同 tag 或點 chip → 取消；tag cloud chips 行為一致；tag 篩選與載入（>50 筆的 tag 會分頁）並存正常。

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: tag 篩選——列表項 tag 可點、篩選 chip、改走 server 篩選"
```

---

### Task 10: 分頁載入——「載入更多」按鈕＋滾到底自動載

**Files:**
- Modify: `public/index.html`——CSS、i18n、JS（`renderHistoryItems` 尾端＋新增 loadMore 邏輯）

**Interfaces:**
- Consumes: Task 7 的 `loadHistoryData(false)`／`history`／`historyTotal`／`searchText`／`searchResults`。
- Produces: `loadMoreBtn`（JS 建立、render 時掛到列表尾）。

- [ ] **Step 1: i18n——en／zh-TW 各加**

```js
        loadMore: 'Load more',
```

```js
        loadMore: '載入更多',
```

- [ ] **Step 2: CSS**

```css
    #history-load-more {
      display: block; width: calc(100% - 26px); margin: 6px 13px 10px;
      background: transparent; color: var(--text2); cursor: pointer;
      border: 1px solid var(--border); border-radius: var(--radius);
      padding: 7px 0; font-family: var(--mono); font-size: 11px;
      letter-spacing: .08em; text-transform: uppercase;
    }
    #history-load-more:hover { color: var(--accent); border-color: var(--accent-line); }
```

- [ ] **Step 3: JS——`clearSearch` 之後插入**

```js
    // ── LOAD MORE (button + auto-load when scrolled to the bottom) ──
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.id = 'history-load-more';
    let loadingMore = false;
    async function loadMoreEntries() {
      if (loadingMore || searchResults || searchText) return;
      if (history.length >= historyTotal) return;
      loadingMore = true;
      await loadHistoryData(false);
      loadingMore = false;
    }
    loadMoreBtn.addEventListener('click', loadMoreEntries);
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMoreEntries();
    }, { root: historyList }).observe(loadMoreBtn);
```

- [ ] **Step 4: `renderHistoryItems` 尾端（`shown.forEach` 迴圈之後）加**

```js
      loadMoreBtn.textContent = t('loadMore');
      loadMoreBtn.style.display =
        (!searchResults && !searchText && history.length < historyTotal) ? '' : 'none';
      historyList.appendChild(loadMoreBtn);
```

（`renderHistoryItems` 開頭只移除 `.history-item`，按鈕元素可重複 append——DOM 會自動搬到尾端。）

- [ ] **Step 5: 手動驗證**

1000 筆 seed：初載 50 筆＋底部按鈕；點按鈕再載 50；持續滾到底自動載入直到 1000（按鈕消失）；搜尋模式下按鈕隱藏；tag 篩選後分頁邏輯照常（>50 筆的 tag）。

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: Memo List 分頁載入——載入更多按鈕＋滾到底自動載"
```

---

### Task 11: 排序切換（新→舊／舊→新）

**Files:**
- Modify: `public/index.html`——HTML（history-header 右側）、i18n、JS、`applyLang`

**Interfaces:**
- Consumes: Task 7 的 `sortOrder`／`loadHistoryData`。
- Produces: `updateSortBtn()`（applyLang 會呼叫）。

- [ ] **Step 1: HTML——history-header 右側 flex div（:718-721）在 `#history-count` 之前插入**

```html
          <button class="btn-icon" id="btn-sort" data-i18n-title="sortTitle" title="Toggle sort order" style="width:auto;height:auto;font-family:var(--mono);font-size:10px;letter-spacing:.1em;padding:4px 9px;border:1px solid var(--border);border-radius:2px;background:transparent;color:var(--text2);cursor:pointer">↓</button>
```

- [ ] **Step 2: i18n——en／zh-TW 各加**

```js
        sortTitle: 'Toggle sort order',
        sortNewest: '↓ new',
        sortOldest: '↑ old',
```

```js
        sortTitle: '切換排序',
        sortNewest: '↓ 新到舊',
        sortOldest: '↑ 舊到新',
```

- [ ] **Step 3: JS——load-more 區塊之後插入**

```js
    // ── SORT ORDER ──
    const btnSort = document.getElementById('btn-sort');
    function updateSortBtn() { btnSort.textContent = t(sortOrder === 'desc' ? 'sortNewest' : 'sortOldest'); }
    btnSort.addEventListener('click', () => {
      sortOrder = sortOrder === 'desc' ? 'asc' : 'desc';
      updateSortBtn();
      loadHistoryData(true);
    });
    updateSortBtn();
```

- [ ] **Step 4: `applyLang`（:996-1017）在 `renderHistoryItems` 的 re-render 行之後加**

```js
      if (typeof updateSortBtn === 'function') updateSortBtn();
```

- [ ] **Step 5: 手動驗證**

點排序鈕 → 列表變舊→新（第一筆是最舊 seed），分頁接續正確（offset 接著抓的是次舊 50 筆）；再點恢復新→舊；切語言按鈕文字跟著換。

- [ ] **Step 6: Commit**

```bash
git add public/index.html
git commit -m "feat: Memo List 排序切換（新→舊／舊→新）"
```

---

### Task 12: 鍵盤操作（`/` 聚焦、↑↓ 移動、Enter 開啟、Esc 清除）

**Files:**
- Modify: `public/index.html`——CSS（`.history-item` 樣式區）、JS（sort 區塊之後）、`renderHistoryItems`（reset 選取）

**Interfaces:**
- Consumes: Task 8 的 `searchInput`/`clearSearch`、Task 7 的 `renderHistoryItems`。

- [ ] **Step 1: CSS——`.history-item` 規則附近加**

```css
    .history-item.kb-active { outline: 1px solid var(--accent-line); outline-offset: -1px; background: var(--surface2); }
```

- [ ] **Step 2: JS——先在 State 區（Task 7 Step 2 的區塊尾端、`const PAGE_SIZE = 50;` 之前）加宣告**

```js
    let kbIndex = -1;          // keyboard-selected list index (-1 = none)
```

再於 sort 區塊之後插入：

```js
    // ── KEYBOARD NAV (/, ↑/↓, Enter, Esc) ──
    function kbItems() { return Array.from(historyList.querySelectorAll('.history-item')); }
    function kbHighlight() {
      const items = kbItems();
      items.forEach((el, i) => el.classList.toggle('kb-active', i === kbIndex));
      if (items[kbIndex]) items[kbIndex].scrollIntoView({ block: 'nearest' });
    }
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
      if (e.key === '/' && !typing) { e.preventDefault(); searchInput.focus(); return; }
      // list navigation works from the search box or outside any input
      if (typing && e.target !== searchInput) return;
      const items = kbItems();
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault(); kbIndex = Math.min(kbIndex + 1, items.length - 1); kbHighlight();
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault(); kbIndex = Math.max(kbIndex - 1, 0); kbHighlight();
      } else if (e.key === 'Enter' && kbIndex >= 0 && items[kbIndex]) {
        e.preventDefault(); items[kbIndex].click();   // → handleHistoryClick → quickview/restore
      } else if (e.key === 'Escape' && e.target !== searchInput) {
        clearSearch(); kbIndex = -1; kbHighlight();
      }
    });
```

（search box 內的 Esc 已由 Task 8 的 handler 處理；此處排除避免重複。Enter 的優先序：有 kb 選取→開啟該筆；無選取且在 search box→Task 8 的全庫搜尋。兩個 handler 都掛著，靠 `kbIndex >= 0 && e.preventDefault()` 不衝突——**注意**：Task 8 的 search keydown handler 的 Enter 分支開頭要加一行守衛：）

Task 8 handler 的 Enter 分支改為：

```js
      if (e.key === 'Enter') {
        if (kbIndex >= 0) return;                 // a list item is selected — let keyboard nav open it
        const q = searchInput.value.trim();
```

- [ ] **Step 3: `renderHistoryItems` 開頭（`renderHistoryCount()` 之後）加 reset**

```js
      kbIndex = -1;
```

（宣告已在 State 區（Step 2），此處賦值無 TDZ 問題。）

- [ ] **Step 4: 手動驗證**

在編輯器 textarea 打 `/` 正常輸入字元（不搶焦點）；在頁面其他處按 `/` → 搜尋框聚焦；↑↓ 在列表移動高亮並自動捲動；Enter 開啟選中筆記的 quickview；Esc（列表導航中）清除搜尋與高亮；搜尋框內 Enter（無選取時）仍觸發全庫搜尋。

- [ ] **Step 5: Commit**

```bash
git add public/index.html
git commit -m "feat: Memo List 鍵盤操作——/ 聚焦、↑↓ 移動、Enter 開啟、Esc 清除"
```

---

### Task 13: demo mock 同步（分頁封套、search、單篇、tags）

**Files:**
- Modify: `demo/mock.js`——`ensureData`（:11-24）、history GET route（:71）、新增三條 route

**Interfaces:**
- Consumes: SPA 發出的新請求形狀（Task 7-12）。
- Produces: 與 server 相同形狀的 mock 回應（demo 免後端等價行為）。

- [ ] **Step 1: `ensureData` 的 `.then` 內補 title backfill（demo 資料是 pre-Phase-0 形狀）**

```js
      ]).then(([h, f, t]) => {
        state.history = h.slice();
        state.history.forEach(e => { if (e.title == null) e.title = demoTitle(e.markdown); });
        state.format = f;
        state.trace = t;
      });
```

並在 `dataUrl` 定義後加（與 `src/slug.js` 的 `deriveTitle` 同公式——demo 端的複製品，同 `mergedNoteFrom` 前例）：

```js
  // Same derivation as the server's deriveTitle (src/slug.js).
  function demoTitle(markdown) {
    const lines = String(markdown || '').split('\n');
    const line = lines.find(l => /^#{1,6}\s+\S/.test(l.trim())) || lines.find(l => l.trim());
    if (!line) return '(untitled)';
    return line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim() || '(untitled)';
  }
```

- [ ] **Step 2: 替換 history GET route（:71）為四條（順序如下）**

```js
    if (p.endsWith('/api/tags') && method === 'GET') {
      const counts = {};
      for (const m of state.history) for (const t of (m.tags || [])) counts[t] = (counts[t] || 0) + 1;
      return json(Object.entries(counts).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count));
    }

    if (p.endsWith('/api/history') && method === 'GET') {
      const q = url.searchParams;
      const limit = Math.max(1, Math.min(200, Number(q.get('limit')) || 50));
      const offset = Math.max(0, Number(q.get('offset')) || 0);
      const tag = q.get('tag');
      let filtered = tag ? state.history.filter(e => (e.tags || []).includes(tag)) : state.history.slice();
      if (q.get('order') === 'asc') filtered.reverse();
      const items = filtered.slice(offset, offset + limit).map(e => ({
        id: e.id, title: e.title, slug: e.slug, preview: e.preview, tags: e.tags || [], createdAt: e.createdAt,
      }));
      return json({ items, total: filtered.length, all: state.history.length });
    }

    if (p.endsWith('/api/history/search') && method === 'GET') {
      // Same scoring formula as the server's searchMemos (src/tools.js).
      const terms = String(url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
      const items = !terms.length ? [] : state.history
        .map(m => {
          const hay = `${m.raw || ''}\n${m.markdown || ''}\n${(m.tags || []).join(' ')}`.toLowerCase();
          const title = (m.preview || '').toLowerCase();
          let s = 0;
          for (const t of terms) { s += hay.split(t).length - 1; s += (title.split(t).length - 1) * 3; }
          return { m, s };
        })
        .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 50)
        .map(({ m }) => ({ id: m.id, title: m.title, preview: m.preview, tags: m.tags || [],
          snippet: (m.markdown || '').replace(/\s+/g, ' ').slice(0, 160), createdAt: m.createdAt }));
      return json({ items });
    }

    if (method === 'GET' && /\/api\/history\/\d+$/.test(p)) {
      const id = Number(p.split('/').pop());
      const entry = state.history.find(e => e.id === id);
      return entry ? json(entry) : json({ error: 'Memo not found' }, 404);
    }
```

- [ ] **Step 3: mock 新增 entry 的兩處（format :85-93、create_memo apply :130-137）各補 `title`**

format 的 entry literal 加：

```js
        title: demoTitle(r.markdown),
```

create_memo apply 的 entry literal 加：

```js
          title: demoTitle(a.markdown || ''),
```

（`mergedNoteFrom` 也加 `title: demoTitle(md),`。）

- [ ] **Step 4: 驗證**

```bash
npm test                 # demo-data.test.mjs 等全綠
npm run build:demo       # build 成功
npx -y http-server dist-demo -p 10233 &   # 或 python3 -m http.server；開 /md-memo/ 驗證
```

開 demo 頁確認：Memo List 顯示 10 筆 seed＋計數列、搜尋（即時＋Enter）、tag 點擊篩選、quickview 開啟（單篇 mock 路由有效）。完成後 `kill %1`。

- [ ] **Step 5: Commit**

```bash
git add demo/mock.js
git commit -m "feat: demo mock 同步分頁封套與 search/單篇/tags 路由"
```

---

### Task 14: 文件同步（.env.sample／README／CLAUDE.md）

**Files:**
- Modify: `.env.sample`、`README.md`、`CLAUDE.md`

- [ ] **Step 1: `.env.sample`——現有變數區塊照該檔既有註解風格加**

```bash
# Memo list cap (history.json is rewritten whole on each save; keep it sane)
HISTORY_LIMIT=1000
```

- [ ] **Step 2: `README.md`**——Configuration 表加一列 `HISTORY_LIMIT`（default `1000`，說明同上）；若有 API/endpoints 章節，更新 `GET /api/history` 為 `{ items, total, all }`＋`limit`/`offset`/`tag`/`order`，並補 `GET /api/history/search`、`GET /api/history/:id`、`GET /api/tags` 三行。

- [ ] **Step 3: `CLAUDE.md`**——
  - 「環境變數」段補 `HISTORY_LIMIT`（預設 1000）。
  - 「資料儲存」段：`HISTORY_LIMIT = 50` 的描述改為 env 版；補 title/slug（`src/slug.js`，slug 穩定不變、舊資料 lazy 補齊）。
  - 「路由」段：`GET /api/history` 改寫（分頁參數＋封套），新增 search／`:id`／tags 三行。
  - 前端描述補一句：Memo List 具搜尋（兩層）／tag 篩選（server 端）／分頁／排序／鍵盤操作。

- [ ] **Step 4: Commit**

```bash
git add .env.sample README.md CLAUDE.md
git commit -m "docs: HISTORY_LIMIT 環境變數與新 history API 端點說明"
```

---

### Task 15: 整體驗證與收尾

- [ ] **Step 1: 全套測試**

```bash
npm test        # 全綠（含新增 slug/store/tools 測試）
npm run smoke   # agent smoke 通過
npm run build:demo
```

- [ ] **Step 2: 1,000 筆 seed 完整走查（藍圖驗收條件）**

用 Task 7 Step 8 的 seed 啟動，走查一遍：初載 50→滾動自動載→載入更多按鈕；`/` 聚焦→打字即時過濾→Enter 全庫搜尋→Esc 清除；點列表項 tag 篩選→chip 取消；排序切換；↑↓＋Enter 開 quickview；刪除／清空／Edit-Save／Format 各流程；語言切換後所有新字串正確；dark/light 主題下新 UI 元素可讀。

- [ ] **Step 3: dispatch `contract-reviewer` agent**

以 Agent tool dispatch `contract-reviewer`，說明本次改動範圍（`src/index.js`、`src/store.js`、`src/tools.js`、`public/index.html`、`demo/mock.js`），檢查三大契約（tags 格式、`__BASE_PATH__`、雙套渲染）。有 finding 就修復並補 commit。

- [ ] **Step 4: 勾掉 spec checklist**

`specs/memo-foundation-and-list.md` 任務清單全數打勾（未完成項如實留白並回報）。

- [ ] **Step 5: 最終 commit（如有殘餘變更）與回報**

```bash
git status   # 確認乾淨或只剩 spec 勾選
git add specs/memo-foundation-and-list.md
git commit -m "docs: spec 勾選 Phase 0+0.5 完成項"
```

回報使用者：完成摘要、測試結果、建議下一步（`/finish-task` 或 code review）。
