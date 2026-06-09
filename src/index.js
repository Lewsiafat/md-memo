import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10026;
const BASE_PATH = '/md-memo';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');
const HISTORY_LIMIT = 50;

// Ensure data dir exists
fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });

app.use(express.json({ limit: '1mb' }));
app.use(BASE_PATH, express.static(path.join(__dirname, '..', 'public')));

// Load history
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch {}
  return [];
}

// Save history
function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

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
        'HTTP-Referer': 'https://lewsi.ddns.net/md-memo/',
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
    const history = loadHistory();
    const entry = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      raw: text,
      markdown,
      tags,
      preview: markdown.split('\n').find(l => l.trim()) || '(empty)'
    };
    history.unshift(entry);
    saveHistory(history.slice(0, HISTORY_LIMIT));

    res.json({ markdown, tags, id: entry.id });
  } catch (err) {
    console.error('Format error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /md-memo/api/history
app.get(`${BASE_PATH}/api/history`, (req, res) => {
  res.json(loadHistory());
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
