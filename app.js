/* ─────────────────────────────────────────────
   Sauna Finder — app.js
   ───────────────────────────────────────────── */

// ── Constants ────────────────────────────────
const DEFAULT_WEIGHTS = {
  heatSource: 0.20,
  loylyQuality: 0.20,
  communalAtmosphere: 0.15,
  waterAccess: 0.15,
  noFrills: 0.10,
  tradition: 0.10,
  overall: 0.10,
};

const DIMENSION_LABELS = {
  heatSource: 'Heat Source',
  loylyQuality: 'Loyly Quality',
  communalAtmosphere: 'Communal',
  waterAccess: 'Water Access',
  noFrills: 'No-Frills',
  tradition: 'Tradition',
  overall: 'Overall Feel',
};

const RATING_LABELS = ['', 'Not for me', 'Meh', 'Decent', 'Great', 'Incredible'];

const TYPE_LABELS = {
  'wood-fired': 'Wood-fired',
  'smoke': 'Smoke',
  'electric': 'Electric',
  'russian-banya': 'Russian Banya',
  'korean-jjimjilbang': 'Jjimjilbang',
  'japanese-sento': 'Sento',
  'boat': 'Boat Sauna',
  'tent': 'Tent Sauna',
  'infrared': 'Infrared',
  'steam': 'Steam',
  'traditional-finnish': 'Traditional Finnish',
  'other': 'Other',
};

const TYPE_ICONS = {
  'wood-fired': '🪵',
  'smoke': '💨',
  'electric': '⚡',
  'russian-banya': '🪆',
  'korean-jjimjilbang': '🏯',
  'japanese-sento': '🎌',
  'boat': '⛵',
  'tent': '⛺',
  'infrared': '〰️',
  'steam': '♨️',
  'traditional-finnish': '🌲',
  'other': '♨️',
};

const GENDER_LABELS = {
  'mixed': 'Mixed',
  'segregated': 'Segregated',
  'women-only': 'Women Only',
  'men-only': 'Men Only',
};

const GEAR_LABELS = {
  towel:    { bring: 'Bring towel', rental: 'Towel rental', provided: 'Towel provided' },
  swimwear: { required: 'Swimwear required', optional: 'Swimwear optional', nude: 'Nude only' },
  lockers:  { free: 'Free lockers', coin: 'Coin lockers', 'bring-lock': 'Bring a lock', none: 'No lockers' },
  shower:   { full: 'Showers + toiletries', basic: 'Showers (bring soap)', none: 'No showers' },
};

const GEAR_ICONS = {
  towel:    { bring: '🧺', rental: '🔄', provided: '✅' },
  swimwear: { required: '👙', optional: '🤷', nude: '🫣' },
  lockers:  { free: '🔒', coin: '🪙', 'bring-lock': '🔓', none: '❌' },
  shower:   { full: '🚿', basic: '🧴', none: '🚫' },
};

// Worker URL — update after deploying Cloudflare Worker
const WORKER_URL = 'https://sauna-finder-extractor.oren-arieli.workers.dev';

const SCORE_DIMS = ['heatSource', 'loylyQuality', 'communalAtmosphere', 'waterAccess', 'noFrills', 'tradition', 'overall'];

// ── State ────────────────────────────────────
let saunas = [];
let filteredSaunas = [];
let profile = loadProfile();
let selectedId = null;
let ratingTarget = null;
let ratingValue = 0;
let map, markerLayer;
let markerMode = 'type'; // 'score' or 'type' or 'nude'
let userLocation = null; // { lat, lng } from geolocation
let mapBoundsFilter = null; // L.LatLngBounds or null
let searchAreaBtn = null;
let mapInteracted = false;
let mapViewBeforeDetail = null; // { center, zoom } saved before opening detail

// ── Profile (localStorage) ───────────────────
function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('saunaProfile')) || {
      ratings: {},
      wishlist: {},
      preferences: null,
      onboardingDone: false,
    };
  } catch {
    return { ratings: {}, wishlist: {}, preferences: null, onboardingDone: false };
  }
}

function ensureProfileFields() {
  if (!profile.wishlist) profile.wishlist = {};
}

function saveProfile() {
  localStorage.setItem('saunaProfile', JSON.stringify(profile));
}

// ── Saunas API (Worker KV) ──────────────────

async function fetchSaunas() {
  const res = await fetch(WORKER_URL + '/saunas');
  if (!res.ok) throw new Error('Failed to load saunas');
  saunas = await res.json();
}

async function addCommunitySauna(data) {
  const res = await fetch(WORKER_URL + '/saunas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to save sauna');
  }
  const sauna = await res.json();
  saunas.push(sauna);
  return sauna;
}

async function removeCommunitySauna(id) {
  const res = await fetch(WORKER_URL + '/saunas?id=' + encodeURIComponent(id), {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete sauna');
  }
  saunas = saunas.filter(s => s.id !== id);
}

// ── Geocoding (Nominatim) ───────────────────
async function geocodeQuery(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'SaunaFinder/1.0 (sauna-finder@github)' } }
    );
    const data = await res.json();
    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.error('Geocoding failed for query:', query, e);
  }
  return null;
}

async function geocodeAddress(address, city, country) {
  // Try progressively broader queries until one works
  const queries = [
    [address, city, country],
    [city, country],
    [city],
  ].map(parts => parts.filter(Boolean).join(', ')).filter(q => q.length > 0);

  // Deduplicate
  const seen = new Set();
  let first = true;
  for (const q of queries) {
    if (seen.has(q)) continue;
    seen.add(q);
    // Nominatim asks for max 1 req/sec
    if (!first) await new Promise(r => setTimeout(r, 1100));
    first = false;
    const result = await geocodeQuery(q);
    if (result) return result;
  }
  return null;
}

// ── Scoring ──────────────────────────────────
function calcScore(sauna, weights) {
  const dims = Object.keys(DEFAULT_WEIGHTS);
  return dims.reduce((sum, d) => sum + (sauna.scores[d] / 10) * weights[d], 0) * 100;
}

function finnishScore(sauna) {
  return calcScore(sauna, DEFAULT_WEIGHTS);
}

