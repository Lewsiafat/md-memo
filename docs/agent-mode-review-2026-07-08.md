# Agent mode 架構複審（依嚴重性排序）

```yaml
scope:        Agent mode 專項（/api/agent、/api/agent/apply、/api/sessions 與其依賴的儲存層）
base_commit:  366b26d (main, v1.6.1, 2026-07-08)
method:       人工通讀 src/agent.js、src/tools.js、src/store.js、src/sessions.js、
              src/index.js、src/permalink.js、src/auth.js + Fable5 model 交叉驗證，
              並對照既有的 docs/md-memo-code-review.md（2026-07-02 全庫審查）與
              docs/plans/2026-06-19-agent-over-notes-design.md（原始設計承諾）逐項核對現況
status:       純審查，未動工修改任何程式碼
```

**先說明會跟既有文件的落差**：`docs/md-memo-code-review.md`（2026-07-02）點出的 XSS
（S-01/S-02）、timing-unsafe 密碼比對（S-04）、`/api/agent/apply` 未驗證導致 500（B-02）、
`Date.now()` id 碰撞（B-03）**在目前這個 commit 都已經修好**，本文件不重複列出，只標註哪些是
在覆查時額外確認「已解決」。以下只列**現在仍然存在**的問題，並依嚴重性排序。

---

## Critical

### C1. `loadHistory()` 讀檔失敗會靜默清空，寫檔不是原子操作 → 有機會整本筆記本歸零
`src/store.js:34-44` 的 `loadHistory()`／`src/sessions.js:13-19` 的 `loadSessions()`
在 JSON parse 失敗時用 `catch {}` 直接吞掉錯誤、回傳空陣列；`saveHistory()`／`saveSessions()`
都是直接 `writeFileSync` 覆寫，沒有先寫暫存檔再 rename。

一旦 `data/history.json` 因程序中斷（斷電、OOM kill、容器重啟、磁碟寫滿寫到一半）而損毀，
下次讀取會被當成「空筆記本」而不是報錯。接下來只要任何一次寫入（包含 Agent mode 自動建立筆記、
`retag_memo`、`link_memos`）觸發 `saveHistory`，就會把這個「空陣列」寫回檔案，
**全部歷史筆記永久消失，且過程完全沒有錯誤訊息或警告**。

`clearHistory()`（`src/store.js:107-121`）已經有备份機制，但那只保護「使用者主動清空」這一條路徑，
不保護「讀檔失敗導致的隱性資料流失」這條路徑——兩者是不同的風險來源。

**建議**：
1. `loadHistory`/`loadSessions` parse 失敗時要 `console.error` 並讓呼叫端知道發生錯誤（例如拋出、
   或回傳一個帶 `corrupted: true` 標記的結果），不能無聲回傳 `[]`。
2. `saveHistory`/`saveSessions` 改成寫入 `<file>.tmp` 後 `fs.renameSync` 換檔，避免任何時間點磁碟上
   是半寫入狀態。

---

## High

### H1. `/api/agent/apply` 沒有 proposal id 綁定，無法防止重複套用
原始設計文件（`docs/plans/2026-06-19-agent-over-notes-design.md` 第 115-122 行）明確承諾：
「`/apply` 提案 id 已不存在 → 回 400，卡片標『來源已變動』」——這暗示提案應該要有自己的 id 可追蹤。
但目前 `POST /api/agent/apply`（`src/index.js:128-134`）直接吃前端傳來的 `{ action, args }`，
跟原本 SSE 推播的那個 `proposal` 事件完全沒有綁定關係，也沒有防止重複提交的機制。
使用者連點兩下「套用」＝建立兩篇一模一樣的筆記；理論上前端傳錯或竄改 args 也會被照單全收。

**建議**：`buildProposal` 產生時附上一次性 proposal id 並在記憶體/檔案暫存，`/api/agent/apply`
要求帶上該 id 且只能套用一次，找不到對應 id 時回 400（實作原設計文件已經寫好的行為）。

