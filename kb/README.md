# The RVF Knowledge Bases — what they are and exactly how to use them

*You downloaded (or are about to download) `ruvector-kb.rvf` and/or `ruview-kb.rvf` from the [Cognitum One Sensor Primer](https://cognitum-sensor-primer.vercel.app). This README assumes you've never touched an RVF file before. That's fine — nobody has, it's brand new. Follow along.*

---

## 1. What is this thing?

An `.rvf` file is a **portable, self-contained vector database in a single file** — RuVector's own format. Think of it like a PDF, but instead of pages it holds *meaning*: every document in a codebase, converted to numbers (embeddings) that let a computer find content by **what it means**, not what it's called.

These two files are **complete semantic indexes of ruvnet's repositories**, built mechanically — no human chose what to include, a script enumerated *everything*:

| File | Covers | Size | Inside |
|---|---|---|---|
| `ruvector-kb.rvf` | [github.com/ruvnet/ruvector](https://github.com/ruvnet/ruvector) (the 1.7M-line Rust engine) | ~9 MB | **5,759 vectors** from **1,408 files**: all 277 ADR files, 278 research docs across 80 dirs, 216 crate manifests + 200 crate READMEs, 99 example READMEs, 85 npm packages, 37 skills, all guides |
| `ruview-kb.rvf` | [github.com/ruvnet/RuView](https://github.com/ruvnet/RuView) (the WiFi sensing platform) | ~3.9 MB | **2,353 vectors** from **527 files**: all 160+ ADR files, the 2,468-line user guide, 86 scripts, 39 crate manifests, 41 firmware headers, both tutorials |

**Why they exist:** the markdown primers on the same site are curated summaries — readable, but summaries drop things (we proved this: our own first drafts undercounted ADRs, examples, and whole research directories). The KBs are the **uncurated backstop**: if it's in the repo's knowledge layer, it's in here. Generated **June 12, 2026** from same-day checkouts (`ruvector` @ `4dedde8`, `RuView` @ `3d7530f0`/v1701). Embeddings: `Xenova/all-MiniLM-L6-v2`, 384-dim, computed locally — no cloud touched your queries or these builds.

**Companion files (keep them together!):** each `.rvf` ships with sidecars — `ruvector-kb.ids.json` / `ruview-kb.meta.json` (maps result IDs back to file paths + previews — required) and `*.idmap.json` (the store's own index map). A `*.MANIFEST.md` documents counts, verification queries, and rebuild commands.

## 2. How do I use it? (three ways, easiest first)

### Way 1 — Give it to Claude Code (the spoon-fed path)
1. Copy the `.rvf` + its `.json` sidecars into your project, e.g. a `kb/` folder.
2. Create (or edit) `.mcp.json` in your project root:
```json
{
  "mcpServers": {
    "ruvector-kb": {
      "command": "npx",
      "args": ["-y", "@ruvector/rvf-mcp-server", "--transport", "stdio", "--store", "kb/ruvector-kb.rvf"]
    }
  }
}
```
3. Add one line to your project's `CLAUDE.md`:
   > A semantic knowledge base of the entire ruvector/RuView ecosystem is mounted as MCP server `ruvector-kb` — query it before exploring those repos manually.
4. Restart Claude Code. Now ask things like *"which crate does dynamic min-cut?"* or *"what's the seed ingest packet format?"* — Claude searches the **whole tree's meaning** in milliseconds instead of grep-sampling 1.7M lines and missing subdirectories.

*(If `@ruvector/rvf-mcp-server` flags differ in your version, run `npx @ruvector/rvf-mcp-server --help` — the package is young and moving.)*

### Way 2 — Query from Node.js
```js
import { RvfDatabase } from '@ruvector/rvf';        // npm i @ruvector/rvf @xenova/transformers
import { pipeline } from '@xenova/transformers';
import ids from './ruvector-kb.ids.json' with { type: 'json' };

const embed = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
const db = await RvfDatabase.open('ruvector-kb.rvf');
const q = await embed('how do I load an rvf file in Node', { pooling: 'mean', normalize: true });
const hits = await db.query(Array.from(q.data), 5);
hits.forEach(h => console.log(ids[h.id]?.path, ids[h.id]?.title));
```
Results come back as `{id, distance}` — the `ids.json` sidecar turns IDs back into file paths and previews.

### Way 3 — Rust
```rust
use rvf_runtime::RvfStore;                          // cargo add rvf-runtime
let store = RvfStore::open_readonly("ruvector-kb.rvf")?;
// embed your query with any 384-dim MiniLM-compatible model, then store.query(&vec, 5)
```

## 3. When to use the KB vs the primer

- **Read the primer** (`ruvector-primer.md` / `ruview-primer.md`) when you want orientation: what the system *is*, what to install, the honest capability grades.
- **Query the KB** when you need to *find* something specific — an ADR, a crate, a research doc, a script — especially anything a summary might have skipped. The KB doesn't summarize; it locates.

## 4. Is it stale? How do I rebuild it?

Check the source repo's HEAD against the commit above (`git ls-remote <repo> HEAD`). To rebuild from a fresh checkout, the exact builder scripts are in this folder: `build-ruview-kb.mjs` and `.build-ruvector-kb/build.mjs` (Node 18+, ~5 minutes, fully local). Each manifest lists the verification queries a rebuild should pass.

## 5. Honest limits

- Query quality is bounded by MiniLM-L6 (384-dim) — excellent for "where is X / which thing does Y," not a reasoning engine.
- The KBs index the repos' **knowledge layer** (docs, manifests, READMEs, headers, scripts) — not every line of source code.
- Search returns `{id, distance}` only; without the `.json` sidecars you get numbers, not paths. Keep the files together.
- Built 2026-06-12; both upstream repos ship daily. The manifests carry the exact provenance.

*Generated by Claude (Fable 5) for the Cognitum One Sensor Primer. Questions → start at the [site](https://cognitum-sensor-primer.vercel.app).*
