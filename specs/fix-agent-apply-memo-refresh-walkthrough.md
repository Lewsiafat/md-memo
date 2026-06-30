# 修復：Agent mode 核准 proposal 建立 memo 後，Memo List 未即時刷新 — Walkthrough

- **分支:** `fix/fix-agent-apply-memo-refresh`
- **日期:** 2026-06-30

## 變更摘要

修復 Agent mode 按「✓ 套用」核准 proposal（如 `merge_memos`/`create_memo`）落地後，回到一般模式時 Memo List 不會即時顯示新增 memo、必須重新整理頁面才出現的問題。在 apply 成功分支補上 `loadHistoryData()` 即可。

## 修改的檔案

- `public/index.html` — `renderProposal()` 的 apply handler 在 `POST /api/agent/apply` 成功後補呼叫 `loadHistoryData()`，刷新前端 in-memory `historyData` 快取（+1 行）。
- `specs/fix-agent-apply-memo-refresh.md` — 任務規格（新增）。
- `specs/fix-agent-apply-memo-refresh-walkthrough.md` — 本收尾文件（新增）。

## 技術細節

**根因**：前端 `historyData` 是 in-memory 快取，只在頁面載入、format 存檔、`saveToMemo()`（「存成 memo」）後才呼叫 `loadHistoryData()` 重新拉取 `GET /api/history` 並 re-render。`renderProposal()` 的 apply handler 漏了這一步，只更新按鈕文字與加 permalink 連結，導致 proposal 落地後快取過時——退出 agent mode 看 Memo List 看不到新 memo，重整頁面（重跑 `loadHistoryData()`）才出現。對照組 `saveToMemo()` 有呼叫，所以其 memo 即時可見，正好解釋兩者差異。

**修復**：在 apply 成功分支補 `loadHistoryData()`，與 `saveToMemo()` 一致。所有寫入類 proposal（`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）都會改動 `data/history.json`，套用後一律刷新即可。

**驗證**：
- `npm test` — 50/50 通過、無回歸。
- Playwright 端到端（對 demo build）：套用 merge proposal → **未 reload** 退出 agent mode → Memo List 由 10 筆變 11 筆、badge 更新、最上筆為新合併的「Side Project 進度總覽」。
- Negative control（同腳本、停用修復那行）：套用後仍停在 10 筆、最上筆為舊 memo，精準重現原 bug，證實修復的因果。

**契約檢查**：純前端、只新增一個函式呼叫，與三個隱性契約（tags 格式 / `BASE_PATH` / 雙套渲染）無關。
