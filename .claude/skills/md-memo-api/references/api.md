# md-memo API — full contract

Verified against `src/index.js`, `src/store.js`, `src/tools.js`, `src/agent.js`,
`src/sessions.js`, `src/auth.js`, `src/format.js`.

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
- Error envelopes are inconsistent by design — three shapes exist:
  `{"error":"…"}` (format/agent/sessions validation), `{"ok":false,"error":"…"}`
  (PUT 404 and all apply failures), and plain-text/HTML (auth 401, permalink 404,
  clear 415 is JSON `{"error":"JSON required"}`). Don't assume one shape.

## The memo entry object

```json
{
  "id": 1784085528198,            // ms timestamp; monotonic (same-ms inserts get +1)
  "createdAt": "2026-07-14T09:12:34.567Z",
  "raw": "original input text",   // "" for entries created via agent/apply
  "markdown": "# …",
  "tags": ["lowercase", "by", "convention"],
  "preview": "# …",               // first non-empty line of markdown; "(empty)" if none
  "sources": [id, id],            // only on merge_memos results
  "links": [id, id]               // only after link_memos
}
```

Storage is one JSON array, newest first, **sliced to 50 on every insert** — the oldest
entry is silently evicted at capacity. Updates (PUT, format-with-id, retag, link) never
evict and never reorder.

---

## POST /api/format — AI-format text into a memo

Request: `{"text": "raw notes…", "id": 1784085528198?}`
- `text` required, non-blank. `id` optional; `Number()`-coerced.

Semantics: calls OpenRouter (`AI_MODEL`, default `deepseek/deepseek-v4-flash`), parses
the trailing `<!-- tags: a, b, c -->` line into lowercase `tags` (line removed from
markdown). Then:
- **no `id`** → creates a new entry (`raw` = your input text; evicts at 50).
- **`id` matches an existing entry** → overwrites that entry's `markdown` + `tags` in
  place (`raw`, `createdAt`, position unchanged).
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

## GET /api/history — the only read

No params, no pagination, no server-side search. 200 → JSON array of all entries
(≤50), newest first. Filter with `jq` / in code.

```bash
curl -s "$API/history" | jq 'map({id, preview, tags})'
```

## PUT /api/history/:id — verbatim partial update (no LLM)

Request: `{"markdown": "…"?, "tags": ["…"]?}` — **partial**: a field that is omitted
or `null` keeps its old value; a present field replaces wholesale. So `"markdown":""`
wipes content (preview becomes `"(empty)"`), `"tags":[]` clears tags. `preview` is
recomputed when markdown changes. `id`, `createdAt`, `raw`, list position unchanged.

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
indistinguishable. Verify via `GET /api/history` when correctness matters.

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
| `tool_result` | `{"name":"…","result":…}` | READ tools only (`search_memos`, `read_memo`, `list_tags`) — executed immediately |
| `proposal` | `{"action":"create_memo","args":{…},"summary":"…"}` | WRITE tools (`create_memo`, `merge_memos`, `link_memos`, `retag_memo`) — **nothing persisted**; POST `{action,args}` verbatim to `/api/agent/apply` after user confirmation |
| `answer` | `{"content":"…"}` | final answer text |
| `done` | `{"steps":3,"tokens":1234}` | normal end (always after `answer`) |
| `error` | `{"message":"…"}` | fatal error — **arrives in-stream after the 200**, e.g. `OPENROUTER_API_KEY not set`, `OpenRouter 401: …` |

Loop cap: 8 steps; on hitting it you still get `answer` (a "reached the limit" notice
in `AGENT_LANG`, default zh-TW) + `done`. Model: `AGENT_MODEL` → `AI_MODEL` →
`deepseek/deepseek-v4-pro` (must support function calling).

```bash
curl -sN -X POST "$API/agent" -H 'Content-Type: application/json' \
  -d '{"message":"which memos mention the Q1 roadmap?"}'
```

## POST /api/agent/apply — execute a write proposal

Request: `{"action":"<name>","args":{…}}` — both required, else
`400 {"error":"action and args required"}`. Works standalone (no prior agent run) —
the web UI itself uses `create_memo` for its "save as memo" button.

All failures: `400 {"ok":false,"error":"…"}`.

### action: `create_memo`
`args: {"markdown": "…", "tags": ["…"]?}` — markdown must be a non-empty string
(else `markdown (non-empty string) required`); tags default `[]`. Creates entry with
`raw:""`. → `{"ok":true,"id":N}`. **Evicts oldest at 50.**

### action: `merge_memos`
`args: {"source_ids":[N,…], "markdown":"…", "title":"…"?, "tags":["…"]?}` —
markdown required; every source id must exist (else `Unknown source ids: …`).
`title` (optional) is prepended as `# title\n\n`. Creates a NEW entry with
`sources: source_ids`; **the source memos are NOT deleted or modified.**
→ `{"ok":true,"id":N}`. **Evicts oldest at 50.**

### action: `link_memos`
`args: {"ids":[N,N,…]}` — all ids must exist (else `Unknown ids: …`). Adds each id to
the others' `links` arrays (symmetric, deduped, additive — never removes existing
links). → `{"ok":true,"ids":[…]}`.

### action: `retag_memo`
`args: {"id":N, "tags":["…"]}` — id must exist (else `No memo with id N`). **Replaces**
the whole tag list (omitted tags → `[]`, i.e. clears). → `{"ok":true,"id":N}`.

Anything else → `{"ok":false,"error":"Unknown action <name>"}`.

```bash
curl -s -X POST "$API/agent/apply" -H 'Content-Type: application/json' \
  -d '{"action":"create_memo","args":{"markdown":"# Note\n\nbody","tags":["a"]}}'
```

## GET /api/sessions · POST /api/sessions · DELETE /api/sessions/:id

Saved agent-panel sessions (`data/sessions.json`, same newest-first + 50-cap +
silent-eviction behavior as history).

- `GET` → 200 array of `{"id":N,"createdAt":"…","question":"…","answer":"…","events":[…]}`.
- `POST` body `{"question":"…", "answer":"…"?, "events":[…]?}` — question required,
  non-blank (else `400 {"error":"question required"}`); answer defaults `""`, events
  `[]` (events = the SSE trace, replayable in the UI). → `200 {"ok":true,"id":N}`.
- `DELETE /api/sessions/:id` → always `200 {"ok":true}` (idempotent, like history).

```bash
curl -s -X POST "$API/sessions" -H 'Content-Type: application/json' \
  -d '{"question":"q?","answer":"a","events":[]}'
```

## GET /m/:id — public permalink (HTML, not under /api)

`GET "$BASE/m/$ID"` → 200, a self-contained server-rendered HTML page (independent of
the SPA's styling). Unknown id → 404 with body `<h1>404 — Memo not found</h1>`.
**Bypasses Basic Auth** — this is the only public surface when auth is on. Not JSON;
for data use `GET /api/history`.
