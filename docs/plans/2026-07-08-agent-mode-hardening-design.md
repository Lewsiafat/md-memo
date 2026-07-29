# Agent Mode Hardening（C1+H1+H2+H3）— 設計文件

- **日期**：2026-07-08
- **來源**：`docs/agent-mode-review-2026-07-08.md`（複審已於本日以 fresh agent 對 HEAD `b1460b9` 逐條再驗證，11 條 finding 全數 CONFIRMED、引用行號無漂移）
- **範圍**：C1（儲存層資料歸零路徑）、H1（proposal id 綁定）、H2（propose 階段驗證）、H3（SSE 斷線真中止）。**不含** H4（多輪對話，已排 roadmap Phase 2）、M1–M3、L1–L3。
- **方案**：四項針對性修復（方案 A），補齊 `docs/plans/2026-06-19-agent-over-notes-design.md` 承諾但未兌現的行為。

## 1. 關鍵設計決定

| 決定 | 理由 |
|------|------|
| C1 損毀檔採**隔離（rename）後繼續服務**，不採 throw | 原始 bytes 永遠留在磁碟可人工救回，任何後續寫入都碰不到它；app 保持可用，Memo List 顯示「全部 0」讓使用者自然察覺。throw 方案資料同樣安全但整站 500。 |
| H1 proposal registry 採 **in-memory Map，不落地** | server 重啟後 pending proposal 失效是可接受的（使用者重跑 agent 即可）；落地磁碟增加複雜度換不到實質價值。 |
| H1 `/api/agent/apply` 改為**只收 `{ id }`**，args 由 server 端取回 | 前端傳來的 args 不再被信任，同時解掉重複套用與竄改兩個問題；正是原設計文件「提案 id 已不存在 → 400」的實作。 |
| 「存成 memo」改走新的 `POST /api/history` | 該路徑本來就沒有 proposal，借用 apply 是語意錯位；raw create endpoint 約 10 行（重用 `insertEntry(createEntry())`），apply 語意變純粹。 |
| H2 抽 `validateProposal()` 供 propose 與 apply 兩階段共用 | 驗證失敗在 propose 階段以 `tool_result` 餵回模型自我修復（原設計承諾）；apply 階段仍再驗一次，因 propose 與 apply 之間筆記可能被刪。 |
| H3 用 **AbortController** 貫穿 handler → runAgent → fetch | in-flight 的 OpenRouter 請求也一併取消，不只停迴圈；boolean flag 做不到這點。 |

## 2. 各項設計

### 2.1 C1 — 儲存層（`src/store.js`、`src/sessions.js`）

**原子寫入**：`saveHistory()`/`saveSessions()` 改為寫入 `<file>.tmp` 後 `fs.renameSync(tmp, file)`。同目錄 rename 在 POSIX 上原子，磁碟上任何時間點不存在半寫入的正式檔。

**損毀隔離**：load 時區分兩種情況——

- 檔案不存在 → 回 `[]`（現行為，正常）。
- 檔案存在但讀取/parse 失敗 → 把損毀檔 `fs.renameSync` 成 `<name>.corrupt-<ISO時間戳>.json`（時間戳同 `clearHistory` 的格式，`:`/`.` 換 `-`），`console.error` 記下隔離路徑與原始錯誤，回 `[]`。

rename 之後正式檔不存在，後續 load 走「檔案不存在」分支、後續 save 建立全新檔案——損毀的原始內容永久保留在 `.corrupt-*.json`，不會被任何寫入覆蓋。

隔離判斷**只包住讀檔與 `JSON.parse`**；`loadHistory` 內 backfill 後的 `saveHistory` 寫回若失敗照舊拋出，不得被同一個 catch 吞掉（現行 `try` 範圍過寬，需縮小）。

兩個檔案的 load/save 邏輯幾乎相同，但依專案「無過度抽象」調性**各自就地修改**，不另抽共用模組。

### 2.2 H1 — proposal id 綁定（新增 `src/proposals.js`；改 `src/agent.js`、`src/index.js`、`public/index.html`、demo）

**新模組 `src/proposals.js`**（in-memory，不落地）：

```js
register(proposal) -> id   // crypto.randomUUID()；Map 超過 200 筆時剔除最舊（FIFO）
take(id) -> proposal|null  // 取出即刪除（一次性）；未知/已用過的 id 回 null
```

**`src/agent.js`**：write 分支在（通過 2.3 驗證後）`register()` proposal，SSE `proposal` 事件 data 增加 `id` 欄位（`{ id, action, args, summary }`）。

**`src/index.js`**：`POST /api/agent/apply` 改收 `{ id }`：

- `take(id)` 命中 → 用 server 端保存的 `{ action, args }` 呼叫 `applyProposal()`，回傳照舊。
- `take(id)` 未命中（包含連點第二下、重播舊 session、server 已重啟）→ `400 { ok:false, error }`。錯誤文案遵循既有 `AGENT_LANG` 慣例（同 proposal 摘要）：zh 系為「提案已失效或不存在」，其他語言為 `Proposal expired or unknown`。

**新 endpoint `POST /api/history`**：body `{ markdown, tags? }`，markdown 非空字串否則 400；`insertEntry(createEntry({ markdown, tags }))` 後回 `{ ok:true, id }`。不跑 LLM。

**前端 `public/index.html`**：

- `renderProposal()` 的套用改送 `{ id: data.id }`；錯誤顯示沿用既有 `✗ <message>` 路徑（重播過期 proposal 按套用 → 顯示「提案已失效或不存在」，即原設計的「來源已變動」）。
- `saveToMemo()` 改打 `POST /api/history`，body `{ markdown, tags: ['agent'] }`。

