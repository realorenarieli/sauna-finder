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

// ── State ────────────────────────────────────
let saunas = [];
let filteredSaunas = [];
let profile = loadProfile();
let selectedId = null;
let ratingTarget = null;
let ratingValue = 0;
let map, markerLayer;
let markerMode = 'score'; // 'score' or 'type'

// ── Profile (localStorage) ───────────────────
function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem('saunaProfile')) || {
      ratings: {},
      preferences: null,
      onboardingDone: false,
    };
  } catch {
    return { ratings: {}, preferences: null, onboardingDone: false };
  }
}

function saveProfile() {
  localStorage.setItem('saunaProfile', JSON.stringify(profile));
}

// ── Scoring ──────────────────────────────────
function calcScore(sauna, weights) {
  const dims = Object.keys(DEFAULT_WEIGHTS);
  return dims.reduce((sum, d) => sum + (sauna.scores[d] / 10) * weights[d], 0) * 100;
}

function finnishScore(sauna) {
  return calcScore(sauna, DEFAULT_WEIGHTS);
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

// ── Map ──────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([54, 18], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 19,
    subdomains: 'abcd',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  // Marker mode toggle control
  const MarkerToggle = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'marker-toggle leaflet-bar');
      container.innerHTML = `
        <button class="marker-toggle-btn active" data-mode="score" title="Show scores">123</button>
        <button class="marker-toggle-btn" data-mode="type" title="Show types">⛵</button>
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
}

function renderMarkers() {
  markerLayer.clearLayers();
  for (const sauna of filteredSaunas) {
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

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        width: ${size}px; height: ${size}px;
        border-radius: 50%;
        background: ${bg};
        border: 2px solid ${border};
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
  if (filteredSaunas.length === 0) {
    list.innerHTML = '<p style="padding:20px;color:var(--text-light);text-align:center">No saunas match your filters</p>';
    return;
  }

  list.innerHTML = filteredSaunas.map(sauna => {
    const fs = finnishScore(sauna);
    const fy = forYouScore(sauna);
    const isVisited = !!profile.ratings[sauna.id];

    return `
      <div class="sauna-card ${selectedId === sauna.id ? 'active' : ''}" data-id="${sauna.id}">
        <div class="sauna-card-info">
          <div class="sauna-card-name">${sauna.name}</div>
          <div class="sauna-card-location">${sauna.city}, ${sauna.country}</div>
          <div class="sauna-card-meta">
            <span class="tag">${TYPE_LABELS[sauna.type] || sauna.type}</span>
            <span class="tag">${sauna.price}</span>
            ${sauna.nude ? '<span class="tag tag-nude">DICKS OUT</span>' : ''}
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

  const fs = finnishScore(sauna);
  const fy = forYouScore(sauna);
  const tier = scoreTier(fs);
  const fyTier = fy !== null ? scoreTier(fy) : null;
  const isVisited = !!profile.ratings[sauna.id];
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
        <span class="detail-info-value">${TYPE_LABELS[sauna.type] || sauna.type}${sauna.nude ? ' <span class="tag tag-nude">DICKS OUT</span>' : ''}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Address</span>
        <span class="detail-info-value">${sauna.address} <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(sauna.address + ', ' + sauna.city)}" target="_blank" rel="noopener" class="maps-link" title="Open in Google Maps">&#x1F5FA;</a></span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Hours</span>
        <span class="detail-info-value">${sauna.hours}</span>
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

    <div class="detail-actions">
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
  `;

  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  requestAnimationFrame(() => panel.classList.add('visible'));

  // Fly to marker
  map.flyTo([sauna.lat, sauna.lng], Math.max(map.getZoom(), 8), { duration: 0.8 });

  renderMarkers();
  renderList();
}

function closeDetail() {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('visible');
  setTimeout(() => panel.classList.add('hidden'), 200);
  selectedId = null;
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

  filteredSaunas = saunas.filter(s => {
    if (search && !s.name.toLowerCase().includes(search) && !s.city.toLowerCase().includes(search) && !s.country.toLowerCase().includes(search)) return false;
    if (type !== 'all' && s.type !== type) return false;
    if (country !== 'all' && s.country !== country) return false;
    if (nude === 'nude' && !s.nude) return false;
    if (nude === 'clothed' && s.nude) return false;
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
  if (filteredSaunas.length === 0) return;
  if (filteredSaunas.length === 1) {
    map.flyTo([filteredSaunas[0].lat, filteredSaunas[0].lng], 12, { duration: 0.8 });
    return;
  }
  const bounds = L.latLngBounds(filteredSaunas.map(s => [s.lat, s.lng]));
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
  document.getElementById('filter-type').addEventListener('change', refreshAll);
  document.getElementById('filter-nude').addEventListener('change', refreshAll);
  document.getElementById('filter-country').addEventListener('change', () => refreshAll(true));

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

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('rating-modal').classList.contains('hidden')) {
        closeRating();
      } else if (!document.getElementById('detail-panel').classList.contains('hidden')) {
        closeDetail();
      }
    }
  });
}

// ── Init ─────────────────────────────────────
async function init() {
  try {
    const res = await fetch('data/saunas.json');
    saunas = await res.json();
  } catch (err) {
    console.error('Failed to load saunas:', err);
    document.getElementById('sauna-list').innerHTML =
      '<p style="padding:20px;color:var(--score-bottom)">Failed to load sauna data. Make sure you\'re running a local server.</p>';
    return;
  }

  initMap();
  populateCountryFilter();
  setupListeners();
  refreshAll();

  // Show onboarding on first visit
  if (!profile.onboardingDone) {
    showOnboarding();
  }
}

// Make functions available globally for onclick handlers
window.openRating = openRating;
window.removeRating = removeRating;

init();
