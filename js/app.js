import { STOPS, CITIES, AREAS, REGIONS, REGION_SHORT } from './stops.js';
import { WeatherFX, WEATHER_LABEL, WEATHER_SKY, elevationAt } from './weather.js';
import { buildChronology } from './chronology.js';

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

const CHRONO = buildChronology(legKm);

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

// Markers. MapLibre's terrain occlusion test does a synchronous gl.readPixels per
// marker every 100 ms; with ~90 markers that stalls the GPU in bursts and makes
// camera motion stutter. Our markers sit on the route, so skip the test.
class FlatMarker extends maplibregl.Marker {
  _updateOpacity() {
    if (this._element.style.opacity !== '') this._element.style.opacity = '';
  }
}

const stopMarkers = STOPS.map((s, i) => {
  const el = document.createElement('div');
  el.className = `stop-marker${s.key ? ` key side-${s.side}` : ''}`;
  el.innerHTML = `<div class="disc">${s.n}</div><div class="tip">${s.n} · ${s.name}</div>` +
    `<div class="slabel"><b>${s.name}</b><small></small></div>` +
    (s.key ? `<div class="mlabel">${s.key}</div>` : '');
  el.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(i); });
  return new FlatMarker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
});
CITIES.forEach((c) => {
  const el = document.createElement('div');
  const left = c.side === 'left';
  el.className = `city${c.minor ? ' minor' : ''}${left ? ' left' : ''}`;
  el.innerHTML = `<div class="fade"><i></i><span>${c.name}</span></div>`;
  new FlatMarker({ element: el, anchor: left ? 'right' : 'left', offset: [left ? 3 : -3, 0] })
    .setLngLat([c.lon, c.lat]).addTo(map);
});
AREAS.forEach((a) => {
  const el = document.createElement('div');
  el.className = `area ${a.kind}`;
  el.innerHTML = `<span class="fade">${a.name}</span>`;
  new FlatMarker({ element: el, rotation: a.rotate || 0, rotationAlignment: 'map', pitchAlignment: 'map' })
    .setLngLat([a.lon, a.lat]).addTo(map);
});
const travelerEl = document.createElement('div');
travelerEl.className = 'traveler';
const traveler = new FlatMarker({ element: travelerEl }).setLngLat(stopCoords[0]).addTo(map);

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
let wx = '';               // current weather condition ('' forces first paint)

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
    updateNextLabel();
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
  updateSkyCard();
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
// Weather sits between the map canvas and the HTML markers, so snow and rain
// fall behind the stop names rather than washing them out.
map.getCanvasContainer().insertBefore($('fx-layer'), map.getCanvas().nextSibling);
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
  if (lookMode) return;
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

// ---------- Night sky ----------
// sky.js (astronomy-engine + a 200 KB star catalog) loads on first use.
let skyMod = null, skyLoading = null;
const loadSky = () => (skyLoading ||= import('./sky.js').then((m) => (skyMod = m)));
let skyOpen = false;
let lookMode = false;
let skyState = null;
let dayPaint = null;
const LOOK_PITCH = 104;          // >90 looks above the horizon
const LOOK_FOV = 60, MAP_FOV = 36.87;   // wider, closer to the eye, while standing in a town
const dome = $('dome');
map.getCanvasContainer().insertBefore(dome, map.getCanvas());   // behind the map: terrain hides stars

const fmtDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtHour = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
};

let skySeq = 0;
async function updateSkyCard() {
  const i = active;
  if (i < 0) return;
  const c = CHRONO[i];
  $('sky-date').textContent = `${c.kind === 'estimated' ? '≈ ' : ''}${fmtDate(c.date)}`;
  if (!skyOpen && !lookMode) return;
  const seq = ++skySeq;
  const sk = await loadSky();
  if (seq !== skySeq) return;
  const s = STOPS[i];
  const hour = parseFloat($('sky-hour').value);
  skyState = sk.computeSky(sk.localNight(c.date, s.lon, hour), s.lat, s.lon);
  $('sky-tithi').textContent = `${skyState.tithi.paksha} ${skyState.tithi.day}`;
  $('sky-nak').textContent = skyState.nakshatra;
  $('sky-hour-out').textContent = fmtHour(hour);
  $('sky-note').textContent = c.kind === 'traditional'
    ? 'Date from tradition. Positions computed for that night.'
    : `Date estimated from the route${c.stay ? `, including a ~${c.stay}-day stay` : ''}. Positions computed for that night.`;
  if (skyOpen && !lookMode) sk.drawChart($('sky-chart'), skyState);
  if (lookMode) { applyNightPaint(); map.triggerRepaint(); }
}

