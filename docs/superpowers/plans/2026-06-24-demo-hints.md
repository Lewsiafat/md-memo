# Demo Hints (welcome card + coachmarks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the static demo more onboarding than the bottom toast/banner: a dismissible welcome card on first load (explains it's a demo + the three things to try) and inline coachmark tooltips anchored to the key buttons. Both remember dismissal in `localStorage`.

**Architecture:** Everything lives in `demo/mock.js` (demo-only — the real app is untouched). The existing `DOMContentLoaded` handler that injects the banner and prefills the inputs gains two helpers: `showWelcome(then)` (overlay card, runs `then` after dismissal) and `setupCoach()` (floating tooltips positioned via `getBoundingClientRect`). Welcome runs first, then chains into coachmarks.

**Tech Stack:** Browser IIFE (vanilla JS) in `demo/mock.js`, CSS injected at runtime. No build changes, no new dependencies.

## Global Constraints

- **No new npm dependencies**; `demo/mock.js` stays a plain browser IIFE with zero imports (the demo build copies it verbatim).
- Demo-only: do **not** edit `public/index.html` or any `src/` file for this feature.
- New user-facing copy is 繁體中文, matching the existing demo banner.
- Dismissal persists in `localStorage` keys `md-memo-demo-welcome-seen` and `md-memo-demo-coach-seen` (to re-test, clear them in DevTools → Application → Local Storage).
- No front-end unit-test harness exists; verification is manual (optionally via `playwright-skill` for a screenshot). The `npm test` demo-data suite must still pass (it does not read `mock.js`, so it should be unaffected — confirm anyway).
- Coachmarks anchor only to buttons that are always present (`#btn-format`, `#agentToggle`, `#btn-clear-all`) — never `#btn-share` (hidden until a memo is formatted).

---

## File Structure

- `demo/mock.js` — all changes. Three edits: (1) extend the injected CSS string with overlay + coachmark styles; (2) add `showWelcome` + `setupCoach` (+ small helpers) inside the IIFE; (3) call `showWelcome(setupCoach)` at the end of the existing `DOMContentLoaded` handler.
- `CLAUDE.md` — one line under the demo section noting the onboarding hints.

---

### Task 1: Welcome card overlay

**Files:**
- Modify: `demo/mock.js` — inject overlay CSS; add `showWelcome`; call it from `DOMContentLoaded`.

**Interfaces:**
- Produces: `showWelcome(then?: () => void)` — shows the card unless `md-memo-demo-welcome-seen` is set; on dismissal sets the flag and calls `then`. If already seen, calls `then` immediately.

- [ ] **Step 1: Extend the injected CSS**

In `demo/mock.js`, replace the current banner-style assignment (lines ~109-113):

```js
    const style = document.createElement('style');
    style.textContent =
      '#demo-banner{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#6c5ce7;color:#fff;font:600 12px/1.4 -apple-system,sans-serif;padding:7px 16px;' +
      'border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:.94}';
    document.head.appendChild(style);
```

with:

```js
    const style = document.createElement('style');
    style.textContent =
      '#demo-banner{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#6c5ce7;color:#fff;font:600 12px/1.4 -apple-system,sans-serif;padding:7px 16px;' +
      'border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:.94}' +
      '#demo-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);' +
      'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px)}' +
      '#demo-card{max-width:380px;width:90%;background:#fff;color:#1a1714;border-radius:14px;' +
      'padding:24px 26px;box-shadow:0 12px 40px rgba(0,0,0,.3);font:14px/1.6 -apple-system,sans-serif}' +
      '#demo-card h2{font-size:18px;margin:0 0 10px;color:#6c5ce7}' +
      '#demo-card ul{margin:12px 0;padding-left:20px}#demo-card li{margin:6px 0}' +
      '#demo-card button{margin-top:14px;width:100%;padding:10px;border:none;border-radius:8px;' +
      'background:#6c5ce7;color:#fff;font-weight:700;font-size:14px;cursor:pointer}' +
      '.demo-coach{position:fixed;z-index:9998;background:#6c5ce7;color:#fff;' +
      'font:600 12px/1.4 -apple-system,sans-serif;padding:8px 12px;border-radius:8px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:200px;display:flex;gap:8px;align-items:flex-start}' +
      '.demo-coach .demo-coach-x{cursor:pointer;opacity:.85;font-weight:700}';
    document.head.appendChild(style);
```

