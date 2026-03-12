# Sauna Finder

## Tech Stack
- Vanilla HTML/CSS/JS — no build step
- Leaflet.js + OpenStreetMap for interactive maps
- Cloudflare Worker + KV for sauna data and URL extraction API
- Deployed via GitHub Pages (frontend) + Cloudflare Workers (backend)

## Commands
```bash
# Local dev — just open index.html or use any static server
python3 -m http.server 8000

# Deploy — push to main, GitHub Pages serves from root
```

## Scoring System
Finnish Public Sauna Affinity Score (0-100), weighted:
- Heat Source: 20% (wood-fired = 10, smoke = 10, electric = 4-5)
- Löyly Quality: 20%
- Communal Atmosphere: 15%
- Water Access: 15%
- No-Frills Factor: 10%
- Tradition/Roots: 10%
- Overall Feeling: 10%

Score badges:
- 80-100: "Practically Finnish"
- 60-79: "Solid Sauna"
- 40-59: "Different Tradition"
- 20-39: "Sauna-Curious"
- 0-19: "Stretching the Definition"

## Data Model
All saunas stored in Cloudflare KV (namespace `COMMUNITY_SAUNAS`). Base saunas have `curated: true`, user-added saunas have `communityAdded: true`. Each sauna has scores on 7 dimensions (0-10 each), combined into a weighted total.

KV keys: `sauna:<id>` → JSON, `sauna:_index` → array of all IDs.

## Project Structure
```
index.html          — Main app
style.css           — Styles
app.js              — Map logic, filtering, scoring
worker/             — Cloudflare Worker (KV API + URL extraction)
  src/index.js      — Worker entry point
  wrangler.toml     — Worker config + KV bindings
  seed-kv.js        — One-time script to seed base saunas into KV
assets/             — Icons, markers
```
