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
let _syncingFilters = false; // guard to prevent chip<->dropdown feedback loop

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
  invalidateWeightsCache();
}

function getContributorId() {
  let id = localStorage.getItem('saunaContributorId');
  if (!id) {
    id = 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('saunaContributorId', id);
  }
  return id;
}

// ── Saunas API (Worker KV) ──────────────────

async function fetchSaunas() {
  const res = await fetch(WORKER_URL + '/saunas');
  if (!res.ok) throw new Error('Failed to load saunas');
  saunas = await res.json();
  invalidateSimilarCache();
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
  invalidateSimilarCache();
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

// ── Utilities ────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── Scoring ──────────────────────────────────
function calcScore(sauna, weights) {
  return SCORE_DIMS.reduce((sum, d) => sum + (sauna.scores[d] / 10) * weights[d], 0) * 100;
}

function finnishScore(sauna) {
  return calcScore(sauna, DEFAULT_WEIGHTS);
}

const _similarCache = new Map();
function invalidateSimilarCache() { _similarCache.clear(); }

function findSimilar(sauna, count = 5) {
  const key = sauna.id + '|' + count;
  if (_similarCache.has(key)) return _similarCache.get(key);
  const result = saunas
    .filter(s => s.id !== sauna.id)
    .map(s => {
      const dist = Math.sqrt(SCORE_DIMS.reduce((sum, d) => {
        const diff = (sauna.scores[d] || 5) - (s.scores[d] || 5);
        return sum + diff * diff;
      }, 0));
      return { sauna: s, dist };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, count);
  _similarCache.set(key, result);
  return result;
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

  const ratedSaunas = ratedIds.map(id => saunas.find(s => s.id === id)).filter(Boolean);
  if (ratedSaunas.length < 2) return null;

  const correlations = {};
  for (const dim of SCORE_DIMS) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const sauna of ratedSaunas) {
      const rating = (profile.ratings[sauna.id] - 1) / 4;
      const dimScore = sauna.scores[dim] / 10;
      weightedSum += rating * dimScore;
      totalWeight += dimScore;
    }
    correlations[dim] = totalWeight > 0 ? weightedSum / ratedSaunas.length : 0;
  }

  const total = Object.values(correlations).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const learned = {};
  for (const dim of SCORE_DIMS) learned[dim] = correlations[dim] / total;

  const alpha = Math.min(1, ratedSaunas.length / 8);
  const blended = {};
  for (const dim of SCORE_DIMS) {
    blended[dim] = alpha * learned[dim] + (1 - alpha) * DEFAULT_WEIGHTS[dim];
  }

  return blended;
}

let _weightsCache = null;
function invalidateWeightsCache() { _weightsCache = null; }

function getEffectiveWeights() {
  if (_weightsCache) return _weightsCache;

  const learned = computeLearnedWeights();
  if (learned) { _weightsCache = learned; return learned; }

  if (profile.preferences) {
    const total = SCORE_DIMS.reduce((s, d) => s + (profile.preferences[d] || 5), 0);
    const weights = {};
    for (const d of SCORE_DIMS) weights[d] = (profile.preferences[d] || 5) / total;
    _weightsCache = weights;
    return weights;
  }

  _weightsCache = DEFAULT_WEIGHTS;
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

  // Tile layers
  const lightLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  });
  const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  });
  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri',
    maxZoom: 19,
  });
  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenTopoMap',
    maxZoom: 17,
  });
  lightLayer.addTo(map);
  L.control.layers({
    'Light': lightLayer,
    'Dark': darkLayer,
    'Satellite': satelliteLayer,
    'Terrain': topoLayer,
  }, null, { position: 'topleft', collapsed: true }).addTo(map);
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

  // Cluster hover preview — show mini sauna list on mouseover
  markerLayer.on('clustermouseover', e => {
    const cluster = e.layer;
    const children = cluster.getAllChildMarkers();
    const preview = children.slice(0, 5).map(m => {
      const ll = m.getLatLng();
      const s = filteredSaunas.find(s => s.lat === ll.lat && s.lng === ll.lng);
      return s ? `<div style="font-size:12px;padding:2px 0;white-space:nowrap">${s.name} <span style="color:var(--text-3)">${Math.round(finnishScore(s))}</span></div>` : '';
    }).filter(Boolean).join('');
    const extra = children.length > 5 ? `<div style="font-size:11px;color:var(--text-3)">+${children.length - 5} more</div>` : '';
    cluster.bindTooltip(`<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif">${preview}${extra}</div>`, { className: 'sauna-tooltip', sticky: true }).openTooltip();
  });
  markerLayer.on('clustermouseout', e => {
    e.layer.unbindTooltip();
  });

  // ── Unified map toolbar ──────────────────────
  const MapToolbar = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const wrapper = L.DomUtil.create('div', 'map-toolbar');
      L.DomEvent.disableClickPropagation(wrapper);

      wrapper.innerHTML = `
        <div class="map-toolbar-section map-toolbar-markers">
          <div class="map-toolbar-marker-btns">
            <button class="marker-toggle-btn" data-mode="score" title="Show scores">123</button>
            <button class="marker-toggle-btn active" data-mode="type" title="Show types">&#9973;</button>
            <button class="marker-toggle-btn" data-mode="nude" title="Show nude policy">&#127814;</button>
          </div>
        </div>
        <div class="map-toolbar-divider"></div>
        <button class="map-toolbar-toggle" title="Map tools">&#9776;</button>
        <div class="map-toolbar-body">
          <div class="map-toolbar-section map-toolbar-nav">
            <button class="map-tb-btn" data-action="near" title="Near me">&#9737; Near me</button>
            <button class="map-tb-btn" data-action="showall" title="Show all saunas">&#8862; Show all</button>
            <button class="map-tb-btn" data-action="fit" title="Fit to filtered">&#9635; Fit filtered</button>
            <button class="map-tb-btn map-tb-search-area" data-action="area" title="Search this area" style="display:none">&#8981; Search this area</button>
          </div>
        </div>
      `;

      const toggle = wrapper.querySelector('.map-toolbar-toggle');
      const body = wrapper.querySelector('.map-toolbar-body');
      const collapsed = localStorage.getItem('mapToolbarCollapsed') === '1';
      if (collapsed) body.classList.add('collapsed');

      toggle.addEventListener('click', () => {
        body.classList.toggle('collapsed');
        localStorage.setItem('mapToolbarCollapsed', body.classList.contains('collapsed') ? '1' : '');
      });

      // Nav actions
      searchAreaBtn = wrapper.querySelector('.map-tb-search-area');
      wrapper.querySelector('[data-action="near"]').addEventListener('click', locateUser);
      wrapper.querySelector('[data-action="showall"]').addEventListener('click', () => {
        if (selectedId) closeDetail();
        fitMapToSaunas();
      });
      wrapper.querySelector('[data-action="fit"]').addEventListener('click', () => {
        fitMapToFiltered();
      });
      searchAreaBtn.addEventListener('click', () => {
        mapBoundsFilter = map.getBounds();
        searchAreaBtn.style.display = 'none';
        refreshAll();
      });

      // Marker mode toggles
      wrapper.querySelectorAll('.marker-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => setMarkerMode(btn.dataset.mode));
      });

      return wrapper;
    },
  });
  new MapToolbar().addTo(map);

  // Right-click context menu
  map.on('contextmenu', e => {
    const { lat, lng } = e.latlng;
    const popup = L.popup({ className: 'map-context-menu' })
      .setLatLng(e.latlng)
      .setContent(`
        <div class="context-menu">
          <button class="context-btn" data-action="center">&#9678; Center here</button>
          <button class="context-btn" data-action="nearby">&#9737; Nearby saunas</button>
          <button class="context-btn" data-action="directions">&#128506; Directions from here</button>
          <div class="context-coords">${lat.toFixed(5)}, ${lng.toFixed(5)}</div>
        </div>
      `)
      .openOn(map);

    setTimeout(() => {
      popup.getElement()?.querySelector('[data-action="center"]')?.addEventListener('click', () => {
        map.setView([lat, lng], map.getZoom());
        map.closePopup();
      });
      popup.getElement()?.querySelector('[data-action="nearby"]')?.addEventListener('click', () => {
        userLocation = { lat, lng };
        document.getElementById('sort-by').value = 'nearest';
        if (userLocationMarker) map.removeLayer(userLocationMarker);
        userLocationMarker = L.circleMarker([lat, lng], {
          radius: 8, color: '#3a6b8b', fillColor: '#5ba3d9', fillOpacity: 0.9, weight: 2,
        }).addTo(map).bindTooltip('Search point', { className: 'sauna-tooltip' });
        map.closePopup();
        refreshAll();
      });
      popup.getElement()?.querySelector('[data-action="directions"]')?.addEventListener('click', () => {
        window.open(`https://www.google.com/maps/dir/${lat},${lng}/`, '_blank');
        map.closePopup();
      });
    }, 0);
  });

  // Show "Search this area" after user pans/zooms (debounced)
  const debouncedMoveEnd = debounce(() => {
    if (searchAreaBtn && mapBoundsFilter) {
      searchAreaBtn.style.display = '';
    }
    if (searchAreaBtn && !mapBoundsFilter && mapInteracted) {
      searchAreaBtn.style.display = '';
    }
    mapInteracted = true;
    syncMapHash();
  }, 200);
  map.on('moveend zoomend', debouncedMoveEnd);
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
let geoWatchId = null;

