// Verify ruvector-kb.rvf with semantic queries.
import { createRequire } from 'module';
import * as fs from 'fs';
const require = createRequire('/Users/stuartkerr/.npm-global/lib/node_modules/');
const { RvfDatabase } = require('@ruvector/rvf');

const ROOT = '/Users/stuartkerr/Code/Cognitum Sensor Primer/cognitum-one-sensor-primer';
const T = await import('file:///Users/stuartkerr/Code/AppealArmor/node_modules/@xenova/transformers/src/transformers.js');
T.env.localModelPath = '/Users/stuartkerr/Code/PowerPlatePulse/scripts/models-cache';
T.env.allowRemoteModels = false;
const embed = await T.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });

const idmap = JSON.parse(fs.readFileSync(`${ROOT}/kb/ruvector-kb.ids.json`, 'utf8')).entries;
const db = await RvfDatabase.openReadonly(`${ROOT}/kb/ruvector-kb.rvf`);
console.log('dimension:', await db.dimension(), '| status:', JSON.stringify(await db.status()));

const queries = [
  'which crate does dynamic min-cut',
  'how do I load an rvf file in Node',
  'SONA LoRA adaptation API',
  'postgres extension install steps',
  'what research exists on sublinear solvers',
];
for (const q of queries) {
  const out = await embed([q], { pooling: 'mean', normalize: true });
  const hits = await db.query(Array.from(out.data), 5);
  console.log(`\nQ: ${q}`);
  for (const h of hits) {
    const m = idmap[h.id] || {};
    console.log(`  ${h.distance.toFixed(4)}  [${m.kind}] ${m.path} (chunk ${m.chunk}/${m.of}) — ${m.title}`);
  }
}
await db.close();
