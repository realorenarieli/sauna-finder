#!/usr/bin/env node
// Update existing saunas in KV with gear (What to Bring) data.
// Applies smart defaults based on country, type, nude flag, and known specifics.

import { execSync } from 'child_process';

const KV_NAMESPACE_ID = '7a9a6299f79a4c28838ff18d6c7b94a8';

// ── Country-based defaults ──────────────────────────────────────────
const COUNTRY_DEFAULTS = {
  'Finland': { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Sweden':  { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Norway':  { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'Denmark': { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'Iceland': { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'Estonia': { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Latvia':  { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Lithuania':{ towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Russia':  { towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'Germany': { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'Austria': { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'Switzerland': { towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'Netherlands': { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'Belgium': { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'Czech Republic': { towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'Hungary': { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'UK':      { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Ireland': { towel: 'bring', swimwear: 'required', lockers: 'none', shower: 'none' },
  'USA':     { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'Canada':  { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'Japan':   { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'South Korea': { towel: 'provided', swimwear: 'provided', lockers: 'free', shower: 'full' },
  'Turkey':  { towel: 'provided', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Morocco': { towel: 'provided', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Georgia': { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Italy':   { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Spain':   { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Portugal':{ towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'France':  { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'Poland':  { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'Romania': { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'basic' },
  'Australia':{ towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'New Zealand':{ towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
};

const DEFAULT_GEAR = { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' };

// ── Type-based overrides ────────────────────────────────────────────
// These override country defaults where the type is more informative
const TYPE_OVERRIDES = {
  'smoke':              { shower: 'none', lockers: 'none' },   // rustic, often lakeside
  'tent':               { shower: 'none', lockers: 'none', towel: 'bring' },
  'boat':               { shower: 'none', lockers: 'none', towel: 'bring' },
  'russian-banya':      { towel: 'rental', shower: 'full', lockers: 'free' },
  'korean-jjimjilbang': { towel: 'provided', swimwear: 'provided', lockers: 'free', shower: 'full' },
  'japanese-sento':     { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'infrared':           { towel: 'provided', lockers: 'free', shower: 'full' },
  'steam':              { towel: 'rental', lockers: 'free', shower: 'full' },
};

// ── Specific sauna overrides (known from research) ──────────────────
const SPECIFIC_OVERRIDES = {
  // Finnish public saunas — most are nude, bring your own towel, basic showers
  'kotiharjun-helsinki':    { towel: 'bring', swimwear: 'nude', lockers: 'coin', shower: 'basic' },
  'arla-sauna-helsinki':    { towel: 'bring', swimwear: 'nude', lockers: 'coin', shower: 'basic' },
  'sompasauna-helsinki':    { towel: 'bring', swimwear: 'optional', lockers: 'none', shower: 'none' },
  'rajaportti-tampere':     { towel: 'bring', swimwear: 'nude', lockers: 'coin', shower: 'basic' },
  'kaupinojan-tampere':     { towel: 'bring', swimwear: 'nude', lockers: 'coin', shower: 'basic' },
  'kuuma-tampere':          { towel: 'bring', swimwear: 'required', lockers: 'coin', shower: 'basic' },
  'rauhaniemi-tampere':     { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'allas-sea-pool-helsinki':{ towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },
  'loyly-helsinki':         { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },

  // Swiss therme — upscale, full amenities
  'hurlimannbad-zurich':    { towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'aquabasilea-pratteln':   { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'tamina-therme-bad-ragaz':{ towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'leukerbad-therme':       { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },

  // Berlin — nude culture, full facilities
  'vabali-spa-berlin':      { towel: 'rental', swimwear: 'nude', lockers: 'free', shower: 'full' },
  'stadtbad-neukolln-berlin':{ towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },

  // Russian banyas — full service
  'sanduny-moscow':         { towel: 'rental', swimwear: 'optional', lockers: 'free', shower: 'full' },
  'banya-no1-london':       { towel: 'provided', swimwear: 'optional', lockers: 'free', shower: 'full' },

  // NYC
  'russian-turkish-baths-nyc':{ towel: 'rental', swimwear: 'required', lockers: 'coin', shower: 'basic' },

  // Irish outdoor/beach saunas
  'the-sauna-inc-cork':     { towel: 'bring', swimwear: 'required', lockers: 'none', shower: 'none' },

  // Stockholm outdoor bastus
  'hellas-bastu-stockholm': { towel: 'bring', swimwear: 'optional', lockers: 'coin', shower: 'basic' },
  'bastuflotten-stockholm': { towel: 'bring', swimwear: 'optional', lockers: 'none', shower: 'none' },

  // Oslo
  'kok-oslo':               { towel: 'rental', swimwear: 'required', lockers: 'free', shower: 'full' },

  // Copenhagen
  'copenhot-copenhagen':    { towel: 'bring', swimwear: 'required', lockers: 'none', shower: 'none' },

  // Korean jjimjilbang
  'siloam-sauna-seoul':     { towel: 'provided', swimwear: 'provided', lockers: 'free', shower: 'full' },
  'dragon-hill-spa-seoul':  { towel: 'provided', swimwear: 'provided', lockers: 'free', shower: 'full' },
};

function getGear(sauna) {
  // Start with country defaults
  const countryGear = COUNTRY_DEFAULTS[sauna.country] || DEFAULT_GEAR;
  let gear = { ...countryGear };

  // Apply type overrides
  if (sauna.type && TYPE_OVERRIDES[sauna.type]) {
    gear = { ...gear, ...TYPE_OVERRIDES[sauna.type] };
  }

  // Infer swimwear from nude flag (overrides country/type)
  if (sauna.nude === true) {
    gear.swimwear = 'nude';
  } else if (sauna.nude === false) {
    // Keep whatever was set, but don't override to 'nude'
    if (gear.swimwear === 'nude') {
      gear.swimwear = 'optional';
    }
  }

  // Finnish smoke saunas — lakeside, minimal facilities
  if (sauna.country === 'Finland' && sauna.type === 'smoke') {
    gear = { towel: 'bring', swimwear: 'optional', lockers: 'none', shower: 'none' };
  }

  // Irish saunas with "beach" or "outdoor" in highlights — no facilities
  if (sauna.country === 'Ireland') {
    const hl = (sauna.highlights || '').toLowerCase();
    if (hl.includes('beach') || hl.includes('outdoor') || hl.includes('cliff') || hl.includes('sea')) {
      gear.lockers = 'none';
      gear.shower = 'none';
    }
    // Spa-type Irish places
    if (hl.includes('spa') || hl.includes('hotel') || hl.includes('wellness')) {
      gear.towel = 'rental';
      gear.lockers = 'free';
      gear.shower = 'full';
    }
  }

  // Apply specific overrides last (most authoritative)
  if (SPECIFIC_OVERRIDES[sauna.id]) {
    gear = { ...gear, ...SPECIFIC_OVERRIDES[sauna.id] };
  }

  return gear;
}

// ── Main ────────────────────────────────────────────────────────────
const indexRaw = execSync(
  `npx wrangler kv key get --namespace-id="${KV_NAMESPACE_ID}" "sauna:_index"`,
  { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
).trim();

const allIds = JSON.parse(indexRaw);
console.log(`Total saunas in index: ${allIds.length}`);

let updated = 0;
let skipped = 0;
let failed = 0;

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
    failed++;
    continue;
  }

  const sauna = JSON.parse(raw);

  // Skip if already has gear
  if (sauna.gear) {
    skipped++;
    continue;
  }

  // Compute and assign gear
  sauna.gear = getGear(sauna);

  const json = JSON.stringify(sauna);
  try {
    execSync(
      `npx wrangler kv key put --namespace-id="${KV_NAMESPACE_ID}" "${key}" '${json.replace(/'/g, "'\\''")}'`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );
    updated++;
    process.stdout.write(`\r  Updated ${updated}: ${sauna.name} → towel=${sauna.gear.towel}, swim=${sauna.gear.swimwear}, lock=${sauna.gear.lockers}, shower=${sauna.gear.shower}`);
  } catch (err) {
    console.log(`\n  FAIL ${sauna.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\n\nDone! Updated ${updated}, skipped ${skipped} (already had gear), failed ${failed}.`);
