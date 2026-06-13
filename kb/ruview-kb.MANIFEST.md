Updated: 2026-06-13 19:00:00 EDT | Version 2.1.0
Created: 2026-06-12 15:30:00 EDT

# ruview-kb.rvf — RuView Repository Knowledge Base (RVF)

Semantic index of the ENTIRE RuView repository — mechanical enumeration, no curation —
so AI assistants can query everything instead of trusting summaries.

**v2 (this file): enriched with crate source knowledge + exhaustive markdown sweep.**
The ADRs are the plan; the Rust crates are the actual solution — v2 indexes both. The v1
store is preserved alongside as `ruview-kb.v1.rvf` (+ `.v1` sidecars).

## Provenance

| Field | Value |
|---|---|
| Generated | 2026-06-12 (v2 ~17:25 EDT; v1 15:23 EDT) |
| Source | `RuView/` checkout of github.com/ruvnet/RuView |
| Source commit | `3d7530f08dbf5043d2aebc716f029fc4794caa97` (tag `v1701`) |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (local quantized ONNX via `@xenova/transformers` — no cloud APIs) |
| Dimensions / metric | 384 / cosine, normalized (HNSW defaults) |
| RVF tooling | `@ruvector/rvf` 0.2.2 (`RvfDatabase`, NodeBackend `@ruvector/rvf-node`) |
| Total vectors | **4,306** (final enriched build, 0 rejected; an earlier draft was 4,184 — this store supersedes it) |
| Distinct source files | **1,613** |
| File size | `ruview-kb.rvf` 7,386,428 bytes (+ `ruview-kb.rvf.idmap.json`, auto-created by rvf-node) |
| Metadata sidecar | `ruview-kb.meta.json` — id → {path, kind, title, chunk, preview}. Needed because `query()` returns only `{id, distance}`. Vectors live ONLY in the .rvf. |
| Full-text sidecar | `ruview-kb.passages.jsonl` — one `{id,text,path,title}` per line; retrieval joins `query()` ids to the FULL passage text here |

## Corpus (mechanical enumeration)

Chunking: ~4,000 chars (~1,000 tokens) with 400-char overlap, preferring paragraph
boundaries. Per-vector RVF metadata: `{path, kind, title, chunk}`.

| Kind | Source entries | Chunks/vectors | What was ingested |
|---|---|---|---|
| adr | 165 | 1,037 | unchanged from v1: full text of `docs/adr/**` + ADR-named docs elsewhere |
| doc | 194 | 1,091 | unchanged from v1: all remaining `docs/**` .md/.txt + README.md (full) + CHANGELOG.md (top 500) + 4 `ui/*.html` title+meta |
| tutorial | 2 | 16 | unchanged from v1: `docs/tutorials/*` full text |
| crate | 39 | 82 | unchanged from v1: per `v2/crates/*` dir — Cargo.toml description + lib.rs first 60 lines + README |
| firmware | 41 | 41 | unchanged from v1: first 60 lines of all `firmware/esp32-csi-node/**/*.h` + provision.py header |
| script | 106 | 106 | **upgraded**: first 40 lines (was 20) of EVERY file under `scripts/` recursively incl. `tests/` + `swarm_presets/` (was 86 top-level files) |
| **crate-src** (new) | 723 | 744 | per crate (every Cargo.toml with src/, 40 crates incl. v2 workspace + python + nvsim + patches): lib.rs/main.rs leading `//!` doc + first 100 lines (40) + module list w/ examples/benches/tests names (40); PLUS repo-wide sweep — leading `//!` doc block (first 30 lines) of every other .rs file (643 of 712) |
| **doc-deep** (new) | 343 | 1,062 | EVERY `*.md` in the repo not already in the corpus (341 files full text: `.claude/` agents+commands+skills 217, `plugins/ruview/` 32, `archive/` v1 docs 26, `examples/` 17, `plans/` 10, `aether-arena/` 5, ui/python/references/benchmarks/tools/firmware/CLAUDE.md/PROOF.md...) + 2 plugin manifests (`.claude-plugin/marketplace.json`, `plugins/ruview/.claude-plugin/plugin.json`) |
| **ui** (new) | 4 | 5 | full visible text content of `ui/*.html` (index, observatory, pose-fusion, viz) |
| **Total** | **1,617 entries / 1,613 distinct paths** | **4,306** | (final build; per-kind chunk counts: adr 1,037, doc 1,091, tutorial 22, crate 87, firmware 41, script 106, example 20, npm 6, crate-src 855, doc-deep 1,036, ui 5) |

