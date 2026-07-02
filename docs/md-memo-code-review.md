# Code Review — `md-memo` v1.4.1 (Open-Source MIT Release Readiness)

```yaml
repo:        https://github.com/Lewsiafat/md-memo
commit:      1a6089e121e5b9e8fd0b3d9b3b9087bd22e4e860 (2026-07-01, main)
review_date: 2026-07-02
scope:       full source review + tests run + dependency audit + dynamic XSS verification
verdict:     NOT READY — 2 release blockers, 2 high-severity security findings.
             All are small, localized fixes. Estimated total effort: ~2–4 hours.
```

**How to use this report (for AI agents):** Each finding has a stable ID, exact `file:line`
references (valid at the commit above), a concrete fix, and acceptance criteria. Fix in
priority order: `R-*` (release blockers) → `S-*` (security) → `B-*` (bugs) → `P-*` (polish).
Run `npm test` after every change — the suite (50 tests) currently passes and must stay green.
Do not "fix" anything listed under [What is already good](#what-is-already-good).

---

## Summary of findings

| ID | Severity | Category | Title | Files |
|------|----------|----------|-------|-------|
| R-01 | 🔴 Blocker | Licensing | No `LICENSE` file despite README claiming MIT | repo root |
| R-02 | 🔴 Blocker | Packaging | `package.json` missing `license`, `repository`, `engines`; Node ≥ 22.9 requirement undocumented | `package.json`, `README.md` |
| S-01 | 🔴 High | Security/XSS | Stored XSS on public permalink pages (3 vectors, verified) | `src/permalink.js` |
| S-02 | 🟠 High | Security/XSS | `marked.parse()` output injected without sanitization | `src/permalink.js`, `public/index.html` |
| S-03 | 🟡 Medium | Security/CSRF | `POST /api/history/clear` is CSRF-able (no body/origin check) | `src/index.js:141` |
| S-04 | 🟡 Medium | Security/Auth | Timing-unsafe password comparison; no brute-force throttling | `src/auth.js:11` |
| S-05 | 🔵 Low | Security/Info | 500 responses leak internal error messages | `src/index.js:92` |
| B-01 | 🟠 High | Bug | Hardcoded `127.0.0.1` bind breaks the documented Railway/Render deploy path | `src/index.js:176` |
| B-02 | 🟡 Medium | Bug | `/api/agent/apply` accepts unvalidated input → uncaught `TypeError` → 500 | `src/tools.js`, `src/store.js:35` |
| B-03 | 🔵 Low | Bug | `Date.now()` IDs can collide on rapid inserts | `src/store.js:30`, `src/sessions.js:29` |
| B-04 | 🔵 Low | Bug | `parseTags` regex breaks if a tag contains `>` | `src/format.js` |
| P-01 | 🟡 Medium | i18n | Hardcoded Traditional Chinese strings despite configurable `AGENT_LANG` | `src/agent.js:76`, `src/tools.js:168–174` |
| P-02 | 🟡 Medium | CI | No CI workflow runs the test suite | `.github/workflows/` |
| P-03 | 🔵 Low | Community | Missing `CONTRIBUTING.md` / `SECURITY.md` | repo root |
| P-04 | 🔵 Low | Hygiene | Internal dev artifacts shipped (`specs/`, `docs/superpowers/`) — decide intentionally | repo root |
| P-05 | ⚪ Manual | Hygiene | Scan full git history for leaked secrets before publicizing | git history |

---

## 🔴 Release blockers

### R-01 — No `LICENSE` file

- **Files:** repo root (missing file); `README.md:84–86` says "## License / MIT"
- **Problem:** The project claims MIT but ships no license text. Without a `LICENSE` file the
  code is legally "all rights reserved" — users and contributors have no actual grant of rights.
  GitHub will also not detect/display the license.
- **Fix:** Create `LICENSE` at the repo root containing the standard MIT license text:

  ```text
  MIT License

  Copyright (c) 2026 Lewsiafat

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
  ```

  > Confirm the copyright holder name/year with the repo owner if possible; `Lewsiafat` + `2026` is the reasonable default.
- **Acceptance:** `LICENSE` exists at root; GitHub repo page shows "MIT license".

### R-02 — `package.json` metadata + Node version requirement

- **Files:** `package.json`; `README.md` (Quick Start section)
- **Problem:**
  1. Missing `license`, `repository`, `author`, `keywords` fields.
  2. Missing `engines`. The `start`/`dev` scripts use `--env-file-if-exists`, which was added
     in **Node.js v22.9.0**. On older Node the app fails at startup with a confusing
     "bad option" error. Neither `package.json` nor the README states this.
- **Fix (package.json):**

  ```json
  {
    "name": "md-memo",
    "version": "1.4.1",
    "type": "module",
    "description": "Quick AI-powered markdown memo tool",
    "license": "MIT",
    "author": "Lewsiafat",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/Lewsiafat/md-memo.git"
    },
    "engines": {
      "node": ">=22.9.0"
    },
    "keywords": ["markdown", "memo", "notes", "ai", "openrouter", "agent"]
  }
  ```

  (Keep existing `main`, `scripts`, `dependencies` unchanged.)
- **Fix (README):** In "Quick Start", add a prerequisites line: `Requires Node.js >= 22.9`.
- **Acceptance:** `npm pkg get license engines.node` returns `"MIT"` and `">=22.9.0"`; README states the Node requirement.

---

## Security findings

### S-01 — Stored XSS on public permalink pages (verified, 3 vectors)

- **File:** `src/permalink.js`
- **Severity rationale:** Permalink pages (`/m/:id`) are **intentionally public even when
  `AUTH_ENABLED=true`** and are designed to be shared. Memo content originates from LLM output
  (which can be steered by whatever text a user pastes in — prompt injection) and from the
  unauthenticated-by-default HTTP API. Any script that lands in a memo executes in every
  visitor's browser.
- **Verified vectors** (reproduced during review by calling `renderPermalink()` directly):
  1. **`</script>` breakout** — `src/permalink.js:83`:
     ```js
     const raw = ${JSON.stringify(entry.markdown)};
     ```
     `JSON.stringify` does **not** escape `/`, so a memo containing
     `</script><script>alert(1)</script>` terminates the inline script block and injects a new one.
  2. **Unescaped tags** — `src/permalink.js:5–6`:
     ```js
     const tagsHtml = (entry.tags || [])
       .map(t => `<span class="tag">${t}</span>`).join('');
     ```
     A tag like `<img src=x onerror=alert(2)>` is emitted verbatim. Tags can be set via
     `PUT /api/history/:id`, the retag agent tool, or the AI's `<!-- tags: -->` line.
  3. **Attribute injection in `<title>`/`og:title`** — `src/permalink.js:4` escapes only
     `<` and `>` (not `"` or `&`); the value is interpolated into
     `content="${preview}"` at line 18, so a preview containing `"` breaks out of the attribute.
- **Fix:** Add one proper escaper and use it everywhere; neutralize `<` inside the JSON blob.

  ```js
  // src/permalink.js — add at top
  const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // line 4 — replace the ad-hoc escaping:
  const preview = escapeHtml((entry.preview || '').replace(/^#+\s*/, ''));

  // lines 5–6 — escape tags:
  const tagsHtml = (entry.tags || [])
    .map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  // line 83 — prevent </script> breakout:
  const raw = ${JSON.stringify(entry.markdown ?? '').replace(/</g, '\\u003c')};
  ```
- **Acceptance:** Add a unit test in `test/permalink.test.mjs` asserting that for an entry with
  `markdown: '</script><script>alert(1)</script>'`, `tags: ['<img src=x onerror=1>']`, and
  `preview: 'x" onload="alert(1)'`, the rendered HTML contains **none** of:
  `</script><script>`, `<img src=x`, `content="x" onload=`. Existing tests stay green.

### S-02 — Markdown rendered via `marked.parse()` without sanitization

- **Files:** `src/permalink.js:84` (`marked.parse(raw)` into `innerHTML`);
  `public/index.html:1167, 1291, 1645` (preview, quick-view, agent answers)
- **Problem:** `marked` passes raw HTML in markdown straight through. Even after S-01 is fixed,
  a memo whose *markdown body* contains `<img src=x onerror=...>` executes on the public
  permalink page and in the SPA. Combined with the LLM content path, this is a realistic
  stored-XSS channel.
- **Fix (minimal, no build step — matches the project's stack):** load DOMPurify from the same
  CDN already used for `marked`, and wrap every `marked.parse` call.
  - In `src/permalink.js`, next to the existing marked `<script>` tag (line 23), add:
    ```html
    <script src="https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js"></script>
    ```
    and change line 84 to:
    ```js
    document.getElementById('content').innerHTML = DOMPurify.sanitize(marked.parse(raw));
    ```
  - In `public/index.html`, add the same `<script>` tag next to the marked include (line 10),
    and wrap the three `marked.parse(...)` call sites (lines 1167, 1291, 1645) in
    `DOMPurify.sanitize(...)`.
  - Note for the demo build: `scripts/build-demo.mjs` copies `public/index.html` verbatim, so
    no build-script change is needed, but run `npm run build:demo` to confirm the anchor string
    at `scripts/build-demo.mjs:23` still matches.
- **Acceptance:** A memo containing `<img src=x onerror=alert(1)>` renders as inert text/image
  on the permalink page and in the SPA preview; `npm test` and `npm run build:demo` succeed.
- **Optional hardening (separate commit):** add `integrity`/`crossorigin` (SRI) attributes to
  the CDN script tags, or vendor the two libraries into `public/` to remove the CDN dependency.

### S-03 — CSRF on `POST /api/history/clear`

- **File:** `src/index.js:141–143`
- **Problem:** The handler reads no request body, so a plain cross-origin
  `<form method="POST" action="http://127.0.0.1:10026/md-memo/api/history/clear">` submitted by
  any website wipes the visitor's local history (localhost binding does not protect against the
  victim's own browser). Impact is softened by the automatic backup (`store.js clearHistory`),
  but it is still an unauthorized state change. The other mutating endpoints are incidentally
  protected because they require a parsed JSON body, which HTML forms cannot send.
- **Fix (minimal):** require a JSON content type on this route:
  ```js
  app.post(`${BASE_PATH}/api/history/clear`, (req, res) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
    res.json(clearHistory());
  });
  ```
  and update the frontend caller in `public/index.html` to send
  `headers: { 'Content-Type': 'application/json' }, body: '{}'` on that fetch (search for
  `history/clear`).
- **Acceptance:** `curl -X POST .../api/history/clear` without a JSON content type returns 415;
  the Clear All button in the UI still works.

### S-04 — Timing-unsafe password comparison

- **File:** `src/auth.js:11` (`return password === expected;`)
- **Problem:** String `===` short-circuits on the first differing character, enabling timing
  side-channel attacks; there is also no throttling on failed attempts. Low practical risk for
  a self-hosted single-user tool, but cheap to fix and expected in released code.
- **Fix:** compare fixed-length digests:
  ```js
  import crypto from 'node:crypto';

  export function checkPassword(authHeader, expected) {
    if (!expected) return false;
    const [scheme, encoded] = (authHeader || '').split(' ');
    if (scheme !== 'Basic' || !encoded) return false;
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const password = decoded.slice(decoded.indexOf(':') + 1);
    const a = crypto.createHash('sha256').update(password).digest();
    const b = crypto.createHash('sha256').update(expected).digest();
    return crypto.timingSafeEqual(a, b);
  }
  ```
- **Acceptance:** `test/auth.test.mjs` still passes (behavioral contract unchanged).

### S-05 — Internal error messages leaked to clients

- **File:** `src/index.js:92` (`res.status(500).json({ error: err.message })`)
- **Problem:** Raw exception text (which can include file paths or upstream response details)
  is returned to the client. `console.error` already logs the full error server-side.
- **Fix:** `res.status(500).json({ error: 'Internal error' })` (keep the `console.error`).
- **Acceptance:** Forced failure (e.g., unset `OPENROUTER_API_KEY` mid-request path) returns a
  generic message; server log still shows the detail.

---

## Bugs / correctness

### B-01 — Hardcoded `127.0.0.1` bind contradicts documented deploy targets

- **Files:** `src/index.js:176` (`app.listen(PORT, '127.0.0.1', ...)`);
  `README.md` "Self-hosting" section (Railway / Render: "deploy directly")
- **Problem:** Railway, Render, Docker, and most PaaS health checks require binding to
  `0.0.0.0`. As shipped, the documented "deploy directly" path fails with an unreachable app.
  Localhost-only is the *right default* for a laptop, so make it configurable rather than
  changing the default.
- **Fix:**
  ```js
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`md-memo running on http://${HOST}:${PORT}${BASE_PATH}`);
  });
  ```
  Add `HOST` to the README config table and to `.env.sample` with a comment:
  `# Set HOST=0.0.0.0 when deploying to Railway/Render/Docker (enable AUTH first!)`.
