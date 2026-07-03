# md-memo 知識引擎演進藍圖（Knowledge Engine Roadmap）

日期：2026-07-03　狀態：待審閱（roadmap / design）
範圍：整體演進方向的分解與排序。每個 Phase 之後各自走「spec → 實作計畫 → 實作」流程，本文件不含逐行實作細節。

---

## 1. 願景

md-memo 從「快速 AI markdown 筆記工具」演進為**端到端的知識重用引擎**：

```
擷取 (capture) → 結構化 (format) → 連結 (wiki) → 綜合 (agent) → 重用/輸出 (interfaces)
```

使用者丟進零散文字，系統把它變成有結構、有標籤、彼此連結的知識網；agent 能在知識網上推理、整理、合成；知識能透過多種介面（Web、CLI、MCP、公開 wiki、匯出）流回工作流程被重複使用。

## 2. 目標解讀與假設

原始目標（`/goal`）：「more interface, more agent power, more agent tools use, LLM wiki concert, from to end of knowledge reusable tool」。本文件採以下解讀（若有誤請指正）：

| 原文 | 解讀 |
|---|---|
| more interface | 更多存取介面：CLI、MCP server、公開 wiki 頁、匯出/匯入 |
| more agent power | 更強的 agent loop：多輪對話、語意搜尋、更高步數/預算、角色預設 |
| more agent tools use | 擴充工具集：update/delete/split/list、backlinks、compose 等 |
| LLM wiki concert | LLM wiki **concept**：`[[wikilink]]`、反向連結、知識圖譜、由 LLM 維護的 wiki |
| from to end | **end-to-end**：從擷取到重用的完整閉環 |

## 3. 現況盤點（v1.5.0）

- **核心**：`src/index.js`（Express，~180 行）＋ `public/index.html`（SPA，~1,780 行 inline）。唯一依賴 express，無 build step。
- **Agent**：hand-built loop（`src/agent.js`，MAX_STEPS=8，max_tokens 4096 寫死）、7 個工具（讀：`search_memos`/`read_memo`/`list_tags`；寫（proposal 制）：`create_memo`/`merge_memos`/`link_memos`/`retag_memo`）、SSE 串流、`priorTurns` 參數已存在但前端未用（單輪）。
- **搜尋**：純關鍵字計分（`scoreMemo`），無語意搜尋。
- **儲存**：單一 `data/history.json`，**上限 50 筆**（`HISTORY_LIMIT`），entry 已有 `links`/`sources` 欄位（`link_memos` 已寫入 links，但**前後端都尚未渲染**）。無 `title`/`slug`。
- **介面**：SPA、server-render 永久連結頁（`/m/:id`）、靜態 GitHub Pages demo。選用 Basic Auth。
- **既有跨檔契約**（改動時的地雷區，repo 已有 `contract-reviewer` agent 把關）：
  1. tags 註解格式（prompt ↔ `parseTags()`）
  2. `__BASE_PATH__` 替換
  3. **雙套獨立渲染環境**（SPA ↔ permalink，markdown 功能都要做兩遍）

**與願景的最大落差**：50 筆上限（知識庫不能封頂）、無語意搜尋、links 欄位有寫無讀（wiki 的種子已埋但未發芽）、知識只進不出（無匯出/CLI/MCP）。

## 4. 策略選項

### 選項 A：漸進強化（建議）
維持「無框架、無 build step、極少依賴、JSON 儲存」的專案精神，按支柱分階段疊加能力，每個 Phase 獨立可出貨、可驗證。
- 優點：風險低、隨時可停在任一穩定點、不背叛專案定位（輕量工具而非平台）。
- 缺點：某些能力（大規模資料、多人協作）有天花板。

### 選項 B：平台化重構
改用 SQLite、模組化前端（框架＋build）、外掛架構。
- 優點：長期天花板最高。
- 缺點：重寫成本高、與「兩個檔案承載邏輯」的精神完全相悖，等於另一個專案。**不建議**。

### 選項 C：介面優先
先做 MCP/CLI/匯出，讓現有筆記立即可被外部 agent 重用，wiki 核心延後。
- 優點：「重用」的槓桿最快兌現。
- 缺點：知識核心（連結、圖譜）仍淺，輸出去的東西品質不變。

