# Colophon — md-memo 視覺改造

- **分支:** `feat/colophon-redesign`
- **日期:** 2026-06-30
- **設計來源:** claude.ai/design `MD Memo redesign.dc.html`（project `a8000f51-…`）

## 描述

把 claude.ai/design 的「Colophon」設計稿落地到 md-memo。這是一次**純視覺改造**——設計稿原則：*"Don't change the function or the layout — only the dress it wears."* 不動 DOM 結構、不動任何行為邏輯、不動路由與資料流，只換字體、色票與元件外觀。

套用範圍：**SPA（`public/index.html`）+ 永久連結頁（`src/permalink.js`）**；靜態 demo 讀真檔，會自動跟隨。預設主題**改為 light「Writing」**（目前為 dark）。

### 設計語彙

- **字體**：`Instrument Serif`（logo / H1·H2 標題）、`Literata`（內文 / memo 標題 / 格式化輸出）、`IBM Plex Mono`（所有 UI chrome：按鈕、標籤、日期、輸入區、tag chips）。
- **Light「Writing」**：底 `#ece8de`、面板 `#f5f1e8`、邊框 `#d9d2c1`、editor 面 `#f4f1e8`、強調 `#936f33`、文字 `#23211b`、次文字 `#8a8275 / #978f7d / #a89f8c / #5a5447`。
- **Dark「Reading」**：底 `#1c1a16`、面板 `#232019`、邊框 `#332f26`、強調 `#c9a85f`、文字 `#e8dfca`、次文字 `#ada288 / #756d5b`、閱讀欄 radial gradient。
- **形狀語言**：方角（`border-radius:2px`）、菱形/方塊 bullet、mono uppercase + letter-spacing 的小標、單一左側 margin rule。

## 任務清單

### A. 字體與基礎變數
- [x] `<head>` 加入 Google Fonts（Instrument Serif / Literata / IBM Plex Mono）的 preconnect + stylesheet link
- [x] 新增字體 CSS 變數：`--serif-display`（Instrument Serif）、`--serif-body`（Literata）、改寫 `--mono` 為 IBM Plex Mono

### B. 色票與預設主題
- [x] 改寫 dark `:root` 變數為 Colophon「Reading」palette
- [x] 改寫 `body.light` 變數為 Colophon「Writing」palette
- [x] 預設主題改 light：`public/index.html` 的 init 由 `=== 'light'` 改為 `!== 'dark'`（未設定 → light，僅顯式 dark 才 dark）

### C. Topbar
- [x] logo `md-memo` 改 Instrument Serif 大字 + accent ring 圖示
- [x] `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-agent` / `.btn-icon` 改 mono、uppercase、letter-spacing、方角、Colophon 配色
- [x] theme toggle 鈕外觀對齊設計（`◐` glyph），切換邏輯不變

### D. Editor 書寫面
- [x] `#raw-input` 改開放書寫面：無框、IBM Plex Mono、放大行高、加大左 padding
- [x] `#editor-area` 加單一左側 margin rule（垂直線，accent 半透明）
- [x] placeholder 維持原文（已與設計相符，靠 i18n）
- [x] `.md-render`（preview / quickview）改 Reading 排版：H1·H2 Instrument Serif、內文 Literata、菱形 bullet、blockquote 左線斜體、inline code chip

### E. Editor footer
- [x] `#editor-footer` 套 Colophon：`Edit Mode` badge 左、字數（mono）置中、`#current-tags`/`#status-text` 配色對齊

### F. 右側 panel（Tags + Memo List）
- [x] `#history-panel` 寬度 280px → 372px（依設計）
- [x] `#tag-section` / `#tag-toggle` 改 mono uppercase 小標，維持**預設收合**
- [x] `#history-header`「Memo List」+ count（mono）+ Clear chip（bordered accent）
- [x] `.history-item`：日期 mono small、`.hi-preview` 改 Literata serif 標題、`.hi-tag` 改 bordered mono uppercase chip；hover/active 用 accent 半透明

### G. Agent 面板
- [x] 三欄 agent 面板（sessions / main / examples）套 Colophon 配色與字體（多數靠變數自動跟隨，必要處微調 chip/tool/proposal 樣式）

### H. 永久連結頁（`src/permalink.js`）
- [x] 改寫內嵌 CSS 為 Colophon light palette + 三字體系統
- [x] header logo 改 Instrument Serif、`.md` 排版對齊 Reading view、`.tag` 與 `.copy-btn` 配色對齊

### I. 驗證
- [x] `npm test`（`node --test`）全綠——含 `permalink.test.mjs`、`demo-data.test.mjs` 跨檔一致性
- [x] `npm run build:demo` 成功，抽查 `dist-demo/` SPA 與 `m/<id>/` 永久頁視覺正確
- [x] 手動驗證：light/dark 切換、書寫→Format 預覽、Memo List、Edit/Save/Discard、Agent、`/m/:id`
- [x] dispatch `contract-reviewer`：確認三隱性契約（`<!-- tags -->` 格式、`__BASE_PATH__`、雙套渲染獨立）未被破壞

## 不做（範圍外）
- 不改任何 server 邏輯、API、agent loop、資料儲存
- 不改 DOM 結構與面板配置（只調尺寸/外觀）
- 不改 i18n 文案內容（沿用既有 key）
- 不新增依賴（字體走 CDN，與既有 `marked` 一致）