$('sky-toggle').onclick = () => {
  skyOpen = !skyOpen;
  ui.card.classList.toggle('sky-open', skyOpen);
  $('sky-toggle').setAttribute('aria-expanded', skyOpen);
  updateSkyCard();
};
const hourInput = $('sky-hour');
const setHourFill = () => hourInput.style.setProperty('--p', `${((hourInput.value - hourInput.min) / (hourInput.max - hourInput.min)) * 100}%`);
let hourRaf = 0;
hourInput.oninput = () => {
  setHourFill();
  cancelAnimationFrame(hourRaf);
  hourRaf = requestAnimationFrame(updateSkyCard);
};
setHourFill();

// Night look for the terrain; brightness follows the Moon
const NIGHT = {
  bg: { 'background-color': '#0a1220' },
  water: { 'fill-color': '#0c1830', 'fill-opacity': 0.85 },
  rivers: { 'line-color': '#1f3352' },
  hillshade: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#53627c', 'hillshade-accent-color': '#000000' },
  'contour-lines': { 'line-color': 'rgba(150,175,220,0.14)' },
  borders: { 'line-color': 'rgba(150,170,200,0.3)' },
  // hide the route while you stand in the town
  'route-dash': { 'line-opacity': 0 }, 'route-casing': { 'line-opacity': 0 },
  'done-line': { 'line-opacity': 0 }, 'done-casing': { 'line-opacity': 0 }, 'done-glow': { 'line-opacity': 0 },
  'cur-line': { 'line-opacity': 0 }, 'cur-casing': { 'line-opacity': 0 }, 'cur-glow': { 'line-opacity': 0 },
  relief: { 'color-relief-opacity': 0.3 },
  satellite: { 'raster-brightness-max': 0.3, 'raster-saturation': -0.5 },
};
function applyNightPaint() {
  const moonlight = skyState && skyState.moon.alt > 0 ? skyState.moon.fraction * Math.sin(toRad(skyState.moon.alt)) : 0;
  const dusk = skyState ? 1 - skyMod.darkness(skyState) : 0;
  for (const [id, props] of Object.entries(NIGHT)) for (const [k, v] of Object.entries(props)) map.setPaintProperty(id, k, v);
  map.setPaintProperty('relief', 'color-relief-opacity', clamp(0.1 + 0.22 * moonlight + 0.6 * dusk, 0, 1));
  map.setPaintProperty('satellite', 'raster-brightness-max', clamp(0.12 + 0.25 * moonlight + 0.6 * dusk, 0, 1));
  // transparent sky lets the star dome behind the canvas show through
  map.setSky({ 'sky-color': 'rgba(0,0,0,0)', 'horizon-color': 'rgba(0,0,0,0)', 'fog-color': '#0d1830',
    'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.2, 'sky-horizon-blend': 0, 'atmosphere-blend': 0 });
}

function drawDomeNow() {
  if (!lookMode || !skyState || !skyMod) return;
  skyMod.drawDome(dome, skyState, { bearing: map.getBearing(), pitch: map.getPitch(), fov: map.transform.fov || 36.87, lines: true });
}
map.on('render', drawDomeNow);

// First-person camera standing at the town, terrain at true scale, so the
// mountains sit on the horizon at the angle he would have seen them.
let lookCam = null;
// roll must be explicit: undefined is passed through and yields a NaN matrix
const lookOptions = () => map.calculateCameraOptionsFromCameraLngLatAltRotation(lookCam.lngLat, lookCam.alt, lookCam.bearing, lookCam.pitch, 0);

// easeTo/flyTo cap pitch at 90° and ignore camera altitude, so the descent into
// first person is tweened by hand: camera position, altitude (log scale), heading, pitch.
function tweenCamera(to, duration, hump = 0) {
  const tr = map.transform;
  const ll = tr.getCameraLngLat();
  const from = { lngLat: [ll.lng, ll.lat], alt: Math.max(1, tr.getCameraAltitude()), bearing: map.getBearing(), pitch: map.getPitch() };
  const b1 = shortestAngle(from.bearing, to.bearing);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (now) => {
      if (!lookMode) return resolve();
      const k = smoothstep(0, 1, (now - t0) / duration);
      const pitch = hump > 0
        ? (k < 0.5 ? lerp(from.pitch, 70, k * 2) : lerp(70, to.pitch, (k - 0.5) * 2))   // glance down while travelling
        : lerp(from.pitch, to.pitch, k);
      lookCam = {
        lngLat: [lerp(from.lngLat[0], to.lngLat[0], k), lerp(from.lngLat[1], to.lngLat[1], k)],
        alt: Math.exp(lerp(Math.log(from.alt), Math.log(to.alt), k)) + hump * Math.sin(Math.PI * k),
        bearing: lerp(from.bearing, b1, k),
        pitch,
      };
      map.jumpTo(lookOptions());
      if (k < 1) requestAnimationFrame(step);
      else { lookCam = { ...to }; resolve(); }
    };
    requestAnimationFrame(step);
  });
}

