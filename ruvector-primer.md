# The RuVector Primer

**A drop-in AI context document — drag this file into any project or AI chat and your assistant starts already knowing the RuVector ecosystem.**

---

## About this document (read this first)

| | |
|---|---|
| **Generated** | June 12, 2026 · **last verified against the repo & shipped KB: June 13, 2026** |
| **Source (pinned)** | [github.com/ruvnet/ruvector](https://github.com/ruvnet/ruvector), branch `main`, commit **`4dedde8`** ("chore: Update RVF NAPI-RS binaries for all platforms", committed 2026-06-12 17:15 UTC). This is the exact SHA the working git submodule sits at **and** the SHA the shipped `ruvector-kb.rvf` knowledge base was built from (`kb/.last-built.json`) — primer, repo and KB are in lockstep. |
| **Method** | Originally written by three parallel research agents sweeping a same-day checkout. **Every factual claim in the June-13 pass was re-checked against the working submodule (`find`/`ls` counts) and the shipped semantic KB (`node kb/ask-kb.mjs ruvector "…"`), which returns real file paths.** Claims the KB or filesystem could not substantiate were corrected or removed; nothing here is asserted from memory. |
| **Companion site** | [cognitum-sensor-primer.vercel.app](https://cognitum-sensor-primer.vercel.app) — the repo keeps `ruvector` (and `RuView`) as auto-updating git submodules, bumped daily by GitHub Actions. |

**Is this stale?** RuVector moves fast. Check the date above against the repo's latest commit:

```bash
git ls-remote https://github.com/ruvnet/ruvector HEAD
```

If months have passed, regenerate rather than trust: clone the repo (`git clone --depth 1 https://github.com/ruvnet/ruvector`), then ask Claude Code (or any capable AI assistant):

> "Exhaustively sweep this checkout and produce a primer document covering: (1) every crate in crates/ grouped by domain with one-line purposes, (2) every ADR with number/title/status, (3) docs, tutorials, examples and Claude Code skills, (4) capabilities with real install/usage commands, (5) a performance-claims table marked as claimed-not-verified, (6) ecosystem relationships and maturity caveats."

That prompt is how this document was produced. Using this file instead of re-running that sweep saves roughly 200k+ tokens and 10+ minutes per project.

**Honesty rule used throughout:** numbers are reported as *claimed* in the repo's own docs unless marked otherwise. Nothing here was independently benchmarked.

---

## 0. Executive summary + "which crate do I need?"

RuVector is ruvnet's 1.58M-line Rust monorepo: a **self-learning vector database and agentic runtime** that ships as plain files and libraries — no server, no Docker (one optional Postgres image aside). It is infrastructure, not an app: search, learning, graphs, coherence/safety gates, math, local LLM inference, consensus. If your task is content generation, web frameworks, or cloud admin, RuVector is the *backend* under those, not the tool.

| I need to… | Use | Install |
|---|---|---|
| semantic search in Rust | `ruvector-core` (HNSW, 61 µs claimed) | `cargo add ruvector-core` |
| semantic search in Node | `ruvector` npm (NAPI, WASM fallback) | `npm i ruvector` |
| a portable KB file I can ship | **RVF** — vectors+index+witness in one `.rvf` | `cargo install rvf-cli` / `npm i @ruvector/rvf` |
| agent memory that persists | AgentDB (bundled in ruFlo) or `@ruvector/rvf` + HNSW | `ruflo memory …` / `npm i agentdb@alpha` |
| replace pgvector | `ruvector-postgres` (230+ SQL fns) | `cargo pgrx init` then build; `docker pull ruvnet/ruvector-postgres` |
| search in the browser, offline | `@ruvector/wasm`, `rvlite` (SQL+SPARQL+Cypher, IndexedDB) | npm |
| tiny IoT / ASIC search | `micro-hnsw-wasm` (~11.8 KB) | vendored |
| a knowledge graph + Cypher | `ruvector-graph` | `cargo add ruvector-graph` / `npm i @ruvector/graph` |
| results that improve with use | `ruvector-gnn` + `sona` | `cargo add ruvector-gnn sona` |
| hallucination/drift gating | `prime-radiant` + `ruvector-mincut` + `cognitum-gate-*` | cargo |
| local LLM, no API bill | `ruvllm` (GGUF, Metal/CUDA/WebGPU, BitNet) | `npm i @ruvector/ruvllm` |
| run on Pi 5 NPU / bare metal | `ruvector-hailo` (ADR-167) / `ruvix` kernel (ADR-087) | cargo, feature-gated |
| an agent framework with MCP | `rvAgent` (10 crates) | cargo (crates/rvAgent; npm publish unverified) |
| expose all this to Claude | `mcp-brain` (shared brain) · the bundled `kb/kb-mcp-server.mjs` for *this* repo's KB | see §8.7 — **NOT** `@ruvector/rvf-mcp-server` (a non-functional stub; see warning) |

![RuVector stack: consumers (RuView, Cognitum Seed/V0, ruFlo, AgentDB, your app) sit on one Rust engine of 139 crates/ dirs (~183 workspace members) across search, self-learning, graph, coherence, math, LLM, attention, bio/quantum, distributed and agent domains, delivered as .rvf files, crates.io/npm packages, WASM/NAPI builds and a PostgreSQL extension](https://cognitum-sensor-primer.vercel.app/assets/diagrams/ruvector-stack.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
RuView · Cognitum Seed/V0 · ruFlo · AgentDB · your app
        └────────────┬─────────────────────┘
   THE ENGINE (139 crates/ dirs (~183 workspace members), 1.58M LOC Rust, MIT)
   search │ self-learn │ graph │ coherence │ math/solvers
   ruvllm │ attention(46) │ bio/quantum │ distributed │ rvAgent
        └────────────┬─────────────────────┘
   .rvf files · crates.io+npm · WASM/NAPI · PostgreSQL ext
```

</details>

---

## 1. What RuVector is

RuVector is a self-learning, self-optimizing **vector database and agentic runtime built entirely in Rust**. Unlike traditional vector databases that return identical results forever, RuVector layers a Graph Neural Network over its HNSW index so search quality improves automatically from usage. It targets three pains: vector search that stays static without retraining, AI models that require cloud APIs and per-query billing, and vector infrastructure that requires servers and ops.

**Design philosophy:** Rust-first (memory-safe, no GC), zero-server (a single `.rvf` file can carry vectors, models, witness chains — even a bootable microkernel), self-optimizing (SONA runtime adaptation, sub-millisecond LoRA updates), privacy-first (local inference, runs offline, browser WASM). Created by rUv; it is the substrate under Cognitum (CES 2026 Innovation Awards Honoree), RuView WiFi sensing, ruFlo/claude-flow orchestration, and AgentDB. MIT licensed.

---

## 2. The big capabilities (and how to actually call them)

### Vector search & HNSW
**Crate:** `ruvector-core` · **npm:** `ruvector`
HNSW indexing with SIMD (AVX-512, NEON); claimed 61 µs p50 search.

```bash
cargo add ruvector-core      # Rust
npm install ruvector         # Node
```
```rust
use ruvector_core::{VectorDB, DbOptions};
let db = VectorDB::new(DbOptions::default())?;
// see crates/ruvector-core/README.md for insert/search
```

### RVF — the cognitive container format
**What a `.rvf` file stores:** vectors + HNSW index, LoRA adapter deltas, GNN graph state, cryptographic witness chains, post-quantum signatures, COW (Git-like) branches — up to 24 segment types including a bootable Linux microkernel (claimed 125 ms boot as a microservice).

**Rust (verified June 13 against `crates/rvf/`):** 24 crate directories = **18 top-level `rvf-*`** + 6 adapters under `rvf-adapters/` (26 `Cargo.toml` total counting the workspace roots). The 18 top-level: `rvf-types`, `rvf-wire`, `rvf-runtime`, `rvf-crypto`, `rvf-cli`, `rvf-node`, `rvf-wasm`, `rvf-index`, `rvf-manifest`, `rvf-quant`, `rvf-server`, `rvf-launch`, `rvf-import`, `rvf-federation`, `rvf-kernel`, `rvf-ebpf`, `rvf-solver-wasm` (+ one more). Adapters: `claude-flow`, `agentdb`, `ospipe`, `agentic-flow`, `rvlite`, `sona`. **npm:** `@ruvector/rvf`, `@ruvector/rvf-node`, `@ruvector/rvf-wasm`. *(An earlier draft said "23 / 17 top-level"; the tree now has 18 top-level dirs.)*

```bash
cargo install rvf-cli
npm install @ruvector/rvf
```
> ⚠️ The published **`@ruvector/rvf-mcp-server` package is a non-functional stub** — it never reads a prebuilt `.rvf` and returns no passage text. To expose a `.rvf` to Claude/Cursor, use the bundled `kb/kb-mcp-server.mjs` shipped with this repo (see §8.7), not that package. (Confirmed against `kb/README.md`.)
```rust
use rvf_runtime::RvfStore;
let store = RvfStore::open("vectors.rvf")?;
// create/open/open_readonly; see crates/rvf/rvf-runtime
```

### GNN self-learning search
**Crate:** `ruvector-gnn` · **npm:** `@ruvector/gnn`
Every query teaches the index (GCN/GAT/GraphSAGE); claimed +5–8% recall after 1K queries, +12.4% after 100K, <1 ms overhead.

### Graph database & Cypher
**Crate:** `ruvector-graph` · **npm:** `@ruvector/graph`
Neo4j-style Cypher (`MATCH (a)-[:SIMILAR]->(b)`), hyperedges, SPARQL 1.1, Leiden community detection; claimed 30–60% improvement on multi-hop retrieval. Graph transformers add 8 proof-gated modules (physics-informed, biological/spiking, morphogenetic, manifold, temporal-causal, economic…).

### SONA self-learning
**Crate:** `sona` · **npm:** `@ruvector/sona`, `@ruvector/sona-wasm`
Two-tier LoRA (MicroLoRA <1 ms instant fixes; BaseLoRA long-term), EWC++ against catastrophic forgetting, ReasoningBank trajectory learning. Runs in browsers.

### Attention mechanisms (46 types)
**Crate:** `ruvector-attention` · **npm:** `@ruvector/attention`
Flash Attention, MLA, Mamba SSM, linear, graph, hyperbolic, optimal-transport, topology-gated, KV-cache compression, speculative decoding; 142 tests; automatic mode selection across 7 unified diagnostic theories.

### Min-cut coherence gating
**Crate:** `ruvector-mincut` (+ `ruvector-attn-mincut`, `ruvector-mincut-gated-transformer`) · **npm:** `@ruvector/mincut`
Dynamic exact min-cut with claimed subpolynomial updates (n^0.12 over tested 100–1600 vertices; arXiv:2512.13105). Prunes attention, detects drift, gates incoherent writes. **This is the coherence engine RuView uses for sensor fusion.**

### Sublinear solvers
**Crate:** `ruvector-solver` · **npm:** `@ruvector/solver`
7 algorithms + an auto-router (Neumann, CG, Forward/Backward Push, Hybrid Random Walk, TRUE, BMSSP) for PageRank/spectral/Laplacian work; 177 tests.

### Local LLM inference
**Crate:** `ruvllm` · **npm:** `@ruvector/ruvllm`, `@ruvector/ruvllm-wasm`
GGUF models on Metal/CUDA/ANE/WebGPU/CPU; TurboQuant 2–4-bit KV cache (claimed 6–8× memory savings); π-Quantization (claimed 16× memory reduction, 10 GB/s dequantization); MoE memory-aware routing (claimed 70%+ cache hit, <10 µs).

### Embeddings
Local ONNX (`Xenova/all-MiniLM-L6-v2`-class, 384-dim) and `ruvector-cnn` MobileNet-V3 image embeddings (claimed <5 ms, INT8, zero deps). ADR-194/195 unify the embedder API. No cloud API needed.

### WASM / edge / Node
35+ WASM crates (core search claimed at 5.5 KB minimal runtime; full core 58 KB), ~11 NAPI `-node` crates with prebuilt binaries for darwin-x64/arm64, linux-x64/arm64-gnu, win32-x64-msvc. Edge runtime rvLite (~2 MB) with SQL + SPARQL + Cypher.

### PostgreSQL extension
**Crate:** `ruvector-postgres` (excluded from default workspace — needs `cargo pgrx init`).
230+ SQL functions, pgvector drop-in:
```sql
CREATE EXTENSION ruvector;
SELECT ruvector_search(vectors, query, 10);
SELECT ruvector_hybrid_search(dense, sparse, 0.7);
```
Docker: `docker pull ruvnet/ruvector-postgres` — **the only Docker anywhere in this story, and it's optional.** Everything else is files and crates; no server, no daemon.

### And a long tail
Hybrid RRF search (claimed 20–49% retrieval gain), DiskANN/Vamana billion-scale SSD ANN (<10 ms claimed), ColBERT late interaction, Matryoshka embeddings, OPQ, LSM compaction, Raft consensus + multi-master replication + auto-sharding, temporal tensor compression (4–10×), consciousness metrics (IIT Φ), quantum simulation (ruQu, 25-qubit WASM), genomics (rvDNA), Hailo-8 NPU backend for Pi 5 (claimed 9.6× embedding speedup), bare-metal RuVix microkernel for AArch64, rvAgent agent framework (10 crates), and a market-data Neural Trader.

---

## 3. Complete crate inventory

**Workspace (verified June 13 @ `4dedde8`):** Rust edition 2021, MSRV 1.77 (RVF subsystem 1.87), resolver 2, `workspace.package` version **2.2.3**. **183 entries in the root `members` array; 139 directories in `crates/`** (`ls crates | wc -l`), plus **22 RuVix kernel sub-crates** (`crates/ruvix/crates/`) and **10 rvAgent sub-crates** (`crates/rvAgent/rvagent-*`). Counting *every* `Cargo.toml` in the repo (excluding `target/`/`node_modules/`) gives **314** — that larger number includes example, sub-workspace and nested-crate manifests, not just first-class `crates/` packages. Use whichever boundary you mean and say which.

### Core vector search & HNSW
`ruvector-core` (HNSW + SIMD + REDB persistence) · `ruvector-acorn` (predicate-agnostic filtered HNSW, claimed 2–1000× filtered QPS) · `ruvector-rabitq` (1-bit rotation quantization) · `ruvector-filter` (metadata filtering) · `ruvector-metrics` (Prometheus) · `ruvector-hyperbolic-hnsw` (Poincaré-ball hierarchy-aware search) · `ruvector-diskann`/`-node` (SSD Vamana) · `ruvector-rairs` (RAIRS IVF, ADR-193) · WASM variants: `ruvector-wasm`, `ruvector-acorn-wasm`, `ruvector-rabitq-wasm`, `ruvector-hyperbolic-hnsw-wasm`, `micro-hnsw-wasm`

### Graph, GNN & transformers
`ruvector-graph`/`-node`/`-wasm` (Cypher, ACID, hypergraphs) · `ruvector-gnn`/`-node`/`-wasm` (GNN over HNSW topology) · `ruvector-graph-transformer`/`-node`/`-wasm` (proof-gated, 8 verified modules) · `ruvector-graph-condense`/`-wasm` (min-cut graph condensation, ADR-196/197) · `ruvector-dag`/`-wasm` (query-plan DAGs)

### Attention & coherence
`ruvector-attention`/`-node`/`-wasm`/`-unified-wasm`/`-cli` (46 mechanisms) · `ruvector-mincut`/`-node`/`-wasm` · `ruvector-mincut-gated-transformer`/`-wasm` · `ruvector-attn-mincut` (subpolynomial dynamic min-cut) · `ruvector-mincut-brain-node` · `ruvector-coherence` (coherence proxies) · `ruvector-consciousness`/`-wasm` (IIT Φ, causal emergence)

### Solvers & math
`ruvector-solver`/`-node`/`-wasm` (7 sublinear algorithms + an auto-router) · `ruvector-math`/`-wasm` (optimal transport, information geometry, product manifolds)

### Self-learning & LLM
`sona` (two-tier LoRA + EWC++ + ReasoningBank) · `ruvector-nervous-system`/`-wasm` (spiking nets, BTSP) · `ruvllm`/`-cli`/`-wasm` (LLM serving; paged attention, KV cache) · `ruvllm_sparse_attention` (O(N log N) kernel, ADR-183–192: ESP32 no-std + Pi Zero 2 W hardening) · `ruvllm_retrieval_diffusion` · `prime-radiant` — **the universal coherence engine**: sheaf cohomology (H⁰/H¹, sheaf Laplacian), immutable Blake3 witness chains with multi-party approval, 256-tile WASM gate fabric, neural gating — the hallucination/contradiction firewall, *not* an LLM server (an earlier draft mislabeled it; corrected via catalog audit)

### Sparse & efficient inference
`ruvector-sparse-inference`/`-wasm` (PowerInfer-style) · `ruvector-sparsifier`/`-wasm` (spectral sparsification, 48 tests)

### Hardware acceleration
`hailort-sys` + `ruvector-hailo` + `ruvector-hailo-cluster` (Hailo-8 NPU on Pi 5, ADR-167/178) · `ruvector-fpga-transformer`/`-wasm` · `ruvector-tiny-dancer-core`/`-node`/`-wasm` (ultra-low-latency routing) · **`ruvector-mmwave`** (parser for Seeed MR60BHA2 + HLK-LD2410 radar UART — directly relevant to the Cognitum sensor array)

### Distributed systems
`ruvector-collections` · `ruvector-cluster` · `ruvector-raft` · `ruvector-replication` · `ruvector-router-core`/`-cli`/`-ffi`/`-wasm` (FastGRNN agent routing) · `ruvector-rulake` (federation over heterogeneous backends, ADR-155) · delta family: `ruvector-delta-core`/`-index`/`-wasm`/`-graph`/`-consensus` (CRDT behavioral change tracking)

### Verification & storage
`ruvector-verified`/`-wasm` (proof-carrying ops via lean-agentic dependent types) · `ruvector-snapshot` · `ruvector-postgres` (excluded; pgrx) · `rvf` family (24 crate dirs: **18 top-level `rvf-*`** + 6 adapters under `rvf-adapters/` — claude-flow, agentdb, ospipe, agentic-flow, rvlite, sona — separate sub-workspace; 26 `Cargo.toml` counting workspace roots) · `rvlite` (standalone SQL/SPARQL/Cypher vector DB) · `rvm` (coherence-native microhypervisor)

### RuVix cognition kernel (22 crates, ADR-087)
Bare-metal AArch64 microkernel: `ruvix-types/-region/-physmem/-queue/-cap/-sched/-proof/-hal/-aarch64/-boot/-rpi-boot/-drivers/-dma/-dtb/-smp/-bcm2711/-fs/-net/-nucleus/-vecgraph/-shell/-cli` — seL4-inspired capabilities, coherence-aware scheduler, Pi 4/5 SoC drivers.

### rvAgent framework (10 crates)
`rvagent-core/-middleware/-backends/-acp/-a2a/-tools/-subagents/-mcp/-cli/-wasm` — typed agent state, MCP integration, Agent2Agent protocol (ADR-159), terminal TUI agent.

### Specialized domains
Quantum: `ruqu-core/-algorithms/-wasm/-exotic`, `ruQu` (VQE, Grover, QAOA, surface codes) · Trading: `neural-trader-core/-coherence/-replay/-strategies/-wasm`, `ruvector-kalshi` · Robotics: `ruvector-robotics`, `agentic-robotics-*` (6 crates) · `ruvector-crv` (Coordinate Remote Viewing protocol mapping) · `ruvector-dither` · `ruvector-temporal-tensor`/`-wasm` · `ruvector-domain-expansion`/`-wasm` · `ruvector-decompiler`/`-wasm` (JS bundle decompiler via min-cut) · `thermorust` (thermodynamic neural motifs) · `ruvector-perception` (delta→boundary→coherence→proof→action substrate, ADR-198) · `ruvector-exotic-wasm` · `ruvector-economy-wasm` · `ruvector-learning-wasm` · `ruvector-cnn` (image embeddings) · `mcp-brain`/`mcp-brain-server` (shared brain at pi.ruv.io) · `cognitum-gate-kernel`/`-tilezero`/`mcp-gate` (256-tile anytime-valid coherence gate) · `ruvector-bench`/`-profiler` · `ruvector-cli`/`-server`

### npm (55+ packages under `@ruvector/*`)
Core: `ruvector`, `@ruvector/gnn`, `@ruvector/graph`, `@ruvector/attention`, `@ruvector/mincut`, `@ruvector/solver`, `@ruvector/sona`, `@ruvector/ruvllm`, `@ruvector/rvf*`, `@ruvector/router`, `@ruvector/tiny-dancer`, `@ruvector/cnn`, `@ruvector/consciousness`, `@ruvector/pi-brain`, `@ruvector/rvagent-*`, `@ruvector/rvdna`, `@ruvector/ruqu-wasm` + platform-specific prebuilt binaries for all major OS/arch combos. (verified on-disk names; some packages named in older docs — @ruvector/graph, @ruvector/mincut, @ruvector/consciousness, @ruvector/sona-wasm, @ruvector/rvagent-* — have no package.json in this checkout; verify on npmjs.com before installing)

### UI
`ruvocal` — SvelteKit chat UI (v0.20.0, package name chat-ui) with MCP bridge and model management.

---

## 4. ADR index — the complete table (208 main-series files in `docs/adr/`, + 54 in 4 sub-series dirs)

**Counts, verified June 13 against the submodule:** `docs/adr/` holds **208** loose `.md` files (the main numbered series tabled below) **plus 4 sub-series directories** totalling **54** files (coherence-engine 22, quantum-engine 15, delta-behavior 11, temporal-tensor-store 6) — so `find ruvector/docs/adr -name '*.md' | wc -l` = **262**. If instead you count *every* `adr`-pathed `.md` anywhere in the repo (`find ruvector -path '*adr*' -name '*.md'`), you get **340** — that adds ADRs that live next to specific components (ruvbot 15, the `dna` example 15, sublinear-time-solver 12, vibecast-7sense 9, ruvector-mincut 7, ruvocal UI 6, prime-radiant 6, delta-behavior example 4, and a handful of singletons). The table below is the canonical `docs/adr/` main series. Decision records live in `docs/adr/`. Every main-series record:

| # | Title | Status |
|---|-------|--------|
| 1 | Ruvector Core Architecture | Proposed |
| 2 | RuvLLM Integration with Ruvector | Proposed |
| 3 | SIMD Optimization Strategy for Ruvector and RuvLLM | Proposed |
| 4 | KV Cache Management Strategy for RuvLLM | Proposed |
| 5 | WASM Runtime Integration | Proposed |
| 6 | Unified Memory Pool and Paging Strategy | Proposed |
| 7 | Security Review & Technical Debt Remediation | Proposed |
| 8 | mistral-rs Integration for Production-Scale LLM Serving | Proposed |
| 9 | Structured Output / JSON Mode for Reliable Agentic Workflows | Proposed |
| 10 | Function Calling / Tool Use in RuvLLM | Proposed |
| 11 | Prefix Caching for 10x Faster RAG and Chat Applications | Proposed |
| 12 | Security Remediation and Hardening | Proposed |
| 13 | HuggingFace Model Publishing Strategy | Proposed |
| 14 | Coherence Engine Architecture | Proposed |
| 15 | Coherence-Gated Transformer (Sheaf Attention) | Proposed |
| 16 | Delta-Behavior System — Domain-Driven Design Architecture | Proposed |
| 17 | Temporal Tensor Compression with Tiered Quantization | Proposed |
| 24 | Craftsman Ultra 30b 1bit — BitNet Integration with RuvLLM | Proposed |
| 25 | EXO-AI Multi-Paradigm Integration Architecture | Proposed |
| 26 | Vector-Native COW Branching (RVCOW) and Real Cognitive Containers | Proposed |
| 27 | Fix HNSW Index Segmentation Fault with Parameterized Queries | Proposed |
| 28 | eHealth Platform Architecture for 50M Patient Records | Proposed |
| 29 | RVF as Canonical Binary Format Across All RuVector Libraries | Accepted |
| 30 | RVF Cognitive Container — Self-Booting Vector Files | Proposed |
| 31 | RVF Example Repository — 24 Demonstrations Across Four Categories | Accepted |
| 32 | RVF WASM Integration into npx ruvector and rvlite | Accepted |
| 33 | Progressive Indexing Hardening — Centroid Stability, Adversarial Resilience, Recall Framing, Mandatory Signatures | Accepted |
| 34 | QR Cognitive Seed — A World Inside a World | Implemented |
| 35 | Capability Report — Witness Bundles, Scorecards, and Governance | Implemented |
| 36 | RuVector AGI Cognitive Container with Claude Code Orchestration | Partial |
| 37 | Publishable RVF Acceptance Test | Proposed |
| 38 | npx ruvector & rvlite Witness Verification Integration | Proposed |
| 39 | RVF Solver WASM — Self-Learning AGI Engine Integration | Proposed |
| 40 | Causal Atlas RVF Runtime — Planet Detection & Life Candidate Scoring | Proposed |
| 40a | Causal Atlas Dashboard Specification | Proposed |
| 40b | Microlensing Detection & Cross-Domain Graph-Cut Extensions | Proposed |
| 42 | Security RVF — AIDefence + TEE Hardened Cognitive Container | Proposed |
| 43 | External Intelligence Providers for SONA Learning | Proposed |
| 44 | ruvector-postgres v0.3 Extension Upgrade | Proposed |
| 45 | Lean-Agentic Integration — Formal Verification & AI-Native Type Theory | Proposed |
| 46 | Graph Transformer Unified Architecture | Proposed |
| 47 | Proof-Gated Mutation Protocol | Proposed |
| 48 | Sublinear Graph Attention | Proposed |
| 49 | Verified Training Pipeline | Proposed |
| 50 | Graph Transformer WASM and Node.js Bindings | Proposed |
| 51 | Physics-Informed Graph Transformer Layers | Proposed |
| 52 | Biological Graph Transformer Layers | Proposed |
| 53 | Temporal and Causal Graph Transformer Layers | Proposed |
| 54 | Economic Graph Transformer Layers | Proposed |
| 55 | Manifold-Aware Graph Transformer Layers | Proposed |
| 56 | RVF Knowledge Export for Developer Onboarding | Accepted |
| 57 | Federated RVF Format for Real-Time Transfer Learning | Proposed |
| 58 | RVF Hash Security Hardening and Optimization | Accepted |
| 59 | Shared Brain — Google Cloud Deployment | Accepted |
| 60 | Shared Brain Capabilities — Federated MicroLoRA Intelligence Substrate | Accepted |
| 61 | Reasoning Kernel Architecture — Brain-Augmented Targeted Reasoning | Accepted |
| 62 | Brainpedia — Structured Knowledge Encyclopedia with Delta-Based Editing | Accepted |
| 63 | WASM Executable Nodes — Deterministic Compute at the Edge | Accepted |
| 64 | Pi Brain Infrastructure & Landing Page | Accepted |
| 65 | npm Publishing Strategy | Accepted |
| 66 | SSE MCP Transport | Accepted |
| 67 | MCP Gate Permit System | Accepted |
| 68 | Domain Expansion Transfer Learning | Accepted |
| 69 | Edge-Net and Pi Brain Integration — Distributed Compute Intelligence | Proposed |
| 70 | npx ruvector Unified Integration | Proposed |
| 71 | npx ruvector Ecosystem Gap Analysis | Proposed |
| 72 | RVF Example Management and Downloads in npx ruvector | Proposed |
| 73 | π.ruv.io Platform Security Audit & Optimization | Accepted |
| 74 | RuvLLM Neural Embedding Integration | Proposed |
| 75 | Wire Full RVF AGI Stack into mcp-brain-server | Implemented |
| 76 | AGI Capability Wiring Architecture | Implemented |
| 77 | Midstream Platform Integration into mcp-brain-server | Proposed |
| 78 | npx ruvector Midstream & Brain AGI Integration | Proposed |
| 79 | SQL Audit Script Hardening & Bug Fixes | Proposed |
| 80 | npx ruvector Deep Capability Audit | Proposed |
| 81 | Brain Server v0.2.8–0.2.10 Deploy + CLI/MCP Bug Fixes | Accepted |
| 82 | Brain Server Security Hardening — PII, Rate Limiting, Anti-Sybil | Accepted |
| 83 | Brain Server Training Loops — Closing the Store→Learn Gap | Accepted |
| 84 | ruvllm-wasm — First Functional npm Publish | Accepted |
| 85 | RuVector Neural Trader — Dynamic Market Graphs, MinCut Coherence Gating, Proof-Gated Mutation | Proposed |
| 86 | Neural Trader WASM Bindings | Proposed |
| 87 | RuVix Cognition Kernel — An Operating System for the Agentic Age | Proposed |
| 88 | CNN Contrastive Learning Integration for RuVector | Proposed |
| 89 | CNN Browser Demo for GitHub Pages | Proposed |
| 90 | Ultra-Low-Bit QAT & Pi-Quantization — DDD Architecture | Accepted |
| 90b | Ultra-Low-Bit QAT & Pi-Quantization — Implementation Checklist | Ready for Implementation (Staged) |
| 91 | INT8 CNN Quantization — DDD Architecture | Ready for Implementation |
| 91b | INT8 CNN Quantization — Implementation Checklist | Ready for Implementation |
| 92 | MoE Memory-Aware Routing — DDD Architecture | Accepted |
| 93 | Daily Discovery & Brain Training Program | Accepted |
| 93b | DeepAgents Complete Rust Conversion — Overview | Proposed |
| 94 | π.ruv.io Shared Web Memory on RuVector | Accepted |
| 94b | DeepAgents Backend Protocol & Trait System | Accepted |
| 95 | π.ruv.io API v2 — Full Capability Surface | Accepted |
| 95b | DeepAgents Middleware Pipeline Architecture | Accepted |
| 96 | Cloud-Native Data Pipeline, Real-Time Injection & Automated Optimization | Accepted |
| 96b | DeepAgents Tool System — Filesystem, Execute, Grep, Glob | Accepted |
| 97 | SubAgent & Task Orchestration | Proposed |
| 98 | Memory, Skills & Summarization Middleware | Proposed |
| 99 | CLI & ACP Server Conversion | Proposed |
| 100 | RVF Integration & Crate Structure | Proposed |
| 101 | Testing Strategy & Fidelity Verification | Proposed |
| 102 | Implementation Roadmap & Phasing | Proposed |
| 103 | Review Amendments — Performance, RVF Integration & Security Hardening | Proposed |
| 104 | rvAgent MCP Tools/Resources, Enhanced Skills, Topology-Aware Deployment | Proposed |
| 105 | rvAgent MCP Tools and Resources System | Proposed |
| 106 | RuVix Kernel Integration with RVF | Proposed |
| 107 | rvAgent Native Swarm Orchestration with WASM Integration | Proposed |
| 108 | rvAgent–ruvbot Integration Architecture | Proposed |
| 109 | Backup and Disaster Recovery Strategy | Accepted |
| 110 | Neural-Symbolic Integration with Internal Voice | Proposed |
| 111 | Ruvocal UI Integration with rvAgent | Proposed |
| 112 | rvAgent MCP Server with SSE and stdio Transports | Proposed |
| 113 | RVF App Gallery and Ruvix-Powered Applications | Proposed |
| 114 | Ruvector-Core Hash Placeholder Embeddings | Accepted |
| 115 | Common Crawl Integration with Semantic Compression | Phase 1 Implemented |
| 116 | Spectral Graph Sparsifier Integration with pi.ruv.io | Accepted |
| 117 | Pseudo-Deterministic Canonical Minimum Cut | Shipped (all 3 tiers) |
| 117b | DrAgnes Dermatology Intelligence Platform | Proposed |
| 118 | Cost-Effective Common Crawl Strategy with Sparsifier-Aware Guardrails | Proposed |
| 119 | Historical Common Crawl Evolutionary Comparison | Accepted |
| 120 | WET Processing Pipeline for Medical + CS Corpus Import | Proposed |
| 121 | Gemini Google Search Grounding for Brain Optimizer | Implemented |
| 122 | rvAgent Autonomous Gemini Grounding Agents | Approved |
| 123 | Pi Brain Cognitive Enrichment | Proposed |
| 124 | Dynamic MinCut with Partition Cache | Proposed |
| 125 | Resend Email Integration for Pi Brain Notifications | Proposed |
| 126 | Google Chat Bot for Pi Brain Interaction | Proposed |
| 127 | Gist Deep Research Loop — Brain-Guided Discovery Publishing | Proposed |
| 128 | SOTA Gap Implementations — Hybrid Search, MLA, KV-Cache, SSM, Graph RAG | Accepted |
| 129 | RuvLTRA Model Training & TurboQuant Optimization on Google Cloud | Proposed |
| 130 | MCP SSE Decoupling via Midstream Queue Architecture | Proposed |
| 131 | Consciousness Metrics Crate — IIT 4.0 Φ, CES, ΦID, PID, Streaming, Bounds | Accepted |
| 132 | RVM Hypervisor Core — Standalone Coherence-Native Microhypervisor | Proposed |
| 132b | E2E Browser Testing with @claude-flow/browser | Proposed |
| 133 | Partition Object Model | Proposed |
| 133b | Claude Code CLI Source Code Analysis | Deployed (2026-04-02) |
| 134 | RuVector Deep Integration with Claude Code CLI | Proposed |
| 134b | Witness Schema and Log Format | Proposed |
| 135 | MinCut Decompiler with RVF Witness Chains | Proposed |
| 135b | Proof Verifier Design — Three-Layer Verification for Capability-Gated Mutation | Proposed |
| 136 | Memory Hierarchy and Reconstruction — Four-Tier Coherence-Driven Memory Model | Proposed |
| 136b | GPU-Trained Deobfuscation Model | Deployed (2026-04-03) |
| 137 | Bare-Metal Boot Sequence | Proposed |
| 137b | npm Decompiler CLI and MCP Tools | Proposed |
| 138 | LLM Model Weight Decompiler | Proposed |
| 138b | Seed Hardware Bring-Up | Proposed |
| 139 | Appliance Deployment Model — Edge Hub with Coherence-Native Control | Proposed |
| 139b | RVAgent Optimization Using Decompiled Claude Code Intelligence | Proposed |
| 140 | Agent Runtime Adapter — WASM Agents in Coherence Domains | Proposed |
| 141 | Coherence Engine — Kernel Integration and Runtime Pipeline | Accepted |
| 142 | TEE-Backed Cryptographic Verification for the RVM Hypervisor | Accepted |
| 143 | HEARmusica — High-Fidelity Rust Port of Tympan Open-Source Hearing Aid | Proposed |
| 143b | Implement Missing Capabilities in ruvector | Proposed |
| 144 | DiskANN/Vamana Implementation | Proposed |
| 144b | Monorepo Quality Analysis Strategy and Test Plan | Accepted |
| 144c | Candle-Whisper Integration with Musica for Pure-Rust Transcription | Accepted |
| 145 | WASM/NAPI Training Pipeline Fixes | Accepted |
| 146 | DiskANN/Vamana Implementation | Proposed |
| 147 | Stacked KV Cache Compression: TriAttention + TurboQuant Pipeline | Proposed |
| 148 | Brain Hypothesis Engine — Self-Improving Knowledge with Gemini, DiskANN, Auto-Experimentation | Proposed |
| 149 | Brain Performance Optimizations — SIMD Search, Batch Graph, Incremental LoRA, Quality Gating | Proposed |
| 150 | π Brain + RuvLtra via Tailscale — Semantic Embedding Upgrade | Proposed |
| 151 | Miller-Rabin–Driven Prime Optimizations (PIAL) | Proposed |
| 153 | Kalshi Integration via RuVector Neural Trader | Proposed |
| 154 | RaBitQ — Rotation-Based 1-Bit Quantization for ANNS | Proposed |
| 155 | ruLake — Vector-Native Federation Intermediary on RVF | Accepted (M1) |
| 156 | ruLake as Memory Substrate for Agent Brain Systems | Proposed |
| 157 | Optional Accelerator Plane — `VectorKernel` Trait + Dispatch | Proposed |
| 158 | Optional Rotation Kind (Haar vs Randomized Hadamard) and QVCache Positioning | Proposed |
| 159 | A2A (Agent-to-Agent) Protocol Support for rvAgent | Proposed |
| 160 | ACORN — Predicate-Agnostic Filtered HNSW for ruvector | Proposed |
| 161 | Publish `ruvector-rabitq-wasm` as `@ruvector/rabitq-wasm` on npm | Proposed |
| 162 | Add `ruvector-acorn-wasm` crate, publish as `@ruvector/acorn-wasm` | Proposed |
| 165 | Tiny RuvLLM Agents on Heterogeneous ESP32 SoCs | Proposed |
| 166 | ESP32 Rust Cross-Compile + Bring-Up Operations Manual | Proposed |
| 167 | Ruvector Hailo NPU Embedding Backend | Proposed |
| 168 | Ruvector Hailo Cluster CLI Surface | Proposed |
| 169 | Ruvector Hailo Cluster Cache Architecture | Proposed |
| 170 | Ruvector Hailo Cluster Tracing Correlation | Proposed |
| 171 | RuOS Brain RuView Pi5 Edge Node | Proposed |
| 172 | Ruvector Hailo Security Review | Proposed |
| 173 | RuvLLM Hailo Edge LLM | Proposed |
| 174 | RuOS Thermal Overclock Pi5 | Proposed |
| 175 | Hailo Rust Side Workarounds | Proposed |
| 176 | HEF Integration Epic | Proposed |
| 177 | Pi4 No-HAT Deploy | Proposed |
| 178 | RuVector RuView Hailo Integration Gap Analysis | Proposed |
| 179 | RuvLLM Pi Cluster Deployment | Proposed |
| 180 | RuvLLM Serving Engine Continuous Batching | Proposed |
| 181 | RuvLLM Pi Quant BitNet Integration | Proposed |
| 182 | Hailo-10 Cluster Migration | Proposed |
| 183 | Sparse Attention Rand Dev Dependency | Accepted |
| 184 | Sparse Attention Online Softmax | Accepted |
| 185 | Sparse Attention Noncausal Landmark Fix | Accepted |
| 186 | Sparse Attention Edge Case Tests | Accepted |
| 187 | Tensor Zeros Overflow Check | Accepted |
| 188 | Sparse Attention Stamp Scheme Comment | Accepted |
| 189 | Sparse Attention KV Cache Incremental Decode | Accepted |
| 190 | Sparse Attention GQA/MQA Support | Accepted |
| 191 | Sparse Attention Pi Zero 2W Production Hardening | Proposed |
| 192 | Sparse Attention No-Std ESP32 Support | Accepted |
| 193 | RAIRS IVF | Accepted |
| 194 | RuVector ONNX Embedder API and Throughput | Accepted |
| 195 | RuVector Embedder Unification Plan | Proposed |
| 196 | Structure-Preserving Graph Condensation | Accepted |
| 197 | Differentiable Min-Cut Condensation Loss | Accepted |
| 198 | Physical Perception Substrate | Accepted |

(Numbers 18–23 belong to the Temporal-Tensor Store sub-series below; 41, 152, 163–164 were not present as files in this checkout. Suffixed entries like 93b are this primer's disambiguation of files sharing a bare number; on disk only 040a/040b carry suffixes.)

**Sub-series:**
- **Coherence Engine, ADR-CE-001…022** (all Proposed): Sheaf Laplacian Coherence · Incremental Computation · Hybrid Storage · Signed Event Log · Governance Objects · Compute Ladder · Threshold Autotuning · Multi-Tenant Isolation · Single Coherence Object · Domain-Agnostic Substrate · Residual Contradiction Energy · Gate Refusal Witness · NOT Prediction · Reflex Lane Default · Adapt Without Losing Control · RuvLLM Coherence Validator · Unified Audit Trail · Pattern Restriction Bridge · Memory as Nodes · Confidence from Energy · Shared SONA · Failure Learning
- **Delta-Behavior, ADR-DB-001…010** (all Proposed): Core Architecture · Encoding Format · Propagation Protocol · Conflict Resolution · Index Updates · Compression Strategy · Temporal Windows · WASM Integration · Observability · Security Model
- **Quantum Engine, ADR-QE-001…015** (all Proposed): Core Architecture · Crate Structure · WASM Compilation · Performance Benchmarks · VQE · Grover · QAOA MaxCut · Surface Code Error Correction · Tensor Networks · Observability · Memory Gating/Power · MinCut Coherence Integration · Deutsch Theorem Proof Verification · Exotic Discoveries · Blockchain Forensics Instrument
- **Temporal-Tensor Store, ADR-TTS-018…023** (all Proposed): Block-Based Storage Engine · Tiered Quantization Formats · Temporal Scoring Tier Migration · Delta Compression Reconstruction · WASM API Cross-Platform · Benchmarking Acceptance Criteria

---

## 5. Docs, tutorials, examples, skills

### Key documentation (in `docs/`)
- `guides/GETTING_STARTED.md`, `BASIC_TUTORIAL.md`, `INSTALLATION.md`, `AGENTICDB_QUICKSTART.md`, `OPTIMIZATION_QUICK_START.md`, `ADVANCED_FEATURES.md`, `wasm-api.md`, `wasm-build-guide.md`
- `api/RUST_API.md`, `api/NODEJS_API.md`, `api/CYPHER_REFERENCE.md`
- `cloud-architecture/` (architecture overview, infra design, scaling, deployment, perf tuning)
- Specialized: `gnn/`, `hnsw/`, `postgres/`, `ruvllm/`, `sparse-inference/`, `training/`, `cnn/`, `nervous-system/`
- `security/` (full audit, session encryption, sandbox path restriction, ZK audit)
- `publishing/` (npm/crates.io guides + checklists)

### Examples (20+ runnable, in `examples/`)
Edge AI (`edge/`, `edge-full/`, `edge-net/` — Pi cluster + dashboard), genomics (`dna/`), dermatology (`dragnes/`), market prediction (`neural-trader/`), ruvbot (`npm/packages/ruvbot` — self-learning AI assistant), personal AI memory (`OSpipe/`), agent swarms (`a2a-swarm/`, `agentic-jujutsu/`), **`esp32-mmwave-sensor/`** (radar on ESP32 — directly relevant to this sensor array), scientific discovery series (climate/CMB/earthquake/gene/FRB “consciousness” boundary-discovery demos), `google-cloud/`, `decompiler-dashboard/`. Pattern: `cd examples/<name> && npm install && npm start` (each has its own README).

### Claude Code integration shipped in-repo (`.claude/`)
60+ agent types (coder, reviewer, security-architect, memory-specialist, hierarchical/mesh/adaptive coordinators, pr-manager…), 20+ skills (agentdb-* family, flow-nexus-*, github-* automation, hive-mind-advanced, hooks-automation, performance-analysis), claude-flow v3 config (hierarchical-mesh, 15 max agents, hybrid memory + HNSW, pi.ruv.io brain integration, nightly LoRA auto-training), full hooks system (pre/post tool use, session persistence, daemon workers: audit/optimize/consolidate/testgaps/ultralearn/deepdive).

### Install / quickstart (verbatim)
```bash
npx ruvector                 # interactive everything-installer
# or:
curl -fsSL https://raw.githubusercontent.com/ruvnet/ruvector/main/install.sh | bash
# Rust à la carte:
cargo add ruvector-core ruvector-gnn ruvector-attention sona
# Node:
npm install ruvector @ruvector/sona @ruvector/rvf
```

---

## 6. Performance claims (claimed, NOT independently verified)

| Claim | Value | Where claimed |
|---|---|---|
| Vector search p50 | 61 µs | README comparison table |
| GNN re-rank overhead | <1 ms | README |
| Recall gain @100K queries | +12.4% | README GNN deep dive |
| RVF microservice boot | 125 ms | README / RVF README |
| SONA adaptation | <1 ms | SONA README |
| DiskANN billion-scale | <10 ms | README |
| Temporal tensor compression | 4–10× | crate README |
| Min-cut update scaling | n^0.12 (tested 100–1600 vertices) | ruvector-mincut README |
| Hybrid (RRF) retrieval gain | 20–49% | README |
| Graph RAG gain | 30–60% | README |
| TurboQuant KV-cache savings | 6–8× | README |
| π-Quantization | 16× memory, 10 GB/s dequant | README (ADR-090) |
| MoE routing | 70%+ cache hit, <10 µs | README (ADR-092) |
| CNN inference | <5 ms | README |
| Hailo-8 NPU embeddings | 9.6× (7→67 req/s) | CHANGELOG (hailo-backend) |
| RVF tests | 1,156 passing | RVF docs |

Caveats: measured on specific hardware (Apple M4 Pro / M2 / i7); min-cut subpolynomial guarantee applies only to superpolylogarithmic cut sizes; GNN gains assume HNSW-neighborhood locality; none re-run for this primer.

---

## 7. How the ecosystem consumes RuVector

| Consumer | What it uses |
|---|---|
| **RuView** (WiFi-CSI human sensing, ex-wifi-densepose) | `ruvector-mincut` (coherence gating), `ruvector-attention` + `ruvector-attn-mincut` (fusion attention), `ruvector-solver` (spectral), `ruvector-temporal-tensor` (CSI stream compression) — pinned at RuVector v2.0.4 per RuView's CLAUDE.md |
| **Cognitum Seed** (Pi Zero 2 W appliance) | RVF vector store + witness chains for the 8-dim sensing feature pipeline (RuView ADR-069); SONA; ruvllm on-device |
| **Cognitum V0** (Pi 5 + Hailo-8) | Hailo NPU embedding backend (ADR-167+), RuView Pi5 edge node (ADR-171), thermal supervisor (ADR-174) |
| **ruFlo / claude-flow v3** | HNSW agent memory (claimed 150×–12,500× pattern retrieval), SONA routing, 175+ MCP tools |
| **AgentDB** | RuVector HNSW + GNN for persistent agent memory |
| **Agentic-Flow v2** | SONA, Flash Attention NAPI, GNN query refinement |
| **pi.ruv.io shared brain** | `mcp-brain` / `micro-hnsw-wasm` / federated MicroLoRA (ADR-59/60) |

---

## 8. Maturity & gotchas

- **License** MIT · **MSRV** 1.77 (RVF: 1.87) · **edition** 2021 · workspace v2.2.3.
- Tags through **v2.2.0**; latest GitHub Release object **rvagent-wasm-v0.2.0** (2026-05-28); `main` iterates daily far ahead of tags (commit cadence is multiple/day).
- Test counts as stated: solver 177, attention 142, sparsifier 49, RVF 1,156 — no aggregate workspace count published.
- `ruvector-postgres` is **excluded from the default workspace** — needs `cargo install cargo-pgrx --version 0.12.9 && cargo pgrx init`, then `cargo build -p ruvector-postgres`.
- Hailo NPU support is opt-in (`--features hailo`, requires Hailo toolchain on Pi 5); `ruos-thermal` is standalone/WIP.
- Performance claims are hardware-specific; verify before scale.
- WASM bundle grows with features — tree-shake; core ≈58 KB, minimal runtime claim 5.5 KB.
- Pin crate versions in production: 2.x may break APIs between minors.
- HNSW core is production-grade but **not formally verified** (the graph-transformer's proof-gated mutations are the verified part).

## 8.5 Subtrees easy to miss (added after catalog audit)

- **Research library** — `docs/research/` holds **34 directories, 1,070 files (278 markdown)** (latent-space 34, sublinear-time-solver 34, gnn-v2 46 incl. consciousness research, rvf 19, quantization-edge 11…). A whole knowledge layer beyond the rest of docs/.
- **71 example directories** (not "20+"): incl. `OSpipe` (ScreenPipe desktop-memory integration: PII SafetyGate, frame dedup, QAOA quantum search), `refrag-pipeline` (claimed 30× RAG speedup), `meta-cognition-spiking-neural-network`, `verified-applications` (10 apps), `prime-radiant` HoTT demos.
- **~97 named algorithms with production Rust implementations** — from FlashAttention-3, Mamba S5 and Sinkhorn to Gomory-Hu trees, Kuramoto oscillators, BTSP one-shot plasticity, Surface-Code QEC, Kyber/Dilithium PQC and tropical Floyd-Warshall. If a textbook algorithm is relevant to your task, grep before reimplementing.
- Also unmentioned in most summaries: crates/ruvector-cognitive-container (verifiable WASM cognitive container with witness chains), the boundary-discovery/consciousness example series (~16 dirs incl. real-eeg-analysis and seizure-prediction work), top-level scripts/ (49 scripts), tests/ (incl. sandbox_security_tests), three separate benchmark trees, and docs/ subtrees: hailo/ (Cognitum V0-relevant), dag/, sdk/, implementation/, analysis/.
- **Scope boundary (what RuVector does NOT do):** content generation, end-user app frameworks, general web dev, DB admin GUIs, cloud hosting, and it is not a PyTorch replacement — it's the intelligent substrate those things sit on.

## 8.6 Mechanical completeness check (run at every regeneration)

A summary of 1.58M lines *will* drop things. Guard against silent subtree loss mechanically, not by trust:

```bash
# Numbers below were the live values on 2026-06-13 @ commit 4dedde8.
# Any drift = regenerate the affected section.
ls ruvector/crates | wc -l                          # 139  (top-level crate dirs)
ls ruvector/docs/adr | wc -l                         # 212  (208 main-series .md + 4 sub-series dirs)
find ruvector/docs/adr -name '*.md' | wc -l          # 262  (208 main + 54 across the 4 sub-series)
find ruvector -path '*adr*' -name '*.md' | wc -l     # 340  (the above + component-local ADRs)
find ruvector -name Cargo.toml -not -path '*/target/*' -not -path '*/node_modules/*' | wc -l  # 314
ls ruvector/examples | wc -l                         # 74
ls ruvector/docs/research | wc -l                    # 35
ls ruvector/npm/packages | wc -l                     # 59
```

Diff these against the numbers in this primer; any growth = regenerate the affected section. Per-domain confidence: capabilities/install commands HIGH (read from code) · ADR statuses MEDIUM (headers only) · performance numbers CLAIMED-ONLY · research-library contents LOW (enumerated, not read).

## 8.7 The ruvector RVF knowledge base — what's in it and how to use it

This primer is a curated summary; **summaries drop things.** The companion `ruvector-kb.rvf` is the uncurated backstop — a queryable **semantic index of the entire ruvector repo at the same pinned SHA (`4dedde8`)**. It is *not* just an example of the RVF file format; it is a working search index you query in plain English and get back **real file paths + the actual source text**, which is the single best defence against an LLM hallucinating ruvector internals.

**What it is (verified against `kb/.last-built.json` and the files on disk):**

| | |
|---|---|
| File | `kb/ruvector-kb.rvf` (~25 MB) |
| Chunks (vectors) | **14,052** (one chunk ≈ 1,000 tokens / ~4,000 chars, paragraph-aligned) |
| Embedding | `Xenova/all-MiniLM-L6-v2` · **384-dim** · **cosine** · computed **locally** (no cloud) |
| Built from | `github.com/ruvnet/ruvector` @ `4dedde8` — the same SHA this primer is pinned to |

**What it covers:** the whole knowledge layer plus the source's self-description — **every ADR**, every doc and research paper, each crate's `Cargo.toml` manifest + lead source file + module inventory, every `//!` doc comment, tutorials, scripts, and `.claude/` skills — **plus full-body source for high-value engines** (e.g. rvlite's SQL/SPARQL paths and ruvector-postgres's graph code). It does **not** index every line of every function body — ask "*where* is X / *which* crate does Y" and it nails it; it won't recite line 400 of a 2,000-line file.

**Two-part design (keep the files together):** the `.rvf` stores only vectors + the HNSW index and returns `{id, distance}`. The readable text lives in the **`ruvector-kb.passages.jsonl`** sidecar (one `{id, text, path, title}` per line, **14,052 lines** — matches the vector count). A search embeds your query → asks the `.rvf` for nearest ids → **joins those ids to the full passage text** in the `.jsonl`. Without the sidecar you get numbers, not text. (`ruvector-kb.ids.json` adds id→metadata; `*.rvf.idmap.json` is the store's internal id↔label map — auto-managed, don't delete.)

**How to use it (three working ways — mirrors `kb/README.md`):**

```bash
# one-time setup
cd kb && npm i        # installs @ruvector/rvf + @xenova/transformers locally; MiniLM (~25 MB) caches on first query, then fully offline
```

1. **CLI** — `node kb/ask-kb.mjs ruvector "your question" 5` (prints each hit's path, title, distance, and full passage text).
2. **MCP server in Claude Code** — point a `.mcp.json` server entry at the bundled **`kb/kb-mcp-server.mjs`** (one server serves both stores); the tool is `search_kb({ query, store: "ruvector", k })` and it returns full passage text. After wiring, `/mcp` should show the server connected.
3. **From Node** — `import { searchKb } from './kb/ask-kb.mjs'` then `await searchKb({ store: 'ruvector', query: '…', k: 5 })`; each hit is `{ id, distance, path, title, text }`.

> ⚠️ **Do NOT use `@ruvector/rvf-mcp-server`** for this. That published package is a **non-functional stub** — it never reads a prebuilt `.rvf` and returns no passage text. Use the bundled `kb/kb-mcp-server.mjs`. (This is the canonical guidance in `kb/README.md`; an earlier version of this primer pointed at the stub — that was wrong.)

**Honest limit:** query quality is bounded by MiniLM-L6 — excellent for locating things, not a reasoning engine. Rebuild from a fresh checkout with `node kb/.build-ruvector-kb/build.mjs` then `node kb/guard-check.mjs` (which must pass before you trust a rebuild).

## 9. What this primer did NOT verify

- No benchmark was re-run; all numbers are repo-claimed.
- crates.io/npm publish state of every package was not individually confirmed (the repo's publishing docs and binaries were taken at face value).
- The bootable-kernel RVF demo, quantum sims, and brain-server cloud endpoints were not executed.
- Crate-count ambiguity (138 crate dirs / 181 root workspace members / nested sub-workspaces) reflects different counting boundaries, all documented above.
- A mechanical verification pass (2026-06-12) corrected: ADR count 198→208 files, rvf 13→23 crates, examples 44→71, research counts, two fabricated API snippets, npm package names, 16 ADR statuses.
- A second pass (**2026-06-13**, against the working submodule + the shipped KB) further corrected: rvf crate count 23/17-top-level → **24 dirs / 18 top-level** (new `rvf-ebpf`/`-federation`/`-import`/`-kernel`/`-launch`/`-manifest`/`-quant`/`-server`/`-solver-wasm`/`-index`); the "expose to Claude" guidance, which wrongly recommended `@ruvector/rvf-mcp-server` — that package is a **stub**, replaced with the bundled `kb/kb-mcp-server.mjs` per `kb/README.md`; the workspace-members figure 181 → **183**; the diagram's vague "~114–170 crates" → the real **139 `crates/` dirs / ~183 members**; and added the ADR-count framing (208 main / 262 incl. sub-series / 340 repo-wide) and the new RVF-KB section (§8.7). Treat any unverified remainder with the same suspicion.

---

*Generated 2026-06-12, last verified 2026-06-13 by Claude (Opus 4.8) for the [Cognitum One Sensor Primer](https://cognitum-sensor-primer.vercel.app). Source commit `4dedde8` — the SHA the working submodule and the shipped `ruvector-kb.rvf` are both built from. Regeneration instructions are at the top of this file.*
