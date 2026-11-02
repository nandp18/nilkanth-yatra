import { STOPS, CITIES, COUNTRIES, REGIONS } from './stops.js';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SEG = 24;            // interpolated points per leg
const LAST = STOPS.length - 1;

// ---------- Geometry ----------
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

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
function pathUpTo(progress) {
  const f = clamp(progress, 0, LAST) * SEG;
  return [...path.slice(0, Math.floor(f) + 1), pointAt(progress)];
}
const kmAt = (p) => {
  const i = Math.min(Math.floor(p), LAST - 1);
  return cumKm[i] + legKm[i] * (clamp(p, 0, LAST) - i);
};

// ---------- Map ----------
const demSource = new mlcontour.DemSource({ url: DEM_URL, encoding: 'terrarium', maxzoom: 12, worker: true });
demSource.setupMaplibre(maplibregl);

const map = new maplibregl.Map({
  container: 'map',
  center: [82.5, 21.5],
  zoom: 4.2,
  pitch: 0,
  maxPitch: 78,
  hash: false,
  style: {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      satellite: { type: 'raster', tiles: [SAT_URL], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      terrain: { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 13, attribution: 'Elevation © Mapzen / AWS Terrain Tiles' },
      hillshadeDem: { type: 'raster-dem', tiles: [DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 12 },
      contours: {
        type: 'vector',
        tiles: [demSource.contourProtocolUrl({
          multiplier: 1,
          thresholds: { 6: [1000, 3000], 8: [500, 2000], 9: [200, 1000], 10: [100, 500], 11: [50, 250], 12: [20, 100] },
          elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours',
        })],
        maxzoom: 15,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0d3b66' } },
      { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.08 } },
      {
        id: 'hillshade', type: 'hillshade', source: 'hillshadeDem',
        paint: {
          'hillshade-exaggeration': 0.4,
          'hillshade-shadow-color': '#1a1208',
          'hillshade-highlight-color': '#fff6dc',
          'hillshade-accent-color': '#3b2a12',
        },
      },
      {
        id: 'contour-lines', type: 'line', source: 'contours', 'source-layer': 'contours', minzoom: 6,
        paint: {
          'line-color': ['match', ['get', 'level'], 1, 'rgba(255,236,190,0.75)', 'rgba(255,236,190,0.35)'],
          'line-width': ['match', ['get', 'level'], 1, 1.1, 0.5],
        },
      },
      {
        id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', minzoom: 9,
        filter: ['>', ['get', 'level'], 0],
        layout: {
          'symbol-placement': 'line', 'text-size': 10, 'text-font': ['Open Sans Semibold'],
          'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
        },
        paint: { 'text-color': '#fff1cf', 'text-halo-color': 'rgba(35,22,6,0.8)', 'text-halo-width': 1.2 },
      },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const ui = {
  play: $('btn-play'), prev: $('btn-prev'), next: $('btn-next'), overview: $('btn-overview'),
  terrain: $('tg-terrain'), contours: $('tg-contours'), follow: $('tg-follow'),
  exag: $('rg-exag'), speed: $('sel-speed'), list: $('stop-list'), scrub: $('scrub'),
  card: $('card'), ticks: $('ticks'),
};
$('stat-km').textContent = `${Math.round(totalKm).toLocaleString()} km`;
ui.scrub.max = LAST;

// Sidebar list grouped by region
const listItems = [];
let lastRegion = null;
STOPS.forEach((s, i) => {
  if (s.region !== lastRegion) {
    const h = document.createElement('li');
    h.className = 'region-head';
    h.textContent = REGIONS[s.region];
    ui.list.appendChild(h);
    lastRegion = s.region;
  }
  const li = document.createElement('li');
  li.className = 'stop';
  li.innerHTML = `<span class="n">${s.n}</span><span class="t">${s.name}${s.alt ? `<small>${s.alt}</small>` : ''}</span>`;
  li.onclick = () => jumpTo(i);
  ui.list.appendChild(li);
  listItems.push(li);
});

// Timeline ticks at each stop, major at region changes
STOPS.forEach((s, i) => {
  const t = document.createElement('i');
  if (i === 0 || STOPS[i - 1].region !== s.region) t.className = 'major';
  t.style.left = `${(i / LAST) * 100}%`;
  ui.ticks.appendChild(t);
});

// Markers
const stopMarkers = STOPS.map((s, i) => {
  const el = document.createElement('div');
  el.className = 'stop-marker';
  el.textContent = s.n;
  el.title = s.name;
  el.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(i); });
  return new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
});
CITIES.forEach((c) => {
  const el = document.createElement('div');
  el.className = 'city-tag';
  el.innerHTML = `<span>${c.name}</span>`;
  new maplibregl.Marker({ element: el, anchor: 'left', offset: [4, 0] }).setLngLat([c.lon, c.lat]).addTo(map);
});
COUNTRIES.forEach((c) => {
  const el = document.createElement('div');
  el.className = `country-label ${c.size || ''}`;
  el.textContent = c.name;
  new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map);
});
const travelerEl = document.createElement('div');
travelerEl.className = 'traveler';
const traveler = new maplibregl.Marker({ element: travelerEl }).setLngLat(stopCoords[0]).addTo(map);

// ---------- State ----------
let progress = 0;          // continuous position along journey, in legs
let active = 0;            // index of stop whose card is shown
let playing = false;
let raf = null;

function setProgress(p) {
  progress = clamp(p, 0, LAST);
  const src = map.getSource('route-done');
  if (src) src.setData(line(pathUpTo(progress)));
  traveler.setLngLat(pointAt(progress));
  ui.scrub.value = progress;
  const reached = Math.floor(progress + 1e-6);
  stopMarkers.forEach((m, i) => m.getElement().classList.toggle('visited', i <= reached));
  listItems.forEach((li, i) => li.classList.toggle('visited', i <= reached));
}

function setActive(i) {
  active = i;
  stopMarkers.forEach((m, j) => m.getElement().classList.toggle('active', j === i));
  listItems.forEach((li, j) => li.classList.toggle('active', j === i));
  listItems[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const s = STOPS[i];
  $('card-num').textContent = s.n;
  $('card-region').textContent = REGIONS[s.region];
  $('card-name').textContent = s.name;
  $('card-alt').textContent = s.alt || '';
  $('card-note').textContent = s.note || '';
  const leg = i > 0 ? `${Math.round(legKm[i - 1]).toLocaleString()} km from ${STOPS[i - 1].name} · ` : '';
  $('card-meta').textContent = `${leg}${Math.round(cumKm[i]).toLocaleString()} km into the journey${s.approx ? ' · location approximate' : ''}`;
  ui.card.classList.remove('hidden');
}

const line = (coords) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords } });

