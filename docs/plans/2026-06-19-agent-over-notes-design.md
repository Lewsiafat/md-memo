# Agent over Notes — 設計文件

- **日期**：2026-06-19
- **分支**：`feat/agent-over-notes`
- **目標脈絡**：作為求職作品，向 hiring manager 展示 **agentic / 工具編排** 工程能力（agent loop、native function calling、對真實資料的多步操作、即時 reasoning trace）。

## 1. 概要

在 md-memo 既有的「AI 格式化」之上，新增一個對**整個筆記庫**做多步推理的 agent。使用者在聊天面板輸入指令，agent 會：規劃 → 呼叫工具（搜尋／讀取／建立／合併／連結／重設標籤）→ 綜合結果，全程以**即時 reasoning trace** 串流到前端。寫入動作採 **human-in-the-loop**：agent 只產生提案，使用者確認後才落地。

### 定位（一句話）

> 自己打造 agent loop，用原生 `fetch` 打 OpenRouter 的 function calling，**零框架、零新依賴**。

## 2. 關鍵設計決定

| 決定 | 理由 |
|------|------|
| **Hand-built loop，不用 LangChain/LlamaIndex/AI SDK** | Agent loop 的核心（迴圈、tool-call 解析與分派、message 累積、max-steps、讀寫分流）正是框架包掉、面試最愛問的那層。手刻證明懂內部機制；也守住專案「單一依賴、無 build」的調性。loop 約 60–80 行，獨立成 `src/agent.js`，工具集為純資料定義——結構本身傳達「需要時可無痛換框架」。 |
| **原生 function calling（OpenRouter `tools`）** | 業界標準、JD 高頻關鍵字。需 tool-capable 模型。 |
| **SSE frame over POST fetch stream** | `EventSource` 只能 GET、不能帶 body，故用 `POST` + `fetch().body.getReader()` 讀 `event:/data:` frame。同時展示懂 SSE 協定與 streaming fetch。 |
| **讀即時執行、寫先提案後確認** | mutating tools 全走確認閘門。後端**無狀態**（不在記憶體卡住暫停的 loop）。更好的工程敘事。 |
| **純關鍵字 search，不用 embeddings** | 語意搜尋是另一條（RAG）能力線；agent 的價值在多步編排不在檢索演算法。誠實用 keyword。 |
| **刻意不給 `delete_memo`** | 讓 agent 能刪是 demo 負分（風險 > 價值）。「知道哪些能力不該給 agent」是加分判斷。 |

## 3. 架構與資料流

### 3.1 Endpoints（皆掛 `BASE_PATH` 下）

| Endpoint | 作用 |
|----------|------|
| `POST /api/agent` | 跑 agent loop，回傳 SSE 串流 |
| `POST /api/agent/apply` | 執行一個被確認的寫入提案 `{ action, args }` |
| `POST /api/agent/undo`（選配，Phase 1.5） | 用快照還原上一個 apply |

### 3.2 SSE 事件協定

```
start        → run 開始
message      → assistant 推理文字
tool_call    → { name, args }
tool_result  → { result }        （讀取類工具回傳）
proposal     → { action, args, summary }  （寫入提案，待 confirm）
answer       → 最終答案（markdown）
done         → { steps, tokens, ms }
error        → { message }
```

### 3.3 Agent loop（`src/agent.js`）

```js
async function runAgent(message, emit) {
  const messages = [SYSTEM, { role: 'user', content: message }];
  for (let step = 0; step < MAX_STEPS; step++) {   // MAX_STEPS ≈ 8
    const res = await callOpenRouter(messages, TOOLS);
    const msg = res.choices[0].message;
    if (!msg.tool_calls?.length) { emit('answer', msg.content); return; }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      emit('tool_call', { name: tc.function.name, args: tc.function.arguments });
      const result = await dispatchTool(tc, emit);   // read→執行 / write→提案
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }
  }
}
```

### 3.4 模型設定

新增 `AGENT_MODEL` env（預設用 tool-capable 模型，fallback 到 `AI_MODEL`）。`/api/format` 維持不動。

## 4. 工具集合約

### 讀取類（loop 內即時執行）

