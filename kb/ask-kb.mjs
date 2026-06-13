#!/usr/bin/env node
// ask-kb.mjs — self-contained CLI to query a Cognitum RVF knowledge base and print
// the FULL top-k passages (not previews). Joins .rvf vector hits to the full-text
// passages sidecar (.passages.jsonl) by id.
//
// Usage:
//   node kb/ask-kb.mjs <ruvector|ruview> "your question" [k]
//
// Deps: @ruvector/rvf + @xenova/transformers (resolved PORTABLY — see resolve-deps.mjs:
// project node_modules first, then RVF_MODULE_PATH/XENOVA_PATH env, then author Mac paths)
// + the bundled kb/*.rvf and kb/*.passages.jsonl files. So `cd kb && npm i` then run.
// Model cache is configurable via KB_MODEL_CACHE (offline if cached, else downloads MiniLM
// from HuggingFace — works on a fresh machine).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { loadRvf, loadTransformers, configureModel } from './resolve-deps.mjs';

const { mod: rvfMod, via: rvfVia } = loadRvf();
const { RvfDatabase } = rvfMod;
if (process.env.KB_DEBUG) console.error(`[ask-kb] @ruvector/rvf via: ${rvfVia}`);

const __filename = fileURLToPath(import.meta.url); // decodes %20 etc.
const KB_DIR = path.dirname(__filename);

const STORES = {
  ruvector: {
    rvf: path.join(KB_DIR, 'ruvector-kb.rvf'),
    passages: path.join(KB_DIR, 'ruvector-kb.passages.jsonl'),
  },
  ruview: {
    rvf: path.join(KB_DIR, 'ruview-kb.rvf'),
    passages: path.join(KB_DIR, 'ruview-kb.passages.jsonl'),
  },
};

// ---------- embedder (lazy, configurable, offline-first with remote fallback) ----------
let _fe = null;
async function getEmbedder() {
  if (_fe) return _fe;
  const { T, modelCache, via } = await loadTransformers();
  const { haveLocalModel } = configureModel(T, modelCache);
  if (process.env.KB_DEBUG) {
    console.error(`[ask-kb] transformers via: ${via} | model cache: ${modelCache} `
      + `(${haveLocalModel ? 'local' : 'remote download'})`);
  }
  _fe = await T.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  return _fe;
}

async function embed(text) {
  const fe = await getEmbedder();
  const out = await fe([text], { pooling: 'mean', normalize: true });
  return Float32Array.from(out.data);
}

// ---------- passages sidecar loader (id -> {text,path,title}) ----------
function loadPassages(file) {
  return new Promise((resolve, reject) => {
    const map = new Map();
    if (!fs.existsSync(file)) return reject(new Error(`passages sidecar not found: ${file}`));
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const o = JSON.parse(line);
        map.set(String(o.id), { text: o.text, path: o.path, title: o.title });
      } catch { /* skip malformed line */ }
    });
    rl.on('close', () => resolve(map));
    rl.on('error', reject);
  });
}

// ---------- core search: returns [{id,distance,path,title,text}] ----------
export async function searchKb({ query, k = 6, store }) {
  const conf = STORES[store];
  if (!conf) throw new Error(`unknown store '${store}' (use 'ruvector' or 'ruview')`);
  if (!fs.existsSync(conf.rvf)) throw new Error(`rvf not found: ${conf.rvf}`);
  const [qv, passages] = await Promise.all([embed(query), loadPassages(conf.passages)]);
  const db = await RvfDatabase.openReadonly(conf.rvf);
  try {
    const hits = await db.query(qv, k);
    return hits.map((h) => {
      const p = passages.get(String(h.id)) || {};
      return {
        id: String(h.id),
        distance: h.distance,
        path: p.path || '(unknown path)',
        title: p.title || '(unknown title)',
        text: p.text || '(NO PASSAGE TEXT — id not found in sidecar)',
      };
    });
  } finally {
    await db.close();
  }
}

// ---------- CLI ----------
async function main() {
  const [store, query, kArg] = process.argv.slice(2);
  if (!store || !query) {
    console.error('Usage: node kb/ask-kb.mjs <ruvector|ruview> "question" [k]');
    process.exit(2);
  }
  const k = Math.max(1, parseInt(kArg || '6', 10) || 6);
  const results = await searchKb({ query, k, store });
  console.log(`\n=== ${store} KB — "${query}" — top ${results.length} ===\n`);
  results.forEach((r, i) => {
    console.log(`#${i + 1}  distance=${r.distance.toFixed(4)}`);
    console.log(`path : ${r.path}`);
    console.log(`title: ${r.title}`);
    console.log(`chars: ${r.text.length}`);
    console.log('----- passage -----');
    console.log(r.text);
    console.log('===================================================================\n');
  });
}

// Run as CLI when invoked directly (compare decoded real paths; handles spaces in path).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
