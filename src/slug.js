// Title & slug derivation — the memo's wiki identity (Phase 1 wikilinks
// resolve against slugs, so a slug must stay stable once assigned).

// First markdown heading line (hashes/bold/backticks stripped); falls back
// to the first non-empty line.
export function deriveTitle(markdown) {
  const lines = String(markdown || '').split('\n');
  const line = lines.find(l => /^#{1,6}\s+\S/.test(l.trim())) ?? lines.find(l => l.trim());
  if (!line) return '(untitled)';
  return line.trim().replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/`/g, '').trim() || '(untitled)';
}

// Kebab-case keeping unicode letters/digits, so CJK titles stay readable.
export function slugify(text) {
  const s = String(text || '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'memo';
}

export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
