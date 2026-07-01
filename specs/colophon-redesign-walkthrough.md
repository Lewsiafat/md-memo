# Colophon — md-memo 視覺改造 — Walkthrough

- **分支:** `feat/colophon-redesign`
- **日期:** 2026-07-01

## 變更摘要

把 claude.ai/design 的「Colophon」設計稿（透過 claude_design MCP / `DesignSync` 匯入）落地成一次**純視覺改造**：暖紙感配色 + golden-brown 點綴、`Instrument Serif / Literata / IBM Plex Mono` 三字體系統、開放式書寫面。套用到 SPA 與永久連結頁,靜態 demo 自動跟隨。DOM 結構、API、agent loop、資料流**完全未動**;唯一的行為變更是預設主題由 dark 改為 light,以及 footer 字數只在編輯情境顯示。

## 修改的檔案

- **`public/index.html`**(+CSS/字體/皮膚,DOM 僅重排 topbar 按鈕)
  - `<head>` 載入三套 Google Fonts(Instrument Serif / Literata / IBM Plex Mono)
  - 改寫 dark(`:root`,Reading)與 light(`body.light`,Writing)兩套 CSS 變數色票,新增 `--serif-display / --serif-body / --editor-bg / --accent-line` 等
  - 預設主題改 light:`applyTheme(localStorage.getItem('md-memo-theme') !== 'dark')`
  - 書寫面:`#editor-area` 加左側 margin rule(`::before` 垂直線)與 `--editor-bg`,`#raw-input` 無框、透明底、mono、加大左 padding
  - `.md-render` 閱讀排版:H1·H2 `Instrument Serif`、H2 菱形 bullet、內文 `Literata`、`ul` 菱形 bullet、inline code chip、髮絲 blockquote;`#preview` 改左對齊貼齊 margin rule
  - topbar(logo `Instrument Serif` + accent ring `::before`)、按鈕(mono uppercase 方角)、footer、Memo List(寬 372px、mono 小標、serif 標題、bordered uppercase tag chips)、agent 三欄面板全面套皮
  - **字數只在 edit/combine 顯示**:`setMode()` 加 `body.mode-*` class,CSS 讓 `#char-count` 預設隱藏、僅 `mode-edit`/`mode-combine` 顯示(避免 View mode 與 memo tags 重疊)
  - **topbar 按鈕重排**:主題切換與語言鈕移到 `✨ Format` 右側
- **`src/permalink.js`** — 永久連結頁內嵌 `<style>` 與 header logo 重寫為 Colophon light,`.md` 排版對齊 Reading view;渲染邏輯與 `${basePath}` 用法不變
- **`specs/colophon-redesign.md`** — 任務規格(新增)

## 技術細節

- **雙套渲染各自獨立**:SPA 的 `.md-render` 與 permalink 的 `.md` 是兩份獨立 CSS,兩邊分別套 Colophon;經 `contract-reviewer` 驗證三隱性契約(tags 格式 / `__BASE_PATH__` / 雙渲染)皆 PASS。
- **logo accent ring** 用 CSS `::before`(border 做環 + radial-gradient 做中心點)達成,不改 DOM。
- **按鈕沿用既有 emoji 標籤**,只套 mono uppercase 外觀,守住「不改文案」原則。
- **設計稿明示尺寸**:Memo List 由 280→372px、預覽欄改左對齊(max-width 680px),屬「換衣服」範圍內的實作。
- **本機測試踩到的坑**:`src/index.js:30` 在啟動時把 `index.html` 讀成 snapshot 常數,`node --watch` 不監看 `index.html`,故每次改前端需重啟 server 才生效(既有行為,非本次引入)。
- **驗證**:`npm test` 50/50、`npm run build:demo` 成功、Playwright 截圖 5 畫面(light/dark/combine/agent/permalink)+ char-count 模式行為皆符合設計。
- **零新依賴**:字體走 CDN,與既有 `marked` 一致。