// ---------- Playback ----------
function setPlaying(on) {
  playing = on;
  ui.play.classList.toggle('playing', on);
  ui.play.textContent = on ? '❚❚ Pause' : progress >= LAST ? '↺ Walk it again' : progress > 0 ? '▶ Continue' : '▶ Begin the journey';
  if (!on && raf) { cancelAnimationFrame(raf); raf = null; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const speed = () => parseFloat(ui.speed.value);
const legZoom = (km) => clamp(10.2 - Math.log2(Math.max(km, 5) / 8), 5.2, 10.5);

function shortestAngle(from, to) {
  return from + ((((to - from) % 360) + 540) % 360) - 180;
}

// Walk from current progress to the next whole stop, with the camera riding along.
function walkLeg() {
  return new Promise((resolve) => {
    const i = Math.floor(progress + 1e-6);
    if (i >= LAST) return resolve();
    const start = progress, end = i + 1;
    const km = legKm[i] * (end - start);
    const dur = clamp(1600 + km * 5, 1800, 7000) / speed();
    const z0 = map.getZoom(), zEnd = legZoom(legKm[Math.min(i + 1, LAST - 1)]);
    const hump = clamp(Math.log2(Math.max(km, 1) / 60), 0, 3);
    const b0 = map.getBearing();
    const b1 = shortestAngle(b0, bearing(stopCoords[i], stopCoords[i + 1]));
    const t0 = performance.now();

    const frame = (now) => {
      if (!playing) return resolve();
      const t = clamp((now - t0) / dur, 0, 1);
      const p = lerp(start, end, ease(t));
      setProgress(p);
      if (ui.follow.checked) {
        const zoom = lerp(z0, zEnd, ease(t)) - hump * Math.sin(Math.PI * t);
        map.jumpTo({
          center: pointAt(p),
          zoom,
          bearing: lerp(b0, b1, ease(clamp(t * 1.6, 0, 1))),
          pitch: 62,
        });
      }
      if (t < 1) raf = requestAnimationFrame(frame);
      else resolve();
    };
    raf = requestAnimationFrame(frame);
  });
}

async function play() {
  if (progress >= LAST) { jumpTo(0, { fly: false }); await sleep(300); }
  setPlaying(true);
  if (ui.follow.checked && Math.abs(map.getPitch() - 62) > 5) {
    const i = Math.floor(progress + 1e-6);
    map.flyTo({ center: pointAt(progress), zoom: legZoom(legKm[Math.min(i, LAST - 1)]), pitch: 62, duration: 2200 / speed() });
    await sleep(2300 / speed());
  }
  while (playing && progress < LAST) {
    await walkLeg();
    if (!playing) break;
    setActive(Math.round(progress));
    await sleep(1400 / speed());
  }
  setPlaying(false);
}

function jumpTo(i, { fly = true } = {}) {
  setPlaying(false);
  i = clamp(i, 0, LAST);
  setProgress(i);
  setActive(i);
  if (fly) {
    map.flyTo({ center: stopCoords[i], zoom: 10.5, pitch: 64, bearing: map.getBearing(), duration: 2400, essential: true });
  }
}

function overview() {
  setPlaying(false);
  const b = new maplibregl.LngLatBounds();
  stopCoords.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding: { top: 60, bottom: 110, left: 60, right: 60 }, pitch: 30, bearing: 0, duration: 2200 });
}

