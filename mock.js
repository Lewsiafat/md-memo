/* md-memo demo mock — replaces the backend with pre-recorded responses.
   Loaded before the app's inline script so window.fetch is patched first. */
(function () {
  const realFetch = window.fetch.bind(window);
  const state = { history: [], format: null, trace: null, sessions: [] };
  let dataP;

  // Resolve a demo data file relative to the page (served at <base>/).
  const dataUrl = (name) => new URL('data/' + name, location.href).href;

  function ensureData() {
    if (!dataP) {
      dataP = Promise.all([
        realFetch(dataUrl('history.json')).then(r => r.json()),
        realFetch(dataUrl('format-samples.json')).then(r => r.json()),
        realFetch(dataUrl('agent-trace.json')).then(r => r.json()),
      ]).then(([h, f, t]) => {
        state.history = h.slice();
        state.format = f;
        state.trace = t;
      });
    }
    return dataP;
  }

  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  // Per-event replay delay (ms) so the trace feels like a live run.
  const DELAY = { start: 120, message: 700, tool_call: 480, tool_result: 620, proposal: 420, answer: 560, done: 200 };

  function sseResponse(events) {
    const enc = new TextEncoder();
    let i = 0;
    const stream = new ReadableStream({
      start(controller) {
        (function push() {
          if (i >= events.length) { controller.close(); return; }
          const { event, data } = events[i++];
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          setTimeout(push, DELAY[event] ?? 400);
        })();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  // Build the merged note the same way the server's applyProposal(merge_memos) does.
  function mergedNoteFrom(args, apply) {
    const md = args.title ? `# ${args.title}\n\n${args.markdown}` : args.markdown;
    return {
      id: apply.id,
      createdAt: apply.createdAt,
      raw: '',
      markdown: md,
      tags: args.tags || [],
      preview: md.split('\n').find(l => l.trim()) || '(empty)',
      sources: (args.source_ids || []).map(Number),
    };
  }

  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const p = url.pathname;
    if (!p.includes('/api/')) return realFetch(input, init);

    const method = (init && init.method ? init.method : 'GET').toUpperCase();
    const body = init && init.body ? JSON.parse(init.body) : {};
    await ensureData();

    if (p.endsWith('/api/history') && method === 'GET') return json(state.history);

    if (p.endsWith('/api/format') && method === 'POST') {
      const r = state.format.result;
      // Reformat → overwrite: when the client passes an id, update that entry.
      if (body.id != null) {
        const existing = state.history.find(e => e.id === Number(body.id));
        if (existing) {
          existing.markdown = r.markdown;
          existing.tags = r.tags || [];
          existing.preview = r.markdown.split('\n').find(l => l.trim()) || '(empty)';
          return json({ markdown: r.markdown, tags: r.tags || [], id: existing.id });
        }
      }
      const entry = {
        id: Date.now(),
        createdAt: new Date().toISOString(),
        raw: body.text || '',
        markdown: r.markdown,
        tags: r.tags || [],
        preview: r.markdown.split('\n').find(l => l.trim()) || '(empty)',
      };
      state.history.unshift(entry);
      return json({ markdown: r.markdown, tags: r.tags || [], id: entry.id });
    }

    if (p.endsWith('/api/history/clear') && method === 'POST') {
      const count = state.history.length;
      state.history = [];
      return json({ ok: true, backedUp: count > 0, count });
    }

    if (p.includes('/api/history/') && method === 'PUT') {
      const id = Number(p.split('/').pop());
      const entry = state.history.find(e => e.id === id);
      if (!entry) return json({ ok: false, error: 'Memo not found' }, 404);
      if (body.markdown != null) {
        entry.markdown = body.markdown;
        entry.preview = body.markdown.split('\n').find(l => l.trim()) || '(empty)';
      }
      if (body.tags != null) entry.tags = body.tags;
      return json({ ok: true, entry });
    }

    if (p.includes('/api/history/') && method === 'DELETE') {
      const id = Number(p.split('/').pop());
      state.history = state.history.filter(e => e.id !== id);
      return json({ ok: true });
    }

    if (p.endsWith('/api/agent') && method === 'POST') return sseResponse(state.trace.events);

    if (p.endsWith('/api/agent/apply') && method === 'POST') {
      if (body.action === 'merge_memos') {
        const entry = mergedNoteFrom(body.args || {}, state.trace.apply);
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      if (body.action === 'create_memo') {
        const a = body.args || {};
        const entry = {
          id: Date.now(), createdAt: new Date().toISOString(), raw: '',
          markdown: a.markdown || '', tags: a.tags || [],
          preview: (a.markdown || '').split('\n').find(l => l.trim()) || '(empty)',
        };
        state.history.unshift(entry);
        return json({ ok: true, id: entry.id });
      }
      return json({ ok: true, id: Date.now() });
    }

    if (p.endsWith('/api/sessions') && method === 'GET') return json(state.sessions);
    if (p.endsWith('/api/sessions') && method === 'POST') {
      const s = { id: Date.now(), createdAt: new Date().toISOString(),
        question: body.question || '', answer: body.answer || '', events: body.events || [] };
      state.sessions.unshift(s);
      return json({ ok: true, id: s.id });
    }
    if (p.includes('/api/sessions/') && method === 'DELETE') {
      const id = Number(p.split('/').pop());
      state.sessions = state.sessions.filter(s => s.id !== id);
      return json({ ok: true });
    }

    return json({ error: 'unmocked: ' + p }, 404);
  };

  // Demo banner + one-click prefill (after the inline app script has run).
  window.addEventListener('DOMContentLoaded', async () => {
    const style = document.createElement('style');
    style.textContent =
      '#demo-banner{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:9999;' +
      'background:#6c5ce7;color:#fff;font:600 12px/1.4 -apple-system,sans-serif;padding:7px 16px;' +
      'border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);opacity:.94}';
    document.head.appendChild(style);
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.textContent = '🎭 Demo mode — AI 回應為預錄，非即時 LLM';
    document.body.appendChild(banner);

    await ensureData();
    const ta = document.getElementById('raw-input');
    if (ta && !ta.value) { ta.value = state.format.prefill; ta.dispatchEvent(new Event('input')); }
    const ai = document.getElementById('agentInput');
    if (ai && !ai.value) { ai.value = state.trace.question; }
  });
})();