- **Acceptance:** `HOST=0.0.0.0 npm start` binds publicly; default behavior unchanged.

### B-02 — `/api/agent/apply` crashes on missing `markdown` (unvalidated input)

- **Files:** `src/index.js:121–127` (route), `src/tools.js` `applyProposal`
  (`create_memo` / `merge_memos` cases), `src/store.js:35`
  (`preview: markdown.split(...)` — throws `TypeError` when `markdown` is `undefined`)
- **Problem:** The apply endpoint trusts client-supplied `action`/`args`. Calling it with
  `{ "action": "create_memo", "args": {} }` throws an uncaught `TypeError` → Express 500 HTML
  page. Same for `merge_memos` with valid `source_ids` but no `markdown`.
- **Fix (in `src/tools.js` `applyProposal`, keeping validation next to the mutation):**
  ```js
  case 'create_memo': {
    if (typeof args.markdown !== 'string' || !args.markdown.trim())
      return { ok: false, error: 'markdown (non-empty string) required' };
    // ...existing code
  }
  case 'merge_memos': {
    if (typeof args.markdown !== 'string' || !args.markdown.trim())
      return { ok: false, error: 'markdown (non-empty string) required' };
    // ...existing code
  }
  ```
  The route already maps `ok: false` → 400, so no route change needed.
