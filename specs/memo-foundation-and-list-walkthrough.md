# Memo 地基與列表可用性（Phase 0 + 0.5）— Walkthrough

- **分支:** `feat/memo-foundation-and-list`
- **日期:** 2026-07-06
- **依據:** `specs/memo-foundation-and-list.md`、`docs/plans/2026-07-04-memo-foundation-and-list-plan.md`（15 任務）、知識引擎藍圖 Phase 0/0.5

## 變更摘要

一次完成知識引擎藍圖的前兩個 Phase。**Phase 0（地基）**：`HISTORY_LIMIT` 從寫死 50 改為環境變數（預設 1000）；每筆 memo 獲得 `title`/`slug` 身分（`src/slug.js`——title 取第一個標題行、slug 為 CJK 友善 kebab-case 且產生後穩定不變，是 Phase 1 wiki 連結的地基）；舊資料由 `loadHistory()` lazy 補齊、免手動遷移；`GET /api/history` 改為 `{ items, total, all }` 分頁輕量封套（不含全文），新增 `GET /api/history/search`（重用 `searchMemos`，UI 與 agent 同一套計分）、`GET /api/history/:id`（單篇全文按需抓取）、`GET /api/tags`（tag cloud 正確計數）。**Phase 0.5（列表可用性）**：Memo List 具兩層搜尋（即時過濾已載入項＋Enter 全庫搜尋）、tag 點擊篩選（server 端參數＋可取消 chip）、「載入更多」按鈕＋IntersectionObserver 滾到底自動載、排序切換（新→舊／舊→新）、鍵盤操作（`/` 聚焦、`↑`/`↓` 移動、Enter 開啟、Esc 清除）、「符合 n / 全部 N」計數列；i18n en/zh 兩份補齊。demo mock 同步全部新路由形狀，靜態 demo 行為與真 app 對等。

## 修改的檔案

**新增（核心）**
- `src/slug.js` — `deriveTitle(markdown)`（第一個 `#` 標題行，fallback 第一個非空行）、`slugify(title, existingSlugs)`（CJK 保留 kebab-case、`-2`/`-3` 唯一化）。

**修改（核心）**
- `src/store.js` — `historyLimit()` 讀 `process.env.HISTORY_LIMIT`（預設 1000）；`createEntry` 產出 title/slug；`updateEntry` 重算 title（slug 不動）；`loadHistory` lazy 補齊舊資料並持久化一次；新增 `listEntries({ limit, offset, tag, order })` 輕量列表查詢。
- `src/tools.js` — `searchMemos` 回傳補 `title`（agent 與 UI 搜尋共用）。
- `src/index.js` — `GET /api/history` 分頁封套；新增 `GET /api/history/search`（**註冊在 `:id` 之前**）、`GET /api/history/:id`（非數字/不存在回 404）、`GET /api/tags`。
- `public/index.html` — SPA 資料層改封套與分頁狀態、quickview／點擊還原改走單篇端點；搜尋框（debounce 即時過濾＋Enter 全庫搜尋＋Esc）；tag 篩選（列表項 tag 可點、chip、server 端重查、tag cloud 接 `/api/tags`）；載入更多＋IntersectionObserver；排序切換；鍵盤導航（`kbIndex` 高亮、editor 輸入中不搶 `/`）；計數列；i18n 新字串 en/zh。
- `demo/mock.js` — 同步 `{ items, total, all }` 封套與 `limit`/`offset`/`tag`/`order`；新增 `/api/tags`、`/api/history/search`（同 `searchMemos` 計分公式）、`GET /:id`；`demoTitle`（複製 `deriveTitle` 公式）補齊 seed 與五個 entry 建立/更新處的 title。

**修改（測試）** — 59 → 75 tests
- `test/slug.test.mjs`（新增）— title 推導、CJK slug、唯一化。
- `test/store.test.mjs` — env 上限、title/slug 產出與穩定性、lazy 補齊、`listEntries` 分頁邊界/tag 篩選/order。
- `test/tools.test.mjs` — searchMemos 回傳含 title。

**修改（文件）**
- `.env.sample`／`README.md`／`README.zh-TW.md` — `HISTORY_LIMIT` 說明。
- `CLAUDE.md` — 環境變數、資料儲存（title/slug、lazy 補齊）、路由清單（封套＋三個新端點）、Memo List 前端能力描述。

## 技術細節

- **slug 穩定性**：slug 只在建立（或 lazy 補齊）時產生一次並持久化，`updateEntry` 只重算 title——wiki 身分（Phase 1 `[[wikilink]]`）不因編輯而斷鏈。
- **「改一處兩邊受益」**：UI 全庫搜尋端點直接重用 `src/tools.js` `searchMemos`，與 agent 的 `search_memos` 同一套計分；`/api/tags` 重用 `listTags()`。
- **列表輕量化的一致性**：列表 API 不再回全文，SPA 只有 quickview／還原時按需抓單篇；permalink（`renderPermalink`）仍用 `entry.markdown` 全文，不受影響（雙套渲染契約 intact）。
- **鍵盤導航與搜尋 Enter 的衝突處理**：search box 的 Enter handler 開頭加 `if (kbIndex >= 0) return;` 守衛——有鍵盤選取時 Enter 開啟該筆，無選取時才觸發全庫搜尋。
- **demo 對等而非復用**：mock 的 search 計分與 `demoTitle` 是公式複製（瀏覽器 IIFE 無法 import server 模組，沿用 `mergedNoteFrom` 前例），`test/demo-data.test.mjs` 維持跨檔一致性把關。
- **驗證**：`npm test` 75/75、`npm run smoke` 通過、`npm run build:demo` 成功。Playwright 對真 app（1,000 筆 seed、獨立 `HISTORY_FILE`）走查 22+8 項全過：初載 50→點載入更多 100→滾到底自動載；即時過濾→Enter 全庫搜尋（11 hits）→Esc；tag 篩選 chip；排序雙向；`/`/`↑↓`/Enter/Esc 鍵盤流；語言切換新字串、dark/light 可讀；刪除、Edit→Save（PUT）、兩段式清空。靜態 demo bundle 走查 14 項全過（封套、search、單篇、tags mock 路由皆生效、零 JS error）。路由層 curl 驗證：`/api/history/abc` 與不存在 id 皆 404、`/search` 未被 `:id` 吃掉。
- **契約把關**：contract-reviewer agent 確認 tags 格式（prompt/`parseTags` 未動）、`__BASE_PATH__`（新 fetch 全走 `API`/`BASE` 常數）、雙套渲染三項契約 intact。
