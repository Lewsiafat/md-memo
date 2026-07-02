# Contributing to md-memo

Thanks for your interest in contributing!

## Getting started

```bash
npm ci          # install dependencies (only one: express)
npm test        # run the unit test suite (node --test)
npm run smoke   # run the agent integration smoke test (no API key needed)
```

To run the app locally:

```bash
npm run dev     # node --watch, auto-restarts on file changes
```

Then open http://localhost:10026/md-memo/ . AI features require an
`OPENROUTER_API_KEY` in `.env` (see `.env.sample`), but tests and the smoke
run without one.

## Pull requests

- Keep changes focused: one topic per PR.
- `npm test` and `npm run smoke` must pass — CI runs both on every PR.
- Add or extend tests for behavior changes (tests live in `test/`).
- There is no build step and no linter; match the existing code style.

## Project conventions

Project-specific conventions, architecture notes, and known pitfalls (e.g. the
tag-comment contract between the prompt and `parseTags()`, the two independent
markdown rendering environments, and the `__BASE_PATH__` placeholder rule) are
documented in [`CLAUDE.md`](CLAUDE.md). Please read it before making changes.