// ---------- Wiring ----------
ui.play.onclick = () => (playing ? setPlaying(false) : play());
ui.prev.onclick = () => jumpTo(Math.ceil(progress - 1e-6) - 1);
ui.next.onclick = () => jumpTo(Math.floor(progress + 1e-6) + 1);
ui.overview.onclick = overview;
ui.scrub.oninput = () => {
  setPlaying(false);
  setProgress(parseFloat(ui.scrub.value));
  const nearest = Math.round(progress);
  if (nearest !== active) setActive(nearest);
  map.easeTo({ center: pointAt(progress), duration: 250 });
};
ui.terrain.onchange = () => {
  map.setTerrain(ui.terrain.checked ? { source: 'terrain', exaggeration: parseFloat(ui.exag.value) } : null);
};
ui.exag.oninput = () => {
  if (ui.terrain.checked) map.setTerrain({ source: 'terrain', exaggeration: parseFloat(ui.exag.value) });
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

const container = map.getContainer();
map.on('zoom', () => {
  const z = map.getZoom();
  container.classList.toggle('zoomed-in', z > 6.5);
  container.classList.toggle('zoomed-out', z <= 6.5);
});

map.on('load', () => {
  map.setTerrain({ source: 'terrain', exaggeration: parseFloat(ui.exag.value) });
  if (map.setSky) {
    map.setSky({
      'sky-color': '#7fb4e6', 'horizon-color': '#f3e3c7', 'fog-color': '#e9dcc6',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.25,
    });
  }

  map.addSource('route', { type: 'geojson', data: line(path) });
  map.addSource('route-done', { type: 'geojson', data: line(pathUpTo(0)), lineMetrics: true });

  map.addLayer({ id: 'route-shadow', type: 'line', source: 'route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 4.5, 'line-blur': 1.5 } });
  map.addLayer({ id: 'route-dash', type: 'line', source: 'route',
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 2.2, 'line-dasharray': [1.6, 1.4], 'line-opacity': 0.9 } });
  map.addLayer({ id: 'route-glow', type: 'line', source: 'route-done',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffb347', 'line-width': 12, 'line-blur': 8, 'line-opacity': 0.55 } });
  map.addLayer({ id: 'route-walked', type: 'line', source: 'route-done',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-width': 3.4,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#ffe08a', 0.6, '#ffa62b', 1, '#ff7a00'],
    } });

  setProgress(0);
  setActive(0);
  setPlaying(false);

  // Opening move: tilt down into the subcontinent
  map.easeTo({ pitch: 38, zoom: 4.6, center: [83, 21.5], duration: 3500, essential: true });
});
