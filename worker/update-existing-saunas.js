#!/usr/bin/env node
// Update existing saunas in KV with aufguss and gender fields.
// Reads each sauna, adds defaults if missing, writes back.

import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

// Known aufguss saunas among the original 72
const AUFGUSS_SAUNAS = new Set([
  'vabali-spa-berlin',
  'stadtbad-neukolln-berlin',
  'allas-sea-pool-helsinki',
  'centralbadet-stockholm',
  'banya-no1-london',
  'balta-pirts-riga',
  'pirts-nr1-riga',
  'saunamaa-voru',
  'von-sauna-kirkland',
  'warm-hearts-amsterdam',
  'hurlimannbad-zurich',
  'aquabasilea-pratteln',
  'sole-uno-rheinfelden',
  'bernaqua-bern',
  'tamina-therme-bad-ragaz',
  'leukerbad-therme',
  'walliser-alpentherme-leukerbad',
  'bogn-engiadina-scuol',
  'therme-zurzach',
  'ovaverva-st-moritz',
  'tschuggen-bergoase-arosa',
  'seebad-enge-zurich',
  'stadtbad-zurich-hammam',
  'bastuflotten-stockholm',
]);

// Gender overrides for existing saunas
const GENDER_MAP = {
  'stadtbad-neukolln-berlin': 'mixed-separated',  // separate gender days
  'centralbadet-stockholm': 'mixed-separated',      // separate gender areas
  'sanduny-moscow': 'separated',                     // separate male/female sections
  'russian-turkish-baths-nyc': 'mixed-separated',   // co-ed + single-gender times
  'stadtbad-zurich-hammam': 'mixed-separated',      // women-only days
  'hurlimannbad-zurich': 'mixed-separated',          // gender-specific areas
};

// Get the index
const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const allIds = JSON.parse(indexRaw);
console.log(`Total saunas in index: ${allIds.length}`);

let updated = 0;

for (const id of allIds) {
  const key = `sauna:${id}`;
  let raw;
  try {
    raw = execSync(
      `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "${key}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
  } catch {
    console.log(`  SKIP ${key} (read failed)`);
    continue;
  }

  const sauna = JSON.parse(raw);

  // Skip if already has both fields
  if (sauna.aufguss !== undefined && sauna.gender !== undefined) {
    continue;
  }

  // Add missing fields
  let changed = false;
  if (sauna.aufguss === undefined) {
    sauna.aufguss = AUFGUSS_SAUNAS.has(id);
    changed = true;
  }
  if (sauna.gender === undefined) {
    sauna.gender = GENDER_MAP[id] || 'mixed';
    changed = true;
  }

  if (changed) {
    const json = JSON.stringify(sauna);
    console.log(`  Updating ${key} (aufguss=${sauna.aufguss}, gender=${sauna.gender})`);
    execSync(
      `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
      { stdio: 'inherit' }
    );
    updated++;
  }
}

console.log(`\nDone! Updated ${updated} saunas.`);
