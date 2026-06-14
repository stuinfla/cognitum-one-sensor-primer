# Cognitum One Sensor Primer

A beginner-friendly, visual web primer for anyone who just received a **Cognitum One Seed**
and wants to understand contactless sensing — what ESP32 chips, mmWave radar (LD6004,
with the legacy LD2450 covered), vital-signs radar (MR60BHA2), WiFi CSI nodes, and IMUs actually *do*, how to
**power, wire and battery** them, and **where to buy** every part.

🌐 **Live site:** https://cognitum-sensor-primer.vercel.app
🔗 **About the Seed:** https://cognitum.one

## What's inside

1. **Orientation** — what a Cognitum One Seed is (the brain) vs. sensors (the senses)
2. **ESP32 family** — a full chip-by-chip comparison (extends the espboards.dev SoC guide)
3. **The six sensor classes** — LD6004, MR60BHA2, ESP32 WiFi CSI, M5StickC IMU, Polar H10, and the legacy LD2450
4. **Decision guide** — radar vs. CSI vs. vitals vs. IMU: which to use when
5. **Power & wiring** — connection styles, GPIO pinout, power budget, the five common gotchas
6. **Batteries** — how to power ESP32s scattered around a room (LiPo, 18650, power banks, TP4056)
7. **Shopping list** — sensors, the brain, connectors, and batteries with Amazon links
8. **Glossary** — every term in plain English

## Knowledge bases (`kb/`)

Queryable semantic indexes of ruvnet's **ruvector** and **RuView** repos so an AI assistant can answer from the real source instead of guessing. Each ships in two versions built from the same passages: **big** (768-dim, sharper, for Mac/PC) and **small** (384-dim, lighter, for the Seed).

| In `kb/` | What it is |
|---|---|
| `stores/ruvector/`, `stores/ruview/` | **the deliverables** — `*-kb.big.rvf` + `*-kb.small.rvf` + shared passages/metadata + that repo's primer + a README |
| `ask-kb.mjs`, `kb-mcp-server.mjs`, `guard-check.mjs`, `kb-update.mjs`, `resolve-deps.mjs` | the runtime tools (also shipped inside each bundle) |
| `make-bundles.mjs`, `build-big-variant.mjs`, `build-ruview-kb.mjs`, `.build-ruvector-kb/`, `index-primer.mjs` | build machinery |
| `.last-built.json`, `SOURCE.json`, `*.MANIFEST.md` | provenance |

**Downloads:** the self-contained bundles are published on the rolling [`kb-latest` release](https://github.com/stuinfla/cognitum-one-sensor-primer/releases/tag/kb-latest) (too large for the repo's 100 MB file limit); CI refreshes them when upstream publishes. `node_modules` is gitignored — run `cd kb && npm i` to set up.

## Tech

Plain static site — no build step. `index.html` + `assets/css` + `assets/js` +
generated imagery in `assets/img`. Hand-authored SVG diagrams for the technical content
(accurate by construction); AI-generated atmospheric imagery for mood. Full SEO:
meta + Open Graph + Twitter cards + JSON-LD (`TechArticle` + `FAQPage`) + `sitemap.xml`
+ `robots.txt`.

## Deploy

Hosted on **Vercel**, connected to this GitHub repo — every push to `main` auto-deploys.

## A note on the buy links

Direct Amazon links (▸) were correct at publication but listings change — always open
the page and confirm the exact model and price before buying. Where only a model name is
known, the guide links an Amazon **search** (⌕) rather than risk a wrong product code.
