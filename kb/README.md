# The Cognitum Knowledge Bases — what this is, and how to actually use it

*You just downloaded a `.zip` from the [Cognitum One Sensor Primer](https://cognitum-sensor-primer.vercel.app). Inside is a **knowledge base** of one of ruvnet's big open-source projects. This guide assumes you've **never heard of an "RVF file," a "vector database," or "embeddings"** before. That's completely fine. Read section 1, do the 3-step Quick Start, and you'll be asking it questions in about five minutes.*

---

## 0. The 60-second version (read this first)

- You downloaded a **searchable brain** for a giant codebase — thousands of documents turned into something a computer (or an AI like Claude) can search **by meaning**, not just by keyword.
- It comes in **two versions of the same thing**. Grab the one that fits where you'll use it:
  - 🖥️ **BIG** (`*-kb.big.rvf`) → **use this on your Mac or PC.** Sharper, more accurate answers.
  - 🌱 **SMALL** (`*-kb.rvf`) → **use this on the Cognitum One Seed** (the little appliance). Lighter, built to run on the device itself.
  - **Both answer the same questions.** If you're not sure, you're probably on a laptop → use BIG.
- The single most useful thing you can do with it: **point Claude Code (or Cursor/Codex) at it** so your AI assistant can answer questions about ruvnet's code accurately instead of guessing. That's section 3, Way 1 — and it's worth the five minutes.

---

## 1. What is this thing, in plain English?

Imagine you took an **entire 1.7-million-line software project** — every design document, every README, every source file — and fed it to a tool that reads all of it and builds an index of **what each piece *means***. Then you can ask a plain-English question like *"how does the radar know a room is empty?"* and it hands you back the exact documents that answer it — even if none of them contain the words you used.

That index is what's in this download. The technical name is an **RVF file** (RuVector Format) — think of it as a **PDF, but instead of pages it stores meaning**. It's a single, portable file that holds a "vector" (a list of numbers that captures meaning) for every chunk of the project.

Three facts that make the rest of this guide make sense:

1. **It searches by meaning, not keywords.** Ask "find someone in a dark room" and it finds the docs about *presence detection* and *empty-room calibration* — because it understood the idea, not because it matched a word.
2. **The `.rvf` file holds the *meaning*; a companion file holds the *words*.** When you search, the `.rvf` tells you *which* documents match; a second file (`*.passages.jsonl`) gives you the actual readable text. **They must stay together** — that's why they're zipped as a set.
3. **Nothing leaves your machine.** The search runs locally. Your questions, and the project's contents, never get sent to a cloud service.

### Why would *you* want this?

You got a Cognitum One Seed. You want to understand or build on **ruvector** (the AI engine inside it) or **RuView** (the WiFi/radar sensing platform). The official docs are vast and scattered. This KB lets you — or your AI assistant — **find the right answer in seconds** instead of reading for hours. It's the bridge between "I have powerful hardware" and "I actually know how to use it."

---

## 2. Quick Start (3 steps, ~5 minutes)

```bash
# 1. Unzip this bundle, then go into it
cd ruvector-kb-bundle      # (or ruview-kb-bundle)

# 2. Install the two helper libraries (one time). Needs Node.js 18+.
npm i

# 3. Ask it a question from the command line
node ask-kb.mjs ruvector "how do I load an rvf file in Node" 5
```

That's it. You'll see the top matching documents with their **full text**. On the very first run it downloads a small AI model (the thing that turns your question into a "meaning vector") and caches it; after that everything runs offline.

> **Don't have Node.js?** Install it from [nodejs.org](https://nodejs.org) (the "LTS" button). On a Mac with Homebrew: `brew install node`.

---

## 3. The three ways to use it

### 🌟 Way 1 — Let your AI coding assistant use it (the big one)

This is the payoff. You connect the KB to **Claude Code**, **Cursor**, or any MCP-compatible AI editor, and from then on your assistant can *look things up in the real ruvnet codebase* before answering — so it stops guessing and starts citing actual files.

**Step 1.** Unzip the bundle into your project as a folder named `kb/`, then:
```bash
cd kb && npm i
```

**Step 2.** In your project's root, create a file called `.mcp.json` (or add to the one you have). Put the **absolute path** to the bundled server:
```json
{
  "mcpServers": {
    "cognitum-kb": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/your-project/kb/kb-mcp-server.mjs"]
    }
  }
}
```
> Tip: run `pwd` inside the `kb/` folder to get the absolute path, then append `/kb-mcp-server.mjs`.

**Step 3.** Add this one line to the bottom of your project's `CLAUDE.md` (create the file if it doesn't exist) so the assistant knows the tool is there and uses it:
```
A semantic knowledge base of the ruvector/RuView ecosystem is available as MCP server `cognitum-kb` (tool `search_kb`, with store="ruvector" or store="ruview"). Query it FIRST for any ruvector or RuView question before answering.
```