**建議：A 為主幹、吸收 C 的洞見**——MCP server 是「知識重用」的最大單一槓桿，在地基完成後儘早做（見 Phase 3 可前移的註記）。

## 5. 不變的守則

1. 無前端框架、無 build step（demo build 除外）；新的 markdown 能力優先用現有 CDN 模式（`marked` 前例）。
2. server 端依賴極簡：express 之外，只有 MCP server 允許評估第二個依賴（`@modelcontextprotocol/sdk`），且放在獨立 entry（`src/mcp.js`），不裝也不影響主 app。
3. JSON 檔案儲存不換資料庫；規模痛點出現時才在該 Phase 的 spec 重新評估（SQLite 為逃生門，不預先做）。
4. 寫入一律走 proposal → 使用者確認的既有安全模式；agent 新工具不例外。
5. 每個 Phase 交付都含測試（`node --test`）＋ smoke，CI 綠燈為完成條件。

## 6. 分階段路線圖

### Phase 0 — 知識庫地基（S，先決條件）
50 筆上限與無標題身分是後面一切的地基問題。
- `HISTORY_LIMIT` 改為環境變數（預設 1000；文件註明 JSON 全檔重寫的規模特性）。
- memo 增加 `title`（取第一個標題行）與穩定 `slug`（wiki 身分用；舊資料 lazy 補齊，欄位皆 optional 保持向後相容）。
- `GET /api/history` 支援分頁/篩選參數（`limit`/`offset`/`tag`），SPA Memo List 對應調整（載入更多）。
- 驗收：既有 59+ 測試全綠；新增 title/slug/分頁測試；舊 `history.json` 無需遷移即可用。

### Phase 1 — Wiki 核心（M）
把「LLM wiki concept」落地成可見功能。
- **`[[wikilink]]` 語法**：`[[slug或標題]]` 在**兩套渲染環境**都解析成站內連結（SPA 內跳 quickview、permalink 頁連到 `/m/:id`）；無法解析的連結以 wiki 慣例的「缺頁」樣式呈現，點擊可轉為建立新 memo。
- **反向連結（backlinks）**：讀取時計算（wikilink ＋既有 `links` 欄位），SPA View 模式與 permalink 頁尾各加 backlinks 區塊——讓已埋下的 `links` 欄位終於有讀取方。
- **agent 工具**：`get_backlinks`（讀）、`suggest_links`（讀，回傳候選配對＋理由，落地仍走既有 `link_memos` proposal）。
- 風險：雙渲染契約——wikilink 解析器抽成共用模組（如 `src/wikilink.js`），兩邊只做樣式各自的包裝；permalink 是公開頁，連結渲染需沿用既有 escaping 紀律。
- 驗收：兩套環境 wikilink 渲染測試、backlinks 計算測試、demo 資料加入 wikilink 範例。

### Phase 2 — Agent 增強（M–L）
- **工具集擴充**（全走 proposal 制）：`update_memo`（改內文）、`delete_memo`、`split_memo`（一拆多）、`list_memos`（分頁列出，讀）、`compose_document`（多篇合成一份輸出文件——「重用」的核心動詞）。
- **語意搜尋**：OpenRouter embeddings API（`EMBED_MODEL` 環境變數），向量存 `data/embeddings.json`（memo id ＋內容 hash 做快取失效）；`search_memos` 升級為關鍵字＋語意混合計分；無 key 或未設定時自動退回純關鍵字（demo 不受影響）。零新依賴。
- **Loop 升級**：`MAX_STEPS` 與 `max_tokens` 改環境變數；模型輸出改 token 級串流（目前整段 message 才 emit）；agent 面板支援**多輪對話**（`priorTurns` 已在後端就緒，補前端與 session 格式）。
- **角色預設（presets）**：系統 prompt 前綴的輕量機制——「圖書館員」（找／答）、「園丁」（掃描全庫、提連結/retag/merge 的 proposal 批次）、「研究員」（跨篇綜合）。園丁＋proposal 佇列＝LLM 自主維護 wiki 的雛形，且維持人審。
- 驗收：每個新工具有注入式 `callModel` 測試；語意搜尋有快取與 fallback 測試；smoke 涵蓋多輪。

