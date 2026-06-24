# Demo Site（靜態展示站）— 設計文件

- **日期**：2026-06-24
- **分支**：`feat/demo-site`
- **目標脈絡**：延續專案的求職作品定位。提供一個**可直接點開的線上連結**，讓不會自己設 OpenRouter API key 的 hiring manager 也能體驗 md-memo 的核心魔法（純文字 → 結構化 markdown、自動標籤、agent 多步推理 trace），零後端、零成本。

## 1. 概要

把 md-memo 這個**後端 app**（Express、SSE agent、server-render permalink、`__BASE_PATH__` 替換）改造成一份**純靜態站**，部署到 GitHub Pages。AI 互動以**預錄腳本模擬**：格式化按鈕回傳預烘焙的 markdown，agent 面板重播一段預錄的 reasoning trace——兩者都走前端**原本同一條**程式碼路徑，所以擬真度高。內容為**雙語（中英混搭）**，刻意涵蓋各種 markdown 元素。

### 定位（一句話）

> 用一支 build script + 一層小小的 mock-fetch shim，把後端 app 變成可分享的靜態 demo，真 app 仍是唯一真相來源。

## 2. 關鍵設計決定

| 決定 | 理由 |
|------|------|
| **靜態展示（免後端 AI）→ GitHub Pages** | 目標是「可分享連結」，不是線上互動站。免去 API key 成本與陌生人濫用風險。 |
| **Mock 回應（預錄腳本）而非停用按鈕** | 保留「點格式化 → 看到它發生」「agent 逐行浮現 trace」的核心魔法。靜態唯讀會丟失產品最有說服力的部分。 |
| **方案 A：build script + mock-fetch shim** | 唯一同時做到（a）mock 保留互動、（b）真 app 維持單一真相、（c）可維護。Fork 複製（B）會立刻 drift；全靜態預渲染（C）與 mock 選擇相牴觸。 |
| **專用 `gh-pages` orphan 分支** | 與原創作歷史分開；source（build script + 內容）留在 main 跟著版控，產物推到 gh-pages。 |
| **GitHub Actions 自動部署** | push main（或手動 dispatch）就自動 build 並 force-push 到 gh-pages，永遠同步，無手動步驟。 |
| **雙語內容（中英混搭）** | 展示工具處理多語的能力，視覺更多樣。 |
| **誠實標示「Demo mode — AI 回應為預錄」角標** | 不假裝是真 LLM。 |

## 3. 架構與檔案佈局

主旨：source 全留在 `main` 跟著版控；build 產物推到 `gh-pages`。真 app 程式碼**零改動或極小改動**。

### 3.1 `main` 上新增的 source

```
scripts/build-demo.mjs         # build：替換 __BASE_PATH__、注入 mock、預產 permalink、輸出 dist
demo/mock.js                   # runtime shim：monkeypatch window.fetch 攔 /api/*
demo/data/history.json         # 雙語 demo 種子（約 10 筆）
demo/data/format-samples.json  # 「格式化」的 raw → {markdown,tags} 預錄對
demo/data/agent-trace.json     # agent 面板重播的事件序列
.github/workflows/deploy-demo.yml   # CI：build + push gh-pages
```

### 3.2 一處小重構（避免「兩套渲染環境」雷）

把 `src/index.js` 裡 `GET /m/:id` 的 permalink template 抽成 `src/permalink.js` 的一支函式。server 與 build script **共用同一份** permalink 渲染，build 時即可預產靜態 `m/<id>/index.html`，不再複製一份 HTML。

### 3.3 build 產物（推到 `gh-pages` 根目錄）

```
index.html        # __BASE_PATH__ 已替換、已注入 <script src=mock.js>
mock.js
data/*.json
m/<id>/index.html # 每筆筆記預產的靜態 permalink（用 /<id>/index.html 形式，無副檔名也能打開）
.nojekyll         # 關掉 Jekyll
```

### 3.4 BASE_PATH

repo 名是 `md-memo` → Pages 服務在 `lewsiafat.github.io/md-memo/` → `BASE_PATH = /md-memo`，等於 app 預設，permalink 路徑天然對得上。

## 4. Mock 層（每個端點怎麼攔）

`mock.js` 在頁面載入時 monkeypatch `window.fetch`，比對 URL pattern 走對應分支；非 `/api/*` 的請求（如 CDN `marked`）原樣放行。一份 in-memory `history` 陣列當 session 狀態（reload 後重置）。

| 端點 | Mock 行為 |
|---|---|
| `GET /api/history` | 回傳 in-memory `history`（初始 = `data/history.json`） |
| `POST /api/format` | 比對送入的 `raw`：命中 `format-samples.json` 回該筆預錄 `{markdown,tags}`；未命中回通用範本。配 `id`、`unshift` 進 history，讓「格式化後出現在歷史」成立 |
| `DELETE /api/history/:id` | 從 in-memory 陣列移除，回 200（清空鈕同理） |
| `POST /api/agent`（SSE） | **保真核心**：回假 `Response`，其 `body.getReader()` 逐塊吐出 `agent-trace.json` 預錄事件（start→message→tool_call→tool_result→…→proposal→answer→done），塊間插入固定延遲，走前端原本同一條 SSE 解析程式碼 |
| `POST /api/agent/apply` | 回預錄 `{id}`，把 proposal 新筆記 `unshift` 進 history，「開啟筆記 →」連到預產 permalink |
| `/m/:id`（anchor href） | 指向 build 預產的靜態 permalink；不需 runtime 攔截 |

### 務實取捨