- **Acceptance:** Add tests in `test/tools.test.mjs`: `applyProposal({action:'create_memo',args:{}})`
  and `applyProposal({action:'merge_memos',args:{source_ids:[<existing id>]}})` return
  `{ ok: false }` and do not throw.

### B-03 — `Date.now()` IDs can collide

- **Files:** `src/store.js:30`, `src/sessions.js:29`
- **Problem:** Two inserts within the same millisecond (e.g., a user confirming several agent
  proposals in quick succession) produce duplicate `id`s; delete/update/permalink then act on
  the wrong entry. Low probability, silent data corruption when it happens.
- **Fix (minimal, keeps numeric ids and the existing sort semantics):**
  ```js
  // store.js — module scope
  let lastId = 0;
  function nextId() {
    const now = Date.now();
    lastId = now > lastId ? now : lastId + 1;
    return lastId;
  }
  // createEntry: id: nextId(),
  ```
  Apply the same pattern in `sessions.js`.
- **Acceptance:** New test: two consecutive `insertEntry(createEntry(...))` calls yield distinct ids.

### B-04 — `parseTags` regex fails on tags containing `>`

- **File:** `src/format.js` (`/<!--\s*tags:\s*([^>]+?)-->/i`)
- **Problem:** `[^>]` stops at the first `>`, so a model emitting a tag like `c>d` breaks
  extraction and the raw comment leaks into the markdown. Cosmetic; models rarely do this.
