# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

md-memo 是輕量的 AI markdown 筆記工具：使用者輸入純文字，透過 OpenRouter 呼叫 LLM 轉成結構化 markdown 並自動產生標籤。無框架、無 build step、無資料庫。

## 開發指令

```bash
npm install                          # 只有一個依賴：express
npm start                            # node src/index.js（生產）
npm run dev                          # node --watch src/index.js（檔案變動自動重啟）
npm test                             # node --test（test/ 下的單元測試）
npm run smoke                        # 無 API key 的 agent 整合 smoke
npm run build:demo                   # 產出靜態 demo bundle 到 dist-demo/（GitHub Pages 用）
```

開啟 http://localhost:10026/md-memo/ 。沒有 lint、沒有 build；測試見下方 Agent 段落（`node --test`）。CI（`.github/workflows/test.yml`）在 push main 與 PR 時跑 `npm test` 與 `npm run smoke`。

### 環境變數

`npm start` / `npm run dev` 以 `node --env-file-if-exists=.env` 啟動：專案根目錄的 `.env`（若存在）自動載入，沒有 `.env`（例如 Railway/Render 改用平台 env vars）也不會 crash。沒裝 dotenv，靠 Node 內建（`--env-file-if-exists` 需 22.9+，`package.json` 已聲明 `engines`）。

變數：`OPENROUTER_API_KEY`（AI 必需）、`PORT`（預設 10026）、`HOST`（綁定位址，預設 `127.0.0.1`；部署 Railway/Render/Docker 時設 `0.0.0.0`）、`BASE_PATH`（預設 `/md-memo`，見下）、`HISTORY_LIMIT`（保留筆記上限，預設 `1000`；JSON 儲存每次寫入整檔重寫，見下方資料儲存）、`AI_MODEL`（`/api/format` 用，預設 `deepseek/deepseek-v4-flash`）、`AI_MAX_TOKENS`（`/api/format` 輸出上限，預設 `32768`；模型仍可能因自身上限截斷，此時回傳 `truncated:true`，前端警告且 history 保留完整原文）、`AGENT_MODEL`（agent 用，須支援 tools；未設則 fallback `AI_MODEL`，再無則 `deepseek/deepseek-v4-pro`）、`AGENT_LANG`（agent 回應語言，BCP-47，預設 `zh-TW`；非 `zh*` 時後端產生的 proposal 摘要與步數上限訊息也改用英文）、`AUTH_ENABLED`（選用 HTTP Basic Auth 開關，預設 `false`）、`AUTH_PASSWORD`（啟用時的密碼，username 任意忽略）。`AUTH_ENABLED=true` 時保護整個 app 與所有 `/api/*`，但永久連結 `/m/:id` 維持公開；`AUTH_ENABLED=true` 卻沒設 `AUTH_PASSWORD` 則不啟用（warn，避免空密碼或誤鎖）。middleware 在 `src/auth.js`，於 `src/index.js` 最前面 `app.use`。

## 架構

整個 app 只有兩個檔案承載邏輯：

- **`src/index.js`**（~220 行）——單一 Express server，ES Modules。
- **`public/index.html`**（~1080 行）——整個 SPA：HTML + CSS + vanilla JS 全部 inline，markdown 渲染用 CDN 的 `marked`。

### 資料儲存

單一 JSON 檔 `data/history.json`，無資料庫。`loadHistory()`/`saveHistory()` 直接讀寫整個檔案（整檔重寫，規模痛點出現才考慮換儲存），最多保留 `HISTORY_LIMIT` 筆（環境變數，預設 1000）。寫入為原子操作（先寫 `<file>.tmp` 再 rename）；讀檔 parse 失敗時把損毀檔隔離成 `<name>.corrupt-<時間戳>.json` 後以空庫繼續（原始內容保留可人工救回），`sessions.json` 同款處理。每筆 `id` 是 `Date.now()`（同毫秒遞增防碰撞）。每筆有 `title`/`slug` 身分（`src/slug.js`：`deriveTitle` 取第一個標題行、`slugify` 產 CJK 友善 kebab-case；title 隨編輯重算、**slug 產生後穩定不變**，是未來 wiki 連結的地基）；舊資料缺 title/slug 時由 `loadHistory()` lazy 補齊並持久化一次，無需手動遷移。`data/history.sample.json` 是範例資料。

### Agent（對筆記庫的多步推理）

