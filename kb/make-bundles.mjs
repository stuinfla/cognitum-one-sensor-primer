#!/usr/bin/env node
// make-bundles.mjs — build the SELF-CONTAINED, RUNNABLE download zips (one per repo).
//
// Each bundle ships BOTH variants of that repo's KB (big 768-dim + small 384-dim) plus the
// ONE shared passages/metadata sidecar (the big variant re-uses the small build's passages,
// so we never double the ~92 MB text in the download), the runnable tools, the evergreen
// self-updater, a full README, BOTH primers (ruvector + ruview — two halves of one Seed), and a
// repo-specific START-HERE.md generated below.
//
// Usage: node kb/make-bundles.mjs           (both repos)
//        node kb/make-bundles.mjs ruvector  (one)
// Uses the system `zip` (present on macOS + ubuntu-latest runners).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Canonical hosts. The MANIFEST (.last-built.json) is small + lives in the repo, served raw.
// The BUNDLES are large (the big .rvf alone > GitHub's 100MB file limit), so they're hosted as
// assets on the ROLLING `kb-latest` GitHub Release — a permanent URL CI keeps current.
const CANON_BASE = 'https://raw.githubusercontent.com/stuinfla/cognitum-one-sensor-primer/main/kb';
const MANIFEST_URL = `${CANON_BASE}/.last-built.json`;
const RELEASE_BASE = 'https://github.com/stuinfla/cognitum-one-sensor-primer/releases/download/kb-latest';

// files shared by every bundle (the runnable shim + setup + integrity check + evergreen + README)
const SHARED = ['ask-kb.mjs', 'kb-mcp-server.mjs', 'resolve-deps.mjs', 'guard-check.mjs',
  'kb-update.mjs', 'SOURCE.json', 'package.json', 'README.md'];

// BOTH primers ship in EVERY bundle (src-relative-to-KB_DIR, dest-inside-zip). The ruvector and
// ruview stories are two halves of the same Seed, so a reader of either KB gets the full picture.
const ALL_PRIMERS = [
  ['stores/ruvector/ruvector-primer.md', 'ruvector-primer.md'],
  ['stores/ruview/ruview-primer.md', 'ruview-primer.md'],
];

// Regenerate SOURCE.json from .last-built.json so embedded provenance never drifts from the manifest.
function writeSourceJson() {
  const manifestPath = path.join(KB_DIR, '.last-built.json');
  if (!fs.existsSync(manifestPath)) throw new Error('cannot write SOURCE.json: .last-built.json missing (build first)');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const builtUtc = m.generated;
  const stores = {};
  for (const [kbName, s] of Object.entries(m.stores || {})) {
    stores[kbName] = {
      kbName,
      sourceRepo: s.sourceRepo || null,
      sourceCommit: s.sha || null,
      sourceDescribe: s.describe || null,
      builtUtc,
      builder: 'rvf-kb-forge',
      canonicalManifestUrl: MANIFEST_URL,
      canonicalBundleUrl: `${RELEASE_BASE}/${kbName}-kb-bundle.zip`,
      selfUpdate: `node kb-update.mjs ${kbName}`,
    };
  }
  fs.writeFileSync(path.join(KB_DIR, 'SOURCE.json'), JSON.stringify({
    builder: 'rvf-kb-forge', builtUtc, canonicalManifestUrl: MANIFEST_URL,
    selfUpdate: 'node kb-update.mjs', stores,
  }, null, 2) + '\n');
  console.log('regenerated SOURCE.json from .last-built.json');
}
writeSourceJson();