### H2. 寫入提案在 propose 階段完全不驗證參數，模型無法自我修復
原始設計文件（同上，第 117 行）承諾：「tool args 不合 schema → 驗證 → 錯誤訊息當
`tool_result` 餵回模型重試（自我修復）」。目前 `buildProposal()`（`src/tools.js:169-190`）
對 `args` 沒有做任何存在性檢查；驗證只發生在 `applyProposal()`（apply 階段，`src/tools.js:197-243`），
這比原設計晚了一整個階段——模型幻覺出不存在的 id 時，會一路把提案顯示給使用者，
直到使用者按下「套用」才報錯，而這時 Agent 對話輪次早已結束，錯誤訊息完全回不到
tool-calling loop 讓模型自己修正。

**建議**：把 `applyProposal` 裡已經有的存在性檢查提前到 `buildProposal`／`runAgent` 的
tool-dispatch 階段，驗證失敗時把錯誤當成 `tool_result` 餵回 `messages`，讓模型在同一個 run
裡有機會重新選擇正確的 id，而不是必須等使用者操作。

### H3. SSE 斷線只停止「推播」，沒有真的中止 loop
原始設計文件承諾「串流中斷/離開 → 後端偵測 `res.writableEnded` 提早停」。目前 `emit()`
（`src/index.js:113-116`）確實檢查了 `res.writableEnded`，但那只讓事件不再寫進已關閉的
response——`runAgent()` 內部的 `for` 迴圈完全不知道使用者已經離開，還是會照樣跑到
`MAX_STEPS`（8 步），繼續打 OpenRouter API、燒 token。「提早停」這個承諾其實沒有兌現。

**建議**：在 `/api/agent` 監聽 `req.on('close', ...)`，用 `AbortController` 傳進
`runAgent`／`callOpenRouter`，在每個 step 開頭檢查是否已中止。

### H4. 多輪對話後端已就緒但前端完全沒接（現況：每次都是全新單輪）
`runAgent()` 支援 `priorTurns` 參數（`src/agent.js:47`），但 `/api/agent`
（`src/index.js:104-106`）只讀 `req.body.message`，前端（`public/index.html:1857-1860`）
送出的 body 也只有 `{ message }`。`src/sessions.js` 存的「session」是**已完成的單輪問答紀錄**
（存起來給使用者回顧/轉存成筆記/刪除用），不是餵回下一次 `/api/agent` 呼叫的對話歷史。

**這點跟前兩份文件都對得上**：`docs/plans/2026-07-03-knowledge-engine-roadmap-design.md`
第 33 行已經記錄「`priorTurns` 參數已存在但前端未用（單輪）」，並列在該文件的 Phase 2
規劃裡（「agent 面板支援多輪對話（`priorTurns` 已在後端就緒，補前端與 session 格式）」）——
**這不是新發現，是已知且已排進路線圖的限制**，這裡列出來只是確認 v1.6.1 現況仍未實作，
供排優先序參考。

---

## Medium

### M1. 刪除筆記不會清理其他筆記的交叉引用
`DELETE /api/history/:id`（`src/index.js:179-184`）只是 `filter` 掉該筆記本身，
不會去掉其他筆記 `links`/`sources` 欄位裡對它的引用，留下懸空 id。
`read_memo` 回傳的 `links` 之後若被拿來顯示或被 Agent 引用，會指向一篇已經不存在的筆記。

**建議**：刪除時順便掃過其他筆記，移除對應的 `links`/`sources` 項目。

### M2.「合併」會加速觸發上限，且合併/被合併的來源沒有特殊標記
`merge_memos` 依設計刻意保留原始來源筆記不刪除（`docs/plans/2026-06-19` 第 20 行：
「刻意不給 `delete_memo`」），但這代表每次 Agent 幫忙整理/合併，筆記總數只增不減，
會比一般寫入更快地把舊筆記擠出 `historyLimit()` 的上限（見 M3）。也就是說，
用 Agent 整理筆記這個動作本身會加速筆記被驅逐。

