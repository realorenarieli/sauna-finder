#!/usr/bin/env node
// Fix gender data: simplify to 4 categories (mixed, segregated, women-only, men-only)
// and correct inaccurate assignments based on research.

import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

// Saunas that should be "segregated" (separate male/female facilities or alternating gender days)
const SET_SEGREGATED = new Set([
  // Traditional Finnish public saunas — separate men's/women's sections
  'kotiharjun-helsinki',
  'kulttuurisauna-helsinki',
  'sauna-hermanni-helsinki',
  'rajaportti-tampere',
  // Estonian public saunas — gender-separated
  'kalma-saun-tallinn',
  'raua-saun-tallinn',
  'anne-saun-tartu',
  'tallinna-saun',
  // Latvian public baths — gender-separated
  'balta-pirts-riga',
  'pirts-nr1-riga',
  // Russian baths — separate male/female sections
  'sanduny-moscow',
  // German — alternating gender days (most days single-gender)
  'friedrichsbad-baden-baden',
  'stadtbad-neukolln-berlin',
  // Korean jjimjilbang — separated bathing areas
  'spa-land-busan',
  // Ferry sauna — separate men's/women's saunas
  'silja-line-sauna-ferry',
]);

// Saunas currently "mixed-separated" that should just be "mixed"
// (primarily mixed venues with occasional women-only events)
const REVERT_TO_MIXED = new Set([
  'centralbadet-stockholm',
  'russian-turkish-baths-nyc',
  'hurlimannbad-zurich',
  'stadtbad-zurich-hammam',
  'kaifu-bad-hamburg',
  'taunus-therme-bad-homburg',
  'terma-bania-bialka',
]);

// Get the index
const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const allIds = JSON.parse(indexRaw);
console.log(`Total saunas in index: ${allIds.length}`);

let updated = 0;

for (const id of allIds) {
  let newGender = null;

  if (SET_SEGREGATED.has(id)) {
    newGender = 'segregated';
  } else if (REVERT_TO_MIXED.has(id)) {
    newGender = 'mixed';
  }

  if (!newGender) continue;

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
  const oldGender = sauna.gender || 'mixed';

  if (oldGender === newGender) {
    console.log(`  OK ${sauna.name} — already ${newGender}`);
    continue;
  }

  sauna.gender = newGender;
  const json = JSON.stringify(sauna);
  console.log(`  FIX ${sauna.name}: ${oldGender} → ${newGender}`);
  execSync(
    `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
    { stdio: 'inherit' }
  );
  updated++;
}

console.log(`\nDone! Updated ${updated} saunas.`);
