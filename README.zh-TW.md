[English](./README.md) · **繁體中文**

# md-memo

具備 AI 格式化能力的輕量 markdown 筆記工具。以純文字書寫，即時取得乾淨且結構化的 markdown。

## 🌐 線上 Demo

**[lewsiafat.github.io/md-memo](https://lewsiafat.github.io/md-memo/)** — 完全靜態的展示頁（不需 API key）。AI 格式化與 agent 推理皆為**預先錄製**，讓你能體驗完整流程；「Demo mode」角標標示出這些預錄回應。由 `demo/` 透過 `npm run build:demo` 建置，並經 GitHub Actions 部署到 `gh-pages` 分支。

## 功能特色

- ✍️ **以純文字書寫** — 無需 markdown 語法
- 🤖 **AI 格式化** — 一鍵透過 OpenRouter 轉成乾淨的 markdown
- 🏷️ **自動標籤** — AI 自動產生相關標籤
- 📋 **複製到剪貼簿** — markdown 或純文字
- 🔗 **永久連結** — 每筆筆記皆有可分享的網址（`/md-memo/m/:id`）
- 🌙 **深色 / 淺色主題** — 以 localStorage 持久化切換
- 📚 **Memo List** — 最近 50 筆筆記，附標籤雲篩選；安全的 Clear All 會保留帶時間戳的備份
- ✏️ **編輯既有筆記** — 開啟已存的筆記並可 **Save**（原樣覆蓋，不跑 AI）、**Reformat**（重跑 AI，接著覆蓋該筆或另存為新筆記）或 **Discard**
- 🔍 **快速檢視** — 不離開編輯器即可預覽 history 項目
- 🧠 **對你的筆記下指令的 Agent** — 提問或下指令（「合併本週的會議記錄」）；agent 會搜尋、閱讀並提出變更建議，並附即時推理 trace（任何寫入前都會先確認）。專屬的三欄 Agent 工作區讓你儲存、重播與刪除 session，或將一則回答轉成 memo

## 技術堆疊

- **後端**：Node.js + Express（ES Modules）
- **前端**：Vanilla JS，無框架、無 build step
- **AI**：[OpenRouter](https://openrouter.ai)（自帶 key，任意模型）
- **儲存**：JSON 檔案（不需資料庫）

## 快速開始

需要 Node.js >= 22.9（使用內建的 `--env-file-if-exists` flag）。

```bash
# Clone
git clone https://github.com/Lewsiafat/md-memo.git
cd md-memo

# Install
npm install

# Configure
cp .env.sample .env
# Edit .env and add your OPENROUTER_API_KEY

# Run
npm start
# Open http://localhost:10026/md-memo/
```

## 設定

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10026` | 伺服器埠號 |
| `HOST` | `127.0.0.1` | 綁定位址——部署到 Railway/Render/Docker 時設 `0.0.0.0`（請先啟用 auth！） |
| `BASE_PATH` | `/md-memo` | URL base path |
| `OPENROUTER_API_KEY` | — | 你的 OpenRouter API key（AI 必需） |
| `AI_MODEL` | `deepseek/deepseek-v4-flash` | OpenRouter 模型 ID |
| `AGENT_MODEL` | `deepseek/deepseek-v4-pro` | agent loop 使用的模型（須支援 tool calling） |
| `AGENT_LANG` | `zh-TW` | 所有 agent 輸出的語言（BCP-47 tag） |
| `AUTH_ENABLED` | `false` | 為 app 與所有 API 啟用 HTTP Basic Auth（永久連結維持公開） |
| `AUTH_PASSWORD` | — | `AUTH_ENABLED=true` 時使用的密碼（username 忽略） |

到 [openrouter.ai](https://openrouter.ai) 取得你的免費 API key。

## 範例資料

`data/history.sample.json` 提供了一份範例 history 檔案。
若要以它作為起點：

```bash
cp data/history.sample.json data/history.json
```

App 在首次使用時會自動建立 `data/history.json`。

## 自架（Self-hosting）

App 是單一的 Express 伺服器，同時提供靜態檔案。可部署到任何能跑 Node.js 的地方：

- **VPS**：以 `node src/index.js` 執行，置於 nginx 之後
- **Railway / Render**：設定 env vars，直接部署
- **Docker**：自行加入你的 `Dockerfile`（歡迎貢獻！）

## 設計文件

設計歷程與規格文件位於 `specs/` 與 `docs/plans/`。

## 授權

MIT
