import { loadHistory, saveHistory, createEntry, insertEntry } from './store.js';

// ---- Tool schemas (OpenRouter `tools` / function-calling format) ----
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memos',
      description: 'Search the notebook for memos relevant to a query. Returns matching memos with id, preview, tags, and a snippet.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to search for.' },
          limit: { type: 'number', description: 'Max results (default 5).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_memo',
      description: 'Read the full markdown of a single memo by id.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tags',
      description: 'List all tags in the notebook with their counts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_memo',
      description: 'Propose creating a new memo. Provide the full markdown and tags.',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_memos',
      description: 'Propose merging several memos into one new memo. Read them first, then write the synthesized markdown yourself.',
      parameters: {
        type: 'object',
        properties: {
          source_ids: { type: 'array', items: { type: 'number' } },
          title: { type: 'string' },
          markdown: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['source_ids', 'markdown'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_memos',
      description: 'Propose linking several memos together as related.',
      parameters: {
        type: 'object',
        properties: { ids: { type: 'array', items: { type: 'number' } } },
        required: ['ids'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'retag_memo',
      description: 'Propose replacing the tags of a memo.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'tags'],
      },
    },
  },
];

// Which tools mutate (write) vs. read. Drives loop dispatch.
export const TOOL_KIND = {
  search_memos: 'read',
  read_memo: 'read',
  list_tags: 'read',
  create_memo: 'write',
  merge_memos: 'write',
  link_memos: 'write',
  retag_memo: 'write',
};

// ---- Read handlers ----
function scoreMemo(memo, terms) {
  const hay = `${memo.raw || ''}\n${memo.markdown || ''}\n${(memo.tags || []).join(' ')}`.toLowerCase();
  const title = (memo.preview || '').toLowerCase();
  let score = 0;
  for (const t of terms) {
    score += hay.split(t).length - 1;          // body hits
    score += (title.split(t).length - 1) * 3;  // title hits weighted
  }
  return score;
}

export function searchMemos({ query, limit = 5 }) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return loadHistory()
    .map(m => ({ m, s: scoreMemo(m, terms) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ m }) => ({
      id: m.id,
      title: m.title,
      preview: m.preview,
      tags: m.tags || [],
      snippet: (m.markdown || '').replace(/\s+/g, ' ').slice(0, 160),
      createdAt: m.createdAt,
    }));
}

export function readMemo({ id }) {
  const m = loadHistory().find(e => e.id === Number(id));
  if (!m) return { error: `No memo with id ${id}` };
  return { id: m.id, markdown: m.markdown, tags: m.tags || [], links: m.links || [], createdAt: m.createdAt };
}

export function listTags() {
  const counts = {};
  for (const m of loadHistory()) for (const t of (m.tags || [])) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function runReadTool(name, args) {
  switch (name) {
    case 'search_memos': return searchMemos(args);
    case 'read_memo': return readMemo(args);
    case 'list_tags': return listTags();
    default: return { error: `Unknown read tool ${name}` };
  }
}

// ---- Write proposals (loop emits these; nothing is mutated until apply) ----
// Summaries follow AGENT_LANG (default zh-TW): zh-* keeps 繁體中文, anything else English.
const LANG_ZH = (process.env.AGENT_LANG || 'zh-TW').startsWith('zh');

export function buildProposal(name, args) {
  switch (name) {
    case 'create_memo':
      return { action: name, args, summary: LANG_ZH
        ? `建立新筆記（${(args.tags || []).join(', ') || '無標籤'}）`
        : `New memo (${(args.tags || []).join(', ') || 'no tags'})` };
    case 'merge_memos':
      return { action: name, args, summary: LANG_ZH
        ? `合併 ${(args.source_ids || []).length} 篇為「${args.title || '未命名'}」`
        : `Merge ${(args.source_ids || []).length} memos into "${args.title || 'Untitled'}"` };
    case 'link_memos':
      return { action: name, args, summary: LANG_ZH
        ? `連結 ${(args.ids || []).length} 篇筆記`
        : `Link ${(args.ids || []).length} memos` };
    case 'retag_memo':
      return { action: name, args, summary: LANG_ZH
        ? `重設 #${args.id} 標籤為 ${(args.tags || []).join(', ')}`
        : `Retag #${args.id} to ${(args.tags || []).join(', ')}` };
    default:
      return { action: name, args, summary: name };
  }
}

function existingIds() {
  return new Set(loadHistory().map(e => e.id));
}

// ---- Apply a user-confirmed proposal. Mutates history. ----
export function applyProposal({ action, args = {} }) {
  switch (action) {
    case 'create_memo': {
      if (typeof args.markdown !== 'string' || !args.markdown.trim())
        return { ok: false, error: 'markdown (non-empty string) required' };
      const entry = insertEntry(createEntry({ markdown: args.markdown, tags: args.tags || [] }));
      return { ok: true, id: entry.id };
    }
    case 'merge_memos': {
      if (typeof args.markdown !== 'string' || !args.markdown.trim())
        return { ok: false, error: 'markdown (non-empty string) required' };
      const ids = (args.source_ids || []).map(Number);
      const have = existingIds();
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown source ids: ${missing.join(', ')}` };
      const md = args.title ? `# ${args.title}\n\n${args.markdown}` : args.markdown;
      const entry = insertEntry(createEntry({ markdown: md, tags: args.tags || [], sources: ids }));
      return { ok: true, id: entry.id };
    }
    case 'link_memos': {
      const ids = (args.ids || []).map(Number);
      const history = loadHistory();
      const have = new Set(history.map(e => e.id));
      const missing = ids.filter(id => !have.has(id));
      if (missing.length) return { ok: false, error: `Unknown ids: ${missing.join(', ')}` };
      for (const m of history) {
        if (ids.includes(m.id)) {
          const others = ids.filter(x => x !== m.id);
          m.links = Array.from(new Set([...(m.links || []), ...others]));
        }
      }
      saveHistory(history);
      return { ok: true, ids };
    }
    case 'retag_memo': {
      const id = Number(args.id);
      const history = loadHistory();
      const m = history.find(e => e.id === id);
      if (!m) return { ok: false, error: `No memo with id ${id}` };
      m.tags = args.tags || [];
      saveHistory(history);
      return { ok: true, id };
    }
    default:
      return { ok: false, error: `Unknown action ${action}` };
  }
}
