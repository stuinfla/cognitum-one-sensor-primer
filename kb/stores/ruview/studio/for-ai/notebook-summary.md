# RuView — NotebookLM Studio summary (machine-readable)

> Source: a NotebookLM notebook built from the **ruvnet/RuView** GitHub repository
> ("RuView: Real-Time WiFi Spatial Intelligence and Vital Monitoring"). This file is a
> plain-text companion to the Studio media in `../for-humans/`. Generated 2026-06-18.

## One-paragraph overview
RuView is an open-source platform that turns standard **WiFi signals** into a spatial-intelligence
and health-monitoring system. By analyzing **Channel State Information (CSI)**, it detects human
presence, tracks movement, and measures **vital signs** (heart and breathing rate) **through walls,
without cameras**. It runs on low-cost **ESP32 edge hardware**, processing everything locally for
privacy. It integrates with smart-home ecosystems (Home Assistant, Apple Home, Google Home, Alexa via
Matter), and ships a large catalog of edge "cog" modules for healthcare, security, and industrial use.
Self-learning AI and spiking neural networks let it adapt to new environments in seconds.

## Key numbers (as stated in the Studio artifacts)
- **$8–$9 per zone** hardware cost (ESP32-S3 nodes); a usable node for under $10.
- **8 KB** quantized CSI embedding model; full self-learning model fits in ~**55 KB**; **2 KB** per-room MicroLoRA adapter.
- **82.69% torso-PCK@20** pose accuracy on the MM-Fi benchmark; **~82.3%** held-out temporal accuracy.
- **17-keypoint** body pose (aligns with the MM-Fi protocol).
- **105 pluggable edge "cog" modules** (e.g. 14 health, 14 security, plus building/industrial/research).
- CSI vital-sign band: a **0.8–4 Hz** filter on wrapped phase isolates chest micro-movement from room noise.
- Cold-start on a Raspberry Pi 5: **~0.4 ms**; embedding speed **~164,000 emb/s**.

## Infographic 1 — "Seeing with WiFi" (the 4-step process)
1. **Capture radio disturbances** — ESP32-S3 sensors read how bodies disrupt WiFi waves via CSI. No cameras, privacy-first.
2. **Edge-AI model processing** — 8 KB quantized models turn raw signals into breathing, heart rate, and 17-keypoint poses.
3. **Deploy specialized "cogs"** — install any of 105 modules (vitals monitoring, security alerts, fall detection, retail heatmaps).
4. **Universal smart-home integration** — broadcasts via MQTT / Matter to Home Assistant, Apple Home (HAP), etc.

## Infographic 2 — "See Through Walls with WiFi" (the value proposition)
- **Complete spatial awareness without cameras** — presence, movement, and 17-keypoint poses through walls and in total darkness.
- **Contactless health & vital monitoring** — breathing, heart rate, and sleep quality with no wearables or contact sensors.
- **High-performance edge-AI accuracy** — 82.3% pose accuracy / 82.69% torso tracking, entirely on local hardware.
- **Privacy-first hardware under $10** — replaces expensive camera systems with $9 ESP32 nodes; no cloud, no internet.
- **Seamless smart-home integration** — works natively with Home Assistant, Apple Home, Google Home, and Alexa via Matter.

## Slide deck — "RuView Spatial Intelligence" (15 slides, see PDF in ../for-humans/)
Titles, in order: (1) Invisible Waves Made Visible · (2) The Post-Camera Spatial Paradigm ·
(3) Physics: Channel State Information (CSI) · (4) Non-Line-of-Sight: Multipath Penetration ·
(5) The 8 KB Intelligence Pipeline · (6) Self-Learning WiFi AI Engine · (7) Absolute Privacy: The BFLD Gate ·
(8) Validated Primitives & Performance Metrics · (9) Applied Spatial Intelligence ·
(10) The Edge Ecosystem: 105 Pluggable Modules · (11) Micro-Intelligence: Health & Security Edge ·
(12) Scaling Intelligence: AI & Swarm Arrays · (13) Deployment Architecture (4 tiers, $0–$140) ·
(14) Universal Ecosystem Integration · (15) The Ambient Computing OS.

## Transcripts in this folder
- `audio-overview.transcript.txt` — the Audio Overview (a journalist↔engineer conversation about RuView).
- `video-explainer.transcript.txt` — the Video Overview narration ("See Through Walls" explainer).
