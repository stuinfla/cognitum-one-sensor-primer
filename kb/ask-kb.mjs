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

// ---------- passages sidecar loader ----------
// Returns { byId, byPath } where:
//   byId   : Map id(str) -> { id(num), text, path, title }
//   byPath : Map path     -> [ {id,text,...}, ... ] sorted by numeric id (== chunk order)
// Numeric id order reconstructs document chunk order: the builder assigns ids sequentially
// while walking a document, so a path's chunks are id-ordered (verified on both KBs).
function loadPassages(file) {
  return new Promise((resolve, reject) => {
    const byId = new Map();
    const byPath = new Map();
    if (!fs.existsSync(file)) return reject(new Error(`passages sidecar not found: ${file}`));
    const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const o = JSON.parse(line);
        const rec = { id: Number(o.id), text: o.text || '', path: o.path || '(unknown path)', title: o.title || '(unknown title)' };
        byId.set(String(o.id), rec);
        if (!byPath.has(rec.path)) byPath.set(rec.path, []);
        byPath.get(rec.path).push(rec);
      } catch { /* skip malformed line */ }
    });
    rl.on('close', () => {
      for (const arr of byPath.values()) arr.sort((a, b) => a.id - b.id);
      resolve({ byId, byPath });
    });
    rl.on('error', reject);
  });
}

// ===================================================================================
// Retrieval-quality layer (retrieval-only; KBs are NOT rebuilt).
// FIX 1 whole-document return, FIX 2 demote low-signal files,
// FIX 3 exact-term/ADR/title boost, FIX 4 "Cognitum Seed" disambiguation.
// ===================================================================================

const MAX_DOC_CHARS = 12000;            // cap for an assembled full document
// Chunks fetched from the vector index to group into documents and rerank. Kept generous so the
// small TOP-DOWN ORIENTATION LAYER (a few dozen `PRIMER#` section chunks) reliably enters the
// candidate pool for orientation queries — a tiny synthesized section can sit just outside a
// narrow window yet be the correct whole-document answer once reranked (FIX 5). Reranking is
// order-stable for the closest deep docs, so widening does not disturb non-orientation results.
const RAW_HITS = 96;