- **`search_memos`** `{ query, limit=5 }` → `[{ id, preview, tags, snippet, createdAt }]`。對 `raw + markdown + tags` 做關鍵字評分（命中次數 + 標題加權）。
- **`read_memo`** `{ id }` → `{ id, markdown, tags, links, createdAt }`；找不到回 error 餵回模型。
- **`list_tags`** `{}` → `[{ tag, count }]`。

### 寫入類（只產生 proposal，confirm 後落地）

- **`create_memo`** `{ markdown, tags }` → apply 時建立新 entry。
- **`merge_memos`** `{ source_ids, markdown, tags, title }` → 綜合內容由 agent 在 loop 內產出；apply 建立新 entry 並記 `sources`，原文不刪。
- **`link_memos`** `{ ids }` → apply 時對每篇寫入互指的 `links`。
- **`retag_memo`** `{ id, tags }` → apply 時取代該篇標籤。

### 資料模型變更（向後相容，欄位皆 optional）

```js
{
  id, createdAt, raw, markdown, tags, preview,  // 原有
  links:   [number],   // ← link_memos
  sources: [number],   // ← merge_memos 出處
}
```

`history.sample.json` 不需修改。

### 派工

`src/agent.js` 一張表：tool name → `{ kind: 'read'|'write', handler }`。`read` 執行並 `emit('tool_result')`；`write` 不執行，`emit('proposal')` 並回模型「已交付使用者確認」。

## 5. 前端（agent 面板）

- 頂部新增 `🤖 Ask` 切換鈕（與 dark/light 同列），切到第三個模式：對話 + trace 視圖。不動現有編輯流程。
- 事件 → UI：`message`=推理 bubble；`tool_call`=工具 pill；`tool_result`=摺疊結果；`proposal`=確認卡 `[✓ 套用][✗ 略過]`；`answer`=`.md-render` 渲染；`done`=步數/tokens/耗時 footer；`error`=紅條。
- 串流：`fetch` + `body.getReader()` + `TextDecoder`，以 `\n\n` 切 frame。
- 確認卡：`[✓ 套用]` → `POST /api/agent/apply`，成功後若是 create/merge 附 permalink；`[✗ 略過]` 純前端忽略。
- **約束**：所有路徑用 `__BASE_PATH__` placeholder；答案區重用 `.md-render`，不另開第三套 CSS。

## 6. 錯誤處理

| 情境 | 處理 |
|------|------|
| 無 `OPENROUTER_API_KEY` | 同現況 500 |
| 模型不支援 tools / OpenRouter 4xx-5xx | `emit('error')` 收尾，前端紅條 |
| tool args 不合 schema | 驗證 → 錯誤訊息當 `tool_result` 餵回模型重試（自我修復） |
| 工具執行錯（如 id 不存在） | 回 error 給模型，不中斷 run |
| 達 `MAX_STEPS` 未收斂 | `emit('answer')` 附「N 步內未完成」+ 部分結果 |
| 串流中斷 / 離開 | 前端 `AbortController`；後端偵測 `res.writableEnded` 提早停 |
| `/apply` 提案 id 已不存在 | 回 400，卡片標「來源已變動」 |
| JSON 並發寫入 | 沿用現有同步 load-modify-save |

## 7. 驗證 / 測試

不引入測試框架（守 surgical）。

1. **Smoke script** `scripts/smoke-agent.mjs`（純 node）：對 sample history 跑固定 prompt，斷言「≥1 個 `tool_call`」「有 `done`」「無 `error`」。
2. **手動 e2e**：用 playwright 跑完整 demo（搜尋 → 提案 → 套用 → permalink），截圖留證。

**成功標準**：
- 問句類「我寫過關於 X 的筆記嗎？」→ agent search + read + 帶引用答案。
- 動作類「把這週的會議筆記合併」→ 出現 merge 提案，套用後產生帶 `sources` 的新筆記。

## 8. 非範圍 / Phase 2

**不做（YAGNI）**：embeddings/語意搜尋、多 agent、`delete_memo`、token 逐字串流、persisted run log、eval harness、undo（列選配）。

**Phase 2（成長路徑，延伸 observability/evals 能力線）**：`data/runs.json` 持久化每次 run + `/runs` 回放頁 + `npm run eval` 固定題組評測。