const BUNDLES = {
  ruvector: {
    zip: 'ruvector-kb-bundle.zip',
    label: 'ruvector',
    blurb: 'ruvnet/ruvector — the ~1.7M-line Rust AI engine (vector search, learning, coherence, math) inside the Cognitum One Seed.',
    // per-repo DATA files (live in stores/ruvector/, staged FLAT into the zip)
    dataFiles: ['ruvector-kb.small.rvf', 'ruvector-kb.small.rvf.idmap.json', 'ruvector-kb.passages.jsonl',
      'ruvector-kb.ids.json', 'ruvector-kb.MANIFEST.md'],
    // big (optional — included only if built; also in stores/ruvector/)
    bigFiles: ['ruvector-kb.big.rvf', 'ruvector-kb.big.rvf.idmap.json', 'ruvector-kb.big.rvf.embed.json'],
    // build scripts (live in kb/, staged preserving their path)
    scriptFiles: ['.build-ruvector-kb/build.mjs', 'build-big-variant.mjs', 'index-primer.mjs'],
    questions: [
      'What is ruvector and what is it for?',
      'Which crate implements dynamic min-cut, and how does it work?',
      'How does SONA learn and adapt over time?',
      'What does the coherence gate decide, and how?',
      'How do I load an RVF file and run a query in Node?',
      'Which crates are production-ready vs experimental?',
    ],
  },
  ruview: {
    zip: 'ruview-kb-bundle.zip',
    label: 'ruview',
    blurb: 'ruvnet/RuView — the WiFi-CSI / mmWave-radar contactless sensing platform the Seed runs (presence, occupancy, vitals, onboarding).',
    dataFiles: ['ruview-kb.small.rvf', 'ruview-kb.small.rvf.idmap.json', 'ruview-kb.passages.jsonl',
      'ruview-kb.meta.json', 'ruview-kb.MANIFEST.md'],
    bigFiles: ['ruview-kb.big.rvf', 'ruview-kb.big.rvf.idmap.json', 'ruview-kb.big.rvf.embed.json'],
    scriptFiles: ['build-ruview-kb.mjs', 'build-big-variant.mjs', 'index-primer.mjs'],
    // NotebookLM Studio extras (audio/video/slides/infographics + AI-readable text), staged
    // recursively from stores/ruview/studio/ into the zip under studio/for-humans|for-ai/.
    studioDir: 'studio',
    questions: [
      'What is RuView and what can it sense?',
      'How does it tell an empty room from an occupied one?',
      'How is a Cognitum Seed onboarded and pretrained?',
      'How does an ESP32 CSI node stream data to the Seed?',
      "What's the difference between presence detection and occupancy?",
      'How do I connect it to Apple Home / Siri?',
    ],
  },
};

// Recursively collect [absPath, relPath] for every file under absDir (relPath rooted at relBase).
// Used to sweep a bundle's studio/ tree so new Studio outputs are picked up without editing lists.
function walkDir(absDir, relBase) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, entry.name);
    const rel = path.posix.join(relBase, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(abs, rel));
    else if (entry.isFile() && !entry.name.startsWith('.')) out.push([abs, rel]);
  }
  return out;
}

// A tailored one-page intro generated INTO each zip so a first-timer knows exactly what they have.
function startHere(b, hasBig) {
  const q = b.questions.map((x) => `- "${x}"`).join('\n');
  const studio = b.studioDir ? `

## Bonus: NotebookLM Studio media (in \`studio/\`)
This bundle also ships an AI-generated media pack about RuView, split by audience:
- 👤 **\`studio/for-humans/\`** — watch/listen/read: a **video explainer** (.mp4), an **audio overview** (.mp3), a **slide deck** (.pdf), and two **infographics** (.png).
- 🤖 **\`studio/for-ai/\`** — plain text for assistants to ingest: **transcripts** of the audio + video, a machine-readable **notebook-summary.md**, and a README index.
` : '';
  return `# START HERE — the ${b.label} knowledge base

**What you just unzipped:** a searchable "brain" for **${b.blurb}**

You don't need to understand vector databases to use this. Two things:

## 1. Which file do I use?
You got **two versions of the same knowledge**:
- 🖥️ **BIG** \`${b.label}-kb.big.rvf\` → **use on your Mac/PC** (sharper answers).${hasBig ? '' : '  *(not included in this copy — build it with `node build-big-variant.mjs both`)*'}
- 🌱 **SMALL** \`${b.label}-kb.rvf\` → **use on the Cognitum One Seed** (lighter, runs on the device).

The tools auto-pick BIG if it's here, else SMALL. You don't have to choose by hand.

## 2. Try it in 3 commands
\`\`\`bash
npm i                                              # one time (needs Node 18+)
node ask-kb.mjs ${b.label} "${b.questions[0]}" 5
\`\`\`

## The best use: point your AI assistant at it
Connect it to Claude Code / Cursor / VS Code so your assistant answers from the REAL ${b.label} code instead of guessing. Full steps are in **README.md → section 3, Way 1** (a 2-line \`.mcp.json\` + 1 line in your \`CLAUDE.md\`).

## Questions this KB answers well
${q}

## Two primers are included (read both)
The Seed is **ruvector** (the AI engine) running on **RuView** (the sensing platform) — two halves of one story. So every bundle ships **both** primers, whichever KB you downloaded:
- 📘 **ruvector-primer.md** — the AI/vector/learning engine
- 📗 **ruview-primer.md** — the WiFi-CSI / mmWave sensing platform
${studio}
---
**New to the whole thing?** Open **README.md** — it explains what an RVF knowledge base is from scratch, in plain English. New to the Seed device itself? See the primer at https://cognitum-sensor-primer.vercel.app and the first-run setup at https://cognitum.shaal.dev/.
`;
}