// FIX 2 — low-signal path patterns and the query keyword that *re-enables* each.
// A penalty is added to a doc's effective distance UNLESS the query mentions the kind.
const LOW_SIGNAL = [
  { re: /(^|\/)readme[^/]*$/i,                       pen: 0.18, allow: /\breadme\b/i },
  { re: /-checklist\.md$/i,                          pen: 0.15, allow: /\bchecklist\b/i },
  { re: /overview[^/]*\.md$/i,                       pen: 0.10, allow: /\boverview\b/i },     // TOC / link-list pages
  { re: /(^|\/)(index|toc|table-of-contents)[^/]*\.md$/i, pen: 0.10, allow: /\b(index|toc|contents)\b/i },
  { re: /(^|\/)archive\//i,                          pen: 0.20, allow: /\barchiv/i },
  { re: /(^|\/)examples?\/.*\.rs$/i,                 pen: 0.18, allow: /\bexamples?\b/i },
  { re: /(^|\/)benches?\//i,                         pen: 0.22, allow: /\b(bench|benchmark)/i },
  { re: /(^|\/)tests?\//i,                           pen: 0.16, allow: /\btest/i },
  { re: /(_test\.rs|\.test\.[jt]s|_spec\.rb)$/i,    pen: 0.16, allow: /\btest/i },
];

// FIX 4 — "Cognitum Seed" product disambiguation. When the query is about the Seed
// product/onboarding, bias toward onboarding/Seed docs and away from RNG/pretraining seeds.
const SEED_QUERY_RE = /\b(cognitum\s+seed|seed\s+(onboard\w*|pipeline|product)|onboard\w*\s+seed)\b/i;
const SEED_GOOD_RE  = /(adr[-_]?069|adr[-_]?116|(^|\/)seed|onboard|(^|\/)cog-)/i;
const SEED_BAD_RE   = /(rng|random|pretrain|nvsim|prng|np\.random|torch\.manual_seed)/i;

// FIX 5 — TOP-DOWN ORIENTATION LAYER. The primers are indexed as synthetic `PRIMER#<section>`
// documents (kind 'primer-orientation') that synthesize the answers to the six comprehension-
// journey archetypes a raw repo lacks: what-is-it / concepts / how-each-works / maturity /
// where-are-the-docs / how-to-use-end-to-end. When a query is one of those top-down orientation
// questions, bias toward the matching PRIMER section so the SYNTHESIZED answer wins over a deep
// ADR/source fragment. Deep ADR/source still wins for narrow how-X-works questions (no orient cue).
const PRIMER_PATH_RE = /^PRIMER#/;
// Generic orientation cue: the query is asking to be oriented to the product as a whole.
const ORIENT_QUERY_RE = new RegExp([
  'what\\s+(is|are|does)\\b',                       // "what is X" / "what does X do" / "what are the concepts"
  '\\bwhat\\s+can\\b',
  '\\bcore\\s+(capabilit|concept|feature)',          // "core capabilities/concepts"
  '\\bcapabilit(y|ies)\\b',
  '\\bhow\\s+(mature|complete)\\b',                  // maturity archetype
  '\\b(production|experimental)\\b',
  '\\bwhat\\s+works\\b',
  '\\bwhere\\s+(is|are)\\b.*\\b(doc|documentation|adr)', // docs/ADR-location archetype
  '\\bdocumentation\\b.*\\badr',
  '\\badr\\s+index\\b',
  '\\b(install|set\\s*up|setup|use)\\b.*\\bend[\\s-]*to[\\s-]*end\\b', // end-to-end usage
  '\\bend[\\s-]*to[\\s-]*end\\b',
  '\\bget(ting)?\\s+started\\b',
  '\\boverview\\b',
].join('|'), 'i');

// Archetype → words that, when present in BOTH the query and a PRIMER section's title/path, mean
// THIS section is the better-routed orientation answer (e.g. "where are the ADRs" -> the section
// titled "ADR index"). Used to nudge between competing PRIMER sections so the closest-titled one
// wins, without overriding the generic orientation lift. Each matched cue adds a small extra boost.
const PRIMER_ROUTE_CUES = [
  { q: /\b(adr|decision\s+record)/i,                        sec: /\badr\b|decision/i,                       w: 0.20 },
  { q: /\b(doc|documentation)/i,                            sec: /\bdoc|where everything lives|tutorial/i,  w: 0.10 },
  { q: /\b(mature|maturity|complete|production|experimental|works|graded|honest)/i, sec: /matur|gotcha|graded|honest|complete/i, w: 0.18 },
  { q: /\b(capabilit|concept|feature)/i,                    sec: /capabilit|concept|crate inventory|big/i,  w: 0.16 },
  { q: /\b(install|set\s*up|setup|quickstart|get\s*started|use|end[\s-]*to[\s-]*end|playbook)/i, sec: /executive summary|install|quickstart|playbook|knowledge base|use it/i, w: 0.14 },
  { q: /\b(crate|inventory)/i,                              sec: /crate inventory|inventory/i,              w: 0.16 },
];

// Returns a NON-NEGATIVE amount to SUBTRACT from a PRIMER document's effective distance when the
// query is an orientation question. The generic lift makes the synthesized layer beat a vector-
// closer deep doc; the route cues then nudge between PRIMER sections toward the best-titled one.
// Gentle enough that a clearly-better deep match still wins for narrow how-X-works questions.
function orientationBoost(query, path, title = '') {
  if (!PRIMER_PATH_RE.test(path)) return 0;
  const generic = ORIENT_QUERY_RE.test(query) ? 0.55 : 0.12;
  let route = 0;
  const hay = `${path} ${title}`;
  for (const c of PRIMER_ROUTE_CUES) {
    if (c.q.test(query) && c.sec.test(hay)) route += c.w;
  }
  return generic + route;
}

const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','for','on','with','how','do','i','is','are',
  'what','when','where','why','it','this','that','kb','query','question','search','find','show','me','please','about']);

// Tokenize a query into meaningful lexical terms (FIX 3 hybrid lexical).
function queryTerms(q) {
  return (q.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// FIX 3 — lexical boost: ADR-number exact hit, then proper-noun/title token overlap on
// the doc's path+title. Returns a NON-NEGATIVE amount to SUBTRACT from effective distance.
function lexicalBoost(query, terms, path, title) {
  let boost = 0;
  const hay = `${path} ${title}`.toLowerCase();

  // ADR id in query that the doc carries (e.g. "ADR-027" -> path adr/ADR-027-*.md)
  const adrIds = (query.match(/adr[-\s_]?(\d{1,4})/gi) || [])
    .map((m) => m.replace(/[^0-9]/g, '').padStart(3, '0'));
  for (const num of adrIds) {
    if (new RegExp(`adr[-_]?0*${num}\\b`, 'i').test(hay)) { boost += 0.30; break; }
  }

  // Title / path token overlap (proper-noun & multiword title tokens count strongest).
  let overlap = 0;
  for (const t of terms) {
    if (hay.includes(t)) overlap += 1;
  }
  if (overlap > 0) boost += Math.min(0.18, 0.06 * overlap);

  return boost;
}

// FIX 2 — demotion penalty for a path given the query (skipped if query references the kind).
function demotionPenalty(query, path) {
  let pen = 0;
  for (const ls of LOW_SIGNAL) {
    if (ls.re.test(path) && !ls.allow.test(query)) pen += ls.pen;
  }
  return pen;
}

// Substance boost — a self-contained answer-bearing document (multiple chunks / real length)
// should not be out-ranked by a vector-closer but tiny one-line doc-comment fragment. This
// keeps results SELF-CONTAINED (the grading bar) without re-embedding. Capped & gentle so it
// only breaks near-ties, never overrides a clearly-better match.
function substanceBoost(chunks) {
  if (!chunks || !chunks.length) return 0;
  const totalChars = chunks.reduce((s, c) => s + c.text.length, 0);
  let b = 0;
  if (chunks.length >= 2) b += 0.06;
  if (chunks.length >= 4) b += 0.06;
  if (totalChars >= 4000) b += 0.06;
  if (totalChars < 400) b -= 0.06;          // a sub-400-char stub is a fragment, demote it
  return Math.max(-0.06, Math.min(0.18, b));
}

// FIX 4 — Seed disambiguation adjustment (negative = boost, positive = penalty).
function seedAdjust(query, path) {
  if (!SEED_QUERY_RE.test(query)) return 0;
  let adj = 0;
  if (SEED_GOOD_RE.test(path)) adj -= 0.25;
  if (SEED_BAD_RE.test(path))  adj += 0.30;
  return adj;
}

// The KB builder emits OVERLAPPING chunks (a sliding window repeats ~half of each neighbour).
// Naively concatenating them duplicates paragraphs. stitch() drops the longest suffix of the
// running text that is also a prefix of the next chunk, so the document reads cleanly as one.
function stitch(prevTail, next) {
  const maxOv = Math.min(prevTail.length, next.length, 2000);
  for (let len = maxOv; len >= 24; len--) {
    if (prevTail.slice(prevTail.length - len) === next.slice(0, len)) {
      return next.slice(len); // drop the duplicated overlap
    }
  }
  return next;
}

// Assemble the FULL document from its chunks (id-ordered), de-overlapping as we go so it reads
// as one clean document. If the stitched text fits under MAX_DOC_CHARS, the whole document is
// returned. If it exceeds the cap, the window is CENTERED on the matched chunk (the chunk that
// actually scored the hit) and expanded outward — alternating following then preceding chunks —
// so the answer-bearing region is ALWAYS included, even when the match is a late chunk in a long
// document. (The old behavior counted from chunk 0 and could truncate the answer.) De-overlap
// stitching is preserved across the contiguous kept window.
function assembleDocument(chunks, matchedId) {
  const SEP = '\n\n';
  if (!chunks.length) return { fullText: '', chunksJoined: 0, truncated: false };

  // Locate the matched chunk; default to the first chunk if not found (back-compat).
  let center = 0;
  if (matchedId != null) {
    const idx = chunks.findIndex((c) => c.id === matchedId);
    if (idx >= 0) center = idx;
  }

  // Grow a contiguous [lo, hi] window outward from `center` while it fits under the cap.
  // Always include the matched chunk itself first, then expand following, then preceding.
  let lo = center, hi = center;
  let budget = chunks[center].text.length;
  let nextLo = center - 1, nextHi = center + 1;
  let toggle = 1; // 1 = try to extend forward first, then backward
  while (nextLo >= 0 || nextHi < chunks.length) {
    let extended = false;
    const tryHi = () => {
      if (nextHi < chunks.length) {
        const cost = SEP.length + chunks[nextHi].text.length;
        if (budget + cost <= MAX_DOC_CHARS) { budget += cost; hi = nextHi; nextHi++; return true; }
        nextHi = chunks.length; // stop growing forward once it no longer fits
      }
      return false;
    };
    const tryLo = () => {
      if (nextLo >= 0) {
        const cost = SEP.length + chunks[nextLo].text.length;
        if (budget + cost <= MAX_DOC_CHARS) { budget += cost; lo = nextLo; nextLo--; return true; }
        nextLo = -1; // stop growing backward once it no longer fits
      }
      return false;
    };
    if (toggle === 1) { extended = tryHi() || tryLo(); } else { extended = tryLo() || tryHi(); }
    toggle ^= 1;
    if (!extended) break;
  }

  // Stitch the kept contiguous window [lo..hi] into one clean document.
  let out = '';
  let joined = 0;
  for (let i = lo; i <= hi; i++) {
    const piece = out ? stitch(out.slice(-2000), chunks[i].text) : chunks[i].text;
    out = out ? out + (piece ? SEP + piece : '') : piece;
    joined++;
  }

  const omitted = chunks.length - joined;
  if (omitted > 0) {
    const before = lo, after = chunks.length - 1 - hi;
    const parts = [];
    if (before > 0) parts.push(`${before} earlier`);
    if (after > 0) parts.push(`${after} later`);
    const note = `${SEP}${SEP}[... ${parts.join(' + ')} chunk(s) omitted; window centered on the `
      + `matched section, capped at ${MAX_DOC_CHARS} chars ...]`;
    return { fullText: out + note, chunksJoined: joined, truncated: true };
  }
  return { fullText: out, chunksJoined: joined, truncated: false };
}

// ---------- core search: returns whole-document results ----------
// Each result: { path, title, fullText, bestDistance, effDistance, chunksJoined, truncated,
//                distance (alias of bestDistance), text (alias of fullText) }.
export async function searchKb({ query, k = 6, store, n }) {
  const conf = STORES[store];
  if (!conf) throw new Error(`unknown store '${store}' (use 'ruvector' or 'ruview')`);
  if (!fs.existsSync(conf.rvf)) throw new Error(`rvf not found: ${conf.rvf}`);
  const topN = Math.max(1, n || 5);
  const [qv, { byId, byPath }] = await Promise.all([embed(query), loadPassages(conf.passages)]);
  const terms = queryTerms(query);

  const db = await RvfDatabase.openReadonly(conf.rvf);
  let hits;
  try {
    // Fetch plenty of raw chunk hits so we have material to group into documents and rerank.
    hits = await db.query(qv, Math.max(RAW_HITS, k * 4));
  } finally {
    await db.close();
  }

  // FIX 1 — collapse chunk hits into documents keyed by path; doc score = best (min) distance.
  const docs = new Map(); // path -> { path, title, bestDistance, matchedId }
  for (const h of hits) {
    const rec = byId.get(String(h.id));
    if (!rec) continue;
    const cur = docs.get(rec.path);
    if (!cur || h.distance < cur.bestDistance) {
      docs.set(rec.path, { path: rec.path, title: rec.title, bestDistance: h.distance, matchedId: rec.id });
    }
  }

  // FIXes 2/3/4 — compute effective distance per document.
  const ranked = [...docs.values()].map((d) => {
    const pen = demotionPenalty(query, d.path);
    const boost = lexicalBoost(query, terms, d.path, d.title);
    const seed = seedAdjust(query, d.path);
    const sub = substanceBoost(byPath.get(d.path));
    const orient = orientationBoost(query, d.path, d.title);  // FIX 5 — top-down orientation layer
    const effDistance = d.bestDistance + pen - boost + seed - sub - orient;
    return { ...d, effDistance };
  }).sort((a, b) => a.effDistance - b.effDistance);

  // FIX 1 — assemble the FULL document for the top-N distinct documents.
  return ranked.slice(0, topN).map((d) => {
    const chunks = byPath.get(d.path) || [];
    const { fullText, chunksJoined, truncated } = chunks.length
      ? assembleDocument(chunks, d.matchedId)
      : { fullText: '(NO PASSAGE TEXT — path not found in sidecar)', chunksJoined: 0, truncated: false };
    return {
      path: d.path,
      title: d.title,
      fullText,
      bestDistance: d.bestDistance,
      effDistance: d.effDistance,
      chunksJoined,
      truncated,
      // back-compat aliases for callers that still read .text / .distance
      text: fullText,
      distance: d.bestDistance,
    };
  });
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
  console.log(`\n=== ${store} KB — "${query}" — top ${results.length} documents ===\n`);
  results.forEach((r, i) => {
    console.log(`#${i + 1}  distance=${r.bestDistance.toFixed(4)} (eff=${r.effDistance.toFixed(4)})`);
    console.log(`path : ${r.path}`);
    console.log(`title: ${r.title}`);
    console.log(`chars: ${r.fullText.length} | chunks: ${r.chunksJoined}${r.truncated ? ' (truncated)' : ''}`);
    console.log('----- full document -----');
    console.log(r.fullText);
    console.log('===================================================================\n');
  });
}

// Run as CLI when invoked directly (compare decoded real paths; handles spaces in path).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
}
