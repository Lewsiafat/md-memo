# Demo build

Static, backend-free showcase of md-memo for GitHub Pages. AI responses are pre-recorded.

## How it works

- `demo/data/history.json` — 10 bilingual seed memos
- `demo/data/format-samples.json` — editor prefill + canned format result
- `demo/data/agent-trace.json` — replayed agent run + the apply result's fixed id/date
- `demo/mock.js` — monkeypatches `window.fetch`; serves the JSON above for `/api/*` and replays the agent trace as a real SSE `ReadableStream` through the app's existing parser

## Build & deploy

```bash
npm run build:demo   # emits dist-demo/
```

`scripts/build-demo.mjs` injects `mock.js` into `public/index.html`, replaces the
`__BASE_PATH__` placeholder with `/md-memo`, copies the demo data, and
pre-generates `m/<id>/index.html` permalinks by reusing `src/permalink.js`
(the same renderer the server uses).

Deployment is automatic: `.github/workflows/deploy-demo.yml` builds and
force-pushes `dist-demo/` to the `gh-pages` branch on every push to `main`
(or manual dispatch). Enable Pages once via **Settings → Pages → Deploy from a
branch → `gh-pages` / (root)**.

## Updating the demo

Edit the files under `demo/`, run `npm run build:demo`, eyeball `dist-demo/`,
commit, and push — CI redeploys. Keep `demo/mock.js` in sync if the `/api/*`
shapes in `src/` change.
