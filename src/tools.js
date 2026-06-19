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