**建議**：與 M3 一併考慮——例如合併後把來源筆記標記為「已合併封存」而不計入上限計數，
而不是留在同一個計數池裡跟其他筆記搶名額。

### M3. `historyLimit()` 上限依然是靜默驅逐，只是現在預設值從 50 提高到 1000
`insertEntry()`（`src/store.js:78-85`）還是會 `history.slice(0, historyLimit())`，
超過上限時最舊的筆記直接消失，沒有任何提示、備份或確認。目前預設值已從舊版的 50 提高到
`historyLimit()` 預設 1000（`src/store.js:9-11`，可用 `HISTORY_LIMIT` 環境變數調整；
VPS 上的 `.env` 目前沒有另外設定，所以吃預設值 1000）。
**這代表「筆記一堆的時候會出狀況」這件事被明顯延後，但沒有被解決**——量夠大之後一樣會無聲丟資料。

一旦超過上限被驅逐，`search_memos`/`read_memo` 會查無資料，Agent 因此會**自信地回答
「沒有寫過」**——實際上是曾經寫過但被系統默默刪除，Agent 沒有能力區分「真的沒寫過」跟
「曾經寫過但被系統丟棄」。

**建議**：至少要有明確的容量警告（UI 提示「已滿，最舊筆記即將被移除」），
中長期應該用歸檔取代硬刪除，或提高上限的同時搭配真正的索引/分頁（見 L1）。

---

## Low（現階段規模下不急，量放大後會先浮現）

- **L1. 搜尋仍是 `scoreMemo`／`searchMemos`（`src/tools.js:113-140`）的 O(n) 全文關鍵字計數掃描**，
  沒有索引。`GET /api/history` 已經有分頁（`listEntries`，`src/store.js:125-134`），
  但 `search_memos` 本身還是每次掃全庫；量到千篇等級時準確率跟延遲會先出問題，
  且是精確關鍵字比對，語意相近但用詞不同會搜不到。
- **L2. `read_memo` 回傳完整全文不截斷**（`src/tools.js:142-146`），Agent 一次讀好幾篇長筆記時，
  OpenRouter token 成本會疊加，`MAX_STEPS=8` 的預算容易被單一長筆記吃光。
- **L3. 所有檔案 IO 都是同步（`readFileSync`/`writeFileSync`）**，筆記本檔案變大後每次讀寫都會卡住
  event loop，目前檔案小所以感覺不到。

---

## 建議處理順序

1. **C1**（資料損毀路徑）— 影響面最大且最隱蔽，優先修
2. **H1 + H2**（proposal id 綁定 + propose 階段驗證）— 都是把原設計文件已經承諾但沒做完的部分補齊，可以一起做
3. **H3**（SSE 斷線真的中止 loop）— 獨立小修改
4. **H4**（多輪對話前端串接）— 已在既有路線圖 Phase 2，非本次新發現，依原排程處理即可
5. **M1～M3** — 建議跟未來要不要調整 `historyLimit()` 策略一起重新設計，不必馬上動
6. **L1～L3** — 規模化前置作業，目前資料量下不建議現在投入

## 附註：本地工作副本已過期，已同步

審查一開始發現 `/workspace/agent/projects/md-memo`（本地工作目錄）版本停在 v1.1.0，
跟 GitHub 上實際的 v1.6.1 落差非常大（少了 `auth.js`、`sessions.js`、`permalink.js`、
`slug.js`，`store.js`/`tools.js` 也是舊版邏輯）。本文件的分析全部改以 GitHub 上的
v1.6.1（commit `366b26d`）為準；本地工作目錄已重新同步到這個版本，避免下次審查再次
誤判已修好的問題。
