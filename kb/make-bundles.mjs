#!/usr/bin/env node
// make-bundles.mjs — build the two SELF-CONTAINED, RUNNABLE download zips.
//
// Each bundle contains everything a consumer needs to query the KB on a fresh machine:
//   - the .rvf vector store
//   - the ids/meta JSON metadata sidecar
//   - the .passages.jsonl full-text sidecar (retrieval joins ids -> passages here)
//   - the .rvf.idmap.json internal id map
//   - the MANIFEST
//   - the shared shim scripts: ask-kb.mjs (CLI), kb-mcp-server.mjs (MCP), resolve-deps.mjs
//   - guard-check.mjs (integrity check)
//   - package.json (so `cd kb && npm i` sets up @ruvector/rvf + @xenova/transformers)
//   - the relevant build script
//   - README.md
//
// Usage: node kb/make-bundles.mjs           (both)
//        node kb/make-bundles.mjs ruvector  (one)
// Uses the system `zip` (present on macOS + ubuntu-latest runners).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));

// Canonical host (where the live manifest + bundles are served). One place to change if it moves.
const CANON_BASE = 'https://raw.githubusercontent.com/stuinfla/cognitum-one-sensor-primer/main/kb';
const MANIFEST_URL = `${CANON_BASE}/.last-built.json`;

// files shared by every bundle (the runnable shim + setup + integrity check + evergreen + README)
const SHARED = ['ask-kb.mjs', 'kb-mcp-server.mjs', 'resolve-deps.mjs', 'guard-check.mjs',
  'kb-update.mjs', 'SOURCE.json', 'package.json', 'README.md'];

// Regenerate SOURCE.json from .last-built.json so the embedded provenance NEVER drifts from
// the manifest. Carries BOTH stores; kb-update.mjs reads this to know "where I came from".
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
      canonicalBundleUrl: `${CANON_BASE}/${kbName}-kb-bundle.zip`,
      selfUpdate: `node kb-update.mjs ${kbName}`,
    };
  }
  const source = {
    builder: 'rvf-kb-forge',
    builtUtc,
    canonicalManifestUrl: MANIFEST_URL,
    selfUpdate: 'node kb-update.mjs',
    stores,
  };
  fs.writeFileSync(path.join(KB_DIR, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
  console.log('regenerated SOURCE.json from .last-built.json');
}
writeSourceJson();

const BUNDLES = {
  ruvector: {
    zip: 'ruvector-kb-bundle.zip',
    files: [
      'ruvector-kb.rvf',
      'ruvector-kb.ids.json',
      'ruvector-kb.passages.jsonl',
      'ruvector-kb.rvf.idmap.json',
      'ruvector-kb.MANIFEST.md',
      '.build-ruvector-kb/build.mjs',
    ],
  },
  ruview: {
    zip: 'ruview-kb-bundle.zip',
    files: [
      'ruview-kb.rvf',
      'ruview-kb.meta.json',
      'ruview-kb.passages.jsonl',
      'ruview-kb.rvf.idmap.json',
      'ruview-kb.MANIFEST.md',
      'build-ruview-kb.mjs',
    ],
  },
};

function build(name) {
  const b = BUNDLES[name];
  const all = [...b.files, ...SHARED];
  // verify every file exists before zipping (fail loud, never ship a partial bundle)
  const missing = all.filter((f) => !fs.existsSync(path.join(KB_DIR, f)));
  if (missing.length) throw new Error(`${name}: missing files for bundle: ${missing.join(', ')}`);

  // Stage into a temp dir so .build-ruvector-kb/build.mjs keeps its subdir path inside the zip.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), `kb-bundle-${name}-`));
  for (const f of all) {
    const src = path.join(KB_DIR, f);
    const dst = path.join(stage, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  const out = path.join(KB_DIR, b.zip);
  fs.rmSync(out, { force: true });
  // -r recurse, -X strip extra attrs for reproducibility; run inside the stage dir.
  execFileSync('zip', ['-r', '-X', out, '.'], { cwd: stage, stdio: 'inherit' });
  fs.rmSync(stage, { recursive: true, force: true });
  const size = fs.statSync(out).size;
  console.log(`built ${b.zip} (${(size / 1e6).toFixed(1)} MB, ${all.length} files)`);
}

const which = process.argv[2];
const targets = which ? [which] : Object.keys(BUNDLES);
for (const name of targets) {
  if (!BUNDLES[name]) { console.error(`unknown bundle '${name}'`); process.exit(2); }
  build(name);
}