- **Fix:** use a lazy match up to the closing marker: `/<!--\s*tags:\s*(.*?)-->/is` for the
  capture, and `/<!--\s*tags:.*?-->/gis` for the removal.
- **Acceptance:** New case in `test/format.test.mjs` with a `>` inside the tags comment.

---

## Polish for open-source release

### P-01 — Hardcoded Traditional Chinese UI strings in the backend

- **Files:** `src/agent.js:76` (max-steps fallback answer);
  `src/tools.js:168–174` (proposal `summary` strings: `建立新筆記…`, `合併…`, `連結…`, `重設…`)
- **Problem:** `AGENT_LANG` makes the *model's* output language configurable, but these
  server-generated strings are always zh-TW. An international user with `AGENT_LANG=en` still
  sees Chinese proposal summaries and the Chinese "step limit reached" message. Confusing for a
  general OSS audience.
- **Fix (pragmatic):** default these strings to English, e.g.
  `New memo (${tags || 'no tags'})`, `Merge ${n} memos into "${title || 'Untitled'}"`,
  `Link ${n} memos`, `Retag #${id} to ${tags}`, and
  `(Reached the ${MAX_STEPS}-step limit; partial progress above.)`.
  Optionally branch on `AGENT_LANG.startsWith('zh')` to keep the current zh-TW strings.
  Note: the SPA has its own i18n layer (`data-i18n` in `public/index.html`) — only these
  backend strings are affected.
