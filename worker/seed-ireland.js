#!/usr/bin/env node
// Seed script: uploads Ireland saunas into COMMUNITY_SAUNAS KV.
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

const saunas = JSON.parse(readFileSync('../data/saunas-ireland.json', 'utf-8'));
console.log(`Seeding ${saunas.length} Irish saunas...`);

const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const existingIds = new Set(JSON.parse(indexRaw));
console.log(`Existing saunas in KV: ${existingIds.size}`);

const toSeed = saunas.filter(s => !existingIds.has(s.id));
console.log(`New saunas to seed: ${toSeed.length}`);

let seeded = 0;
for (const sauna of toSeed) {
  sauna.curated = true;
  const key = `sauna:${sauna.id}`;
  const json = JSON.stringify(sauna);
  try {
    execSync(
      `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    seeded++;
    process.stdout.write(`\r  Seeded ${seeded}/${toSeed.length}: ${sauna.name}`);
  } catch (err) {
    console.log(`\n  FAIL ${sauna.name}: ${err.message}`);
  }
}

console.log(`\n\nUpdating index...`);
const newIndex = [...existingIds, ...toSeed.map(s => s.id)];
execSync(
  `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index" '${JSON.stringify(newIndex).replace(/'/g, "'\\''")}'`,
  { stdio: 'inherit' }
);
console.log(`Done! Seeded ${seeded}. Total in index: ${newIndex.length}`);
