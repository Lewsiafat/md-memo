# 靜態 Demo 站（Static Showcase）— Walkthrough

- **分支:** `feat/demo-site`
- **日期:** 2026-06-24

## 變更摘要

把 md-memo 改造成一份可分享的**純靜態 GitHub Pages demo**：AI 互動（Format 按鈕、agent 推理 trace）由**預錄腳本**驅動，讓沒有 OpenRouter API key 的人也能體驗完整流程、零後端零成本。採「方案 A」——`public/index.html` 維持唯一真相，一支 build script 產出 `dist-demo/`，注入一層 `mock.js` 攔截 `window.fetch` 餵預錄回應（agent 串流透過真正的 `ReadableStream` 重播，流經 app 既有的 SSE parser），並重用從 server 抽出的 `renderPermalink()` 預生成永久連結頁。GitHub Actions 自動 build 並 force-push 到 orphan `gh-pages` 分支。

以 subagent-driven 流程執行：7 個任務逐一實作 + 每任務 spec/品質雙重 review，最後一次全分支 review（opus，結論 merge-ready，零 Critical/Important），並以 Playwright 對 build 出的 bundle 做互動式驗收（實質 19/19）。

## 修改的檔案

**新增（核心）**
- `src/permalink.js` — 從 `src/index.js` 抽出的 `renderPermalink(entry, basePath)`，server 與 build 共用（byte-identical 抽取）。
- `demo/data/history.json` — 10 筆雙語種子筆記（固定 id 101–110）。
- `demo/data/format-samples.json` — 編輯器預填文字 + 預錄的 Format 結果。
- `demo/data/agent-trace.json` — 可重播的 agent 事件序列（`merge_memos` 提案，apply id 200）。
- `demo/mock.js` — 瀏覽器 IIFE：monkeypatch `window.fetch` 攔 `/api/*`、以真 `ReadableStream` 重播 SSE、Demo 角標、編輯器/agent 預填。
- `scripts/build-demo.mjs` — 靜態 build：注入 mock、替換 `__BASE_PATH__`、複製資料、預生成 `m/<id>/index.html`（10 seed + 合併筆記 = 11）、`.nojekyll`。
- `.github/workflows/deploy-demo.yml` — CI：build 後以 `peaceiris/actions-gh-pages` 部署到 `gh-pages`（`force_orphan`）。
- `demo/README.md` — demo build/部署說明。

**新增（測試）**
- `test/permalink.test.mjs` — `renderPermalink` 單元測試。
- `test/demo-data.test.mjs` — demo 資料形狀 + 跨檔一致性測試（trace 引用的 id 皆存在、applyId 不撞、proposal 形狀）。

**新增（文件）**
- `docs/plans/2026-06-24-demo-site-design.md` — 設計文件。
- `docs/superpowers/plans/2026-06-24-demo-site.md` — 7 任務實作計畫。

**修改**
- `src/index.js` — `GET /m/:id` 改呼叫 `renderPermalink()`（輸出 byte-identical）。
- `package.json` — 新增 `build:demo` script（其餘 start/dev/test/smoke 不變）。
- `.gitignore` — 加 `dist-demo/`。
- `README.md` — 加「🌐 Live Demo」段。

## 技術細節

- **唯一真相不分叉**：build 不複製 SPA，而是讀真 `public/index.html`，只在第一支 inline script 之前注入 `<script src="mock.js">`，再把 `__BASE_PATH__` placeholder 替換為 `/md-memo`。改前端只需改一處。
- **SSE 真重播**：`mock.js` 以 `event: <name>\ndata: <json>\n\n` 格式透過真 `ReadableStream` enqueue，正好對上 `public/index.html` 以 `\n\n` 切 frame、抓 `event:`/`data:` 的 parser——預錄 trace 因此流經**未改動**的正式 SSE 程式路徑（方案 A 的關鍵）。
- **合併公式三處一致**：`merge_memos` 的合併筆記推導（`# title` 前置、附 `sources`）在 server `applyProposal`、`mock.js` 的 apply、`build-demo.mjs` 的 permalink 預生成三處邏輯相同（final review 已逐一比對未漂移）。瀏覽器 IIFE 與 Node ESM 跨 runtime 的這 1 行重複為刻意取捨（無 bundler 下強行共用反而更脆弱）。
- **永久連結形態**：預生成 `m/<id>/index.html`（目錄 + index），讓 `/md-memo/m/<id>` 有無尾斜線都能解析。
- **零新依賴**：build 僅用 Node 內建（`node:fs/path/url`）+ 本地 `src/permalink.js`；`npm start`/`npm run dev` 行為不變。
- **驗證**：`npm test` 28/28；`npm run build:demo` 產出 11 permalinks 且無 `__BASE_PATH__` 殘留；Playwright 互動驗收涵蓋 history 載入、標籤篩選（All→10／side project→4）、Format→canned、agent 重播→確認卡→套用→開啟 `m/200`、`m/108` seed permalink、dark/light、Demo 角標、無 console error。

## 一次性手動後續（非本次範圍）

CI 首跑（push 到 main 觸發）會以 `force_orphan` 建出 `gh-pages` 分支。之後到 **Settings → Pages → Build and deployment → Deploy from a branch → `gh-pages` / `(root)`** 開啟，網址即為 `https://lewsiafat.github.io/md-memo/`。
