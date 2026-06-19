# md-memo

A lightweight markdown memo tool with AI-powered formatting. Write in plain text, get back clean structured markdown instantly.

## Features

- ✍️ **Write in plain text** — no markdown syntax needed
- 🤖 **AI formatting** — one click to convert to clean markdown via OpenRouter
- 🏷️ **Auto tags** — AI generates relevant tags automatically
- 📋 **Copy to clipboard** — markdown or plain text
- 🔗 **Permalink** — shareable URL for each memo (`/md-memo/m/:id`)
- 🌙 **Dark / Light theme** — toggle with localStorage persistence
- 📚 **History** — last 50 memos with tag cloud filter
- 🔍 **Quick view** — preview history items without leaving the editor
- 🧠 **Agent over your notes** — ask questions or give commands ("merge this week's meeting notes"); the agent searches, reads, and proposes changes with a live reasoning trace (confirm before any write)

## Stack

- **Backend**: Node.js + Express (ES Modules)
- **Frontend**: Vanilla JS, no framework, no build step
- **AI**: [OpenRouter](https://openrouter.ai) (bring your own key, any model)
- **Storage**: JSON file (no database needed)

## Quick Start

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
| `BASE_PATH` | `/md-memo` | URL base path |
| `OPENROUTER_API_KEY` | — | Your OpenRouter API key (required for AI) |
| `AI_MODEL` | `deepseek/deepseek-v4-flash` | OpenRouter model ID |
| `AGENT_MODEL` | `openai/gpt-4o-mini` | Model for the agent loop (must support tool calling) |

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

## License

MIT