### Count reconciliation (v1 → v2)

v1 kinds reproduce EXACTLY (adr 1,037; doc 1,091; tutorial 16; crate 82; firmware 41) —
only `script` intentionally changed (86 → 106 chunks, 40-line recursive). New kinds add
crate-src + doc-deep + ui. Chunks assembled = vectors in store = **4,306** ✓ (final enriched
build; an earlier draft totalled 4,184 and is superseded by this store — trust 4,306)
(0 rejected).

## Verification queries (top hits, cosine distance, run at build time)

Source-level queries now resolve to the actual Rust implementations:

1. **"how does the breathing extractor bandpass work"** → `v2/crates/wifi-densepose-wifiscan/src/pipeline/breathing_extractor.rs` (0.449, crate-src); ADR-021 vital-sign pipeline (0.565); `wifi-densepose-mat/src/detection/breathing.rs` (0.603)
2. **"pose tracker kalman implementation"** → `wifi-densepose-signal/src/ruvsense/pose_tracker.rs` (0.381); `wifi-densepose-mat/src/tracking/kalman.rs` (0.403); ADR-026 survivor track lifecycle (0.435)
3. **"how do I calibrate an empty room"** → ADR-135 (0.549); `scripts/calibrate-camera-room.py` (0.568); `scripts/tests/test_calibration.py` (0.590, new); `aether-arena/calibration/README.md` (0.624, doc-deep)
4. **"MQTT privacy modes"** → ADR-115 (0.416); `wifi-densepose-sensing-server/src/mqtt/privacy.rs` (0.446, crate-src); `mqtt/config.rs` (0.453); `mqtt/mod.rs` (0.466)
5. **"what does the ruview plugin install"** → `.claude-plugin/marketplace.json` (0.344); `plugins/ruview/README.md` (0.420); `plugins/ruview/.claude-plugin/plugin.json` (0.438) — all doc-deep, invisible to v1
6. **"C6 time sync accuracy"** → `docs/WITNESS-LOG-110.md` (0.522); `firmware/esp32-csi-node/main/c6_timesync.h` (0.581); ADR-110 (0.584)

## Rebuild

```bash
cd "/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer"
node kb/build-ruview-kb.mjs   # backs up current store as *.v1.* once, rewrites ruview-kb.rvf + ruview-kb.meta.json, prints counts + verification queries
```

## Query example

```js
const { RvfDatabase } = require('/Users/stuartkerr/.npm-global/lib/node_modules/@ruvector/rvf');
const { pipeline } = require('/Users/stuartkerr/.npm-global/lib/node_modules/agentic-flow/node_modules/@xenova/transformers');
const meta = JSON.parse(require('fs').readFileSync('kb/ruview-kb.meta.json', 'utf8')).entries;
const db = await RvfDatabase.openReadonly('kb/ruview-kb.rvf');
const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const q = await fe(['your question'], { pooling: 'mean', normalize: true });
const hits = await db.query(Float32Array.from(q.data), 5);
hits.forEach(h => console.log(h.distance, meta[h.id].path, meta[h.id].title));
```

## Known notes

- crate-src indexes leading doc comments + first 100 lines + module inventories — not
  every line of every .rs body. 69 .rs files have no leading `//!` block and no entry
  beyond their crate's module list.
- `ui/` JS (app.js, services/, components/) is outside the corpus except where listed in
  module inventories; the 4 HTML pages are indexed full-text (kind `ui`).
- v1 store preserved as `ruview-kb.v1.rvf` + `ruview-kb.meta.v1.json` + `ruview-kb.v1.rvf.idmap.json`.
