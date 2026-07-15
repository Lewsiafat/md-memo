---
name: md-memo-api
description: >-
  Read and mutate an md-memo notebook over its REST API (curl/HTTP, not the web UI).
  USE THIS whenever the user wants to list/read/delete memos, save text verbatim as a
  memo, AI-format raw text into markdown + tags, change a memo's tags or content, run
  the notebook agent (search/merge/link/retag over memos) or apply its proposals,
  manage saved agent sessions, get a shareable permalink, or clear/back up the
  notebook — and more generally whenever they mention md-memo, its memos/tags/agent,
  or its API. Maps each task to the right one of the 10 endpoints, drives the SSE
  agent stream and the propose→apply two-phase write flow, and knows the
  validation/error cases and footguns. Trigger on "md-memo", "memo", "notebook",
  "format this note", "agent proposal". Reach for this instead of guessing the API
  shape or scraping the SPA.
---

# md-memo REST API

A no-database Express app: one JSON file of "history" entries (memos), newest first,
**hard-capped at 50**. A memo is:

```json
{ "id": 1784085528198, "createdAt": "…ISO…", "raw": "original input or \"\"",
  "markdown": "…", "tags": ["a","b"], "preview": "first non-empty line",
  "sources": [ids], "links": [ids] }
```

`sources`/`links` exist only on merged/linked memos. `id` is a millisecond timestamp —
**never guess ids; resolve them from `GET /api/history` first.**

This file is the operating guide. For the exhaustive per-endpoint contract — every
status code, exact request/response JSON, SSE event shapes, and copy-paste curl for
all 10 endpoints — read **`references/api.md`**.

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
| List / read / search memos, resolve an id            | `GET /api/history` (the ONLY read; filter yourself) |
| Save text **verbatim** as a new memo (no AI)         | `POST /api/agent/apply` `{"action":"create_memo",…}` |
| AI-format raw text into a new memo (markdown + tags) | `POST /api/format` `{"text":…}`                  |
| AI-reformat **over** an existing memo                | `POST /api/format` `{"text":…, "id":N}`          |
| Edit a memo's markdown and/or tags verbatim (no AI)  | `PUT /api/history/:id`                           |
| Retag a memo                                         | `PUT /api/history/:id` `{"tags":[…]}` (markdown untouched) |
| Delete one memo                                      | `DELETE /api/history/:id`                        |
| Wipe the notebook (auto-backup first)                | `POST /api/history/clear`                        |
| Ask the notebook agent (multi-step search/synthesis) | `POST /api/agent` (SSE stream)                   |
| Execute an agent write proposal                      | `POST /api/agent/apply` (proposal's `{action,args}` verbatim) |
| Merge or link memos without running the agent        | `POST /api/agent/apply` with `merge_memos` / `link_memos` |
| List / save / delete saved agent sessions            | `GET|POST /api/sessions`, `DELETE /api/sessions/:id` |
| Share a memo publicly                                | link to `/md-memo/m/:id` (HTML page, no auth)    |

There is **no `POST /api/history`** — verbatim creation goes through
`agent/apply create_memo` (the web UI itself does this). There is **no search
endpoint and no pagination** — `GET /api/history` returns everything (≤50); grep the
JSON yourself.

## Resolve ids first (the cardinal pattern)

```bash
# id by title/preview
curl -s "$API/history" | jq '.[] | select(.preview|test("Roadmap";"i")) | .id'
# id + tags overview
curl -s "$API/history" | jq 'map({id, preview, tags})'
```

## Common workflows

**Save text verbatim (no AI rewrite):**
```bash
curl -s -X POST "$API/agent/apply" -H 'Content-Type: application/json' \
  -d '{"action":"create_memo","args":{"markdown":"# Title\n\nbody","tags":["a","b"]}}'
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
# Grab each `proposal` event's data: {"action":"merge_memos","args":{…},"summary":"…"}
curl -s -X POST "$API/agent/apply" -H 'Content-Type: application/json' \
  -d '{"action":"merge_memos","args":{…proposal args verbatim…}}'
```
Confirm proposals with the user before applying — that's the contract the two-phase
design exists for.

## Footguns — read before mutating

- **The 50-entry cap evicts silently.** Every successful create (`format` without id,
  `create_memo`, `merge_memos`) prepends and slices to 50 — at capacity, the OLDEST
  memo is permanently dropped with no warning, no backup. Check
  `curl -s "$API/history" | jq length` before bulk-creating.
- **`POST /api/format` with an `id` overwrites that memo** (markdown + tags; `raw`
  keeps the ORIGINAL input). And if the `id` doesn't exist it does NOT 404 — it
  silently creates a NEW memo instead. Only pass `id` when you've resolved it.
- **PUT is omit/null-preserve, `""`-overwrite.** `PUT /api/history/:id` updates only
  the fields present: omitted or `null` keeps the old value; but `"markdown":""` or
  `"tags":[]` are real values that wipe. It is NOT a full-replace — don't resend
  unchanged fields.
- **`DELETE /api/history/:id` always returns `{"ok":true}`**, even for nonexistent
  ids — you cannot detect a typo'd id from the response. Verify with `GET /api/history`
  after deleting if it matters.
- **`POST /api/history/clear` demands `Content-Type: application/json`** (else 415)
  and is the ONLY destructive op with a safety net: it first copies the file to a
  timestamped `data/history.<ts>.bak.json` and returns `{backedUp, count, backupFile}`.
  Still confirm with the user first.
- **Agent errors arrive INSIDE the SSE stream, not as HTTP errors.** `POST /api/agent`
  returns 200 + headers immediately; a missing API key or upstream failure shows up as
  an `error` event. Always `curl -N` (unbuffered) and watch for `event: error`.
- **Agent write tools don't write.** `create_memo`/`merge_memos`/`link_memos`/
  `retag_memo` inside the agent loop only emit `proposal` events. Nothing persists
  until you POST the proposal to `/api/agent/apply`. The agent stops after 8 steps.
- **Apply validates ids; retag replaces wholesale.** `merge_memos`/`link_memos`/
  `retag_memo` 400 on unknown ids (`{"ok":false,"error":…}`). `retag_memo` (and PUT
  with `tags`) REPLACES the whole tag list — to add a tag, read the current tags and
  send the union.
- **Tags are conventionally lowercase** (the AI generates lowercase; nothing enforces
  it on writes). Match case exactly when filtering.
- **`/m/:id` returns HTML, not JSON** — it's the share page. Don't parse it; use
  `GET /api/history` for data.

## Pre-flight checklist before any mutation

1. URL includes the full `${BASE_PATH}/api` subpath (default `/md-memo/api`).
2. `Content-Type: application/json` header set; body is valid JSON (≤1 MB).
3. Target id resolved via `GET /api/history` — never guessed.
4. Creating? Checked the count — at 50 the oldest memo gets evicted.
5. PUT/format: sending ONLY the fields you mean to change; no accidental `""`/`id`.
6. Clear: user confirmed; content type is JSON.
7. Auth-enabled deployment? `-u x:"$PASSWORD"` on every call except `/m/:id`.

## Full contract

For exact request/response JSON, every status code, SSE event-by-event shapes,
apply-action semantics, and copy-paste curl for all 10 endpoints, see
**`references/api.md`**. Consult it whenever unsure of a field, default, or error.
