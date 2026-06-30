[English](./README.md) · **繁體中文**

# Demo build

為 GitHub Pages 打造的靜態、免後端 md-memo 展示。AI 回應皆為預錄。

## 運作方式

- `demo/data/history.json` — 10 筆雙語種子筆記
- `demo/data/format-samples.json` — 編輯器預填內容 + 預設的 format 結果
- `demo/data/agent-trace.json` — 重播的 agent 執行過程 + apply 結果固定的 id／日期
- `demo/mock.js` — monkeypatch `window.fetch`；以上述 JSON 服務 `/api/*`，並透過 app 既有的 parser 把 agent trace 以真正的 SSE `ReadableStream` 重播

## 建置與部署

```bash
npm run build:demo   # emits dist-demo/
```

`scripts/build-demo.mjs` 會把 `mock.js` 注入 `public/index.html`，將
`__BASE_PATH__` placeholder 替換成 `/md-memo`，複製 demo 資料，並透過重用
`src/permalink.js`（與 server 使用的同一支 renderer）預先產生
`m/<id>/index.html` 永久連結。

部署是自動的：`.github/workflows/deploy-demo.yml` 會在每次 push 到 `main`
（或手動 dispatch）時建置並 force-push `dist-demo/` 到 `gh-pages` 分支。
請透過 **Settings → Pages → Deploy from a branch → `gh-pages` / (root)** 一次性啟用 Pages。

## 更新 demo

編輯 `demo/` 底下的檔案，執行 `npm run build:demo`，檢視 `dist-demo/`，
commit 並 push — CI 會重新部署。若 `src/` 中的 `/api/*`
結構有變動，請保持 `demo/mock.js` 同步。
