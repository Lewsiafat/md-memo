[English](./CHANGELOG.md) · **繁體中文**

# 變更日誌

本專案所有重要變更皆記錄於此，遵循
[Keep a Changelog](https://keepachangelog.com/) 與 [Semantic Versioning](https://semver.org/)。

## [1.5.0] - 2026-07-02

開源發布整備：完整實作 `docs/md-memo-code-review.md` 全面審查的所有發現
（R-01–R-02 發布阻斷、S-01–S-05 安全、B-01–B-04 bug、P-01–P-04 打磨；
P-05 git 歷史密鑰掃描已執行——乾淨）。

### Added
- **`LICENSE`（MIT）** 與 `package.json` 中繼資料 — `license`、`author`、`repository`、
  `keywords`、`engines`（`node >= 22.9.0`，`--env-file-if-exists` 所需）；README 已標明
  Node 版本前置需求。（R-01/R-02）
- **`HOST` 環境變數**控制綁定位址（預設仍為 `127.0.0.1`）；部署 Railway/Render/Docker
  時設 `HOST=0.0.0.0` — 已寫入 README 設定表與 `.env.sample`。（B-01）
- **CI workflow** `.github/workflows/test.yml` — push main 與 pull request 時跑
  `npm test` + `npm run smoke`。（P-02）
- **`CONTRIBUTING.md` / `SECURITY.md`** 社群文件。（P-03）
- **`docs/md-memo-code-review.md`** — 驅動本次發布的審查報告。

### Security
- **修復公開永久連結頁的 stored XSS（三個向量）** — `src/permalink.js` 對
  preview/`og:title`、tags 做完整 HTML 跳脫，JSON blob 防 `</script>` breakout，
  並附回歸測試。（S-01）
- **`marked` 輸出以 DOMPurify 消毒** — 兩套獨立渲染環境（permalink 模板與 SPA，
  共四處 `marked.parse` 呼叫點）全數包覆。（S-02）
- **`POST /api/history/clear` CSRF 防護** — 要求 JSON content type（否則 415）；
  SPA 呼叫端已明確送出。（S-03）
- **Timing-safe 密碼比對** — `checkPassword` 改以 SHA-256 digest 配合
  `crypto.timingSafeEqual` 比較。（S-04）
- **通用 500 回應** — 內部錯誤細節只留在 server log。（S-05）

### Fixed
- **`/api/agent/apply` 驗證輸入** — `create_memo`/`merge_memos` 缺少非空 `markdown`
  時回 `ok: false`（HTTP 400），不再拋出未捕捉的 `TypeError` 500。（B-02）
- **單調遞增 id** — `store.js`/`sessions.js` 同毫秒連續建立不再碰撞。（B-03）
- **`parseTags` 容許含 `>` 的標籤** — regex 改為 lazy match 至 `-->`。（B-04）

### Changed
- **後端 agent 字串跟隨 `AGENT_LANG`** — proposal 摘要與步數上限訊息預設英文；
  `zh*` 語系（預設 `zh-TW`）維持原繁體中文。（P-01）
- README 新增 Design Docs 段落，指向 `specs/` 與 `docs/plans/`。（P-04）
- 測試套件由 50 個成長為 59 個（涵蓋上述修正的回歸測試）。

## [1.4.1] - 2026-06-30

### Fixed
- **Agent proposal apply 後現在會立即刷新 Memo List** — 在 Agent 模式核可寫入
  proposal（例如 `merge_memos` / `create_memo`）並返回正常模式後，新建立的 memo
  在整頁重新載入前都不會出現在 Memo List 中。`renderProposal()`（`public/index.html`）
  中的 apply handler 在 `POST /api/agent/apply` 成功後缺少一次 `loadHistoryData()`
  呼叫，使得前端記憶體中的 `historyData` 快取過時（「存成 memo」路徑早已透過
  `saveToMemo()` 刷新）。已補上刷新，讓所有寫入 proposal
  （`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）都能立即更新清單。

## [1.4.0] - 2026-06-29

### Added
- **編輯既有 memo（Save / Reformat / Discard）** — 開啟已存的 memo 並按下
  ✏️ Edit，現在頂部列會提供三個動作：**💾 Save** 原樣覆蓋該筆且不呼叫 AI
  （新增 `PUT /md-memo/api/history/:id`，由 `src/store.js` 中新的
  `updateEntry(id, { markdown, tags })` helper 支援，原地覆蓋
  —— 保留 `id`/`createdAt`/`raw`、重算 `preview`、絕不重新排序）；
  **✨ Reformat** 重跑 AI 並詢問（原生 `confirm()`）要覆蓋既有 memo
  或將結果另存為新筆記（`POST /md-memo/api/format` 現在接受 body 中可選的
  `id` —— 存在且找到時覆蓋，否則新建；回應結構不變）；
  **🗑 Discard** 還原編輯器（原生 `confirm()`）。
  按鈕顯示邏輯集中於 `updateEditControls()`（Save 僅在編輯既有 memo 時顯示，
  Discard 僅在編輯器有輸入文字時顯示）。

### Changed
- **History 面板更名為「Memo List」。**
- **Agent 面板 UX** — Approve/Skip 的 proposal 卡片現在渲染於答案摘要**之後**
  （proposal 會被緩衝並於摘要後 flush，對已存 session 與 demo 重播安全）；
  送出紀錄項目現在可**個別刪除**（hover 顯示 ✕，靜默刪除）；tool 呼叫
  收合為**單行** `<details>`（`🔧 name` / `📋 name`），展開後顯示完整的
  args/result JSON。
- 靜態 demo mock（`demo/mock.js`）同步新的覆蓋行為
  （`PUT /api/history/:id` 與 `/api/format` 依 id 覆蓋），讓 GitHub Pages demo
  不會退化。

### Fixed
- **長輸出格式截斷** — 將 `/api/format` 輸出上限提高至 32k
  （`AI_MAX_TOKENS`，預設 `32768`）。當模型仍在其自身上限截斷時，
  回應會帶 `truncated: true`，UI 會警告，且 history 保留完整原始輸入。

### Tests
- 測試套件現有 50 個測試（新增 `updateEntry` store 測試）；`npm run smoke` 與
  `npm run build:demo` 通過；跨檔契約（tags / `BASE_PATH` / 雙渲染）
  驗證完好。

## [1.3.1] - 2026-06-26

### Added
- **選用的密碼保護（HTTP Basic Auth）** — 當 `AUTH_ENABLED=true` 時，以
  HTTP Basic Auth 保護整個 app 與所有 `/api/*`（預設**關閉**，因此既有
  部署不受影響）。公開永久連結頁（`/m/:id`）維持開放，讓分享連結
  持續可用。新的 `src/auth.js` 提供純函式 `checkPassword()` helper 與
  `createAuth()` middleware factory，掛在 `src/index.js` 的 `express.json` 之前
  （只檢查密碼；username 被忽略）。未設 `AUTH_PASSWORD` 卻啟用時為 no-op
  並記錄警告，以避免把所有人鎖在外面。新的 `AUTH_ENABLED` / `AUTH_PASSWORD`
  env 變數已記錄於 `README.md`、`.env.sample` 與 `CLAUDE.md`。測試：新的
  `test/auth.test.mjs`（10 個單元測試）；套件現有 45 個測試。

## [1.3.0] - 2026-06-26

### Added
- **Agent Mode 工作區** — agent 面板現在是一級的三欄工作區：
  已存 session（左）、推理 trace + 釘選輸入 + 「回到正常模式」（中）、
  範例 prompt（右）。Server 端 session 持久化於
  `src/sessions.js`（對應 `src/store.js`，儲存 `data/sessions.json`，上限 50 筆）
  並提供 `GET/POST /api/sessions` 與 `DELETE /api/sessions/:id`。每次完成的執行皆可
  存成 session，之後可重播或刪除；session 的答案可一鍵轉成
  memo（重用 `POST /api/agent/apply` 的 `create_memo`）。新增 footer 模式角標
  與集中式 `setMode()` 狀態機（View / Edit / Agent / Combine）。
- **安全的「清空全部 history」** — 取代未備份、單一 `confirm()`、逐項
  DELETE 迴圈的舊流程，改為可復原的流程：`clearHistory()` 先將
  `data/history.json` 複製成帶時間戳的 `data/history.<ts>.bak.json`（每次清空各留一份，
  絕不覆蓋舊備份），再寫入空陣列 —— 透過 `POST /api/history/clear` 提供。Clear
  按鈕現在是兩段式（arm → confirm，4 秒後自動解除武裝）。
- **Agent Mode UX 打磨** — 執行進行中時的置中「thinking」動畫
  （涵蓋第一個 SSE 事件抵達前的空檔）、送出時清空輸入框、範例側欄下方一個
  `localStorage` 支援的送出紀錄清單（去重、上限 12、點擊回填），以及頂部列
  更醒目、附標籤的「🤖 Agent」按鈕。
- 測試：新的 `test/sessions.test.mjs`（5 個 session-store 測試）以及
  `test/store.test.mjs` 中的 `clearHistory` 案例；套件現有 35 個測試。

### Changed
- `demo/mock.js` 在記憶體中同步新端點（`/api/sessions` ×3、
  `/api/history/clear`），並在 demo history 中呈現 `create_memo` 結果。

### Fixed
- `package.json` 版本停留在 `1.1.0`（v1.2.0 發布時未 bump）；現在
  重新追蹤發布版本。

## [1.2.0] - 2026-06-24

### Added
- **靜態 GitHub Pages demo** — 一個完全靜態、無後端的展示，其 AI
  互動（Format 按鈕與 agent 推理 trace）由**預錄腳本**驅動，
  因此任何人不需 API key 即可體驗完整流程。「Demo mode」角標標示這些
  預錄回應。線上位置：
  `https://lewsiafat.github.io/md-memo/`。
- `src/permalink.js` — 從 server 的 `GET /m/:id` handler 抽出
  `renderPermalink(entry, basePath)`，讓同一個 renderer 由實際 server 與 demo
  build 共用（server 輸出 byte 級相同）。
- `demo/` 下的 demo 資產：`data/history.json`（10 筆雙語 seed memo）、
  `data/format-samples.json`（編輯器預填 + 預錄 format 結果）、
  `data/agent-trace.json`（可重播的 agent 執行）以及 `mock.js` —— 一個瀏覽器 shim，
  monkeypatch `window.fetch` 攔截 `/api/*`，並把 agent trace 以真正的 SSE
  `ReadableStream` 重播，流經 app 既有的 parser。
- `scripts/build-demo.mjs` + `npm run build:demo` — 產出靜態 `dist-demo/` bundle
  （注入 mock、替換 `__BASE_PATH__` placeholder、透過 `renderPermalink`
  預先產生 `m/<id>/index.html` 永久連結、寫入 `.nojekyll`）。只用
  Node 內建 —— **零新依賴**。
- `.github/workflows/deploy-demo.yml` — CI 在 push 到 `main`（或手動 dispatch）時
  build 並 force-push bundle 到 orphan `gh-pages` 分支。
- 測試：新的 `test/permalink.test.mjs` 與 `test/demo-data.test.mjs`（demo
  資料的跨檔一致性）；套件現有 28 個測試。

### Changed
- `GET /m/:id` 現在透過 `src/permalink.js` 的 `renderPermalink()` 渲染
  （純重構 —— 服務的永久連結 HTML 不變）。

## [1.1.0] - 2026-06-22

### Added
- **對你的筆記進行 agent 操作** — 一個 hand-built、無框架的 agent loop（`src/agent.js`），
  使用 OpenRouter 原生 function calling 對筆記庫進行多步推理。
  它會規劃、呼叫工具並彙整結果。
- **工具**（`src/tools.js`）：讀取類工具 `search_memos` / `read_memo` / `list_tags`
  在 loop 內即時執行；寫入類工具 `create_memo` / `merge_memos` / `link_memos` /
  `retag_memo` emit 可確認的 proposal（刻意不提供 `delete_memo`）。
- **即時推理 trace** — `POST /api/agent` 以 Server-Sent Events 串流執行
  （`start` / `message` / `tool_call` / `tool_result` / `proposal` / `answer` / `done` /
  `error`）；SPA 在 🤖 agent 面板中渲染每個步驟，附釘選輸入與
  可獨立捲動的 trace。
- **Human-in-the-loop 寫入** — `POST /api/agent/apply` 套用使用者確認過的
  proposal；變更類動作絕不無人值守地執行。
- `AGENT_MODEL` env（預設 `deepseek/deepseek-v4-pro`，須支援 tool calling）與
  `AGENT_LANG` env（BCP-47，預設 `zh-TW`）控制 agent 的回應語言。
- history 條目上可選的 `links` / `sources` 欄位（來自 `link_memos` /
  `merge_memos`），向後相容。
- 測試：`node --test` 單元套件（`test/`，19 個測試）以及一個零 API-key smoke
  （`npm run smoke`）。

### Changed
- History 持久化抽出至 `src/store.js`，由既有路由與 agent 共用
  （`/api/format`、`/api/history`、`/m/:id`、DELETE 的行為不變）。

## [1.0.0] - 2026-06-18

### Added
- 首次開源發布：透過 OpenRouter 的 AI markdown 格式化、自動標籤、
  附標籤雲篩選的 history、quick view、永久連結（`/m/:id`）、深色/淺色主題。