async function standAt(i, bearing, duration, travel = false, pitch = LOOK_PITCH) {
  const ground = (await elevationAt(DEM_URL, stopCoords[i])) ?? 0;
  const to = { lngLat: stopCoords[i], alt: Math.max(0, ground) + 120, bearing, pitch };
  const km = lookCam ? haversineKm(lookCam.lngLat, to.lngLat) : 0;
  return tweenCamera(to, duration, travel ? Math.min(120000, km * 450) : 0);
}

async function enterLook() {
  await loadSky();
  setPlaying(false);
  dayPaint = {};
  for (const [id, props] of Object.entries(NIGHT)) {
    dayPaint[id] = {};
    for (const k of Object.keys(props)) dayPaint[id][k] = map.getPaintProperty(id, k);
  }
  lookMode = true;
  fx.set('clear', 0);
  container.classList.add('night');
  ui.card.classList.add('looking');
  $('btn-lookup').textContent = 'Back to the map';
  dome.hidden = false;
  map.dragPan.disable();
  map.setMaxPitch(150);
  map.setCenterClampedToGround(false);
  map.setTerrain({ source: 'terrain', exaggeration: 1 });
  map.setVerticalFieldOfView(LOOK_FOV);
  await updateSkyCard();
  // Descend from wherever the camera is, land at the town, and lift your gaze
  // Face the Moon if it's up; keep the horizon just inside the bottom edge
  const m = skyState.moon;
  const moonUp = m.alt > 8;
  lookCam = null;
  const gaze = moonUp ? clamp(m.alt - LOOK_FOV / 3, 12, LOOK_FOV / 2 - 2) : 14;
  await standAt(active, moonUp ? m.az : 180, 4200, false, 90 + gaze);
}

function exitLook() {
  lookMode = false;
  container.classList.remove('night');
  ui.card.classList.remove('looking');
  $('btn-lookup').textContent = 'Look up ↑';
  dome.hidden = true;
  map.dragPan.enable();
  for (const [id, props] of Object.entries(dayPaint || {})) for (const [k, v] of Object.entries(props)) map.setPaintProperty(id, k, v);
  applyTheme(theme);
  map.setCenterClampedToGround(true);
  if (ui.terrain.checked) map.setTerrain({ source: 'terrain', exaggeration: parseFloat(ui.exag.value) });
  // Return above whichever town you were last looking up from.
  // (Restore the FOV first: it fires moveend, which would resolve `done` early.)
  map.setVerticalFieldOfView(MAP_FOV);
  const done = moveEnd();
  map.flyTo({ center: stopCoords[active], zoom: ARRIVE_ZOOM, pitch: pitchFor(ARRIVE_ZOOM), bearing: 0, duration: 2600, essential: true });
  done.then(() => { if (!lookMode) map.setMaxPitch(78); });
  wx = '';
  lastElev = null;
  updateWeather();
  updateSkyCard();
}
$('btn-lookup').onclick = () => (lookMode ? exitLook() : enterLook());

