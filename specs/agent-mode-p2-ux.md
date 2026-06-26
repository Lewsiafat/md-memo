# Agent Mode P2 — UX 改善

- **分支:** `feat/agent-mode-p2-ux`
- **日期:** 2026-06-26

## 描述

md-memo P2 一批 UI/UX 改善，集中在 Agent Mode 的互動體驗，外加一項 Normal Mode 的 agent 按鈕能見度調整。全部只動 `public/index.html`（SPA 內嵌 HTML/CSS/JS），不碰後端、不碰 permalink 渲染、不新增依賴。

四項改善：

**Agent Mode**
1. 送出後在中央顯示 loading/thinking 動畫，補掉目前送出到首個 SSE event 之間的空白畫面。
2. 送出後自動清空輸入框。
3. 右欄「範例」清單下方新增「送出紀錄」，記錄送出過的 prompt 文字（localStorage 持久），點擊可回填輸入框。

**Normal Mode**
4. 讓 agent 按鈕更顯眼——改為帶標籤的「🤖 Agent」按鈕，accent 色框 + 淺色底。

## 契約檢查（不受影響，但需確認）

- **`__BASE_PATH__`**：本次改動無新增任何路徑/URL 字串（送出紀錄走 localStorage，非 fetch），不涉及 base path。
- **tags 格式**：不碰 `/api/format` 或 `parseTags()`。
- **雙套渲染**：全部改動在 SPA，不碰 `renderPermalink`。
- **demo build**：改動自動流入 `npm run build:demo`（mock 重播 SSE 仍走同一 `renderEvent`，thinking 動畫相容）。

## 任務清單

### A1 — Thinking 動畫
- [x] CSS：新增 `.ag-thinking`（置中 flex）與脈動點動畫 `@keyframes`（或復用 `.spinner` 風格），含「思考中…」字樣
- [x] `run()` 送出當下先 `trace.innerHTML=''` 並插入 thinking 指示器（不等 fetch 回應）
- [x] `renderEvent()`：`start` 事件清空後重新顯示 thinking；串流期間 thinking 固定在 trace 底部；`done`/`error` 時移除
- [x] 驗證：送出後立即看到動畫；事件串流進來後動畫仍在底部；結束後消失

### A2 — 清空輸入框
- [x] `run()` 擷取 `message` 並通過非空驗證後，加 `input.value = ''`
- [x] 驗證：送出後輸入框清空；空字串送出（trim 後為空）不清、不送

### A3 — 送出紀錄（localStorage 持久）
- [x] DOM：`#agentExamples` aside 內、`#agentExampleList` 下方新增「送出紀錄」head + `#agentSubmitList`（空狀態文案）
- [x] JS：load/save localStorage helper；`addSubmit(msg)` 去重、newest-first、上限 12 筆並重繪
- [x] JS：`renderSubmitHistory()` 仿 `renderExamples()`，點擊項目回填 `input.value` 並 focus
- [x] `run()` 通過驗證後呼叫 `addSubmit(message)`
- [x] CSS：複用 `.ag-example-item` 樣式（必要時微調第二個 `.ag-side-head` 的 sticky 行為）
- [x] 驗證：送出後右欄出現該筆；點擊回填輸入框；重整頁面後仍保留

### N1 — Agent 按鈕顯眼
- [x] markup：`#agentToggle` 由 `class="btn-icon"`、內容 `🤖` 改為帶標籤 `🤖 Agent`、accent 配色 class
- [x] CSS：新增 `.btn-agent`（accent 色框 + 淺 accent 底 + accent 字、`font-weight:600`），hover 加深；不蓋過 `✨ Format` 主 CTA
- [x] 驗證：topbar 中 agent 按鈕明顯可辨；點擊仍正常進/出 Agent Mode

### 整體驗證
- [x] `npm test` 全綠（前端改動不應影響既有測試）
- [x] `npm run build:demo` 成功，demo bundle 正常
- [x] 手動／playwright：dark + light theme 下四項皆正常；mobile 寬度（≤700px）右欄送出紀錄不破版