- [ ] **Step 2: Add `showWelcome`**

In `demo/mock.js`, inside the IIFE but **outside** the `DOMContentLoaded` callback (e.g. directly above `window.addEventListener('DOMContentLoaded', ...)`, ~line 107), add:

```js
  function showWelcome(then) {
    if (localStorage.getItem('md-memo-demo-welcome-seen')) { then && then(); return; }
    const ov = document.createElement('div');
    ov.id = 'demo-overlay';
    ov.innerHTML =
      '<div id="demo-card">' +
      '<h2>🎭 歡迎試用 md-memo Demo</h2>' +
      '<p>這是純前端 demo：AI 回應為<strong>預錄</strong>，不會呼叫真的 LLM，資料只存在這個瀏覽器分頁。</p>' +
      '<ul>' +
      '<li>✨ 左邊已幫你填好草稿，按 <strong>Format</strong> 轉成 Markdown</li>' +
      '<li>🤖 按右上 <strong>Agent</strong> 問筆記庫，或請它整理／合併</li>' +
      '<li>🔗 每篇都能 <strong>Share</strong> 產生永久連結頁</li>' +
      '</ul>' +
      '<button id="demo-start">開始體驗</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.querySelector('#demo-start').addEventListener('click', () => {
      localStorage.setItem('md-memo-demo-welcome-seen', '1');
      ov.remove();
      then && then();
    });
  }
```

- [ ] **Step 3: Call it from `DOMContentLoaded`**

In `demo/mock.js`, at the end of the `DOMContentLoaded` callback (after the `agentInput` prefill, ~line 124), add:

```js
    showWelcome();
```

(Task 2 changes this to `showWelcome(setupCoach)` to chain the coachmarks.)

- [ ] **Step 4: Manual verification**

```bash
npm run build:demo
```

Serve `dist-demo/` (e.g. `npx --yes http-server dist-demo -p 8081`) and open `/md-memo/` in a fresh profile (or after clearing `localStorage`):
1. The welcome card appears centered over a dimmed backdrop.
2. Click **開始體驗** → card disappears; the app is usable; the bottom demo banner is still there.
3. Reload the page → the card does **not** reappear.

Expected: all three behaviors hold; no console errors. (Clear `md-memo-demo-welcome-seen` to re-test.)

- [ ] **Step 5: Commit**

```bash
git add demo/mock.js
git commit -m "feat(demo): welcome card overlay on first load"
```

---

### Task 2: Inline coachmarks

**Files:**
- Modify: `demo/mock.js` — add `setupCoach` (+ `placeCoach`); chain it after the welcome card.

**Interfaces:**
- Consumes: the overlay/coachmark CSS from Task 1, the always-present buttons `#btn-format`, `#agentToggle`, `#btn-clear-all`.
- Produces: `setupCoach()` — shows up to three anchored tooltips unless `md-memo-demo-coach-seen` is set; dismissed by any tooltip's ✕ or by clicking a targeted button; repositions on resize.

- [ ] **Step 1: Add `setupCoach` + `placeCoach`**

In `demo/mock.js`, directly below `showWelcome` (from Task 1), add:

