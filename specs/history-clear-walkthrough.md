# 安全清空 History（備份 + 雙重確認）— Walkthrough

- **分支:** `feat/history-clear`
- **日期:** 2026-06-26

## 變更摘要

把「Clear all history」從**無備份、單次 `confirm()`、逐筆 DELETE 迴圈**改成**安全且可還原**的機制：後端新增 `clearHistory()`，先把 `data/history.json` 複製成一份**帶時間戳的** `data/history.<時間戳>.bak.json`（每次清空各留一份、不覆蓋舊備份），再寫入空陣列；透過新的 `POST /api/history/clear` 端點落地。前端 Clear 按鈕改為**兩段式（arm → confirm）**：第一次點擊變紅顯示「Confirm?」，4 秒內未再點則自動還原；第二次點擊才呼叫端點清空，並依回傳的 `backedUp`/`count` 顯示 toast。靜態 demo（無後端）以記憶體內 mock 對齊同一端點形狀。

以 subagent-driven 流程執行：5 個任務逐一 TDD/實作 + 每任務 spec/品質雙重 review，contract-reviewer 確認三項隱性契約（tags 格式、BASE_PATH、雙套渲染）全數 intact，最後全分支 review（opus）→ 一輪修正 → re-review（Ready to merge）。並以 Playwright 對**真 app 與 demo 兩邊**做互動式驗收（皆通過），使用者再以真實筆記副本本地實測清空 + 時間戳備份成功。

## 修改的檔案

**修改（核心）**
- `src/store.js` — 新增 `clearHistory()`：偵測 history 檔存在才備份，時間戳取自 `new Date().toISOString().replace(/[:.]/g,'-')`，回傳 `{ ok, backedUp, count, backupFile }`（無檔時 `backedUp:false`/`count:0`/`backupFile:null`）。
- `src/index.js` — 新增 `POST ${BASE_PATH}/api/history/clear` 路由，`res.json(clearHistory())` 直接透傳。
- `public/index.html` — 以 arm-then-confirm handler（`clearArmed`/`clearTimer`/`disarmClear`）取代原本的逐筆 DELETE 迴圈，改呼叫 `${API}/history/clear`；`disarmClear` 還原按鈕原色 `var(--text2)`。
- `demo/mock.js` — 新增 `POST /api/history/clear` 分支，清空記憶體 `state.history` 並回傳同形狀 `{ ok, backedUp, count }`（demo 無實體備份）。

**修改（測試）**
- `test/store.test.mjs` — 新增 2 個 `clearHistory` 測試：備份為帶時間戳的 `.bak.json`（存在、內容為清空前筆數）且 history 清空；無檔時 `backedUp:false`/`count:0`/`backupFile:null`。

**修改（設定／文件）**
- `.gitignore` — 加 `data/*.bak.json`，避免把含真實筆記的備份檔誤提交。
- `CLAUDE.md` — 路由清單加上 `POST /api/history/clear`（時間戳備份說明）。

**新增（文件）**
- `docs/superpowers/plans/2026-06-24-history-clear.md` — 5 任務實作計畫。

## 技術細節

- **複製後再清空的順序安全**：`fs.copyFileSync(f, backupFile)` 一定在 `saveHistory([])` 之前——即使兩步之間崩潰，原 `history.json` 與備份都還在，不會兩頭落空。
- **時間戳備份、不覆蓋**：原計畫預設單槽 `history.bak.json`（覆蓋式），但與使用者 memory 的「改名備份」偏好衝突（連續清空會把舊備份蓋成近乎空的）。final review 點出後，依使用者選擇改為 `history.<時間戳>.bak.json`，毫秒精度、每次清空各留一份。
- **退化安全**：`count` 讀取包在 `try/catch`，即使 history 檔毀損仍能清空（`count` 退為 0）而非 500。
- **契約不破**：前端清空走 `API` 常數（`__BASE_PATH__/api`）非硬寫路徑；路由掛在 `BASE_PATH` 下；`parseTags` 與 `renderPermalink` 完全未動——contract-reviewer 已逐項確認。
- **demo/真 app 形狀一致**：mock 回傳 `{ ok, backedUp, count }`，前端不讀 `backupFile`，故 demo 無實體備份也不影響行為。
- **驗證**：`npm test` 30/30；route curl 煙霧（`{ok:true,backedUp:true,count:1}`→`[]`→`.bak.json` 產生）；Playwright 互動驗收於真 app 與 demo 兩邊通過（2/10 筆 → Clear→「Confirm?」→再點→0 筆、toast「Cleared — backed up N memo(s)」、按鈕復原、零 console error）；使用者以真實筆記副本本地實測：清空後 4 筆完整保存在時間戳備份、正式資料未受影響。

## 已知 follow-up（非阻斷，re-review 留存）

- `POST /api/history/clear` 回傳的 `backupFile` 為伺服器絕對路徑，屬低風險資訊揭露——對綁 `127.0.0.1` 的個人工具可接受；若日後多人化可改回 basename 或移除該欄位。
- `demo/mock.js` 的 `/clear` 回傳未含 `backupFile`（前端不讀，功能無影響）；如需嚴格形狀一致可補 `backupFile:null`。
- 還原方式：把對應的 `data/history.<時間戳>.bak.json` 複製回 `data/history.json` 後重啟即可。
