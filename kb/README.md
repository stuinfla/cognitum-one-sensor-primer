# The Cognitum RVF Knowledge Bases — what they are and exactly how to use them

*You downloaded (or are about to download) `ruvector-kb.rvf` and/or `ruview-kb.rvf` from the [Cognitum One Sensor Primer](https://cognitum-sensor-primer.vercel.app). This README assumes you've never touched an RVF file before. That's fine — it's a new format. Follow along; everything below is verified working.*

---

## 1. What is this thing?

An `.rvf` file is a **portable, self-contained vector database in a single file** — RuVector's own format. Think of it like a PDF, but instead of pages it holds *meaning*: every document in a codebase, converted to embeddings so a computer can find content by **what it means**, not just what it's named.

These two files are **complete semantic indexes of ruvnet's repositories**, built mechanically — no human chose what to include; a script enumerated *everything*:

| File | Covers | `.rvf` size | Vectors | Embedding |
|---|---|---|---|---|
| `ruvector-kb.rvf` | [github.com/ruvnet/ruvector](https://github.com/ruvnet/ruvector) (the ~1.7M-line Rust engine) | ~25 MB | **14,052** | Xenova/all-MiniLM-L6-v2 · 384-dim · cosine |
| `ruview-kb.rvf` | [github.com/ruvnet/RuView](https://github.com/ruvnet/RuView) (the WiFi/CSI sensing platform) | ~7.4 MB | **4,306** | Xenova/all-MiniLM-L6-v2 · 384-dim · cosine |

Embeddings are computed **locally** with MiniLM — no cloud touched your queries or these builds. One chunk ≈ 1,000 tokens (~4,000 chars, paragraph-aligned).

**Why they exist:** the markdown primers on the same site are curated summaries — readable, but summaries drop things. The KBs are the **uncurated backstop**: if it's in the repo's knowledge layer (ADRs, docs, research, crate manifests + READMEs, every `//!` doc comment, each crate's lead file + module inventory, scripts, firmware headers, UI text), it's in here.

### The files in a bundle (keep them together)

| File | Required? | What it is |
|---|---|---|
| `*.rvf` | yes | the vector store (HNSW index, 384-dim, cosine) |
| `*.passages.jsonl` | **yes** | **full-text sidecar** — one `{id, text, path, title}` JSON object per line. The `.rvf` returns `{id, distance}` only; retrieval **joins those ids to the full passage text here.** Without it you get numbers, not text. |
| `ruvector-kb.ids.json` / `ruview-kb.meta.json` | yes | id → `{path, kind, title, chunk, preview}` metadata map |
| `*.rvf.idmap.json` | yes | the store's own internal id↔label map (auto-managed; do not delete) |
| `*.MANIFEST.md` | no | provenance, per-kind counts, verification queries, rebuild commands |
| `ask-kb.mjs`, `kb-mcp-server.mjs`, `resolve-deps.mjs`, `package.json` | yes (to *run* it) | the working CLI + MCP server + dep resolver (see below) |
| the relevant build script | no | rebuild from a fresh checkout |

> **The two-part design:** vectors live in the `.rvf`; the readable text lives in `.passages.jsonl`. A search embeds your query, asks the `.rvf` for the nearest ids, then looks each id up in `.passages.jsonl` to return the **full** passage. This is why both files ship together.

---

## 2. Setup (once)

```bash
cd kb
npm i        # installs @ruvector/rvf + @xenova/transformers into kb/node_modules
```

That's it. The scripts resolve those two deps from `kb/node_modules` automatically (a small `resolve-deps.mjs` handles it). On first use the MiniLM model (~25 MB) downloads from HuggingFace and is cached; after that, queries run fully offline.

> Node 18+ required. The native `@ruvector/rvf` binding ships prebuilt binaries for macOS (arm64/x64), Linux (x64/arm64-gnu), and Windows x64 — no compiler needed.

---

## 3. How to use it (three real, working ways)

### Way 1 — As an MCP server in Claude Code (the bundled `kb-mcp-server.mjs`)

The bundle ships a **working** MCP stdio server, `kb-mcp-server.mjs`. It embeds your query locally, searches the requested `.rvf`, and returns the **full passage text** of each hit.

**Step 1.** Unzip the bundle into your project as `kb/`, then `cd kb && npm i` (section 2).

**Step 2.** Create (or edit) `.mcp.json` in your **project root** with exactly this — point `args` at the absolute path of the bundled server:

```json
{
  "mcpServers": {
    "cognitum-kb": {
      "command": "node",
      "args": ["<ABSOLUTE-PATH-TO>/kb/kb-mcp-server.mjs"]
    }
  }
}
```

One server serves **both** KBs — you pick which with the `store` argument on each call.

**Step 3.** Paste this line at the end of your project's `CLAUDE.md`:

```
A semantic KB of the ruvector/RuView ecosystem is mounted as MCP server `cognitum-kb` (tool `search_kb`, store="ruvector" or "ruview") — query it FIRST for any ruvector/RuView question.
```

**Step 4 — confirm it actually works (don't skip this):**

1. **Restart** Claude Code in the project (`exit`, then `claude`). Approve the new `cognitum-kb` server when prompted.
2. Type **`/mcp`** — you should see `cognitum-kb` listed as **connected**.
3. Ask: *"Using cognitum-kb, which crate implements dynamic min-cut?"* A working setup calls `search_kb({store:"ruvector", query:"dynamic min-cut"})` and answers with real file paths (e.g. `crates/ruQu/src/mincut.rs`, `crates/ruvector-dag/src/mincut/local_kcut.rs`) and full passage text — in seconds, instead of grep-sampling 1.7M lines.

The tool: `search_kb({ query: string, store: "ruvector" | "ruview", k?: number = 6 })`.

> ⚠️ **Do NOT use `@ruvector/rvf-mcp-server`.** The published `@ruvector/rvf-mcp-server` package is a **non-functional stub** — it never reads a prebuilt `.rvf` and returns no passage text. Use the bundled `kb-mcp-server.mjs` shown above. (Earlier versions of this site/README pointed at that package; that was wrong.)

### Way 2 — From the command line (`ask-kb.mjs`)

```bash
node kb/ask-kb.mjs ruvector "how do I load an rvf file in Node" 5
node kb/ask-kb.mjs ruview  "how do I calibrate an empty room" 5
```

Format: `node kb/ask-kb.mjs <ruvector|ruview> "question" [k]`. It prints each hit's path, title, distance, and the **full passage text**.

### Way 3 — From Node (the `searchKb` API)

`ask-kb.mjs` exports `searchKb`, which does the embed → `.rvf` query → passage-join for you:

```js
import { searchKb } from './kb/ask-kb.mjs';

const hits = await searchKb({ store: 'ruvector', query: 'SONA LoRA adaptation API', k: 5 });
for (const h of hits) {
  console.log(h.distance.toFixed(4), h.path, h.title);
  console.log(h.text);          // FULL passage text, joined from the .passages.jsonl sidecar
}
```

Each hit is `{ id, distance, path, title, text }`. If you'd rather wire the raw store yourself: `@ruvector/rvf`'s `RvfDatabase.openReadonly(file)` → `db.query(vec384, k)` returns `{id, distance}`; resolve `id` against `*.passages.jsonl` for the text and `*.ids.json`/`*.meta.json` for metadata. Embed queries with the same model (`Xenova/all-MiniLM-L6-v2`, `pooling:'mean', normalize:true`).

---

## 4. When to use the KB vs the primer

- **Read the primer** (`ruvector-primer.md` / `ruview-primer.md`) for orientation: what the system *is*, what to install, the honest capability grades.
- **Query the KB** to *find* something specific — an ADR, a crate, a research doc, a script — especially anything a summary might have skipped. The KB doesn't summarize; it locates and returns the source text.

---

## 5. Is it stale? How do I rebuild it?

Check the source repos' HEAD against the pinned SHAs in `.last-built.json` / the manifests (`git ls-remote <repo> HEAD`). To rebuild from a fresh checkout (the upstream repos are git submodules here):

```bash
cd kb && npm i                       # once
node kb/.build-ruvector-kb/build.mjs # ~10 min
node kb/build-ruview-kb.mjs          # ~3 min
node kb/guard-check.mjs              # MUST pass before you trust/ship a rebuild
```

`guard-check.mjs` verifies passages/index/idmap line-count **parity**, scans for the old **200/240-char preview-truncation** bug, and runs a **live query** that must return non-empty text. In CI, `.github/workflows/rebuild-kb.yml` runs all of this automatically whenever the submodule pointers move, and refuses to commit a KB that fails the guard.

---

## 6. Honest limits

- Query quality is bounded by MiniLM-L6 (384-dim) — excellent for "where is X / which thing does Y," not a reasoning engine.
- The KBs index the repos' **knowledge layer plus the source's self-description** (docs, manifests, READMEs, headers, scripts, every `//!` doc comment, each crate's lead file + module inventory) — not every line of every function body. Ask "where is the kalman tracker implemented" and it answers; it won't recite line 400 of a 2,000-line file.
- A search returns `{id, distance}` from the `.rvf`; the readable text comes from `*.passages.jsonl`. **Keep the files together** — without the sidecar you get numbers, not passages.
- The `@ruvector/rvf-mcp-server` npm package is a stub and is intentionally **not** used here (see Way 1).
- Built June 13, 2026 from same-day submodule checkouts (ruvector `4dedde80`, RuView `v1701`); both upstream repos ship daily. The manifests and `.last-built.json` carry the exact provenance/SHAs.

*Generated by Claude (Fable 5) for the Cognitum One Sensor Primer. Questions → start at the [site](https://cognitum-sensor-primer.vercel.app).*
