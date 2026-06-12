#!/usr/bin/env node
// Build the RuView RVF knowledge base.
// Vectors: @ruvector/rvf (RvfDatabase, HNSW, cosine). Embeddings: local
// @xenova/transformers Xenova/all-MiniLM-L6-v2 (384-dim). No cloud APIs.
//
// Usage: node Docs/KB/build-ruview-kb.mjs
// Output: Docs/KB/ruview-kb.rvf + Docs/KB/ruview-kb.meta.json (id -> metadata sidecar;
//         query() returns only {id, distance}, so the sidecar resolves hits to paths).

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { RvfDatabase } = require('/Users/stuartkerr/.npm-global/lib/node_modules/@ruvector/rvf');
const { pipeline } = require('/Users/stuartkerr/.npm-global/lib/node_modules/agentic-flow/node_modules/@xenova/transformers');

const ROOT = '/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer';
const RUVIEW = path.join(ROOT, 'RuView');
const OUT_RVF = path.join(ROOT, 'Docs/KB/ruview-kb.rvf');
const OUT_META = path.join(ROOT, 'Docs/KB/ruview-kb.meta.json');

const CHUNK_CHARS = 4000;   // ~1000 tokens
const OVERLAP_CHARS = 400;

// ---------- helpers ----------
const read = (p) => fs.readFileSync(p, 'utf8');
const tryRead = (p) => { try { return read(p); } catch { return null; } };
const firstLines = (s, n) => s.split('\n').slice(0, n).join('\n');

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function titleOf(text, fallback) {
  const m = text.match(/^#\s+(.+)$/m);
  return (m ? m[1] : fallback).slice(0, 200).trim();
}

function chunk(text) {
  const out = [];
  if (text.length <= CHUNK_CHARS) return [text];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + CHUNK_CHARS, text.length);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > i + CHUNK_CHARS / 2) end = para; // prefer paragraph boundary
    }
    out.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - OVERLAP_CHARS;
  }
  return out;
}

// ---------- corpus assembly (mechanical, no curation) ----------
const entries = [];   // { path, kind, title, chunkIdx, chunkTotal, text }
const sourceCounts = {};
function addDoc(relPath, kind, title, text) {
  const chunks = chunk(text);
  chunks.forEach((c, i) => entries.push({ path: relPath, kind, title, chunkIdx: i, chunkTotal: chunks.length, text: c }));
  sourceCounts[kind] = (sourceCounts[kind] || 0) + 1;
}

// 1. docs/** — every .md/.txt, full text
for (const p of walk(path.join(RUVIEW, 'docs'))) {
  if (!/\.(md|txt)$/.test(p)) continue;
  const rel = path.relative(RUVIEW, p);
  const text = read(p);
  let kind = 'doc';
  if (rel.includes('/adr/') || /(^|\/)ADR-/.test(rel)) kind = 'adr';
  else if (rel.includes('/tutorials/')) kind = 'tutorial';
  addDoc(rel, kind, titleOf(text, path.basename(p)), text);
}

// 2. v2/crates/* — Cargo.toml description + README + lib.rs first 60 lines
for (const dirent of fs.readdirSync(path.join(RUVIEW, 'v2/crates'), { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  const cdir = path.join(RUVIEW, 'v2/crates', dirent.name);
  const parts = [];
  const toml = tryRead(path.join(cdir, 'Cargo.toml'));
  if (toml) {
    const d = toml.match(/^description\s*=\s*"([^"]*)"/m);
    parts.push(`Crate: ${dirent.name}\nDescription: ${d ? d[1] : '(none)'}`);
  } else parts.push(`Crate: ${dirent.name} (no Cargo.toml)`);
  const librs = tryRead(path.join(cdir, 'src/lib.rs'));
  if (librs) parts.push('--- lib.rs (first 60 lines) ---\n' + firstLines(librs, 60));
  const readme = tryRead(path.join(cdir, 'README.md'));
  if (readme) parts.push('--- README ---\n' + readme);
  addDoc(`v2/crates/${dirent.name}`, 'crate', dirent.name, parts.join('\n\n'));
}

// 3. firmware — every .h under esp32-csi-node (first 60 lines) + provision.py docstring
for (const p of walk(path.join(RUVIEW, 'firmware/esp32-csi-node'))) {
  if (!p.endsWith('.h')) continue;
  const rel = path.relative(RUVIEW, p);
  addDoc(rel, 'firmware', path.basename(p), firstLines(read(p), 60));
}
{
  const prov = tryRead(path.join(RUVIEW, 'firmware/esp32-csi-node/provision.py'));
  if (prov) addDoc('firmware/esp32-csi-node/provision.py', 'firmware', 'provision.py', firstLines(prov, 60));
}

// 4. scripts/* — first 20 lines of each file
for (const dirent of fs.readdirSync(path.join(RUVIEW, 'scripts'), { withFileTypes: true })) {
  if (!dirent.isFile()) continue;
  const rel = `scripts/${dirent.name}`;
  addDoc(rel, 'script', dirent.name, `Script: ${dirent.name}\n` + firstLines(read(path.join(RUVIEW, rel)), 20));
}

// 5. README.md full + CHANGELOG.md top 500 lines
addDoc('README.md', 'doc', titleOf(read(path.join(RUVIEW, 'README.md')), 'README.md'), read(path.join(RUVIEW, 'README.md')));
addDoc('CHANGELOG.md', 'doc', 'CHANGELOG.md', firstLines(read(path.join(RUVIEW, 'CHANGELOG.md')), 500));

// 6. ui/*.html — title + meta
for (const f of fs.readdirSync(path.join(RUVIEW, 'ui')).filter((f) => f.endsWith('.html')).sort()) {
  const html = read(path.join(RUVIEW, 'ui', f));
  const t = html.match(/<title>([^<]*)<\/title>/i);
  const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => m[0]).join('\n');
  addDoc(`ui/${f}`, 'doc', t ? t[1] : f, `UI page: ${f}\nTitle: ${t ? t[1] : '(none)'}\n${metas}`);
}

