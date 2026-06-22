# Agent over Notes — Walkthrough

- **分支:** `feat/agent-over-notes`
- **日期:** 2026-06-22

## 變更摘要

為 md-memo 新增一個對整個筆記庫做多步推理的 **agent**：使用者在 🤖 聊天面板下指令，agent 用 OpenRouter 原生 function calling 自行規劃、呼叫工具（搜尋／讀取／建立／合併／連結／重設標籤），全程以 **即時 SSE reasoning trace** 串流到前端。讀取類工具即時執行、寫入類工具一律先出 **proposal** 由使用者確認後才落地（human-in-the-loop）。loop 為 hand-built、無框架、零新依賴。

## 修改的檔案

**新增**
- `src/store.js` — 從 index.js 抽出的共用 history 持久化層（`loadHistory`/`saveHistory`/`createEntry`/`insertEntry`），路徑可由 `HISTORY_FILE` 覆寫以利測試。
- `src/tools.js` — 7 個工具的 JSON schema、`TOOL_KIND` 讀寫分類表、讀取 handler（`searchMemos`/`readMemo`/`listTags`）、寫入 proposal builder 與 `applyProposal`（create/merge/link/retag，含 id 驗證）。
- `src/agent.js` — hand-built agent loop：`callOpenRouter`（讀 `AGENT_MODEL`、`AGENT_LANG`）、`runAgent`（注入式 `callModel`、`MAX_STEPS=8`、讀即時執行／寫出 proposal、emit SSE 事件）。
- `scripts/smoke-agent.mjs` — 用假 model 的零 API key 整合 smoke。
- `test/store.test.mjs`、`test/tools.test.mjs`、`test/agent.test.mjs` — node:test 單元測試（共 19 個）。
- `docs/plans/2026-06-19-agent-over-notes-design.md` — 設計文件。
- `docs/superpowers/plans/2026-06-19-agent-over-notes.md` — 逐 task TDD 實作計畫。

**修改**
- `src/index.js` — 改用 `store.js`；新增 `POST /api/agent`（SSE）與 `POST /api/agent/apply` 路由；既有 `/api/format`、`/api/history`、`/m/:id`、DELETE 路由與 `parseTags` 維持不變。
- `public/index.html` — 🤖 切換鈕、agent 面板（輸入框釘底 + 獨立可捲的 reasoning trace）、SSE client（`fetch().body.getReader()`）、確認卡。路徑全用 `__BASE_PATH__`。
- `package.json` — 新增 `test`（`node --test`）與 `smoke` script。
- `.env.sample` / `README.md` / `CLAUDE.md` — 文件化 `AGENT_MODEL`（預設 `deepseek/deepseek-v4-pro`）與 `AGENT_LANG`（預設 `zh-TW`）。

## 技術細節

- **無框架的 agent loop**：刻意不用 LangChain/AI SDK，手刻約 60–80 行的 loop（規劃、tool-call 解析與分派、message 累積、max-steps 防護、讀寫分流），以展示對 agent 內部機制的掌握並守住「單一依賴」的專案調性。
- **讀寫分離的安全模型**：讀取類工具在 loop 內即時執行並把結果餵回模型；寫入類工具不在 loop 內 mutate，只 emit `proposal`，由 `POST /api/agent/apply` 在使用者確認後執行。後端因此無狀態（不需在記憶體卡住暫停的 loop）。刻意**不提供 `delete_memo`**。
- **SSE over POST fetch**：因 `EventSource` 只能 GET、不能帶 body，改用 `POST` + `fetch().body.getReader()` 讀 `event:/data:` frame。
- **可測試性**：`runAgent` 的 `callModel` 可注入，單元測試與 smoke 都用假 model，無需 API key、可離線、可進 CI。資料模型新增 optional `links`/`sources` 兩欄、向後相容。
- **資料驗證**：`applyProposal` 對 merge/link/retag 的目標 id 做存在性檢查，不存在回 `{ok:false}`，路由轉成 HTTP 400。
- **設定**：`AGENT_MODEL` 必須支援 tool calling（fallback 到 `AI_MODEL`）；`AGENT_LANG`（BCP-47，預設 zh-TW）注入 system prompt，規範 agent 的推理與寫入內容語言。
- **驗證紀錄**：`node --test` 19/19 通過；`npm run smoke` 通過；用 deepseek-v4-pro 跑過真實 LLM e2e（讀取 Q&A、合併提案→套用→permalink、自我修復 id 皆正常），並以 Playwright 驗證輸入框釘底與 trace 溢出捲動。
