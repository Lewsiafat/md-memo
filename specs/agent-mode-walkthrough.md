# Agent Mode 一級工作區（模式指示／已存 session／存成 memo）— Walkthrough

- **分支:** `feat/agent-mode`（已 merge 回 main，merge commit `74ac11a`）
- **日期:** 2026-06-26

## 變更摘要

把 Agent 面板從「單欄 trace + 輸入」升級為**一級工作區**：新增伺服端 session 持久化（`src/sessions.js` + `/api/sessions` 路由，存 `data/sessions.json`），前端改為**三欄佈局**（左：已存 session 清單；中：trace + 輸入 + 「← 返回一般模式」；右：範例 prompt），並加上頁尾**模式徽章**與集中式 `setMode()` 狀態機（View / Edit / Agent / Combine，其中 Combine = 編輯時開 quickview 的左右並排）。每次 agent 跑完可一鍵**存成 session**，左欄可**重播 / 刪除**，並能把某筆 session 的答案**一鍵存成 memo**（重用既有 `POST /api/agent/apply` 的 `create_memo`）。靜態 demo（無後端、無 API key）以記憶體 mock 對齊三條 `/api/sessions` 路由，並讓 `create_memo` 在 demo 的 history 顯示。

以 subagent-driven 流程執行：8 個任務逐一 TDD/實作 + 每任務 spec/品質雙重 review；contract-reviewer 確認三項隱性契約（tags 格式、`__BASE_PATH__` 替換、SPA/永久連結雙套渲染）全數 intact；最後全分支 review（opus）。並以 Playwright 對 demo build 做互動驗收 **18/18 通過、零 page error**——過程中揪出兩個落差並修掉：(1) `saveToMemo` 成功後未刷新可見 history 清單（與計畫驗收標準矛盾）；(2) 新的 `data/sessions.json` runtime 檔未被 gitignore（其手足 `history.json` 有）。使用者最後以**真 app（含 OPENROUTER_API_KEY）本機實測**。

## 修改的檔案

**新增（核心）**
- `src/sessions.js` — session 持久化 store，**mirror `src/store.js`**：lazy `sessionsFile()` 支援 `process.env.SESSIONS_FILE` 覆寫；`loadSessions` / `createSession({question, answer?, events?})` / `insertSession`（prepend + `slice(0, SESSIONS_LIMIT=50)` + 持久化）/ `deleteSession(id)`。Session 形狀 `{ id, createdAt, question, answer, events }`，`id` 為 `Date.now()`。

**修改（核心）**
- `src/index.js` — `import` 自 `./sessions.js`；新增三條路由 `GET/POST ${BASE_PATH}/api/sessions`（POST 缺 `question` 回 400）、`DELETE ${BASE_PATH}/api/sessions/:id`，置於 history 路由之後、`app.listen` 之前。
- `public/index.html` — (a) 頁尾 `#mode-badge` + script 1 的 `setMode()/enterAgentMode()/exitAgentMode()/restoreEditorMode()` 狀態機，並於五處轉場呼叫；(b) agent 面板改三欄 HTML + CSS（`#agentSessions`／`#agentMain`／`#agentExamples`）；(c) script 2 IIFE 擴充：範例側欄、capture（`run()` 收集 events/answer、排除 `start`）、存/列出/重播/刪除 session、「存成 memo」。
- `demo/mock.js` — `state` 加 `sessions: []`；mock 三條 `/api/sessions`（in-memory，置於 404 fallback 前）；`/api/agent/apply` 加 `create_memo` 分支，把筆記 unshift 進 `state.history` 以在 demo 顯示。

**修改（測試）**
- `test/sessions.test.mjs` — **新增**，5 個 session store 測試（缺檔回 `[]`、canonical 形狀、預設值、limit、依 id 刪除）。`deleteSession` 測試以 busy-wait spin 推進 `Date.now()` 取得不同毫秒，保留 `Date.now()` id 契約同時確保 deterministic。

**修改（設定／文件）**
- `.gitignore` — 加 `data/sessions.json`，避免把含真實 agent 對話的 runtime 檔誤提交（行為對齊 `data/history.json`）。
- `CLAUDE.md` — 路由清單加上 `/api/sessions`（`src/sessions.js`，存 `data/sessions.json`）；Agent 段補三欄面板與 `setMode()` 模式說明。

## 技術細節

- **跨 script 共享全域**：兩個 inline `<script>` 為 classic script、共用全域作用域。`setMode`/`enterAgentMode`/`exitAgentMode`/`showToast`/`loadHistoryData` 宣告在 script 1 頂層，由 script 2 的 IIFE 呼叫。script 1 跑完（含結尾 `setMode('edit')`）後 script 2 才執行，無 TDZ。Task 4 實作時把 `const el`/`const esc` 上移到 `renderExamples()` 呼叫之前，修正一個真實的 IIFE 內 TDZ（`const` 不 hoist）。
- **replay 的 `start` 排除**：存檔的 `events` 排除 `start`（`renderEvent('start')` 會清空 trace，重播時會清掉前面內容）；`openSession` 改為自己先 `trace.innerHTML=''` 再重播非 `start` 事件，前後一致。
- **存成 memo 走既有契約**：`saveToMemo` POST `{ action:'create_memo', args:{ markdown, tags:['agent'] } }` 到 `/api/agent/apply`，`markdown = (answer||'').trim() || question`，零新後端。成功後呼叫 `loadHistoryData()` **即時刷新可見 history**（修正項）。
- **契約不破**：前端所有路徑走 script 2 的 `BASE = '__BASE_PATH__'`（如 `${BASE}/api/sessions`），無硬寫 `/md-memo`；新路由掛在 `${BASE_PATH}` 下；demo mock 以 `p.endsWith`/`p.includes` 相對比對；`parseTags`、`renderPermalink` 完全未動——contract-reviewer 已逐項確認。
- **驗證**：`npm test` **35/35**（含新 `sessions.test.mjs`、demo-data 跨檔一致性、permalink）；`npm run build:demo` OK（11 permalinks）；route curl 煙霧（POST→`{ok:true,id}`→GET 陣列→DELETE）；Playwright 互動驗收於 demo build **18/18 通過、零 page error**，並隔離驗證 create_memo 修正後 history 即時刷新（10→11）。

## 已知 follow-up（非阻斷，全分支 review 留存）

- `saveToMemo` 在 `r.ok` 前先 `r.json()`——codebase 既有模式；若 `/api/agent/apply` 回非 JSON 錯誤體會丟 parse error（既有 endpoint 必回 JSON，實務無礙）。
- `loadSessions()` 以 `catch {}` 吞 fetch 錯誤——本機單人工具可接受；可加 `console.warn` 助除錯。
- session 時間以 `'en'` locale 顯示（計畫指定），與其餘 繁中 UI 略不一致。
- `saveSessionBtn` 成功儲存後不重新啟用（避免對同一 `currentSession` 重複存）。
- 三欄面板的 `#agentBar/#agentInput/#agentSend` 移除了 `var(--x, fallback)` 後備值（計畫指定；所有 CSS 變數於 dark/light `:root` 皆有定義，安全）。
- 還原方式：session 持久於 `data/sessions.json`（已 gitignore）；如需清空直接刪該檔重啟即可。
