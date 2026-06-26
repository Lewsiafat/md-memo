# Agent Mode P2 — UX 改善 — Walkthrough

- **分支:** `feat/agent-mode-p2-ux`
- **日期:** 2026-06-26

## 變更摘要

md-memo P2 一批 UI/UX 改善，全部集中在 `public/index.html`（SPA 內嵌 HTML/CSS/JS），不碰後端、不新增依賴。Agent Mode 三項：送出後中央顯示 thinking 動畫、送出後清空輸入框、右欄新增「送出紀錄」；Normal Mode 一項：把 agent 按鈕改成帶標籤的 accent 框按鈕以提升能見度。

## 修改的檔案

- **`public/index.html`**（+57/−3）— 四項改善全部在此：
  - CSS：新增 `.btn-agent`（accent 框按鈕）、`.ag-thinking` / `.ag-dots` 與 `@keyframes ag-bounce`（脈動點動畫）。
  - markup：`#agentToggle` 由透明 `.btn-icon`「🤖」改為 `.btn .btn-agent`「🤖 Agent」；`#agentExamples` 內新增「送出紀錄」head + `#agentSubmitList`。
  - JS（agent IIFE）：新增 `showThinking()`/`hideThinking()` 與 `thinkingEl` 狀態、送出紀錄的 localStorage 讀寫與 `addSubmit()`/`renderSubmitHistory()`；`run()` 與 `renderEvent()` 接上 thinking 生命週期、清空輸入、記錄送出。
- **`specs/agent-mode-p2-ux.md`**（new）— 任務規格與逐項 checklist（已全數打勾）。
- **`specs/agent-mode-p2-ux-walkthrough.md`**（new）— 本文件。

## 技術細節

**A1 — Thinking 動畫**
`run()` 送出當下（`await fetch` 之前）先 `trace.innerHTML=''` 並 `showThinking()`，補掉送出到首個 SSE event 之間的空白。`renderEvent()` 的 `start` 事件清空後重新顯示；每次 append 內容後若仍在執行就把 `thinkingEl` 重新 append 到底部（保持殿後）；`done`/`error` 事件與 `run()` 的 `finally` 都會 `hideThinking()`，確保串流結束（即使 trace 未含 done）也會移除。`.ag-thinking` 用 `margin: auto 0` 在只剩自己時垂直置中，符合「中央顯示」需求。

**A2 — 清空輸入框**
`run()` 擷取 `message` 並通過非空驗證後立即 `input.value=''`；空字串（trim 後）維持原本的 early return，不清不送。

**A3 — 送出紀錄（localStorage 持久）**
key `mdmemo_agent_submits`，`addSubmit()` 去重 + newest-first + 上限 12 筆。刻意與左欄「已存 session」區隔：session 是完整 agent run（存後端），送出紀錄只是打過的 prompt 文字（純前端、輕量）。清單複用 `.ag-example-item` 樣式，點擊回填輸入框並 focus。

**N1 — Agent 按鈕能見度**
新增 `.btn-agent`（`#6c5ce714` 淺底 + accent 色框 + accent 字）做為 `.btn` 的 modifier，比純 icon 明顯但不蓋過 `✨ Format` 主 CTA。

## 契約與驗證

- 三個跨檔契約皆未受影響：無新增路徑字串（不碰 `__BASE_PATH__`）、不碰 tags 格式 / `parseTags()`、不碰 permalink 渲染。
- 改動自動流入 `npm run build:demo`（demo mock 重播 SSE 仍走同一 `renderEvent`，thinking 動畫相容）。
- `npm test` → 35 passed / 0 failed；`npm run build:demo` → 成功。
- Playwright 實機驗證（用 demo mock 重播真實 SSE trace，約 7.8s）：thinking 於 run 中顯示、`done` 後移除；輸入框送出後清空；送出紀錄記錄、重整後保留、點擊回填；agent 按鈕 desktop/mobile 皆明顯。