- **Acceptance:** With `AGENT_LANG=en`, proposal summaries and the step-limit message are English;
  `test/agent.test.mjs` / `test/tools.test.mjs` updated if they assert on these strings.

### P-02 — No CI for tests

- **Files:** `.github/workflows/` (only `deploy-demo.yml` exists)
- **Problem:** For an OSS repo accepting contributions, PRs are not gated on the (already good)
  test suite.
- **Fix:** add `.github/workflows/test.yml`:
  ```yaml
  name: Tests
  on:
    push:
      branches: [main]
    pull_request:
  permissions:
    contents: read
  jobs:
    test:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: 22
        - run: npm ci
        - run: npm test
        - run: npm run smoke
  ```
- **Acceptance:** Workflow passes on main and runs on PRs.

### P-03 — Missing community files

- Add `CONTRIBUTING.md` (how to run: `npm ci`, `npm test`, `npm run smoke`; PR expectations;
  note that `CLAUDE.md` contains the project conventions) and `SECURITY.md` (private disclosure
  channel, e.g., GitHub Security Advisories). Optional: `CODE_OF_CONDUCT.md`, issue templates.

### P-04 — Internal dev artifacts in the published tree

- **Files:** `specs/` (16 walkthrough/spec files), `docs/superpowers/plans/`, `docs/plans/`
- **Observation, not a defect:** These are development-process artifacts. Keeping them is a
  legitimate choice (they document design history), but decide intentionally: either mention
  them in the README ("see `specs/` for design docs") or move them under `docs/`. `.claude/`
  and `CLAUDE.md` are reasonable to keep for a Claude-Code-driven project.

### P-05 — Manual step: scan git history for secrets before publicizing

- The working tree is clean (verified: no API keys, `.gitignore` covers `.env` and data files),
  but this review used a shallow clone and could not inspect full history. Before promoting the
  repo, run on a full clone:
  ```bash
  git log --all --diff-filter=A --name-only -- .env 'data/history.json' 'data/sessions.json'
  gitleaks detect --source .   # or: trufflehog git file://.
  ```
  If anything real ever landed in history, rotate the key and rewrite history
  (`git filter-repo`) before the release announcement.

---

## What is already good

*(Do not change these as part of remediation.)*

- **Tests:** 50/50 pass (`node --test`), covering store, tools, agent loop, auth, format
  parsing, permalink, sessions, and demo data integrity. Plus a no-API-key smoke test.
- **Dependencies:** a single runtime dependency (`express`, resolved to 4.22.2);
  `npm audit`: **0 vulnerabilities**. Lockfile committed.
- **Secrets hygiene (working tree):** no keys in the tree; `.env.sample` uses placeholders;
  `.gitignore` covers `.env`, `data/*.json`, backups; a `.claude` hook even blocks the
  assistant from reading `.env`.
- **Safe-by-design agent:** write tools only *propose*; mutations require explicit user
  confirmation via `/api/agent/apply`; `clearHistory` always writes a timestamped backup first.
- **Sensible defaults:** localhost bind, 1 MB JSON body limit, auth middleware ordered before
  routes, permalinks deliberately public with the tradeoff documented.
- **Frontend escaping:** the SPA consistently escapes user strings (`escHtml`) in the history
  list, tag cloud, and i18n layer — the gaps are specifically in `src/permalink.js` (S-01) and
  the unsanitized `marked` output (S-02).
- **Docs:** bilingual README/CHANGELOG, config table, demo-site pipeline all clear and accurate
  (except the Node version and `HOST` gaps noted in R-02/B-01).

---

## Suggested fix order (dependency-aware)

1. **R-01, R-02** — LICENSE + package.json/README metadata (no code impact).
2. **S-01** — escape fixes in `src/permalink.js` + regression test.
3. **S-02** — DOMPurify in permalink template and `public/index.html`; re-run `npm run build:demo`.
4. **B-01** — `HOST` env + README/.env.sample update.
5. **B-02, S-03, S-04, S-05** — small backend hardening patches + tests.
6. **P-01** — English default strings (touch tests that assert on summaries).
7. **P-02, P-03** — CI workflow + community files.
8. **B-03, B-04** — low-severity fixes + tests.
9. **P-05** — manual history scan, then tag the release (suggest `v1.5.0`).

After all fixes: `npm test` (expect ≥ 50 passing, plus new regression tests), `npm run smoke`,
`npm run build:demo` must all succeed.
