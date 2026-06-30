# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [1.4.1] - 2026-06-30

### Fixed
- **Agent proposal apply now refreshes the Memo List immediately** — after approving a
  write proposal in Agent mode (e.g. `merge_memos` / `create_memo`) and returning to
  normal mode, the newly created memo did not appear in the Memo List until a full page
  reload. The apply handler in `renderProposal()` (`public/index.html`) was missing a
  `loadHistoryData()` call after a successful `POST /api/agent/apply`, leaving the
  front-end in-memory `historyData` cache stale (the "save as memo" path already refreshed
  via `saveToMemo()`). Added the refresh so all write proposals
  (`create_memo`/`merge_memos`/`link_memos`/`retag_memo`) update the list right away.

## [1.4.0] - 2026-06-29

### Added
- **Edit existing memos (Save / Reformat / Discard)** — opening a saved memo and hitting
  ✏️ Edit now offers three actions in the top bar: **💾 Save** overwrites the entry
  verbatim with no AI call (new `PUT /md-memo/api/history/:id`, backed by a new
  `updateEntry(id, { markdown, tags })` helper in `src/store.js` that overwrites in place
  — preserving `id`/`createdAt`/`raw`, recomputing `preview`, never reordering);
  **✨ Reformat** re-runs the AI and asks (native `confirm()`) whether to overwrite the
  existing memo or save the result as a new one (`POST /md-memo/api/format` now accepts an
  optional `id` in the body — overwrite when present and found, otherwise create new; the
  response shape is unchanged); **🗑 Discard** reverts the editor (native `confirm()`).
  Button visibility is centralized in `updateEditControls()` (Save only while editing an
  existing memo, Discard only while the editor holds typed text).

### Changed
- **History panel renamed to "Memo List".**
- **Agent panel UX** — Approve/Skip proposal cards now render **after** the answer
  summary (proposals are buffered and flushed post-summary, replay-safe for saved
  sessions and the demo); submission-history records are individually **deletable**
  (hover-revealed ✕, silent delete); tool calls collapse to a **one-line** `<details>`
  (`🔧 name` / `📋 name`) that expands to the full args/result JSON.
- The static demo mock (`demo/mock.js`) mirrors the new overwrite behavior
  (`PUT /api/history/:id` and `/api/format` overwrite-by-id) so the GitHub Pages demo
  doesn't regress.

### Fixed
- **Long-output format truncation** — raised the `/api/format` output cap to 32k
  (`AI_MAX_TOKENS`, default `32768`). When a model still truncates at its own limit the
  response carries `truncated: true`, the UI warns, and history keeps the full original
  input.

### Tests
- Suite now at 50 tests (added `updateEntry` store tests); `npm run smoke` and
  `npm run build:demo` green; cross-file contracts (tags / `BASE_PATH` / dual-render)
  verified intact.

## [1.3.1] - 2026-06-26

### Added
- **Optional password protection (HTTP Basic Auth)** — gate the whole app and all
  `/api/*` behind HTTP Basic Auth when `AUTH_ENABLED=true` (default **off**, so existing
  deployments are unaffected). Public permalink pages (`/m/:id`) stay open so shared
  links keep working. New `src/auth.js` exposes a pure `checkPassword()` helper and a
  `createAuth()` middleware factory, mounted before `express.json` in `src/index.js`
  (only the password is checked; the username is ignored). Enabling without
  `AUTH_PASSWORD` is a no-op that logs a warning, to avoid locking everyone out. New
  `AUTH_ENABLED` / `AUTH_PASSWORD` env vars documented in `README.md`, `.env.sample`, and
  `CLAUDE.md`. Tests: new `test/auth.test.mjs` (10 unit tests); suite now at 45 tests.

## [1.3.0] - 2026-06-26

### Added
- **Agent Mode workspace** — the agent panel is now a first-class three-column
  workspace: saved sessions (left), reasoning trace + pinned input + "back to normal
  mode" (center), example prompts (right). Server-side session persistence in
  `src/sessions.js` (mirrors `src/store.js`, stores `data/sessions.json`, capped at 50)
  with `GET/POST /api/sessions` and `DELETE /api/sessions/:id`. Each finished run can be
  saved as a session, then replayed or deleted; a session's answer can be turned into a
  memo in one click (reuses `POST /api/agent/apply` `create_memo`). A footer mode badge
  and a centralized `setMode()` state machine (View / Edit / Agent / Combine).
