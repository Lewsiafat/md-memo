# 選用密碼保護（HTTP Basic Auth） — Walkthrough

- **分支:** `feat/password-protection`
- **日期:** 2026-06-26

## 變更摘要

替 md-memo 加上**選用的** HTTP Basic Auth：由 `.env` 的 `AUTH_ENABLED` 開關控制、**預設關閉**。啟用後保護整個 app 與所有 `/api/*`，但公開永久連結 `/m/:id` 維持免密碼可看，不影響分享。實作走 TDD，新增 10 個單元測試，全套 45/45 綠，並完成手動端到端驗證。

## 修改的檔案

| 檔案 | 變更 | 說明 |
|------|------|------|
| `src/auth.js` | 新增 | 純函式 `checkPassword(authHeader, expected)`（只比對密碼，username 忽略）＋ 工廠 `createAuth({ enabled, password, publicPrefix })` 回傳 Express middleware |
| `src/index.js` | 修改 | import `createAuth`，在 `express.json` **之前** `app.use(createAuth(...))`，未授權請求早期短路 |
| `test/auth.test.mjs` | 新增 | 10 個 `node:test` 單元測試（mock req/res/next） |
| `.env.sample` | 修改 | 新增 `AUTH_ENABLED=false` / `AUTH_PASSWORD=` 與註解 |
| `README.md` | 修改 | Configuration 表新增兩列 |
| `CLAUDE.md` | 修改 | 環境變數段補 `AUTH_ENABLED` / `AUTH_PASSWORD` 與 permalink 公開行為 |
| `specs/password-protection.md` | 新增 | 任務規格（含方案決策、契約檢查、取捨） |

## 技術細節

### 機制：HTTP Basic Auth
最簡單的伺服器端方案——無登入頁、無 session/cookie store，瀏覽器處理帳密提示。middleware 只驗 `AUTH_PASSWORD`，username 任意忽略。驗證失敗回 `401` + `WWW-Authenticate: Basic realm="md-memo", charset="UTF-8"`，觸發瀏覽器原生彈窗。

### 保護範圍與 permalink 放行
middleware 以 top-level `app.use` 掛載，`req.path` 保留完整路徑（含 `BASE_PATH`），故用 `` `${BASE_PATH}/m/` `` 比對即可放行永久連結。掛在所有路由前，未授權請求連 body 都不解析。

### 安全預設（避免誤鎖）
`AUTH_ENABLED=true` 但 `AUTH_PASSWORD` 為空時，**不啟用**保護並 `console.warn`——防止空密碼形同無保護、或把人鎖在外面。`enabled=false` 時 middleware 為 pass-through。

### 已知取捨（簡單優先）
- 密碼明文存 `.env`；Basic Auth 無「登出」、憑證由瀏覽器快取。
- 密碼比對用 `===`（非 constant-time）——對個人筆記工具的威脅模型可接受。
- server 仍綁 `127.0.0.1`；正式對外暴露須搭反向代理 + HTTPS（Basic Auth 憑證為 base64 明文，靠 TLS 保護傳輸）。

### 契約把關
由 contract-reviewer 確認三個跨檔隱性契約（tags 格式 / `__BASE_PATH__` / 雙套渲染）皆未受影響；demo build 為純靜態、不經 Express，不受 auth middleware 影響。

### 驗證
- **TDD**：先寫測試 → 看它因模組缺失失敗 → 最小實作 → 10/10 綠 → 全套 45/45 綠。
- **手動**：預設關閉照常 200；啟用後無/錯帳密 401、正確 200、SPA 401、permalink 404（非 401，代表通過 auth）、`WWW-Authenticate` header 正確。
