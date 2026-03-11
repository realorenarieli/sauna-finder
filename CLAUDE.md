# Sauna Finder

## Tech Stack
- Vanilla HTML/CSS/JS — no build step
- Leaflet.js + OpenStreetMap for interactive maps
- Static JSON data (`data/saunas.json`) as the sauna database
- Deployed via GitHub Pages

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
See `data/saunas.json` for the schema. Each sauna has scores on 7 dimensions (0-10 each), combined into a weighted total.

## Project Structure
```
index.html          — Main app
style.css           — Styles
app.js              — Map logic, filtering, scoring
data/saunas.json    — Sauna database
assets/             — Icons, markers
```
