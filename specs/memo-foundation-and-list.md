# Memo 地基與列表可用性（Phase 0 + 0.5）

- **分支:** `feat/memo-foundation-and-list`
- **日期:** 2026-07-04
- **依據:** `docs/plans/2026-07-03-knowledge-engine-roadmap-design.md` Phase 0 與 Phase 0.5

## 描述

一次做完知識引擎藍圖的前兩個 Phase：**Phase 0（知識庫地基）**解除 50 筆上限、給 memo 加上 title/slug 身分、API 改分頁輕量化；**Phase 0.5（Memo List 可用性）**讓列表在 1,000 筆規模下仍找得到東西——搜尋、tag 篩選、分頁載入、排序、鍵盤操作。兩者連續做的原因：API 改輕量欄位後 SPA 的 quickview／點擊還原立即需要對應改動，拆開會留下壞掉的中間態。

### 方案決策（已與使用者確認）

- **`HISTORY_LIMIT` 改環境變數**，預設 `1000`；文件註明 JSON 全檔重寫的規模特性（規模痛點出現才評估 SQLite，不預先做）。
- **`GET /api/history` 回應改 `{ items, total, all }` 封套**——`total` 為套用 tag 篩選後的總數、`all` 為全庫筆數（計數列「符合 n / 全部 N」在篩選時同時需要兩者）；唯一消費者是自家 SPA 與 demo mock，同分支一次改完。items 為輕量欄位（`id`/`title`/`slug`/`preview`/`tags`/`createdAt`，不含全文）。
- **slug：保留 CJK 的 kebab-case**——從 title 產生（小寫、空白→`-`、去標點、中文字元保留，如 `claude-code-使用心得`）；重複時尾碼 `-2`、`-3`。slug 產生後**穩定不變**（wiki 身分），title 隨編輯重算但 slug 不動。
- **分頁互動：「載入更多」按鈕＋滾到底自動載**（IntersectionObserver），按鈕兼作 fallback；預設每頁 50 筆。
- **舊資料 lazy 補齊**：`history.json` 無需手動遷移——首次載入時發現缺 title/slug 的舊筆記就地補齊並持久化一次（slug 需持久化才穩定）；欄位皆 optional 保持向後相容。
- **全庫搜尋重用 `src/tools.js` 的 `searchMemos()`**——UI 搜尋與 agent 的 `search_memos` 同一套計分，改一處兩邊受益；回傳欄位補 `title`。
- **新增 `GET /api/tags`（重用 `listTags()`）**——小幅超出藍圖明列範圍，理由：既有 tag cloud 的計數來自前端全量資料，分頁後只剩已載入的 50 筆會顯示錯誤計數；`listTags()` 已存在，暴露成端點與 searchMemos 同一「改一處兩邊受益」邏輯。

### 已知取捨（不在本次範圍）

- 搜尋為關鍵字計分（`searchMemos` 現行為），語意搜尋在 Phase 2。
- 排序僅 createdAt 新→舊／舊→新，不做多欄位排序。
- tag 篩選單選（再點取消），不做多 tag 交集。
- `[[wikilink]]`、backlinks 是 Phase 1，本次只鋪 slug 地基。

## 契約檢查（須確認不破壞）

- **tags 格式**：不碰 `/api/format` 的 system prompt 與 `parseTags()`。
- **`__BASE_PATH__`**：SPA 新增的 fetch 一律用既有 `API`/`BASE` 常數組 URL，不新增裸路徑字串。
- **雙套渲染**：permalink（`renderPermalink`）用 `entry.markdown` 全文，不受列表輕量化影響；兩邊樣式互不相碰。
- **Express 路由順序**：`GET /api/history/search` 必須註冊在 `GET /api/history/:id` **之前**（否則 `search` 被 `:id` 吃掉）；`:id` handler 對非數字回 404。
- **demo build**：`mock.js` 同步支援封套、分頁參數、`/:id`、`/search`、`/tags`；`test/demo-data.test.mjs` 一致性維持。
- **agent 工具不受影響**：`search_memos`/`read_memo`/`list_tags` 走 `loadHistory()` 全量，API 輕量化不影響 agent loop。

## 任務清單

### A — store 地基（Phase 0）
- [ ] `HISTORY_LIMIT` 改讀 `process.env.HISTORY_LIMIT`（預設 1000），`insertEntry` 沿用；更新既有上限測試
- [ ] 新增 `deriveTitle(markdown)`：取第一個標題行（`#` 開頭），fallback 第一個非空行
- [ ] 新增 `slugify(title, existingSlugs)`：CJK 保留 kebab-case ＋ `-2`/`-3` 唯一化
- [ ] `createEntry` 產出 `title`/`slug`；`updateEntry` 重算 `title`（slug 不動）
- [ ] `loadHistory` lazy 補齊：發現缺 title/slug 的條目就地補齊並持久化一次
- [ ] store 測試：env 上限、title 推導、slug 唯一化與穩定性、lazy 補齊、舊格式相容

### B — API（Phase 0）
- [ ] `GET /api/history`：支援 `limit`/`offset`/`tag`/`order`（asc|desc，預設 desc），回 `{ items, total, all }` 輕量欄位（total 為套用 tag 篩選後的總數、all 為全庫筆數）
- [ ] `GET /api/history/search?q=&limit=`：重用 `searchMemos`，註冊在 `:id` 之前
- [ ] `GET /api/history/:id`：單篇全文（quickview／還原用），不存在回 404
- [ ] `GET /api/tags`：重用 `listTags()`
- [ ] `searchMemos` 回傳補 `title`
- [ ] endpoint 測試：分頁邊界、tag 篩選、order、單篇 404、search 與 `search_memos` 行為一致性

### C — SPA Memo List（Phase 0.5）
- [ ] `loadHistoryData` 改接封套與分頁狀態；quickview 與點擊還原改走 `GET /api/history/:id` 抓全文
- [ ] 搜尋框（列表頂部）：輸入即過濾已載入項（debounce，比對 title/preview/tags）；Enter 觸發全庫搜尋 API；Esc 清除
- [ ] tag 篩選：列表項上的 tag 可點擊過濾（單選再點取消）；篩選走伺服器 `tag` 參數重查；狀態顯示為搜尋框旁可清除的 chip；tag cloud 計數改接 `GET /api/tags`
- [ ] 分頁載入：底部「載入更多」按鈕＋IntersectionObserver 滾到底自動載
- [ ] 排序切換：新→舊（預設）／舊→新（走 `order` 參數）
- [ ] 鍵盤操作：`/` 聚焦搜尋框（編輯器輸入中不觸發）、`↑`/`↓` 列表移動、Enter 開 quickview、Esc 清除搜尋
- [ ] 計數列：「符合 n / 全部 N」
- [ ] i18n：新增字串補齊 en／zh 兩份

### D — demo 同步
- [ ] `demo/mock.js`：history 路由支援封套＋`limit`/`offset`/`tag`/`order`；新增 `/:id`、`/search`（同 `searchMemos` 計分公式）、`/tags`
- [ ] `test/demo-data.test.mjs` 跨檔一致性維持綠燈

### E — 文件與驗證
- [ ] `.env.sample`／`README.md`／`CLAUDE.md`：補 `HISTORY_LIMIT` 說明與新端點
- [ ] `npm test` 全綠、`npm run smoke` 通過
- [ ] 1,000 筆 seed 手動走查：搜尋／篩選／分頁／鍵盤操作（藍圖驗收條件）
- [ ] dispatch `contract-reviewer` agent 做契約專項把關