// While looking up, a drag turns your head instead of panning the map
{
  let drag = null;
  const el = map.getCanvasContainer();
  const start = (x, y) => { if (lookMode && lookCam) drag = { x, y, b: lookCam.bearing, p: lookCam.pitch }; };
  const move = (x, y) => {
    if (!drag) return;
    lookCam.bearing = drag.b - (x - drag.x) * 0.15;
    lookCam.pitch = clamp(drag.p + (y - drag.y) * 0.12, 60, 150);
    map.jumpTo(lookOptions());
  };
  el.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => (drag = null));
  el.addEventListener('touchstart', (e) => start(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  el.addEventListener('touchmove', (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  el.addEventListener('touchend', () => (drag = null));
}

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
const pitchFor = (zoom) => lerp(35, 58, clamp((zoom - 5) / 4, 0, 1));
// Keep the map roughly north-up; sway gently toward the direction of travel.
const swayBearing = (b) => clamp((((b + 180) % 360) - 180) * 0.3, -25, 25);

function shortestAngle(from, to) {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

// ---------- Continuous playback engine ----------
// One rAF loop drives the whole journey. The traveler moves at a constant
// *screen* speed (so zooming out on long legs covers ground faster), eases into
// and out of each tirth, and zoom/bearing follow critically damped springs, so
// nothing changes velocity abruptly, including across stop boundaries.

const SCREEN_PX_PER_S = 170;       // traveler speed on screen at 1x
const DWELL_S = 1.2;               // pause at each tirth at 1x

// Exact critically damped spring step
function spring(x, v, target, omega, dt) {
  const d = x - target, e = Math.exp(-omega * dt);
  return [target + (d + (v + omega * d) * dt) * e, (v - omega * (v + omega * d) * dt) * e];
}
const pxPerKm = (zoom, lat) => (512 * 2 ** zoom) / (40075 * Math.cos(toRad(lat)));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

const engine = { v: 0, z: 0, zv: 0, b: 0, bv: 0, dwell: 0, last: 0 };

// Camera zoom we want at this point: pulled back to frame long legs while
// cruising, settling to ARRIVE_ZOOM near each tirth.
function targetZoom(i, f) {
  const L = legKm[i];
  const cruise = Math.min(ARRIVE_ZOOM, legZoom(L * 0.55));
  const near = Math.min(f * L, (1 - f) * L);
  return lerp(ARRIVE_ZOOM, cruise, smoothstep(0, clamp(L * 0.3, 2, 140), near));
}

function tick(now) {
  if (!playing) return;
  const dt = Math.min(0.05, (now - engine.last) / 1000);
  engine.last = now;
  const sp = speedVal;
  const follow = ui.follow.checked;

  const i = Math.min(Math.floor(progress + 1e-9), LAST - 1);
  const f = legDistFrac(i, progress - i);
  const [, lat] = pointAt(progress);

  // Zoom spring (also used for pacing when the camera isn't following)
  if (follow) {
    [engine.z, engine.zv] = spring(engine.z, engine.zv, targetZoom(i, f), 1.5 * Math.sqrt(sp), dt);
  } else {
    engine.z = map.getZoom();
  }

  // Ground speed from constant screen speed, slowing over the last ~110 px before a stop
  let vTarget = 0;
  if (engine.dwell > 0) {
    engine.dwell -= dt;
  } else {
    const k = pxPerKm(engine.z, lat);
    const pxLeft = (1 - f) * legKm[i] * k;
    vTarget = ((SCREEN_PX_PER_S * sp) / k) * clamp(pxLeft / 110, 0.06, 1);
  }
  [engine.v] = spring(engine.v, 0, vTarget, 4 * Math.sqrt(sp), dt);

  // Advance along the leg
  let p = progress;
  if (engine.v > 1e-6 && engine.dwell <= 0) {
    const f2 = f + (engine.v * dt) / legKm[i];
    if (f2 >= 1) {
      p = i + 1;
      engine.v = 0;
      engine.dwell = p >= LAST ? 0 : DWELL_S / sp;
      setActive(p);
    } else {
      p = i + legTAt(i, f2);
    }
  }
  setProgress(p);

  if (follow) {
    const legB = swayBearing(bearing(stopCoords[i], stopCoords[i + 1]));
    const drift = engine.dwell > 0 ? 2.5 * dt : 0;          // slow orbit while dwelling
    engine.b += drift;
    [engine.b, engine.bv] = spring(engine.b, engine.bv, shortestAngle(engine.b, legB), 0.9, dt);
    map.jumpTo({ center: pointAt(p), zoom: engine.z, bearing: engine.b, pitch: pitchFor(engine.z) });
  }
  // Render now, in the same frame as the DOM markers moved, instead of next frame
  map.redraw();

  if (p >= LAST) { setPlaying(false); return; }
  raf = requestAnimationFrame(tick);
}

const moveEnd = () => new Promise((r) => map.once('moveend', r));

async function play() {
  if (progress >= LAST) { jumpTo(0, { fly: false }); await sleep(300); }
  setPlaying(true);
  const c = map.project(pointAt(progress));
  const { width, height } = container.getBoundingClientRect();
  const offCentre = Math.hypot(c.x - width / 2, c.y - height / 2) > 40;
  if (ui.follow.checked && (offCentre || Math.abs(map.getZoom() - ARRIVE_ZOOM) > 0.4)) {
    const done = moveEnd();
    map.flyTo({ center: pointAt(progress), zoom: ARRIVE_ZOOM, pitch: pitchFor(ARRIVE_ZOOM), bearing: 0, duration: 2600 / speedVal, essential: true });
    await done;
    if (!playing) return;
  }
  Object.assign(engine, { v: 0, z: map.getZoom(), zv: 0, b: map.getBearing(), bv: 0, dwell: 0.25, last: performance.now() });
  raf = requestAnimationFrame(tick);
}

function jumpTo(i, { fly = true } = {}) {
  setPlaying(false);
  i = clamp(i, 0, LAST);
  setProgress(i);
  setActive(i);
  setPlaying(false);
  if (lookMode) {            // stay under the stars, just walk to the new town
    standAt(i, lookCam ? lookCam.bearing : map.getBearing(), 4000, true);
    return;
  }
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
ui.play.onclick = () => {
  if (lookMode) return exitLook();
  playing ? setPlaying(false) : play();
};
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
// ---------- Walking-view stop labels ----------
// Names beside the numbered discs, placed right or left of the disc, or hidden
// when they would collide. Current and next stop get first claim on space.
const FAR_Z = 6.2;
const slabels = stopMarkers.map((m) => m.getElement().querySelector('.slabel'));
const slabelState = STOPS.map(() => '');      // '', 'r' or 'l'
let labelW = STOPS.map((s) => s.name.length * 7);
let nextIdx = -1;

document.fonts.ready.then(() => {
  const g = document.createElement('canvas').getContext('2d');
  g.font = '400 15px "Instrument Serif"';
  labelW = STOPS.map((s) => Math.ceil(g.measureText(s.name).width) + 2);
  layoutLabels();
});

function updateNextLabel() {
  const n = progress >= LAST ? -1 : Math.floor(progress + 1e-6) + 1;
  if (n !== nextIdx) {
    if (nextIdx >= 0) { slabels[nextIdx].classList.remove('next'); slabels[nextIdx].lastChild.textContent = ''; }
    nextIdx = n;
    if (n >= 0) slabels[n].classList.add('next');
    lastLayout = 0;   // label heights changed
  }
  if (n >= 0) slabels[n].lastChild.textContent = `Next · ${fmtKm(Math.max(0, cumKm[n] - kmAt(progress)))}`;
}

let lastLayout = 0;
let mapW = 0, mapH = 0;
new ResizeObserver(() => { ({ width: mapW, height: mapH } = container.getBoundingClientRect()); }).observe(container);

function layoutLabels() {
  lastLayout = performance.now();
  if (map.getZoom() < FAR_Z) return;
  const ms = parseFloat(container.style.getPropertyValue('--ms')) || 18;
  const pts = stopCoords.map((c) => map.project(c));
  const onScreen = (p) => p.x > -60 && p.x < mapW + 60 && p.y > -30 && p.y < mapH + 30;
  // Discs are obstacles too, so a name never sits on top of another stop
  const boxes = [];
  pts.forEach((p, i) => {
    if (!onScreen(p)) return;
    const r = (i === active ? ms * 0.7 : ms / 2) + 1;
    boxes.push([p.x - r, p.y - r, p.x + r, p.y + r, i]);
  });
  const hits = (b, self) => boxes.some((o) => o[4] !== self && b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);

  const order = STOPS.map((_, i) => i).sort((a, b) => {
    const pri = (i) => (i === active ? -2 : i === nextIdx ? -1 : Math.abs(i - progress));
    return pri(a) - pri(b);
  });
  for (const i of order) {
    let want = '';
    const p = pts[i];
    if (onScreen(p)) {
      const gap = (i === active ? ms * 0.7 : ms / 2) + 7;
      const w = labelW[i], h = i === nextIdx ? 30 : 17;
      const right = [p.x + gap, p.y - h / 2, p.x + gap + w, p.y + h / 2, -1];
      const left = [p.x - gap - w, p.y - h / 2, p.x - gap, p.y + h / 2, -1];
      if (!hits(right, i)) { want = 'r'; boxes.push(right); }
      else if (!hits(left, i)) { want = 'l'; boxes.push(left); }
    }
    if (want !== slabelState[i]) {
      slabelState[i] = want;
      slabels[i].classList.toggle('on', want !== '');
      slabels[i].classList.toggle('l', want === 'l');
    }
  }
}
map.on('move', () => { if (performance.now() - lastLayout > 120) layoutLabels(); });
map.on('moveend', layoutLabels);

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
