import { TOOLS, TOOL_KIND, runReadTool, buildProposal, validateProposal } from './tools.js';
import { registerProposal } from './proposals.js';

const MAX_STEPS = 8;

// Language for all agent output (BCP-47 tag). Default zh-TW (繁體中文).
const RESPONSE_LANG = process.env.AGENT_LANG || 'zh-TW';
const LANG_ZH = RESPONSE_LANG.startsWith('zh');

const SYSTEM = `You are an agent that helps the user manage a markdown notebook.
You can search and read memos, and propose changes (create/merge/link/retag).
Plan your steps. Use search_memos and read_memo to gather context before answering or proposing changes.
When the user wants something synthesized or merged, read the relevant memos first, then write the result yourself.
Write tools only PROPOSE changes — the user confirms them; never assume a proposed change has been applied.
Always respond — including reasoning text and any markdown you write into memos — in this language (BCP-47 tag): ${RESPONSE_LANG} (for zh-TW, use 繁體中文/Traditional Chinese), regardless of the language the user writes in. Cite the memo ids you used.`;

// Real OpenRouter call. Returns { message, usage }.
export async function callOpenRouter(messages, tools) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
  const model = process.env.AGENT_MODEL || process.env.AI_MODEL || 'deepseek/deepseek-v4-pro';
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/Lewsiafat/md-memo',
      'X-Title': 'md-memo',
    },
    body: JSON.stringify({ model, messages, tools, temperature: 0.3, max_tokens: 4096 }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 300)}`);
  }
  const data = await res.json();
  return { message: data.choices?.[0]?.message || {}, usage: data.usage || {} };
}

function parseArgs(tc) {
  const a = tc.function?.arguments;
  if (a && typeof a === 'object') return a;
  try { return JSON.parse(a || '{}'); } catch { return {}; }
}

// Run the agent loop. emit(event, data) streams events.
// callModel is injectable for tests; priorTurns allows multi-turn context.
export async function runAgent(message, emit, { callModel = callOpenRouter, priorTurns = [] } = {}) {
  const messages = [{ role: 'system', content: SYSTEM }, ...priorTurns, { role: 'user', content: message }];
  let totalTokens = 0;
  emit('start', {});
  for (let step = 0; step < MAX_STEPS; step++) {
    const { message: msg, usage } = await callModel(messages, TOOLS);
    totalTokens += usage?.total_tokens || 0;
    if (msg.content) emit('message', { content: msg.content });
    if (!msg.tool_calls?.length) {
      emit('answer', { content: msg.content || '' });
      emit('done', { steps: step + 1, tokens: totalTokens });
      return;
    }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      const name = tc.function.name;
      const args = parseArgs(tc);
      emit('tool_call', { name, args });
      let toolContent;
      if (TOOL_KIND[name] === 'write') {
        const valid = validateProposal(name, args);
        if (valid.ok) {
          const proposal = buildProposal(name, args);
          emit('proposal', { id: registerProposal(proposal), ...proposal });
          toolContent = 'Proposed to the user for confirmation. Assume not yet applied.';
        } else {
          // Invalid args never reach the user — the error goes back to the
          // model as a tool result so it can self-correct within this run.
          emit('tool_result', { name, result: { error: valid.error } });
          toolContent = JSON.stringify({ error: valid.error });
        }
      } else {
        const result = runReadTool(name, args);
        emit('tool_result', { name, result });
        toolContent = JSON.stringify(result);
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent });
    }
  }
  emit('answer', { content: LANG_ZH
    ? `（已達 ${MAX_STEPS} 步上限，未能完成；以上為目前進度。）`
    : `(Reached the ${MAX_STEPS}-step limit; partial progress above.)` });
  emit('done', { steps: MAX_STEPS, tokens: totalTokens });
}
