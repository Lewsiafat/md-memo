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

開啟 http://localhost:10026/md-memo/ 。沒有 lint、沒有 build；測試見下方 Agent 段落（`node --test`）。

### 環境變數

`npm start` / `npm run dev` 以 `node --env-file-if-exists=.env` 啟動：專案根目錄的 `.env`（若存在）自動載入，沒有 `.env`（例如 Railway/Render 改用平台 env vars）也不會 crash。沒裝 dotenv，靠 Node 內建（需 20.12+）。

變數：`OPENROUTER_API_KEY`（AI 必需）、`PORT`（預設 10026）、`BASE_PATH`（預設 `/md-memo`，見下）、`AI_MODEL`（`/api/format` 用，預設 `deepseek/deepseek-v4-flash`）、`AGENT_MODEL`（agent 用，須支援 tools；未設則 fallback `AI_MODEL`，再無則 `deepseek/deepseek-v4-pro`）、`AGENT_LANG`（agent 回應語言，BCP-47，預設 `zh-TW`）。

## 架構

整個 app 只有兩個檔案承載邏輯：

- **`src/index.js`**（~220 行）——單一 Express server，ES Modules。
- **`public/index.html`**（~1080 行）——整個 SPA：HTML + CSS + vanilla JS 全部 inline，markdown 渲染用 CDN 的 `marked`。

### 資料儲存

單一 JSON 檔 `data/history.json`，無資料庫。`loadHistory()`/`saveHistory()` 直接讀寫整個檔案，最多保留 `HISTORY_LIMIT = 50` 筆（`history.unshift()` 後 `.slice(0, 50)`）。每筆 `id` 是 `Date.now()`。`data/history.sample.json` 是範例資料。

### Agent（對筆記庫的多步推理）

`src/agent.js` 是 hand-built 的 agent loop（無框架），用 OpenRouter 原生 function calling。讀取類工具（`search_memos`/`read_memo`/`list_tags`）在 loop 內即時執行；寫入類工具（`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）只 emit `proposal`，由 `POST /api/agent/apply` 在使用者確認後落地。工具與持久化分別在 `src/tools.js`、`src/store.js`。`POST /api/agent` 以 SSE 串流事件（start/message/tool_call/tool_result/proposal/answer/done/error）。前端 agent 面板在 `public/index.html`，用 `fetch().body.getReader()` 讀 SSE。模型由 `AGENT_MODEL` 控制（須支援 tools），回應語言由 `AGENT_LANG`（BCP-47，預設 `zh-TW`）控制——注入在 `SYSTEM` prompt，server 啟動時讀取。測試：`node --test`（`test/`），loop 用注入式 `callModel`；`npm run smoke` 跑無 API key 的整合 smoke。

### 標籤約定（跨前後端的隱性契約）

AI 不回傳結構化 tags 欄位。系統 prompt（`src/index.js` 內 `/api/format` 的 system message）要求模型在輸出**最後一行**附上 `<!-- tags: a, b, c -->`，後端 `parseTags()` 用 regex 抽出標籤並把該行從 markdown 移除。改動 prompt 格式時必須同步改 `parseTags()`，否則標籤會壞掉或殘留在內文。

### 路由

所有路由都掛在 `BASE_PATH` 之下：

- `POST /md-memo/api/format` — 呼叫 OpenRouter，存進 history，回傳 `{ markdown, tags, id }`
- `POST /md-memo/api/agent` — hand-built agent loop，以 SSE 串流事件（讀工具即時執行，寫工具 emit proposal）
- `POST /md-memo/api/agent/apply` — 使用者確認後落地 agent 的寫入 proposal
- `GET  /md-memo/api/history` — 回傳全部 history
- `DELETE /md-memo/api/history/:id` — 刪除單筆
- `POST /md-memo/api/history/clear` — 先把 `data/history.json` 複製成 `data/history.bak.json`，再清空（前端兩段式確認）
- `GET  /md-memo/m/:id` — **server-render** 的公開永久連結頁（用 `src/permalink.js` 的 `renderPermalink`）
- `GET  /md-memo/` — 靜態 SPA（`express.static`）

### 兩套獨立的渲染環境（容易踩雷）

markdown 在兩個地方各自渲染、CSS 各自獨立、互不影響：

1. **SPA**（`public/index.html`）——客戶端 `marked`，支援 dark/light 切換，狀態機在 editor / preview 模式間切換（`isPreviewMode`），另有 quick view 面板可預覽 history 而不離開編輯器。樣式用 `.md-render` class。
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
- server 只綁 `127.0.0.1`（`src/index.js` 結尾的 `app.listen`），外部存取需自行架反向代理（nginx 等）。