function updateUserMarker() {
  if (!userLocation) return;
  if (userLocationMarker) {
    userLocationMarker.setLatLng([userLocation.lat, userLocation.lng]);
  } else {
    userLocationMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
      radius: 8, color: '#3a6b8b', fillColor: '#5ba3d9', fillOpacity: 0.9, weight: 2,
    }).addTo(map).bindTooltip('You are here', { className: 'sauna-tooltip' });
  }
}

function locateUser() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }

  // Start continuous tracking if not already active
  if (!geoWatchId) {
    geoWatchId = navigator.geolocation.watchPosition(
      pos => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        updateUserMarker();
        // Re-sort if sorted by nearest (debounced to avoid thrash)
        if (document.getElementById('sort-by').value === 'nearest') {
          debouncedLocationRefresh();
        }
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // Immediate position for first use
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      updateUserMarker();
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

const debouncedLocationRefresh = debounce(() => refreshAll(), 3000);

function setMarkerMode(mode) {
  markerMode = mode;
  document.querySelectorAll('.marker-toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  renderMarkers();
}

function buildMarkerIcon(sauna, isSelected) {
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
  return L.divIcon({
    className: 'custom-marker',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};border:2px ${borderStyle} ${border};
      box-shadow:0 1px 4px rgba(59,47,32,0.25);
      display:flex;align-items:center;justify-content:center;
      font-size:${fontSize}px;font-weight:600;color:${color};
      transition:all 0.15s;line-height:1;
    ">${content}</div>`,
    iconSize: [size, size],
    iconAnchor: [half, half],
  });
}

function renderMarkers() {
  markerLayer.clearLayers();
  const markers = [];
  for (const sauna of filteredSaunas) {
    if (sauna.lat == null || sauna.lng == null) continue;
    const icon = buildMarkerIcon(sauna, sauna.id === selectedId);
    const marker = L.marker([sauna.lat, sauna.lng], { icon })
      .on('click', () => openDetail(sauna.id))
      .bindTooltip(sauna.name, { offset: [0, -14], className: 'sauna-tooltip' });
    markers.push(marker);
  }
  markerLayer.addLayers(markers); // bulk add for better cluster performance
}

// ── UI: Sauna List (progressive rendering) ──
const LIST_BATCH = 30; // render this many at a time
let _listRendered = 0;
let _listScrollHandler = null;

function renderCardHTML(sauna) {
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
}

function renderMoreCards() {
  const list = document.getElementById('sauna-list');
  const end = Math.min(_listRendered + LIST_BATCH, filteredSaunas.length);
  if (_listRendered >= end) return;
  const html = filteredSaunas.slice(_listRendered, end).map(renderCardHTML).join('');
  list.insertAdjacentHTML('beforeend', html);
  _listRendered = end;
}

function renderList() {
  const list = document.getElementById('sauna-list');
  const countBadge = document.getElementById('sauna-count');
  if (countBadge) {
    countBadge.textContent = filteredSaunas.length === saunas.length
      ? `${saunas.length} saunas`
      : `Showing ${filteredSaunas.length} of ${saunas.length}`;
  }

  if (filteredSaunas.length === 0) {
    list.innerHTML = '<p style="padding:20px;color:var(--text-light);text-align:center">No saunas match your filters</p>';
    _listRendered = 0;
    return;
  }

  // Render first batch
  _listRendered = 0;
  const firstBatch = filteredSaunas.slice(0, LIST_BATCH);
  list.innerHTML = firstBatch.map(renderCardHTML).join('');
  _listRendered = firstBatch.length;

  // Progressive load on scroll
  if (_listScrollHandler) list.removeEventListener('scroll', _listScrollHandler);
  _listScrollHandler = () => {
    if (_listRendered >= filteredSaunas.length) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 100) {
      renderMoreCards();
    }
  };
  list.addEventListener('scroll', _listScrollHandler, { passive: true });
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

  // Update URL hash for deep linking
  history.replaceState(null, '', `#sauna/${id}`);

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
    ${sauna.mayClosed ? `<div class="closed-banner">
      <span class="closed-banner-icon">&#9888;</span>
      <div class="closed-banner-text"><strong>May be permanently closed.</strong> Multiple users have reported this sauna as closed. If you've visited recently and it's open, click "Still Open" below.</div>
    </div>` : ''}
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
      <div class="detail-icon-actions">
        <button class="icon-action btn-share" onclick="copyShareLink('${sauna.id}')" title="Copy Link">&#128279;</button>
        <button class="icon-action" onclick="openSuggestEdit('${sauna.id}')" title="Suggest Edit">&#9998;</button>
        <button class="icon-action btn-wishlist-icon ${isWishlisted ? 'wishlisted' : ''}" onclick="toggleWishlist('${sauna.id}')" title="${isWishlisted ? 'On Wishlist' : 'Add to Wishlist'}">${isWishlisted ? '&#9829;' : '&#9825;'}</button>
        ${sauna.lat != null ? `<button class="icon-action btn-show-map" onclick="showOnMap('${sauna.id}')" title="Show on Map">&#127758;</button>` : ''}
      </div>
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

    <div class="detail-section crowd-section">
      <h3>Help Keep Info Accurate</h3>
      <div class="crowd-row">
        <span class="crowd-label">Hours are correct</span>
        <span class="crowd-count" id="crowd-hours-count">${sauna.crowd?.confirmHours?.length || 0}</span>
        <button class="crowd-btn" id="crowd-confirm-hours" onclick="crowdConfirm('${sauna.id}', 'confirmHours')">Confirm</button>
      </div>
      <div class="crowd-row">
        <span class="crowd-label">Price is correct</span>
        <span class="crowd-count" id="crowd-price-count">${sauna.crowd?.confirmPrice?.length || 0}</span>
        <button class="crowd-btn" id="crowd-confirm-price" onclick="crowdConfirm('${sauna.id}', 'confirmPrice')">Confirm</button>
      </div>
      <div class="crowd-row">
        <span class="crowd-label">Suggest different hours</span>
        <button class="crowd-btn" id="crowd-correct-hours-btn" onclick="toggleCrowdCorrect('hours')">Correct</button>
      </div>
      <div class="crowd-correct-input hidden" id="crowd-correct-hours">
        <input type="text" placeholder="e.g. Mon-Fri 14-21" id="crowd-hours-input" />
        <button class="crowd-btn" onclick="crowdCorrect('${sauna.id}', 'correctHours')">Send</button>
      </div>
      <div class="crowd-row">
        <span class="crowd-label">Suggest different price</span>
        <button class="crowd-btn" id="crowd-correct-price-btn" onclick="toggleCrowdCorrect('price')">Correct</button>
      </div>
      <div class="crowd-correct-input hidden" id="crowd-correct-price">
        <input type="text" placeholder="e.g. 15 EUR" id="crowd-price-input" />
        <button class="crowd-btn" onclick="crowdCorrect('${sauna.id}', 'correctPrice')">Send</button>
      </div>
      <div class="crowd-row" style="margin-top:6px">
        ${sauna.mayClosed
          ? `<span class="crowd-label">This sauna is actually open</span>
             <button class="crowd-btn" onclick="crowdConfirm('${sauna.id}', 'confirmOpen')">Still Open</button>`
          : `<span class="crowd-label">Report permanently closed</span>
             <button class="crowd-btn crowd-btn-danger" onclick="crowdConfirm('${sauna.id}', 'reportClosed')">Report Closed</button>`
        }
      </div>
    </div>
  `;

  // Similar sauna click handlers
  content.querySelectorAll('.similar-item').forEach(item => {
    item.addEventListener('click', () => openDetail(item.dataset.id));
  });

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('visible'));

  // Fly to marker and uncluster it (skip on mobile list view — map is hidden)
  const mapVisible = !isMobile() || _mobileView === 'map';
  if (sauna.lat != null && sauna.lng != null && mapVisible) {
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

function closeDetail() {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.add('hidden'), 200);
  selectedId = null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  // Restore previous map view
  if (mapViewBeforeDetail) {
    map.flyTo(mapViewBeforeDetail.center, mapViewBeforeDetail.zoom, { duration: 0.6 });
    mapViewBeforeDetail = null;
  }
  applyFilters();
  renderMarkers();
  renderList();
}

function showOnMap(id) {
  const sauna = saunas.find(s => s.id === id);
  if (!sauna || sauna.lat == null) return;
  closeDetail();
  if (isMobile()) {
    switchMobileView('map');
    setTimeout(() => {
      map.flyTo([sauna.lat, sauna.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
    }, 100);
  } else {
    map.flyTo([sauna.lat, sauna.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }
}

// ── Crowdsource Confirmations ─────────────────
function toggleCrowdCorrect(field) {
  const el = document.getElementById(`crowd-correct-${field}`);
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    el.querySelector('input').focus();
  }
}

async function crowdConfirm(saunaId, action) {
  try {
    const res = await fetch(`${WORKER_URL}/saunas/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saunaId, action }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to submit');
      return;
    }
    // Update local sauna data
    const sauna = saunas.find(s => s.id === saunaId);
    if (sauna && data.crowd) {
      if (!sauna.crowd) sauna.crowd = {};
      sauna.crowd.confirmHours = Array(data.crowd.confirmHours).fill({});
      sauna.crowd.confirmPrice = Array(data.crowd.confirmPrice).fill({});
      sauna.mayClosed = data.crowd.mayClosed;
    }
    // Visual feedback
    if (action === 'confirmHours') {
      const btn = document.getElementById('crowd-confirm-hours');
      if (btn) { btn.classList.add('confirmed'); btn.textContent = 'Confirmed'; }
      const cnt = document.getElementById('crowd-hours-count');
      if (cnt) cnt.textContent = data.crowd.confirmHours;
    } else if (action === 'confirmPrice') {
      const btn = document.getElementById('crowd-confirm-price');
      if (btn) { btn.classList.add('confirmed'); btn.textContent = 'Confirmed'; }
      const cnt = document.getElementById('crowd-price-count');
      if (cnt) cnt.textContent = data.crowd.confirmPrice;
    } else if (action === 'reportClosed' || action === 'confirmOpen') {
      openDetail(saunaId);
    }
  } catch (e) {
    alert('Network error — try again');
  }
}

