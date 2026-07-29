**English** · [繁體中文](./CHANGELOG.zh-TW.md)

# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [1.6.2] - 2026-07-09

Agent-mode hardening (C1+H1+H2+H3) from the 2026-07-08 architecture review;
design and task plan in `docs/plans/2026-07-08-agent-mode-hardening-*.md`.

### Fixed
- **Corrupted storage no longer silently wipes data (C1).** If
  `data/history.json` or `data/sessions.json` fails to parse (or isn't an
  array), the corrupted file is quarantined as
  `<name>.corrupt-<timestamp>.json` with its original bytes preserved for
  manual recovery, and the app continues with an empty library instead of
  overwriting the evidence on the next save. All saves are now atomic
  (write `<file>.tmp`, then rename), so a crash can never leave a
  half-written file.
- **Closing the tab now actually stops the agent (H3).** When the SSE
  client disconnects mid-run, an AbortController aborts the agent loop and
  the in-flight OpenRouter request instead of letting the run burn tokens
  to completion.
- **Invalid agent write proposals self-correct instead of reaching you
  (H2).** Write-tool args are validated at propose time; validation errors
  feed back to the model as tool results so it can retry within the run,
  and never become a confirmable proposal.

### Changed
- **`POST /api/agent/apply` now consumes a one-time proposal id (H1).**
  The SSE `proposal` event carries a server-issued id (`{ id, action,
  args, summary }`); apply takes `{ id }` only, with args kept server-side
  in an in-memory registry (200-entry FIFO). Double-clicks, replayed saved
  sessions, and tampered args all get a 400; a server restart invalidates
  pending proposals by design.

### Added
- **`POST /api/history`** — raw create without the LLM (body
  `{ markdown, tags? }`); the agent panel's "save session as memo" now
  uses this instead of the apply endpoint.
- Demo mock mirrors the new id-based apply contract, so the static demo
  keeps exercising the real frontend code paths.

## [1.6.1] - 2026-07-07

### Fixed
- **`POST /api/format` no longer rewrites or expands user input.** The
  system prompt had no instruction to preserve the original content/scope,
  so pasting an imperative numbered list (e.g. a course-planning draft) got
  treated as a task to fulfill rather than text to format, producing a much
  longer invented document instead of lightly-cleaned markdown. The prompt
  now explicitly treats the input as content-to-format (never
  instructions-to-execute) and preserves the user's original meaning, scope,
  and length.
- **`POST /api/format` no longer drifts into Simplified Chinese.** The
  prompt had no language directive at all. It now shares the `AGENT_LANG`
  env var (default `zh-TW`) with the agent loop and enforces Traditional
  Chinese output when the input is Chinese.

## [1.6.0] - 2026-07-06

Knowledge-engine roadmap Phase 0 + 0.5
(`docs/plans/2026-07-03-knowledge-engine-roadmap-design.md`): storage foundation
plus Memo List usability at 1,000-memo scale. Full walkthrough in
`specs/memo-foundation-and-list-walkthrough.md`.

### Added
- **`HISTORY_LIMIT` environment variable** (default `1000`) — the hard-coded
  50-memo cap is gone. The JSON store is still rewritten whole on each save;
  the docs note the scale characteristics.
- **`title`/`slug` identity per memo** (`src/slug.js`) — title derived from the
  first heading (fallback: first non-empty line); CJK-friendly kebab-case slug,
  unique-suffixed and **stable once generated** (groundwork for wiki links).
  Old data is lazily backfilled on first load — no manual migration.
- **Paginated lightweight history API** — `GET /api/history` takes
  `limit`/`offset`/`tag`/`order` and returns an `{ items, total, all }`
  envelope with lightweight fields (no full markdown).
- **`GET /api/history/search?q=`** — full-library keyword search reusing the
  agent tool's `searchMemos` scoring (one implementation, both consumers).
- **`GET /api/history/:id`** (single memo on demand for quickview/restore;
  404 on unknown or non-numeric ids) and **`GET /api/tags`** (tag counts, so
  the tag cloud stays correct under pagination).
- **Memo List upgrades** — search box (live filter over loaded items, Enter
  for full-library search, Esc to clear), clickable per-item tag filter with a
  dismissible chip, "Load more" button + auto-load on scroll
  (IntersectionObserver, 50 per page), newest/oldest sort toggle, keyboard
  navigation (`/` focuses search, `↑`/`↓` move, Enter opens, Esc clears), and
  a "matched n / total N" count line. All new strings in both EN and 繁體中文.
- **Demo mock parity** — the static demo's `mock.js` mirrors the envelope,
  pagination params, and the new `/search`, `/:id`, `/tags` routes.

