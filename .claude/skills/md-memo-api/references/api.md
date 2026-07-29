# md-memo API — full contract

Verified against `src/index.js`, `src/store.js`, `src/tools.js`, `src/agent.js`,
`src/proposals.js`, `src/sessions.js`, `src/auth.js`, `src/format.js` (v1.6.2).

## Conventions

- Base: `${BASE_PATH}/api` where `BASE_PATH` defaults to `/md-memo`. Examples below use
  `API="http://localhost:10026/md-memo/api"` and `BASE="http://localhost:10026/md-memo"`.
- All request bodies are JSON (`Content-Type: application/json`), parsed with a **1 MB
  limit** (bigger → 413). Malformed JSON → 400 (Express HTML error page, not JSON).
- **Auth** (only when the server runs with `AUTH_ENABLED=true` + non-empty
  `AUTH_PASSWORD`): HTTP Basic on every route except paths starting `${BASE_PATH}/m/`.
  Username ignored, password checked. Failure → `401`, plain-text body
  `Authentication required`, header `WWW-Authenticate: Basic realm="md-memo", charset="UTF-8"`.
  With auth on, add `-u x:"$PASSWORD"` to every curl below.
  Misconfig (`AUTH_ENABLED=true` but empty password) disables protection entirely (server warns).
- Error envelopes are inconsistent by design — several shapes exist:
  `{"error":"…"}` (format/agent/sessions validation, `GET /history/:id` 404),
  `{"ok":false,"error":"…"}` (PUT 404, raw-create validation, apply failures), and
  plain-text/HTML (auth 401, permalink 404). Don't assume one shape. Apply's
  expired-proposal message is localized via `AGENT_LANG` (default zh-TW).
- Durability: history/sessions files are written atomically (tmp+rename); a corrupted
  JSON file is quarantined to `<name>.corrupt-<ts>.json` and the app continues empty.

## The memo entry object (full form)

```json
{
  "id": 1784085528198,            // ms timestamp; monotonic (same-ms inserts get +1)
  "createdAt": "2026-07-29T09:12:34.567Z",
  "raw": "original input text",   // "" for entries created via POST /api/history or agent proposals
  "markdown": "# …",
  "tags": ["lowercase", "by", "convention"],
  "title": "…",                   // derived from markdown; recomputed when markdown changes
  "slug": "…",                    // unique, CJK-friendly; set once at creation, never changes
  "preview": "# …",               // first non-empty line of markdown; "(empty)" if none
  "sources": [id, id],            // only on merge_memos results
  "links": [id, id]               // only after link_memos
}
```

Storage: one JSON array, newest first, **sliced to `HISTORY_LIMIT` (env, default
1000) on every insert** — the oldest entry is silently evicted at capacity. Updates
never evict and never reorder. Legacy entries get `title`/`slug` backfilled lazily.

---

## GET /api/history — paginated, lightweight list

Query params: `limit` (1–200, default **50**), `offset` (≥0, default 0), `tag`
(exact-match filter), `order` (`desc` default = newest first, `asc` = oldest first).

200 →
```json
{ "items": [ { "id":N, "title":"…", "slug":"…", "preview":"…",
               "tags":["…"], "createdAt":"…" } ],
  "total": 12,   // count AFTER the tag filter
  "all": 34 }    // whole library size
```

**Items carry no `markdown`/`raw`** — fetch `GET /api/history/:id` for bodies. To
walk the whole library, loop `offset += limit` until `offset ≥ total`.

```bash
curl -s "$API/history?limit=200" | jq '{n:.all, first:.items[0].title}'
curl -s "$API/history?tag=project&order=asc" | jq '.items | map(.id)'
```

## GET /api/history/search — full-library search

Query params: `q` (required in practice — empty/missing → `{"items":[]}`), `limit`
(1–50, default **20**). Same scoring as the agent's `search_memos` tool: term
frequency over raw+markdown+tags, title hits weighted 3×, results sorted by score.

200 → `{"items":[{"id":N,"title":"…","preview":"…","tags":["…"],"snippet":"first 160 chars, whitespace-collapsed","createdAt":"…"}]}`

```bash
curl -s "$API/history/search?q=roadmap%20q1&limit=5" | jq '.items | map({id, title})'
```

## GET /api/history/:id — one full entry

