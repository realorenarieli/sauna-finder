#!/usr/bin/env node
// Seed script: uploads saunas.json into the COMMUNITY_SAUNAS KV namespace.
// Run once: node seed-kv.js
// Requires wrangler to be configured (wrangler.toml with KV binding).

import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';
const saunasPath = '../data/saunas.json';

const saunas = JSON.parse(readFileSync(saunasPath, 'utf-8'));

console.log(`Seeding ${saunas.length} saunas into KV...`);

// Build the index
const ids = saunas.map(s => s.id);

// Write each sauna as sauna:<id>
for (const sauna of saunas) {
  const data = { ...sauna, curated: true };
  const json = JSON.stringify(data);
  const key = `sauna:${sauna.id}`;
  console.log(`  Writing ${key} (${sauna.name})`);
  execSync(
    `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
    { stdio: 'inherit' }
  );
}

// Write the index
console.log(`  Writing sauna:_index (${ids.length} entries)`);
execSync(
  `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index" '${JSON.stringify(ids)}'`,
  { stdio: 'inherit' }
);

console.log('Done! All saunas seeded.');
