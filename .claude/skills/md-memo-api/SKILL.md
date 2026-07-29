---
name: md-memo-api
description: >-
  Read and mutate an md-memo notebook over its REST API (curl/HTTP, not the web UI).
  USE THIS whenever the user wants to list/search/read/delete memos, save text
  verbatim as a memo, AI-format raw text into markdown + tags, change a memo's tags
  or content, list all tags, run the notebook agent (search/merge/link/retag over
  memos) or apply its proposals, manage saved agent sessions, get a shareable
  permalink, or clear/back up the notebook — and more generally whenever they mention
  md-memo, its memos/tags/agent, or its API. Maps each task to the right endpoint,
  drives the SSE agent stream and the propose→apply one-time-id flow, and knows the
  validation/error cases and footguns. Trigger on "md-memo", "memo", "notebook",
  "format this note", "agent proposal". Reach for this instead of guessing the API
  shape or scraping the SPA.
---

# md-memo REST API

A no-database Express app: one JSON file of "history" entries (memos), newest first,
capped at **`HISTORY_LIMIT` (default 1000)**. A memo is:

```json
{ "id": 1784085528198, "createdAt": "…ISO…", "raw": "original input or \"\"",
  "markdown": "…", "tags": ["a","b"], "title": "derived from markdown",
  "slug": "unique-cjk-friendly-slug", "preview": "first non-empty line",
  "sources": [ids], "links": [ids] }
```

`sources`/`links` exist only on merged/linked memos. `id` is a millisecond timestamp —
**never guess ids; resolve them via the list or search endpoints first.**

This file is the operating guide. For the exhaustive per-endpoint contract — every
status code, exact request/response JSON, SSE event shapes, and copy-paste curl —
read **`references/api.md`**.

## Base URL & config

```
http://localhost:10026/md-memo/api
        └─ PORT ─┘    └ BASE_PATH ┘
```