`src/agent.js` 是 hand-built 的 agent loop（無框架），用 OpenRouter 原生 function calling。讀取類工具（`search_memos`/`read_memo`/`list_tags`）在 loop 內即時執行；寫入類工具（`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）只 emit `proposal`，由 `POST /api/agent/apply` 在使用者確認後落地。寫入提案在 propose 階段先以 `validateProposal`（`src/tools.js`）驗證，失敗時錯誤以 tool_result 餵回模型自我修復、不會顯示給使用者；通過的提案由 `src/proposals.js`（in-memory 一次性 registry，上限 200 筆 FIFO）發 id，SSE `proposal` 事件帶 `{ id, action, args, summary }`。SSE 斷線時 `/api/agent` 以 AbortController 中止 loop 與 in-flight OpenRouter 請求。工具與持久化分別在 `src/tools.js`、`src/store.js`。`POST /api/agent` 以 SSE 串流事件（start/message/tool_call/tool_result/proposal/answer/done/error）。前端 agent 面板在 `public/index.html`，用 `fetch().body.getReader()` 讀 SSE。模型由 `AGENT_MODEL` 控制（須支援 tools），回應語言由 `AGENT_LANG`（BCP-47，預設 `zh-TW`）控制——注入在 `SYSTEM` prompt，server 啟動時讀取。測試：`node --test`（`test/`），loop 用注入式 `callModel`；`npm run smoke` 跑無 API key 的整合 smoke。

前端 agent 面板為三欄：左側已存 session 清單（可重播、可「存成 memo」，後者重用 `create_memo` apply）、中間 trace+輸入（送出時中央顯示 thinking 動畫、送出後清空輸入）、右側範例 prompt 與「送出紀錄」（送出過的 prompt，localStorage 持久、點擊回填）。檢視模式由 `setMode()` 集中管理：View / Edit / Agent / Combine（Combine = 編輯時開 quickview 的左右並排）。Memo List 具兩層搜尋（輸入即過濾已載入項、Enter 打 `/api/history/search` 全庫搜尋）、tag 點擊篩選（走 server 端 `tag` 參數，chip 顯示可取消）、分頁載入（「載入更多」＋IntersectionObserver 滾到底自動載，每頁 50）、排序切換（`order` 參數）、鍵盤操作（`/` 聚焦搜尋、`↑`/`↓` 移動、Enter 開啟、Esc 清除）與「符合 n / 全部 N」計數列；列表項只有輕量欄位，quickview／還原時才按需抓單篇全文。

編輯模式（對既有筆記按 ✏️ Edit）提供三鈕：💾 Save（原樣覆蓋，不跑 LLM，走 `PUT /api/history/:id`）、✨ Reformat（重跑 LLM，native confirm 選覆蓋既有或另存新筆記）、🗑 Discard（native confirm 後丟棄編輯、回到該筆 View 或清空）。Save/Discard 的顯示由 `updateEditControls()` 控制（Save 僅在編輯既有筆記時、Discard 僅在有輸入時）。History 面板已更名為「Memo List」。

### 標籤約定（跨前後端的隱性契約）

AI 不回傳結構化 tags 欄位。系統 prompt（`src/index.js` 內 `/api/format` 的 system message）要求模型在輸出**最後一行**附上 `<!-- tags: a, b, c -->`，後端 `parseTags()`（`src/format.js`，由 `parseFormatResult()` 呼叫）用 regex 抽出標籤並把該行從 markdown 移除。改動 prompt 格式時必須同步改 `parseTags()`，否則標籤會壞掉或殘留在內文。

### 路由

所有路由都掛在 `BASE_PATH` 之下：

- `POST /md-memo/api/format` — 呼叫 OpenRouter，存進 history，回傳 `{ markdown, tags, id, truncated }`。body 可選 `id`：帶既有 id 時改為「覆蓋該筆」（Edit mode 的 Reformat→覆蓋），否則新建。
- `POST /md-memo/api/agent` — hand-built agent loop，以 SSE 串流事件（讀工具即時執行，寫工具 emit proposal）
- `POST /md-memo/api/agent/apply` — 以一次性 proposal id 落地 agent 的寫入 proposal（body `{ id }`；args 存 server 端 registry，id 未知／已用過／server 重啟後回 400，防重複套用與竄改）
- `POST /md-memo/api/history` — raw create，不跑 LLM（body `{ markdown, tags? }`；agent session「存成 memo」用）
- `GET  /md-memo/api/history` — 分頁輕量列表：`limit`/`offset`/`tag`/`order`（asc|desc，預設 desc），回 `{ items, total, all }` 封套（items 只含 `id`/`title`/`slug`/`preview`/`tags`/`createdAt`，**不含全文**；`total` 是套用 tag 篩選後的總數、`all` 是全庫筆數）
- `GET  /md-memo/api/history/search?q=&limit=` — 全庫關鍵字搜尋，重用 `src/tools.js` 的 `searchMemos`（與 agent 的 `search_memos` 同一套計分）；**必須註冊在 `:id` 路由之前**
- `GET  /md-memo/api/history/:id` — 單篇全文（SPA quickview／點擊還原按需抓取），非數字或不存在回 404
- `GET  /md-memo/api/tags` — 全庫 tag 計數（重用 `listTags()`，tag cloud 用）
- `DELETE /md-memo/api/history/:id` — 刪除單筆
- `PUT  /md-memo/api/history/:id` — 原樣覆蓋既有筆記的 markdown/tags（不跑 LLM，Edit mode 的 Save 用；`src/store.js` 的 `updateEntry`）
- `POST /md-memo/api/history/clear` — 先把 `data/history.json` 複製成帶時間戳的 `data/history.<時間戳>.bak.json`（每次清空各留一份），再清空（前端兩段式確認）
- `GET/POST /md-memo/api/sessions`、`DELETE /md-memo/api/sessions/:id` — 已存 agent session 的列出／儲存／刪除（`src/sessions.js`，存 `data/sessions.json`）
- `GET  /md-memo/m/:id` — **server-render** 的公開永久連結頁（用 `src/permalink.js` 的 `renderPermalink`）
- `GET  /md-memo/` — 靜態 SPA（`express.static`）

### 兩套獨立的渲染環境（容易踩雷）

markdown 在兩個地方各自渲染、CSS 各自獨立、互不影響：

1. **SPA**（`public/index.html`）——客戶端 `marked`，支援 dark/light 切換（**預設 light「Writing」**，Colophon 設計，字體用 Instrument Serif / Literata / IBM Plex Mono），狀態機在 editor / preview 模式間切換（`isPreviewMode`），另有 quick view 面板可預覽 history 而不離開編輯器。樣式用 `.md-render` class。
2. **永久連結頁**（`src/permalink.js` 的 `renderPermalink(entry, basePath)`，由 `src/index.js` 的 `GET /m/:id` handler 與 demo build 共用）——用 template string 產出一份**完全獨立、自包含**的 HTML（只有 light theme），CSS 是另一份複製。

改前端樣式不會影響永久連結頁，反之亦然——兩邊要分別改。

### 靜態 demo（GitHub Pages）

`scripts/build-demo.mjs`（`npm run build:demo`）把 app 打包成**純靜態** bundle 到 `dist-demo/`，部署到 GitHub Pages，免後端、免 API key。核心原則是「真 app 維持唯一真相」：

- build 讀真的 `public/index.html`，在第一支 inline script 前注入 `<script src="mock.js">`，再把 `__BASE_PATH__` 替換成 `/md-memo`。
- `demo/mock.js` 是瀏覽器 IIFE，monkeypatch `window.fetch` 攔 `/api/*`：history/format/delete 回預錄 JSON；`POST /api/agent` 以真 `ReadableStream` 重播 `demo/data/agent-trace.json` 的 SSE（流經 app 既有 parser）；apply 用與 server `applyProposal` 相同的合併公式產出筆記。AI 回應全為預錄，前端有「Demo mode」角標揭露。
- 永久連結頁用 `renderPermalink` 預生成 `m/<id>/index.html`（10 筆 seed + 合併筆記 id 200）。
- 資料在 `demo/data/`（`history.json` 10 筆雙語、`format-samples.json`、`agent-trace.json`）。測試：`test/permalink.test.mjs`、`test/demo-data.test.mjs`（跨檔一致性）。
- CI：`.github/workflows/deploy-demo.yml` 在 push 到 main 時 build 並 force-push 到 orphan `gh-pages` 分支（須在 repo Settings → Pages 一次性指向 `gh-pages`/root）。零新依賴（build 只用 Node 內建）。

## 部署設定與限制

- **`BASE_PATH`** 由 `process.env.BASE_PATH` 控制（預設 `/md-memo`）。前端讀不到 `process.env`，所以機制是：`public/index.html` 用 `__BASE_PATH__` placeholder，後端服務 SPA 時讀檔做字串替換後再回傳（`src/index.js` 裡組出 `indexHtml` 的那段，掛在 `express.static` 之前攔截 `BASE_PATH` 根路徑）。**在 index.html 新增任何路徑相關字串時務必用 `__BASE_PATH__`**，否則換 base path 部署會連錯。permalink 頁（`renderPermalink`）的 basePath 由參數傳入（server 傳 `BASE_PATH`，demo build 傳 `/md-memo`）。
- server 預設綁 `127.0.0.1`（`src/index.js` 結尾的 `app.listen`），可用 `HOST` 環境變數覆寫（如 `HOST=0.0.0.0` 供 Railway/Render/Docker）；本機部署的外部存取需自行架反向代理（nginx 等）。
