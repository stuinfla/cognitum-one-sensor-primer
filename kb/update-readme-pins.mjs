#!/usr/bin/env node
// update-readme-pins.mjs — refresh the KB README's generated-date and write the
// .last-built.json marker with the pinned submodule SHAs after a rebuild.
//
// Run in CI after the guard passes and bundles are rebuilt. Safe to run locally too.
// Reads the current submodule SHAs from `git -C <sub> rev-parse HEAD`; if git isn't
// available (e.g. detached artifact) it falls back to 'unknown' and still writes the date.
//
// Usage: node kb/update-readme-pins.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KB_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.KB_REPO_ROOT || path.resolve(KB_DIR, '..');

function gitSha(sub) {
  try {
    return execFileSync('git', ['-C', path.join(ROOT, sub), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
}
function gitDescribe(sub) {
  try {
    return execFileSync('git', ['-C', path.join(ROOT, sub), 'describe', '--tags', '--always'], { encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
}

const today = new Date();
const dateLong = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
const iso = today.toISOString();

const ruvectorSha = gitSha('ruvector');
const ruviewSha = gitSha('RuView');
const ruviewDesc = gitDescribe('RuView');

// --- 1. write the build marker ---
const marker = {
  generated: iso,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  dimensions: 384,
  metric: 'cosine',
  stores: {
    ruvector: { rvf: 'ruvector-kb.rvf', sourceRepo: 'github.com/ruvnet/ruvector', sha: ruvectorSha },
    ruview: { rvf: 'ruview-kb.rvf', sourceRepo: 'github.com/ruvnet/RuView', sha: ruviewSha, describe: ruviewDesc },
  },
};
fs.writeFileSync(path.join(KB_DIR, '.last-built.json'), JSON.stringify(marker, null, 2) + '\n');
console.log('wrote .last-built.json:', JSON.stringify(marker.stores));

// --- 2. refresh the README "Built from same-day submodule checkouts" provenance line ---
const readmePath = path.join(KB_DIR, 'README.md');
let readme = fs.readFileSync(readmePath, 'utf8');
const provLine = `Built from same-day submodule checkouts; both upstream repos ship daily. The manifests and \`.last-built.json\` carry the exact provenance/SHAs.`;
const newProvLine = `Built ${dateLong} from same-day submodule checkouts (ruvector \`${ruvectorSha.slice(0, 8)}\`, RuView \`${ruviewDesc}\`); both upstream repos ship daily. The manifests and \`.last-built.json\` carry the exact provenance/SHAs.`;
if (readme.includes(provLine)) {
  readme = readme.replace(provLine, newProvLine);
} else {
  // idempotent: replace a previously-stamped line (matches the "Built <date> from same-day" prefix)
  readme = readme.replace(/Built [^.]*from same-day submodule checkouts[^.]*\.[^.]*\.[^.]*carry the exact provenance\/SHAs\./,
    newProvLine);
}
fs.writeFileSync(readmePath, readme);
console.log('README provenance line updated:', newProvLine);