function findSimilar(sauna, count = 5) {
  const dims = Object.keys(DEFAULT_WEIGHTS);
  return saunas
    .filter(s => s.id !== sauna.id)
    .map(s => {
      const dist = Math.sqrt(dims.reduce((sum, d) => {
        const diff = (sauna.scores[d] || 5) - (s.scores[d] || 5);
        return sum + diff * diff;
      }, 0));
      return { sauna: s, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count);
}

function scoreTier(score) {
  if (score >= 80) return { label: 'Practically Finnish', cls: 'top' };
  if (score >= 60) return { label: 'Solid Sauna', cls: 'high' };
  if (score >= 40) return { label: 'Different Tradition', cls: 'mid' };
  if (score >= 20) return { label: 'Sauna-Curious', cls: 'low' };
  return { label: 'Stretching the Definition', cls: 'bottom' };
}

// ── Recommendation Engine ────────────────────
function computeLearnedWeights() {
  const ratedIds = Object.keys(profile.ratings);
  if (ratedIds.length < 2) return null;

  const dims = Object.keys(DEFAULT_WEIGHTS);
  const ratedSaunas = ratedIds.map(id => saunas.find(s => s.id === id)).filter(Boolean);
  if (ratedSaunas.length < 2) return null;

  // Correlation-based: how well does each dimension predict user happiness?
  const correlations = {};
  for (const dim of dims) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const sauna of ratedSaunas) {
      const rating = (profile.ratings[sauna.id] - 1) / 4; // normalize 0-1
      const dimScore = sauna.scores[dim] / 10;             // normalize 0-1
      weightedSum += rating * dimScore;
      totalWeight += dimScore; // avoid bias toward saunas that score 0 everywhere
    }
    correlations[dim] = totalWeight > 0 ? weightedSum / ratedSaunas.length : 0;
  }

  // Normalize to sum to 1
  const total = Object.values(correlations).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const learned = {};
  for (const dim of dims) {
    learned[dim] = correlations[dim] / total;
  }

  // Blend with defaults — more ratings = more trust in learned weights
  const alpha = Math.min(1, ratedSaunas.length / 8);
  const blended = {};
  for (const dim of dims) {
    blended[dim] = alpha * learned[dim] + (1 - alpha) * DEFAULT_WEIGHTS[dim];
  }

  return blended;
}

function getEffectiveWeights() {
  // Priority: learned from ratings > onboarding preferences > defaults
  const learned = computeLearnedWeights();
  if (learned) return learned;

  if (profile.preferences) {
    // Convert preference sliders (0-10) to weights
    const dims = Object.keys(DEFAULT_WEIGHTS);
    const total = dims.reduce((s, d) => s + (profile.preferences[d] || 5), 0);
    const weights = {};
    for (const d of dims) {
      weights[d] = (profile.preferences[d] || 5) / total;
    }
    return weights;
  }

  return DEFAULT_WEIGHTS;
}

function forYouScore(sauna) {
  const weights = getEffectiveWeights();
  // Only show "For You" if weights differ from defaults
  if (weights === DEFAULT_WEIGHTS && !profile.preferences) return null;
  return calcScore(sauna, weights);
}

function hasPersonalScores() {
  return Object.keys(profile.ratings).length >= 2 || profile.preferences !== null;
}

function topRecommendations(count = 3) {
  if (!hasPersonalScores()) return [];
  const weights = getEffectiveWeights();
  return saunas
    .filter(s => !profile.ratings[s.id])
    .map(s => ({ sauna: s, score: calcScore(s, weights) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count);
}

// ── Hours parser / "Open now" ────────────────
const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

function parseHoursSpec(hoursStr) {
  if (!hoursStr) return null;
  const lower = hoursStr.toLowerCase();

  // 24/7
  if (lower.includes('24/7')) return { alwaysOpen: true };

  // "Daily (hours vary...)" — no concrete times
  if (/daily\s*\(/.test(lower) && !lower.match(/daily\s+\d/)) return null;

  // Strip parenthetical notes
  const cleaned = hoursStr.replace(/\([^)]*\)/g, '').trim();

  // Split on comma to get segments like "Mon-Fri 07:00-20:30"
  const segments = cleaned.split(',').map(s => s.trim()).filter(Boolean);
  const schedule = {}; // day-of-week (0-6) → { open, close } or 'closed'

  for (const seg of segments) {
    const closedMatch = seg.match(/^(\w{3}(?:-\w{3})?)\s+closed$/i);
    if (closedMatch) {
      for (const d of expandDayRange(closedMatch[1])) schedule[d] = 'closed';
      continue;
    }

    const match = seg.match(/^(daily|\w{3}(?:-\w{3})?(?:\s*,\s*\w{3}(?:-\w{3})?)*)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if (!match) continue;

    const dayPart = match[1].toLowerCase();
    const open = parseTime(match[2]);
    const close = parseTime(match[3]);

    const days = dayPart === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : expandDayRange(dayPart);
    for (const d of days) schedule[d] = { open, close };
  }

  return Object.keys(schedule).length > 0 ? { schedule } : null;
}

function expandDayRange(str) {
  const parts = str.toLowerCase().split('-');
  if (parts.length === 1) {
    const d = DAY_MAP[parts[0]];
    return d != null ? [d] : [];
  }
  const start = DAY_MAP[parts[0]];
  const end = DAY_MAP[parts[1]];
  if (start == null || end == null) return [];
  const days = [];
  let i = start;
  while (true) {
    days.push(i);
    if (i === end) break;
    i = (i + 1) % 7;
  }
  return days;
}

function parseTime(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function isOpenNow(hoursStr) {
  const spec = parseHoursSpec(hoursStr);
  if (!spec) return null; // unknown
  if (spec.alwaysOpen) return true;

  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const entry = spec.schedule[dayOfWeek];
  if (!entry) return null; // no data for today
  if (entry === 'closed') return false;

  // Handle overnight (close time < open time means past midnight)
  if (entry.close <= entry.open) {
    return nowMinutes >= entry.open || nowMinutes < entry.close;
  }
  return nowMinutes >= entry.open && nowMinutes < entry.close;
}

function openNowTag(hoursStr) {
  const open = isOpenNow(hoursStr);
  if (open === null) return '';
  return open
    ? '<span class="tag tag-open">Open now</span>'
    : '<span class="tag tag-closed">Closed</span>';
}

// ── Map ──────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([54, 18], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);
  markerLayer = L.markerClusterGroup({
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    iconCreateFunction(cluster) {
      const count = cluster.getChildCount();
      const size = count > 20 ? 40 : count > 5 ? 34 : 28;
      return L.divIcon({
        html: `<div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:var(--accent,#6b5234);color:#fdf9f4;
          display:flex;align-items:center;justify-content:center;
          font-size:12px;font-weight:700;
          box-shadow:0 2px 6px rgba(59,47,32,0.3);
          font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;
        ">${count}</div>`,
        className: 'sauna-cluster',
        iconSize: [size, size],
      });
    },
  }).addTo(map);

  // "Near me" geolocation control
  const LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('div', 'leaflet-bar locate-btn');
      btn.innerHTML = '<button title="Near me" class="locate-button">&#9737;</button>';
      btn.style.cursor = 'pointer';
      L.DomEvent.disableClickPropagation(btn);
      btn.querySelector('button').addEventListener('click', locateUser);
      return btn;
    },
  });
  new LocateControl().addTo(map);

  // Marker mode toggle control
  const MarkerToggle = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'marker-toggle leaflet-bar');
      container.innerHTML = `
        <button class="marker-toggle-btn" data-mode="score" title="Show scores">123</button>
        <button class="marker-toggle-btn active" data-mode="type" title="Show types">⛵</button>
        <button class="marker-toggle-btn" data-mode="nude" title="Show nude policy">🍆</button>
      `;
      L.DomEvent.disableClickPropagation(container);
      container.querySelectorAll('.marker-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          markerMode = btn.dataset.mode;
          container.querySelectorAll('.marker-toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderMarkers();
        });
      });
      return container;
    },
  });
  new MarkerToggle().addTo(map);

  // "Show all" / fit bounds control
  const ShowAllControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const btn = L.DomUtil.create('div', 'leaflet-bar locate-btn');
      btn.innerHTML = '<button title="Show all saunas" class="locate-button" style="font-size:16px">⊞</button>';
      btn.style.cursor = 'pointer';
      L.DomEvent.disableClickPropagation(btn);
      btn.querySelector('button').addEventListener('click', () => {
        if (selectedId) closeDetail();
        fitMapToSaunas();
      });
      return btn;
    },
  });
  new ShowAllControl().addTo(map);

  // "Search this area" control
  const AreaSearch = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const btn = L.DomUtil.create('button', 'search-area-btn leaflet-bar');
      btn.innerHTML = 'Search this area';
      btn.type = 'button';
      btn.style.display = 'none';
      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click', () => {
        mapBoundsFilter = map.getBounds();
        btn.style.display = 'none';
        refreshAll();
      });
      searchAreaBtn = btn;
      return btn;
    },
  });
  new AreaSearch().addTo(map);

  // Show "Search this area" after user pans/zooms
  map.on('moveend', () => {
    if (searchAreaBtn && mapBoundsFilter) {
      searchAreaBtn.style.display = 'block';
    }
  });
  map.on('zoomend moveend', () => {
    if (searchAreaBtn && !mapBoundsFilter) {
      // Only show after first user interaction (not initial load)
      if (mapInteracted) searchAreaBtn.style.display = 'block';
    }
    mapInteracted = true;
  });
}

