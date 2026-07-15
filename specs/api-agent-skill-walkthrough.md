# md-memo API Agent Skill — Walkthrough

- **分支:** `feat/api-agent-skill`
- **日期:** 2026-07-15

## 變更摘要

比照 proj-kanban-api 的模式建立 `md-memo-api` Claude Code skill，讓 AI agent 能以 curl/HTTP 直接操作 md-memo 的全部 10 個 REST 端點（不經網頁 UI），涵蓋 SSE agent 串流與 propose→apply 兩段式寫入。skill 放在 repo 內 `.claude/skills/`，本專案自動可用，其他專案以 symlink 安裝。所有文件內容均對照原始碼撰寫，並經隔離測試 server 的 18 項 curl 煙霧測試與前後對照的 subagent 實測驗證。

## 修改的檔案

| 檔案 | 說明 |
|------|------|
| `.claude/skills/md-memo-api/SKILL.md` | 新增。操作指南：base URL/config、task→endpoint 決策表、id 解析 pattern、常見 workflow、10 條 footguns、pre-flight checklist |
| `.claude/skills/md-memo-api/references/api.md` | 新增。逐端點完整契約：request/response JSON、所有 status codes、SSE 事件形狀、apply 四種 action 語意、可複製 curl |
| `README.md` | 新增「AI Agent Skill」段：skill 簡介與 symlink 安裝說明 |
| `CLAUDE.md` | Agent 段下補記 skill 位置與維護契約：改 API 必須同步更新 skill 兩檔 |
| `specs/api-agent-skill.md` | 新增。任務規格（/task 產出），清單已全數勾銷並附驗證紀錄 |

## 技術細節

### 驗證方法：TDD for docs（writing-skills 流程）

- **RED（無 skill 基準）**：subagent 只給 app URL、禁讀原始碼，完成 4 個任務需 6 次 HTTP 呼叫——先抓 73KB 的 SPA HTML 逆向出 API 地圖才能動手，且對 `PUT /api/history/:id` 形成錯誤心智模型（以為整筆覆蓋，實為 omit/null-preserve 的部分更新）。
- **GREEN（帶 skill 應用測試）**：同場景 4 次呼叫（理論最少值）全數成功，只讀 SKILL.md 未開 references；兩題 footgun 檢索題（50 筆驅逐、DELETE 冪等）引用正確段落作答。
- **REFACTOR**：依 subagent 回饋在 SKILL.md 補兩行——PUT 成功回應 echo 整筆 entry（可省驗證 GET）、PUT 對不存在 id 回 404（不像 format 會靜默新建）。
- **煙霧測試**：隔離 server（`HISTORY_FILE`/`SESSIONS_FILE` 指到 temp、port 10099）跑 18 項檢查全過，含 415/404/冪等 DELETE/SSE 內嵌 error 事件/塞 55 筆驗證驅逐到 50。

### 撰寫時從原始碼確認的非顯而易見行為（皆已寫入文件）

- **沒有 `POST /api/history`**——不經 LLM 的原樣建立走 `POST /api/agent/apply` 的 `create_memo`（前端「存成 memo」按鈕即用此路徑）。
- **`POST /api/format` 帶不存在的 id 不回 404**，靜默 fall through 建新筆記（`src/index.js` 的 `if (!entry) entry = insertEntry(...)`）。
- **agent 端點的錯誤在 SSE 流內**——HTTP 一律先回 200，缺 API key 等錯誤以 `event: error` 事件出現，不能靠 status code 判斷。
- **50 筆上限靜默驅逐**——所有建立路徑（format 新建、create_memo、merge_memos）在滿載時無警告丟棄最舊一筆。
- 錯誤 envelope 有三種形狀（`{error}`、`{ok:false,error}`、純文字/HTML），文件明確列出避免呼叫端假設單一格式。

### 設計決策

- **語言**：SKILL.md 與 api.md 用英文，比照 proj-kanban-api 的成功前例（利於 keyword 觸發與 token 效率）；規格與 walkthrough 維持繁中。
- **位置**：repo 內 `.claude/skills/`（隨版本控管、clone 即有），而非 user-level——維護契約寫進 CLAUDE.md，API 變更時同步改 skill。
- **不做**：不改 `src/`（純文件任務）、不建 evals/test-bench、不處理 demo site 的 mock API 差異。