async function crowdCorrect(saunaId, action) {
  const field = action === 'correctHours' ? 'hours' : 'price';
  const input = document.getElementById(`crowd-${field}-input`);
  const value = input.value.trim();
  if (!value) return;

  try {
    const res = await fetch(`${WORKER_URL}/saunas/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saunaId, action, value }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to submit');
      return;
    }
    input.value = '';
    document.getElementById(`crowd-correct-${field}`).classList.add('hidden');
    const btn = document.getElementById(`crowd-correct-${field}-btn`);
    if (btn) { btn.classList.add('confirmed'); btn.textContent = 'Sent'; }
  } catch (e) {
    alert('Network error — try again');
  }
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

// ── Multi-select filter component ────────────
const _ms = {}; // id → { selected: Set, options: [{value,label}], placeholder, el }

function initMultiSelect(id, options, placeholder) {
  const el = document.getElementById(id);
  const state = { selected: new Set(), options, placeholder, el };
  _ms[id] = state;

  el.innerHTML = `<button type="button" class="ms-trigger">${placeholder}</button><div class="ms-dropdown"></div>`;
  _renderMSOptions(id);

  const trigger = el.querySelector('.ms-trigger');
  const dropdown = el.querySelector('.ms-dropdown');

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    // Close other open dropdowns
    document.querySelectorAll('.ms-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open');
    });
    dropdown.classList.toggle('open');
  });
}

function _renderMSOptions(id) {
  const state = _ms[id];
  const dropdown = state.el.querySelector('.ms-dropdown');
  dropdown.innerHTML = state.options.map(o =>
    `<label class="ms-option"><input type="checkbox" value="${o.value}" ${state.selected.has(o.value) ? 'checked' : ''}> ${o.label}</label>`
  ).join('');

  dropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      if (cb.checked) state.selected.add(cb.value);
      else state.selected.delete(cb.value);
      _renderMSTrigger(id);
      state.el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

function _renderMSTrigger(id) {
  const state = _ms[id];
  const trigger = state.el.querySelector('.ms-trigger');
  const n = state.selected.size;
  if (n === 0) {
    trigger.textContent = state.placeholder;
    trigger.classList.remove('has-selection');
  } else if (n === 1) {
    const val = [...state.selected][0];
    const opt = state.options.find(o => o.value === val);
    trigger.textContent = opt ? opt.label : val;
    trigger.classList.add('has-selection');
  } else {
    trigger.textContent = `${n} selected`;
    trigger.classList.add('has-selection');
  }
}

function getFilterValues(id) {
  return _ms[id] ? [..._ms[id].selected] : [];
}

function setFilterValues(id, values) {
  if (!_ms[id]) return;
  _ms[id].selected = new Set(values);
  _renderMSOptions(id);
  _renderMSTrigger(id);
}

function toggleFilterValue(id, value) {
  if (!_ms[id]) return;
  const s = _ms[id].selected;
  if (s.has(value)) s.delete(value);
  else s.add(value);
  _renderMSOptions(id);
  _renderMSTrigger(id);
}

function getFilterLabel(id, value) {
  if (!_ms[id]) return value;
  const opt = _ms[id].options.find(o => o.value === value);
  return opt ? opt.label : value;
}

function initAllMultiSelects() {
  initMultiSelect('filter-type', [
    { value: 'wood-fired', label: 'Wood-fired' },
    { value: 'smoke', label: 'Smoke' },
    { value: 'electric', label: 'Electric' },
    { value: 'russian-banya', label: 'Russian Banya' },
    { value: 'korean-jjimjilbang', label: 'Jjimjilbang' },
    { value: 'boat', label: 'Boat' },
    { value: 'other', label: 'Other' },
  ], 'All Types');

  initMultiSelect('filter-country', [], 'All Countries');

  initMultiSelect('filter-nude', [
    { value: 'nude', label: 'Dicks Out Only' },
    { value: 'clothed', label: 'Clothed Only' },
  ], 'Any');

  initMultiSelect('filter-gender', [
    { value: 'mixed', label: 'Mixed Only' },
    { value: 'segregated', label: 'Segregated Only' },
  ], 'Any');

  initMultiSelect('filter-open', [
    { value: 'open', label: 'Open Now' },
  ], 'Any');

  initMultiSelect('filter-wishlist', [
    { value: 'wishlist', label: 'Wishlist Only' },
    { value: 'visited', label: 'Visited Only' },
    { value: 'community', label: 'Community Added' },
    { value: 'aufguss', label: 'Aufguss Only' },
  ], 'All Saunas');

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.multi-select')) {
      document.querySelectorAll('.ms-dropdown.open').forEach(d => d.classList.remove('open'));
    }
  });
}

// ── Filtering & Sorting ──────────────────────
function parsePriceRange(priceStr) {
  if (!priceStr) return null;
  if (priceStr.toLowerCase() === 'free') return 0;
  const match = priceStr.match(/[\d.]+/);
  return match ? parseFloat(match[0]) : null;
}

function applyFilters() {
  const search = document.getElementById('search').value.toLowerCase();
  const types = getFilterValues('filter-type');
  const countries = getFilterValues('filter-country');
  const nudeVals = getFilterValues('filter-nude');
  const genderVals = getFilterValues('filter-gender');
  const openVals = getFilterValues('filter-open');
  const wishlistVals = getFilterValues('filter-wishlist');

  // Range filters
  const priceMin = parseInt(document.getElementById('price-min').value, 10);
  const priceMax = parseInt(document.getElementById('price-max').value, 10);
  const minScore = parseInt(document.getElementById('min-score').value, 10);

  filteredSaunas = saunas.filter(s => {
    if (search && !s.name.toLowerCase().includes(search) && !s.city.toLowerCase().includes(search) && !s.country.toLowerCase().includes(search)) return false;
    if (types.length && !types.includes(s.type)) return false;
    if (countries.length && !countries.includes(s.country)) return false;
    // Nude: if both selected, it's same as "any"
    if (nudeVals.length) {
      const match = nudeVals.some(v => (v === 'nude' && s.nude) || (v === 'clothed' && !s.nude));
      if (!match) return false;
    }
    if (genderVals.length && !genderVals.includes(s.gender || 'mixed')) return false;
    if (openVals.length && isOpenNow(s.hours) !== true) return false;
    // Collection: OR logic — match any selected
    if (wishlistVals.length) {
      const match = wishlistVals.some(v =>
        (v === 'wishlist' && profile.wishlist[s.id]) ||
        (v === 'visited' && profile.ratings[s.id]) ||
        (v === 'community' && s.communityAdded) ||
        (v === 'aufguss' && s.aufguss)
      );
      if (!match) return false;
    }
    // Price range filter
    if (priceMin > 0 || priceMax < 100) {
      const p = parsePriceRange(s.price);
      if (p !== null) {
        if (priceMin > 0 && p < priceMin) return false;
        if (priceMax < 100 && p > priceMax) return false;
      }
    }
    // Min score filter
    if (minScore > 0 && finnishScore(s) < minScore) return false;
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
    getFilterValues('filter-type').length > 0,
    getFilterValues('filter-country').length > 0,
    getFilterValues('filter-nude').length > 0,
    getFilterValues('filter-gender').length > 0,
    getFilterValues('filter-open').length > 0,
    getFilterValues('filter-wishlist').length > 0,
    parseInt(document.getElementById('price-min').value, 10) > 0,
    parseInt(document.getElementById('price-max').value, 10) < 100,
    parseInt(document.getElementById('min-score').value, 10) > 0,
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
  }

  renderActivePills();
}

// ── Active Filter Pills ─────────────────────
function renderActivePills() {
  const container = document.getElementById('active-pills');
  const pills = [];

  const add = (label, clearFn) => pills.push({ label, clearFn });

  // One pill per selected value in each multi-select
  const msFilters = ['filter-type', 'filter-country', 'filter-nude', 'filter-gender', 'filter-open', 'filter-wishlist'];
  for (const id of msFilters) {
    for (const val of getFilterValues(id)) {
      add(getFilterLabel(id, val), () => { toggleFilterValue(id, val); });
    }
  }

  const priceMin = document.getElementById('price-min');
  const priceMax = document.getElementById('price-max');
  if (parseInt(priceMin.value, 10) > 0 || parseInt(priceMax.value, 10) < 100) {
    add(`Price ${priceMin.value}-${priceMax.value}`, () => { priceMin.value = 0; priceMax.value = 100; updatePriceLabels(); });
  }

  const minScore = document.getElementById('min-score');
  if (parseInt(minScore.value, 10) > 0) {
    add(`Score ${minScore.value}+`, () => { minScore.value = 0; updateScoreLabel(); });
  }

  container.innerHTML = pills.map((p, i) => `<span class="pill">${p.label}<button class="pill-dismiss" data-pill="${i}">&times;</button></span>`).join('');

  container.querySelectorAll('.pill-dismiss').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.pill, 10);
      pills[idx].clearFn();
      syncChipsFromFilters();
      updateFilterBadge();
      clearBoundsAndRefresh();
    });
  });
}

// ── Price/Score label helpers ─────────────────
function updatePriceLabels() {
  const min = parseInt(document.getElementById('price-min').value, 10);
  const max = parseInt(document.getElementById('price-max').value, 10);
  document.getElementById('price-min-label').textContent = min === 0 ? 'Free' : `${min}`;
  document.getElementById('price-max-label').textContent = max >= 100 ? 'Any' : `${max}`;
  // Update track fill
  const track = document.getElementById('price-track');
  track.style.background = `linear-gradient(to right, var(--border) ${min}%, var(--accent) ${min}%, var(--accent) ${max}%, var(--border) ${max}%)`;
}

function updateScoreLabel() {
  const val = parseInt(document.getElementById('min-score').value, 10);
  document.getElementById('min-score-label').textContent = val === 0 ? 'Any' : `${val}+`;
}

// ── Chip <-> Filter sync ────────────────────
function syncChipsFromFilters() {
  if (_syncingFilters) return;
  _syncingFilters = true;

  const types = getFilterValues('filter-type');
  const nudeVals = getFilterValues('filter-nude');
  const openVals = getFilterValues('filter-open');
  const wishlistVals = getFilterValues('filter-wishlist');
  const priceMin = parseInt(document.getElementById('price-min').value, 10);
  const minScore = parseInt(document.getElementById('min-score').value, 10);

  document.querySelectorAll('.chip').forEach(chip => {
    const key = chip.dataset.chip;
    let active = false;
    if (key === 'wood-fired') active = types.includes('wood-fired');
    else if (key === 'nude') active = nudeVals.includes('nude');
    else if (key === 'aufguss') active = wishlistVals.includes('aufguss');
    else if (key === 'open') active = openVals.includes('open');
    else if (key === 'free') active = priceMin === 0 && parseInt(document.getElementById('price-max').value, 10) === 0;
    else if (key === 'score70') active = minScore >= 70;
    chip.classList.toggle('active', active);
  });

  _syncingFilters = false;
}

function applyChip(chipKey) {
  if (_syncingFilters) return;
  _syncingFilters = true;

  const chip = document.querySelector(`.chip[data-chip="${chipKey}"]`);
  const isActive = chip.classList.contains('active');

  switch (chipKey) {
    case 'wood-fired':
      toggleFilterValue('filter-type', 'wood-fired');
      break;
    case 'nude':
      toggleFilterValue('filter-nude', 'nude');
      break;
    case 'aufguss':
      toggleFilterValue('filter-wishlist', 'aufguss');
      break;
    case 'open':
      toggleFilterValue('filter-open', 'open');
      break;
    case 'free': {
      const pm = document.getElementById('price-min');
      const px = document.getElementById('price-max');
      if (isActive) { pm.value = 0; px.value = 100; }
      else { pm.value = 0; px.value = 0; }
      updatePriceLabels();
      break;
    }
    case 'score70': {
      const ms = document.getElementById('min-score');
      ms.value = isActive ? 0 : 70;
      updateScoreLabel();
      break;
    }
  }

  _syncingFilters = false;
  syncChipsFromFilters();
  updateFilterBadge();
  mapBoundsFilter = null;
  if (searchAreaBtn) searchAreaBtn.style.display = 'none';
  refreshAll();
}

function clearBoundsAndRefresh(fitMap = false) {
  mapBoundsFilter = null;
  if (searchAreaBtn) searchAreaBtn.style.display = 'none';
  updateFilterBadge();
  refreshAll(fitMap);
}

// ── Country filter population ────────────────
function populateCountryFilter() {
  const countries = [...new Set(saunas.map(s => s.country))].sort();
  if (_ms['filter-country']) {
    _ms['filter-country'].options = countries.map(c => ({ value: c, label: c }));
    _renderMSOptions('filter-country');
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

function clearAllFilters() {
  document.getElementById('search').value = '';
  ['filter-type', 'filter-country', 'filter-nude', 'filter-gender', 'filter-open', 'filter-wishlist'].forEach(id => setFilterValues(id, []));
  document.getElementById('price-min').value = 0;
  document.getElementById('price-max').value = 100;
  document.getElementById('min-score').value = 0;
  updatePriceLabels();
  updateScoreLabel();
  syncChipsFromFilters();
  mapBoundsFilter = null;
  if (searchAreaBtn) searchAreaBtn.style.display = 'none';
  updateFilterBadge();
}

function fitMapToSaunas() {
  clearAllFilters();
  const withCoords = saunas.filter(s => s.lat != null && s.lng != null);
  if (withCoords.length === 0) return;
  const bounds = L.latLngBounds(withCoords.map(s => [s.lat, s.lng]));
  map.flyToBounds(bounds, { padding: [40, 40], duration: 0.8 });
  refreshAll();
}

let _refreshRAF = null;
function refreshAll(fitMap = false) {
  applyFilters();
  // Batch DOM writes into a single animation frame
  if (_refreshRAF) cancelAnimationFrame(_refreshRAF);
  _refreshRAF = requestAnimationFrame(() => {
    _refreshRAF = null;
    renderList();
    renderMarkers();
    renderTasteProfile();
    renderRecommendations();
    if (fitMap) fitMapToFiltered();
  });
}

// ── Event Listeners ──────────────────────────
function setupListeners() {
  // Event delegation for sauna list (instead of per-card listeners)
  document.getElementById('sauna-list').addEventListener('click', e => {
    const card = e.target.closest('.sauna-card');
    if (card) openDetail(card.dataset.id);
  });

  // Debounced search
  const debouncedSearch = debounce(() => {
    mapBoundsFilter = null;
    if (searchAreaBtn) searchAreaBtn.style.display = 'none';
    refreshAll();
  }, 150);
  document.getElementById('search').addEventListener('input', debouncedSearch);
  document.getElementById('sort-by').addEventListener('change', refreshAll);

  // Dropdown filter changes
  ['filter-type', 'filter-nude', 'filter-gender', 'filter-open', 'filter-wishlist'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      syncChipsFromFilters();
      clearBoundsAndRefresh();
    });
  });
  document.getElementById('filter-country').addEventListener('change', () => {
    syncChipsFromFilters();
    clearBoundsAndRefresh(true);
  });

  // Quick filter chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => applyChip(chip.dataset.chip));
  });

  // Price range sliders
  const priceMin = document.getElementById('price-min');
  const priceMax = document.getElementById('price-max');
  const debouncedPriceRefresh = debounce(() => {
    syncChipsFromFilters();
    updateFilterBadge();
    refreshAll();
  }, 200);
  priceMin.addEventListener('input', () => {
    if (parseInt(priceMin.value, 10) > parseInt(priceMax.value, 10)) priceMax.value = priceMin.value;
    updatePriceLabels();
    debouncedPriceRefresh();
  });
  priceMax.addEventListener('input', () => {
    if (parseInt(priceMax.value, 10) < parseInt(priceMin.value, 10)) priceMin.value = priceMax.value;
    updatePriceLabels();
    debouncedPriceRefresh();
  });
  updatePriceLabels();

  // Min score slider
  const minScoreEl = document.getElementById('min-score');
  const debouncedScoreRefresh = debounce(() => {
    syncChipsFromFilters();
    updateFilterBadge();
    refreshAll();
  }, 200);
  minScoreEl.addEventListener('input', () => {
    updateScoreLabel();
    debouncedScoreRefresh();
  });

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
    clearAllFilters();
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

  // Swipe-down to dismiss detail panel (mobile)
  setupSwipeToDismiss();

  // Pull-to-refresh on sauna list
  setupPullToRefresh();

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

  // Suggest Edit modal
  document.getElementById('edit-cancel').addEventListener('click', closeSuggestEdit);
  document.getElementById('edit-submit').addEventListener('click', submitSuggestEdit);

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

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const active = document.activeElement;
    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');

    if (e.key === 'Escape') {
      if (isInput) { active.blur(); return; }
      if (!document.getElementById('edit-modal').classList.contains('hidden')) {
        closeSuggestEdit();
      } else if (!document.getElementById('add-sauna-modal').classList.contains('hidden')) {
        closeAddSauna();
      } else if (!document.getElementById('rating-modal').classList.contains('hidden')) {
        closeRating();
      } else if (!document.getElementById('detail-panel').classList.contains('hidden')) {
        closeDetail();
      }
      return;
    }

    // Skip shortcuts when typing in inputs
    if (isInput) return;

    // / — focus search
    if (e.key === '/') {
      e.preventDefault();
      document.getElementById('search').focus();
      return;
    }

    // 1/2/3 — marker mode toggle
    if (e.key === '1') { setMarkerMode('score'); return; }
    if (e.key === '2') { setMarkerMode('type'); return; }
    if (e.key === '3') { setMarkerMode('nude'); return; }

    // Arrow keys — navigate sauna list
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const cards = [...document.querySelectorAll('.sauna-card')];
      if (cards.length === 0) return;
      const currentIdx = cards.findIndex(c => c.classList.contains('active'));
      let nextIdx;
      if (e.key === 'ArrowDown') {
        nextIdx = currentIdx < cards.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : cards.length - 1;
      }
      openDetail(cards[nextIdx].dataset.id);
      cards[nextIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
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

// ── Suggest Edit ────────────────────────────
let editTargetId = null;
let editOriginal = null;

function openSuggestEdit(id) {
  const sauna = saunas.find(s => s.id === id);
  if (!sauna) return;

  editTargetId = id;
  editOriginal = sauna;

  document.getElementById('edit-sauna-label').textContent = `Editing: ${sauna.name}`;
  document.getElementById('edit-name').value = sauna.name || '';
  document.getElementById('edit-city').value = sauna.city || '';
  document.getElementById('edit-country').value = sauna.country || '';
  document.getElementById('edit-address').value = sauna.address || '';
  document.getElementById('edit-type').value = sauna.type || 'other';
  document.getElementById('edit-hours').value = sauna.hours || '';
  document.getElementById('edit-price').value = sauna.price || '';
  document.getElementById('edit-website').value = sauna.website || '';
  document.getElementById('edit-nude').checked = !!sauna.nude;
  document.getElementById('edit-aufguss').checked = !!sauna.aufguss;
  document.getElementById('edit-gender').value = sauna.gender || 'mixed';
  document.getElementById('edit-highlights').value = sauna.highlights || '';

  if (sauna.gear) {
    document.getElementById('edit-gear-towel').value = sauna.gear.towel || 'bring';
    document.getElementById('edit-gear-swimwear').value = sauna.gear.swimwear || 'required';
    document.getElementById('edit-gear-lockers').value = sauna.gear.lockers || 'coin';
    document.getElementById('edit-gear-shower').value = sauna.gear.shower || 'basic';
  }

  document.getElementById('edit-keyword').value = '';
  document.getElementById('edit-status').textContent = '';
  document.getElementById('edit-status').className = 'extract-status';

  document.getElementById('edit-modal').classList.remove('hidden');
}

function closeSuggestEdit() {
  document.getElementById('edit-modal').classList.add('hidden');
  editTargetId = null;
  editOriginal = null;
}

async function submitSuggestEdit() {
  const keyword = document.getElementById('edit-keyword').value.trim();
  const status = document.getElementById('edit-status');

  if (!keyword) {
    status.textContent = 'Keyword is required';
    status.className = 'extract-status error';
    return;
  }

  // Build changes object — only include fields that actually changed
  const changes = {};
  const fields = [
    { id: 'edit-name', key: 'name', orig: editOriginal.name },
    { id: 'edit-city', key: 'city', orig: editOriginal.city },
    { id: 'edit-country', key: 'country', orig: editOriginal.country },
    { id: 'edit-address', key: 'address', orig: editOriginal.address },
    { id: 'edit-type', key: 'type', orig: editOriginal.type },
    { id: 'edit-hours', key: 'hours', orig: editOriginal.hours },
    { id: 'edit-price', key: 'price', orig: editOriginal.price },
    { id: 'edit-website', key: 'website', orig: editOriginal.website },
    { id: 'edit-highlights', key: 'highlights', orig: editOriginal.highlights },
    { id: 'edit-gender', key: 'gender', orig: editOriginal.gender },
  ];

  for (const f of fields) {
    const val = document.getElementById(f.id).value.trim() || null;
    if (val !== (f.orig || null)) changes[f.key] = val;
  }

  const nudeVal = document.getElementById('edit-nude').checked;
  if (nudeVal !== !!editOriginal.nude) changes.nude = nudeVal;

  const aufgussVal = document.getElementById('edit-aufguss').checked;
  if (aufgussVal !== !!editOriginal.aufguss) changes.aufguss = aufgussVal;

  // Gear changes
  const gearChanges = {};
  const origGear = editOriginal.gear || {};
  const gearFields = [
    { id: 'edit-gear-towel', key: 'towel' },
    { id: 'edit-gear-swimwear', key: 'swimwear' },
    { id: 'edit-gear-lockers', key: 'lockers' },
    { id: 'edit-gear-shower', key: 'shower' },
  ];
  for (const g of gearFields) {
    const val = document.getElementById(g.id).value;
    if (val !== (origGear[g.key] || '')) gearChanges[g.key] = val;
  }
  if (Object.keys(gearChanges).length > 0) changes.gear = gearChanges;

  if (Object.keys(changes).length === 0) {
    status.textContent = 'No changes detected';
    status.className = 'extract-status error';
    return;
  }

  const btn = document.getElementById('edit-submit');
  btn.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const res = await fetch(WORKER_URL + '/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        saunaId: editTargetId,
        saunaName: editOriginal.name,
        changes,
        keyword,
        contributorId: getContributorId(),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      status.textContent = data.error || 'Failed to submit edit';
      status.className = 'extract-status error';
      return;
    }

    status.textContent = 'Edit submitted for review!';
    status.className = 'extract-status success';
    setTimeout(() => closeSuggestEdit(), 1500);
  } catch (err) {
    status.textContent = 'Network error. Try again.';
    status.className = 'extract-status error';
  } finally {
    btn.textContent = 'Submit Edit';
    btn.disabled = false;
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
  const countries = [...new Set(saunas.map(s => s.country))].sort();
  if (_ms['filter-country']) {
    const currentSelected = getFilterValues('filter-country');
    _ms['filter-country'].options = countries.map(c => ({ value: c, label: c }));
    // Restore valid selections
    _ms['filter-country'].selected = new Set(currentSelected.filter(c => countries.includes(c)));
    _renderMSOptions('filter-country');
    _renderMSTrigger('filter-country');
  }
}

// ── Mobile View Toggle ──────────────────────
let _mobileView = 'list'; // 'list' or 'map'

function isMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function switchMobileView(view) {
  _mobileView = view;
  const sidebar = document.getElementById('sidebar');
  const mapEl = document.getElementById('map');
  const tabs = document.querySelectorAll('.mobile-tab');

  if (view === 'map') {
    sidebar.classList.add('mobile-view-hidden');
    mapEl.classList.remove('mobile-view-hidden');
    // Leaflet needs a size recalc when its container becomes visible
    setTimeout(() => map.invalidateSize(), 50);
  } else {
    mapEl.classList.add('mobile-view-hidden');
    sidebar.classList.remove('mobile-view-hidden');
  }

  tabs.forEach(t => t.classList.toggle('active', t.dataset.view === view));
}

function setupMobileToggle() {
  const tabs = document.getElementById('mobile-tabs');
  if (!tabs) return;

  tabs.addEventListener('click', e => {
    const tab = e.target.closest('.mobile-tab');
    if (!tab) return;
    switchMobileView(tab.dataset.view);
  });

  // On mobile, start with list view; hide map initially
  if (isMobile()) {
    switchMobileView('list');
  }

  // Handle resize: clean up mobile classes when switching to desktop
  window.addEventListener('resize', debounce(() => {
    const sidebar = document.getElementById('sidebar');
    const mapEl = document.getElementById('map');
    if (!isMobile()) {
      sidebar.classList.remove('mobile-view-hidden');
      mapEl.classList.remove('mobile-view-hidden');
      map.invalidateSize();
    } else {
      switchMobileView(_mobileView);
    }
  }, 150));
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
  initAllMultiSelects();
  populateCountryFilter();
  setupListeners();
  setupMobileToggle();
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

  // Deep link to sauna: #sauna/id
  const saunaMatch = hash.match(/^#sauna\/(.+)$/);
  if (saunaMatch) {
    const id = decodeURIComponent(saunaMatch[1]);
    if (saunas.find(s => s.id === id)) {
      openDetail(id);
    }
    return;
  }

  // Deep link to map position: #map/lat/lng/zoom
  const mapMatch = hash.match(/^#map\/([-\d.]+)\/([-\d.]+)\/(\d+)$/);
  if (mapMatch) {
    const lat = parseFloat(mapMatch[1]);
    const lng = parseFloat(mapMatch[2]);
    const zoom = parseInt(mapMatch[3]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && zoom > 0) {
      map.setView([lat, lng], zoom);
    }
  }
}

// Sync map position to URL hash (debounced)
const syncMapHash = debounce(() => {
  if (selectedId) return; // don't overwrite sauna deep links
  const c = map.getCenter();
  const z = map.getZoom();
  history.replaceState(null, '', `#map/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}/${z}`);
}, 500);


function copyShareLink(id) {
  const url = `${window.location.origin}${window.location.pathname}#sauna/${id}`;
  navigator.clipboard.writeText(url).then(() => {
    // Brief feedback
    const btn = document.querySelector('.btn-share');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '&#10003;';
      btn.title = 'Copied!';
      setTimeout(() => { btn.innerHTML = orig; btn.title = 'Copy Link'; }, 1500);
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
window.showOnMap = showOnMap;

// ── Swipe-to-Dismiss (mobile detail panel) ──
function setupSwipeToDismiss() {
  const panel = document.getElementById('detail-panel');
  let startX = 0;
  let currentX = 0;
  let dragging = false;

  panel.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    currentX = startX;
    // Only start swipe-right if touch starts in left 60px (edge gesture)
    if (startX > 60) return;
    dragging = true;
    panel.style.transition = 'none';
  }, { passive: true });

  panel.addEventListener('touchmove', e => {
    if (!dragging) return;
    currentX = e.touches[0].clientX;
    const dx = currentX - startX;
    if (dx > 0) {
      panel.style.transform = `translateX(${dx}px)`;
      panel.style.opacity = Math.max(0.3, 1 - dx / 400);
    }
  }, { passive: true });

  panel.addEventListener('touchend', () => {
    if (!dragging) return;
    dragging = false;
    panel.style.transition = '';
    const dx = currentX - startX;
    if (dx > 100) {
      closeDetail();
    } else {
      panel.style.transform = '';
      panel.style.opacity = '';
    }
  });
}

// ── Pull-to-Refresh (sauna list) ────────────
function setupPullToRefresh() {
  const list = document.getElementById('sauna-list');
  const indicator = document.getElementById('pull-refresh-indicator');
  let startY = 0;
  let pulling = false;

  list.addEventListener('touchstart', e => {
    if (list.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  list.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0 && list.scrollTop === 0) {
      const progress = Math.min(dy / 80, 1);
      indicator.style.height = Math.min(dy * 0.5, 40) + 'px';
      indicator.style.opacity = progress;
      indicator.querySelector('span').textContent = dy > 80 ? 'Release to refresh' : 'Pull to refresh';
    }
  }, { passive: true });

  list.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    const h = parseFloat(indicator.style.height) || 0;
    if (h >= 40) {
      indicator.querySelector('span').textContent = 'Refreshing...';
      indicator.style.height = '32px';
      try {
        await fetchSaunas();
        populateCountryFilter();
        refreshAll();
      } catch (e) { /* offline — keep cached data */ }
    }
    setTimeout(() => {
      indicator.style.height = '0';
      indicator.style.opacity = '0';
    }, 300);
  });
}

// ── PWA Service Worker ──────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ── Offline Detection ───────────────────────
function updateOfflineBanner() {
  document.getElementById('offline-banner').classList.toggle('hidden', navigator.onLine);
}
window.addEventListener('online', updateOfflineBanner);
window.addEventListener('offline', updateOfflineBanner);
if (!navigator.onLine) updateOfflineBanner();

init();