### Changed
- **`GET /api/history` response shape** — now the `{ items, total, all }`
  envelope instead of a full-content array. Its only consumers (the SPA and
  the demo mock) were updated in the same release; the SPA fetches full
  markdown per memo only when needed.
- `searchMemos` results now include `title` (shared by the agent tool and the
  UI search).
- Test suite grew from 59 to 75 tests (slug, store limit/backfill/pagination,
  search title).

## [1.5.0] - 2026-07-02

Open-source release readiness: implements every finding from the full code review in
`docs/md-memo-code-review.md` (R-01–R-02 release blockers, S-01–S-05 security,
B-01–B-04 bugs, P-01–P-04 polish; P-05 git-history secret scan performed — clean).
Also ships the new "Colophon" visual redesign (see Changed below).

### Added
- **`LICENSE` (MIT)** plus `package.json` metadata — `license`, `author`, `repository`,
  `keywords`, and `engines` (`node >= 22.9.0`, required by `--env-file-if-exists`);
  README now states the Node prerequisite. (R-01/R-02)
- **`HOST` environment variable** for the bind address (default stays `127.0.0.1`);
  set `HOST=0.0.0.0` for Railway/Render/Docker deploys — documented in the README
  config table and `.env.sample`. (B-01)
- **CI workflow** `.github/workflows/test.yml` — runs `npm test` + `npm run smoke` on
  pushes to main and on pull requests. (P-02)
- **`CONTRIBUTING.md` / `SECURITY.md`** community files. (P-03)
- **`docs/md-memo-code-review.md`** — the review report that drove this release.

### Security
- **Stored XSS on public permalink pages fixed (3 vectors)** — proper HTML escaping for
  preview/`og:title`, tags, and a `</script>`-breakout-safe JSON blob in
  `src/permalink.js`, with regression tests. (S-01)
- **`marked` output sanitized with DOMPurify** in both independent render environments
  (permalink template and SPA — all four `marked.parse` call sites). (S-02)
- **CSRF guard on `POST /api/history/clear`** — requires a JSON content type (415
  otherwise); the SPA caller sends it explicitly. (S-03)
- **Timing-safe password comparison** — `checkPassword` now compares SHA-256 digests via
  `crypto.timingSafeEqual`. (S-04)
- **Generic 500 responses** — internal error text is logged server-side only. (S-05)

### Fixed
- **`/api/agent/apply` validates input** — `create_memo`/`merge_memos` without a
  non-empty `markdown` now return `ok: false` (HTTP 400) instead of an uncaught
  `TypeError` 500. (B-02)
- **Monotonic ids** — `store.js`/`sessions.js` ids no longer collide on same-millisecond
  inserts. (B-03)
- **`parseTags` accepts tags containing `>`** — lazy regex match up to `-->`. (B-04)

### Changed
- **New "Colophon" visual design** — a warm, paper-like aesthetic applied across the SPA
  (`public/index.html`) and the server-rendered permalink page (`src/permalink.js`).
  A three-typeface system (**Instrument Serif** for the wordmark and headings,
  **Literata** for body / reading text, **IBM Plex Mono** for all UI chrome), a warm
  parchment palette with a golden-brown accent (Light "Writing") plus a charcoal Dark
  "Reading" theme, square corners, diamond bullets, an open writing surface with a single
  left margin rule (no boxed textarea), and mono small-caps section labels. Purely a
  restyle — no DOM, API, agent-loop, routing, or data-flow changes. Imported from a
  claude.ai/design project via the Design MCP. The Memo List panel widens to 372px and the
  reading column is left-aligned against the margin rule. Zero new dependencies — fonts
  load from the Google Fonts CDN, consistent with the existing `marked` CDN usage; the
  static GitHub Pages demo picks up the SPA restyle automatically and regenerates the
  permalink pages with the new styling.
- **Light "Writing" is now the default theme** (previously Dark). An explicit `dark`
  choice still persists via localStorage — the init flips to `applyTheme(localStorage
  .getItem('md-memo-theme') !== 'dark')`.
- **Char count is scoped to writing contexts** — the footer counter now shows only in Edit
  and Combine modes (driven by a `body.mode-*` class set in `setMode()`), so it no longer
  overlaps the memo's tags shown in View mode.
- **Top-bar layout** — the theme (☀️/🌙) and language (中文/EN) toggles moved to the right
  of the ✨ Format button.
- **Backend agent strings follow `AGENT_LANG`** — proposal summaries and the step-limit
  message default to English; `zh*` locales (default `zh-TW`) keep the original
  Traditional Chinese. (P-01)
- README gains a Design Docs section pointing to `specs/` and `docs/plans/`. (P-04)
- Test suite grew from 50 to 59 tests (regression coverage for the fixes above).

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
