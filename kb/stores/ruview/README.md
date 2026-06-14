# ruview knowledge base

This folder holds the searchable knowledge base for **[ruvnet/RuView](https://github.com/ruvnet/RuView)** — the WiFi-CSI / mmWave-radar contactless sensing platform the Seed runs (presence, occupancy, vitals, device onboarding).

| File | What it is |
|---|---|
| `ruview-kb.big.rvf` | 🖥️ **BIG** version (768-dim) — **use on your Mac/PC**, sharpest answers |
| `ruview-kb.rvf` | 🌱 **SMALL** version (384-dim) — **use on the Seed**, lighter |
| `ruview-kb.passages.jsonl` | the readable text (searches join to this) — shared by both |
| `ruview-kb.meta.json` | per-document info (path, kind, title) — shared by both |
| `*.rvf.idmap.json` / `*.big.rvf.embed.json` | internal index files (don't delete) |
| `ruview-primer.md` | the human-readable summary of the whole platform |
| `ruview-kb.MANIFEST.md` | provenance + how to rebuild |

**How do I actually use this?** You don't run it from here — download the **`ruview-kb-bundle.zip`** (it packages these files with the tools + a step-by-step guide), or see the main **[`../../README.md`](../../README.md)**, which explains what an RVF knowledge base is from scratch and the three ways to query it (Claude Code / command line / Node).