- Defaults: `PORT=10026`, `BASE_PATH=/md-memo`. The API always lives at
  `${BASE_PATH}/api` — **nothing is served at `/` or bare `/api`; missing the subpath
  gets you 404 (or the SPA's HTML instead of JSON). Check this first on any weird 404.**
- Set once and reuse: `API="http://localhost:10026/md-memo/api"`
- **Auth:** if the deployment sets `AUTH_ENABLED=true`, every route needs HTTP Basic
  Auth — `curl -u x:"$PASSWORD"` (username is ignored) — **except** the public
  permalink pages `/md-memo/m/:id`. No auth → `401 Authentication required`.
- AI endpoints (`/api/format`, `/api/agent`) need `OPENROUTER_API_KEY` on the
  **server**; everything else works without it.

## Task → endpoint decision guide

| You want to…                                         | Call                                             |
|------------------------------------------------------|--------------------------------------------------|
| Browse / page through memos (lightweight, no bodies) | `GET /api/history?limit=&offset=&tag=&order=`    |
| Search the whole library                             | `GET /api/history/search?q=…`                    |
| Read ONE memo in full (markdown + raw)               | `GET /api/history/:id`                           |
| List all tags with counts                            | `GET /api/tags`                                  |
| Save text **verbatim** as a new memo (no AI)         | `POST /api/history` `{"markdown":…, "tags":…}`   |
| AI-format raw text into a new memo (markdown + tags) | `POST /api/format` `{"text":…}`                  |
| AI-reformat **over** an existing memo                | `POST /api/format` `{"text":…, "id":N}`          |
| Edit a memo's markdown and/or tags verbatim (no AI)  | `PUT /api/history/:id`                           |
| Retag a memo                                         | `PUT /api/history/:id` `{"tags":[…]}` (markdown untouched) |
| Delete one memo                                      | `DELETE /api/history/:id`                        |
| Wipe the notebook (auto-backup first)                | `POST /api/history/clear`                        |
| Ask the notebook agent (multi-step search/synthesis) | `POST /api/agent` (SSE stream)                   |
| Execute an agent write proposal                      | `POST /api/agent/apply` `{"id":"<proposal id>"}` |
| Merge or link memos                                  | agent-only: ask via `POST /api/agent`, then apply the proposal — there is NO direct REST path |
| List / save / delete saved agent sessions            | `GET|POST /api/sessions`, `DELETE /api/sessions/:id` |
| Share a memo publicly                                | link to `/md-memo/m/:id` (HTML page, no auth)    |

## Resolve ids first (the cardinal pattern)

The list endpoint is **paginated and lightweight** (`{items, total, all}`; items carry
`id/title/slug/preview/tags/createdAt` but **no markdown**). Resolve, then fetch:

```bash
# id by title/keyword — search scores title hits 3× body hits
curl -s "$API/history/search?q=roadmap" | jq '.items[] | {id, title}'
# or browse a page
curl -s "$API/history?limit=50" | jq '.items | map({id, title, tags})'
# then read the one you want in full
curl -s "$API/history/$ID" | jq .
```

## Common workflows

**Save text verbatim (no AI rewrite):**
```bash
curl -s -X POST "$API/history" -H 'Content-Type: application/json' \
  -d '{"markdown":"# Title\n\nbody","tags":["a","b"]}'
# → {"ok":true,"id":1784085528198}
```

**AI-format raw text into a memo:**
```bash
curl -s -X POST "$API/format" -H 'Content-Type: application/json' \
  -d '{"text":"raw unstructured notes …"}'
# → {"markdown":"…","tags":["…"],"id":N,"truncated":false}
```
If `truncated:true`, the model hit its output cap — markdown is incomplete and tags
are usually missing. The raw input is still stored in the entry's `raw`.

**Retag without touching content** (PUT is a partial update — send ONLY what changes):
```bash
curl -s -X PUT "$API/history/$ID" -H 'Content-Type: application/json' \
  -d '{"tags":["project","idea"]}'
# → {"ok":true,"entry":{…full updated entry…}} — echoes the result, so no verify GET
# needed. Unknown id → 404 {"ok":false,"error":"Memo not found"} (PUT never creates).
```

**Run the agent, then apply its proposal** (two-phase — nothing is written until you
apply):
```bash
curl -sN -X POST "$API/agent" -H 'Content-Type: application/json' \
  -d '{"message":"merge my two memos about Q1 planning"}'
# SSE stream: start / message / tool_call / tool_result / proposal / answer / done / error
# Each proposal event: {"id":"<uuid>","action":"merge_memos","args":{…},"summary":"…"}
curl -s -X POST "$API/agent/apply" -H 'Content-Type: application/json' \
  -d '{"id":"<that uuid>"}'
```
The proposal `id` is **one-time and in-memory**: applying consumes it (second apply →
400), a server restart drops all pending proposals, and the args live server-side so
you cannot modify them — to change anything, re-run the agent. Confirm proposals with
the user before applying — that's the contract the two-phase design exists for.

## Footguns — read before mutating

- **`GET /api/history` no longer returns everything.** It's a paginated envelope
  `{items, total, all}` — default page 50, max 200 — and items have NO
  markdown/raw. Iterate with `offset` (or use `search`/`:id`); assuming one call =
  whole library silently misses older memos. `total` counts after the `tag` filter;
  `all` is the whole library.
- **The cap evicts silently.** Every successful create prepends and slices to
  `HISTORY_LIMIT` (env-configurable, default 1000) — at capacity, the OLDEST memo is
  permanently dropped with no warning. Check `jq .all` against the limit before
  bulk-creating.
- **`POST /api/format` with an `id` overwrites that memo** (markdown + tags; `raw`
  keeps the ORIGINAL input). And if the `id` doesn't exist it does NOT 404 — it
  silently creates a NEW memo instead. Only pass `id` when you've resolved it.
- **PUT is omit/null-preserve, `""`-overwrite.** `PUT /api/history/:id` updates only
  the fields present: omitted or `null` keeps the old value; but `"markdown":""` or
  `"tags":[]` are real values that wipe. It is NOT a full-replace — don't resend
  unchanged fields. Changing markdown recomputes `title`/`preview`; `slug` never
  changes after creation.
- **Proposal ids are one-time, expiring, and localized on failure.**
  `POST /api/agent/apply` with a consumed/unknown/restart-lost id → 400 with a
  human message in `AGENT_LANG` (default zh-TW: `提案已失效或不存在`) — don't
  string-match it; match on `ok:false` + status 400. Only ~200 proposals are held;
  old ones fall off.
- **Invalid write proposals never reach you.** The agent validates at propose time —
  bad args go back to the model as a `tool_result` error and no `proposal` event is
  emitted. Every proposal you see has already passed validation (it's re-validated at
  apply, since history may have changed in between).
- **`DELETE /api/history/:id` always returns `{"ok":true}`**, even for nonexistent
  ids — you cannot detect a typo'd id from the response. Verify via `GET /api/history/:id`
  (404 = really gone) if it matters.
- **`POST /api/history/clear` demands `Content-Type: application/json`** (else 415)
  and is the ONLY destructive op with a safety net: it first copies the file to a
  timestamped `data/history.<ts>.bak.json` and returns `{backedUp, count, backupFile}`.
  Still confirm with the user first.
- **Agent errors arrive INSIDE the SSE stream, not as HTTP errors.** `POST /api/agent`
  returns 200 + headers immediately; a missing API key or upstream failure shows up as
  an `error` event. Always `curl -N` (unbuffered) and watch for `event: error`.
  Disconnecting mid-stream aborts the agent run server-side. The loop stops after 8
  steps.
- **Tags are conventionally lowercase** (the AI generates lowercase; nothing enforces
  it on writes). Match case exactly when filtering (`?tag=` is exact-match).
- **`/m/:id` returns HTML, not JSON** — it's the share page. Don't parse it; use the
  API for data.

## Pre-flight checklist before any mutation

1. URL includes the full `${BASE_PATH}/api` subpath (default `/md-memo/api`).
2. `Content-Type: application/json` header set; body is valid JSON (≤1 MB).
3. Target id resolved via list/search/`:id` — never guessed.
4. Creating? Checked `.all` against `HISTORY_LIMIT` — at the cap the oldest memo
   gets evicted.
5. PUT/format: sending ONLY the fields you mean to change; no accidental `""`/`id`.
6. Applying? The proposal id is fresh (this run, not yet applied, no server restart
   since).
7. Clear: user confirmed; content type is JSON.
8. Auth-enabled deployment? `-u x:"$PASSWORD"` on every call except `/m/:id`.

## Full contract

For exact request/response JSON, every status code, SSE event-by-event shapes,
pagination envelopes, and copy-paste curl for every endpoint, see
**`references/api.md`**. Consult it whenever unsure of a field, default, or error.
