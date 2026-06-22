import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHistory, saveHistory, createEntry, insertEntry } from './store.js';
import { runAgent } from './agent.js';
import { applyProposal } from './tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10026;
const BASE_PATH = process.env.BASE_PATH || '/md-memo';

app.use(express.json({ limit: '1mb' }));

// Serve the SPA with BASE_PATH injected (replaces the __BASE_PATH__ placeholder).
// Must run before express.static so the placeholders never reach the browser raw.
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8')
  .replace(/__BASE_PATH__/g, BASE_PATH);
app.get([BASE_PATH, `${BASE_PATH}/`], (req, res) => res.type('html').send(indexHtml));
app.use(BASE_PATH, express.static(path.join(__dirname, '..', 'public')));

// Parse tags from markdown — AI appends <!-- tags: a, b, c --> at the end
function parseTags(raw) {
  const match = raw.match(/<!--\s*tags:\s*([^>]+?)-->/i);
  if (!match) return { markdown: raw.trim(), tags: [] };
  const tags = match[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const markdown = raw.replace(/<!--\s*tags:[^>]+-->/gi, '').trim();
  return { markdown, tags };
}

// POST /md-memo/api/format
app.post(`${BASE_PATH}/api/format`, async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set' });

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/Lewsiafat/md-memo',
        'X-Title': 'md-memo'
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'deepseek/deepseek-v4-flash',
        messages: [
          {
            role: 'system',
            content: `You are a markdown formatter. Convert the user's raw notes into clean, well-structured Markdown. Fix grammar, organize with headers/bullets/code blocks where appropriate.

At the very end of your output, append exactly one line in this format:
<!-- tags: tag1, tag2, tag3 -->

Generate 1–5 short, relevant lowercase tags that best describe the content topic. Return ONLY the markdown + that tags line. No other explanation, no wrapping code fences.`
          },
          { role: 'user', content: text }
        ],
        max_tokens: 4096,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenRouter error:', err);
      return res.status(502).json({ error: `AI error: ${response.status}` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const { markdown, tags } = parseTags(raw);

    // Save to history
    const entry = insertEntry(createEntry({ raw: text, markdown, tags }));

    res.json({ markdown, tags, id: entry.id });
  } catch (err) {
    console.error('Format error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /md-memo/api/agent — run the agent loop, stream events as SSE
app.post(`${BASE_PATH}/api/agent`, async (req, res) => {
  const { message } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'No message provided' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    await runAgent(message, emit);
  } catch (err) {
    console.error('Agent error:', err);
    emit('error', { message: err.message });
  } finally {
    res.end();
  }
});

// POST /md-memo/api/agent/apply — execute a user-confirmed write proposal
app.post(`${BASE_PATH}/api/agent/apply`, (req, res) => {
  const { action, args } = req.body || {};
  if (!action || !args) return res.status(400).json({ error: 'action and args required' });
  const result = applyProposal({ action, args });
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

// GET /md-memo/api/history
app.get(`${BASE_PATH}/api/history`, (req, res) => {
  res.json(loadHistory());
});

// GET /md-memo/m/:id — public permalink page
app.get(`${BASE_PATH}/m/:id`, (req, res) => {
  const id = Number(req.params.id);
  const entry = loadHistory().find(e => e.id === id);
  if (!entry) return res.status(404).send('<h1>404 — Memo not found</h1>');

  const preview = (entry.preview || '').replace(/^#+\s*/, '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const tagsHtml = (entry.tags || [])
    .map(t => `<span class="tag">${t}</span>`).join('');
  const date = new Date(entry.createdAt).toLocaleString('zh-TW', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  res.send(`<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${preview} — md-memo</title>
  <meta property="og:title" content="${preview}">
  <meta property="og:description" content="Shared via md-memo">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    :root {
      --bg:#f7f5f0; --surface:#fff; --border:#e5e0d5;
      --text:#1a1814; --text2:#888070; --accent:#6c5ce7;
      --mono:'JetBrains Mono','Fira Code',monospace;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--bg);color:var(--text);font-family:-apple-system,'PingFang TC',sans-serif;line-height:1.7;min-height:100vh}
    header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:12px}
    header a{font-size:14px;font-weight:800;color:var(--accent);text-decoration:none;letter-spacing:.04em}
    header a span{color:#aaa;font-weight:400}
    .meta{margin-left:auto;font-size:12px;color:var(--text2)}
    .tags{display:flex;gap:6px;flex-wrap:wrap;margin-left:8px}
    .tag{font-size:11px;padding:2px 9px;border-radius:20px;background:#6c5ce715;color:var(--accent);border:1px solid #6c5ce730;font-weight:600}
    main{max-width:740px;margin:48px auto;padding:0 24px 80px}
    .copy-btn{display:inline-flex;align-items:center;gap:6px;background:var(--accent);color:#fff;border:none;border-radius:8px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:32px;text-decoration:none;transition:opacity .15s}
    .copy-btn:hover{opacity:.85}
    .md h1,.md h2,.md h3,.md h4{font-weight:700;margin:1.3em 0 .45em;line-height:1.3;color:var(--text)}
    .md h1{font-size:1.7em;border-bottom:1px solid var(--border);padding-bottom:.3em}
    .md h2{font-size:1.3em}.md h3{font-size:1.1em}
    .md p{margin:.65em 0}
    .md ul,.md ol{margin:.65em 0 .65em 1.5em}.md li{margin:.3em 0}
    .md code{background:#f0ece4;color:#5a4fcf;padding:2px 6px;border-radius:4px;font-family:var(--mono);font-size:.87em}
    .md pre{background:#f5f2ec;border:1px solid var(--border);border-radius:10px;padding:14px 16px;overflow-x:auto;margin:.9em 0}
    .md pre code{background:none;padding:0;color:#333;font-size:.87em}
    .md blockquote{border-left:3px solid var(--accent);margin:.9em 0;padding:.35em .9em;color:var(--text2);font-style:italic;background:#f9f7ff;border-radius:0 6px 6px 0}
    .md table{border-collapse:collapse;width:100%;margin:.9em 0;font-size:.9em}
    .md th,.md td{border:1px solid var(--border);padding:7px 12px;text-align:left}
    .md th{background:#f5f2ec;font-weight:600}
    .md hr{border:none;border-top:1px solid var(--border);margin:1.4em 0}
    .md strong{font-weight:700}
    .md a{color:var(--accent)}
    footer{text-align:center;padding:24px;font-size:12px;color:var(--text2);border-top:1px solid var(--border)}
    footer a{color:var(--accent);text-decoration:none}
  </style>
</head>
<body>
  <header>
    <a href="${BASE_PATH}/">md<span>-</span>memo</a>
    <div class="tags">${tagsHtml}</div>
    <span class="meta">${date}</span>
  </header>
  <main>
    <button class="copy-btn" onclick="copyMd()">📋 複製 Markdown</button>
    <div class="md" id="content"></div>
  </main>
  <footer>由 <a href="${BASE_PATH}/">md-memo</a> 產生 · <a href="${BASE_PATH}/">建立你自己的筆記 →</a></footer>
  <script>
    const raw = ${JSON.stringify(entry.markdown)};
    document.getElementById('content').innerHTML = marked.parse(raw);
    async function copyMd() {
      try { await navigator.clipboard.writeText(raw); }
      catch { const t=document.createElement('textarea');t.value=raw;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t); }
      const btn = document.querySelector('.copy-btn');
      btn.textContent = '✓ 已複製';
      setTimeout(() => btn.innerHTML = '📋 複製 Markdown', 2000);
    }
  </script>
</body>
</html>`);
});

// DELETE /md-memo/api/history/:id
app.delete(`${BASE_PATH}/api/history/:id`, (req, res) => {
  const id = Number(req.params.id);
  const history = loadHistory().filter(e => e.id !== id);
  saveHistory(history);
  res.json({ ok: true });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`md-memo running on http://127.0.0.1:${PORT}${BASE_PATH}`);
});
