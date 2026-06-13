// Build ruvector-kb.rvf — v2 (enriched). Mechanical enumeration of the RuVector monorepo
// knowledge layer (v1 corpus: docs/ADRs/research, crate manifests + READMEs, example
// READMEs, npm package.json, skills frontmatter) PLUS:
//   crate-src : every crate's lib.rs|main.rs leading //! block + first 100 lines,
//               per-crate module lists, and every .rs file's leading //! doc block
//               (repo-wide sweep, first 30 lines)
//   doc-deep  : EVERY *.md in the repo not already in the corpus (full text, chunked)
// Embeddings: local Xenova/all-MiniLM-L6-v2 (384-dim, quantized ONNX). Store: @ruvector/rvf.
// Deps resolved PORTABLY via kb/resolve-deps.mjs (project node_modules -> env -> Mac paths).
// Usage: node kb/.build-ruvector-kb/build.mjs   (old kb files backed up as *.v1.*)
//   KB_REPO_ROOT overrides the repo root (defaults to two dirs up from this script).
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel } from '../resolve-deps.mjs';

const { mod: rvfMod, via: rvfVia } = loadRvf();
const { RvfDatabase } = rvfMod;
console.log('[build] @ruvector/rvf via:', rvfVia);

const __dirname = path.dirname(fileURLToPath(import.meta.url)); // kb/.build-ruvector-kb
// repo root = two levels up (kb/.build-ruvector-kb -> kb -> root), overridable for CI.
const ROOT = process.env.KB_REPO_ROOT || path.resolve(__dirname, '..', '..');
const R = path.join(ROOT, 'ruvector');
const OUT = path.join(ROOT, 'kb/ruvector-kb.rvf');
const IDMAP = path.join(ROOT, 'kb/ruvector-kb.ids.json');
const PASSAGES = path.join(ROOT, 'kb/ruvector-kb.passages.jsonl');

// ---------- enumeration helpers ----------
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'build']);
function* walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile()) {
      yield path.join(dir, e.name);
    }
  }
}
const rel = (p) => path.relative(R, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const tryRead = (p) => { try { return read(p); } catch { return null; } };
const firstLines = (s, n) => s.split('\n').slice(0, n).join('\n');
function mdTitle(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).trim().slice(0, 200);
}
// leading //! doc block from the first N lines ('' if none)
function docBlock(text, n = 30) {
  const lines = text.split('\n').slice(0, n).filter((l) => /^\s*\/\/!/.test(l));
  return lines.map((l) => l.replace(/^\s*\/\/!\s?/, '')).join('\n').trim();
}

// ---------- corpus ----------
const docsFiles = []; // {path, kind, title, text}
const counts = {};
const ingestedMd = new Set(); // absolute paths of md already in corpus
function add(kind, relpath, title, text, absPath) {
  counts[kind] = (counts[kind] || 0) + 1;
  docsFiles.push({ path: relpath, kind, title, text });
  if (absPath) ingestedMd.add(absPath);
}

// ============ v1 CORPUS (unchanged) ============

// 1. docs/** markdown -> adr | research | doc
for (const f of walk(path.join(R, 'docs'))) {
  if (!f.endsWith('.md')) continue;
  const rp = rel(f);
  const text = read(f);
  const title = mdTitle(text, path.basename(f, '.md'));
  let kind = 'doc';
  if (rp.startsWith('docs/research/')) kind = 'research';
  else if (rp.toLowerCase().includes('adr')) kind = 'adr';
  else if (rp.toLowerCase().includes('tutorial')) kind = 'tutorial';
  add(kind, rp, title, text, f);
}

// 1b. tutorials — explicit sweep so tutorials are guaranteed present & tagged.
//     Any *tutorial*.md repo-wide + the basic guide, full text.
for (const p of walk(R)) {
  if (!p.endsWith('.md') || ingestedMd.has(p)) continue;
  const base = path.basename(p).toLowerCase();
  if (/tutorial/.test(base) || /basic_tutorial/.test(base)) {
    const text = read(p);
    add('tutorial', rel(p), mdTitle(text, path.basename(p)), text, p);
  }
}

