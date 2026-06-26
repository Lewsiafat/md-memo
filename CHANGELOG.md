# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