200 → the full memo entry object (including `markdown` and `raw`).
Unknown or non-numeric id → `404 {"error":"Memo not found"}` (note: no `ok` field —
different shape from PUT's 404).

```bash
curl -s "$API/history/$ID" | jq .
```

## GET /api/tags — all tags with counts

200 → `[{"tag":"project","count":7}, …]` sorted by count, descending.

```bash
curl -s "$API/tags" | jq .
```

## POST /api/history — raw create (no LLM)

Request: `{"markdown":"…","tags":["…"]?}` — markdown must be a non-empty string;
tags default `[]`. Creates an entry with `raw:""`; `title`/`slug`/`preview` derived.
**Evicts the oldest entry at `HISTORY_LIMIT`.** (This is what the web UI's
"save session as memo" uses; `/api/agent/apply` no longer accepts raw actions.)

| Status | Body |
|--------|------|
| 200 | `{"ok":true,"id":N}` |
| 400 | `{"ok":false,"error":"markdown (non-empty string) required"}` |

```bash
curl -s -X POST "$API/history" -H 'Content-Type: application/json' \
  -d '{"markdown":"# Note\n\nbody","tags":["a"]}'
```

## POST /api/format — AI-format text into a memo

Request: `{"text": "raw notes…", "id": 1784085528198?}`
- `text` required, non-blank. `id` optional; `Number()`-coerced.

Semantics: calls OpenRouter (`AI_MODEL`, default `deepseek/deepseek-v4-flash`) with a
prompt that preserves the input's content/scope/language (input is treated as content,
never instructions), parses the trailing `<!-- tags: a, b, c -->` line into lowercase
`tags` (line removed from markdown). Then:
- **no `id`** → creates a new entry (`raw` = your input text; evicts at the cap).
- **`id` matches an existing entry** → overwrites that entry's `markdown` + `tags` in
  place (`raw`, `createdAt`, `slug`, position unchanged; `title`/`preview` recomputed).
- **`id` given but not found** → NOT a 404: silently falls through and creates a new
  entry.

| Status | Body |
|--------|------|
| 200 | `{"markdown":"…","tags":["…"],"id":N,"truncated":false}` |
| 400 | `{"error":"No text provided"}` — missing/blank `text` |
| 500 | `{"error":"OPENROUTER_API_KEY not set"}` |
| 502 | `{"error":"AI error: <upstream status>"}` |
| 500 | `{"error":"Internal error"}` — network/other failure |

`truncated:true` ⇔ the model hit the output cap (`finish_reason: "length"`,
cap = `AI_MAX_TOKENS`, default 32768). Markdown is then incomplete and `tags` usually
`[]`; the full input survives in the entry's `raw`.

```bash
curl -s -X POST "$API/format" -H 'Content-Type: application/json' \
  -d '{"text":"tue: met sam re roadmap. ship v2 friday. blockers: ci flake"}'
```

## PUT /api/history/:id — verbatim partial update (no LLM)

Request: `{"markdown": "…"?, "tags": ["…"]?}` — **partial**: a field that is omitted
or `null` keeps its old value; a present field replaces wholesale. So `"markdown":""`
wipes content (preview becomes `"(empty)"`), `"tags":[]` clears tags. Changing
markdown recomputes `title` and `preview`; `slug`, `id`, `createdAt`, `raw`, and list
position never change.

| Status | Body |
|--------|------|
| 200 | `{"ok":true,"entry":{…full updated entry…}}` |
| 404 | `{"ok":false,"error":"Memo not found"}` |

```bash
curl -s -X PUT "$API/history/$ID" -H 'Content-Type: application/json' \
  -d '{"tags":["project","idea"]}'          # retag only; markdown untouched
```

## DELETE /api/history/:id — idempotent delete

Always `200 {"ok":true}` — existing, already-deleted, and garbage ids are
indistinguishable. Verify with `GET /api/history/:id` (expect 404) when it matters.

```bash
curl -s -X DELETE "$API/history/$ID"
```

## POST /api/history/clear — backup then wipe

Requires `Content-Type: application/json` (CSRF guard); body content is ignored —
send `{}`. Copies the current file to `data/history.<ISO-ts>.bak.json` (a new file
every clear), then writes `[]`.

| Status | Body |
|--------|------|
| 200 | `{"ok":true,"backedUp":true,"count":12,"backupFile":"/…/history.2026-….bak.json"}` |
| 200 | `{"ok":true,"backedUp":false,"count":0,"backupFile":null}` — no file existed |
| 415 | `{"error":"JSON required"}` — missing/wrong content type |

```bash
curl -s -X POST "$API/history/clear" -H 'Content-Type: application/json' -d '{}'
```

## POST /api/agent — agent loop over the notebook (SSE)

Request: `{"message": "your question/instruction"}` — required, non-blank, else
`400 {"error":"No message provided"}` (plain JSON, no stream).

Response: `200` with `Content-Type: text/event-stream`. **Use `curl -N`.** Each event:

```
event: <name>
data: <one-line JSON>
```

