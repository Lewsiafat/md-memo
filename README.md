**English** · [繁體中文](./README.zh-TW.md)

# md-memo

A lightweight markdown memo tool with AI-powered formatting. Write in plain text, get back clean structured markdown instantly.

## 🌐 Live Demo

**[lewsiafat.github.io/md-memo](https://lewsiafat.github.io/md-memo/)** — a fully static showcase (no API key needed). The AI formatting and agent reasoning are **pre-recorded** so you can try the full flow; a "Demo mode" badge marks the canned responses. Built from `demo/` by `npm run build:demo` and deployed to the `gh-pages` branch via GitHub Actions.

## Features

- ✍️ **Write in plain text** — no markdown syntax needed
- 🤖 **AI formatting** — one click to convert to clean markdown via OpenRouter
- 🏷️ **Auto tags** — AI generates relevant tags automatically
- 📋 **Copy to clipboard** — markdown or plain text
- 🔗 **Permalink** — shareable URL for each memo (`/md-memo/m/:id`)
- 🎨 **Colophon design** — a warm, paper-like aesthetic (Instrument Serif / Literata / IBM Plex Mono); **Light "Writing" is the default**, with a Dark "Reading" theme toggle (localStorage-persisted)
- 📚 **Memo List** — search (live filter + Enter for full-library search), clickable tag filter, paginated loading with auto-load on scroll (cap configurable via `HISTORY_LIMIT`, default 1000), sort toggle, and keyboard navigation (`/`, `↑`/`↓`, Enter, Esc); safe Clear All keeps a timestamped backup
- ✏️ **Edit existing memos** — open a saved memo and **Save** (verbatim overwrite, no AI), **Reformat** (re-run the AI, then overwrite the entry or save as a new one), or **Discard**
- 🔍 **Quick view** — preview history items without leaving the editor
- 🧠 **Agent over your notes** — ask questions or give commands ("merge this week's meeting notes"); the agent searches, reads, and proposes changes with a live reasoning trace (confirm before any write). A dedicated three-column Agent workspace lets you save, replay, and delete sessions, or turn an answer into a memo

## Stack

- **Backend**: Node.js + Express (ES Modules)
- **Frontend**: Vanilla JS, no framework, no build step
- **Type**: Instrument Serif · Literata · IBM Plex Mono (Google Fonts CDN)
- **AI**: [OpenRouter](https://openrouter.ai) (bring your own key, any model)
- **Storage**: JSON file (no database needed) — atomic writes; a corrupted file is quarantined for recovery, never overwritten

## Quick Start

Requires Node.js >= 22.9 (for the built-in `--env-file-if-exists` flag).

```bash
# Clone
git clone https://github.com/Lewsiafat/md-memo.git
cd md-memo

# Install
npm install

# Configure
cp .env.sample .env
# Edit .env and add your OPENROUTER_API_KEY

# Run
npm start
# Open http://localhost:10026/md-memo/
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `10026` | Server port |
| `HOST` | `127.0.0.1` | Bind address — set `0.0.0.0` when deploying to Railway/Render/Docker (enable auth first!) |
| `BASE_PATH` | `/md-memo` | URL base path |
| `HISTORY_LIMIT` | `1000` | Max memos kept (the JSON store is rewritten whole on each save — keep it sane) |
| `OPENROUTER_API_KEY` | — | Your OpenRouter API key (required for AI) |
| `AI_MODEL` | `deepseek/deepseek-v4-flash` | OpenRouter model ID |
| `AGENT_MODEL` | `deepseek/deepseek-v4-pro` | Model for the agent loop (must support tool calling) |
| `AGENT_LANG` | `zh-TW` | Language for all agent output (BCP-47 tag) |
| `AUTH_ENABLED` | `false` | Enable HTTP Basic Auth for the app + all APIs (permalinks stay public) |
| `AUTH_PASSWORD` | — | Password used when `AUTH_ENABLED=true` (username ignored) |

Get your free API key at [openrouter.ai](https://openrouter.ai).

## Sample Data

A sample history file is provided at `data/history.sample.json`.
To use it as a starting point:

```bash
cp data/history.sample.json data/history.json
```

The app creates `data/history.json` automatically on first use.

## Self-hosting

The app is a single Express server serving static files. Deploy anywhere Node.js runs:

- **VPS**: Run with `node src/index.js`, put behind nginx
- **Railway / Render**: Set env vars, deploy directly
- **Docker**: Add your own `Dockerfile` (contributions welcome!)

## Design Docs

Design history and specs live in `specs/` and `docs/plans/`.

## License

MIT