function build(name) {
  const b = BUNDLES[name];
  const storeDir = path.join(KB_DIR, 'stores', name);   // per-repo data lives here
  // include big files only if they all exist (so the script works before/without a big build)
  const bigPresent = b.bigFiles.every((f) => fs.existsSync(path.join(storeDir, f)));
  const dataNames = bigPresent ? [...b.dataFiles, ...b.bigFiles] : b.dataFiles;

  // (src absolute path, dest path-inside-zip) pairs. Data + shared go FLAT; scripts keep their path.
  const studioPairs = b.studioDir ? walkDir(path.join(storeDir, b.studioDir), b.studioDir) : [];
  // Guard: a bundle that DECLARES studio media must not ship without it. Catches an accidental
  // gitignore / missing checkout in CI BEFORE make-bundles produces a studio-less zip that would
  // clobber the good Release. Fail RED instead of silently shipping an incomplete download.
  if (b.studioDir && studioPairs.filter(([, rel]) => rel.includes('for-humans/')).length === 0) {
    throw new Error(`${name}: studioDir '${b.studioDir}' is set but no for-humans/ media was found under ` +
      `${path.join(storeDir, b.studioDir)}. Refusing to build a studio-less bundle — are the studio ` +
      `files committed and checked out? (If you truly want to drop studio, remove studioDir from BUNDLES.)`);
  }
  const pairs = [
    ...dataNames.map((f) => [path.join(storeDir, f), f]),
    ...b.scriptFiles.map((f) => [path.join(KB_DIR, f), f]),
    ...SHARED.map((f) => [path.join(KB_DIR, f), f]),
    ...ALL_PRIMERS.map(([src, dst]) => [path.join(KB_DIR, src), dst]),  // both primers in every bundle
    ...studioPairs,  // NotebookLM Studio extras (ruview only): studio/for-humans|for-ai/**
  ];
  const missing = pairs.filter(([src]) => !fs.existsSync(src)).map(([src]) => src);
  if (missing.length) throw new Error(`${name}: missing files for bundle:\n  ${missing.join('\n  ')}`);

  // Stage into a temp dir so subdir paths (.build-ruvector-kb/build.mjs) survive inside the zip.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `kb-bundle-${name}-`));
  for (const [src, rel] of pairs) {
    const dst = path.join(stage, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  // write the generated, repo-specific one-pager
  fs.writeFileSync(path.join(stage, 'START-HERE.md'), startHere(b, bigPresent));

  const out = path.join(KB_DIR, b.zip);
  fs.rmSync(out, { force: true });
  execFileSync('zip', ['-r', '-X', out, '.'], { cwd: stage, stdio: 'inherit' });
  fs.rmSync(stage, { recursive: true, force: true });
  const size = fs.statSync(out).size;
  console.log(`built ${b.zip} (${(size / 1e6).toFixed(1)} MB, ${pairs.length + 1} files, big=${bigPresent ? 'YES' : 'no'})`);
}

const which = process.argv[2];
const targets = which ? [which] : Object.keys(BUNDLES);
for (const name of targets) {
  if (!BUNDLES[name]) { console.error(`unknown bundle '${name}'`); process.exit(2); }
  build(name);
}