**Step 4 — confirm it actually works (don't skip):**
1. **Restart** your editor / Claude Code in that project. Approve the new `cognitum-kb` server when prompted.
2. In Claude Code, type **`/mcp`** — you should see `cognitum-kb` listed as **connected**.
3. Ask your assistant: *"Using cognitum-kb, which crate implements dynamic min-cut?"* A working setup will call the tool and answer with **real file paths and quoted source** in seconds.

The tool it exposes: `search_kb({ query: string, store: "ruvector" | "ruview", k?: number })`. **One server serves both KBs** — you (or the AI) pick which with `store`. The server automatically uses the **big** variant if you bundled it, else the small one.

> 💡 **In VS Code specifically:** use the Claude Code or Cline/Continue extension (anything that supports MCP), point its MCP config at the same `kb-mcp-server.mjs` path, and reload the window. Then just chat normally — "search the ruvector KB for how SONA does LoRA adaptation" — and it'll pull real answers.

### Way 2 — From the command line (no AI needed)

```bash
node ask-kb.mjs ruvector "SONA LoRA adaptation API" 5
node ask-kb.mjs ruview  "how do I calibrate an empty room" 5
```
Format: `node ask-kb.mjs <ruvector|ruview> "your question" [how-many] [big|small]`. It prints each matching document's path, title, and **full text**. Leave off `big|small` and it auto-picks the best version you have.

### Way 3 — From your own Node code

```js
import { searchKb } from './kb/ask-kb.mjs';

const hits = await searchKb({ store: 'ruvector', query: 'how does the coherence gate decide?', k: 5 });
for (const h of hits) {
  console.log(h.path, '—', h.title);
  console.log(h.fullText);   // the complete document text, ready to use
}
```

---

## 4. What kinds of questions can I ask? (copy these)

You can ask in plain English. Two styles work: **ask it yourself** (Way 2), or **tell your AI assistant to ask it** (Way 1 — "use cognitum-kb to find…"). Good questions describe *what you want to understand*, not exact keywords.

**If you have the `ruvector` KB** (the AI engine):
- "What is ruvector and what is it for?"
- "Which crate implements dynamic min-cut, and how does it work?"
- "How does SONA learn and adapt over time?"
- "What does the coherence gate decide, and how?"
- "How do I load an RVF file and run a query in Node?"
- "What research backs the sublinear solver?"
- "Which crates are production-ready vs experimental?"
- "Show me every place HNSW indexing is configured."

**If you have the `ruview` KB** (the WiFi/radar sensing platform):
- "What is RuView and what can it sense?"
- "How does it tell an empty room from an occupied one?"
- "How is a Cognitum Seed onboarded and pretrained?"
- "How does an ESP32 CSI node stream data to the Seed?"
- "What's the difference between presence detection and occupancy?"
- "How do I connect it to Apple Home / Siri?"
- "What sensors are supported, and which is best for fall detection?"

**Pro move for AI assistants:** tell Claude *"Before you answer anything about ruvector or RuView, search cognitum-kb first and quote the file you used."* That single instruction turns a guessing assistant into one grounded in the real code.

---

## 5. Which version do I use? (and what's in the box)

You got **both** versions so you never have to rebuild. Pick by *where you'll run it*:

| | 🖥️ BIG — `*-kb.big.rvf` | 🌱 SMALL — `*-kb.rvf` |
|---|---|---|
| **Use it on** | your Mac / PC | the Cognitum One Seed (the appliance) |
| **Answer quality** | sharpest | very good |
| **Model** | bge-base-en-v1.5 · 768-dim | all-MiniLM-L6-v2 · 384-dim |
| **Why** | more accurate; your laptop has the power | smaller + lighter; built to run on the device |

You don't have to choose a file by hand — `ask-kb.mjs` and the MCP server **auto-use BIG if it's present**, else SMALL. To force one: add `big` or `small` to the command (Way 2), or just delete the variant you don't want.

**The files in the bundle (keep them together):**

| File | What it is |
|---|---|
| `*-kb.big.rvf` + `*.big.rvf.embed.json` | the **big** vector store (768-dim) + the note telling the tool how to search it |
| `*-kb.rvf` | the **small** vector store (384-dim, Seed) |
| `*.passages.jsonl` | the **readable text** — the search joins matches to this to return real passages. **Shared by both versions.** Without it you get numbers, not words. |
| `*-kb.ids.json` / `*-kb.meta.json` | per-document info (path, kind, title). Shared by both. |
| `*.rvf.idmap.json` | each store's internal id map (don't delete) |
| `ask-kb.mjs`, `kb-mcp-server.mjs`, `resolve-deps.mjs`, `package.json` | the tools that run it (section 3) |
| `guard-check.mjs` | an integrity self-check (section 7) |
| `SOURCE.json`, `kb-update.mjs` | keep your copy current (section 6) |
| `*.MANIFEST.md`, build script | provenance + how to rebuild from scratch |
| `START-HERE.md` | the 1-page newcomer version of this guide |

