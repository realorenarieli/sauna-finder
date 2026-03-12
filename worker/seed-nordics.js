#!/usr/bin/env node
// Seed script: uploads Nordic saunas (Finland, Sweden, Norway, Denmark, Iceland) into KV.
// Run once: node seed-nordics.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

// Near-duplicates of existing saunas — skip these
const SKIP_IDS = new Set([
  // Already in KV with slightly different IDs
  'kotiharjun-sauna-helsinki',       // = kotiharjun-helsinki
  'rajaportti-sauna-tampere',        // = rajaportti-tampere
  'kaupinoja-sauna-tampere',         // = kaupinojan-tampere
  'saunaravintola-kuuma-tampere',    // = kuuma-tampere
  'hellasgarden-stockholm',          // = hellas-bastu-stockholm
  'kok-oslo-aker-brygge',            // = kok-oslo
  'pust-sauna-tromso',               // = pust-tromso
  'copenhot-refshaleoen',            // = copenhot-copenhagen
  'bastuflotten-relaxa-stockholm',   // = bastuflotten-stockholm
]);

const finland = JSON.parse(readFileSync('../data/saunas-finland.json', 'utf-8'));
const sweden = JSON.parse(readFileSync('../data/saunas-sweden.json', 'utf-8'));
const nordics = JSON.parse(readFileSync('../data/saunas-nordics.json', 'utf-8'));

const allSaunas = [...finland, ...sweden, ...nordics];

console.log(`Total candidates: ${allSaunas.length} (${finland.length} FI + ${sweden.length} SE + ${nordics.length} NO/DK/IS)`);

// Get existing index
const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const existingIds = new Set(JSON.parse(indexRaw));
console.log(`Existing saunas in KV: ${existingIds.size}`);

// Filter out exact dupes, near-dupes, and ensure each new sauna is well-formed
const toSeed = allSaunas.filter(s => {
  if (existingIds.has(s.id)) return false;  // exact match already in KV
  if (SKIP_IDS.has(s.id)) return false;     // near-duplicate
  return true;
});

console.log(`New saunas to seed: ${toSeed.length} (skipping ${allSaunas.length - toSeed.length} dupes)`);

let seeded = 0;
let failed = 0;

for (const sauna of toSeed) {
  // Ensure curated flag
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
    failed++;
  }
}

console.log(`\n\nUpdating index...`);

// Update index with all new IDs
const newIndex = [...existingIds, ...toSeed.map(s => s.id)];
const indexJson = JSON.stringify(newIndex);
execSync(
  `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index" '${indexJson.replace(/'/g, "'\\''")}'`,
  { stdio: 'inherit' }
);

console.log(`\nDone! Seeded ${seeded} new saunas (${failed} failed). Total in index: ${newIndex.length}`);
