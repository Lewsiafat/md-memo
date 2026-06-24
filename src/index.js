import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadHistory, saveHistory, createEntry, insertEntry } from './store.js';
import { runAgent } from './agent.js';
import { applyProposal } from './tools.js';
import { renderPermalink } from './permalink.js';

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
  res.send(renderPermalink(entry, BASE_PATH));
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