// ---------- pre-ingest manifest ----------
const countWalk = (dir, pred) => [...walk(path.join(RUVIEW, dir))].filter(pred).length;
const preCounts = {
  'docs md+txt files': countWalk('docs', (p) => /\.(md|txt)$/.test(p)),
  'docs/adr files': fs.readdirSync(path.join(RUVIEW, 'docs/adr')).length,
  'scripts files': fs.readdirSync(path.join(RUVIEW, 'scripts'), { withFileTypes: true }).filter((d) => d.isFile()).length,
  'v2/crates dirs': fs.readdirSync(path.join(RUVIEW, 'v2/crates'), { withFileTypes: true }).filter((d) => d.isDirectory()).length,
  'firmware .h files': countWalk('firmware/esp32-csi-node', (p) => p.endsWith('.h')),
  'ui html files': fs.readdirSync(path.join(RUVIEW, 'ui')).filter((f) => f.endsWith('.html')).length,
};
console.log('=== PRE-INGEST SOURCE COUNTS ===');
console.log(JSON.stringify(preCounts, null, 2));
console.log('Corpus source files per kind:', JSON.stringify(sourceCounts));
console.log('Total chunks to embed:', entries.length);

// ---------- embed + ingest ----------
const t0 = Date.now();
const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
console.log('Embedder loaded in', Date.now() - t0, 'ms');

fs.rmSync(OUT_RVF, { force: true });
const db = await RvfDatabase.create(OUT_RVF, { dimensions: 384, metric: 'cosine' });

const meta = {};
const BATCH = 32;
let ingested = 0;
for (let i = 0; i < entries.length; i += BATCH) {
  const batch = entries.slice(i, i + BATCH);
  const out = await fe(batch.map((e) => e.text), { pooling: 'mean', normalize: true });
  const dim = out.dims[1];
  const ingest = batch.map((e, j) => {
    const id = String(i + j + 1);
    meta[id] = { path: e.path, kind: e.kind, title: e.title, chunk: `${e.chunkIdx + 1}/${e.chunkTotal}`, preview: e.text.slice(0, 240).replace(/\s+/g, ' ') };
    return {
      id,
      vector: Float32Array.from(out.data.slice(j * dim, (j + 1) * dim)),
      metadata: { path: e.path, kind: e.kind, title: e.title, chunk: e.chunkIdx },
    };
  });
  const r = await db.ingestBatch(ingest);
  ingested += r.accepted;
  if (r.rejected) console.error('REJECTED', r.rejected, 'in batch at', i);
  if ((i / BATCH) % 20 === 0) process.stdout.write(`\r${i + batch.length}/${entries.length}`);
}
console.log(`\nIngested ${ingested} vectors`);

const status = await db.status();
console.log('=== POST-INGEST ===');
console.log('RVF status:', JSON.stringify(status));
const kindTotals = {};
for (const e of entries) kindTotals[e.kind] = (kindTotals[e.kind] || 0) + 1;
console.log('Chunks per kind:', JSON.stringify(kindTotals));
console.log('Distinct source paths in KB:', new Set(entries.map((e) => e.path)).size);
console.log('Reconcile: chunks assembled =', entries.length, '| vectors in store =', status.totalVectors, '| match =', entries.length === status.totalVectors);

fs.writeFileSync(OUT_META, JSON.stringify({ model: 'Xenova/all-MiniLM-L6-v2', dimensions: 384, metric: 'cosine', entries: meta }, null, 1));

// ---------- verification queries ----------
const QUERIES = [
  'how do I calibrate an empty room',
  'what is the seed ingest packet format',
  'C6 time sync accuracy',
  'camera supervised pose training steps',
  'MQTT privacy modes',
];
console.log('=== VERIFICATION QUERIES ===');
for (const q of QUERIES) {
  const qv = await fe([q], { pooling: 'mean', normalize: true });
  const hits = await db.query(Float32Array.from(qv.data), 5);
  console.log(`\nQ: ${q}`);
  for (const h of hits) {
    const m = meta[h.id];
    console.log(`  ${h.distance.toFixed(4)}  [${m.kind}] ${m.path} (chunk ${m.chunk}) — ${m.title}`);
  }
}

await db.close();
console.log('\nDone. RVF size:', fs.statSync(OUT_RVF).size, 'bytes');