### Phase 3 — 介面擴張（M）★可視「重用」優先度前移至 Phase 1 之後
- **MCP server**（`src/mcp.js`，stdio）：把 `search_memos`/`read_memo`/`list_tags`/`create_memo` 暴露給 Claude Code 等 MCP client——你的知識庫直接成為所有 agent 工作流程的工具。寫入端政策：MCP 的 create 直接落地（使用者在 MCP client 端已有確認機制），並提供 `MCP_READONLY=true` 可整體關閉寫入。
- **CLI**（`bin/md-memo`，Node 內建，零依賴）：`md-memo add "..."`（擷取＋格式化）、`md-memo search <q>`、`md-memo ask <prompt>`（走 agent API）——終端隨手擷取是 capture 閉環的起點。
- **匯出/匯入**：匯出 Obsidian 相容 vault（每篇一個 `.md`＋front-matter tags/links；打包用 SPA 端 CDN zip 庫如 `fflate`，server 零依賴）；JSON 全量匯出/匯入（備份與搬遷）。
- 驗收：MCP 以 Claude Code 實連驗證；CLI 有煙霧測試；匯出→匯入 round-trip 測試。

### Phase 4 — Wiki 出版與圖譜（M）
- **公開 wiki 模式**（`WIKI_PUBLIC=true` 選用）：permalink 引擎泛化為唯讀 wiki——首頁索引、標籤頁、每頁含 backlinks；沿用既有 XSS 紀律與 Basic Auth 邊界（wiki 公開、app 受保護）。
- **靜態 wiki 匯出**：`build-demo` 模式泛化成 `build-wiki`，把整個知識庫輸出成可部署 GitHub Pages 的靜態站——知識庫變成可發布的產品。
- **圖譜視圖**：SPA 內 canvas 手刻力導向圖（節點=memo、邊=links/wikilinks、顏色=tag 群），零依賴；點節點開 quickview。
- 驗收：wiki 頁 escaping 回歸測試；靜態匯出後連結完整性檢查腳本。

### Phase 5 — 重用閉環進階（S–M，選配）
- URL 擷取：貼網址→server 抓取→format 成 memo（安全上限與 timeout）。
- 模板系統：常用輸出格式（週報、讀書筆記、決策記錄）供 `compose_document` 使用。
- 排程園丁：提供冪等的 `POST /api/agent/gardener` 端點＋proposal 佇列持久化，排程交給外部 cron；不內建排程器。

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 4
   │                        │
   └──► Phase 3（僅依賴 0）  │
              │             │
              └──► Phase 5 ◄┘（依賴 2 的 compose 與 3 的佇列）
```

## 7. 風險與對策

| 風險 | 對策 |
|---|---|
| 雙渲染契約：每個 markdown 新能力都要做兩遍 | 解析邏輯抽共用模組，兩邊只包樣式；每次改動 dispatch `contract-reviewer` |
| JSON 全檔重寫在筆記量大時變慢 | Phase 0 文件化規模預期；真痛了才在該 Phase spec 評估 SQLite，不預先重構 |
| 公開 wiki 擴大 XSS 面 | 沿用 v1.5.0 的 escaping＋DOMPurify 紀律，每個新頁面型別配回歸測試 |
| agent 工具變多→模型誤用/濫用 | 保持 proposal 制；`delete_memo` 等破壞性動作在 UI 上加強確認文案 |
| MCP 依賴違反極簡精神 | 隔離在獨立 entry，主 app 不 import；README 標註選配 |
| 範圍膨脹（Telegram bot、瀏覽器外掛等） | 明確列為 non-goal，除非之後另立目標 |

## 8. Non-goals（本藍圖不做）

多人協作/帳號系統、即時同步、瀏覽器外掛、行動 App、內建排程器、資料庫遷移（除非規模痛點觸發）。

## 9. 下一步

1. 使用者審閱本藍圖（尤其：Phase 3 是否前移？Phase 5 是否保留？）。
2. 核可後，從 **Phase 0** 開始，走既有流程：`/task` 開分支 → 該 Phase 的 spec（`specs/`）→ 實作計畫（superpowers writing-plans）→ TDD 實作 → code review。
3. 每完成一個 Phase 回頭校準本文件（勾銷、調序、增補）。
