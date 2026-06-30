# 修復：Agent mode 核准 proposal 建立 memo 後，Memo List 未即時刷新

- **分支:** `fix/fix-agent-apply-memo-refresh`
- **日期:** 2026-06-30

## 描述

在 Agent mode 按「✓ 套用」核准 proposal（例如 `merge_memos`/`create_memo` 建立新 memo）並落地成功後，回到一般模式時 Memo List 不會顯示新增的 memo，必須重新整理頁面才出現。

根因：`public/index.html` 的 `renderProposal()` apply handler（line ~1271-1283）在 `POST /api/agent/apply` 成功後只更新按鈕文字與加 permalink，**漏了 `loadHistoryData()`**，導致前端 in-memory `historyData` 快取過時。對照組 `saveToMemo()`（「存成 memo」）在 apply 後有呼叫 `loadHistoryData()`，故其 memo 會即時出現。

修復：在 apply 成功分支補上 `loadHistoryData()`，與 `saveToMemo()` 一致。所有寫入類 proposal（`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）都會改動 `history.json`，套用後一律刷新即可。

## 任務清單
- [x] 在 `renderProposal()` apply handler 成功分支補 `loadHistoryData()`（`public/index.html`）
- [x] 驗證：Agent mode 核准 merge proposal → 退出 agent mode → Memo List 立即顯示新 memo（Playwright 端到端 + negative control）
- [x] 確認不影響三個隱性契約（tags 格式 / BASE_PATH / 雙套渲染）— 本次純前端、與三者無關
