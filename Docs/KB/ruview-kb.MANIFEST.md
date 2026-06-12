Updated: 2026-06-12 15:30:00 EDT | Version 1.0.0
Created: 2026-06-12 15:30:00 EDT

# ruview-kb.rvf — RuView Repository Knowledge Base (RVF)

Semantic index of the ENTIRE RuView repository documentation surface — mechanical
enumeration, no curation — so AI assistants can query everything instead of trusting
summaries.

## Provenance

| Field | Value |
|---|---|
| Generated | 2026-06-12 (15:23 EDT) |
| Source | `RuView/` checkout of github.com/ruvnet/RuView |
| Source commit | `3d7530f08dbf5043d2aebc716f029fc4794caa97` (tag `v1701`) |
| Embedding model | `Xenova/all-MiniLM-L6-v2` (local ONNX via `@xenova/transformers` 2.17.2 — no cloud APIs) |
| Dimensions / metric | 384 / cosine, normalized (HNSW, M=16, efConstruction=200 defaults) |
| RVF tooling | `@ruvector/rvf` 0.2.2 (`RvfDatabase`, NodeBackend `@ruvector/rvf-node`) |
| Total vectors | **2,353** (verified: `status().totalVectors === chunks assembled`) |
| Distinct source files | **527** |
| File size | `ruview-kb.rvf` 3,868,320 bytes (+ `ruview-kb.rvf.idmap.json` 56,796 B, auto-created by rvf-node) |
| Metadata sidecar | `ruview-kb.meta.json` 1,035,424 bytes — id → {path, kind, title, chunk, preview}. Needed because `query()` returns only `{id, distance}`. Vectors live ONLY in the .rvf. |

## Corpus (mechanical enumeration)

Chunking: ~4,000 chars (~1,000 tokens) with 400-char overlap, preferring paragraph
boundaries. Per-vector RVF metadata: `{path, kind, title, chunk}`.

| Kind | Source files | Chunks/vectors | What was ingested |
|---|---|---|---|
| adr | 165 | 1,037 | full text: 162 files in `docs/adr/` (incl. `.issue-177-body.md`) + 3 ADR-named docs elsewhere (`docs/ADR-110-BRANCH-STATE.md`, `docs/ADR-110-REVIEW-GUIDE.md`, `docs/research/ADR-116-ha-matter-cog-research.md`) |
| doc | 194 | 1,091 | full text of all remaining `docs/**` .md/.txt (benchmarks, ddd, qe-reports, witness logs, integrations, research, …) + `README.md` (full) + `CHANGELOG.md` (top 500 lines) + 4 `ui/*.html` (title+meta) |
| tutorial | 2 | 16 | full text of `docs/tutorials/*` |
| crate | 39 | 82 | per `v2/crates/*` dir: Cargo.toml `description` + `src/lib.rs` first 60 lines + README (full) |
| firmware | 41 | 41 | first 60 lines of all 40 `firmware/esp32-csi-node/**/*.h` + `provision.py` docstring header |
| script | 86 | 86 | first 20 lines of every file in `scripts/` |
| **Total** | **527** | **2,353** | |

### Count reconciliation (pre vs post ingest)

Pre-ingest source counts: docs md+txt = 355; docs/adr entries = 162 md (161 visible +
1 hidden); scripts files = 86; v2/crates dirs = 39 (the 40th `v2/crates` entry is a
README.md file; `ruv-neural/` has no Cargo.toml but was still ingested); firmware .h = 40;
ui html = 4.

Post-ingest: 355 docs files + README + CHANGELOG + 4 ui = 361 doc-tree sources;
361 + 39 + 41 + 86 = **527 distinct paths in KB** ✓. Chunks assembled 2,353 =
vectors in store 2,353 ✓ (0 rejected).

Note: the task brief said "163 ADRs"; the actual tree at v1701 contains 162 files in
`docs/adr/` — the mechanical count wins.

## Verification queries (top hits, cosine distance, run at build time)

1. **"how do I calibrate an empty room"** → `scripts/calibrate-camera-room.py` (0.509); `docs/adr/ADR-135-empty-room-baseline-calibration.md` (0.549); `scripts/calibration_lib.py` (0.593)
2. **"what is the seed ingest packet format"** → `docs/adr/ADR-069-cognitum-seed-csi-pipeline.md` (0.555); `scripts/seed_csi_bridge.py` (0.610); `docs/adr/ADR-135-empty-room-baseline-calibration.md` (0.611)
3. **"C6 time sync accuracy"** → `docs/WITNESS-LOG-110.md` (0.522); `docs/edge-modules/exotic.md` (0.579); `firmware/esp32-csi-node/main/c6_timesync.h` (0.581); `docs/adr/ADR-110-esp32-c6-firmware-extension.md` (0.584)
4. **"camera supervised pose training steps"** → `docs/adr/ADR-072-wiflow-architecture.md` (0.499); `docs/adr/ADR-079-camera-ground-truth-training.md` (0.520); `scripts/train-wiflow-supervised.js` (0.533)
5. **"MQTT privacy modes"** → `docs/adr/ADR-115-home-assistant-integration.md` chunks 7 & 6 (0.416, 0.463); `scripts/validate-esp32-mqtt.sh` (0.523); `docs/integrations/home-assistant.md` (0.524)

Post-close durability also verified: `RvfDatabase.openReadonly()` reports 2,353 vectors
and "how does over-the-air firmware update work" → top hit
`firmware/esp32-csi-node/main/ota_update.h`.

## Rebuild

```bash
cd "/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer"
node Docs/KB/build-ruview-kb.mjs    # rewrites ruview-kb.rvf + ruview-kb.meta.json, prints counts + verification queries
```

## Query example

```js
const { RvfDatabase } = require('/Users/stuartkerr/.npm-global/lib/node_modules/@ruvector/rvf');
const { pipeline } = require('/Users/stuartkerr/.npm-global/lib/node_modules/agentic-flow/node_modules/@xenova/transformers');
const meta = JSON.parse(require('fs').readFileSync('Docs/KB/ruview-kb.meta.json', 'utf8')).entries;
const db = await RvfDatabase.openReadonly('Docs/KB/ruview-kb.rvf');
const fe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const q = await fe(['your question'], { pooling: 'mean', normalize: true });
const hits = await db.query(Float32Array.from(q.data), 5);
hits.forEach(h => console.log(h.distance, meta[h.id].path, meta[h.id].title));
```

## Known notes

- `Docs/KB/ruvector-kb.rvf` (+ .idmap.json/.lock) was created concurrently during the
  build by Ruflo auto-capture hooks — it is NOT part of this KB and was left untouched.
- `ui/` contains more than the 4 ingested .html pages (app.js, services, etc.); per the
  corpus spec only the html title+meta were indexed.
- `python/`, `examples/`, `dashboard/` source code is outside the corpus spec.