// 2. crates/** Cargo.toml (manifest summaries) + README.md (full text) -> crate
for (const f of walk(path.join(R, 'crates'))) {
  const base = path.basename(f);
  const rp = rel(f);
  if (base === 'Cargo.toml') {
    const t = read(f);
    const pkg = t.match(/^\[package\]([\s\S]*?)(?=^\[|\s*$(?![\s\S]))/m);
    const sec = pkg ? pkg[1] : '';
    const g = (k) => { const m = sec.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm')); return m ? m[1] : ''; };
    const name = g('name') || `${path.basename(path.dirname(f))} (workspace manifest)`;
    const desc = g('description');
    const kw = (sec.match(/^keywords\s*=\s*\[([^\]]*)\]/m) || [, ''])[1].replace(/"/g, '');
    const members = (t.match(/^members\s*=\s*\[([\s\S]*?)\]/m) || [, ''])[1]
      .split(/[\s,]+/).map(s => s.replace(/"/g, '')).filter(Boolean).join(', ');
    let text = `Rust crate: ${name}\nPath: ${rp}\n`;
    if (desc) text += `Description: ${desc}\n`;
    if (kw) text += `Keywords: ${kw}\n`;
    if (members) text += `Workspace members: ${members}\n`;
    add('crate', rp, name, text);
  } else if (base === 'README.md') {
    const text = read(f);
    add('crate', rp, mdTitle(text, path.dirname(rp)), text, f);
  }
}

// 3. examples/**/README.md -> example
for (const f of walk(path.join(R, 'examples'))) {
  if (path.basename(f) !== 'README.md') continue;
  const text = read(f);
  add('example', rel(f), mdTitle(text, path.dirname(rel(f))), text, f);
}

// 4. npm package.json -> npm. Was npm/** only; now ALSO crates/**/package.json +
//    ui/**/package.json (node/wasm binding manifests). Skip per-platform prebuilt
//    stubs (**/npm/<os>-<arch>/package.json) and vendored stub/ dirs — noise, not knowledge.
{
  const npmManifest = (f) => {
    const rp = rel(f);
    if (ingestedMd.has(f)) return;
    if (/\/npm\/[^/]+\/package\.json$/.test(rp)) return;        // per-platform binary stub
    if (/(^|\/)(stub|pkg|\.vite|dist)(\/|$)/.test(rp)) return;   // vendored / generated output
    try {
      const j = JSON.parse(read(f));
      const scripts = j.scripts ? Object.keys(j.scripts).join(', ') : '';
      const bin = j.bin ? (typeof j.bin === 'string' ? j.bin : Object.keys(j.bin).join(', ')) : '';
      const text = `npm package: ${j.name || rp}\nVersion: ${j.version || ''}\nPath: ${rp}\n`
        + `Description: ${j.description || ''}\n`
        + (bin ? `Bin: ${bin}\n` : '')
        + (scripts ? `Scripts: ${scripts}\n` : '')
        + (j.dependencies ? `Dependencies: ${Object.keys(j.dependencies).join(', ')}\n` : '')
        + `Keywords: ${(j.keywords || []).join(', ')}`;
      add('npm', rp, j.name || rp, text, f);
    } catch { add('npm', rp, rp, `npm package manifest (unparseable JSON) at ${rp}`, f); }
  };
  for (const base of ['npm', 'crates', 'ui', 'examples']) {
    for (const f of walk(path.join(R, base))) {
      if (path.basename(f) === 'package.json') npmManifest(f);
    }
  }
  // repo-root package.json (workspace npm manifest)
  const rootPkg = path.join(R, 'package.json');
  if (fs.existsSync(rootPkg)) npmManifest(rootPkg);
}

// 4b. workspace-root manifest — root Cargo.toml ([workspace.members] map) -> crate
{
  const f = path.join(R, 'Cargo.toml');
  const t = tryRead(f);
  if (t) {
    const members = (t.match(/members\s*=\s*\[([\s\S]*?)\]/m) || [, ''])[1]
      .split(/[\s,]+/).map((s) => s.replace(/["']/g, '')).filter(Boolean).join(', ');
    add('crate', 'Cargo.toml', 'Cargo.toml workspace manifest',
      `Cargo workspace manifest: Cargo.toml\nWorkspace members: ${members}\n\n${t}`, f);
  }
}

// 4c. nested example-crate manifests — examples/**/Cargo.toml -> crate
let exCrateCount = 0;
for (const f of walk(path.join(R, 'examples'))) {
  if (path.basename(f) !== 'Cargo.toml') continue;
  const rp = rel(f);
  const t = read(f);
  const pkg = t.match(/^\[package\]([\s\S]*?)(?=^\[|\s*$(?![\s\S]))/m);
  const sec = pkg ? pkg[1] : '';
  const name = (sec.match(/^name\s*=\s*"([^"]*)"/m) || [, ''])[1] || `${path.basename(path.dirname(f))} (workspace manifest)`;
  const desc = (sec.match(/^description\s*=\s*"([^"]*)"/m) || [, ''])[1];
  const members = (t.match(/^members\s*=\s*\[([\s\S]*?)\]/m) || [, ''])[1]
    .split(/[\s,]+/).map((s) => s.replace(/"/g, '')).filter(Boolean).join(', ');
  let text = `Rust crate: ${name}\nPath: ${rp}\n`;
  if (desc) text += `Description: ${desc}\n`;
  if (members) text += `Workspace members: ${members}\n`;
  add('crate', rp, name, text, f);
  exCrateCount++;
}

// 5. repo README.md + CHANGELOG.md (top 600 lines) -> doc
for (const base of ['README.md', 'CHANGELOG.md']) {
  const f = path.join(R, base);
  if (fs.existsSync(f)) {
    const text = read(f).split('\n').slice(0, 600).join('\n');
    add('doc', base, mdTitle(text, base), text, f);
  }
}

// 6. .claude/skills/*/SKILL.md frontmatter -> skill (full bodies land in doc-deep below)
const skillsDir = path.join(R, '.claude/skills');
if (fs.existsSync(skillsDir)) {
  for (const d of fs.readdirSync(skillsDir)) {
    const f = path.join(skillsDir, d, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const t = read(f);
    const fm = t.match(/^---\n([\s\S]*?)\n---/);
    const text = `Skill: ${d}\n${fm ? fm[1] : t.split('\n').slice(0, 30).join('\n')}`;
    add('skill', rel(f), d, text);
  }
}

// 6b. high-value sub-module .rs BODIES (FULL text, chunked) — query engine + attention CLI
//     + hyperbolic postgres. Indexed in full (not just lead doc-comment); added to
//     fullBodyFiles so steps 7/8 skip them.
const fullBodyFiles = new Set();
for (const sub of [
  'crates/rvlite/src',
  'crates/ruvector-attention-cli/src/commands',
  'crates/ruvector-postgres/src/hyperbolic',
  'crates/ruvector-postgres/src/graph',     // SPARQL+Cypher graph engine bodies
  'crates/ruvector-postgres/src/routing',   // FastGRNN routing bodies
]) {
  const dir = path.join(R, sub);
  if (!fs.existsSync(dir)) continue;
  for (const p of walk(dir)) {
    if (!p.endsWith('.rs')) continue;
    fullBodyFiles.add(p);
    add('crate-src', rel(p), path.basename(p), `Rust source ${rel(p)} (full):\n${read(p)}`, p);
  }
}

// ============ v2 ENRICHMENT ============

// 7. crate-src — every crate in the repo (every Cargo.toml dir with src/lib.rs|src/main.rs):
//    (a) lead file leading //! block + first 100 lines, (b) module-list entry.
const leadFiles = new Set();
const cargoTomls = [...walk(R)].filter((p) => path.basename(p) === 'Cargo.toml').sort();
let crateCount = 0;
for (const ct of cargoTomls) {
  const cdir = path.dirname(ct);
  const crateName = (tryRead(ct)?.match(/^name\s*=\s*"([^"]*)"/m) || [])[1] || path.basename(cdir);
  const lead = ['src/lib.rs', 'src/main.rs'].map((f) => path.join(cdir, f)).find((p) => fs.existsSync(p));
  if (!lead) continue;
  crateCount++;
  leadFiles.add(lead);
  const relDir = rel(cdir) || '.';
  // Skip the truncated lead entry if this lead file is already indexed in full (6b);
  // still emit the module-list entry below.
  if (!fullBodyFiles.has(lead)) {
    const text = read(lead);
    const doc = docBlock(text, 200); // full leading doc block even when longer than 100 lines
    const body = firstLines(text, 100);
    add('crate-src', rel(lead), `${crateName} ${path.basename(lead)}`,
      `Crate ${crateName} (${relDir}) — ${path.basename(lead)} leading doc + first 100 lines:\n` +
      (doc ? `/* doc */\n${doc}\n\n` : '') + body);
  }
  // module list + examples/benches/tests/docs file names
  const mods = [...walk(path.join(cdir, 'src'))].filter((p) => p.endsWith('.rs')).map((p) => path.relative(path.join(cdir, 'src'), p)).sort();
  const extras = [];
  for (const sub of ['examples', 'benches', 'tests', 'docs']) {
    const d = path.join(cdir, sub);
    if (fs.existsSync(d)) {
      const fls = [...walk(d)].map((p) => path.relative(d, p)).sort().slice(0, 60);
      if (fls.length) extras.push(`${sub}: ${fls.join(', ')}`);
    }
  }
  add('crate-src', `${relDir}/src`, `${crateName} modules`,
    `Crate ${crateName} (${relDir}) modules: ${mods.join(', ')}` + (extras.length ? `\n${extras.join('\n')}` : ''));
}

// 8. crate-src — repo-wide sweep: every .rs file's leading //! doc block (first 30 lines)
//     (skip lead files and the full-body files already indexed in 6b)
let rsDocCount = 0;
for (const p of walk(R)) {
  if (!p.endsWith('.rs') || leadFiles.has(p) || fullBodyFiles.has(p)) continue;
  const doc = docBlock(firstLines(read(p), 30));
  if (!doc) continue;
  rsDocCount++;
  const rp = rel(p);
  add('crate-src', rp, path.basename(p), `Rust module ${rp} — doc comment:\n${doc}`);
}

// 9. doc-deep — EVERY *.md in the repo not already in the corpus (full text)
let mdDeepCount = 0;
for (const p of walk(R)) {
  if (!p.endsWith('.md') || ingestedMd.has(p)) continue;
  mdDeepCount++;
  const rp = rel(p);
  const text = read(p);
  add('doc-deep', rp, mdTitle(text, path.basename(p)), text, p);
}

// ---------- chunking (~1000 tokens ~= 4000 chars) ----------
const MAX = 4000;
function chunkText(text) {
  const out = [];
  let s = text;
  while (s.length > MAX) {
    let cut = s.lastIndexOf('\n\n', MAX);
    if (cut < MAX * 0.4) cut = s.lastIndexOf('\n', MAX);
    if (cut < MAX * 0.4) cut = MAX;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s.trim().length) out.push(s);
  return out.length ? out : [''];
}

const chunks = []; // {id, path, kind, title, chunk, of, embedText, preview}
let nextId = 1;
for (const d of docsFiles) {
  const parts = chunkText(d.text);
  parts.forEach((p, i) => {
    chunks.push({
      id: String(nextId++),
      path: d.path, kind: d.kind, title: d.title, chunk: i + 1, of: parts.length,
      embedText: `${d.title} — ${d.path}\n${p}`.slice(0, MAX + 300),
      text: p,                       // FULL, untruncated chunk text for the passages sidecar
      preview: p.trim().slice(0, 200),
    });
  });
}

console.log('=== ENUMERATION (files per kind) ===');
console.log(JSON.stringify(counts, null, 2));
console.log('crates with lead file:', crateCount, '| .rs files with //! doc:', rsDocCount, '| md swept (doc-deep):', mdDeepCount);
console.log('example-crate manifests:', exCrateCount, '| full-body .rs files (rvlite+attn-cli+hyperbolic):', fullBodyFiles.size);
console.log('total files:', docsFiles.length, '| total chunks:', chunks.length);
const preCk = {};
for (const c of chunks) preCk[c.kind] = (preCk[c.kind] || 0) + 1;
console.log('chunks per kind:', JSON.stringify(preCk, null, 2));

// ---------- embeddings ----------
// Embedder resolved portably (project node_modules -> XENOVA_PATH env -> Mac build).
// Use the local MiniLM cache when present (fast, offline); otherwise allow remote download.
const { T, modelCache: MODEL_CACHE, via: tVia } = await loadTransformers();
const { haveLocalModel } = configureModel(T, MODEL_CACHE);
console.log('[build] transformers via:', tVia);
console.log('Embedder:', haveLocalModel ? `local cache ${MODEL_CACHE}` : `remote download (cache: ${MODEL_CACHE})`);
const embed = await T.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

// back up v1 store + sidecars before overwriting
for (const [src, dst] of [
  [OUT, OUT.replace(/\.rvf$/, '.v1.rvf')],
  [OUT + '.idmap.json', OUT.replace(/\.rvf$/, '.v1.rvf') + '.idmap.json'],
  [IDMAP, IDMAP.replace(/\.json$/, '.v1.json')],
]) {
  if (fs.existsSync(src) && !fs.existsSync(dst)) { fs.copyFileSync(src, dst); console.log('backed up', path.basename(src), '->', path.basename(dst)); }
}

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
if (fs.existsSync(OUT + '.idmap.json')) fs.unlinkSync(OUT + '.idmap.json');
const db = await RvfDatabase.create(OUT, { dimensions: 384, metric: 'cosine' });

// Full-text passages sidecar: one JSON object per line {id,text,path,title}.
// Same id as the vector in the .rvf and in the id map — so retrieval can join.
fs.rmSync(PASSAGES, { force: true });
const passagesFd = fs.openSync(PASSAGES, 'w');
let passageLines = 0;
const BATCH = 48;
let accepted = 0, rejected = 0;
const t0 = Date.now();
for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  const out = await embed(batch.map(c => c.embedText), { pooling: 'mean', normalize: true });
  const dim = out.dims[1];
  const entries = batch.map((c, j) => {
    fs.writeSync(passagesFd, JSON.stringify({ id: c.id, text: c.text, path: c.path, title: c.title }) + '\n');
    passageLines++;
    return {
      id: c.id,
      vector: Array.from(out.data.slice(j * dim, (j + 1) * dim)),
      metadata: { path: c.path, kind: c.kind, title: c.title.slice(0, 120), chunk: c.chunk },
    };
  });
  const r = await db.ingestBatch(entries);
  accepted += r.accepted; rejected += r.rejected;
  if ((i / BATCH) % 20 === 0) {
    const rate = (i + batch.length) / ((Date.now() - t0) / 1000);
    console.log(`progress ${i + batch.length}/${chunks.length} (${rate.toFixed(1)}/s, accepted=${accepted}, rejected=${rejected})`);
  }
}
fs.closeSync(passagesFd);
console.log(`ingest done: accepted=${accepted} rejected=${rejected} in ${((Date.now() - t0) / 1000).toFixed(0)}s | passages lines: ${passageLines}`);

const status = await db.status();
console.log('status:', JSON.stringify(status));
console.log('Reconcile: chunks assembled =', chunks.length, '| vectors in store =', status.totalVectors, '| match =', chunks.length === status.totalVectors);

// ---------- verification queries (before close, same handle) ----------
const queries = [
  'HNSW insert implementation ruvector-core',
  'what does the coherence gate decide',
  'which crate does dynamic min-cut',
  'how do I load an rvf file in Node',
  'SONA LoRA adaptation API',
  'what research exists on sublinear solvers',
];
const byId = {};
for (const c of chunks) byId[c.id] = c;
console.log('=== VERIFICATION QUERIES ===');
for (const q of queries) {
  const out = await embed([q], { pooling: 'mean', normalize: true });
  const hits = await db.query(Array.from(out.data), 5);
  console.log(`\nQ: ${q}`);
  for (const h of hits) {
    const m = byId[h.id] || {};
    console.log(`  ${h.distance.toFixed(4)}  [${m.kind}] ${m.path} (chunk ${m.chunk}/${m.of}) — ${m.title}`);
  }
}
await db.close();

// sidecar id map (metadata lookup; vectors live ONLY in the .rvf)
const map = {};
for (const c of chunks) map[c.id] = { path: c.path, kind: c.kind, title: c.title, chunk: c.chunk, of: c.of, preview: c.preview };
fs.writeFileSync(IDMAP, JSON.stringify({
  model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, metric: 'cosine',
  generated: new Date().toISOString(), entries: map,
}));
console.log('id map written:', IDMAP, '| header: model=Xenova/all-MiniLM-L6-v2 dim=384 metric=cosine');
console.log('Passages reconcile: vectors =', status.totalVectors, '| passages lines =', passageLines, '| id-map ids =', Object.keys(map).length, '| match =', status.totalVectors === passageLines && passageLines === Object.keys(map).length);
console.log('=== AFTER (chunks per kind) ===');
console.log(JSON.stringify(preCk, null, 2));
console.log('file size:', fs.statSync(OUT).size, 'bytes');
