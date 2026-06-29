# 修復長文 format 輸出被截斷且靜默遺失

- **分支:** `fix/format-truncation`
- **日期:** 2026-06-29

## 描述

修復「長文字內容在 format 後被截斷遺失」的 bug。根因是 `src/index.js` 的 `/api/format` 對 OpenRouter 寫死 `max_tokens: 4096`：當模型輸出的 markdown 超過上限就會被截斷（回傳 `finish_reason: "length"`），而程式碼從未檢查 `finish_reason`，把截斷後的內容當成功結果存進 history、回前端，使用者畫面上看到被砍掉一截且**毫無警告**的結果。

採「**放寬上限 + 截斷警告**」策略：把人為上限放寬（並提供 env 可調），同時偵測 `finish_reason === 'length'`，截斷時於前端明確警告、提示完整原文已保留在歷史紀錄。

### 根因細節

- `src/index.js:74` `max_tokens: 4096` 為固定上限。
- `src/index.js:85-92` 取 `data.choices?.[0]?.message?.content` 後未讀 `finish_reason`，直接 `parseTags` → 存 history → 回前端。
- 截斷時，要求模型放在**最後一行**的 `<!-- tags: ... -->` 尚未輸出 → `parseTags()` 抽不到標籤，且內容尾段消失。
- 前端 `public/index.html:769` `doFormat()` 拿到截斷版 `currentMarkdown`，按 Edit（`:825`）會以截斷版覆蓋輸入框。
- **資料層未真正遺失**：原始輸入以 `raw: text` 完整存入 history（`src/index.js:90`）；損失僅在 markdown 輸出與畫面顯示。

### 方案決策（已與使用者確認）

- **策略：放寬上限 + 截斷警告**（非「只放寬上限」，亦非「自動續寫／分段」）。
- **上限：** `max_tokens` 改為預設 `32768`（32k），並新增 `AI_MAX_TOKENS` env 可調（沿用本專案以 env var 暴露所有可調設定的慣例）。預設值的提高即為主要修復；env 為操作者調節極長筆記的旋鈕。
- **截斷偵測：** 後端讀 `finish_reason`，於回應 JSON 多帶 `truncated: boolean`。
- **使用者提示：** 截斷時前端在 `statusText` 顯示持續可見的警告，並跳一則 `warn` toast 提示「完整原文已保留在歷史紀錄」；未截斷維持原行為。

### 已知取捨（簡單優先，不在本次範圍）

- **不做自動續寫/分段 format**：與此輕量工具定位不符；極長文先靠調高 `AI_MAX_TOKENS` 因應，真有需求再於未來迭代。
- 提高後的上限仍是上限；超過時行為定義為「截斷並警告」，而非無限長。
- 截斷時通常抽不到 tags（tags 行在最後一行未輸出）→ 該筆無標籤，屬預期行為。

## 契約檢查（須確認不破壞）

- **tags 格式**：`parseTags()` 與 `/api/format` 的 system prompt 皆不改格式 → 跨前後端 tags 契約不破。
- **`__BASE_PATH__`**：不在 `index.html` 新增任何路徑相關字串。
- **雙套渲染**：permalink (`renderPermalink`) 完全不動；只改 SPA 的 `doFormat()` 與新增一個 toast 樣式。
- **demo build**：`demo/mock.js` 攔 `/api/format` 回預錄 JSON，無 `truncated` 欄位 → 前端讀到 falsy → 不顯示警告，安全；`build-demo.mjs` / `mock.js` 不需改。

## 任務清單

### A — 後端（`src/index.js`）
- [x] `max_tokens` 改讀 `Number(process.env.AI_MAX_TOKENS) || 32768`
- [x] 抽出可測試純函式 `parseFormatResult(data)`（內部呼叫現有 `parseTags`，並讀 `choices[0].finish_reason`），回 `{ markdown, tags, truncated }`，`export` 供測試（放在新檔 `src/format.js`，因 `index.js` 結尾 `app.listen()` 不利測試 import）
- [x] `/api/format` 改用 `parseFormatResult`，`res.json` 多帶 `truncated`（history 仍存完整 `raw`，行為不變）

### B — 前端（`public/index.html`）
- [x] `doFormat()`：`data.truncated` 為真時 → `statusText` 顯示 `⚠ Output truncated` + `warn` toast「Output truncated — original kept in history」；非截斷維持 `✓ Formatted`
- [x] 新增 `.warn` toast CSS（amber，比照 `.success`/`.error` 既有樣式）

### C — 測試
- [x] 新增 `test/format.test.mjs`（`node --test`）測 `parseFormatResult`：
  - [x] `finish_reason: 'stop'` + 含 `<!-- tags: ... -->` → `truncated:false`、tags 正確、markdown 已移除 tags 行
  - [x] `finish_reason: 'length'`（內容尾段缺、無 tags 行）→ `truncated:true`、tags 為空、markdown 為已得內容
- [x] `npm test` 全綠（47 passed）

### D — 設定與文件
- [x] `.env.sample`：在 `AI_MODEL` 後新增 `AI_MAX_TOKENS=32768`（含註解：format 輸出上限、調高以容納更長筆記）
- [x] `CLAUDE.md` 環境變數段：補 `AI_MAX_TOKENS`（預設 32768，`/api/format` 用）+ 標籤約定段更新 `parseTags()` 位置至 `src/format.js`

### E — 手動驗證（尚未執行，需真實 `OPENROUTER_API_KEY` 跑活的 app）
- [ ] 貼一段先前會超過 4096 上限的長文 → format 完整不截斷、無警告
- [ ] 以超長文（或暫時調低 `AI_MAX_TOKENS`）觸發截斷 → 出現截斷警告、`statusText` 持續顯示、history 中該筆 `raw` 為完整原文

> 註：核心解析邏輯（`parseFormatResult` 的截斷偵測）已由 `test/format.test.mjs` 單元測試涵蓋並通過；E 為端對端的真實模型驗證，需有 API key 時補跑。
