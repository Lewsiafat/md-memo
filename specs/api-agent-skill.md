# md-memo API Agent Skill — 讓 AI agent 透過 REST API 操作 md-memo

- **分支:** `feat/api-agent-skill`
- **日期:** 2026-07-14

## 描述

建立一個 Claude Code skill（比照 proj-kanban-api 的成功模式），讓 AI agent 能透過 curl/HTTP 直接操作 md-memo 的 REST API——讀寫 memo、驅動 agent 端點——不經過網頁 UI。skill 放在 repo 內 `.claude/skills/md-memo-api/`，隨版本控管，開源使用者 clone 即有；並附安裝說明（copy/symlink 到 `~/.claude/skills/`）讓其他專案的 session 也能觸發。

### 涵蓋範圍（全部 10 個端點）

| 類別 | 端點 | 備註 |
|------|------|------|
| AI 格式化 | `POST /api/format` | 需 `OPENROUTER_API_KEY`；body 帶 `id` 時覆蓋既有筆記；回 `truncated` 旗標 |
| Memo CRUD | `GET /api/history` | 唯一的讀取端點，回傳全部（上限 50 筆） |
| | `PUT /api/history/:id` | 原樣覆蓋 markdown/tags，不跑 LLM |
| | `DELETE /api/history/:id` | 冪等：不存在的 id 也回 `{ok:true}` |
| | `POST /api/history/clear` | 要求 JSON content type（CSRF 防護）；自動備份成帶時間戳的 `.bak.json` |
| Agent | `POST /api/agent` | **SSE 串流**（start/message/tool_call/tool_result/proposal/answer/done/error） |
| | `POST /api/agent/apply` | 兩段式：agent 只 emit proposal，需再呼叫 apply 才落地 |
| Sessions | `GET/POST /api/sessions`、`DELETE /api/sessions/:id` | 已存 agent session 的列出／儲存／刪除 |
| 永久連結 | `GET /m/:id` | 回 HTML（非 JSON）；`AUTH_ENABLED` 時唯一公開的路徑 |

### 交付結構（比照 proj-kanban-api）

```
.claude/skills/md-memo-api/
├── SKILL.md              # 操作指南：base URL/config、task→endpoint 對照表、
│                         # id 解析模式、常見 workflow、footguns、pre-flight checklist
└── references/
    └── api.md            # 逐端點完整契約：request/response JSON、所有 status code、
                          # 預設值、SSE 事件格式、可複製貼上的 curl
```

### 必寫的 footguns（已從程式碼逐一確認）

- **`HISTORY_LIMIT = 50`**——新增第 51 筆會靜默擠掉最舊的一筆，無警告（`src/store.js` `insertEntry`）。
- **BASE_PATH subpath 是 load-bearing**——API 只掛在 `/${BASE_PATH}/api` 下（預設 `/md-memo`），打錯路徑回 404 或 HTML。
- **agent 是 SSE**——curl 要用 `-N`（關 buffering）；寫入工具（create/merge/link/retag）只 emit `proposal` 事件，必須把 proposal 的 `{action, args}` 原樣 POST 到 `/api/agent/apply` 才會落地。
- **`PUT /history/:id` 的 null/省略 vs 空字串**——`updateEntry` 用 `!= null` 判斷：省略或 `null` 保留原值，`""` 是真值會覆蓋。
- **`POST /api/history/clear` 要求 `Content-Type: application/json`**，否則 415；成功時自動備份，回 `{ok, backedUp, count, backupFile}`。
- **`DELETE /history/:id` 冪等**——不存在的 id 也回 `{ok:true}`，無法靠回應判斷是否真的刪了；先 `GET /api/history` 確認。
- **`AUTH_ENABLED=true` 時全站要 Basic Auth**（`curl -u any:$PASSWORD`，username 忽略），唯 `/m/:id` 公開。
- **`POST /api/format` 帶 `id` 是覆蓋模式**——誤帶 id 會覆蓋既有筆記而非新建；`truncated:true` 表示模型輸出被截斷。
- **id 是 Date.now() 基底的毫秒時間戳**——不要猜 id，一律先 `GET /api/history` 解析（cardinal pattern，同 proj-kanban）。
- **merge/link 會驗證 source ids 存在，retag 驗證單一 id**——apply 失敗回 400 `{ok:false, error}`。

### 不做的事（scope 之外）

- 不改動 server 程式碼（`src/`）——純新增 skill 文件。
- 不建 evals/test-bench（proj-kanban-api-workspace 那套不在此次範圍）。
- 不處理 demo site（GitHub Pages 靜態版）的 mock API 差異——skill 只針對真 server。

## 任務清單

- [x] 建立 `.claude/skills/md-memo-api/SKILL.md`：frontmatter（name、description 含觸發詞）、base URL/config 說明（PORT/BASE_PATH/AUTH_ENABLED）、task→endpoint 決策表、id 解析 cardinal pattern、常見 workflow（建立筆記、AI 格式化、改標籤、agent 兩段式 propose→apply）、footguns、pre-flight checklist
- [x] 建立 `.claude/skills/md-memo-api/references/api.md`：10 個端點的完整契約（request/response JSON、status codes、預設值、SSE 事件格式與範例、每個端點可複製的 curl）
- [x] 對照原始碼驗證文件正確性：`src/index.js`（路由）、`src/store.js`（entry 形狀、limit）、`src/tools.js`（proposal/apply 契約）、`src/agent.js`（SSE 事件）、`src/sessions.js`、`src/auth.js`
- [x] 實際起 server 用 curl 逐端點煙霧測試，確認文件中的 curl 範例可直接複製執行（agent 端點若無 API key 則驗證錯誤路徑）——18 項檢查全過（含 415/404/冪等 DELETE/SSE 內嵌 error/50 筆驅逐）
- [x] 在 skill 或 README 加入安裝說明：如何 copy/symlink 到 `~/.claude/skills/` 供其他專案使用（README「AI Agent Skill」段）
- [x] 更新 `CLAUDE.md` 提及 skill 的存在與位置（一兩行即可）

### 驗證紀錄（TDD for docs：RED → GREEN → 應用測試）

- **RED（無 skill 基準）**：subagent 盲操作需 6 次呼叫（含抓 SPA HTML 逆向 API 地圖），且對 PUT 形成錯誤心智模型（以為整筆覆蓋，實為 omit/null-preserve 部分更新）。
- **GREEN + 應用測試（帶 skill）**：同場景 4 次呼叫（理論最少值）全數成功，只讀 SKILL.md 未開 references；兩題 footgun 檢索題（50 筆驅逐、DELETE 冪等）全對。
- **REFACTOR**：依 subagent 回饋在 SKILL.md 補 PUT 回應 echo 整筆 entry、bad id → 404 兩行。