- **Safe "Clear all history"** — replaces the unbackuped, single-`confirm()`, per-item
  DELETE loop with a recoverable flow: `clearHistory()` first copies `data/history.json`
  to a timestamped `data/history.<ts>.bak.json` (one per clear, never overwriting old
  backups), then writes an empty array — exposed via `POST /api/history/clear`. The Clear
  button is now two-stage (arm → confirm, auto-disarms after 4s).
- **Agent Mode UX polish** — a centered "thinking" animation while a run is in flight
  (covers the gap before the first SSE event arrives), the input box clears on submit, a
  `localStorage`-backed submission-history list under the example rail (dedup, capped at
  12, click-to-refill), and a more prominent labeled "🤖 Agent" button in the top bar.
- Tests: new `test/sessions.test.mjs` (5 session-store tests) plus `clearHistory` cases
  in `test/store.test.mjs`; suite now at 35 tests.

### Changed
- `demo/mock.js` mirrors the new endpoints in-memory (`/api/sessions` ×3,
  `/api/history/clear`) and surfaces `create_memo` results in the demo history.

### Fixed
- `package.json` version was stale at `1.1.0` (not bumped at the v1.2.0 release); it now
  tracks the release version again.

## [1.2.0] - 2026-06-24

### Added
- **Static GitHub Pages demo** — a fully static, backend-free showcase whose AI
  interactions (the Format button and the agent reasoning trace) are driven by
  **pre-recorded scripts**, so anyone can try the full flow without an API key. A
  "Demo mode" badge marks the canned responses. Live at
  `https://lewsiafat.github.io/md-memo/`.
- `src/permalink.js` — `renderPermalink(entry, basePath)` extracted from the server's
  `GET /m/:id` handler so the same renderer is shared by the live server and the demo
  build (server output is byte-identical).
- Demo assets under `demo/`: `data/history.json` (10 bilingual seed memos),
  `data/format-samples.json` (editor prefill + canned format result),
  `data/agent-trace.json` (replayable agent run), and `mock.js` — a browser shim that
  monkeypatches `window.fetch` for `/api/*` and replays the agent trace as a real SSE
  `ReadableStream` through the app's existing parser.
- `scripts/build-demo.mjs` + `npm run build:demo` — emits a static `dist-demo/` bundle
  (injects the mock, replaces the `__BASE_PATH__` placeholder, pre-generates
  `m/<id>/index.html` permalinks via `renderPermalink`, writes `.nojekyll`). Uses only
  Node built-ins — **zero new dependencies**.
- `.github/workflows/deploy-demo.yml` — CI builds and force-pushes the bundle to an
  orphan `gh-pages` branch on push to `main` (or manual dispatch).
- Tests: new `test/permalink.test.mjs` and `test/demo-data.test.mjs` (cross-file
  consistency for the demo data); suite now at 28 tests.

### Changed
- `GET /m/:id` now renders through `renderPermalink()` from `src/permalink.js` (pure
  refactor — the served permalink HTML is unchanged).

## [1.1.0] - 2026-06-22

### Added
- **Agent over your notes** — a hand-built, framework-free agent loop (`src/agent.js`)
  that runs multi-step reasoning over the notebook using OpenRouter native function
  calling. It plans, calls tools, and synthesizes results.
- **Tools** (`src/tools.js`): read tools `search_memos` / `read_memo` / `list_tags`
  execute live in the loop; write tools `create_memo` / `merge_memos` / `link_memos` /
  `retag_memo` emit confirmable proposals (no `delete_memo` by design).
- **Live reasoning trace** — `POST /api/agent` streams the run as Server-Sent Events
  (`start` / `message` / `tool_call` / `tool_result` / `proposal` / `answer` / `done` /
  `error`); the SPA renders each step in a 🤖 agent panel with a pinned input and an
  independently scrollable trace.
- **Human-in-the-loop writes** — `POST /api/agent/apply` applies a user-confirmed
  proposal; mutating actions never run unattended.
- `AGENT_MODEL` env (default `deepseek/deepseek-v4-pro`, must support tool calling) and
  `AGENT_LANG` env (BCP-47, default `zh-TW`) controlling the agent's response language.
- Optional `links` / `sources` fields on history entries (from `link_memos` /
  `merge_memos`), backward compatible.
- Tests: `node --test` unit suite (`test/`, 19 tests) plus a zero-API-key smoke
  (`npm run smoke`).

### Changed
- History persistence extracted into `src/store.js` and shared by the existing routes
  and the agent (no behavior change to `/api/format`, `/api/history`, `/m/:id`, DELETE).

## [1.0.0] - 2026-06-18

### Added
- Initial open-source release: AI markdown formatting via OpenRouter, auto tags,
  history with tag-cloud filter, quick view, permalinks (`/m/:id`), dark/light theme.
