import { STOPS, CITIES, AREAS, REGIONS, REGION_SHORT } from './stops.js';
import { WeatherFX, WEATHER_LABEL, WEATHER_SKY, elevationAt } from './weather.js';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const OFM_URL = 'https://tiles.openfreemap.org/planet';
const SEG = 24;            // interpolated points per leg
const LAST = STOPS.length - 1;

// ---------- Geometry ----------
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeSine = (t) => (1 - Math.cos(Math.PI * t)) / 2;

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Softened Catmull-Rom so the path reads as a walked trail rather than straight spokes.
function smoothPath(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    for (let k = 0; k < SEG; k++) {
      const t = k / SEG, t2 = t * t, t3 = t2 * t;
      const cr = [0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t +
        (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3));
      const lin = [lerp(p1[0], p2[0], t), lerp(p1[1], p2[1], t)];
      out.push([lerp(lin[0], cr[0], 0.55), lerp(lin[1], cr[1], 0.55)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const stopCoords = STOPS.map((s) => [s.lon, s.lat]);
const path = smoothPath(stopCoords);
const legKm = STOPS.slice(0, -1).map((_, i) => {
  let d = 0;
  for (let k = i * SEG; k < (i + 1) * SEG; k++) d += haversineKm(path[k], path[k + 1]);
  return d;
});
const cumKm = legKm.reduce((acc, d) => (acc.push(acc[acc.length - 1] + d), acc), [0]);
const totalKm = cumKm[cumKm.length - 1];

// progress is measured in legs: 0 = Chhapaiya, 64 = Loj
function pointAt(progress) {
  const f = clamp(progress, 0, LAST) * SEG;
  const i = Math.min(Math.floor(f), path.length - 2);
  const t = f - i;
  return [lerp(path[i][0], path[i + 1][0], t), lerp(path[i][1], path[i + 1][1], t)];
}
const kmAt = (p) => {
  const i = Math.min(Math.floor(p), LAST - 1);
  return cumKm[i] + legKm[i] * (clamp(p, 0, LAST) - i);
};
// Each leg as its own line, plus distance fractions so the reveal tracks the traveler exactly
const legs = legKm.map((_, i) => path.slice(i * SEG, (i + 1) * SEG + 1));
const legFrac = legs.map((pts) => {
  const d = [0];
  for (let k = 1; k < pts.length; k++) d.push(d[k - 1] + haversineKm(pts[k - 1], pts[k]));
  return d.map((x) => x / (d[d.length - 1] || 1));
});
function legDistFrac(i, t) {
  const f = clamp(t, 0, 1) * SEG;
  const k = Math.min(Math.floor(f), SEG - 1);
  return lerp(legFrac[i][k], legFrac[i][k + 1], f - k);
}
// Inverse of legDistFrac: distance fraction along leg i -> parametric t
function legTAt(i, f) {
  const a = legFrac[i];
  let lo = 0, hi = SEG;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (a[m] <= f) lo = m; else hi = m;
  }
  return (lo + clamp((f - a[lo]) / (a[hi] - a[lo] || 1), 0, 1)) / SEG;
}
const legColor = (i) => `hsl(${lerp(44, 24, i / (LAST - 1)).toFixed(1)}, 84%, ${lerp(57, 50, i / (LAST - 1)).toFixed(1)}%)`;
const fmtKm = (km) => `${Math.round(km).toLocaleString()} km`;

// Contiguous runs of stops per region, for the list and timeline
const regionRuns = [];
STOPS.forEach((s, i) => {
  const last = regionRuns[regionRuns.length - 1];
  if (last && last.region === s.region) last.end = i;
  else regionRuns.push({ region: s.region, start: i, end: i });
});

// ---------- Map ----------
const demSource = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 12, worker: true });
demSource.setupMaplibre(maplibregl);

// Hypsometric tint: bathymetry blues → lowland sage → ochre uplands → stone → snow
const RELIEF = ['interpolate', ['linear'], ['elevation'],
  -6000, '#46698a', -3000, '#6489a6', -1000, '#89abc3', -150, '#adc8d8', -1, '#c3d9e3',
  0, '#e3e8d2', 150, '#e8e7cd', 400, '#ebdfbb', 800, '#e2cca2', 1500, '#d2b089',
  2500, '#bb9479', 3500, '#a68b7f', 4500, '#b4aaa4', 5300, '#e3dfda', 6200, '#ffffff'];

const map = new maplibregl.Map({
  container: 'map',
  center: [82.5, 21.5],
  zoom: 4.2,
  pitch: 0,
  maxPitch: 78,
  attributionControl: { compact: true },
  style: {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      satellite: { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      terrain: { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Elevation © Mapzen / AWS Terrain Tiles' },
      dem: { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 12 },
      ofm: { type: 'vector', url: OFM_URL },
      contours: {
        type: 'vector',
        tiles: [demSource.contourProtocolUrl({
          multiplier: 1,
          thresholds: { 7: [1000, 3000], 8: [500, 2000], 9: [250, 1000], 10: [100, 500], 11: [50, 250], 12: [20, 100] },
          elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
        })],
        maxzoom: 15,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#c3d9e3' } },
      { id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': RELIEF, 'color-relief-opacity': 1 } },
      { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' },
        paint: { 'raster-saturation': -0.2, 'raster-contrast': 0.06, 'raster-brightness-max': 0.94 } },
      { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water',
        paint: { 'fill-color': '#9fc2d5', 'fill-opacity': 0.45 } },
      { id: 'hillshade', type: 'hillshade', source: 'dem',
        paint: { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#4a3826', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#6b5640' } },
      { id: 'rivers', type: 'line', source: 'ofm', 'source-layer': 'waterway',
        filter: ['==', ['get', 'class'], 'river'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7aa5bf', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 1.1, 12, 2.2] } },
      { id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 7,
        paint: {
          'line-color': ['match', ['get', 'level'], 1, 'rgba(92,62,34,0.42)', 'rgba(92,62,34,0.18)'],
          'line-width': ['match', ['get', 'level'], 1, 0.9, 0.45],
        } },
      { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 10,
        filter: ['>', ['get', 'level'], 0],
        layout: {
          'symbol-placement': 'line', 'text-size': 9.5, 'text-font': ['Noto Sans Regular'],
          'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
        },
        paint: { 'text-color': 'rgba(92,62,34,0.85)', 'text-halo-color': 'rgba(255,255,255,0.7)', 'text-halo-width': 1 } },
      { id: 'borders', type: 'line', source: 'ofm', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': 'rgba(62,46,32,0.5)', 'line-width': 0.9, 'line-dasharray': [3, 2] } },
    ],
  },
});
if (location.hash === '#debug') window.__map = map;   // handy for console poking
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

// Per-theme layer visibility and paint. Route layers are added on load.
const THEMES = {
  atlas: {
    visible: ['relief', 'water', 'rivers'],
    hidden: ['satellite'],
    paint: {
      'bg': { 'background-color': '#c3d9e3' },
      'hillshade': { 'hillshade-exaggeration': 0.45, 'hillshade-shadow-color': '#4a3826', 'hillshade-highlight-color': '#ffffff' },
      'contour-lines': { 'line-color': ['match', ['get', 'level'], 1, 'rgba(92,62,34,0.42)', 'rgba(92,62,34,0.18)'] },
      'contour-labels': { 'text-color': 'rgba(92,62,34,0.85)', 'text-halo-color': 'rgba(255,255,255,0.7)' },
      'borders': { 'line-color': 'rgba(62,46,32,0.5)' },
      'route-casing': { 'line-color': '#ffffff', 'line-opacity': 0.6 },
      'route-dash': { 'line-color': '#2b231c', 'line-opacity': 0.55 },
      'done-glow': { 'line-opacity': ['case', ['boolean', ['feature-state', 'done'], false], 0, 0] },
      'cur-glow': { 'line-opacity': 0 },
      'done-casing': { 'line-opacity': ['case', ['boolean', ['feature-state', 'done'], false], 0.95, 0] },
      'cur-casing': { 'line-opacity': 0.95 },
    },
    sky: { 'sky-color': '#d6e4ec', 'horizon-color': '#f4f0e8', 'fog-color': '#eee9df', 'sky-horizon-blend': 0.7, 'horizon-fog-blend': 0.8, 'fog-ground-blend': 0.3 },
  },
  satellite: {
    visible: ['satellite'],
    hidden: ['relief', 'water', 'rivers'],
    paint: {
      'bg': { 'background-color': '#1d2a30' },
      'hillshade': { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#1a1208', 'hillshade-highlight-color': '#fff6dc' },
      'contour-lines': { 'line-color': ['match', ['get', 'level'], 1, 'rgba(255,248,230,0.45)', 'rgba(255,248,230,0.18)'] },
      'contour-labels': { 'text-color': '#fff3d6', 'text-halo-color': 'rgba(30,20,8,0.7)' },
      'borders': { 'line-color': 'rgba(255,255,255,0.45)' },
      'route-casing': { 'line-color': '#000000', 'line-opacity': 0.35 },
      'route-dash': { 'line-color': '#ffffff', 'line-opacity': 0.85 },
      'done-glow': { 'line-opacity': ['case', ['boolean', ['feature-state', 'done'], false], 0.5, 0] },
      'cur-glow': { 'line-opacity': 0.5 },
      'done-casing': { 'line-opacity': 0 },
      'cur-casing': { 'line-opacity': 0 },
    },
    sky: { 'sky-color': '#8fb7da', 'horizon-color': '#e9e2d4', 'fog-color': '#d9d3c6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.25 },
  },
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('btn-play'), playLabel: $('play-label'), prev: $('btn-prev'), next: $('btn-next'),
  overview: $('btn-overview'), weather: $('tg-weather'), terrain: $('tg-terrain'), contours: $('tg-contours'), follow: $('tg-follow'),
  exag: $('rg-exag'), exagOut: $('out-exag'), list: $('stop-list'), scrub: $('scrub'), card: $('card'),
  tlRegions: $('tl-regions'), roStop: $('ro-stop'), roKm: $('ro-km'),
};
const container = map.getContainer();
$('stat-km').textContent = fmtKm(totalKm);
ui.scrub.max = LAST;

// Segmented controls
let speedVal = 1;
let theme = 'atlas';
function bindSeg(id, onChange) {
  const seg = $(id);
  seg.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    };
  });
}
bindSeg('seg-speed', (v) => (speedVal = parseFloat(v)));
bindSeg('seg-style', (v) => applyTheme(v));

// Sidebar list grouped by region
const listItems = [];
regionRuns.forEach((run) => {
  const h = document.createElement('li');
  h.className = 'region-head';
  h.innerHTML = `<b>${REGIONS[run.region]}</b><small>${run.start + 1}–${run.end + 1}</small>`;
  ui.list.appendChild(h);
  for (let i = run.start; i <= run.end; i++) {
    const s = STOPS[i];
    const li = document.createElement('li');
    li.className = 'stop';
    li.innerHTML = `<span class="n">${s.n}</span><span class="t">${s.name}${s.alt ? `<small>${s.alt}</small>` : ''}</span><span class="km">${fmtKm(cumKm[i])}</span>`;
    li.onclick = () => jumpTo(i);
    ui.list.appendChild(li);
    listItems.push(li);
  }
});

// Timeline region labels, sized by how many legs each region spans
const tlSpans = regionRuns.map((run, k) => {
  const next = regionRuns[k + 1];
  const span = document.createElement('span');
  span.textContent = REGION_SHORT[run.region];
  span.title = REGIONS[run.region];
  span.style.flex = `${(next ? next.start : LAST) - run.start} 0 0`;
  span.onclick = () => jumpTo(run.start);
  ui.tlRegions.appendChild(span);
  return span;
});

// Markers
const stopMarkers = STOPS.map((s, i) => {
  const el = document.createElement('div');
  el.className = 'stop-marker';
  el.innerHTML = `<div class="disc">${s.n}</div><div class="tip">${s.name}</div>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(i); });
  return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
});
CITIES.forEach((c) => {
  const el = document.createElement('div');
  const left = c.side === 'left';
  el.className = `city${c.minor ? ' minor' : ''}${left ? ' left' : ''}`;
  el.innerHTML = `<i></i><span>${c.name}</span>`;
  new maplibregl.Marker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? 3 : -3, 0] })
    .setLngLat([c.lon, c.lat]).addTo(map);
});
AREAS.forEach((a) => {
  const el = document.createElement('div');
  el.className = `area ${a.kind}`;
  el.textContent = a.name;
  new maplibregl.Marker({ element: el, rotation: a.rotate || 0, rotationAlignment: 'map', pitchAlignment: 'map' })
    .setLngLat([a.lon, a.lat]).addTo(map);
});
const travelerEl = document.createElement('div');
travelerEl.className = 'traveler';
const traveler = new maplibregl.Marker({ element: travelerEl }).setLngLat(stopCoords[0]).addTo(map);

// ---------- State ----------
let progress = 0;          // continuous position along journey, in legs
let active = -1;           // index of stop whose card is shown
let reachedIdx = -1;
let curLeg = -1;           // leg currently held in the 'cur' source
let doneLegs = 0;          // legs [0, doneLegs) are flagged done via feature-state
let playing = false;
let raf = null;
let lastUi = 0;            // throttle for panel text during playback
let lastWx = 0;            // throttle for weather sampling
let lastCut = -1;          // last gradient cut-off drawn
let wx = 'clear';          // current weather condition

function setProgress(p) {
  progress = clamp(p, 0, LAST);
  drawWalked();
  traveler.setLngLat(pointAt(progress));
  ui.scrub.value = progress;
  ui.scrub.style.setProperty('--p', `${(progress / LAST) * 100}%`);
  const now = performance.now();
  if (!playing || now - lastUi > 120) {
    lastUi = now;
    ui.roKm.textContent = `${fmtKm(kmAt(progress))} walked`;
  }
  if (!playing || now - lastWx > 250) {
    lastWx = now;
    updateWeather();
  }

  const reached = Math.floor(progress + 1e-6);
  if (reached !== reachedIdx) {
    reachedIdx = reached;
    stopMarkers.forEach((m, i) => m.getElement().classList.toggle('visited', i <= reached));
    listItems.forEach((li, i) => li.classList.toggle('visited', i <= reached));
    const run = regionRuns.findIndex((r) => reached >= r.start && reached <= r.end);
    tlSpans.forEach((s, k) => s.classList.toggle('on', k === run));
  }
}

function setActive(i) {
  if (i === active) return;
  active = i;
  stopMarkers.forEach((m, j) => m.getElement().classList.toggle('active', j === i));
  listItems.forEach((li, j) => li.classList.toggle('active', j === i));
  listItems[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  ui.roStop.textContent = `Stop ${i + 1} of ${STOPS.length}`;

  const s = STOPS[i];
  $('card-num').textContent = s.n;
  $('card-region').textContent = REGIONS[s.region];
  $('card-name').textContent = s.name;
  $('card-alt').textContent = [s.alt, s.approx && 'location approximate'].filter(Boolean).join(' · ');
  $('card-note').textContent = s.note || '';
  $('card-leg').textContent = i > 0 ? fmtKm(legKm[i - 1]) : '—';
  $('card-total').textContent = fmtKm(cumKm[i]);
  ui.card.classList.remove('hidden', 'swap');
  void ui.card.offsetWidth; // restart the entrance animation
  ui.card.classList.add('swap');
}

function drawWalked() {
  if (!map.getSource('cur')) return;
  const leg = Math.min(Math.floor(progress), LAST - 1);
  const t = progress - leg;
  // Completed legs: feature-state flips are applied on the render thread, no re-tiling.
  const done = leg;
  for (let i = Math.min(done, doneLegs); i < Math.max(done, doneLegs); i++) {
    map.setFeatureState({ source: 'legs', id: i }, { done: i < done });
  }
  doneLegs = done;
  // Current leg: geometry swaps once per leg; the reveal is a gradient cut-off.
  if (leg !== curLeg) {
    curLeg = leg;
    map.getSource('cur').setData(line(legs[leg]));
  }
  // Gradient changes re-rasterise a ramp, so skip sub-pixel changes and hidden layers.
  const f = legDistFrac(leg, t);
  if (Math.abs(f - lastCut) < 0.002 && f !== 0 && f !== 1) return;
  lastCut = f;
  const cut = (c) => (f <= 0 ? 'rgba(0,0,0,0)' : ['step', ['line-progress'], c, f, 'rgba(0,0,0,0)']);
  map.setPaintProperty('cur-line', 'line-gradient', cut(legColor(leg)));
  map.setPaintProperty(theme === 'atlas' ? 'cur-casing' : 'cur-glow', 'line-gradient', cut(theme === 'atlas' ? '#ffffff' : '#ffb15c'));
}

// ---------- Weather ----------
const fx = new WeatherFX($('fx'), $('fx-tint'));
const RAINY = new Set([19, 20, 21, 22, 23, 24, 25, 44, 45, 46, 47]);   // monsoon belts: Bengal, Northeast, Kerala
const HOT = new Set(['gujarat', 'deccan', 'maharashtra']);
const WX_ICON = {
  snow: '<path d="M8 1.5v13M2.4 4.8l11.2 6.4M2.4 11.2l11.2-6.4"/>',
  rain: '<path d="M4 12.5l-1 2M8 12.5l-1 2M12 12.5l-1 2"/><path d="M4.5 10.5a3 3 0 0 1 .3-6 4 4 0 0 1 7.4 1.2 2.4 2.4 0 0 1-.7 4.8z"/>',
  mist: '<path d="M2 5.5h12M3.5 8.5h9M2 11.5h12"/>',
  heat: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  clear: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.2M8 12.8V14M2 8h1.2M12.8 8H14"/>',
};
WX_ICON.flurries = WX_ICON.snow;

function classify(elev, stop) {
  if (elev >= 3000) return ['snow', clamp(0.55 + (elev - 3000) / 3000, 0.55, 1)];
  if (elev >= 2300) return ['flurries', 0.3];
  if (RAINY.has(stop.n)) return ['rain', 0.85];
  if (elev >= 900) return ['mist', 0.75];
  if (HOT.has(stop.region)) return ['heat', 0.6];
  return ['clear', 0];
}

let wxSeq = 0;
let lastElev = null;
async function updateWeather() {
  const seq = ++wxSeq;
  const elev = await elevationAt(DEM_URL, pointAt(progress));
  if (seq !== wxSeq) return;                       // a newer sample superseded this one
  if (elev != null) lastElev = Math.max(0, elev);
  if (lastElev == null) return;
  const [kind, level] = classify(lastElev, STOPS[Math.round(progress)]);
  fx.set(kind, level);
  $('wx-elev').textContent = `${Math.round(lastElev).toLocaleString()} m`;
  if (kind !== wx) {
    wx = kind;
    $('wx-label').textContent = WEATHER_LABEL[kind];
    $('wx-ico').innerHTML = `<svg viewBox="0 0 16 16">${WX_ICON[kind]}</svg>`;
    $('card-wx').dataset.wx = kind;
    applySky();
  }
}

function applySky() {
  if (!map.getLayer('route-dash')) return;
  const base = ui.weather.checked ? WEATHER_SKY[wx === 'flurries' ? 'snow' : wx] : {};
  map.setSky({ ...THEMES[theme].sky, ...base });
}

const line = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });

function applyTheme(name) {
  theme = name;
  const t = THEMES[name];
  container.classList.toggle('theme-atlas', name === 'atlas');
  container.classList.toggle('theme-satellite', name === 'satellite');
  fx.setLightBasemap(name === 'atlas');
  if (!map.getLayer('route-dash')) return; // route layers not added yet; reapplied on load
  t.visible.forEach((id) => map.setLayoutProperty(id, 'visibility', 'visible'));
  t.hidden.forEach((id) => map.setLayoutProperty(id, 'visibility', 'none'));
  Object.entries(t.paint).forEach(([id, props]) => {
    Object.entries(props).forEach(([k, v]) => map.setPaintProperty(id, k, v));
  });
  lastCut = -1;
  drawWalked();
  applySky();
}

// ---------- Playback ----------
function setPlaying(on) {
  playing = on;
  ui.play.classList.toggle('playing', on);
  ui.playLabel.textContent = on ? 'Pause' : progress >= LAST ? 'Walk it again' : progress > 0 ? 'Continue' : 'Begin the journey';
  if (!on && raf) { cancelAnimationFrame(raf); raf = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Zoom at which a leg of `km` fits comfortably on screen.
const legZoom = (km) => clamp(Math.log2(41500 / Math.max(km, 4)), 5, 10);
const ARRIVE_ZOOM = 9.2;
// Flatter view when zoomed out, steeper when close to the terrain.
const pitchFor = (zoom) => lerp(35, 62, clamp((zoom - 5) / 4, 0, 1));
// Keep the map roughly north-up; sway gently toward the direction of travel.
const swayBearing = (b) => clamp((((b + 180) % 360) - 180) * 0.3, -25, 25);

function shortestAngle(from, to) {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

// Van Wijk & Nuij "optimal" zoom-and-pan path, the same curve map.flyTo uses.
// Returns zoom and distance fraction as functions of path parameter s in [0, S].
const RHO = 1.42;
function flight(fromLL, toLL, z0, z1) {
  const a = maplibregl.MercatorCoordinate.fromLngLat(fromLL);
  const b = maplibregl.MercatorCoordinate.fromLngLat(toLL);
  const u1 = Math.hypot(b.x - a.x, b.y - a.y) * 512 * 2 ** z0;      // pixels at start zoom
  const { width, height } = container.getBoundingClientRect();
  const w0 = Math.max(width, height), w1 = w0 / 2 ** (z1 - z0), rho2 = RHO * RHO;
  const r = (k) => {
    const q = (w1 * w1 - w0 * w0 + (k ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * (k ? w1 : w0) * rho2 * u1);
    return Math.log(Math.sqrt(q * q + 1) - q);
  };
  const r0 = r(0);
  let S = (r(1) - r0) / RHO;
  let w = (x) => Math.cosh(r0) / Math.cosh(r0 + RHO * x);
  let u = (x) => (w0 * ((Math.cosh(r0) * Math.tanh(r0 + RHO * x) - Math.sinh(r0)) / rho2)) / u1;
  if (u1 < 1e-6 || !isFinite(S)) {
    const dir = w1 < w0 ? -1 : 1;
    S = Math.abs(Math.log(w1 / w0)) / RHO || 0.0001;
    u = (x) => x / S;
    w = (x) => Math.exp(dir * RHO * x);
  }
  return { S, zoomAt: (x) => z0 + Math.log2(1 / w(x)), fracAt: (x) => clamp(u(x), 0, 1) };
}

// Walk from current progress to the next whole stop. The traveler's ground position
// follows the same curve as the camera, so it stays centred and screen speed stays even.
function walkLeg() {
  return new Promise((resolve) => {
    const i = Math.floor(progress + 1e-6);
    if (i >= LAST) return resolve();
    const f0 = legDistFrac(i, progress - i);
    const follow = ui.follow.checked;
    const fl = follow ? flight(pointAt(progress), stopCoords[i + 1], map.getZoom(), ARRIVE_ZOOM) : null;
    const dur = (fl ? clamp(700 + 1150 * fl.S, 1800, 8000) : clamp(1500 + legKm[i] * 3, 1800, 6000)) / speedVal;
    const b0 = map.getBearing();
    const b1 = shortestAngle(b0, swayBearing(bearing(stopCoords[i], stopCoords[i + 1])));
    const t0 = performance.now();

    const frame = (now) => {
      if (!playing) return resolve();
      const t = clamp((now - t0) / dur, 0, 1);
      const k = easeSine(t);
      const x = fl ? k * fl.S : 0;
      const f = f0 + (1 - f0) * (fl ? fl.fracAt(x) : k);
      const p = t >= 1 ? i + 1 : i + legTAt(i, f);
      setProgress(p);
      if (fl && ui.follow.checked) {
        const zoom = fl.zoomAt(x);
        map.jumpTo({ center: pointAt(p), zoom, bearing: lerp(b0, b1, k), pitch: pitchFor(zoom) });
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else resolve();
    };
    raf = requestAnimationFrame(frame);
  });
}

const moveEnd = () => new Promise((r) => map.once('moveend', r));

async function play() {
  if (progress >= LAST) { jumpTo(0, { fly: false }); await sleep(300); }
  setPlaying(true);
  if (ui.follow.checked && Math.abs(map.getZoom() - ARRIVE_ZOOM) > 0.5) {
    const done = moveEnd();
    map.flyTo({ center: pointAt(progress), zoom: ARRIVE_ZOOM, pitch: pitchFor(ARRIVE_ZOOM), bearing: 0, duration: 2600 / speedVal, essential: true });
    await done;
  }
  while (playing && progress < LAST) {
    await walkLeg();
    if (!playing) break;
    setActive(Math.round(progress));
    const dwell = 1300 / speedVal;
    // Slow drift while paused at a tirth, so the camera never fully freezes
    if (ui.follow.checked) map.easeTo({ bearing: map.getBearing() + 3, duration: dwell, easing: (x) => x, essential: true });
    await sleep(dwell);
  }
  setPlaying(false);
}

function jumpTo(i, { fly = true } = {}) {
  setPlaying(false);
  i = clamp(i, 0, LAST);
  setProgress(i);
  setActive(i);
  setPlaying(false);
  if (fly) {
    const zoom = ARRIVE_ZOOM + 0.8;
    map.flyTo({ center: stopCoords[i], zoom, pitch: pitchFor(zoom), bearing: map.getBearing(), duration: 2400, essential: true });
  }
}

function overview(duration = 2200) {
  setPlaying(false);
  const b = new maplibregl.LngLatBounds();
  stopCoords.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding: { top: 60, bottom: 120, left: 380, right: 60 }, pitch: 28, bearing: 0, duration, essential: true });
}

// ---------- Wiring ----------
ui.play.onclick = () => (playing ? setPlaying(false) : play());
ui.prev.onclick = () => jumpTo(Math.ceil(progress - 1e-6) - 1);
ui.next.onclick = () => jumpTo(Math.floor(progress + 1e-6) + 1);
ui.overview.onclick = () => overview();
ui.scrub.oninput = () => {
  setPlaying(false);
  setProgress(parseFloat(ui.scrub.value));
  setActive(Math.round(progress));
  map.easeTo({ center: pointAt(progress), duration: 250 });
};
const setExag = () => {
  const v = parseFloat(ui.exag.value);
  ui.exagOut.textContent = `${v.toFixed(1)}×`;
  ui.exag.style.setProperty('--p', `${((v - ui.exag.min) / (ui.exag.max - ui.exag.min)) * 100}%`);
  if (ui.terrain.checked && map.getTerrain()) map.setTerrain({ source: 'terrain', exaggeration: v });
};
ui.exag.oninput = setExag;
ui.terrain.onchange = () => {
  map.setTerrain(ui.terrain.checked ? { source: 'terrain', exaggeration: parseFloat(ui.exag.value) } : null);
};
ui.weather.onchange = () => {
  fx.setEnabled(ui.weather.checked);
  wx = '';             // force label + sky refresh
  updateWeather();
};
ui.contours.onchange = () => {
  const v = ui.contours.checked ? 'visible' : 'none';
  map.setLayoutProperty('contour-lines', 'visibility', v);
  map.setLayoutProperty('contour-labels', 'visibility', v);
};
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return;
  if (e.code === 'Space') { e.preventDefault(); ui.play.click(); }
  if (e.code === 'ArrowRight') ui.next.click();
  if (e.code === 'ArrowLeft') ui.prev.click();
});
// Stop the tour if the user grabs the map
['mousedown', 'touchstart', 'wheel'].forEach((ev) =>
  map.getCanvasContainer().addEventListener(ev, () => playing && setPlaying(false), { passive: true }));

// Marker size and label density follow zoom
function onZoom() {
  const z = map.getZoom();
  container.style.setProperty('--ms', `${clamp(lerp(15, 22, (z - 4) / 5), 15, 22).toFixed(1)}px`);
  container.classList.toggle('z-far', z < 6.2);
  container.classList.toggle('z-mid', z >= 6.2 && z < 7);
  container.classList.toggle('z-near', z >= 7);
}
map.on('zoom', onZoom);
onZoom();
applyTheme('atlas');
setExag();

map.on('load', () => {
  map.setTerrain({ source: 'terrain', exaggeration: parseFloat(ui.exag.value) });

  map.addSource('route', { type: 'geojson', data: line(path) });
  map.addSource('legs', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: legs.map((c, k) => ({ ...line(c), id: k, properties: { color: legColor(k) } })) },
  });
  map.addSource('cur', { type: 'geojson', data: line(legs[0]), lineMetrics: true });
  const round = { 'line-cap': 'round', 'line-join': 'round' };
  const isDone = (on, off = 0) => ['case', ['boolean', ['feature-state', 'done'], false], on, off];
  map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: round,
    paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-blur': 1, 'line-opacity': 0.6 } });
  map.addLayer({ id: 'route-dash', type: 'line', source: 'route', layout: { 'line-join': 'round' },
    paint: { 'line-color': '#2b231c', 'line-width': 1.6, 'line-dasharray': [2, 2], 'line-opacity': 0.55 } });
  map.addLayer({ id: 'done-glow', type: 'line', source: 'legs', layout: round,
    paint: { 'line-color': '#ffb15c', 'line-width': 12, 'line-blur': 8, 'line-opacity': isDone(0) } });
  map.addLayer({ id: 'done-casing', type: 'line', source: 'legs', layout: round,
    paint: { 'line-color': '#ffffff', 'line-width': 6, 'line-opacity': isDone(0.95) } });
  map.addLayer({ id: 'done-line', type: 'line', source: 'legs', layout: round,
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': isDone(1) } });
  map.addLayer({ id: 'cur-glow', type: 'line', source: 'cur', layout: round,
    paint: { 'line-width': 12, 'line-blur': 8, 'line-opacity': 0, 'line-gradient': 'rgba(0,0,0,0)' } });
  map.addLayer({ id: 'cur-casing', type: 'line', source: 'cur', layout: round,
    paint: { 'line-width': 6, 'line-opacity': 0.95, 'line-gradient': 'rgba(0,0,0,0)' } });
  map.addLayer({ id: 'cur-line', type: 'line', source: 'cur', layout: round,
    paint: { 'line-width': 3, 'line-gradient': 'rgba(0,0,0,0)' } });

  // Start with credits collapsed behind the ⓘ button
  container.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');

  applyTheme(theme);
  setProgress(0);
  setActive(0);
  setPlaying(false);
  overview(3200);
});
