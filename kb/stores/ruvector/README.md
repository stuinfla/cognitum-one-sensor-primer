# ruvector knowledge base

This folder holds the searchable knowledge base for **[ruvnet/ruvector](https://github.com/ruvnet/ruvector)** — the ~1.7M-line Rust AI engine inside the Cognitum One Seed.

| File | What it is |
|---|---|
| `ruvector-kb.big.rvf` | 🖥️ **BIG** version (768-dim) — **use on your Mac/PC**, sharpest answers |
| `ruvector-kb.rvf` | 🌱 **SMALL** version (384-dim) — **use on the Seed**, lighter |
| `ruvector-kb.passages.jsonl` | the readable text (searches join to this) — shared by both |
| `ruvector-kb.ids.json` | per-document info (path, kind, title) — shared by both |
| `*.rvf.idmap.json` / `*.big.rvf.embed.json` | internal index files (don't delete) |
| `ruvector-primer.md` | the human-readable summary of the whole project |
| `ruvector-kb.MANIFEST.md` | provenance + how to rebuild |

**How do I actually use this?** You don't run it from here — download the **`ruvector-kb-bundle.zip`** (it packages these files with the tools + a step-by-step guide), or see the main **[`../../README.md`](../../README.md)**, which explains what an RVF knowledge base is from scratch and the three ways to query it (Claude Code / command line / Node).