```js
  const COACH = [
    { sel: '#btn-format', text: '① 按這裡把左邊草稿轉成 Markdown' },
    { sel: '#agentToggle', text: '② 切到 Agent，問你的筆記庫或請它整理' },
    { sel: '#btn-clear-all', text: '③ Clear 會先備份再清空（需確認兩次）' },
  ];

  function placeCoach(elc, target) {
    const r = target.getBoundingClientRect();
    const w = 200;
    let left = r.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    elc.style.left = Math.max(8, left) + 'px';
    elc.style.top = (r.bottom + 8) + 'px';
  }

  function setupCoach() {
    if (localStorage.getItem('md-memo-demo-coach-seen')) return;
    const made = [];
    const dismiss = () => {
      made.forEach(m => m.el.remove());
      window.removeEventListener('resize', reposition);
      localStorage.setItem('md-memo-demo-coach-seen', '1');
    };
    const reposition = () => made.forEach(m => placeCoach(m.el, m.target));
    for (const { sel, text } of COACH) {
      const target = document.querySelector(sel);
      if (!target) continue;
      const c = document.createElement('div');
      c.className = 'demo-coach';
      c.innerHTML = '<span>' + text + '</span><span class="demo-coach-x">✕</span>';
      document.body.appendChild(c);
      placeCoach(c, target);
      c.querySelector('.demo-coach-x').addEventListener('click', dismiss);
      target.addEventListener('click', dismiss, { once: true });
      made.push({ el: c, target });
    }
    window.addEventListener('resize', reposition);
  }
```

- [ ] **Step 2: Chain coachmarks after the welcome card**

In `demo/mock.js`, change the line added in Task 1 (Step 3) from:

```js
    showWelcome();
```

to:

```js
    showWelcome(setupCoach);
```

- [ ] **Step 3: Manual verification**

```bash
npm run build:demo
```

Serve `dist-demo/` and open `/md-memo/` after clearing `localStorage`:
1. Dismiss the welcome card → three purple tooltips appear under **Format**, the 🤖 **Agent** toggle, and **Clear**.
2. Resize the window → tooltips re-anchor under their buttons.
3. Click any tooltip's **✕**, or click one of the targeted buttons → all tooltips disappear together.
4. Reload → tooltips do **not** reappear (welcome already seen, so coachmarks would run, but `md-memo-demo-coach-seen` is set).

Expected: all four behaviors hold; tooltips never cover/overflow off-screen horizontally; no console errors.

- [ ] **Step 4: Commit**

```bash
git add demo/mock.js
git commit -m "feat(demo): inline coachmarks anchored to key buttons"
```

---

### Task 3: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` — note the onboarding hints in the demo section.

- [ ] **Step 1: Run the test suite**

Run: `npm test`
Expected: PASS — all suites green (the demo-data tests do not read `mock.js`, so they remain unaffected).

- [ ] **Step 2: (Optional) Playwright screenshot**

Use the `playwright-skill` to load the served demo, clear `localStorage`, reload, and screenshot the welcome card and the coachmarks for a visual record. (No new project dependency — Playwright runs via the skill's own tooling.)

- [ ] **Step 3: Document in CLAUDE.md**

In `CLAUDE.md`, under `### 靜態 demo（GitHub Pages）`, append to the `demo/mock.js` bullet (or add a sub-line):

```markdown
- demo 首次載入顯示歡迎卡（說明為預錄 demo + 三個可試動作），關閉後在 Format／Agent／Clear 按鈕旁顯示 coachmark 提示；兩者關閉狀態各記在 `localStorage`（`md-memo-demo-welcome-seen`、`md-memo-demo-coach-seen`）。
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note demo welcome card + coachmarks"
```

---

## Self-Review

- **Spec coverage:** "more hints to guide the user, not just bottom toasts" → Task 1 welcome card + Task 2 coachmarks (chosen forms 1 + 2). ✓
- **Placeholder scan:** none — every step has full code or an exact command + expected result.
- **Type/contract consistency:** all changes are confined to `demo/mock.js`'s IIFE; `showWelcome(then)` is called with no arg in Task 1 then with `setupCoach` in Task 2 (the param is optional, so both are valid). Coachmark targets are limited to always-present buttons per the Global Constraints. No `src/` or `public/` contract is touched. ✓
- **Idempotence/persistence:** both features guard on `localStorage` flags so they show once; documented how to reset for testing. ✓
