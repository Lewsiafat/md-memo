// Build the static demo bundle into dist-demo/.
// Demo-only; does not affect `npm start`. Run: npm run build:demo
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPermalink } from '../src/permalink.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist-demo');
const BASE_PATH = '/md-memo'; // GitHub Pages serves at https://lewsiafat.github.io/md-memo/

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

// 1. Clean output
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'data'), { recursive: true });

// 2. index.html: inject mock loader BEFORE the first app script, then replace base path
let html = read('public/index.html');
const anchor = "  <script>\n    const API = '__BASE_PATH__/api';";
if (!html.includes(anchor)) throw new Error('build-demo: could not find the app <script> anchor in index.html');
html = html.replace(anchor, '  <script src="mock.js"></script>\n' + anchor);
html = html.replace(/__BASE_PATH__/g, BASE_PATH);
fs.writeFileSync(path.join(out, 'index.html'), html);

// 3. Copy mock + data
fs.copyFileSync(path.join(root, 'demo/mock.js'), path.join(out, 'mock.js'));
for (const f of ['history.json', 'format-samples.json', 'agent-trace.json']) {
  fs.copyFileSync(path.join(root, 'demo/data', f), path.join(out, 'data', f));
}

// 4. Pre-generate permalinks: one per seed memo + one for the agent-applied merge note
const history = readJson('demo/data/history.json');
const trace = readJson('demo/data/agent-trace.json');
const prop = trace.events.find(e => e.event === 'proposal').data;
const mergedMd = prop.args.title ? `# ${prop.args.title}\n\n${prop.args.markdown}` : prop.args.markdown;
const mergedNote = {
  id: trace.apply.id,
  createdAt: trace.apply.createdAt,
  markdown: mergedMd,
  tags: prop.args.tags || [],
  preview: mergedMd.split('\n').find(l => l.trim()) || '(empty)',
};

const allNotes = [...history, mergedNote];
for (const entry of allNotes) {
  const dir = path.join(out, 'm', String(entry.id));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), renderPermalink(entry, BASE_PATH));
}

// 5. Disable Jekyll
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Built dist-demo/ — ${allNotes.length} permalinks, base path ${BASE_PATH}`);
