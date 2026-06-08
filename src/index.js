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
        model: 'google/gemma-3-4b-it:free',
        messages: [
          {
            role: 'system',
            content: 'You are a markdown formatter. Convert the user\'s raw notes into clean, well-structured Markdown. Fix grammar, organize with headers/bullets/code blocks where appropriate. Return ONLY the markdown, no explanation, no code fences wrapping the entire output.'
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
    const markdown = data.choices?.[0]?.message?.content?.trim() || '';

    // Save to history
    const history = loadHistory();
    const entry = {
      id: Date.now(),
      createdAt: new Date().toISOString(),
      raw: text,
      markdown,
      preview: markdown.split('\n').find(l => l.trim()) || '(empty)'
    };
    history.unshift(entry);
    saveHistory(history.slice(0, HISTORY_LIMIT));

    res.json({ markdown, id: entry.id });
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
