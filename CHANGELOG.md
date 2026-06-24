# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
