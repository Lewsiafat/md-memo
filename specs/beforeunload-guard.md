# 未儲存輸入時的關閉頁面警示（beforeunload guard）

- **分支:** `feat/beforeunload-guard`
- **日期:** 2026-07-07

## 描述
使用者在「create new」（`#raw-input` textarea）已經輸入文字但尚未格式化/儲存時，若嘗試關閉分頁或離開頁面，瀏覽器應跳出原生的離開確認提示，避免誤觸導致內容遺失。

## 任務清單
- [ ] 在 `public/index.html` 新增 `window.addEventListener('beforeunload', ...)`，判斷條件比照現有 `updateEditControls()` 裡的 unsaved 邏輯：`currentMode !== 'agent' && !isPreviewMode && rawInput.value.trim().length > 0`
- [ ] 觸發時呼叫 `e.preventDefault(); e.returnValue = '';`（沿用瀏覽器原生提示文字，不可自訂內容）
- [ ] 確認 `doFormat()` 成功後（進入 preview/已儲存狀態）不再視為未儲存，不觸發警示
- [ ] 確認 `resetToNew()` / discard 清空 textarea 後不再觸發警示
- [ ] 手動測試三種情境：(a) 輸入文字未格式化直接關閉分頁 → 有警示 (b) format 完成後關閉 → 無警示 (c) discard 清空後關閉 → 無警示
- [ ] 更新 `CHANGELOG.md` / `CHANGELOG.zh-TW.md`（新增一筆 patch 版本項目）
