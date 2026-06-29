# 修復長文 format 輸出被截斷且靜默遺失 — Walkthrough

- **分支:** `fix/format-truncation`
- **日期:** 2026-06-29

## 變更摘要

修復長文在 `/api/format` 後被靜默截斷的 bug。根因是 `max_tokens` 寫死 `4096` 且從不檢查 `finish_reason`，導致長輸出被 LLM 中途截斷（連帶最後一行的 tags 消失），使用者卻看不到任何警告。改採「放寬上限 + 截斷警告」：上限提到 32k（`AI_MAX_TOKENS` 可調），並偵測 `finish_reason === 'length'`，截斷時於前端明確警告並提示完整原文已保留在 history。

## 修改的檔案

| 檔案 | 變更 |
|------|------|
| `src/format.js` | **新增**。純解析模組：`parseTags()`（自 `index.js` 搬出）+ 新增 `parseFormatResult(data)`，回傳 `{ markdown, tags, truncated }`。獨立成檔是因 `index.js` 結尾 `app.listen()` 會在測試 import 時啟動 server。 |
| `src/index.js` | 移除 inline `parseTags`，改 `import { parseFormatResult }`；`max_tokens` 由 `4096` 改為 `Number(process.env.AI_MAX_TOKENS) || 32768`；`/api/format` 改用 `parseFormatResult`，回應多帶 `truncated`。 |
| `public/index.html` | `doFormat()` 讀 `data.truncated`：截斷時 `statusText` 顯示持續性 `⚠ Output truncated` + amber `warn` toast；新增 `#toast.warn` CSS（用 `--amber`）。 |
| `test/format.test.mjs` | **新增**。`node --test` 兩案例：`finish_reason: 'stop'`+tags → `truncated:false`；`finish_reason: 'length'`無 tags → `truncated:true`。 |
| `.env.sample` | 新增 `AI_MAX_TOKENS=32768`（含註解）。 |
| `CLAUDE.md` | 環境變數段補 `AI_MAX_TOKENS`；標籤約定段更新 `parseTags()` 位置至 `src/format.js`。 |
| `specs/format-truncation.md` | 規格文件（checklist 已勾選，A–D 完成，E 待真實 API key 驗證）。 |

## 技術細節

- **TDD**：先寫 `test/format.test.mjs`（RED — 模組不存在），再實作 `src/format.js`（GREEN — 2 pass），最後接線 `index.js`。
- **為何抽 `src/format.js`**：要對截斷偵測做純單元測試，但 `index.js` import 即會 `app.listen()`。拆出無副作用的解析模組是最小可測設計，也符合本專案小模組分離的既有結構。
- **資料安全**：`createEntry({ raw: text, ... })` 一直完整保存原始輸入（未改）。即使 markdown 被模型截斷，原文永不遺失；`truncated` 旗標只是讓使用者**知道**截斷發生。
- **雙層上限語意**：`AI_MAX_TOKENS`（預設 32k）是「我們向模型要求的上限」；模型仍可能因自身 output 上限更早截斷。兩種情況都會回 `finish_reason: 'length'` → `truncated:true` → 前端警告，因此即使模型給不到 32k 也不會靜默丟資料。

## 契約檢查（contract-reviewer 確認）

- **tags 格式**：`parseTags` regex 與 system prompt 仍一致，搬檔後邏輯未變 — ✅ 未破壞。
- **`__BASE_PATH__`**：`doFormat()` 用 `${API}/format`，無寫死路徑 — ✅ 未破壞。
- **雙套渲染**：`src/permalink.js` 未被觸及，只動 SPA 的 statusText/toast — ✅ 未破壞。
- **demo build**：`demo/mock.js` 的 `/api/format` mock 不含 `truncated`，前端對 `undefined` 走 falsy 正常顯示「Formatted!」，行為安全（日後若要在 demo 示範截斷警告，需於 mock 補 `truncated: true`）。

## 驗證證據

- `npm test` → **47 passed / 0 failed**（含新增 2 個 format 測試）。
- `npm run build:demo` → 正常（11 permalinks）。
- `node --check src/index.js src/format.js` → 語法 OK。
- 契約 review → 三項全過。
- **待辦**：E 端對端手動驗證需真實 `OPENROUTER_API_KEY` 跑活的 app 後補做。

## 範圍外備註

- 工作目錄有任務前即存在的未追蹤目錄 `backup/`、`temp/`，與本 fix 無關，**未納入 commit**。（可考慮日後加入 `.gitignore`。）