// ── Geolocation ─────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceToUser(sauna) {
  if (!userLocation || sauna.lat == null || sauna.lng == null) return Infinity;
  return haversineKm(userLocation.lat, userLocation.lng, sauna.lat, sauna.lng);
}

function formatDistance(km) {
  if (km === Infinity) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

let userLocationMarker = null;

function locateUser() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      // Add/update user location marker
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      userLocationMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
        radius: 8, color: '#3a6b8b', fillColor: '#5ba3d9', fillOpacity: 0.9, weight: 2,
      }).addTo(map).bindTooltip('You are here', { className: 'sauna-tooltip' });

      // Switch to nearest sort
      document.getElementById('sort-by').value = 'nearest';
      map.flyTo([userLocation.lat, userLocation.lng], 8, { duration: 1 });
      refreshAll();
    },
    err => {
      alert('Could not get your location. Make sure location access is allowed.');
      console.warn('Geolocation error:', err);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function renderMarkers() {
  markerLayer.clearLayers();
  for (const sauna of filteredSaunas) {
    if (sauna.lat == null || sauna.lng == null) continue;
    const isSelected = sauna.id === selectedId;
    const size = isSelected ? 32 : 26;
    const half = size / 2;

    let content, fontSize, bg, border, color;
    if (markerMode === 'type') {
      content = TYPE_ICONS[sauna.type] || '♨️';
      fontSize = isSelected ? 16 : 14;
      bg = isSelected ? '#6b5234' : '#fdf9f4';
      border = '#6b5234';
      color = isSelected ? '#fdf9f4' : '#6b5234';
    } else if (markerMode === 'nude') {
      content = sauna.nude ? '🍆' : '👖';
      fontSize = isSelected ? 16 : 13;
      bg = isSelected ? (sauna.nude ? '#3a6b8b' : '#6b5234') : (sauna.nude ? '#e4eef6' : '#fdf9f4');
      border = sauna.nude ? '#3a6b8b' : '#b0a090';
      color = sauna.nude ? '#3a6b8b' : '#6b5234';
    } else {
      content = Math.round(finnishScore(sauna));
      fontSize = isSelected ? 12 : 10;
      bg = isSelected ? '#6b5234' : '#fdf9f4';
      border = '#6b5234';
      color = isSelected ? '#fdf9f4' : '#6b5234';
    }

    const borderStyle = sauna.communityAdded ? 'dashed' : 'solid';
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        width: ${size}px; height: ${size}px;
        border-radius: 50%;
        background: ${bg};
        border: 2px ${borderStyle} ${border};
        box-shadow: 0 1px 4px rgba(59,47,32,0.25);
        display: flex; align-items: center; justify-content: center;
        font-size: ${fontSize}px; font-weight: 600;
        color: ${color};
        transition: all 0.15s;
        line-height: 1;
      ">${content}</div>`,
      iconSize: [size, size],
      iconAnchor: [half, half],
    });

    const marker = L.marker([sauna.lat, sauna.lng], { icon })
      .on('click', () => openDetail(sauna.id))
      .bindTooltip(sauna.name, { offset: [0, -14], className: 'sauna-tooltip' });

    markerLayer.addLayer(marker);
  }
}

