# md-memo

Quick AI-powered markdown memo tool — type raw notes, AI formats to clean Markdown.

## Dev commands
```bash
npm run dev    # node --watch
npm start      # production
```

## Architecture
- `src/index.js` — Express server, `/api/format` (POST), `/api/history` (GET), `/api/history/:id` (DELETE)
- `public/index.html` — Single-file frontend (vanilla JS + marked.js CDN)
- `data/history.json` — Auto-created, stores last 50 entries

## Deployment
- Port: 10026
- VPS path: `/srv/projects/md-memo/`
- URL: `https://lewsi.ddns.net/md-memo/`
- Systemd: `md-memo.service`
- Env: `OPENROUTER_API_KEY` in `.env`

## AI model
`google/gemma-3-4b-it:free` via OpenRouter (fallback: `deepseek/deepseek-r1-0528:free`)

## Keyboard shortcut
`Ctrl+Enter` / `Cmd+Enter` in textarea → Format