**Demo**（維持「真 app 唯一真相」原則）：

- `demo/data/agent-trace.json`：每個 `proposal` 事件的 data 加 `id`（寫死的假 UUID 字串即可）。
- `demo/mock.js`：apply handler 改吃 `{ id }`——重播時記住 trace 中出現過的 proposal（id → {action,args}），apply 按 id 查表；另補 `POST /api/history` handler（對應 saveToMemo）。

### 2.3 H2 — 驗證提前到 propose 階段（`src/tools.js`、`src/agent.js`）

**`src/tools.js`** 抽出並 export `validateProposal(action, args)`，回 `{ ok:true }` 或 `{ ok:false, error }`。內容即現行 `applyProposal()` 開頭的檢查搬出共用：

- `create_memo` / `merge_memos`：`markdown` 為非空字串。
- `merge_memos`：`source_ids` 全部存在於 history。
- `link_memos`：`ids` 全部存在。
- `retag_memo`：`id` 存在。
- 未知 action：`{ ok:false, error: 'Unknown action …' }`。

`applyProposal()` 開頭改為呼叫 `validateProposal`（去重複；apply 階段重驗是刻意的，見 §1）。

**`src/agent.js`** write 分支流程改為：

```
validateProposal(name, args)
  失敗 → emit('tool_result', { name, result: { error } })；
         tool message content = JSON.stringify({ error })   ← 模型同 run 內自我修復
         （不 emit proposal、不 register）
  成功 → register() + emit('proposal', { id, ...buildProposal(name, args) })；
         tool content 照舊 'Proposed to the user for confirmation…'
```

### 2.4 H3 — SSE 斷線真中止（`src/index.js`、`src/agent.js`）

**`src/index.js`** `/api/agent` handler：

```js
const ac = new AbortController();
res.on('close', () => { if (!res.writableEnded) ac.abort(); });
await runAgent(message, emit, { signal: ac.signal });
```

catch 區分 AbortError（連線已死，僅 `console.log`，不 emit）與其他錯誤（照舊 emit `error`）。

**`src/agent.js`**：

- `runAgent` options 增加 `signal`；每個 step 迴圈開頭 `if (signal?.aborted) return;`。
- `callOpenRouter(messages, tools, { signal } = {})` 把 `signal` 傳進 `fetch` options——中止時 in-flight 請求即刻取消,不再燒 token。注入式 `callModel` 同簽名（測試可忽略第三參數）。

## 3. 測試計畫

| 檔案 | 新增案例 |
|------|----------|
| `test/store.test.mjs` | 損毀 JSON → 回 `[]`、產生 `.corrupt-*.json` 且內容等於原始損毀 bytes、正式檔已不存在；save 成功後無 `.tmp` 殘留。 |
| `test/sessions.test.mjs` | 同上（sessions 版本）。 |
| `test/proposals.test.mjs`（新） | register 後 take 拿到原 proposal;同 id 二次 take 回 null;未知 id 回 null;超過 200 筆最舊被剔除。 |
| `test/tools.test.mjs` | `validateProposal` 各 action 的通過/失敗案例（空 markdown、不存在的 id）;`applyProposal` 既有測試不變（回傳格式不動）。 |
| `test/agent.test.mjs` | 注入 `callModel`:(a) 無效 write args → 收到 `tool_result` 錯誤事件、無 `proposal` 事件、模型第二輪收到錯誤內容;(b) 有效 write → `proposal` 事件帶 `id`;(c) signal abort 後 → 迴圈不進下一 step、callModel 不再被呼叫。 |
| `test/demo-data.test.mjs` | trace 中每個 proposal 事件都有 `id` 欄位。 |

既有測試全部照跑不改斷言（複審確認 `test/tools.test.mjs` 只斷言 `summary`/`action`/`ok`，proposal 加 `id` 不影響）。

## 4. 文件同步

- `CLAUDE.md` 路由段：`POST /api/agent/apply` 契約改為 `{ id }`；新增 `POST /api/history`；agent 段補「proposal 一次性 id、SSE 斷線中止」。
- `docs/agent-mode-review-2026-07-08.md` 不改動（審查快照保持原樣）。

## 5. 驗收標準

1. `npm test` 全綠、`npm run smoke` 通過、`npm run build:demo` 成功。
2. 手動：把 `data/history.json` 改成非法 JSON 後啟動 → server 正常起、出現 `.corrupt-*.json`、原內容在其中、console 有 error。
3. 手動：agent 產生 proposal 後連點「套用」兩下 → 第一下成功、第二下顯示「提案已失效或不存在」，庫中只多一筆。
4. 手動：`curl -X POST …/api/agent/apply -d '{"action":"create_memo","args":{…}}'` → 400（舊契約已關閉）。
5. 手動：agent 跑到一半關閉分頁 → server log 顯示中止、OpenRouter 不再有後續請求（觀察 log 步數）。
6. 手動：session「存成 memo」照常可用（走新 endpoint）。
7. Demo（`dist-demo/`）:重播 trace、按套用可產生筆記，「Demo mode」行為不變。

## 6. 明確不做（out of scope）

- H4 多輪對話前端串接 → roadmap Phase 2（`docs/plans/2026-07-03-knowledge-engine-roadmap-design.md`）。
- M1 懸空引用清理、M2/M3 historyLimit 驅逐策略 → 與容量策略一起另案設計。
- L1 搜尋索引、L2 read_memo 截斷、L3 async IO → 規模化前置,現階段不投入。
- proposal registry 落地磁碟、undo、TTL 計時器 → YAGNI。