// ── UI: Sauna List ───────────────────────────
function renderList() {
  const list = document.getElementById('sauna-list');
  // Sauna count badge
  const countBadge = document.getElementById('sauna-count');
  if (countBadge) {
    countBadge.textContent = filteredSaunas.length === saunas.length
      ? `${saunas.length} saunas`
      : `Showing ${filteredSaunas.length} of ${saunas.length}`;
  }

  if (filteredSaunas.length === 0) {
    list.innerHTML = '<p style="padding:20px;color:var(--text-light);text-align:center">No saunas match your filters</p>';
    return;
  }

  list.innerHTML = filteredSaunas.map(sauna => {
    const fs = finnishScore(sauna);
    const fy = forYouScore(sauna);
    const isVisited = !!profile.ratings[sauna.id];
    const isWishlisted = !!profile.wishlist[sauna.id];

    return `
      <div class="sauna-card ${selectedId === sauna.id ? 'active' : ''}" data-id="${sauna.id}">
        <div class="sauna-card-info">
          <div class="sauna-card-name">${isWishlisted ? '<span class="wishlist-indicator" title="On your wishlist">&#9829;</span> ' : ''}${sauna.name}</div>
          <div class="sauna-card-location">${sauna.city}, ${sauna.country}${userLocation && sauna.lat != null ? ` &middot; ${formatDistance(distanceToUser(sauna))}` : ''}</div>
          <div class="sauna-card-meta">
            ${openNowTag(sauna.hours)}
            <span class="tag">${TYPE_LABELS[sauna.type] || sauna.type}</span>
            <span class="tag">${sauna.price}</span>
            ${sauna.nude ? '<span class="tag tag-nude">DICKS OUT</span>' : ''}
            ${sauna.aufguss ? '<span class="tag tag-aufguss">AUFGUSS</span>' : ''}
            ${sauna.gender && sauna.gender !== 'mixed' ? `<span class="tag tag-gender">${GENDER_LABELS[sauna.gender] || sauna.gender}</span>` : ''}
            ${sauna.communityAdded ? '<span class="tag tag-user-added">Community</span>' : ''}
            ${isVisited ? `<span class="tag">${'★'.repeat(profile.ratings[sauna.id])} visited</span>` : ''}
          </div>
        </div>
        <div class="score-col">
          <div class="score-num">${Math.round(fs)}</div>
          ${fy !== null ? `<div class="score-foryou">${Math.round(fy)} for you</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Card click handlers
  list.querySelectorAll('.sauna-card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
}

// ── UI: Detail Panel ─────────────────────────
function openDetail(id) {
  const sauna = saunas.find(s => s.id === id);
  if (!sauna) return;
  selectedId = id;

  // Save map view before zooming in
  if (!selectedId) {
    mapViewBeforeDetail = { center: map.getCenter(), zoom: map.getZoom() };
  }

  // Update URL hash for deep linking (pushState so back button works)
  history.pushState({ sauna: id }, '', `#sauna/${id}`);

  const fs = finnishScore(sauna);
  const fy = forYouScore(sauna);
  const tier = scoreTier(fs);
  const fyTier = fy !== null ? scoreTier(fy) : null;
  const isVisited = !!profile.ratings[sauna.id];
  const isWishlisted = !!profile.wishlist[sauna.id];
  const dims = Object.keys(DEFAULT_WEIGHTS);
  const effectiveW = hasPersonalScores() ? getEffectiveWeights() : null;

  const content = document.getElementById('detail-content');
  content.innerHTML = `
    <div class="detail-header">
      <div class="detail-name">${sauna.name}</div>
      <div class="detail-location">${sauna.city}, ${sauna.country}</div>
      <div class="detail-scores">
        <div class="detail-score-block">
          <div class="detail-score-number">${Math.round(fs)}</div>
          <div class="detail-score-label">Finnish Affinity</div>
          <div class="detail-score-tier">${tier.label}</div>
        </div>
        ${fy !== null ? `
        <div class="detail-score-block">
          <div class="detail-score-number">${Math.round(fy)}</div>
          <div class="detail-score-label">For You</div>
          <div class="detail-score-tier">${fyTier.label}</div>
        </div>` : ''}
      </div>
    </div>

    <div class="detail-section">
      <h3>Info</h3>
      <div class="detail-info-row">
        <span class="detail-info-label">Type</span>
        <span class="detail-info-value">${TYPE_LABELS[sauna.type] || sauna.type}${sauna.nude ? ' <span class="tag tag-nude">DICKS OUT</span>' : ''}${sauna.aufguss ? ' <span class="tag tag-aufguss">AUFGUSS</span>' : ''}${sauna.gender ? ` <span class="tag tag-gender">${GENDER_LABELS[sauna.gender] || sauna.gender}</span>` : ''}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Address</span>
        <span class="detail-info-value">${sauna.address} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sauna.address + ', ' + sauna.city)}" target="_blank" rel="noopener" class="maps-link" title="Open in Google Maps">&#x1F5FA;</a></span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Hours</span>
        <span class="detail-info-value">${openNowTag(sauna.hours)} ${sauna.hours}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Price</span>
        <span class="detail-info-value">${sauna.price}</span>
      </div>
      ${sauna.website ? `<div class="detail-info-row">
        <span class="detail-info-label">Website</span>
        <span class="detail-info-value"><a href="${sauna.website}" target="_blank" rel="noopener">Visit</a></span>
      </div>` : ''}
    </div>

    <div class="detail-section">
      <h3>What's Special</h3>
      <p class="detail-highlights">${sauna.highlights}</p>
    </div>

    ${sauna.gear ? `<div class="detail-section">
      <h3>What to Bring</h3>
      <div class="gear-grid">
        ${['towel', 'swimwear', 'lockers', 'shower'].map(cat => {
          const val = sauna.gear[cat];
          if (!val) return '';
          return `<div class="gear-item">
            <span class="gear-icon">${GEAR_ICONS[cat][val] || ''}</span>
            <span class="gear-text">${GEAR_LABELS[cat][val] || val}</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}

    <div class="detail-section">
      <h3>Score Breakdown</h3>
      ${dims.map(d => `
        <div class="breakdown-row">
          <span class="breakdown-label">${DIMENSION_LABELS[d]}</span>
          <div class="breakdown-bar">
            <div class="breakdown-fill" style="width:${sauna.scores[d] * 10}%"></div>
          </div>
          <span class="breakdown-value">${sauna.scores[d]}</span>
        </div>
      `).join('')}
      ${hasPersonalScores() ? `
      <div class="weight-compare">
        <h3>Your Weights</h3>
        ${dims.map(d => {
          const defaultW = (DEFAULT_WEIGHTS[d] * 100).toFixed(0);
          const yourW = (effectiveW[d] * 100).toFixed(0);
          return `<div class="weight-row">
            <span class="weight-label">${DIMENSION_LABELS[d]}</span>
            <span class="weight-default">${defaultW}%</span>
            <span class="weight-arrow">&rarr;</span>
            <span class="weight-yours">${yourW}%</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>

    <div class="detail-section">
      <h3>More Like This</h3>
      <div class="similar-saunas">
        ${findSimilar(sauna).map(({ sauna: s, dist }) => `
          <div class="similar-item" data-id="${s.id}">
            <span class="similar-name">${s.name}</span>
            <span class="similar-location">${s.city}, ${s.country}</span>
            <span class="similar-score">${Math.round(finnishScore(s))}</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn btn-share" onclick="copyShareLink('${sauna.id}')">
        &#128279; Copy Link
      </button>
      <button class="btn btn-wishlist ${isWishlisted ? 'wishlisted' : ''}" onclick="toggleWishlist('${sauna.id}')">
        ${isWishlisted ? '&#9829; On Wishlist' : '&#9825; Add to Wishlist'}
      </button>
      ${isVisited
        ? `<button class="btn" onclick="openRating('${sauna.id}')">
            ${'★'.repeat(profile.ratings[sauna.id])} Visited &mdash; re-rate
          </button>`
        : `<button class="btn btn-primary" onclick="openRating('${sauna.id}')">
            Mark as Visited & Rate
          </button>`
      }
    </div>
    ${isVisited ? `<button class="link-btn" onclick="removeRating('${sauna.id}')">Remove visit</button>` : ''}
    ${sauna.communityAdded ? `<button class="link-btn link-btn-danger" onclick="deleteUserSauna('${sauna.id}')">Delete this sauna</button>` : ''}
  `;

  // Similar sauna click handlers
  content.querySelectorAll('.similar-item').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id));
  });

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('visible'));

  // Fly to marker and uncluster it
  if (sauna.lat != null && sauna.lng != null) {
    // Find the marker in the cluster group
    let targetMarker = null;
    markerLayer.eachLayer(m => {
      if (!targetMarker && m.getLatLng().lat === sauna.lat && m.getLatLng().lng === sauna.lng) {
        targetMarker = m;
      }
    });
    if (targetMarker) {
      // zoomToShowLayer zooms/spiderfies as needed to reveal the marker
      markerLayer.zoomToShowLayer(targetMarker, () => {
        map.panTo(targetMarker.getLatLng(), { animate: true, duration: 0.5 });
      });
    } else {
      map.flyTo([sauna.lat, sauna.lng], Math.max(map.getZoom(), 14), { duration: 0.8 });
    }
  }

  renderMarkers();
  renderList();
}

function closeDetail(skipHistory) {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.add('hidden'), 200);
  selectedId = null;
  if (!skipHistory) {
    history.pushState(null, '', window.location.pathname);
  }
  // Restore previous map view
  if (mapViewBeforeDetail) {
    map.flyTo(mapViewBeforeDetail.center, mapViewBeforeDetail.zoom, { duration: 0.6 });
    mapViewBeforeDetail = null;
  }
  renderMarkers();
  renderList();
}

// ── Rating ───────────────────────────────────
function openRating(id) {
  ratingTarget = id;
  ratingValue = profile.ratings[id] || 0;
  const sauna = saunas.find(s => s.id === id);

  document.getElementById('rating-sauna-name').textContent = sauna.name;
  document.getElementById('rating-modal').classList.remove('hidden');
  document.getElementById('rating-save').disabled = ratingValue === 0;
  updateStars();
  updateRatingLabel();
}

function updateStars() {
  document.querySelectorAll('#star-rating .star').forEach(star => {
    star.classList.toggle('active', parseInt(star.dataset.value) <= ratingValue);
  });
}

function updateRatingLabel() {
  document.getElementById('rating-label').textContent = RATING_LABELS[ratingValue] || 'Select a rating';
}

function closeRating() {
  document.getElementById('rating-modal').classList.add('hidden');
  ratingTarget = null;
  ratingValue = 0;
}

function saveRating() {
  if (!ratingTarget || ratingValue < 1) return;
  profile.ratings[ratingTarget] = ratingValue;
  saveProfile();
  closeRating();
  refreshAll();
  if (selectedId) openDetail(selectedId);
}

function removeRating(id) {
  delete profile.ratings[id];
  saveProfile();
  refreshAll();
  if (selectedId === id) openDetail(id);
}

// ── Wishlist ────────────────────────────────
function toggleWishlist(id) {
  if (profile.wishlist[id]) {
    delete profile.wishlist[id];
  } else {
    profile.wishlist[id] = true;
  }
  saveProfile();
  refreshAll();
  if (selectedId) openDetail(selectedId);
}

// ── Onboarding ───────────────────────────────
function showOnboarding() {
  if (profile.onboardingDone) return;
  document.getElementById('onboarding-modal').classList.remove('hidden');
}

function skipOnboarding() {
  profile.onboardingDone = true;
  saveProfile();
  document.getElementById('onboarding-modal').classList.add('hidden');
}

function saveOnboarding() {
  const prefs = {};
  document.querySelectorAll('.pref-sliders input[type="range"]').forEach(slider => {
    prefs[slider.dataset.dim] = parseInt(slider.value);
  });
  profile.preferences = prefs;
  profile.onboardingDone = true;
  saveProfile();
  document.getElementById('onboarding-modal').classList.add('hidden');
  refreshAll();
}

// ── Taste Profile ────────────────────────────
function renderTasteProfile() {
  const container = document.getElementById('taste-profile');
  const barsEl = document.getElementById('taste-bars');
  const hintEl = document.getElementById('taste-hint');

  if (!hasPersonalScores()) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  const weights = getEffectiveWeights();
  const dims = Object.keys(DEFAULT_WEIGHTS);
  const maxW = Math.max(...dims.map(d => weights[d]));

  barsEl.innerHTML = dims.map(d => {
    const pct = (weights[d] / maxW) * 100;
    return `
      <div class="taste-bar">
        <span class="taste-bar-label">${DIMENSION_LABELS[d]}</span>
        <div class="taste-bar-track">
          <div class="taste-bar-fill" style="width:${pct}%"></div>
        </div>
        <span class="taste-bar-value">${(weights[d] * 100).toFixed(0)}%</span>
      </div>
    `;
  }).join('');

  // Find top 2 dimensions
  const sorted = dims.slice().sort((a, b) => weights[b] - weights[a]);
  const top2 = sorted.slice(0, 2).map(d => DIMENSION_LABELS[d]);
  const ratingCount = Object.keys(profile.ratings).length;

  if (ratingCount >= 2) {
    hintEl.textContent = `Based on ${ratingCount} rating${ratingCount > 1 ? 's' : ''}, you value ${top2.join(' and ')} most.`;
  } else if (profile.preferences) {
    hintEl.textContent = `Based on your preferences. Rate 2+ saunas to refine.`;
  }
}

// ── Taste Profile Edit Mode ─────────────────
function openTasteEdit() {
  const slidersEl = document.getElementById('taste-sliders');
  const editEl = document.getElementById('taste-edit');
  const barsEl = document.getElementById('taste-bars');
  const hintEl = document.getElementById('taste-hint');

  // Get current preference values (from profile or defaults at 5)
  const current = profile.preferences || {};
  const dims = Object.keys(DEFAULT_WEIGHTS);

  slidersEl.innerHTML = dims.map(d => {
    const val = current[d] != null ? current[d] : 5;
    return `
      <label>
        <span class="taste-slider-label">${DIMENSION_LABELS[d]}</span>
        <input type="range" min="0" max="10" value="${val}" data-dim="${d}" />
        <span class="taste-slider-value">${val}</span>
      </label>
    `;
  }).join('');

  // Wire up live value display
  slidersEl.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.addEventListener('input', () => {
      slider.nextElementSibling.textContent = slider.value;
    });
  });

  barsEl.classList.add('hidden');
  hintEl.classList.add('hidden');
  editEl.classList.remove('hidden');
}

function closeTasteEdit() {
  document.getElementById('taste-edit').classList.add('hidden');
  document.getElementById('taste-bars').classList.remove('hidden');
  document.getElementById('taste-hint').classList.remove('hidden');
}

function saveTasteEdit() {
  const prefs = {};
  document.querySelectorAll('#taste-sliders input[type="range"]').forEach(slider => {
    prefs[slider.dataset.dim] = parseInt(slider.value);
  });
  profile.preferences = prefs;
  profile.onboardingDone = true;
  saveProfile();
  closeTasteEdit();
  refreshAll();
}

// ── "You Might Love" ─────────────────────────
function renderRecommendations() {
  // Remove existing
  const existing = document.querySelector('.might-love');
  if (existing) existing.remove();

  const recs = topRecommendations(3);
  if (recs.length === 0) return;

  const html = `
    <div class="might-love">
      <h3>You Might Love</h3>
      <ul class="might-love-list">
        ${recs.map(r => `
          <li class="might-love-item" data-id="${r.sauna.id}">
            <span>${r.sauna.name} — ${r.sauna.city}</span>
            <span class="might-love-score">${Math.round(r.score)}</span>
          </li>
        `).join('')}
      </ul>
    </div>
  `;

  const tasteEl = document.getElementById('taste-profile');
  tasteEl.insertAdjacentHTML('afterend', html);

  document.querySelectorAll('.might-love-item').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id));
  });
}

// ── Filtering & Sorting ──────────────────────
function applyFilters() {
  const search = document.getElementById('search').value.toLowerCase();
  const type = document.getElementById('filter-type').value;
  const country = document.getElementById('filter-country').value;
  const nude = document.getElementById('filter-nude').value;
  const gender = document.getElementById('filter-gender').value;
  const openFilter = document.getElementById('filter-open').value;
  const wishlist = document.getElementById('filter-wishlist').value;

  filteredSaunas = saunas.filter(s => {
    if (search && !s.name.toLowerCase().includes(search) && !s.city.toLowerCase().includes(search) && !s.country.toLowerCase().includes(search)) return false;
    if (type !== 'all' && s.type !== type) return false;
    if (country !== 'all' && s.country !== country) return false;
    if (nude === 'nude' && !s.nude) return false;
    if (nude === 'clothed' && s.nude) return false;
    if (gender !== 'all' && (s.gender || 'mixed') !== gender) return false;
    if (openFilter === 'open' && isOpenNow(s.hours) !== true) return false;
    if (wishlist === 'wishlist' && !profile.wishlist[s.id]) return false;
    if (wishlist === 'visited' && !profile.ratings[s.id]) return false;
    if (wishlist === 'community' && !s.communityAdded) return false;
    if (wishlist === 'aufguss' && !s.aufguss) return false;
    // Map bounds filter
    if (mapBoundsFilter && s.lat != null && s.lng != null) {
      if (!mapBoundsFilter.contains(L.latLng(s.lat, s.lng))) return false;
    }
    return true;
  });

  applySorting();
}

function applySorting() {
  const sort = document.getElementById('sort-by').value;
  const weights = getEffectiveWeights();

  filteredSaunas.sort((a, b) => {
    switch (sort) {
      case 'finnish': return finnishScore(b) - finnishScore(a);
      case 'foryou': return calcScore(b, weights) - calcScore(a, weights);
      case 'nearest': return distanceToUser(a) - distanceToUser(b);
      case 'name': return a.name.localeCompare(b.name);
      case 'city': return a.city.localeCompare(b.city);
      case 'price': return parsePriceApprox(a.price) - parsePriceApprox(b.price);
      default: return 0;
    }
  });
}

function parsePriceApprox(priceStr) {
  if (!priceStr) return 999;
  if (priceStr.toLowerCase() === 'free') return 0;
  const match = priceStr.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : 999;
}

// ── Filter badge ────────────────────────────
function updateFilterBadge() {
  const activeCount = [
    document.getElementById('filter-type').value !== 'all',
    document.getElementById('filter-country').value !== 'all',
    document.getElementById('filter-nude').value !== 'all',
    document.getElementById('filter-gender').value !== 'all',
    document.getElementById('filter-open').value !== 'all',
    document.getElementById('filter-wishlist').value !== 'all',
  ].filter(Boolean).length;

  const badge = document.getElementById('filter-badge');
  const btn = document.getElementById('filter-toggle');
  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.classList.remove('hidden');
    btn.classList.add('active');
  } else {
    badge.classList.add('hidden');
    btn.classList.remove('active');
    // Collapse drawer if no active filters and it's open
  }
}

// ── Country filter population ────────────────
function populateCountryFilter() {
  const countries = [...new Set(saunas.map(s => s.country))].sort();
  const select = document.getElementById('filter-country');
  for (const c of countries) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
}

// ── Refresh everything ───────────────────────
function fitMapToFiltered() {
  const withCoords = filteredSaunas.filter(s => s.lat != null && s.lng != null);
  if (withCoords.length === 0) return;
  if (withCoords.length === 1) {
    map.flyTo([withCoords[0].lat, withCoords[0].lng], 12, { duration: 0.8 });
    return;
  }
  const bounds = L.latLngBounds(withCoords.map(s => [s.lat, s.lng]));
  map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8 });
}

function fitMapToSaunas() {
  const withCoords = saunas.filter(s => s.lat != null && s.lng != null);
  if (withCoords.length === 0) return;
  const bounds = L.latLngBounds(withCoords.map(s => [s.lat, s.lng]));
  mapBoundsFilter = null;
  if (searchAreaBtn) searchAreaBtn.style.display = 'none';
  map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8 });
}

function refreshAll(fitMap = false) {
  applyFilters();
  renderList();
  renderMarkers();
  renderTasteProfile();
  renderRecommendations();
  if (fitMap) fitMapToFiltered();
}

// ── Event Listeners ──────────────────────────
function setupListeners() {
  // Search & filters
  document.getElementById('search').addEventListener('input', refreshAll);
  document.getElementById('sort-by').addEventListener('change', refreshAll);
  document.getElementById('filter-type').addEventListener('change', () => { updateFilterBadge(); refreshAll(); });
  document.getElementById('filter-nude').addEventListener('change', () => { updateFilterBadge(); refreshAll(); });
  document.getElementById('filter-gender').addEventListener('change', () => { updateFilterBadge(); refreshAll(); });
  document.getElementById('filter-open').addEventListener('change', () => { updateFilterBadge(); refreshAll(); });
  document.getElementById('filter-wishlist').addEventListener('change', () => { updateFilterBadge(); refreshAll(); });
  document.getElementById('filter-country').addEventListener('change', () => { updateFilterBadge(); refreshAll(true); });

  // Filter drawer toggle
  document.getElementById('filter-toggle').addEventListener('click', () => {
    const drawer = document.getElementById('filter-drawer');
    const btn = document.getElementById('filter-toggle');
    const isCollapsed = drawer.classList.toggle('collapsed');
    btn.classList.toggle('active', !isCollapsed);
    localStorage.setItem('filtersCollapsed', isCollapsed ? '1' : '');
  });

  // Restore filter drawer state
  if (localStorage.getItem('filtersCollapsed') === '') {
    document.getElementById('filter-drawer').classList.remove('collapsed');
    document.getElementById('filter-toggle').classList.add('active');
  }

  // Clear all filters
  document.getElementById('filter-clear').addEventListener('click', () => {
    document.getElementById('filter-type').value = 'all';
    document.getElementById('filter-country').value = 'all';
    document.getElementById('filter-nude').value = 'all';
    document.getElementById('filter-gender').value = 'all';
    document.getElementById('filter-open').value = 'all';
    document.getElementById('filter-wishlist').value = 'all';
    mapBoundsFilter = null;
    if (searchAreaBtn) searchAreaBtn.style.display = 'none';
    updateFilterBadge();
    refreshAll();
  });

  // Collapsible taste profile
  document.getElementById('taste-toggle').addEventListener('click', () => {
    const header = document.getElementById('taste-toggle');
    const body = document.getElementById('taste-body');
    const isCollapsed = header.classList.toggle('collapsed');
    body.classList.toggle('collapsed', isCollapsed);
    localStorage.setItem('tasteCollapsed', isCollapsed ? '1' : '');
  });

  // Restore collapsed state
  if (localStorage.getItem('tasteCollapsed') === '1') {
    document.getElementById('taste-toggle').classList.add('collapsed');
    document.getElementById('taste-body').classList.add('collapsed');
  }

  // Taste profile edit
  document.getElementById('taste-edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openTasteEdit();
  });
  document.getElementById('taste-edit-cancel').addEventListener('click', closeTasteEdit);
  document.getElementById('taste-edit-save').addEventListener('click', saveTasteEdit);

  // Detail panel close
  document.getElementById('close-detail').addEventListener('click', closeDetail);

  // Rating modal
  document.querySelectorAll('#star-rating .star').forEach(star => {
    star.addEventListener('click', () => {
      ratingValue = parseInt(star.dataset.value);
      updateStars();
      updateRatingLabel();
      document.getElementById('rating-save').disabled = false;
    });
    star.addEventListener('mouseenter', () => {
      document.querySelectorAll('#star-rating .star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.value) <= parseInt(star.dataset.value));
      });
    });
  });

  document.getElementById('star-rating').addEventListener('mouseleave', updateStars);
  document.getElementById('rating-save').addEventListener('click', saveRating);
  document.getElementById('rating-cancel').addEventListener('click', closeRating);

  // Onboarding
  document.getElementById('onboarding-skip').addEventListener('click', skipOnboarding);
  document.getElementById('onboarding-save').addEventListener('click', saveOnboarding);

  // Onboarding slider values
  document.querySelectorAll('.pref-sliders input[type="range"]').forEach(slider => {
    slider.addEventListener('input', () => {
      slider.nextElementSibling.textContent = slider.value;
    });
  });

  // Add Sauna modal
  document.getElementById('add-sauna-btn').addEventListener('click', openAddSauna);
  document.getElementById('add-sauna-cancel').addEventListener('click', closeAddSauna);
  document.getElementById('add-sauna-save').addEventListener('click', saveAddSauna);
  document.getElementById('extract-btn').addEventListener('click', extractFromUrl);

  // Add Sauna score slider value displays
  document.querySelectorAll('.add-scores input[type="range"]').forEach(slider => {
    slider.addEventListener('input', () => {
      slider.nextElementSibling.textContent = slider.value;
    });
  });

  // Remove invalid class on input
  ['add-name', 'add-city', 'add-country'].forEach(id => {
    document.getElementById(id).addEventListener('input', function() {
      this.classList.remove('invalid');
    });
  });

  // CSV
  document.getElementById('csv-download-btn').addEventListener('click', downloadCSV);
  document.getElementById('csv-upload-input').addEventListener('change', e => {
    if (e.target.files[0]) {
      uploadCSV(e.target.files[0]);
      e.target.value = ''; // reset so same file can be re-uploaded
    }
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('add-sauna-modal').classList.contains('hidden')) {
        closeAddSauna();
      } else if (!document.getElementById('rating-modal').classList.contains('hidden')) {
        closeRating();
      } else if (!document.getElementById('detail-panel').classList.contains('hidden')) {
        closeDetail();
      }
    }
  });
}

// ── Add Sauna Modal ─────────────────────────
function openAddSauna() {
  resetAddSaunaForm();
  document.getElementById('add-sauna-modal').classList.remove('hidden');
}

function closeAddSauna() {
  document.getElementById('add-sauna-modal').classList.add('hidden');
  resetAddSaunaForm();
}

function resetAddSaunaForm() {
  document.getElementById('extract-url').value = '';
  document.getElementById('extract-status').textContent = '';
  document.getElementById('extract-status').className = 'extract-status';
  document.getElementById('add-name').value = '';
  document.getElementById('add-city').value = '';
  document.getElementById('add-country').value = '';
  document.getElementById('add-address').value = '';
  document.getElementById('add-type').value = 'other';
  document.getElementById('add-hours').value = '';
  document.getElementById('add-price').value = '';
  document.getElementById('add-website').value = '';
  document.getElementById('add-nude').checked = false;
  document.getElementById('add-aufguss').checked = false;
  document.getElementById('add-gender').value = 'mixed';
  document.getElementById('add-highlights').value = '';
  SCORE_DIMS.forEach(d => {
    const el = document.getElementById('add-score-' + d);
    el.value = 5;
    el.nextElementSibling.textContent = '5';
  });
}

async function extractFromUrl() {
  const url = document.getElementById('extract-url').value.trim();
  const status = document.getElementById('extract-status');

  if (!url) {
    status.textContent = 'Enter a URL first';
    status.className = 'extract-status error';
    return;
  }

  try { new URL(url); } catch {
    status.textContent = 'Invalid URL';
    status.className = 'extract-status error';
    return;
  }

  status.textContent = 'Extracting sauna data...';
  status.className = 'extract-status loading';
  document.getElementById('extract-btn').disabled = true;

  try {
    const res = await fetch(WORKER_URL + '/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    const data = await res.json();

    if (!res.ok) {
      status.textContent = data.error || 'Extraction failed';
      status.className = 'extract-status error';
      return;
    }

    // Fill form with extracted data
    if (data.name) document.getElementById('add-name').value = data.name;
    if (data.city) document.getElementById('add-city').value = data.city;
    if (data.country) document.getElementById('add-country').value = data.country;
    if (data.address) document.getElementById('add-address').value = data.address;
    if (data.type) document.getElementById('add-type').value = data.type;
    if (data.hours) document.getElementById('add-hours').value = data.hours;
    if (data.price) document.getElementById('add-price').value = data.price;
    if (data.website) document.getElementById('add-website').value = data.website;
    if (data.nude != null) document.getElementById('add-nude').checked = data.nude;
    if (data.aufguss != null) document.getElementById('add-aufguss').checked = data.aufguss;
    if (data.gender) document.getElementById('add-gender').value = data.gender;
    if (data.highlights) document.getElementById('add-highlights').value = data.highlights;
    if (data.scores) {
      SCORE_DIMS.forEach(d => {
        const el = document.getElementById('add-score-' + d);
        const val = data.scores[d] ?? 5;
        el.value = val;
        el.nextElementSibling.textContent = val;
      });
    }

    status.textContent = 'Data extracted! Review and save below.';
    status.className = 'extract-status success';
  } catch (err) {
    console.error('Extract error:', err);
    status.textContent = 'Network error. Fill in manually.';
    status.className = 'extract-status error';
  } finally {
    document.getElementById('extract-btn').disabled = false;
  }
}

async function saveAddSauna() {
  const name = document.getElementById('add-name').value.trim();
  const city = document.getElementById('add-city').value.trim();
  const country = document.getElementById('add-country').value.trim();

  // Validate required fields
  let valid = true;
  ['add-name', 'add-city', 'add-country'].forEach(id => {
    const el = document.getElementById(id);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      valid = false;
    } else {
      el.classList.remove('invalid');
    }
  });
  if (!valid) return;

  const scores = {};
  SCORE_DIMS.forEach(d => {
    scores[d] = parseInt(document.getElementById('add-score-' + d).value);
  });

  const address = document.getElementById('add-address').value.trim();

  // Show geocoding progress
  const saveBtn = document.getElementById('add-sauna-save');
  const origText = saveBtn.textContent;
  saveBtn.textContent = 'Locating on map...';
  saveBtn.disabled = true;

  const coords = await geocodeAddress(address, city, country);

  saveBtn.textContent = origText;
  saveBtn.disabled = false;

  const saunaData = {
    name,
    city,
    country,
    address: address || `${city}, ${country}`,
    type: document.getElementById('add-type').value,
    hours: document.getElementById('add-hours').value.trim() || null,
    price: document.getElementById('add-price').value.trim() || 'Unknown',
    website: document.getElementById('add-website').value.trim() || null,
    nude: document.getElementById('add-nude').checked,
    aufguss: document.getElementById('add-aufguss').checked,
    gender: document.getElementById('add-gender').value,
    highlights: document.getElementById('add-highlights').value.trim() || null,
    gear: {
      towel: document.getElementById('add-gear-towel').value,
      swimwear: document.getElementById('add-gear-swimwear').value,
      lockers: document.getElementById('add-gear-lockers').value,
      shower: document.getElementById('add-gear-shower').value,
    },
    scores,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lng : null,
  };

  saveBtn.textContent = 'Saving...';
  saveBtn.disabled = true;

  try {
    await addCommunitySauna(saunaData);
    repopulateCountryFilter();
    closeAddSauna();
    refreshAll();

    if (!coords) {
      alert(`"${name}" was saved but couldn't be placed on the map — geocoding failed for "${address || city}". It will appear in the list but not on the map.`);
    }
  } catch (err) {
    saveBtn.textContent = origText;
    saveBtn.disabled = false;
    alert('Failed to save: ' + err.message);
  }
}

async function deleteUserSauna(id) {
  try {
    await removeCommunitySauna(id);
    repopulateCountryFilter();
    closeDetail();
    refreshAll();
  } catch (err) {
    alert('Failed to delete: ' + err.message);
  }
}

// ── CSV Export / Import ─────────────────────
function downloadCSV() {
  const headers = [
    'name', 'city', 'country', 'address', 'type', 'hours', 'price',
    'website', 'nude', 'aufguss', 'gender', 'highlights', 'lat', 'lng',
    'score_heatSource', 'score_loylyQuality', 'score_communalAtmosphere',
    'score_waterAccess', 'score_noFrills', 'score_tradition', 'score_overall',
  ];

  const escape = val => {
    if (val == null) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const rows = saunas.map(s => [
    s.name, s.city, s.country, s.address, s.type, s.hours, s.price,
    s.website, s.nude, s.highlights, s.lat, s.lng,
    s.scores.heatSource, s.scores.loylyQuality, s.scores.communalAtmosphere,
    s.scores.waterAccess, s.scores.noFrills, s.scores.tradition, s.scores.overall,
  ].map(escape).join(','));

  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'saunas.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function uploadCSV(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return;

  const headers = parseCSVLine(lines[0]);
  const nameIdx = headers.indexOf('name');
  const cityIdx = headers.indexOf('city');
  const countryIdx = headers.indexOf('country');

  if (nameIdx === -1 || cityIdx === -1 || countryIdx === -1) {
    alert('CSV must have name, city, and country columns.');
    return;
  }

  let added = 0;
  let failed = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    if (!cols[nameIdx] || !cols[cityIdx] || !cols[countryIdx]) continue;

    const get = h => cols[headers.indexOf(h)] || null;
    const getNum = h => {
      const v = parseInt(get(h));
      return Number.isFinite(v) && v >= 0 && v <= 10 ? v : 5;
    };

    const existingName = cols[nameIdx].trim();
    const existingCity = cols[cityIdx].trim();
    if (saunas.some(s => s.name === existingName && s.city === existingCity)) continue;

    const saunaData = {
      name: existingName,
      city: existingCity,
      country: cols[countryIdx].trim(),
      address: get('address') || `${existingCity}, ${cols[countryIdx].trim()}`,
      type: get('type') || 'other',
      hours: get('hours'),
      price: get('price') || 'Unknown',
      website: get('website'),
      nude: get('nude') === 'true',
      aufguss: get('aufguss') === 'true',
      gender: get('gender') || 'mixed',
      highlights: get('highlights'),
      lat: parseFloat(get('lat')) || null,
      lng: parseFloat(get('lng')) || null,
      scores: {
        heatSource: getNum('score_heatSource'),
        loylyQuality: getNum('score_loylyQuality'),
        communalAtmosphere: getNum('score_communalAtmosphere'),
        waterAccess: getNum('score_waterAccess'),
        noFrills: getNum('score_noFrills'),
        tradition: getNum('score_tradition'),
        overall: getNum('score_overall'),
      },
    };

    try {
      await addCommunitySauna(saunaData);
      added++;
    } catch {
      failed++;
    }
  }

  repopulateCountryFilter();
  refreshAll();
  let msg = `Imported ${added} sauna${added !== 1 ? 's' : ''}.`;
  if (failed > 0) msg += ` ${failed} failed to save.`;
  alert(msg);
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

// ── Country filter repopulation ─────────────
function repopulateCountryFilter() {
  const select = document.getElementById('filter-country');
  const current = select.value;
  select.innerHTML = '<option value="all">All Countries</option>';
  const countries = [...new Set(saunas.map(s => s.country))].sort();
  for (const c of countries) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  }
  // Restore selection if still valid
  if (countries.includes(current)) select.value = current;
}

// ── Init ─────────────────────────────────────
async function init() {
  try {
    await fetchSaunas();
  } catch (err) {
    console.error('Failed to load saunas:', err);
    document.getElementById('sauna-list').innerHTML =
      '<p style="padding:20px;color:var(--score-bottom)">Failed to load sauna data. Check your connection.</p>';
    return;
  }
  ensureProfileFields();
  initMap();
  populateCountryFilter();
  setupListeners();
  refreshAll();

  // Open sauna from URL hash (deep link)
  handleHashRoute();

  // Show onboarding on first visit
  if (!profile.onboardingDone) {
    showOnboarding();
  }
}

function handleHashRoute() {
  const hash = window.location.hash;
  const match = hash.match(/^#sauna\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (saunas.find(s => s.id === id)) {
      openDetail(id);
    }
  }
}

// Handle browser back/forward button
window.addEventListener('popstate', () => {
  const hash = window.location.hash;
  const match = hash.match(/^#sauna\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (saunas.find(s => s.id === id)) {
      openDetail(id);
    }
  } else if (selectedId) {
    closeDetail(true); // skipHistory — popstate already changed the URL
  }
});

function copyShareLink(id) {
  const url = `${window.location.origin}${window.location.pathname}#sauna/${id}`;
  navigator.clipboard.writeText(url).then(() => {
    // Brief feedback
    const btn = document.querySelector('.btn-share');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '&#10003; Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    }
  }).catch(() => {
    // Fallback for older browsers
    prompt('Copy this link:', url);
  });
}

// Make functions available globally for onclick handlers
window.openRating = openRating;
window.removeRating = removeRating;
window.toggleWishlist = toggleWishlist;
window.deleteUserSauna = deleteUserSauna;
window.copyShareLink = copyShareLink;

init();
