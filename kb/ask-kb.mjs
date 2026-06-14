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
    // Metadata sidecar carries the per-chunk `kind` field (source/adr/doc/primer-orientation/…)
    // that the passages sidecar lacks. Used by the intent layer (code-vs-doc, PRIMER routing).
    meta: path.join(KB_DIR, 'ruvector-kb.ids.json'),
  },
  ruview: {
    rvf: path.join(KB_DIR, 'ruview-kb.rvf'),
    passages: path.join(KB_DIR, 'ruview-kb.passages.jsonl'),
    meta: path.join(KB_DIR, 'ruview-kb.meta.json'),
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

// ---------- kind metadata sidecar loader ----------
// The passages sidecar (.passages.jsonl) carries only {id,text,path,title}. The per-chunk
// `kind` (source / crate-src / adr / doc / doc-deep / primer-orientation / …) lives in the
// build metadata sidecar (.ids.json / .meta.json) keyed by the SAME numeric id. The intent
// layer (code-vs-doc routing, ADR-vs-code pairing, PRIMER detection) needs `kind`, so we load
// it once and fold it down to a per-PATH kind. If the sidecar is missing the layer degrades
// gracefully (kind unknown -> no kind-based adjustments; vector+rerank still works).
function loadKinds(file) {
  const byPathKind = new Map(); // path -> representative kind (the doc's dominant content kind)
  try {
    if (!file || !fs.existsSync(file)) return byPathKind;
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    const entries = j.entries || {};
    const counts = new Map(); // path -> Map(kind -> n)
    for (const v of Object.values(entries)) {
      if (!v || !v.path || !v.kind) continue;
      if (!counts.has(v.path)) counts.set(v.path, new Map());
      const m = counts.get(v.path);
      m.set(v.kind, (m.get(v.kind) || 0) + 1);
    }
    for (const [p, m] of counts) {
      let best = null, bestN = -1;
      for (const [kind, n] of m) { if (n > bestN) { best = kind; bestN = n; } }
      byPathKind.set(p, best);
    }
  } catch { /* sidecar unreadable -> empty map, graceful degrade */ }
  return byPathKind;
}

// A path is "source code" if its dominant kind is a code kind.
const SOURCE_KINDS = new Set(['source', 'crate-src', 'example']);
function isSourceKind(kind) { return SOURCE_KINDS.has(kind); }

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
function orientationBoost(query, path, title = '', suppressGeneric = false) {
  if (!PRIMER_PATH_RE.test(path)) return 0;
  // For a concept what-is query the generic orientation lift is suppressed: we do NOT want every
  // PRIMER (especially the thin product blurb) lifted over the real defining doc. Only the targeted
  // route cues (if any) apply. (FIX 1)
  const generic = suppressGeneric ? 0 : (ORIENT_QUERY_RE.test(query) ? 0.55 : 0.12);
  let route = 0;
  const hay = `${path} ${title}`;
  for (const c of PRIMER_ROUTE_CUES) {
    if (c.q.test(query) && c.sec.test(hay)) route += c.w;
  }
  return generic + route;
}

// ===================================================================================
// INTENT ROUTING LAYER (the second structural fix). MiniLM collapses every top-down
// "orientation" query onto the generic "what X is" PRIMER section, and implementation
// queries don't reliably surface code. This adds DETERMINISTIC intent classification on
// top of the vector+rerank pipeline: it (a) detects an orientation archetype and force-routes
// to the matching PRIMER#<slug> for that store, (b) hard-routes an exact "ADR-NNN" query to
// the real ADR document (beating the index table), (c) tilts ranking toward code or toward
// design docs by intent, and (d) guarantees an ADR proposal is paired with its built source.
// All of this is layered as effective-distance adjustments / hard rank overrides — no rebuild.
// ===================================================================================

// Per-store map of orientation archetype -> the EXACT PRIMER# slug that answers it. Slugs were
// discovered from the live sidecars (grep 'PRIMER#…' on the ids/meta files); only real slugs are
// listed. `adr` is the docs-location archetype's ADR-specific sub-target (the ADR index table).
const PRIMER_SLUGS = {
  ruvector: {
    maturity:     'PRIMER#8-maturity-gotchas',
    capabilities: 'PRIMER#2-the-big-capabilities-and-how-to-actually-call-them',
    docs:         'PRIMER#5-docs-tutorials-examples-skills',
    adr:          'PRIMER#4-adr-index-the-complete-table-208-main-series-files-in-docs-adr-54-in-4-sub-ser',
    playbook:     'PRIMER#0-executive-summary-which-crate-do-i-need',
    whatis:       'PRIMER#1-what-ruvector-is',
    crates:       'PRIMER#3-complete-crate-inventory',
    hardware:     null,                       // ruvector has no hardware matrix -> fall through to vector
    glossary:     null,                       // ruvector has no glossary section
  },
  ruview: {
    maturity:     'PRIMER#7-capabilities-graded-honestly',
    capabilities: 'PRIMER#7-capabilities-graded-honestly',
    docs:         'PRIMER#9-docs-tutorials-scripts-firmware-where-everything-lives',
    adr:          'PRIMER#8-the-complete-adr-index-160-adr-numbered-files-156-unique-numbers',
    playbook:     'PRIMER#0-1-instant-playbooks-task-exact-steps',
    whatis:       'PRIMER#1-what-ruview-is',
    crates:       'PRIMER#3-the-crates-v2-workspace-39-incl-the-ruv-neural-git-submodule-and-homecore-plug',
    hardware:     'PRIMER#10-hardware-matrix',
    glossary:     'PRIMER#0-3-glossary-so-terms-are-never-guessed',
  },
};

// The store's PRODUCT NAME(s). A what-is/concept query that names ONLY the product (no other
// concrete concept noun) is about the product itself -> force-route to the "what X is" PRIMER#1.
// A what-is/concept query that names a CONCRETE concept noun (RVF, witness, HNSW, GNN, segment,
// presence, occupancy, …) is NOT a product overview -> let vector+rerank find the DEFINING doc.
const PRODUCT_NAMES = {
  ruvector: /\bru[\s-]?vector\b/i,
  ruview:   /\bru[\s-]?view\b/i,
};

// Archetype detectors, ORDERED most-specific-first (first match wins). Each regex tests the raw
// query. Patterns mirror the spec's intent buckets. `adr` is folded into `docs` but additionally
// flips the docs target to the ADR-index slug when the query is specifically about ADRs.
const ARCHETYPE_RES = [
  // maturity / production-readiness / "how good/solid/reliable" / works-today-vs-experiment
  { name: 'maturity', re: /\b(mature|maturity|production[- ]?ready|production\b|how (good|solid|reliable|complete)|how complete|is it (ready|done|complete)|works?\b.*\b(experiment|stub|today|yet)|ready for production|battle[- ]?tested|graded honestly)\b/i },
  // capabilities / features / "what can it do"
  { name: 'capabilities', re: /\b(capabilit(y|ies)|what can it do|what can ruv\w+ do|features?\b|what does it (do|offer)|what does ruv\w+ (do|offer)|big (capabilities|features))\b/i },
  // docs / tutorials / examples / ADRs / "where do I find …"
  { name: 'docs', re: /\b(where (are|is|can i find|do i find).*(doc|documentation|tutorial|example|adr|guide|find|live)|documentation\b|tutorials?\b|list of adrs?|adr index|where everything lives|where.*\b(docs?|guides?)\b)\b/i },
  // hardware / boards / devices — enumeration of supported physical hardware
  { name: 'hardware', re: /\b(hardware|boards?|devices?|which (chip|board|sensor)|supported (hardware|board|device))\b/i },
  // crate inventory — enumeration of the crates that make up the workspace / a domain
  { name: 'crates', re: /\b(which crates|crate inventory|what crates|crates (that |which )?(make up|in|for|comprise)|list of crates|\w+ domain crates)\b/i },
  // playbook / setup / onboarding / end-to-end usage
  { name: 'playbook', re: /\b(how (do i |to )?(use|set ?up|onboard|get started|getting started|start|deploy|build|run)|end[- ]to[- ]end|end to end|quick ?start|playbook|walkthrough|step[- ]by[- ]step|get up and running)\b/i },
  // what-is / overview / introduce
  { name: 'whatis', re: /\b(what is|what'?s |overview of|introduce|introduction to|tell me about|difference between|role of)\b/i },
];

// Strong playbook verbs — when present, the playbook force-route fires EVEN for a long query
// (the word-count cap is bypassed). These signal an end-to-end "do this from scratch" walkthrough.
const STRONG_PLAYBOOK_RE = /\b(set ?up|end[- ]to[- ]end|get started|getting started|from scratch|walk ?through|unbox|first time|step by step)\b/i;

// A query is "clearly orientation" only when it is short & conceptual: no concrete symbol, file
// path, ADR number, code-y token, or function/struct reference. This keeps the force-route from
// firing on a deep how-X-works-in-the-code question that happens to contain "how to".
const SPECIFIC_SIGNAL_RE = /(\badr[-\s_]?\d|[a-z_]+\.[a-z]{1,4}\b|\bfn\b|\bstruct\b|\bimpl\b|::|\/|\b[a-z_]+\(\)|\bcrate::|\bsrc\b)/i;
function isOrientationQuery(query) {
  // A strong playbook verb (set up / end-to-end / from scratch / walkthrough …) marks an
  // end-to-end "do this from scratch" request. These run long ("set up a single sensor node end to
  // end and see data in home assistant" = 16 words) yet should still force-route to the playbook
  // PRIMER, so bypass the word-count cap when one is present (FIX 3).
  if (!STRONG_PLAYBOOK_RE.test(query)) {
    const words = (query.trim().match(/\S+/g) || []).length;
    if (words > 14) return false;               // long queries are usually specific
  }
  if (SPECIFIC_SIGNAL_RE.test(query)) return false;
  return true;
}

// Is a what-is/concept query about the PRODUCT ITSELF (force PRIMER#1) vs about a CONCRETE concept
// noun (let vector+rerank find the defining doc)? Product-only: names the store product (ruvector/
// ruview) and contains NO other concrete concept noun, OR is literally "what is this / it". A query
// carrying any concept noun OTHER than the product name (rvf, witness, hnsw, gnn, segment, presence,
// occupancy, quantization, …) is a concept query, not a product overview. (FIX 1)
function isProductOverviewQuery(query, store) {
  const prod = PRODUCT_NAMES[store];
  // strip the product name, then see whether any meaningful concept term remains.
  const stripped = prod ? query.replace(prod, ' ') : query;
  const rest = queryTerms(stripped).filter((t) => t !== store && t !== 'product' && t !== 'overview');
  if (prod && prod.test(query) && rest.length === 0) return true;   // "what is ruvector"
  if (/\bwhat'?s?\s+(is\s+)?(this|it)\b/i.test(query) && rest.length === 0) return true; // "what is this"
  return false;
}

// Classify the orientation archetype (most-specific-first). Returns archetype name or null.
// `store` lets the what-is split distinguish a product-overview query from a concept query.
function classifyArchetype(query, store) {
  if (!isOrientationQuery(query)) return null;
  for (const a of ARCHETYPE_RES) {
    if (a.re.test(query)) {
      // The docs archetype splits: if the query is specifically about ADRs, target the ADR index.
      if (a.name === 'docs' && /\b(adr|decision record)\b/i.test(query)) return 'adr';
      // The what-is archetype splits: product-overview -> PRIMER#1; concept query -> no force-route
      // (let vector+rerank find the DEFINING doc; a mild concept boost is applied downstream).
      if (a.name === 'whatis' && !isProductOverviewQuery(query, store)) return 'whatis-concept';
      return a.name;
    }
  }
  return null;
}

// Code-vs-doc intent. Returns 'code' | 'design' | null.
const CODE_INTENT_RE = /\b(in (the )?code|in source|implementation|how is .*(computed|implemented|calculated|done)|\bfunction\b|\bstruct\b|signature|source code|actual code|which file|in the source|the (rust|code))\b/i;
const DESIGN_INTENT_RE = /\b(why\b|rationale|design decision|design choice|proposed\b|proposal\b|trade[- ]?off|tradeoff|motivation|reasoning behind|the decision to)\b/i;
function codeDocIntent(query) {
  // Code intent takes priority when both fire (explicit "in the code" beats a stray "why").
  if (CODE_INTENT_RE.test(query)) return 'code';
  if (DESIGN_INTENT_RE.test(query)) return 'design';
  return null;
}

// Exact ADR-by-number, e.g. "ADR-027" / "adr 27" -> zero-padded "027". Returns [nums] or [].
function adrNumbers(query) {
  return (query.match(/\badr[-\s_]?(\d{1,4})\b/gi) || [])
    .map((m) => m.replace(/[^0-9]/g, '').padStart(3, '0'));
}
// Does a path point at the REAL ADR doc for this number (not the index table / a passing mention)?
function pathIsAdrDoc(p, num) {
  return new RegExp(`(^|/)adr[-_]?0*${num}\\b`, 'i').test(p) || new RegExp(`adr[-_]?0*${num}[-_]`, 'i').test(p);
}

// Does this document carry an ADR "Status:" header (## Status / **Status**: …)? Such a header
// marks a proposal/decision (intent) — the trigger for INTENT(4) ADR-vs-code pairing. We scan the
// doc's first chunk(s) where the header lives.
function adrHasStatus(chunks) {
  if (!chunks || !chunks.length) return false;
  const head = chunks.slice(0, 2).map((c) => c.text).join('\n');
  return /(^|\n)\s*(#+\s*status\b|\*\*status\*\*\s*:|status\s*:)/i.test(head);
}

const STOPWORDS = new Set(['the','a','an','and','or','of','to','in','for','on','with','how','do','i','is','are',
  'what','when','where','why','it','this','that','kb','query','question','search','find','show','me','please','about']);

// Tokenize a query into meaningful lexical terms (FIX 3 hybrid lexical).
function queryTerms(q) {
  return (q.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) || [])
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Concept nouns from a concept what-is query (FIX 1). The query's meaningful terms MINUS the
// product name MINUS generic question words = the concrete concept(s) being asked about (rvf,
// witness, hnsw, gnn, segment, presence, occupancy, …). A doc whose title/path token-overlaps one
// of these is more likely to DEFINE it, so it gets a mild boost (below) — letting the real defining
// ADR/source/doc out-rank the thin product blurb without a hard force-route.
const CONCEPT_STOP = new Set(['what','difference','between','role','format','file','files','does',
  'store','stores','support','supported','index','indices','chain','segment','detection','counting',
  'augmented','work','works']);
function conceptNouns(query, store) {
  const prod = PRODUCT_NAMES[store];
  const stripped = prod ? query.replace(prod, ' ') : query;
  return queryTerms(stripped).filter((t) => t !== store && !CONCEPT_STOP.has(t));
}

// Mild concept boost: SUBTRACT a small amount from a doc whose path/title token-overlaps a concept
// noun from a concept what-is query. Gentle (capped) so a clearly-better defining doc wins on its
// own merit; this only breaks near-ties toward the on-topic doc. PRIMER#1 (the thin product blurb)
// is excluded so it never benefits from the concept boost. Returns NON-NEGATIVE amount to subtract.
function conceptBoost(nouns, path, title) {
  if (!nouns || !nouns.length) return 0;
  if (PRIMER_PATH_RE.test(path) && /what\b.*\bis\b|#1-/i.test(`${path} ${title}`)) return 0;
  const hay = `${path} ${title}`.toLowerCase();
  let overlap = 0;
  for (const t of nouns) if (hay.includes(t)) overlap += 1;
  if (overlap === 0) return 0;
  // Glossary section (ruview) is a legitimate concept target: give it the boost too, but a real
  // defining doc with the same overlap will tie and the vector distance breaks it (glossary is
  // synthesized & short, so a true defining doc usually has the closer distance).
  return Math.min(0.16, 0.08 * overlap);
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
  const byPathKind = loadKinds(conf.meta);          // intent layer: per-path content kind
  const terms = queryTerms(query);

  // ---- INTENT CLASSIFICATION (deterministic, computed once per query) ----
  const archetype = classifyArchetype(query, store);          // 'maturity'|'capabilities'|…|'whatis-concept'|null
  // 'whatis-concept' is a NON-routing archetype: no force-route to a PRIMER, instead a mild concept
  // boost (below) lets the vector+rerank pipeline surface the true DEFINING doc. Other archetypes
  // force-route to their PRIMER slug (null slug -> no force-route, e.g. ruvector hardware).
  const targetPrimerSlug = (archetype && archetype !== 'whatis-concept')
    ? (PRIMER_SLUGS[store] || {})[archetype]
    : null;
  // Concept nouns drive the mild concept boost for concept what-is queries (FIX 1).
  const concepts = archetype === 'whatis-concept' ? conceptNouns(query, store) : [];
  // For ruview, a concept query may also softly boost the glossary section (a real defining doc
  // still wins when present, because the glossary is short/synthesized with a worse distance).
  const glossarySlug = archetype === 'whatis-concept' ? (PRIMER_SLUGS[store] || {}).glossary : null;
  const adrNums = adrNumbers(query);
  const intent = codeDocIntent(query);                        // 'code' | 'design' | null

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

  // INTENT: ensure force-routed targets are IN the candidate pool even if MiniLM ranked them out
  // of the raw window. (a) the target PRIMER slug for an orientation archetype; (b) the real ADR
  // document for an exact ADR-NNN query. We synthesize a doc entry from byPath so it can be ranked
  // and then hard-boosted below. Without this, a force-route could point at a doc not in `docs`.
  const ensureDoc = (p) => {
    if (!p || docs.has(p)) return;
    const chunks = byPath.get(p);
    if (!chunks || !chunks.length) return;
    docs.set(p, { path: p, title: chunks[0].title, bestDistance: 1.0, matchedId: chunks[0].id });
  };
  if (targetPrimerSlug) ensureDoc(targetPrimerSlug);
  if (glossarySlug) ensureDoc(glossarySlug);   // concept query: glossary may softly win for ruview
  // For an exact ADR query, find the real ADR doc path(s) by scanning the passages index.
  const adrDocPaths = [];
  if (adrNums.length) {
    for (const num of adrNums) {
      for (const p of byPath.keys()) {
        if (pathIsAdrDoc(p, num) && !PRIMER_PATH_RE.test(p)) { adrDocPaths.push(p); ensureDoc(p); }
      }
    }
  }

  // FIXes 2/3/4 + INTENT — compute effective distance per document.
  // Hard routes use a large negative adjustment so the routed doc wins decisively; intent tilts
  // are gentle (break ties / nudge) so they don't override a clearly-better vector match.
  const HARD_WIN = 5.0;     // dominates any plausible distance + penalty (force #1)
  const ranked = [...docs.values()].map((d) => {
    const pen = demotionPenalty(query, d.path);
    const boost = lexicalBoost(query, terms, d.path, d.title);
    const seed = seedAdjust(query, d.path);
    const sub = substanceBoost(byPath.get(d.path));
    const orient = orientationBoost(query, d.path, d.title, archetype === 'whatis-concept');  // FIX 5 — top-down orientation layer
    // FIX 1 — concept boost: nudge docs that name the concept; extra nudge for the glossary section.
    let concept = conceptBoost(concepts, d.path, d.title);
    if (glossarySlug && d.path === glossarySlug && concepts.length) concept += 0.06;
    let intentAdj = 0;

    // INTENT (1) — orientation archetype force-route to the matching PRIMER slug.
    if (targetPrimerSlug && d.path === targetPrimerSlug) intentAdj += HARD_WIN;

    // INTENT (2) — exact ADR-by-number hard route to the real ADR doc (must beat the index table).
    if (adrDocPaths.includes(d.path)) intentAdj += HARD_WIN;

    // INTENT (3) — code-vs-doc tilt. Use the doc's content kind from the metadata sidecar.
    if (intent) {
      const kind = byPathKind.get(d.path);
      if (intent === 'code'   && isSourceKind(kind)) intentAdj += 0.30;   // prefer real code body
      if (intent === 'design' && kind === 'adr')     intentAdj += 0.22;   // prefer the ADR/doc
    }

    const effDistance = d.bestDistance + pen - boost + seed - sub - orient - concept - intentAdj;
    return { ...d, effDistance, kind: byPathKind.get(d.path) || null };
  }).sort((a, b) => a.effDistance - b.effDistance);

  // INTENT (4) — ADR-vs-code pairing for completeness. If #1 is an ADR carrying a Status: header
  // (a proposal/decision = intent, not built reality) and NO source doc is in the top-N, pull the
  // best-matching source doc into the returned set so the reader sees proposal vs built code. We
  // only ADD a result (and tag it); we never displace the routed #1 or break whole-doc return.
  let pairedSource = null;
  if (ranked.length) {
    const top = ranked[0];
    const topKind = top.kind || byPathKind.get(top.path);
    if (topKind === 'adr' && adrHasStatus(byPath.get(top.path))) {
      const inTop = ranked.slice(0, topN).some((d) => isSourceKind(d.kind));
      if (!inTop) {
        pairedSource = ranked.find((d) => isSourceKind(d.kind)) || null;
      }
    }
  }

  // FIX 1 — assemble the FULL document for the top-N distinct documents.
  const assemble = (d, label) => {
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
      kind: d.kind || byPathKind.get(d.path) || null,
      label: label || null,            // intent label (e.g. 'paired-source') for callers/UI
      chunksJoined,
      truncated,
      // back-compat aliases for callers that still read .text / .distance
      text: fullText,
      distance: d.bestDistance,
    };
  };

  const out = ranked.slice(0, topN).map((d) => assemble(d));

  // INTENT (4) — append the paired implementing source so proposal-vs-built-reality is visible.
  // Appended (not inserted) so the routed/ranked order — including the whole-doc #1 ADR — is intact.
  if (pairedSource && !out.some((r) => r.path === pairedSource.path)) {
    out.push(assemble(pairedSource, 'paired-source (implements the ADR above)'));
  }

  return out;
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
    console.log(`#${i + 1}  distance=${r.bestDistance.toFixed(4)} (eff=${r.effDistance.toFixed(4)})`
      + `${r.kind ? `  kind=${r.kind}` : ''}${r.label ? `  [${r.label}]` : ''}`);
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