| Event | `data` shape | Meaning |
|-------|--------------|---------|
| `start` | `{}` | loop started |
| `message` | `{"content":"…"}` | model's intermediate reasoning text |
| `tool_call` | `{"name":"search_memos","args":{…}}` | any tool invocation |
| `tool_result` | `{"name":"…","result":…}` | READ tools (`search_memos`, `read_memo`, `list_tags`) executed immediately; ALSO emitted with `{"error":"…"}` as the result when a WRITE tool's args fail validation (the error feeds back to the model — no proposal is created) |
| `proposal` | `{"id":"<uuid>","action":"create_memo","args":{…},"summary":"…"}` | validated WRITE tools (`create_memo`, `merge_memos`, `link_memos`, `retag_memo`) — **nothing persisted**; POST the `id` to `/api/agent/apply` after user confirmation |
| `answer` | `{"content":"…"}` | final answer text |
| `done` | `{"steps":3,"tokens":1234}` | normal end (always after `answer`) |
| `error` | `{"message":"…"}` | fatal error — **arrives in-stream after the 200**, e.g. `OPENROUTER_API_KEY not set`, `OpenRouter 401: …` |

Loop cap: 8 steps; on hitting it you still get `answer` (a "reached the limit" notice
in `AGENT_LANG`, default zh-TW) + `done`. Disconnecting the stream aborts the run and
any in-flight OpenRouter call server-side. Model: `AGENT_MODEL` → `AI_MODEL` →
`deepseek/deepseek-v4-pro` (must support function calling). `search_memos` results
include `title`; `read_memo` returns `{id, markdown, tags, links, createdAt}`.

```bash
curl -sN -X POST "$API/agent" -H 'Content-Type: application/json' \
  -d '{"message":"which memos mention the Q1 roadmap?"}'
```

## POST /api/agent/apply — execute a write proposal by one-time id

Request: `{"id":"<uuid from a proposal event>"}`. The proposal's action/args live
**server-side, in memory** — you cannot send or alter args here. Consuming semantics:

- Applying uses the id up — a second apply with the same id → 400.
- A server restart drops all pending proposals.
- At most ~200 proposals are held; oldest fall off beyond that.
- Args are re-validated against current history at apply time (it may have changed
  since propose) — validation failures share the 400 below with their specific
  message (`Unknown source ids: …`, `No memo with id N`, …).

| Status | Body |
|--------|------|
| 200 | `{"ok":true,"id":N}` (create/merge/retag) or `{"ok":true,"ids":[…]}` (link) |
| 400 | `{"ok":false,"error":"提案已失效或不存在"}` — unknown/consumed/lost id; message is English (`Proposal expired or unknown`) when `AGENT_LANG` isn't zh-* |
| 400 | `{"ok":false,"error":"<validation message>"}` — history changed since propose |

Action effects (all defined in `src/tools.js` `applyProposal`):
- **create_memo** → new entry from `{markdown, tags?}`, `raw:""`. Evicts at cap.
- **merge_memos** → new entry; optional `title` prepended as `# title\n\n`; carries
  `sources: source_ids`; **the source memos are NOT deleted or modified**. Evicts at cap.
- **link_memos** → adds each id to the others' `links` arrays (symmetric, deduped,
  additive — never removes existing links).
- **retag_memo** → **replaces** the memo's whole tag list.

```bash
curl -s -X POST "$API/agent/apply" -H 'Content-Type: application/json' \
  -d '{"id":"6f1c2e6a-…"}'
```

## GET /api/sessions · POST /api/sessions · DELETE /api/sessions/:id

Saved agent-panel sessions (`data/sessions.json`, newest-first, capped at 50 with
the same silent eviction on insert).

- `GET` → 200 array of `{"id":N,"createdAt":"…","question":"…","answer":"…","events":[…]}`.
- `POST` body `{"question":"…", "answer":"…"?, "events":[…]?}` — question required,
  non-blank (else `400 {"error":"question required"}`); answer defaults `""`, events
  `[]` (events = the SSE trace, replayable in the UI — note replayed proposal ids are
  stale by design and will 400 on apply). → `200 {"ok":true,"id":N}`.
- `DELETE /api/sessions/:id` → always `200 {"ok":true}` (idempotent, like history).

```bash
curl -s -X POST "$API/sessions" -H 'Content-Type: application/json' \
  -d '{"question":"q?","answer":"a","events":[]}'
```

## GET /m/:id — public permalink (HTML, not under /api)

`GET "$BASE/m/$ID"` → 200, a self-contained server-rendered HTML page (independent of
the SPA's styling). Unknown id → 404 with body `<h1>404 — Memo not found</h1>`.
**Bypasses Basic Auth** — this is the only public surface when auth is on. Not JSON;
for data use `GET /api/history/:id`.