---

## 6. Evergreen: keep your copy current

ruvnet ships updates daily. **This bundle knows where it came from** and can tell you when it's out of date:

```bash
node kb-update.mjs --check     # "UP TO DATE" or "BEHIND — canonical built <date>…"
node kb-update.mjs --apply     # backs up your copy, downloads the latest, re-verifies, swaps it in
```

`--apply` is safe: it backs up your current folder first, stages the download, re-runs the integrity check, and only then replaces your copy — if anything fails it stops and leaves your working copy untouched. Schedule a weekly check with cron:
```cron
0 9 * * 1  cd /path/to/your/project/kb && /usr/bin/node kb-update.mjs --check >> kb-update.log 2>&1
```
The canonical source is this repo's `kb/` directory on GitHub (`SOURCE.json` carries the exact URLs and the commit each store was built from). When ruvnet publishes, CI rebuilds the bundles, so a check months from now reflects the latest upstream.

---

## 7. Putting it in your own project (without bloating your repo)

**Don't commit the vector files into your project.** The `.rvf` databases (and the bundle zips) are big **build artifacts**, not source — they're rebuilt from the upstream repos and published on the [`kb-latest` release](https://github.com/stuinfla/cognitum-one-sensor-primer/releases/tag/kb-latest). Add them to your project's **`.gitignore`** and fetch them instead. Your teammates (and your CI) re-download in one step; your repo stays small.

```gitignore
# Cognitum KB — large artifacts, fetched from the release, never committed
kb/**/*.rvf
kb/**/*.rvf.idmap.json
kb/**/*.passages.jsonl
kb/*-kb-bundle.zip
kb/models-cache/
kb/node_modules/
```

Fetch / refresh the prebuilt KB any time (re-downloads the current release, verifies it, swaps it in):

```bash
cd kb && node kb-update.mjs --apply          # or just re-download the bundle from the release
```

**Want to rebuild the KB yourself from the very latest source?** Add the upstream repos as **git submodules**. A submodule stores only a tiny *pointer* in your repo — **not** RuView's/ruvector's million-plus lines — so it does **not** bloat your project; the actual code is fetched into a separate folder on demand.

```bash
# one-time: reference the upstream source (pointer only — your repo stays tiny)
git submodule add https://github.com/ruvnet/RuView   vendor/RuView
git submodule add https://github.com/ruvnet/ruvector vendor/ruvector

# pull the latest upstream whenever you want it fresh (this is the "always updated" part)
git submodule update --remote vendor/RuView vendor/ruvector

# then rebuild + verify (writes into kb/stores/<repo>/, which your .gitignore above keeps out of git)
cd kb && npm i
KB_REPO_ROOT="$PWD/.." node .build-ruvector-kb/build.mjs   # or build-ruview-kb.mjs
node guard-check.mjs                                        # must PASS before you trust a rebuild
```

> The submodule **working tree** (the checked-out RuView/ruvector files under `vendor/`) is what you don't want in *your* commits — but git already handles that: only the pointer is tracked, and the files live in `vendor/` which you can also add to `.gitignore` if you prefer to fetch them on demand rather than pin them. Most projects just **skip the submodule entirely and use the prebuilt release** — rebuilding is only for staying bleeding-edge.

---

## 8. Honest limits (so you trust it)

- **It finds and quotes; it doesn't reason.** It excels at "where is X / how does Y work / which thing does Z." It returns the real source documents — it isn't a chatbot inventing prose. (Pair it with Claude via Way 1 to get reasoning *on top of* trustworthy sources.)
- **ADRs are proposals, not always shipped reality.** ruvnet's "ADR" design docs are *initial thinking*; the code is what got built. When the KB returns an ADR that's still a proposal, it **labels it** (`ADR STATUS: PROPOSED — design intent, NOT confirmed shipped`) so you don't mistake a plan for a feature.
- **BIG is sharper than SMALL,** but both are bounded by their model — great for retrieval, not a substitute for reading the code when you need line-by-line certainty.
- **Keep the files together.** The `.rvf` returns ids; the readable text lives in `*.passages.jsonl`. Separated, you get numbers instead of answers.
- **Verify it yourself anytime:** `node guard-check.mjs` checks that the text, index, and id map line up and that a live query returns real text.

---

*Built for the Cognitum One Sensor Primer. New to the Seed itself? Start at the [primer site](https://cognitum-sensor-primer.vercel.app) and the [first-run setup wizard](https://cognitum.shaal.dev/). Questions about the KB → re-read section 1; it really is just "a searchable brain for a codebase."*
