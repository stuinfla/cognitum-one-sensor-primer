# The RuView / WiFi-DensePose Primer

**A drop-in AI context document — drag this file into any project or AI chat and your assistant starts already knowing RuView's architecture, every crate, every API route, the wire protocol, the training pipelines, and where everything lives in the code.**

---

## About this document (read this first)

| | |
|---|---|
| **Generated** | June 12, 2026 · **last verified against the repo & shipped KB: June 13, 2026** |
| **Source (pinned)** | [github.com/ruvnet/RuView](https://github.com/ruvnet/RuView) — branch `main`, commit **`3d7530f0`**, `git describe` = **v1701**, committed **2026-06-12 09:09 EDT**. This is the exact SHA the working git submodule sits at **and** the SHA the shipped `ruview-kb.rvf` was built from (`kb/.last-built.json`, which records `describe: "v1701"`). `ruvnet/wifi-densepose` is the same repository — renamed; the old URL redirects. |
| **Method** | Originally written by three parallel research agents. **The June-13 pass re-checked every count against the working submodule (`find`/`ls`) and verified specific facts against the shipped semantic KB (`node kb/ask-kb.mjs ruview "…"`), which returns real file paths.** Counts confirmed: 160 ADR-numbered files (162 `.md` incl. README in `docs/adr/`; 168 if you count `adr`-pathed `.md` anywhere in the repo), 39 `v2/crates` dirs (41 `Cargo.toml` repo-wide), 90 scripts, 76 firmware C/H files. Nothing here is asserted from memory. |
| **Companion docs** | `ruvector-primer.md` (the engine underneath, same site) · the [Complete Walkthrough](https://cognitum-sensor-primer.vercel.app/guide) (beginner end-to-end) |

**Is this stale?** RuView ships multiple automated releases per day. Check:

```bash
git ls-remote https://github.com/ruvnet/RuView HEAD
```

If months have passed, regenerate: `git clone --depth 1 https://github.com/ruvnet/RuView`, then ask Claude Code:

> "Exhaustively sweep this checkout and produce a primer: (1) every crate in v2/crates with purpose and key modules, plus the RuvSense module table, (2) the complete REST/WebSocket/CLI surface from the sensing-server and wifi-densepose-cli sources, (3) the UDP wire protocol with all 0xC511 packet magics and byte layouts, (4) every ADR (number/title/status), all scripts, tutorials, firmware files and provision.py flags, (5) every capability graded works-today vs experimental vs stub with path:line citations, (6) hardware support matrix and the last 3 firmware releases."

**Honesty key used throughout:** ✅ works today (verified in code/witness logs) · ⚠️ experimental or partially implemented · ❌ stub/aspirational · 🔶 claimed in docs, not independently verified.

**What goes stale first** (regenerate-priority order): firmware release table → capability grades → hardware matrix → ADR statuses → crate list → wire protocol (most stable).

---

## 0. Executive summary (read this if you read nothing else)

RuView turns cheap ESP32 boards into through-wall human sensors: **presence, person count, breathing rate, heart rate, motion, falls work today**; skeletal pose is heuristic out of the box and needs training to be real; recognizing *named* individuals from WiFi alone does **not** work yet (measured, by the project itself). The Rust `sensing-server` (your laptop or a V0 appliance) does the perception; the Cognitum Seed stores tamper-evident history that AI assistants can query over MCP. The three commands that matter most: `wifi-densepose calibrate` (empty room, 60 s), `enroll` (8 guided poses, 4 min), `train-room` (6 per-room specialists, seconds). The two mistakes everyone makes: skipping calibration, and putting two listeners on UDP 5005.

**The architecture choice, settled:** sensors never stream raw CSI to the Seed — it's a Pi Zero and can't run perception. Raw CSI always goes to the sensing-server on a capable machine (laptop or V0). The actual choice is downstream: **network-only** = full live experience, zero history (the server keeps no database); **Seed-connected** = same live experience *plus* a permanent witness-chained 1 Hz record the owner (and AI assistants, over MCP) can query, *plus* the Seed's PIR/temp sensors as free training ground-truth. Start network-only to learn; add the Seed when you want memory. Decide the server's **stable reserved IP** early — every node bakes it into flash, and moving it means re-provisioning each node over USB.

## 0.1 Instant playbooks (task → exact steps)

**▶ "I just got a Cognitum One Seed and a batch of fresh ESP32-C6s — make them work."**
1. Demo first, no hardware: `docker run -p 3000:3000 -p 3001:3001 ruvnet/wifi-densepose:latest` → `curl localhost:3000/health` says `"ok"`.
2. Per board: flash C6 firmware (ESP-IDF 5.5.2 — 🔶 release-notes claim; the checkout's own firmware README still documents v5.4, verify before building: `cd firmware/esp32-csi-node && idf.py set-target esp32c6 && idf.py build && idf.py -p <PORT> flash`).
3. Per board: `python provision.py --port <PORT> --ssid "<2.4GHz-SSID>" --password "<pw>" --target-ip <server-IP> --node-id N --tdm-slot N-1 --tdm-total <count> --edge-tier 2` (unique `node-id` 1…N — it's the only identity a node has).
4. Restart server in hardware mode: `docker run --rm -e CSI_SOURCE=esp32 -p 3000:3000 -p 3001:3001 -p 5005:5005/udp ruvnet/wifi-densepose:latest`; confirm every node in `curl localhost:3000/api/v1/nodes`; Observatory badge flips DEMO→LIVE.
5. Train the room: leave it → `wifi-densepose calibrate --udp-port 5005 --duration-s 60 --output baseline.bin` → `enroll --room-id X` (follow the 8 prompts) → `train-room --enrollment ./enrollment.json --output ./room-bank.json` (all six specialists — breathing, heartbeat, restlessness, posture, presence, anomaly — always train; there is no flag to pick a subset) → `room-status --bank ./room-bank.json` shows ✓s.
6. Seed memory: pair over USB (`curl -sk -X POST https://169.254.42.1:8443/api/v1/pair/window` then `/pair` — **save the token, shown once**), re-provision nodes with `--target-port 5006 --target-ip <laptop-IP>`, run `python scripts/seed_csi_bridge.py --seed-url https://169.254.42.1:8443 --token "$SEED_TOKEN" --udp-port 5006 --batch-size 10 --validate`. Verify with `--stats`.

**▶ "Add node #8 to an existing array."** Flash + provision with the next free `node-id` and `--tdm-slot 7 --tdm-total 8`; re-provision the other seven's `--tdm-total` to 8; add its position to `--node-positions`; it appears in `/api/v1/nodes` on first packet (no registration step exists). Recalibrate the room.

**▶ "A node went silent."** In order: (1) its DHCP lease changed — reserve MACs in the router; (2) check `sudo tcpdump -ni any udp port 5005` for its source IP; (3) wrong band — S3/C6 can't see 5 GHz SSIDs; (4) power-bank auto-off (use a current maintainer); (5) re-provision — NVS merges, nothing is lost.

**▶ "I moved the furniture / readings got flaky."** Empty the room (pets too) → `wifi-densepose calibrate` again → if specialists degrade, re-`enroll` + `train-room`. Baselines never auto-refresh by design — the system can't verify the room is empty.

**▶ "Home Assistant in 5 minutes."** Run server with `--features mqtt` build (or Docker tag with MQTT): `--mqtt --mqtt-host <broker> --mqtt-port 1883 --mqtt-prefix homeassistant --privacy-mode` (`--privacy-mode` is a boolean that strips biometrics before MQTT/Matter publish). 21 entities per node auto-appear; the 10 semantic primitives (someone_sleeping, possible_distress, bed_exit…) are your automation triggers; 8 HA Blueprints in `examples/ha-blueprints/` + 3 Lovelace dashboards (+3 BFLD blueprints in `cog-ha-matter`).

**▶ "Prove the install is healthy."** `curl /health` → `/api/v1/nodes` (all nodes, fresh) → `/api/v1/mesh/metrics` (sync ok) → `wifi-densepose room-status --bank ./room-bank.json` (baseline fresh, specialists ✓) → Observatory badge LIVE.

## 0.2 Fault table (symptom → cause → fix)

| Symptom | Likeliest cause | Fix |
|---|---|---|
| Flash does nothing | charge-only USB-C cable; or MR60 case-edge port | data cable; inner port; hold BOOT |
| Won't join WiFi | 5 GHz-only SSID | use the 2.4 GHz network |
| tcpdump silent on 5005 | wrong `--target-ip`, firewall | re-provision; open UDP 5005 |
| Packets arrive, `/nodes` empty | second listener owns :5005; Docker missing `-p 5005:5005/udp -e CSI_SOURCE=esp32` | kill the other process; fix flags |
| `CSI_SOURCE=auto` exits code 78 | no source found | set `CSI_SOURCE=esp32` or `simulated` explicitly |
| Observatory stuck DEMO | opened the file directly | open via `http://<server>:3000/ui/observatory.html` |
| Presence flickers when empty | skipped/stale calibration | recalibrate with room truly empty |
| HR pinned ~45 BPM | pre-v0.7.1 firmware | reflash v0.7.1-esp32+ |
| C6 only 64-tone CSI | IDF < 5.5.2 build 🔶 (release-notes claim), or no 11ax on 2.4 GHz AP | rebuild; enable WiFi 6 on 2.4 GHz |
| Seed ingest 401 | token lost (shown once) | re-pair over USB, 30 s window |
| `--model` errors `invalid magic` | HF JSONL bundle vs binary-RVF loader | run without `--model` (known upstream gap) |
| Person count stuck at 1 / absurdly high | pre-v0.7.1 clamp bugs | update server (v1701+) |

## 0.3 Glossary (so terms are never guessed)

**CSI** — Channel State Information: per-subcarrier amplitude+phase of a WiFi link; the raw signal. **Subcarrier/tone** — one OFDM frequency bin; more tones = finer body detail (S3 HT ≈ 56–114, C6 HE ≈ 242). **HE-LTF** — the WiFi-6 training field the C6 reads for high-res CSI. **RSSI** — coarse signal strength; fallback mode, no vitals. **Node** — one ESP32 streaming CSI; identified solely by its provisioned `node_id`. **Multistatic** — several nodes sensing the same space from different angles. **TDM slot** — a node's transmit turn, so nodes don't jam each other. **Baseline / calibration** — the empty room's RF fingerprint (ADR-135). **Enrollment / anchors** — the 8 guided poses that teach the room (ADR-151). **Specialist** — one of six tiny per-room models (presence, posture, breathing, heartbeat, restlessness, anomaly). **Edge tier** — how much DSP runs on the node itself (0 raw / 1 stats / 2 vitals). **Seed** — Pi Zero 2 W appliance storing 8-dim sensing history with a witness chain. **Witness chain** — hash-linked, signed audit log (tamper-evident); *not* person identity. **Soul Signature** — experimental anonymous re-ID ("same body as yesterday"); not names. **Cog** — a small signed plug-in model/binary (Cognitum packaging). **RVF** — RuVector File: binary container for models/vectors. **MCP** — Model Context Protocol; how AI assistants query the Seed/server. **ADR** — Architecture Decision Record; numbered design documents quoted throughout.

---

## 1. What RuView is

RuView turns **Channel State Information** — the fine-grained way bodies disturb WiFi radio — into human understanding: presence, person count, breathing rate, heart rate, motion/activity, fall detection, and (with training) 17-keypoint pose. Cheap ESP32 nodes ($5–9) capture CSI and stream it over UDP to a Rust sensing server; no cameras, no wearables, no cloud. It is the **perception layer** of ruvnet's Cognitum stack: it consumes RuVector crates for its math, stores models in RVF containers, and pairs with the Cognitum Seed (Pi Zero 2 W) for persistent, witness-chained memory and with the V0 appliance (Pi 5 + Hailo-8) as an always-on LAN core.

> **Why ESP32s and not your laptop's WiFi?** Ordinary WiFi exposes only RSSI ("is there signal, how strong"), but sensing needs CSI — the per-frequency amplitude and phase of how the wave bent around bodies — which every WiFi chip computes internally to decode WiFi at all, yet no mainstream OS or driver will hand you (Apple's least of all): the door is locked in software, not missing in silicon. The ESP32 is the exception — Espressif ships an API that exposes raw CSI, which is the entire reason these $5 boards are the sensors. The Seed's radio is no exception: it never senses anything; with ESP32 nodes and any laptop you get the full sensing experience with no Seed at all (network-only mode). The Seed adds permanent, witness-chained, queryable memory — not sensing ability.

**Naming:** the project began as `wifi-densepose`; "RuView" is the post-rename umbrella. The Docker image (`ruvnet/wifi-densepose`), PyPI packages, and most crate names still carry the old name. One repo, two names.

**Versioning, two parallel schemes:** `v0.x.y-esp32` tags are **firmware releases** (manual, hardware-verified — latest v0.8.0-esp32); `v1xxx` tags are **automated rolling server releases** (latest v1701, several per day).

---

## 2. Architecture at a glance

![RuView data flow: ESP32 nodes stream CSI over UDP 5005 to the Rust sensing-server, which serves dashboards/REST, WebSocket streams and MQTT; an 8-dim feature stream on UDP 5006 goes through a host bridge into the Cognitum Seed's witness-chained vector store](https://cognitum-sensor-primer.vercel.app/assets/diagrams/ruview-architecture.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
ESP32 node (S3 / C6)  ──UDP :5005──▶  sensing-server (Rust/Axum, v2/)
  on-device DSP + edge tiers 0/1/2     │  per-node state, multistatic fusion,
  packet magics 0xC511_xxxx            │  calibration, specialists, pose
  ──UDP :5006 (8-dim features)──▶ host bridge ──HTTPS :8443──▶ Cognitum Seed
                                       ├── HTTP  :3000 Docker / :8080 source — REST /api/v1/* + ui/
                                       ├── WS    :3001 Docker / :8765 source — /ws/sensing, /ws/introspection
                                       └── MQTT  :1883 (--features mqtt) — Home Assistant auto-discovery
```

</details>

![The four-stage room training pipeline: calibrate the empty room, guided 8-anchor enrollment, train six small specialists, then live mixture-of-specialists watching](https://cognitum-sensor-primer.vercel.app/assets/diagrams/ruview-room-training.svg)

<details>
<summary>ASCII Version (for AI/accessibility)</summary>

```
1·Calibrate(empty,60s) → 2·Enroll(8 anchors,~4min) → 3·Train(6 specialists) → 4·room-watch(live)
   ADR-135 baseline        quality-gated poses         presence·posture·breathing
   redo after furniture                                heartbeat·restlessness·anomaly(veto)
```

</details>

The server keeps **no database** — real-time ring buffers only. RVF files hold model weights; the Seed holds history.

---

## 3. The crates (v2/ workspace, 39 — incl. the `ruv-neural` git submodule and `homecore-plugin-example`)

### Sensing core
| Crate | Purpose |
|---|---|
| `wifi-densepose-core` | CSI frame primitives, types, traits, errors |
| `wifi-densepose-signal` | The DSP heart — 22 RuvSense modules (table below), Hampel, phase sanitizer, eigen person-count |
| `wifi-densepose-vitals` | ADR-021 breathing (0.1–0.5 Hz) + heart rate (0.8–2.0 Hz) extractors, anomaly/apnea detection; README-claimed `forbid(unsafe_code)` (attribute not in lib.rs) |
| `wifi-densepose-calibration` | ADR-151 four-stage room pipeline: baseline → enroll → extract → train 6 specialists |
| `wifi-densepose-nn` | ONNX / PyTorch / Candle inference backends |
| `ruv-neural` | Workspace member vendored as a **git submodule** (neural primitives) |
| `wifi-densepose-ruvector` | RuVector integration + 4 cross-viewpoint fusion modules (attention, geometry, coherence, fusion) |
| `wifi-densepose-train` | Training: MAE pretraining (ADR-152), WiFlow-STD port, `rapid_adapt.rs` LoRA test-time training, `signal_features.rs` |
| `wifi-densepose-bfld` | Soul Signature / BFLD privacy-gated re-ID — `EnrolledMatcher`, 364 tests (ADR-118…122, issue #1021) |

### Hardware & protocol
| Crate | Purpose |
|---|---|
| `wifi-densepose-hardware` | ESP32 parser (ADR-018 frames), SyncPacket decoder (ADR-110), aggregator binary, `ieee80211bf/` forward-compat layer (ADR-153) |
| `wifi-densepose-wifiscan` | Host-WiFi RSSI: Windows wlanapi FFI (9.74 Hz), macOS CoreWLAN, Linux nl80211 |
| `vendor/rvcsi` (submodule) | Edge RF runtime: 9 crates incl. the Nexmon shim (real CSI from Pi 5/4/3B+ BCM43455c0) — own repo github.com/ruvnet/rvcsi |

### Applications & inference
| Crate | Purpose |
|---|---|
| `wifi-densepose-sensing-server` | The Axum server — REST + WS + MQTT + UI + calibration endpoints (main.rs is ~300 KB) |
| `wifi-densepose-cli` | `wifi-densepose` binary: calibrate / calibrate-serve / enroll / train-room / room-status / room-watch / mat |
| `wifi-densepose-mat` | Mass Casualty Assessment Tool — survivor detection, GDOP triangulation, START triage (heartbeat ⇒ never "Deceased", #926) |
| `wifi-densepose-pointcloud` | Camera depth (MiDaS) + CSI tomography + mmWave fused point cloud — 🔶 22 ms, 19K+ pts/frame |
| `wifi-densepose-worldgraph` / `-worldmodel` / `-occworld-candle` | ADR-139/147 environmental digital twin + OccWorld 15-frame occupancy prediction (🔶 209 ms on RTX 5080) |
| `wifi-densepose-engine` | ADR-136 streaming engine: trust pipeline, privacy demotion, Ed25519 witness on every belief |
| `wifi-densepose-geo` | Satellite/DEM/OSM fusion (ADR-044) |
| `wifi-densepose-desktop` (Tauri) · `-wasm` · `-wasm-edge` | Desktop app, browser WASM, ESP32 WASM edge skills (ADR-040) |
| `cog-person-count` · `cog-pose-estimation` · `cog-ha-matter` | Signed Cognitum "cogs": person count (ADR-103), 17-keypoint pose (ADR-100/101, 8.4 ms on Pi 5), HA/Matter bridge (ADR-116) |
| `nvsim` · `nvsim-server` | NV-diamond magnetometer simulator (ADR-089) — the `dashboard/` app belongs to this, **not** to the sensor dashboard |
| `ruview-swarm` | Drone swarm control (ADR-148) — MARL, Raft, MAVLink/PX4 |

### HOMECORE (Rust Home-Assistant port, ADR-126…134 — mostly ⚠️ P1 scaffolds)
`homecore` (state machine/event bus) · `homecore-api` (HA wire-compatible REST/WS) · `homecore-automation` · `homecore-assist` (voice/intent, measured 0.855 cosine match) · `homecore-hap` (Apple Home — ⚠️ stub) · `homecore-plugins` (WASM, Ed25519-signed per ADR-162) · `homecore-plugin-example` (example WASM plugin) · `homecore-recorder` (SQLite) · `homecore-migrate` · `homecore-server`

### The 22 RuvSense DSP modules (`wifi-densepose-signal/src/ruvsense/`)
multiband · phase_align · multistatic · coherence · coherence_gate · pose_tracker (17-kp Kalman + AETHER re-ID) · field_model (SVD eigenstructure) · tomography (ISTA L1 voxels) · longitudinal (Welford drift) · intention (200–500 ms pre-movement) · cross_room · gesture (DTW) · adversarial (spoof detection) · cir (ADR-134 CSI→CIR) · calibration (ADR-135 baseline) · array_coordinator · attractor_drift · evolution · fusion_quality · rf_slam · temporal_gesture · mod

---

## 4. Complete REST API (sensing-server)

Registered in `v2/crates/wifi-densepose-sensing-server/src/main.rs` (~line 6972+):

```
Health:    GET /health  /health/live  /health/ready  /health/version  /health/metrics
Info:      GET /  /api/v1/info  /api/v1/status  /api/v1/metrics
           POST /api/v1/config/ground-truth
Sensing:   GET /api/v1/sensing/latest   /api/v1/nodes   /api/v1/nodes/:id/sync
Mesh:      GET /api/v1/mesh   /api/v1/mesh/metrics
Vitals:    GET /api/v1/vital-signs   /api/v1/edge-vitals
Pose:      GET /api/v1/pose/current  /api/v1/pose/stats  /api/v1/pose/zones/summary
Models:    GET /api/v1/models  /models/active  /model/info  /model/layers  /model/segments
           POST /api/v1/models/load  /models/unload   DELETE /api/v1/models/{id}
           GET /api/v1/models/lora/profiles   POST /api/v1/models/lora/activate
           GET /api/v1/model/sona/profiles    POST /api/v1/model/sona/activate
Recording: GET /api/v1/recording/list   POST /recording/start  /recording/stop   DELETE /recording/{id}
Training:  GET /api/v1/train/status   POST /train/start  /train/stop
Adaptive:  POST /api/v1/adaptive/train  /adaptive/unload   GET /api/v1/adaptive/status
Calibrate: POST /api/v1/calibration/start  /calibration/stop   GET /api/v1/calibration/status
Edge:      GET /api/v1/edge/registry   /api/v1/wasm-events
Streams:   GET /api/v1/stream/status  /api/v1/stream/pose
WebSocket: /ws/sensing   /ws/introspection
Static:    /ui/* (index.html, observatory.html, viz.html, pose-fusion.html)
```

**`/ws/sensing` frame (JSON), key fields:** per-node array (`node_id`, `rssi_dbm`, `position`, `amplitude[]`, `sync{offset_us,is_leader,csi_fps_ema,staleness_ms}`), `features{motion_band_power, breathing_band_power, dominant_freq_hz…}`, `classification{motion_level, presence, confidence}`, `vital_signs{breathing_rate, heart_rate + confidences}`, `persons[]` (17 COCO keypoints + bbox + zone), `signal_quality_score`, `quality_verdict`, `model_status`.

---

## 5. UDP wire protocol (the 0xC511 family)

All little-endian, magic at bytes 0–3. Defined in `wifi-densepose-hardware/src/esp32_parser.rs` and firmware `csi_collector.h`.

| Magic | Packet | Notes |
|---|---|---|
| `0xC5110001` | **Raw CSI frame** | 20-byte header (node_id, n_ant, n_sub, freq, seq, RSSI, noise, PPDU type byte 18, flags byte 19) + i8 I/Q pairs. HT20 ≈ 356 B; C6 HE-SU ≈ 1,556 B (242 tones) 🔶 release-notes figure |
| `0xC5110002` | Edge vitals (ADR-039) | 32 B: HR, BR, presence from Tier-2 nodes |
| `0xC5110003` | **8-dim feature vector** (ADR-069) | 48 B @ 1 Hz — presence, motion energy, breathing/30, HR/120, phase variance, person count/4, fall flag, (RSSI+100)/100 — this is what the Seed ingests |
| `0xC5110004` | mmWave-fused vitals (ADR-063) | Kalman blend ~80% MR60 radar / 20% CSI, on-device |
| `0xC5110005` | Compressed CSI | bandwidth-constrained links |
| `0xC5110006` | Feature state (ADR-081) | compact default upstream payload |
| `0xC5110007` | Temporal classification / WASM output — naming split | host parser: ADR-095 temporal classification; firmware headers: ADR-040 WASM output (reassigned per #928) |
| `0xC5118100` | RV_MESH beacon | mesh beacon magic |
| `0xC511A110` | **Sync packet** (ADR-110) | 32 B: leader epoch µs + local µs — host recovers mesh-aligned time (±~104 µs measured) |

Ports: **5005** CSI ingest (one listener only!), **5006** feature stream → Seed bridge.

---

## 6. CLI reference

### sensing-server flags
`--source auto|simulate|wifi|esp32` · `--http-port` (default **8080** from source, **3000** in Docker) · `--ws-port` (8765/3001) · `--udp-port 5005` · `--ui-path` · `--tick-ms 100` (default 100) · `--model <rvf>` · `--mqtt` (boolean) with `--mqtt-host <host> --mqtt-port 1883 --mqtt-prefix homeassistant --mqtt-publish-pose` · `--privacy-mode` (boolean — strips biometrics before MQTT/Matter publish; "demotion" is the separate ADR-141 engine concept, not a CLI mode) · `--node-positions "x,y,z;…"` · `--calibrate` · `--benchmark` · `--train --dataset --epochs --save-rvf` · `--progressive` · `--matter` (⚠️ stub)

### wifi-densepose CLI (the room pipeline)
```bash
wifi-densepose calibrate  --udp-port 5005 --duration-s 30 --output baseline.bin --tier ht20|ht40|he20|he40   # --duration-s default 30 (integer seconds); no --room flag
wifi-densepose enroll     --room-id living-room        # 8 guided anchors, ~4 min, quality-gated
wifi-densepose train-room --enrollment ./enrollment.json --output ./room-bank.json   # all six specialists always train (no --room / --specialists flags)
wifi-densepose room-status --bank ./room-bank.json     # baseline freshness + per-specialist confidence
wifi-densepose room-watch  --bank ./room-bank.json --udp-port 5005   # live mixture-of-specialists (JSON bank, default ./room-bank.json)
wifi-densepose calibrate-serve --http-port 8090        # HTTP calibration API for UIs (default port 8090)
```

### provision.py (firmware/esp32-csi-node/) — full flag set
`--port` (required) · `--baud 460800` · `--ssid` · `--password` · `--target-ip` · `--target-port 5005` · `--node-id 0–255` · `--tdm-slot` / `--tdm-total` · `--edge-tier 0|1|2` · `--pres-thresh` · `--fall-thresh` (integer milli-units, default 15000 = 15.0 rad/s²; walking ≈ 2–5, falls 20+ rad/s²) · `--vital-win` (default 300) · `--vital-int` (default 1000, ms) · `--subk-count ≤32` · `--wasm-verify/--no-wasm-verify --wasm-pubkey` · plus `--chip`, `--channel`, `--filter-mac`, `--hop-channels`, `--seed-url`, `--seed-token`, `--zone`, `--reset`, `--dry-run` and more. There is **no `--mesh-key` flag** — mesh beacon authentication (HMAC-SHA256, ADR-032) exists in the firmware but has no provisioning flag yet. Re-runs **merge** settings (NVS additive). No discovery protocol exists — nodes push to the provisioned IP; the server tells nodes apart only by `node_id`.

---

## 7. Capabilities, graded honestly

| Capability | Status | Where | Notes |
|---|---|---|---|
| Presence & person count | ✅ | `multistatic.rs`, `field_model.rs`, mincut `DynamicPersonMatcher` | v0.7.1 fixed count-pinned-to-1 (#803) and capped single-link count at 3 (#894); falsifiable benchmark gating (ADR-157) |
| Breathing rate (6–30 BPM) | ✅ | `vitals/breathing.rs` | No per-person training needed; sample-rate auto-detect retunes filters on >15% drift |
| Heart rate (40–120 BPM) | ✅ (lower confidence) | `vitals/heartrate.rs` | v0.7.1 autocorrelation fix: was pinned ~40–49, now 88–91 vs 87 ground truth 🔶 |
| Motion / activity | ✅ | `motion.rs`, `gesture.rs` (DTW), edge tier on-chip | |
| Fall detection | ✅ | edge_processing.c, NVS `fall_thresh` | <200 ms, 3-frame debounce |
| Empty-room calibration | ✅ | ADR-135, `ruvsense/calibration.rs` | 30 s Welford amplitude + von Mises phase; never automatic (can't verify emptiness); ~7 KB/link |
| Room specialist training | ✅ | ADR-151, `wifi-densepose-calibration` | baseline → 8-anchor enroll → extract → train six statistical specialist heads (threshold/prototype/periodicity/novelty) — the frozen-backbone + LoRA design is ADR-151's documented upgrade path, not yet the implementation; runtime MixtureOfSpecialists with anomaly veto |
| Pose — heuristic skeleton | ✅ (default) | `pose_tracker.rs` | motion-driven, labeled "Signal-Derived" in UI |
| Pose — trained (MM-Fi) | ⚠️ | `wiflow_std/`, `cog-pose-estimation` | HF `ruvnet/wifi-densepose-mmfi-pose` 🔶 82.69% torso-PCK@20; per-room LoRA adapters (~11 KB) recover cross-room accuracy; live-server keypoint head NOT wired by default |
| Pose — camera-supervised | ⚠️ (data collection works) | ADR-079 scripts | needs 35–40 min varied-activity session; earlier 92.9% claim **retracted** by upstream |
| Pose — camera-free | ⚠️ experimental | ADR-071, `train-camera-free.js` | fuses up to 10 Seed signals into weak labels |
| Soul Signature / re-ID | ⚠️ honest-experimental | `wifi-densepose-bfld` | Real `EnrolledMatcher` (364 tests) but **measured: two people NOT separable on WiFi-only cardiac+respiratory channels** (gap ~0.0005); named identity is enrollment-gated; privacy: embeddings RAM-only, per-site keyed hashes rotate daily (#787) |
| Multistatic mesh + time sync | ✅ | ADR-110, firmware c6_* modules | C6 802.15.4 sync measured 99.56% match, 104 µs stdev (WITNESS-LOG-110); S3 ESP-NOW fallback; TDM slots; `--node-positions` required for geometric fusion |
| Seed pipeline | ✅ | ADR-069, `scripts/seed_csi_bridge.py` | pair over USB (169.254.42.1:8443, token shown once) → bridge batches 0xC5110003 → `POST /api/v1/store/ingest` → witness chain → MCP query. Bridge runs on a host, not the Seed; compact periodically (`--compact`) |
| Edge tiers 0/1/2 | ✅ (tier 2 ⚠️ LoRA part) | edge_processing.c | 0 = raw stream, 1 = stats (~30 KB RAM), 2 = on-chip presence/vitals/fall (~33 KB) |
| mmWave fusion (MR60BHA2/LD2410) | ✅ | firmware auto-detect over UART, `0xC5110004` | ~80/20 Kalman radar/CSI blend; `/api/v1/edge-vitals` |
| C6 WiFi-6 HE-LTF (242-tone) | ✅ with conditions | v0.8.0-esp32 | needs IDF 5.5.2 build 🔶 (release-notes claim; the checkout's firmware README still documents v5.4 — verify before building) + 802.11ax on a 2.4 GHz AP; S3 is HT-only by silicon |
| Host-WiFi RSSI modes | ✅ (coarse) | `wifi-densepose-wifiscan` | Windows 9.74 Hz wlanapi FFI; presence/motion only, no vitals/pose |
| MAT disaster triage | ✅ | `wifi-densepose-mat` | START protocol; safety gate: heartbeat present ⇒ never "Deceased" |
| Point cloud (camera+CSI+radar) | ⚠️ PoC | `wifi-densepose-pointcloud`, tomography.rs | pairs naturally with the XIAO ESP32S3 **Sense** (camera-on-an-S3) |
| Health scripts | ⚠️ | scripts/: sleep-monitor, apnea-detector, gait-analyzer, stress-monitor | present; real-world validation in progress |
| HOMECORE + Matter/HAP | ⚠️/❌ | homecore-* crates | MQTT→Home Assistant path is the ✅ one (21 entities/node, 10 semantic primitives, 8 HA Blueprints in `examples/ha-blueprints/` + 3 Lovelace dashboards); Matter & HAP are stubs targeted at v0.8 |
| SENSE-BRIDGE MCP (ADR-124) | ✅ | `@ruvnet/rvagent` npm | exposes sensing + Seed memory as MCP tools for Claude/agents; 401/403 on bad token/origin |
| OccWorld prediction (ADR-147) | ⚠️ | `wifi-densepose-worldmodel` | inference path real 🔶 (209 ms, RTX 5080); needs your own fine-tuned checkpoint |
| RVF model loading | ⚠️ known gap | `rvf_container.rs` | binary RVF (`0x52564653`) only; the HF JSONL bundle errors — run live server without `--model`, use weights from Python |
| QEMU no-hardware testing | ✅ | scripts/qemu-*, sdkconfig.qemu | swarm presets, chaos/fuzz/NVS-matrix tests |

### Home Assistant surface (the ✅ integration)
21 entities per node via MQTT auto-discovery: presence, person_count, breathing_rate, heart_rate, motion_level/energy, presence_score, RSSI, optional pose — plus **10 semantic primitives**: someone_sleeping, possible_distress, room_active, elderly_inactivity_anomaly, meeting_in_progress, bathroom_occupied, fall_risk_elevated, bed_exit, no_movement, multi_room_transition. Privacy: boolean `--privacy-mode` strips biometrics before MQTT/Matter publish; "demotion" is the separate ADR-141 engine concept, not a CLI mode.

---

## 8. The complete ADR index (160 ADR-numbered files / 156 unique numbers)

**Counts, verified June 13:** `docs/adr/` holds **162 `.md`** files — **160 are ADR-numbered** (highest is ADR-163; 156 unique numbers after gaps/dupes, see note under the table), the other two are `README.md` + an index. Counting `adr`-pathed `.md` anywhere in the repo gives **168** (adds `v2/docs/adr` 3, `plugins/ruview` 1, `docs/research/BFLD` 1, a `.claude` singleton). The table below is the canonical `docs/adr/` numbered series.

| # | Title | Status |
|---|---|---|
| 1 | WiFi-Mat Disaster Detection Architecture | Accepted |
| 2 | RuVector RVF Integration Strategy | Superseded by 016/017 |
| 3 | RVF Cognitive Containers for CSI Data | Proposed |
| 4 | HNSW Vector Search for Signal Fingerprinting | Partial (→024/027) |
| 5 | SONA Self-Learning for Pose Estimation | Partial (→023/027) |
| 6 | GNN-Enhanced CSI Pattern Recognition | Partial (→023/027) |
| 7 | Post-Quantum Cryptography for Secure Sensing | Proposed |
| 8 | Distributed Consensus for Multi-AP Coordination | Proposed |
| 9 | RVF WASM Runtime for Edge Deployment | Proposed |
| 10 | Witness Chains for Audit Trail Integrity | Proposed |
| 11 | Python Proof-of-Reality and Mock Elimination | Proposed (urgent) |
| 12 | ESP32 CSI Sensor Mesh for Distributed Sensing | Accepted — partial |
| 13 | Feature-Level Sensing on Commodity Gear | Accepted — implemented |
| 14 | SOTA Signal Processing Algorithms | Accepted |
| 15 | Public Dataset Strategy (MM-Fi + Wi-Pose) | — |
| 16 | RuVector Integration for Training Pipeline | Accepted (complete) |
| 17 | RuVector Integration for Signal + MAT | Proposed |
| 18 | ESP32 Development Implementation Path (wire format) | Accepted in practice |
| 19 | Sensing-Only UI Mode w/ Gaussian Splats | — |
| 20 | Migrate Inference to Rust (RuVector + ONNX) | — |
| 21 | Vital Sign Detection (rvdna pipeline) | Accepted in practice |
| 22 | Enhanced Windows Multi-BSSID Pipeline | — |
| 23 | Trained DensePose Model w/ RuVector | — |
| 24 | Project AETHER — Contrastive CSI Embedding | Accepted |
| 25 | macOS CoreWLAN via Swift Helper | — |
| 26 | Survivor Track Lifecycle (MAT) | — |
| 27 | Project MERIDIAN — Cross-Environment Generalization | Accepted |
| 28 | ESP32 Capability Audit & Witness Record | Accepted |
| 29 | Project RuvSense — Multistatic RF Mode | — |
| 30 | RuvSense Persistent Field Model | — |
| 31 | Project RuView — Multistatic Fidelity | — |
| 32 | Multistatic Mesh Security Hardening | — |
| 33 | CRV Signal Line Sensing Integration | Research |
| 34 | Expo React Native Mobile App | — |
| 35 | Live Sensing UI Accuracy & Source Transparency | Accepted |
| 36 | RVF Model Training Pipeline & UI | Proposed |
| 37 | Multi-Person Pose from Single ESP32 Stream | — |
| 38 | Sublinear GOAP Roadmap Optimization | — |
| 39 | ESP32-S3 Edge Intelligence Pipeline | — |
| 40 | WASM Programmable Sensing (Tier 3) | — |
| 41 | WASM Module Collection (105-cog catalog) | Accepted |
| 42 | Coherent Human Channel Imaging (CHCI) | — |
| 43 | Sensing Server UI API Completion | — |
| 44 | Geospatial Satellite Integration | Accepted |
| 45 | AMOLED Display for S3 Node | — |
| 46 | Android TV Box / Armbian Target | — |
| 47 | RuView Observatory (Three.js) | — |
| 48 | Adaptive CSI Activity Classifier | — |
| 49 | Cross-Platform WiFi Detection + Degradation | — |
| 50 | Provisioning Tool Enhancements / QE Response (dup #) | — |
| 52 | DDD Bounded Contexts + Tauri Desktop (dup #) | — |
| 53 | UI Design System | — |
| 54 | RuView Desktop Full Implementation | Accepted — in progress |
| 55 | Integrated Sensing Server in Desktop App | Accepted |
| 56 | Desktop Complete Capabilities Reference | Accepted |
| 57 | Firmware CSI Build Guard | — |
| 58 | Dual-Modal WASM Browser Pose (video+CSI) | — |
| 59 | Live ESP32 CSI Pipeline Integration | — |
| 60 | Provision Channel Override + MAC Filtering | — |
| 61 | QEMU ESP32-S3 Emulation | — |
| 62 | QEMU Swarm Configurator | — |
| 63 | 60 GHz mmWave Fusion with CSI | — |
| 64 | Multimodal Ambient Intelligence | — |
| 65 | Hotel Guest Happiness Scoring (Seed bridge) | — |
| 66 | ESP32 Swarm with Seed Coordinator | — |
| 67 | RuVector v2.0.4→v2.0.5 Upgrade | — |
| 68 | Per-Node State Pipeline | — |
| 69 | **ESP32 CSI → Cognitum Seed RVF Ingest** | — |
| 70 | Self-Supervised Pretraining (live CSI + Seed) | — |
| 71 | ruvllm Training Pipeline | — |
| 72 | WiFlow Pose Architecture | — |
| 73 | Multi-Frequency Mesh Scanning | — |
| 74 | Spiking Neural Network for CSI | — |
| 75 | Min-Cut Person Separation | — |
| 76 | CSI Spectrogram Embeddings | — |
| 77 | Novel RF Sensing Applications | Research |
| 78 | Multi-Frequency Mesh Applications | — |
| 79 | **Camera Ground-Truth Training Pipeline** | — |
| 80 | QE Analysis Remediation | — |
| 81 | Adaptive CSI Mesh Firmware Kernel | — |
| 82 | Pose Tracker Confirmed-Track Filter | — |
| 83 | Per-Cluster Pi Compute Hop | — |
| 84 | RaBitQ Similarity Sensor | — |
| 85 | RaBitQ Pipeline Expansion | — |
| 86 | Edge Novelty Gate (RaBitQ on MCU) | — |
| 89 | nvsim — NV-Diamond Simulator | — |
| 90 | nvsim Hamiltonian/Lindblad Solvers | — |
| 91 | Stand-off Radar Research (77 GHz–sub-THz) | Research |
| 92 | nvsim Dashboard | — |
| 93 | nvsim Dashboard Gap Analysis | — |
| 94 | Live 3D Point Cloud Viewer (GH Pages) | — |
| 95 | rvCSI — Edge RF Sensing Runtime | — |
| 96 | rvCSI Crate Topology + napi | — |
| 97 | Adopt rvCSI as Primary Runtime | — |
| 98 | Evaluate midstream | — |
| 99 | Adopt midstream (introspection tap) | — |
| 100 | Cognitum Cog Packaging Spec (Ed25519) | — |
| 101 | Pose Estimation Cog | — |
| 102 | Edge Module Registry Integration | — |
| 103 | Learned Multi-Person Counter | — |
| 104 | RuView MCP Server + CLI Distribution | — |
| 105 | Federated Learning for Personalization | — |
| 106 | Differential Privacy + Biometric Isolation | — |
| 107 | Cross-Installation Federation | — |
| 108 | Kyber PQ Key Exchange | — |
| 109 | Dilithium PQ Signatures for Cogs | — |
| 110 | **ESP32-C6: WiFi-6 CSI, 802.15.4 sync, TWT, LP-core** | Accepted (v0.7.0, witnessed) |
| 113 | Multistatic Anchor Placement | — |
| 114 | cog-quantum-vitals | PoC |
| 115 | **Home Assistant via MQTT + Matter** | — |
| 116 | HA + Matter as Seed Cog | — |
| 117 | PyPI Modernization (PyO3/maturin) | — |
| 118 | **BFLD — Beamforming Feedback Layer for Detection** | — |
| 119 | BFLD Frame Format & Wire Protocol | — |
| 120 | BFLD Privacy Class & Hash Rotation | — |
| 121 | BFLD Identity Risk Scoring | — |
| 122 | BFLD RuView Surface (HA/Matter/MQTT) | — |
| 123 | BFLD Capture Path (Pi 5/Nexmon, S3) | — |
| 124 | **rvagent MCP + npm Library** | — |
| 125 | Apple Home Native HAP Bridge | Scaffold |
| 126 | HOMECORE — Rust HA Port | — |
| 127 | HOMECORE-CORE | Scaffold |
| 128 | HOMECORE-PLUGINS (WASM) | Scaffold |
| 129 | HOMECORE-AUTO | In progress |
| 130 | HOMECORE-API | In progress |
| 133 | HOMECORE-ASSIST (voice + ruflo) | Scaffold |
| 134 | First-Class CIR Support | In progress |
| 135 | **Empty-Room Baseline Calibration** | — |
| 136 | Rust Streaming Engine Architecture | — |
| 137 | Fusion Quality Scoring + Contradiction Flags | — |
| 138 | WiFi-7 MLO LinkGroup Abstraction | — |
| 139 | WorldGraph Digital Twin | In progress |
| 140 | Semantic State Schema + Ruflo Bridge | — |
| 141 | BFLD Privacy Control Plane | — |
| 142 | Evolution Tracker + VoxelMap Evidence | — |
| 143 | RF SLAM v2 | — |
| 144 | UWB Range-Constraint Fusion | — |
| 145 | Ablation Harness (privacy-leakage + latency) | — |
| 146 | RF Encoder Multi-Task Heads + Uncertainty | — |
| 147 | OccWorld World Model Integration (+ benchmark proof) | In progress |
| 148 | Drone Swarm Control System | In progress |
| 149 | AetherArena Benchmark (+ swarm eval, dup #) | — |
| 150 | RF Foundation Encoder | — |
| 151 | **Per-Room Calibration & Specialist Training** | — |
| 152 | WiFi-Pose SOTA 2026 Intake | In progress |
| 153 | IEEE 802.11bf-2025 Forward Compatibility | Accepted |
| 154 | Signal/DSP Beyond-SOTA Sweep (M0) | — |
| 155 | NN/Training Beyond-SOTA Sweep (M1) | — |
| 156 | Fusion Beyond-SOTA Sweep (M2) | — |
| 157 | Hardware Layer Beyond-SOTA Sweep (M3) | — |
| 158 | MAT/World-Model Anti-"AI-Slop" Hardening | — |
| 159 | Cognitum Appliance Cluster Hardening | — |
| 160 | Edge Skill Library Honest Labeling | — |
| 161 | HOMECORE Server Security (WS auth bypass fix) | — |
| 162 | HOMECORE Plugin Security (signatures + RunModes) | — |
| 163 | Edge-Latency: CLAIMED → MEASURED-on-host | — |

(160 ADR files, 156 unique numbers: gaps at 51, 87–88, 111–112, 131–132 are absent numbers; numbers 050, 052, 147 and 149 are each used twice — listed as found. "—" means status not captured in this sweep; many of these files do declare one (e.g. 019 Accepted, 022 Partially Implemented, 104 Accepted, 163 Accepted).)

---

## 9. Docs, tutorials, scripts, firmware — where everything lives

### Tutorials (docs/tutorials/)
- **cognitum-seed-pretraining.md** — beginner, ~1 hour, ~$36 hardware: 2× ESP32-S3 → Seed, self-supervised pretraining, kNN, no labels/cameras
- **pi5-cluster-cognitive-rf-observer.md** — advanced, 4–6 h, ~$580: 4× Pi 5 + Hailo-8 multistatic observer with rvcsi, Markov room-state prediction, Tailscale transport (the V0-class path)

### Key docs
`docs/user-guide.md` (2,468 lines — the master document) · `build-guide.md` · `proof-of-capabilities.md` · `TROUBLESHOOTING.md` · `user-guide-apple-homepod.md` · `wifi-mat-user-guide.md` · `integrations/home-assistant.md` (the 8 HA Blueprints live in `examples/ha-blueprints/`, + 3 Lovelace dashboards in `examples/lovelace/`, +3 BFLD blueprints in `cog-ha-matter`) · `integrations/pypi-release.md` · 9 domain models in `docs/ddd/` · benchmark studies in `docs/benchmarks/` (mmfi study, efficiency frontier, homecore-vs-HA) · 12-category **105-module edge catalog** in `docs/edge-modules/` · QE reports in `docs/qe-reports/` · witness logs `WITNESS-LOG-028.md` (1,031 tests + deterministic proof) and `WITNESS-LOG-110.md` (C6 sync measurements)

### Scripts (90 in scripts/ — the most-used)
`seed_csi_bridge.py` (Seed ingest) · `provision.py` · `record-csi-udp.py` + `collect-ground-truth.py` + `align-ground-truth.js` + `train-wiflow-supervised.js` + `eval-wiflow.js` (the camera-supervised pose chain) · `train-camera-free.js` · `calibrate-camera-room.py` · `csi-udp-relay.py` (the Windows-Docker UDP workaround) · `sleep-monitor.js` / `apnea-detector.js` / `gait-analyzer.js` / `stress-monitor.js` · `mincut-person-counter.js` · `through-wall-detector.js` · `rf-tomography.js` · `generate-witness-bundle.sh` · `qemu-*.sh` test harness · `publish-huggingface.py` · `occworld_retrain.py`

### Firmware (firmware/esp32-csi-node/)
52 C/H files (+ `lp_core/`): `csi_collector` (ADR-018 encoder) · `stream_sender` · `rv_mesh` · `nvs_config` · `ota_update` (S3 only) · `edge_processing` + `wasm_runtime` (WASM3, ADR-040) · `adaptive_controller` + `adaptive_controller_decide` · `power_mgmt` · `rv_feature_state` · `rv_radio_ops` · `rvf_parser` · `swarm_bridge` · `wasm_upload` · `c6_timesync` / `c6_sync_espnow` / `c6_twt` / `c6_lp_core` / `c6_softap_he` (ADR-110) · `mmwave_sensor` · `display_*` (AMOLED, S3 8MB only) · `mock_csi` (test-only). Config overlays: `sdkconfig.defaults` (S3 8MB), `.4mb`, `.s3-fair`, **`.esp32c6`**, `.qemu`, `.coverage`, `.template`, `.8mb_backup` — **no C5 target exists**.

### In-repo Claude Code plugin
`/plugin marketplace add ruvnet/RuView` then `/plugin install ruview@ruview` — plus `.claude/` ships claude-flow v3 config, 3 commands, 30 skills, and daemon workers. The MCP server is `@ruvnet/rvagent` (ADR-124).

### Also on disk (easy to miss)
`archive/v1/` (the complete original Python implementation, incl. the deterministic proof `verify.py`) · `aether-arena/` (the benchmark harness lives in-repo) · `python/` (ADR-117 PyO3 package) · `tools/ruview-cli` + `tools/ruview-mcp` · `vendor/{midstream, ruvector, sublinear-time-solver}` submodules · `monitoring/` (Prometheus + Grafana) · `examples/ha-blueprints/` + `examples/lovelace/` · `PROOF.md` · `Makefile`

---

## 10. Hardware matrix

| Device | CSI | Status | Notes |
|---|---|---|---|
| ESP32-C6 (XIAO C6, DevKitC, SuperMini) | 242-tone HE-LTF | ✅ **the fidelity pick** (v0.8.0) | needs IDF 5.5.2 🔶 (release-notes claim; checkout's own docs still say IDF v5.4 — verify before building) + 11ax 2.4 GHz AP; **no OTA** (USB reflash); 2.4 GHz only |
| ESP32-S3 8 MB | 56–114-tone HT | ✅ workhorse | OTA-capable, AMOLED option, mmWave fusion host |
| ESP32-S3 SuperMini 4 MB | HT20 | ✅ | use `-4mb` binaries |
| XIAO ESP32S3 **Sense** | HT (as S3) + OV2640 camera + mic | ✅ as S3 node; ⚠️ camera-as-teacher is an experiment | documented teacher flow uses a host webcam |
| Seeed MR60 XIAO (C6 + MR60BHA2 60 GHz) | C6 CSI + radar vitals | ✅ fused-vitals path | auto-detected over UART; `0xC5110004` |
| HLK-LD2410 (24 GHz) | radar accessory | ✅ | |
| Intel 5300 / Atheros AR9580 | full CSI 3×3 | ✅ research (Linux) | |
| Pi 5/4/3B+ via Nexmon (rvcsi) | CIR/CSI | ⚠️ research bridge | BCM43455c0 |
| **ESP32-C5** | — | ❌ **no firmware target** | despite dual-band silicon |
| ESP32 original / C3 / C2 | — | ❌ | single-core, can't run the DSP |
| Laptop/phone WiFi | RSSI only | ✅ coarse fallback | presence/motion, no vitals |

---

## 11. Last three firmware releases (what changed)

- **v0.8.0-esp32** (2026-06-11) 🔶 release-notes-sourced (the checkout does not contain these claims, and its firmware README still documents IDF v5.4 — verify before building): true HE-LTF CSI on C6 — 256 bins / **242 active HE20 tones**, "4× the spectral density"; requires IDF v5.5.2 per the release notes (v5.4 silently downconverted to 64-tone HT); C6 becomes "the precision instrument of the fleet."
- **v0.7.1-esp32** (2026-06-09): CSI self-ping fix (callback starvation → "guaranteed ~50 Hz unicast floor" 🔶 release-notes claim — the repo itself describes variable ~13–19 Hz after #985); heart-rate autocorrelation fix (was pinned ~45 BPM); person-count clamps removed; OTA fails closed on unprovisioned nodes.
- **v0.7.0-esp32** (2026-05-23): ADR-110 closed — 802.15.4 mesh time-sync measured at 104 µs stdev / 99.56% cross-board match; HE-LTF wire tagging; LP-core wake-on-motion; TWT.

---

## 11.5 The RuView RVF knowledge base — what's in it and how to use it

This primer is a curated summary; **summaries drop things.** The companion `ruview-kb.rvf` is the uncurated backstop — a queryable **semantic index of the entire RuView repo at the same pinned commit (`3d7530f0` / v1701)**. You query it in plain English and get back **real file paths + the actual source text** — the best defence against an LLM inventing RuView internals (a fabricated CLI flag, a wrong UDP magic, a non-existent crate).

**What it is (verified against `kb/.last-built.json` and the files on disk):**

| | |
|---|---|
| File | `kb/ruview-kb.rvf` (~7.4 MB) |
| Chunks (vectors) | **4,306** (one chunk ≈ 1,000 tokens / ~4,000 chars, paragraph-aligned) |
| Embedding | `Xenova/all-MiniLM-L6-v2` · **384-dim** · **cosine** · computed **locally** (no cloud) |
| Built from | `github.com/ruvnet/RuView` @ `3d7530f0`, `git describe` = **v1701** — the same commit this primer is pinned to |

**What it covers:** the repo's knowledge layer plus the source's self-description — **every ADR**, the docs (incl. the 2,468-line user-guide), research specs (e.g. the Soul Signature spec), each crate's manifest + lead source + module inventory, every `//!` doc comment, the 90 scripts, the **firmware headers** (`csi_collector`, the `0xC511` packet defs, the C6 sync modules), `provision.py` flags, and UI text. It does **not** index every line of every function body — it locates "*where* is the Kalman tracker / *which* magic is the 8-dim packet," not line 400 of a 2,000-line `main.rs`.

**Two-part design (keep the files together):** the `.rvf` stores vectors + the HNSW index and returns `{id, distance}`. The readable text lives in the **`ruview-kb.passages.jsonl`** sidecar (one `{id, text, path, title}` per line, **4,306 lines** — matches the vector count). A search embeds your query → asks the `.rvf` for nearest ids → **joins those ids to the full passage text**. Without the sidecar you get numbers, not text. (`ruview-kb.meta.json` adds id→metadata; `*.rvf.idmap.json` is the store's internal map — auto-managed, don't delete.)

**How to use it (three working ways — mirrors `kb/README.md`):**

```bash
# one-time setup (shared with the ruvector KB)
cd kb && npm i        # installs @ruvector/rvf + @xenova/transformers locally; MiniLM caches on first query, then offline
```

1. **CLI** — `node kb/ask-kb.mjs ruview "your question" 5` (prints each hit's path, title, distance, full passage text). Examples: `"how do I calibrate an empty room"`, `"0xC5110003 8-dim feature vector"`.
2. **MCP server in Claude Code** — point a `.mcp.json` entry at the bundled **`kb/kb-mcp-server.mjs`** (one server serves *both* stores); the tool is `search_kb({ query, store: "ruview", k })` and it returns full passage text. After wiring, `/mcp` should show it connected.
3. **From Node** — `import { searchKb } from './kb/ask-kb.mjs'` then `await searchKb({ store: 'ruview', query: '…', k: 5 })`; each hit is `{ id, distance, path, title, text }`.

> ⚠️ **Do NOT use `@ruvector/rvf-mcp-server`** for this. That published package is a **non-functional stub** — it never reads a prebuilt `.rvf` and returns no passage text. Use the bundled `kb/kb-mcp-server.mjs`. (Canonical guidance in `kb/README.md`.)

**Honest limit:** query quality is bounded by MiniLM-L6 — excellent for locating things, not a reasoning engine. Rebuild from a fresh checkout with `node kb/build-ruview-kb.mjs` then `node kb/guard-check.mjs` (which must pass before you trust a rebuild).

## 12. What this primer did NOT verify

- No hardware was flashed and no server was run against live CSI for this document; "✅" means verified-in-code/witness-logs, not re-tested on a bench.
- All accuracy numbers (82.3% triplet, 82.69% PCK@20, 104 µs sync, 9.74 Hz Windows scan, OccWorld 209 ms) are 🔶 repo-claimed/witness-logged, not independently reproduced.
- A few deep specifics came from single-agent reads and may have approximate line numbers; the three agents disagreed on workspace crate count (15 vs 38 — the 38-crate enumeration matches the current tree; 15 is the stale figure in the repo's own CLAUDE.md).
- The `aether_embedding` field layout reported by one agent conflicts with the documented 48-byte ADR-069 packet; this primer uses the documented 8-dim table (verified in `docs/user-guide.md`).
- Mechanical verification (2026-06-12) corrected: ADR 163→160 files, invented CLI flags (`--mesh-key`, `--specialists`, `--room`, `--mqtt-privacy-mode`), firmware-file and blueprint counts, and flagged release-note-only firmware claims.
- A second pass (**2026-06-13**, against the working submodule + the shipped KB) confirmed the counts (160 ADR-numbered files / 162 `.md` in `docs/adr/` / 168 repo-wide; 39 `v2/crates`; 90 scripts; 76 firmware C/H), corrected the **ADR-118 title** (it is "Beamforming Feedback **Layer** for Detection" on disk, not "…Detection"), added the ADR-count framing, added the RuView RVF-KB section (§11.5), and reconfirmed the pinned commit is `3d7530f0` / **v1701** (NOT "v0.7.1-esp32-70" — that string mixes the *firmware* version scheme with the rolling-server scheme; `git describe` on the pinned submodule returns `v1701`, which is what `kb/.last-built.json` records).

---

*Generated 2026-06-12, last verified 2026-06-13 by Claude (Opus 4.8) for the [Cognitum One Sensor Primer](https://cognitum-sensor-primer.vercel.app). Source: RuView main @ `3d7530f0` (`git describe` = v1701) — the commit the working submodule and the shipped `ruview-kb.rvf` are both built from. Companion: `ruvector-primer.md`. Regeneration instructions at the top of this file.*
