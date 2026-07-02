// Parsing helpers for the /api/format response.

// Parse tags from markdown — the AI appends <!-- tags: a, b, c --> at the end.
export function parseTags(raw) {
  const match = raw.match(/<!--\s*tags:\s*(.*?)-->/is);
  if (!match) return { markdown: raw.trim(), tags: [] };
  const tags = match[1].split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const markdown = raw.replace(/<!--\s*tags:.*?-->/gis, '').trim();
  return { markdown, tags };
}

// Turn an OpenRouter chat completion into { markdown, tags, truncated }.
// truncated is true when the model hit the output cap (finish_reason 'length'),
// in which case the trailing tags line is usually missing — surface it rather
// than silently dropping content.
export function parseFormatResult(data) {
  const choice = data?.choices?.[0];
  const raw = choice?.message?.content?.trim() || '';
  const truncated = choice?.finish_reason === 'length';
  const { markdown, tags } = parseTags(raw);
  return { markdown, tags, truncated };
}
