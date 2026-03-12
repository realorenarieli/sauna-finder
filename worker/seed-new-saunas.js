#!/usr/bin/env node
// Seed script: uploads Germany + Poland saunas into COMMUNITY_SAUNAS KV.
// Run once: node seed-new-saunas.js

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

// Gender overrides — most German saunas are mixed, a few have separated days/zones
const GENDER_MAP = {
  // Germany — mixed-separated (women-only days or zones)
  'kaifu-bad-hamburg': 'mixed-separated',       // Tuesdays women-only
  'taunus-therme-bad-homburg': 'mixed-separated', // has women-only zone
  'friedrichsbad-baden-baden': 'mixed-separated',  // alternating gender days
  // Poland — mixed-separated
  'terma-bania-bialka': 'mixed-separated',        // daily ladies-only session
};

const germany = JSON.parse(readFileSync('../data/saunas-germany.json', 'utf-8'));
const poland = JSON.parse(readFileSync('../data/saunas.json', 'utf-8'));

const allSaunas = [...germany, ...poland];

console.log(`Seeding ${allSaunas.length} saunas (${germany.length} Germany + ${poland.length} Poland)...`);

// Get existing index
const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const existingIds = JSON.parse(indexRaw);
console.log(`Existing index has ${existingIds.length} entries`);

const newIds = [];

for (const sauna of allSaunas) {
  // Add gender field
  sauna.gender = GENDER_MAP[sauna.id] || 'mixed';
  // Ensure aufguss field exists
  if (sauna.aufguss === undefined) sauna.aufguss = false;
  // Mark as curated
  sauna.curated = true;

  const key = `sauna:${sauna.id}`;
  const json = JSON.stringify(sauna);

  // Check if already exists
  if (existingIds.includes(sauna.id)) {
    console.log(`  SKIP ${key} (already exists)`);
    continue;
  }

  console.log(`  Writing ${key} (${sauna.name}, ${sauna.city})`);
  execSync(
    `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
    { stdio: 'inherit' }
  );
  newIds.push(sauna.id);
}

// Update the index with new IDs
if (newIds.length > 0) {
  const updatedIds = [...existingIds, ...newIds];
  console.log(`\n  Updating index: ${existingIds.length} → ${updatedIds.length} entries (+${newIds.length} new)`);

  // Write index to temp file to avoid shell escaping issues
  const { writeFileSync } = await import('fs');
  const tmpPath = '/tmp/kv_index_update.json';
  writeFileSync(tmpPath, JSON.stringify(updatedIds));

  execSync(
    `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index" "$(cat ${tmpPath})"`,
    { stdio: 'inherit' }
  );
} else {
  console.log('\nNo new saunas to add.');
}

console.log(`\nDone! ${newIds.length} new saunas seeded.`);
