# 選用密碼保護（HTTP Basic Auth）

- **分支:** `feat/password-protection`
- **日期:** 2026-06-26

## 描述

替 md-memo 加上**選用的**密碼保護，透過 `.env` 開關控制，**預設關閉**。採 HTTP Basic Auth（瀏覽器原生帳密彈窗），以一段 Express middleware 攔截所有請求；公開永久連結 `/m/:id` 維持免密碼可看，符合其「可分享給未登入者」的設計初衷。

### 方案決策（已與使用者確認）

- **機制：HTTP Basic Auth** — 最簡單，無需登入頁、無 session/cookie store，瀏覽器處理帳密提示。只驗密碼（username 任意忽略）。
- **保護範圍：全站 + 所有 `/api/*`，但放行 `/md-memo/m/:id` permalink。**
- **環境變數：`AUTH_ENABLED`（預設 `false`）+ `AUTH_PASSWORD`（密碼值）。**
- **安全預設**：`AUTH_ENABLED=true` 但 `AUTH_PASSWORD` 為空時，**不啟用**保護並 `console.warn`（避免設定不全反而把人鎖在外面 / 用空密碼形同無保護）。

### 已知取捨（簡單優先，不在本次範圍）

- 密碼明文存於 `.env`；Basic Auth 無「登出」、憑證由瀏覽器快取。
- 密碼比對用 `===`（非 constant-time）——對個人筆記工具的威脅模型可接受。
- 仍綁 `127.0.0.1`，正式對外暴露請搭配反向代理 + HTTPS（Basic Auth 憑證為 base64 明文，須靠 TLS 保護傳輸）。

## 契約檢查（須確認不破壞）

- **tags 格式**：不碰 `/api/format` 的 system prompt 或 `parseTags()`。
- **`__BASE_PATH__`**：middleware 的 public 前綴用 `` `${BASE_PATH}/m/` `` 組出，隨 base path 變動正確；不在 `index.html` 新增任何路徑字串。
- **雙套渲染**：permalink (`renderPermalink`) 不修改，且被明確放行；SPA 渲染不動。
- **demo build**：`dist-demo/` 為純靜態、無後端，auth middleware 不會執行，零影響；`build-demo.mjs` 與 `mock.js` 不需改。

## 任務清單

### A — 後端 Basic Auth middleware
- [x] 新增 `src/auth.js`：純函式 `checkPassword(authHeader, expected)` + 工廠 `createAuth({ enabled, password, publicPrefix })` 回傳 Express middleware
- [x] `createAuth` 邏輯：`enabled=false` → pass-through；`enabled=true` 但 `password` 空 → `console.warn` 後 pass-through
- [x] 啟用時：`req.path.startsWith(publicPrefix)` → 放行（permalink）；驗證失敗 → `401` + header `WWW-Authenticate: Basic realm="md-memo", charset="UTF-8"`
- [x] `src/index.js`：import `createAuth`，在 SPA / 各路由掛載**之前** `app.use(createAuth({ enabled: process.env.AUTH_ENABLED === 'true', password: process.env.AUTH_PASSWORD, publicPrefix: \`${BASE_PATH}/m/\` }))`

### B — 設定與文件
- [x] `.env.sample`：新增 `AUTH_ENABLED=false` 與 `AUTH_PASSWORD=`（含註解說明 + permalink 公開備註）
- [x] `README.md` Configuration 表：新增 `AUTH_ENABLED`、`AUTH_PASSWORD` 兩列
- [x] `CLAUDE.md` 環境變數段：補 `AUTH_ENABLED` / `AUTH_PASSWORD` 與「permalink 維持公開」行為

### C — 測試
- [x] 新增 `test/auth.test.js`（`node --test`，mock req/res/next）：
  - [x] `checkPassword`：正確密碼→`true`；錯誤密碼 / 缺 header / 空 expected→`false`；密碼含冒號仍正確解析
  - [x] `createAuth` disabled → 呼叫 `next`
  - [x] `createAuth` enabled 但無密碼 → 呼叫 `next`（pass-through）
  - [x] `createAuth` enabled：無 header → `401` + `WWW-Authenticate`；正確密碼 → `next`；`publicPrefix` 路徑 → `next`
- [x] `npm test` 全綠

### D — 手動驗證
- [x] 預設（未設 `AUTH_ENABLED`）：`npm start`，app 與所有 API 照常、無密碼提示
- [x] `AUTH_ENABLED=true AUTH_PASSWORD=secret npm start`：開 `/md-memo/` 跳 Basic Auth 彈窗，輸入 `secret` 通過、輸錯擋下
- [x] 同上設定下，`/md-memo/m/<id>` 免密碼可正常瀏覽