`POST /api/format` 輸入是任意文字，mock 無法真的呼叫 LLM。做法：demo 載入時**預填一段示範 raw 文字**，對應 `format-samples.json` 的命中結果；使用者改字仍回最接近的 canned 結果（demo 可接受）。頁面以「Demo mode — AI 回應為預錄」角標誠實標示。

### GitHub Pages permalink 細節

`/m/<id>`（無副檔名）要能直接打開，build 產 `m/<id>/index.html`（而非 `m/<id>.html`），這樣 `/md-memo/m/<id>` 結尾帶不帶 `/` 都解析得到。

## 5. 雙語內容設計

### 5.1 歷史種子 `data/history.json`（約 10 筆，中英混搭，涵蓋各種 markdown 元素）

| # | 標題 | 語言 | 展示的格式元素 |
|---|---|---|---|
| 1 | 產品週會 2026-06-15 | 中 | 標題層級、粗體、巢狀清單 |
| 2 | Reading Notes: Designing Data-Intensive Apps | En | 編號清單、blockquote |
| 3 | Snippet: debounce in JavaScript | En | fenced code block |
| 4 | 週末料理：味噌鮭魚 | 中 | 食材表格、有序步驟 |
| 5 | Bug: SSE 在 Safari 中途斷線 | 中＋En | code block＋checklist |
| 6 | Idea: offline-first sync 💡 | En | 清單、emoji、強調 |
| 7 | 京都行程 Day 1 | 中 | checklist、表格 |
| 8 | Standup 2026-06-20 | En | 表格（Yesterday/Today/Blockers） |
| 9 | RAG vs Fine-tuning 比較筆記 | 中 | 對照表格、結論引用 |
| 10 | 隨手想法：好工具應該隱形 | 中 | 短文、blockquote |

標籤雙語混用（`meeting`、`料理`、`javascript`、`旅行`、`ai`…），讓 tag cloud 過濾有料。

### 5.2 「格式化」示範 `format-samples.json`

載入時編輯器預填一段**凌亂的中文 brain-dump**（隨手會議雜記、無任何 markdown），按格式化 → 回乾淨 markdown（標題＋重點表格）＋自動標籤。主示範 1 筆，另備 1–2 筆英文 alternate。

### 5.3 Agent 重播 `agent-trace.json`

劇本：使用者問「**把這週跟 side project 有關的筆記整理成一份雙語總覽**」→ agent 依序：

```
start
→ message(我先搜尋相關筆記)
→ tool_call search_memos("side project")
→ tool_result(命中 #5/#6/#3)
→ message(讀兩篇細看)
→ read_memo ×2 + tool_result
→ list_tags + tool_result
→ message(我會合併並建立連結)
→ proposal(create_memo：一份雙語總覽)
→ answer
→ done
```

寫入工具 `create_memo` 走 proposal → 跳出確認卡；按確認 → apply mock 把總覽加進歷史，「開啟筆記 →」連到預產 permalink。整段走前端原本 SSE UI，reasoning trace 逐行浮現。

## 6. Build／部署流程

### 6.1 `scripts/build-demo.mjs`（在 `main` 上跑）

1. 清空並建立輸出目錄 `dist-demo/`（main 上 gitignore）
2. 讀 `public/index.html`，`__BASE_PATH__` 全替換成 `/md-memo`
3. 在 app 的 inline `<script>` **之前**注入 `<script src="mock.js"></script>`——順序關鍵，因為載入即 `GET /api/history`，mock 必須先 patch `window.fetch`
4. 複製 `demo/mock.js`、`demo/data/*.json` 到輸出
5. `import { renderPermalink } from '../src/permalink.js'`，對每筆筆記寫 `m/<id>/index.html`
6. 寫 `.nojekyll`，插入「Demo mode」角標

加 `npm run build:demo` 串起來。

### 6.2 `.github/workflows/deploy-demo.yml`

- 觸發：push 到 main（paths：`public/**`、`demo/**`、`scripts/build-demo.mjs`、`src/permalink.js`）+ 手動 `workflow_dispatch`
- 步驟：checkout → setup-node → `npm ci` → `node scripts/build-demo.mjs` → `peaceiris/actions-gh-pages` force-push `dist-demo/` 到 `gh-pages`
- Pages 設定（手動一次）：Deploy from branch → `gh-pages` / root

## 7. 測試與驗收

- `node scripts/build-demo.mjs` 產出 `dist-demo/`，本地用 `npx serve dist-demo` 或 `python3 -m http.server` 開 `/md-memo/` 驗證
- 驗收清單：
  - [ ] 歷史 10 筆載入、tag cloud 過濾正常
  - [ ] 格式化按鈕回傳預錄 markdown + 標籤，新筆記入歷史
  - [ ] agent 面板重播 trace，逐行浮現，proposal 確認卡出現
  - [ ] 確認後新筆記入歷史、「開啟筆記 →」連到可開啟的 permalink
  - [ ] permalink 頁（`m/<id>/`）獨立渲染正常
  - [ ] dark/light 切換、quick view 正常
  - [ ] 「Demo mode」角標顯示
  - [ ] 非 `/api/*` 請求（CDN marked）未被攔截
- server 端原 app 行為不受影響（permalink 重構後 `npm test` 仍綠、`GET /m/:id` 行為不變）

## 8. 風險與限制

- **mock 與 API 形狀耦合**：`/api/*` 形狀若改，`mock.js` 要同步。以 `demo/data/*.json` 集中資料、mock.js 只負責路由，降低耦合面。
- **格式化非真 LLM**：使用者改字仍回 canned 結果——靠角標誠實標示。
- **session 狀態 reload 重置**：in-memory history 不持久化（demo 場景可接受，刷新即回初始）。
