// Print edition: a chart of any place, in the same styles as the journey's map.
// Give it a point and a distance across; it engraves the relief from the same elevation
// tiles and traces the coast from them (sea level). Up to 300 km across it adds roads,
// railways, rivers, lakes and towns from OpenStreetMap (js/print-osm.js); wider views, or
// any view when those tiles can't be reached, take rivers, lakes and towns from Natural
// Earth. Everything is fetched on demand. Units match print.js: hundredths of an inch.
import { kit, STYLES, relief, elevationData, elevationSampler, tileCount, due, pause } from './print.js';
import { osmPlan, osmDetail, osmLandmarks, seaPolygons } from './print-osm.js';

const {
  C, RAD, mercY, latOfMerc, f1, esc, clamp, textWidth, FELL_I, FELL_SC, boxHit, ornamentRule, compassRose,
  sheetOpen, sheetClose, useStyle, TITLE_FACES, mapFrame, rel_, paintMotifs, styleNeatline,
} = kit;

// Distance across the sheet, east to west
export const SPANS = {
  10: { km: 10, label: '10 km' }, 25: { km: 25, label: '25 km' }, 100: { km: 100, label: '100 km' }, 300: { km: 300, label: '300 km' },
  1000: { km: 1000, label: '1,000 km' }, 3000: { km: 3000, label: '3,000 km' },
};

const r4 = (v) => Math.round(v * 1e4) / 1e4;

// The frame's geographic extent: `km` wide at the place's latitude, as tall as the sheet needs
export function placeExtent(fmt, lat, lon, km) {
  const F = mapFrame(fmt), aspect = F.h / F.w;
  lat = clamp(lat, -80, 80);
  const dLon = Math.min(150, km / (111.32 * Math.cos(lat * RAD)));
  const hh = (aspect * dLon * RAD) / 2, M = mercY(84.5);
  const mc = clamp(mercY(lat), Math.min(0, -M + hh), Math.max(0, M - hh));
  const lon0 = clamp(lon - dLon / 2, -180, 180 - dLon);
  return { lon0: r4(lon0), lon1: r4(lon0 + dLon), lat0: r4(latOfMerc(mc - hh)), lat1: r4(latOfMerc(mc + hh)) };
}
// A little more than the frame, so the traced coast closes outside it
function padExtent(ext) {
  const dx = (ext.lon1 - ext.lon0) * 0.05, m0 = mercY(ext.lat0), m1 = mercY(ext.lat1), dm = (m1 - m0) * 0.05;
  return { lon0: r4(Math.max(-180, ext.lon0 - dx)), lon1: r4(Math.min(180, ext.lon1 + dx)),
    lat0: r4(Math.max(-85, latOfMerc(m0 - dm))), lat1: r4(Math.min(85, latOfMerc(m1 + dm))) };
}
// Relief detail: about 220 dpi across the frame, within what the tiles hold and memory allows
function placeZoom(fmt, ext, pad) {
  const target = clamp((fmt.w - 2) * 220, 700, 3800);
  let z = clamp(Math.round(Math.log2((target * 360) / (256 * (ext.lon1 - ext.lon0)))), 2, 14);
  while (z > 2 && tileCount(z, pad) > 480) z--;
  return z;
}
// What the caption needs to know about a sheet before it is drawn
export function placeInfo(fmt, place, spanKey) {
  const ext = placeExtent(fmt, place.lat, place.lon, SPANS[spanKey].km), z = placeZoom(fmt, ext, padExtent(ext));
  const F = mapFrame(fmt);
  return { ext, z, dpi: Math.round((256 * 2 ** z * ((ext.lon1 - ext.lon0) / 360)) / (F.w / 100)) };
}

// ---------- Coast traced from the elevation grid ----------
// Marching squares at sea level over block means of the grid, with a ring of sea added all
// round so every outline closes. Rings run with the land on their right, so islands and
// enclosed water wind opposite ways. Returns flat [lon, lat, …] rings like printdata's LAND.
// With `sea` (OpenStreetMap's ocean polygons) the sea is wherever they fall, rasterised onto the
// same grid; without, it is wherever the ground is under a metre.
const coastCache = new WeakMap();
function coastline(data, sea) {
  if (sea) return trace(data, sea);
  if (!coastCache.has(data)) coastCache.set(data, trace(data));
  return coastCache.get(data);
}
async function trace(data, sea) {
  const { elev, W, H, n, x0, y0 } = data;
  const s = Math.max(1, Math.ceil(Math.max(W, H) / 1600));
  const cw = Math.ceil(W / s), ch = Math.ceil(H / s), gw = cw + 2, gh = ch + 2;
  const v = new Float32Array(gw * gh).fill(-1);
  if (sea) {
    const cv = new OffscreenCanvas(cw, ch), g = cv.getContext('2d');
    const X = (lon) => ((((lon + 180) / 360) * n - x0) * 256) / s, Y = (lat) => ((((1 - mercY(lat) / Math.PI) / 2) * n - y0) * 256) / s;
    for (const poly of sea) {
      g.beginPath();
      for (const r of poly) {
        g.moveTo(X(r[0]), Y(r[1]));
        for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1]));
        g.closePath();
      }
      g.fill('evenodd');
    }
    const a = g.getImageData(0, 0, cw, ch).data;              // coverage, anti-aliased, so the line falls between cells
    for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) v[(gy + 1) * gw + gx + 1] = 0.5 - a[(gy * cw + gx) * 4 + 3] / 255;
  } else for (let gy = 0; gy < ch; gy++) {
    for (let gx = 0; gx < cw; gx++) {
      let sum = 0, cnt = 0;
      for (let y = gy * s, y1 = Math.min(H, y + s); y < y1; y++) {
        const o = y * W;
        for (let x = gx * s, x1 = Math.min(W, x + s); x < x1; x++) { const e = elev[o + x]; sum += e > 6 ? 6 : e < -6 ? -6 : e; cnt++; }
      }
      v[(gy + 1) * gw + gx + 1] = sum / cnt - 0.5;          // land is a metre or more above the sea
    }
    if (due()) await pause();
  }
  // each crossing: the edge it enters a cell by → the edge it leaves by
  const next = new Map();
  for (let cy = 0; cy < gh - 1; cy++) {
   if (due()) await pause();
   for (let cx = 0; cx < gw - 1; cx++) {
    const o = cy * gw + cx;
    const idx = (v[o] > 0 ? 8 : 0) | (v[o + 1] > 0 ? 4 : 0) | (v[o + gw + 1] > 0 ? 2 : 0) | (v[o + gw] > 0 ? 1 : 0);
    if (!idx || idx === 15) continue;
    const t = o * 2, l = o * 2 + 1, b = (o + gw) * 2, r = (o + 1) * 2 + 1;
    switch (idx) {
      case 1: next.set(l, b); break; case 2: next.set(b, r); break; case 3: next.set(l, r); break;
      case 4: next.set(r, t); break; case 5: next.set(r, t); next.set(l, b); break; case 6: next.set(b, t); break;
      case 7: next.set(l, t); break; case 8: next.set(t, l); break; case 9: next.set(t, b); break;
      case 10: next.set(t, l); next.set(b, r); break; case 11: next.set(t, r); break; case 12: next.set(r, l); break;
      case 13: next.set(r, b); break; default: next.set(b, l);
    }
   }
  }
  const point = (id) => {
    const o = id >> 1, cx = o % gw, cy = (o / gw) | 0, a = v[o];
    return id & 1 ? [cx, cy + a / (a - v[o + gw])] : [cx + a / (a - v[o + 1]), cy];
  };
  const lonOf = (gx) => ((((gx - 0.5) * s) / 256 + x0) / n) * 360 - 180;
  const latOf = (gy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (((gy - 0.5) * s) / 256 + y0)) / n))) / RAD;
  const rings = [];
  // Enclosed water smaller than this (grid cells²) is a marsh pool or a bad elevation pixel,
  // not a lake: dropping it leaves the land whole. Real lakes come from the map data.
  const minHole = Math.max(6, gw * gh * 2e-5);
  while (next.size) {
    if (due()) await pause();
    const start = next.keys().next().value, pts = [];
    let e = start;
    do { pts.push(point(e)); const to = next.get(e); next.delete(e); e = to; } while (e !== undefined && e !== start);
    if (pts.length < 4) continue;
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity, area = 0;
    for (let i = 0, [px0, py0] = pts[pts.length - 1]; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y;
      area += px0 * y - x * py0; [px0, py0] = [x, y];
    }
    if (bx - ax < 1.2 && by - ay < 1.2) continue;          // specks
    if (area < 0 && -area / 2 < minHole) continue;          // land is on the right, so enclosed water winds negative
    const mid = pts.length >> 1;
    const simple = [...simplify(pts.slice(0, mid + 1), 0.3), ...simplify(pts.slice(mid), 0.3).slice(1)];
    const flat = [];
    for (const [x, y] of simple) flat.push(lonOf(x), latOf(y));
    rings.push(flat);
  }
  return rings;
}
function simplify(pts, tol) {          // Douglas–Peucker
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let dmax = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = L < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- Rivers, lakes and towns: Natural Earth, fetched when first needed ----------
const NE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/';
const neCache = {};
const ne = (file) => (neCache[file] ||= fetch(`${NE}${file}.geojson`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
  .then((j) => { if (!j) delete neCache[file]; return j; }));        // a failed fetch is tried again next time
const lineParts = (g) => (!g ? [] : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const polyParts = (g) => (!g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);

const NONE = { streams: [], water: [], roads: {}, rail: [], parks: [], bounds: [], named: new Map(), osm: false };
async function vectors(ext, pad, wantTowns, wantMarks) {
  const dLon = ext.lon1 - ext.lon0;
  const km = dLon * 111.32 * Math.cos(((ext.lat0 + ext.lat1) / 2) * RAD), plan = osmPlan(km);
  if (plan) {
    // the gazetteer's quarters and landmarks: a sheet without them is still a good map
    const marks = wantMarks ? osmLandmarks(ext, pad, km).catch((err) => { console.warn('Landmarks unavailable', err); return null; }) : null;
    try {
      const o = await osmDetail(ext, pad, km, plan), lm = await marks;
      const places = o.places;
      return { osm: true, rivers: [...(o.waterways.river || []), ...(o.waterways.canal || [])], streams: o.waterways.stream || [],
        lakes: [], water: o.water, roads: o.roads, rail: o.rail, towns: wantTowns ? places.slice(0, 120) : [],
        parks: o.parks, bounds: o.bounds, named: o.named, districts: lm?.districts || [], landmarks: lm?.landmarks || [], grounds: lm?.grounds || [], streets: lm?.streets || [] };
    } catch (err) { console.warn('OpenStreetMap detail unavailable; drawing from Natural Earth', err); }
  }
  return { ...NONE, ...(await naturalEarth(ext, pad, wantTowns)) };
}
async function naturalEarth(ext, pad, wantTowns) {
  const dLon = ext.lon1 - ext.lon0;
  // Natural Earth is drawn for small scales: below about 80 km across its rivers would wander off the valleys
  const res = dLon >= 6 ? '50m' : dLon >= 0.8 ? '10m' : null;
  const [riv, lak, pop] = await Promise.all([
    res ? ne(`ne_${res}_rivers_lake_centerlines`) : null, res ? ne(`ne_${res}_lakes`) : null,
    wantTowns ? ne(`ne_${dLon >= 12 ? '50m' : '10m'}_populated_places_simple`) : null,
  ]);
  const inPad = ([x, y]) => x >= pad.lon0 && x <= pad.lon1 && y >= pad.lat0 && y <= pad.lat1;
  const rivers = [], lakes = [], towns = [];
  for (const f of riv?.features || []) for (const ln of lineParts(f.geometry)) {
    let run = null;                                        // keep the stretches in view, and one point beyond each end
    for (let i = 0; i < ln.length; i++) {
      if (inPad(ln[i]) || (i && inPad(ln[i - 1])) || (i < ln.length - 1 && inPad(ln[i + 1]))) (run ||= []).push(ln[i][0], ln[i][1]);
      else if (run) { if (run.length > 2) rivers.push(run); run = null; }
    }
    if (run && run.length > 2) rivers.push(run);
  }
  for (const f of lak?.features || []) for (const poly of polyParts(f.geometry)) {
    let ax = 180, bx = -180, ay = 90, by = -90;
    for (const [x, y] of poly[0]) { if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
    if (bx < pad.lon0 || ax > pad.lon1 || by < pad.lat0 || ay > pad.lat1) continue;
    lakes.push(poly.map((ring) => ring.flatMap(([x, y]) => [x, clamp(y, -85, 85)])));
  }
  for (const f of pop?.features || []) {
    const [lon, lat] = f.geometry?.coordinates || [], p = f.properties || {};
    if (!(lon > ext.lon0 && lon < ext.lon1 && lat > ext.lat0 && lat < ext.lat1) || !p.name) continue;
    towns.push({ name: p.name, lon, lat, rank: p.scalerank ?? 9, pop: p.pop_max || 0 });
  }
  towns.sort((a, b) => a.rank - b.rank || b.pop - a.pop);
  return { rivers, lakes, towns: towns.slice(0, 60) };
}

// ---------- Draw ----------
// place: { lat, lon, title, sub }; opts: { span (a SPANS key), towns, progress, alive }
export async function drawPlace(fmt, faceKey, styleKey, place, { span = 300, towns = true, extras = {}, box = 'auto', progress, alive = () => true } = {}) {
  const ext = placeExtent(fmt, place.lat, place.lon, SPANS[span].km), pad = padExtent(ext), z = placeZoom(fmt, ext, pad);
  const X = cityExtras(styleKey, extras);
  const vec = vectors(ext, pad, towns, X.landmarks || X.wards || X.streets);                  // alongside the tiles
  vec.catch(() => {});                                     // handled where it's awaited
  const sea = seaPolygons(pad, SPANS[span].km).catch((err) => { console.warn('OpenStreetMap coastline unavailable; tracing it from elevation', err); return null; });
  const engraving = progress?.('Engraving relief');
  const data = await elevationData(z, pad, (p) => engraving?.(0.85 * p));
  if (!alive()) return null;
  // the period city plans are flat tints: true-scale relief, so only steep ground takes a shadow
  const opts = { zf: STYLES[styleKey]?.fx.period ? 1 : exaggeration(data, z), motifStep: r4((ext.lon1 - ext.lon0) / 72), world: true };
  const rel = await relief(z, pad, styleKey, engraving, opts);
  if (!alive()) return null;
  progress?.('Tracing the coast')(0.5);
  await new Promise((r) => setTimeout(r));
  const sample = elevationSampler(data);
  const land = await coastline(data, await sea);
  progress?.('Gathering map detail')(0.9);
  const geo = { land, landAt: (lon, lat) => sample(lon, lat) > 0.5, ...(await vec) };
  await document.fonts.ready;
  if (!alive()) return null;
  return buildPlace(fmt, faceKey, styleKey, rel, ext, place, geo, X, box);
}

// Vertical exaggeration of the hillshade. Steep country keeps the usual setting for its zoom;
// gentle country (a coastal plain, the prairie) is lifted until its valleys and ridges read,
// judged by the slope that a quarter of the land exceeds, up to 6×.
function exaggeration({ elev, W, H, n, y0 }, z) {
  const base = clamp(3.1 * 0.8 ** (z - 7), 1, 3.1), step = Math.max(2, Math.round(Math.sqrt((W * H) / 60000))), g = [];
  for (let j = 1; j < H - 1; j += step) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + j / 256)) / n))) / RAD, cell = (40075016 * Math.cos(lat * RAD)) / (256 * n);
    for (let i = 1, o = j * W; i < W - 1; i += step) {
      if (elev[o + i] <= 1) continue;                      // the sea and the shore
      g.push(Math.hypot(elev[o + i + 1] - elev[o + i - 1], elev[o + i + W] - elev[o + i - W]) / (2 * cell));
    }
  }
  if (g.length < 100) return +base.toFixed(2);
  g.sort((a, b) => a - b);
  const p75 = g[Math.floor(g.length * 0.75)];
  return +clamp(p75 > 0 ? 0.2 / p75 : 6, base, 6).toFixed(2);
}

const dm = (v, pos, neg) => {
  const a = Math.abs(v), m = Math.round(a * 60);
  return `${Math.floor(m / 60)}° ${String(m % 60).padStart(2, '0')}′ ${v < 0 ? neg : pos}`;
};
// Graticule interval: the widest that still puts three or more meridians on the sheet
const GRID = [20, 10, 5, 2, 1, 1 / 2, 1 / 4, 1 / 6, 1 / 12, 1 / 30, 1 / 60];
const degLabel = (v, step, pos, neg) => {
  if (Math.abs(v) < 1e-9) return pos === 'N' ? 'Equator' : '0°';
  const a = Math.abs(v), h = v < 0 ? neg : pos;
  if (step >= 1) return `${Math.round(a)}° ${h}`;
  const m = Math.round(a * 60);
  return `${Math.floor(m / 60)}° ${String(m % 60).padStart(2, '0')}′ ${h}`;
};

// box: where the title box goes, 'auto' or a corner (BOX_CORNERS)
export function buildPlace(fmt, faceKey, styleKey, reliefData, EXT, place, geo, extras = {}, box = 'auto') {
  const X = cityExtras(styleKey, extras);
  const S = useStyle(styleKey), FX = S.fx;
  const W = Math.round(fmt.w * 100), H = Math.round(fmt.h * 100), k = W / 1800, ts = k;
  const fs = (u) => f1(u * ts);
  const face = TITLE_FACES[faceKey];
  const F = mapFrame(fmt), bottom = F.y + F.h, dLon = EXT.lon1 - EXT.lon0;
  const ey1 = mercY(EXT.lat1), ey0 = mercY(EXT.lat0);
  const px = (lon) => F.x + ((lon - EXT.lon0) / dLon) * F.w;
  const py = (lat) => F.y + ((ey1 - mercY(lat)) / (ey1 - ey0)) * F.h;
  const lonAt = (x) => EXT.lon0 + ((x - F.x) / F.w) * dLon;
  const latAt = (y) => latOfMerc(ey1 - ((y - F.y) / F.h) * (ey1 - ey0));
  const latMid = latAt(F.y + F.h / 2);
  const unitsPerKm = F.w / dLon / (111.32 * Math.cos(latMid * RAD));
  const pathOf = (flat, close) => {
    let d = '';
    for (let i = 0; i < flat.length; i += 2) d += `${i ? 'L' : 'M'}${f1(px(flat[i]))},${f1(py(flat[i + 1]))}`;
    return close ? d + 'Z' : d;
  };
  const lines = (list = []) => list.map((r) => pathOf(r, false)).join('');
  const land = geo.land.map((r) => pathOf(r, true)).join('');
  const rivers = lines(geo.rivers), streams = lines(geo.streams);
  const lakes = geo.lakes.map((poly) => poly.map((r) => pathOf(r, true)).join('')).join('');
  // OpenStreetMap water: filled only, since tile edges cut through the polygons
  const water = (geo.water || []).map((poly) => poly.map((r) => pathOf(r, true)).join('')).join('');
  // Roads, finest first, as engraved lines; motorways and trunk roads cased as double lines
  const ROADS = [['minor', 0.45, 0.32], ['tertiary', 0.6, 0.48], ['secondary', 0.8, 0.6], ['primary', 1.15, 0.75]];
  const road = (w, o) => `fill="none" stroke="${C.ink}" stroke-width="${f1(w * k)}" stroke-opacity="${o}" stroke-linejoin="round" stroke-linecap="round"`;
  let roads = ROADS.map(([c, w, o]) => { const d = lines(geo.roads?.[c]); return d ? `<path d="${d}" ${road(w, o)}/>` : ''; }).join('');
  const major = lines(geo.roads?.motorway) + lines(geo.roads?.trunk), rail = lines(geo.rail);
  if (rail) roads += `<use href="#railp" ${road(1.7, 0.85)}/><use href="#railp" fill="none" stroke="${C.paper}" stroke-width="${f1(0.8 * k)}" stroke-dasharray="${f1(6 * k)} ${f1(6 * k)}"/>`;
  if (major) roads += `<use href="#majorp" ${road(2.6, 0.85)}/><use href="#majorp" fill="none" stroke="${C.paper}" stroke-width="${f1(1.2 * k)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const R = 11.5 * ts, mx = px(place.lon), my = py(place.lat);
  // The period city plans (FX.period): green parks, district lines as a tinted ribbon under a
  // dash-dot rule, river names along the stream, an Explanation, and a lettered index border.
  // Gated on the style's own colours: C is shared, and keeps keys from the last style used.
  const P = FX.period, SC = S.C;
  const parks = SC.park ? (geo.parks || []).map((poly) => poly.map((r) => pathOf(r, true)).join('')).join('') : '';
  // the city details take the style's own colours where it has them, else colours drawn from its palette
  if (X.landmarks || X.wards) cityColours(SC);
  const grounds = X.landmarks ? (geo.grounds || []).map((poly) => poly.map((r) => pathOf(r, true)).join('')).join('') : '';
  const marks = X.landmarks ? geo.landmarks || [] : [], quarters = X.landmarks || X.wards ? geo.districts || [] : [];
  // with quarters named in capitals, suburbs leave the dotted towns
  const towns = quarters.length ? geo.towns.filter((t) => t.rank !== 5 && t.rank !== 7) : geo.towns;
  let bounds = '';
  if (SC.bound) for (const [lv, rw, lw] of [[10, 3.5, 0.6], [8, 4.5, 0.7], [7, 4.5, 0.7], [6, 8, 1], [4, 10, 1.2], [2, 12, 1.4]]) {
    if (lv === 10 && !FX.wards) continue;                  // wards and neighbourhoods: the ward map only
    const d = (geo.bounds || []).filter((b) => b.level === lv).map((b) => pathOf(b.line, false)).join('');
    if (d) bounds += boundPaths(d, rw, lw, FX.wards, k);
  }
  const legendRows = !P ? [] : [
    (geo.roads?.minor?.length || geo.roads?.tertiary?.length) && ['street', 'Streets and roads'],
    major && ['major', 'Highways'], rail && ['rail', 'Railroads'],
    parks && ['park', 'Parks and cemeteries'], grounds && ['grounds', 'Colleges, hospitals and schools'],
    marks.some((t) => t.glyph === 'church') && ['church', 'Churches'], marks.some((t) => t.glyph === 'hall' || t.glyph === 'station') && ['hall', 'Public buildings'],
    bounds && ['bound', FX.wards ? 'Ward and district lines' : 'County and township lines'],
  ].filter(Boolean);
  const legendH = legendRows.length ? fs(50) + legendRows.length * fs(28) : 0;

  // --- the layout: cartouche and rose, then the names. Landmarks with no room for a name get a
  // number, listed under References in the cartouche; the cartouche is sized for that list, so
  // the names are set twice: once to count the numbers, once with the room for them.
  const title = (place.title || '').trim() || 'Untitled', sub = (place.sub || '').trim();
  const KEY_MAX = X.landmarks && X.refs ? 24 : 0, keyH = (n) => (n ? fs(46) + Math.ceil(n / 2) * fs(19) : 0);
  const layout = (keyCap) => {
    // --- cartouche: sized to the title, set in the corner with the least land under it; the rose takes another ---
    const titleFont = `${face.weight} $px ${face.family}`, maxW = F.w * 0.66;
    let tSize = fs(100 * face.scale), sSize = fs(25);
    const tw = textWidth(title, titleFont, tSize, face.track * ts), sw = textWidth(sub, FELL_I, sSize);
    const cart = { w: clamp(Math.max(tw + fs(90), sw + fs(80)), fs(560), maxW), h: fs(372) + legendH + keyH(keyCap) };
    if (tw + fs(90) > cart.w) tSize = f1((tSize * (cart.w - fs(90))) / tw);
    if (sw + fs(80) > cart.w) sSize = f1((sSize * (cart.w - fs(80))) / sw);
    const landUnder = (x0, y0, x1, y1) => {
      let c = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) c += geo.landAt(lonAt(x0 + ((i + 0.5) / 6) * (x1 - x0)), latAt(y0 + ((j + 0.5) / 6) * (y1 - y0))) ? 1 : 0;
      return c / 36;
    };
    const m = fs(40), rr = roseR * 1.5;
    const corners = [[F.x + m, bottom - m - cart.h], [F.x + F.w - m - cart.w, bottom - m - cart.h], [F.x + m, F.y + m + fs(30)], [F.x + F.w - m - cart.w, F.y + m + fs(30)]];
    const cScore = corners.map(([x, y], i) => landUnder(x, y, x + cart.w, y + cart.h) + i * 0.02);
    const best = BOX_CORNERS.includes(box) ? BOX_CORNERS.indexOf(box) : cScore.indexOf(Math.min(...cScore));
    [cart.x, cart.y] = corners[best];
    const rc = [[F.x + rr, bottom - rr], [F.x + F.w - rr, bottom - rr], [F.x + rr, F.y + rr * 1.2], [F.x + F.w - rr, F.y + rr * 1.2]];
    const rScore = rc.map(([x, y], i) => (i === best ? Infinity : landUnder(x - roseR, y - roseR * 1.3, x + roseR, y + roseR) + [0.06, 0.04, 0.02, 0][i]));
    const [rcx, rcy] = rc[rScore.indexOf(Math.min(...rScore))];

    const obstacles = [[F.x - 1e4, F.y - 1e4, F.x + F.w + 1e4, F.y + 4], [F.x - 1e4, bottom - 4, F.x + F.w + 1e4, bottom + 1e4],
      [F.x - 1e4, F.y, F.x + 4, bottom], [F.x + F.w - 4, F.y, F.x + F.w + 1e4, bottom],
      [cart.x - 8, cart.y - 8, cart.x + cart.w + 8, cart.y + cart.h + 8], [rcx - roseR, rcy - roseR * 1.3, rcx + roseR, rcy + roseR]];

    // --- names: the place first, then towns by importance, each on whichever side is free ---
    const placed = [];
    let names = '', dots = '';
    // `measure` stands in for text not yet known (a landmark's number) when sizing its box
    const label = (x, y, text, size, cls, gap, avoid = [], measure = text) => {
      const wdt = textWidth(measure, FELL_I, size), hgt = size * 0.92;
      const cand = [
        [x + gap, y - hgt * 0.62, x + gap + wdt, y + hgt * 0.38, 'start', x + gap, y + hgt * 0.3],
        [x - gap - wdt, y - hgt * 0.62, x - gap, y + hgt * 0.38, 'end', x - gap, y + hgt * 0.3],
        [x - wdt / 2, y - gap - hgt, x + wdt / 2, y - gap, 'middle', x, y - gap - hgt * 0.15],
        [x - wdt / 2, y + gap, x + wdt / 2, y + gap + hgt, 'middle', x, y + gap + hgt * 0.8],
      ];
      for (const b of cand) {
        const box = b.slice(0, 4);
        if (obstacles.some((o) => boxHit(box, o)) || placed.some((o) => boxHit(box, o)) || avoid.some((o) => boxHit(box, o))) continue;
        placed.push(box);
        names += `<text class="${cls}" x="${f1(b[5])}" y="${f1(b[6])}" text-anchor="${b[4]}" style="font-size:${size}px">${esc(text)}</text>`;
        return true;
      }
      return false;
    };
    const pin = [mx - R - 1, my - R - 1, mx + R + 1, my + R + 1];
    label(mx, my, title, fs(21), 'place', R + fs(5));
    let shown = 0;
    for (const t of towns) {
      if (shown >= 32) break;
      const x = px(t.lon), y = py(t.lat), r = 3.2 * ts;
      if (Math.hypot(x - mx, y - my) < R * 2.6) continue;                           // the place itself, or right beside it
      if (t.name.toLowerCase() === title.toLowerCase() && Math.hypot(x - mx, y - my) < F.w * 0.12) continue;
      const dot = [x - r - 1, y - r - 1, x + r + 1, y + r + 1];
      if (obstacles.some((o) => boxHit(dot, o)) || placed.some((o) => boxHit(dot, o))) continue;
      const big = t.rank <= 2;
      if (!label(x, y, t.name, fs(big ? 18 : 15), big ? 'place' : 'place minor', r + fs(4), [pin])) continue;
      placed.push(dot);
      dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${C.ink}" stroke="${C.paper}" stroke-width="${f1(1.2 * ts)}"/>`;
      shown++;
    }
    // --- the gazetteer: quarters of the city in spaced capitals, then landmarks, each a small drawn mark ---
    let quarterNames = '', markSvg = '';
    const wardSites = [];
    for (const q of quarters) {
      if (wardSites.length >= 36) break;
      const x = px(q.lon), y = py(q.lat), size = fs(q.kind === 1 ? 19 : q.kind === 2 ? 16 : 14), track = size * (q.kind === 1 ? 0.45 : 0.3);
      const text = q.name.toUpperCase(), words = text.split(' ');
      const lines = [[text]];
      if (words.length > 1) { const h = Math.ceil(words.length / 2); lines.push([words.slice(0, h).join(' '), words.slice(h).join(' ')]); }
      for (const ls of lines) {
        const wdt = Math.max(...ls.map((t) => textWidth(t, FELL_SC, size, track))), lh = size * 1.1, hgt = lh * ls.length;
        const box = [x - wdt / 2 - size * 0.5, y - hgt / 2, x + wdt / 2 + size * 0.5, y + hgt / 2];   // a word's space either side
        if (obstacles.some((o) => boxHit(box, o)) || placed.some((o) => boxHit(box, o))) continue;
        placed.push(box);
        quarterNames += ls.map((t, i) => `<text class="district" x="${f1(x + track / 2)}" y="${f1(y - hgt / 2 + lh * (i + 0.78))}" style="font-size:${size}px;letter-spacing:${f1(track)}px">${esc(t)}</text>`).join('');
        wardSites.push({ x, y });
        break;
      }
    }
    let mShown = 0;
    const keyed = [];
    for (const t of marks) {
      if (mShown >= 48 && keyed.length >= keyCap) break;
      const x = px(t.lon), y = py(t.lat), g = 5.5 * ts;
      if (Math.hypot(x - mx, y - my) < R * 2.2) continue;
      const box = [x - g, y - g * 1.4, x + g, y + g * 0.6];
      if (obstacles.some((o) => boxHit(box, o)) || placed.some((o) => boxHit(box, o))) continue;
      if (mShown < 48 && label(x, y - g * 0.3, t.name, fs(12.5), 'mark', g + fs(3), [pin])) mShown++;
      else if (keyed.length < keyCap && label(x, y - g * 0.3, `@@${keyed.length}@@`, fs(12), 'mark num', g + fs(2), [pin], '00')) keyed.push({ name: t.name, x, y });
      else continue;
      placed.push(box);
      markSvg += glyph(t.glyph, x, y, g, k);
    }
    return { cart, tSize, sSize, rcx, rcy, obstacles, placed, names, dots, quarterNames, markSvg, keyed, wardSites };
  };
  const roseR = 92 * ts;
  let lay = layout(KEY_MAX);
  // size the cartouche for the numbers actually used, and set the names again around it
  const used = lay.keyed.length;
  if (used < KEY_MAX) lay = layout(used);
  const { cart, tSize, sSize, rcx, rcy, obstacles, placed, dots, quarterNames, markSvg, keyed, wardSites } = lay;
  // number the landmarks as they read, in bands down the sheet, left to right within each
  const band = fs(160), order = keyed.map((t, i) => i).sort((a, b) => Math.floor(keyed[a].y / band) - Math.floor(keyed[b].y / band) || keyed[a].x - keyed[b].x);
  const num = []; order.forEach((i, n) => { num[i] = n + 1; });
  const names = lay.names.replace(/@@(\d+)@@/g, (_, i) => num[i]);
  const refs = order.map((i) => keyed[i].name);
  const riverNames = P ? nameRivers(geo.named, px, py, fs, F, obstacles, placed) : '';
  const streetNames = X.streets ? nameStreets(geo.streets, px, py, fs, F, obstacles, placed) : '';
  const marker = `<circle cx="${f1(mx)}" cy="${f1(my)}" r="${f1(R)}" fill="${C.red}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/>
    <circle cx="${f1(mx)}" cy="${f1(my)}" r="${f1(R * 0.36)}" fill="${C.key}"/>`;

  // --- scale bar: the longest round length that fits the cartouche ---
  const SK = [2000, 1000, 500, 250, 200, 100, 50, 25, 20, 10, 5, 2, 1].find((v) => v * unitsPerKm <= fs(330)) || 1;
  const bar = SK * unitsPerKm, sx = cart.x + (cart.w - bar) / 2, sy = cart.y + cart.h - fs(86);
  let scale = '';
  for (let i = 0; i < 5; i++) scale += `<rect x="${f1(sx + (i * bar) / 5)}" y="${f1(sy)}" width="${f1(bar / 5)}" height="${f1(7 * ts)}" fill="${i % 2 ? C.key : C.ink}" stroke="${C.ink}" stroke-width="${f1(0.8 * ts)}"/>`;
  scale += [0, SK / 2, SK].map((v) => `<text class="deg" x="${f1(sx + (v / SK) * bar)}" y="${f1(sy - fs(7))}" style="font-size:${fs(15)}px">${v}</text>`).join('');
  scale += `<text class="scale-t" x="${f1(sx + bar / 2)}" y="${f1(sy + fs(30))}" style="font-size:${fs(16)}px">Kilometres${dLon > 8 ? ` (at ${Math.abs(Math.round(latMid))}° ${latMid < 0 ? 'S' : 'N'})` : ''}</text>`;

  // --- graticule and neatline, at an interval that suits the scale ---
  const step = GRID.find((g) => dLon / g >= 3) || GRID[GRID.length - 1], minor = step / 5;
  const span = (a, b, u) => { const out = []; for (let i = Math.ceil(a / u - 1e-9); i * u < b; i++) out.push(i); return out; };
  let grat = '';
  for (const i of span(EXT.lon0, EXT.lon1, step)) grat += `M${f1(px(i * step))},${f1(F.y)}V${f1(bottom)}`;
  for (const i of span(EXT.lat0, EXT.lat1, step)) grat += `M${f1(F.x)},${f1(py(i * step))}H${f1(F.x + F.w)}`;
  let neat = fmt.border === false ? '' : styleNeatline(FX, F, k);     // full bleed: no neatline
  if (neat === null && P) {
    // Index border: lettered columns and numbered rows, about two inches square, as the city
    // plans carried for finding a street from the index
    const t = 9 * k, { x, y, w, h } = F, s = fs(16);
    const cols = Math.min(26, Math.max(4, Math.round(w / 200))), cw = w / cols, rows = Math.max(3, Math.round(h / cw)), ch = h / rows;
    neat = `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.5 * k)}"/>
    <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1 * k)}"/>`;
    let ticks = '';
    for (let i = 1; i < cols; i++) ticks += `M${f1(x + i * cw)},${f1(y - t)}V${f1(y)}M${f1(x + i * cw)},${f1(y + h)}V${f1(y + h + t)}`;
    for (let j = 1; j < rows; j++) ticks += `M${f1(x - t)},${f1(y + j * ch)}H${f1(x)}M${f1(x + w)},${f1(y + j * ch)}H${f1(x + w + t)}`;
    neat += `<path d="${ticks}" stroke="${C.ink}" stroke-width="${f1(0.8 * k)}"/>`;
    for (let i = 0; i < cols; i++) {
      const xx = f1(x + (i + 0.5) * cw), lab = String.fromCharCode(65 + i);
      neat += `<text class="deg" x="${xx}" y="${f1(y - t - s * 0.5)}" style="font-size:${s}px">${lab}</text><text class="deg" x="${xx}" y="${f1(y + h + t + s * 1.15)}" style="font-size:${s}px">${lab}</text>`;
    }
    for (let j = 0; j < rows; j++) {
      const yy = f1(y + (j + 0.5) * ch + s * 0.35);
      neat += `<text class="deg" x="${f1(x - t - s * 0.75)}" y="${yy}" style="font-size:${s}px">${j + 1}</text><text class="deg" x="${f1(x + w + t + s * 0.75)}" y="${yy}" style="font-size:${s}px">${j + 1}</text>`;
    }
  } else if (neat === null) {
    const t = 9 * k, { x, y, w, h } = F, s = fs(15);
    neat = `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.5 * k)}"/>
    <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1 * k)}"/>`;
    for (const i of span(EXT.lon0 - minor, EXT.lon1, minor)) {
      if (i % 2) continue;
      const a = px(Math.max(i * minor, EXT.lon0)), b = px(Math.min((i + 1) * minor, EXT.lon1));
      if (b > a) neat += `<rect x="${f1(a)}" y="${f1(y - t)}" width="${f1(b - a)}" height="${f1(t)}" fill="${C.ink}"/><rect x="${f1(a)}" y="${f1(y + h)}" width="${f1(b - a)}" height="${f1(t)}" fill="${C.ink}"/>`;
    }
    for (const i of span(EXT.lat0 - minor, EXT.lat1, minor)) {
      if (i % 2) continue;
      const a = py(Math.min((i + 1) * minor, EXT.lat1)), b = py(Math.max(i * minor, EXT.lat0));
      if (b > a) neat += `<rect x="${f1(x - t)}" y="${f1(a)}" width="${f1(t)}" height="${f1(b - a)}" fill="${C.ink}"/><rect x="${f1(x + w)}" y="${f1(a)}" width="${f1(t)}" height="${f1(b - a)}" fill="${C.ink}"/>`;
    }
    for (const i of span(EXT.lon0, EXT.lon1, step)) {
      const lab = degLabel(i * step, step, 'E', 'W'), xx = f1(px(i * step));
      neat += `<text class="deg" x="${xx}" y="${f1(y - t - s * 0.55)}" style="font-size:${s}px">${lab}</text><text class="deg" x="${xx}" y="${f1(y + h + t + s * 1.3)}" style="font-size:${s}px">${lab}</text>`;
    }
    for (const i of span(EXT.lat0, EXT.lat1, step)) {
      const lab = degLabel(i * step, step, 'N', 'S'), yy = f1(py(i * step));
      neat += `<text class="deg" transform="translate(${f1(x - t - s * 0.6)},${yy}) rotate(-90)" style="font-size:${s}px">${lab}</text>`;
      neat += `<text class="deg" transform="translate(${f1(x + w + t + s * 1.2)},${yy}) rotate(-90)" style="font-size:${s}px">${lab}</text>`;
    }
  }

  // --- water-lining round the coasts; the land outline is defined once and reused ---
  let waterLines = '';
  for (let i = 8; i >= 1; i--) {
    const wd = i * 7 * k;
    waterLines += `<use href="#landp" fill="none" stroke="${C.water}" stroke-opacity="${((0.16 + 0.1 * (9 - i) / 8) * FX.waterLines).toFixed(3)}" stroke-width="${f1(wd)}" stroke-linejoin="round"/>`;
    waterLines += `<use href="#landp" fill="none" stroke="${C.seaLine}" stroke-width="${f1(wd - 1.7 * k)}" stroke-linejoin="round"/>`;
  }

  const cx = cart.x + cart.w / 2;
  const yT = cart.y + fs(54), yTitle = yT + fs(92 * Math.min(1.08, face.scale)), ySub = yTitle + fs(44), yFacts = ySub + fs(40);
  const cartouche = `<rect x="${f1(cart.x)}" y="${f1(cart.y)}" width="${f1(cart.w)}" height="${f1(cart.h)}" fill="${C.key}" fill-opacity="0.96" stroke="${C.ink}" stroke-width="${f1(1.6 * ts)}"/>
    <rect x="${f1(cart.x + 7 * ts)}" y="${f1(cart.y + 7 * ts)}" width="${f1(cart.w - 14 * ts)}" height="${f1(cart.h - 14 * ts)}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>
    <text class="eyebrow" x="${f1(cx)}" y="${f1(yT)}" style="font-size:${fs(19)}px;letter-spacing:${fs(8)}px">${P || 'A chart of'}</text>
    <text class="title" x="${f1(cx)}" y="${f1(yTitle)}" style="font-size:${tSize}px;letter-spacing:${f1(face.track * ts)}px">${esc(title)}</text>
    <text class="subtitle" x="${f1(cx)}" y="${f1(ySub)}" style="font-size:${sSize}px">${esc(sub)}</text>
    ${ornamentRule(cx, ySub + fs(18), fs(150), ts)}
    <text class="facts" x="${f1(cx)}" y="${f1(yFacts)}" style="font-size:${fs(17)}px;letter-spacing:${fs(4)}px">${dm(place.lat, 'N', 'S')} · ${dm(place.lon, 'E', 'W')}</text>
    ${legendRows.length ? explanation(legendRows, cx, yFacts + fs(48), fs, k, FX.wards) : ''}
    ${refs.length ? references(refs, cart.x + fs(34), cart.w - fs(68), yFacts + fs(48) + legendH, fs) : ''}
    <text class="credit" x="${f1(cx)}" y="${f1(cart.y + cart.h - fs(22))}" text-anchor="middle" style="font-size:${fs(11)}px">${geo.osm
    ? 'Relief: Mapzen · OpenFreeMap © OpenMapTiles · Data © OpenStreetMap contributors'
    : 'Relief: Mapzen Terrain Tiles · Rivers, lakes &amp; towns: Natural Earth'}</text>`;

  const rel = rel_(reliefData, px, py);
  const frameRect = `x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}"`;
  const wardSvg = X.wards ? wardTints(wardSites, C.wards, k) : '';
  const motifSvg = FX.motifs ? paintMotifs(reliefData.motifs || [], px, py, ts, [{ x: mx, y: my }], R, [...obstacles, ...placed], FX.motifs, []) : '';

  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, `<clipPath id="frame"><rect ${frameRect}/></clipPath>
    <path id="landp" d="${land}"/>
    ${major ? `<path id="majorp" d="${major}"/>` : ''}${rail ? `<path id="railp" d="${rail}"/>` : ''}
    <clipPath id="land"><use href="#landp"/></clipPath>`)}

  <g clip-path="url(#frame)">
    <rect ${frameRect} fill="${C.sea}"/>
    ${FX.waves ? `<rect ${frameRect} fill="url(#waves)"/>` : ''}
    ${waterLines}
    <g clip-path="url(#land)">
      <image href="${rel.href}" x="${f1(rel.x)}" y="${f1(rel.y)}" width="${f1(rel.w)}" height="${f1(rel.h)}" preserveAspectRatio="none"/>
      ${FX.wash ? `<rect ${frameRect} filter="url(#pigment)" opacity="0.55"/>
      <use href="#landp" fill="none" stroke="${C.ink3}" stroke-width="${f1(16 * k)}" stroke-opacity="0.32" filter="url(#bleed)"/>` : ''}
    </g>
    <path d="${grat}" fill="none" stroke="${C.ink}" stroke-opacity="${FX.grat}" stroke-width="${f1(0.8 * k)}"/>
    ${wardSvg ? `<g clip-path="url(#land)">${wardSvg}</g>` : ''}
    ${parks ? `<path d="${parks}" fill="${C.park}"/>` : ''}
    ${grounds ? `<path d="${grounds}" fill="${C.grounds}" fill-opacity="${C.groundsOpacity || 1}" stroke="${C.mark}" stroke-opacity="0.55" stroke-width="${f1(0.5 * k)}"/>` : ''}
    ${bounds ? `<g clip-path="url(#land)">${bounds}</g>` : ''}
    ${water ? `<path d="${water}" fill="${C.sea}"/>` : ''}
    ${streams ? `<path d="${streams}" fill="none" stroke="${C.water}" stroke-width="${f1(0.8 * k)}" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
    <path d="${rivers}" fill="none" stroke="${C.water}" stroke-width="${f1(1.5 * k)}" stroke-opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>
    ${lakes ? `<path d="${lakes}" fill="${C.sea}" fill-rule="evenodd" stroke="${C.ink}" stroke-width="${f1(1 * k)}" stroke-linejoin="round"/>` : ''}
    ${roads}
    <use href="#landp" fill="none" stroke="${SC.shore || C.ink}" stroke-width="${f1(1.6 * k)}" stroke-linejoin="round"/>
    ${riverNames}
    ${streetNames}
    ${motifSvg}
    ${quarterNames}
    ${markSvg}
    ${dots}
    ${marker}
    ${names}
    ${compassRose(rcx, rcy, roseR, ts, FX.rose)}
    ${cartouche}
    ${scale}
  </g>
  ${neat}

  ${sheetClose(W, H, FX)}`;
}

// ---------- Period city plans: river names and the Explanation ----------
// River names in spaced capitals along the stream, as the 1890s plans set them. Each river's
// pieces (cut at tile edges) are joined, resampled and smoothed; the name goes on the
// straightest stretch long enough to hold it, nearest the middle, clear of the other names.
function nameRivers(named, px, py, fs, F, obstacles, placed) {
  if (!named?.size) return '';
  const runs = [];
  for (const [name, parts] of named) {
    const pts = parts.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([px(r[i]), py(r[i + 1])]); return out; });
    for (const run of joinRuns(pts, 1.5)) {
      let len = 0;
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      runs.push({ name, run, len });
    }
  }
  runs.sort((a, b) => b.len - a.len);
  const done = new Set();
  let defs = '', text = '', id = 0;
  for (const { name, run, len } of runs) {
    if (done.has(name) || done.size >= 10) continue;
    const label = name.toUpperCase(), big = len > F.w * 0.6, size = fs(big ? 19 : 14), track = size * (big ? 0.6 : 0.35);
    const need = textWidth(label, FELL_I, size, track) * 1.08;
    if (len < need * 1.15) continue;
    const step = size * 0.5, pts = smooth(resample(run, step), 4), n = Math.ceil(need / step);
    const inside = ([x, y]) => x > F.x + size && x < F.x + F.w - size && y > F.y + size && y < F.y + F.h - size;
    const hit = ([x, y]) => { const b = [x - size * 0.6, y - size * 0.6, x + size * 0.6, y + size * 0.6]; return obstacles.some((o) => boxHit(b, o)) || placed.some((o) => boxHit(b, o)); };
    let best = null;
    for (let i = 0; i + n < pts.length; i += 2) {
      const win = pts.slice(i, i + n + 1), a = win[0], b = win[n];
      const straight = Math.hypot(b[0] - a[0], b[1] - a[1]) / (n * step);
      if (straight < 0.86 || !win.every(inside) || win.some(hit)) continue;
      const score = straight - 0.4 * Math.abs((i + n / 2) / pts.length - 0.5);
      if (!best || score > best.score) best = { score, win };
    }
    if (!best) continue;
    let win = best.win;
    if (win[0][0] > win[win.length - 1][0]) win = win.slice().reverse();      // read left to right
    for (let i = 0; i < win.length; i += 2) placed.push([win[i][0] - size * 0.6, win[i][1] - size * 0.6, win[i][0] + size * 0.6, win[i][1] + size * 0.6]);
    defs += `<path id="river-${id}" d="M${win.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L')}"/>`;
    text += `<text class="sea" dy="${f1(size * 0.34)}" style="font-size:${size}px;letter-spacing:${f1(track)}px;paint-order:stroke;stroke:${C.paper};stroke-opacity:0.55;stroke-width:${fs(3)}px"><textPath href="#river-${id}" startOffset="50%">${esc(label)}</textPath></text>`;
    done.add(name);
    id++;
  }
  return defs ? `<defs>${defs}</defs>${text}` : '';
}
// Join pieces of a line that meet end to end (in either direction) into runs of [x, y] points
function joinRuns(parts, tol) {
  const left = parts.filter((p) => p.length > 1), out = [];
  const near = (u, v) => Math.abs(u[0] - v[0]) < tol && Math.abs(u[1] - v[1]) < tol;
  while (left.length) {
    let run = left.pop(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const q = left[i], a = run[0], b = run[run.length - 1];
        if (near(b, q[0])) run = run.concat(q.slice(1));
        else if (near(b, q[q.length - 1])) run = run.concat(q.slice(0, -1).reverse());
        else if (near(a, q[q.length - 1])) run = q.concat(run.slice(1));
        else if (near(a, q[0])) run = q.slice().reverse().concat(run.slice(1));
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(run);
  }
  return out;
}
// Points every `step` along a polyline
function resample(run, step) {
  const out = [run[0]];
  let carry = 0;
  for (let i = 1; i < run.length; i++) {
    const [x0, y0] = run[i - 1], [x1, y1] = run[i], seg = Math.hypot(x1 - x0, y1 - y0);
    let t = step - carry;
    for (; t <= seg; t += step) out.push([x0 + ((x1 - x0) * t) / seg, y0 + ((y1 - y0) * t) / seg]);
    carry = seg - (t - step);
  }
  return out;
}
// Moving average over ±r points, so a name follows the river's course, not every bend
function smooth(pts, r) {
  return pts.map((_, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(pts.length - 1, i + r); j++) { sx += pts[j][0]; sy += pts[j][1]; c++; }
    return [sx / c, sy / c];
  });
}
// ---------- City details: which are on, and their colours ----------
// Each detail is on unless switched off, except ward colours, which suit the flat-tinted city
// plans: on by default only where a style carries its own wash colours.
export const CITY_KM = 40;
// The title box's corners, in the order buildPlace tries them
export const BOX_CORNERS = ['bl', 'br', 'tl', 'tr'];                                   // wider sheets have none of these details
export function cityExtras(styleKey, extras = {}) {
  const own = !!STYLES[styleKey]?.C.wards, pick = (k, d) => (typeof extras[k] === 'boolean' ? extras[k] : d);
  return { landmarks: pick('landmarks', true), refs: pick('refs', true), streets: pick('streets', true), wards: pick('wards', own) };
}
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mix = (a, b, t) => `#${hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
const WARD_HUES = ['#e9a85f', '#a8c46c', '#e8d36a', '#7fb3c4', '#cf94b8'];
// Fill in the shared palette C for a style with no city colours of its own: landmarks in its
// accent, grounds a pale tint of it, trees green, washes in five hues toned to its paper
function cityColours(SC) {
  const dark = hex(SC.paper).reduce((a, v) => a + v, 0) < 3 * 110;
  C.mark ||= SC.red;
  C.grounds ||= mix(SC.red, SC.paper, dark ? 0.62 : 0.72);
  C.groundsOpacity ||= dark ? 0.45 : 1;              // on a dark sheet a solid fill would glare
  C.tree ||= SC.green || mix('#4d7a3a', SC.paper, dark ? 0.25 : 0.05);
  C.wards ||= WARD_HUES.map((h) => mix(h, SC.paper, dark ? 0.3 : 0.1));
}
// Street names in small italics along the avenues and main streets: each on the straightest
// stretch of its longest run that holds the name, clear of everything already named
function nameStreets(streets, px, py, fs, F, obstacles, placed) {
  if (!streets?.length) return '';
  const runs = [];
  for (const st of streets) {
    const pts = st.parts.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([px(r[i]), py(r[i + 1])]); return out; });
    for (const run of joinRuns(pts, 1.5)) {
      let len = 0;
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
      runs.push({ name: st.name, rank: st.rank, run, len });
    }
  }
  runs.sort((a, b) => a.rank - b.rank || b.len - a.len);
  const done = new Set();
  let defs = '', text = '', id = 0;
  for (const { name, rank, run, len } of runs) {
    if (done.has(name) || done.size >= 28) continue;
    const size = fs(rank === 1 ? 12 : 11), need = textWidth(name, FELL_I, size) * 1.06;
    if (len < need * 1.2) continue;
    const step = size * 0.5, pts = smooth(resample(run, step), 2), n = Math.ceil(need / step);
    const pad = size * 0.55;
    const inside = ([x, y]) => x > F.x + size && x < F.x + F.w - size && y > F.y + size && y < F.y + F.h - size;
    const hit = ([x, y]) => { const b = [x - pad, y - pad, x + pad, y + pad]; return obstacles.some((o) => boxHit(b, o)) || placed.some((o) => boxHit(b, o)); };
    let best = null;
    for (let i = 0; i + n < pts.length; i += 2) {
      const win = pts.slice(i, i + n + 1), a = win[0], b = win[n];
      const straight = Math.hypot(b[0] - a[0], b[1] - a[1]) / (n * step);
      if (straight < 0.95 || !win.every(inside) || win.some(hit)) continue;
      const score = straight - 0.5 * Math.abs((i + n / 2) / pts.length - 0.5);
      if (!best || score > best.score) best = { score, win };
    }
    if (!best) continue;
    let win = best.win;
    const [a, b] = [win[0], win[win.length - 1]];
    // read left to right; a street running up the sheet reads from the bottom
    if (Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) * 0.25 ? a[0] > b[0] : a[1] < b[1]) win = win.slice().reverse();
    for (let i = 0; i < win.length; i += 2) placed.push([win[i][0] - pad, win[i][1] - pad, win[i][0] + pad, win[i][1] + pad]);
    defs += `<path id="street-${id}" d="M${win.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L')}"/>`;
    text += `<text class="street" dy="${f1(size * 0.34)}" style="font-size:${size}px"><textPath href="#street-${id}" startOffset="50%">${esc(name)}</textPath></text>`;
    done.add(name);
    id++;
  }
  return defs ? `<defs>${defs}</defs>${text}` : '';
}
// References: the numbered landmarks, in two columns down the cartouche
function references(list, x0, w, y, fs) {
  const rows = Math.ceil(list.length / 2), colW = w / 2, numW = fs(26);
  const room = colW - numW - fs(14);
  let size = fs(12.5);
  const widest = Math.max(...list.map((t) => textWidth(t, FELL_I, size)));
  if (widest > room) size = f1(Math.max(fs(10), (size * room) / widest));
  const fit = (t) => {
    if (textWidth(t, FELL_I, size) <= room) return t;
    while (t.length > 4 && textWidth(`${t}…`, FELL_I, size) > room) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  };
  let g = `<text class="eyebrow" x="${f1(x0 + w / 2)}" y="${f1(y)}" style="font-size:${fs(15)}px;letter-spacing:${fs(5)}px">References</text>`;
  list.forEach((t, i) => {
    const col = Math.floor(i / rows), row = i % rows, x = x0 + col * colW, yy = y + fs(28) + row * fs(19);
    g += `<text class="legend" x="${f1(x + numW)}" y="${f1(yy)}" text-anchor="end" style="font-size:${size}px;font-style:normal">${i + 1}</text>`;
    g += `<text class="legend" x="${f1(x + numW + fs(8))}" y="${f1(yy)}" style="font-size:${size}px">${esc(fit(t))}</text>`;
  });
  return g;
}
// Ward tints, as the old plans washed each quarter in its own colour: a cell round each named
// quarter (nearer it than any other, no farther than its neighbours are apart), a pale wash with
// a deeper band just inside the edge, and no two neighbours alike. The lines are drawn from the
// names, not surveyed boundaries.
function wardTints(sites, colours, k) {
  if (sites.length < 3) return '';
  const nn = sites.map((a) => Math.min(...sites.filter((b) => b !== a).map((b) => Math.hypot(a.x - b.x, a.y - b.y))));
  const reach = nn.slice().sort((a, b) => a - b)[nn.length >> 1] * 1.5;
  const cells = sites.map((a, i) => {
    let poly = [];
    for (let j = 0; j < 36; j++) { const t = (j / 36) * 2 * Math.PI; poly.push([a.x + reach * Math.cos(t), a.y + reach * Math.sin(t)]); }
    const nb = new Set();
    sites.forEach((b, j) => {
      if (j === i || Math.hypot(a.x - b.x, a.y - b.y) > 2 * reach) return;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, nx = b.x - a.x, ny = b.y - a.y;
      const out = [];
      let cut = false;
      for (let q = 0; q < poly.length; q++) {
        const p = poly[q], r = poly[(q + 1) % poly.length];
        const fp = (p[0] - mx) * nx + (p[1] - my) * ny, fr = (r[0] - mx) * nx + (r[1] - my) * ny;
        if (fp <= 0) out.push(p); else cut = true;
        if ((fp <= 0) !== (fr <= 0)) { const t = fp / (fp - fr); out.push([p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t]); }
      }
      poly = out;
      if (cut) nb.add(j);
    });
    return { poly, nb };
  });
  cells.forEach((c, i) => c.nb.forEach((j) => cells[j].nb.add(i)));
  // most-crowded first, each the least-used colour its neighbours haven't taken
  const colour = [], uses = colours.map(() => 0);
  for (const i of cells.map((c, i) => i).sort((a, b) => cells[b].nb.size - cells[a].nb.size)) {
    const taken = new Set([...cells[i].nb].map((j) => colour[j]));
    let pick = -1;
    colours.forEach((_, c) => { if (!taken.has(c) && (pick < 0 || uses[c] < uses[pick])) pick = c; });
    if (pick < 0) pick = uses.indexOf(Math.min(...uses));
    colour[i] = pick; uses[pick]++;
  }
  let g = '';
  cells.forEach(({ poly }, i) => {
    if (poly.length < 3) return;
    const d = `M${poly.map(([x, y]) => `${f1(x)},${f1(y)}`).join('L')}Z`, c = colours[colour[i]];
    g += `<clipPath id="ward-${i}"><path d="${d}"/></clipPath><path d="${d}" fill="${c}" fill-opacity="0.26"/>`;
    g += `<path d="${d}" fill="none" stroke="${c}" stroke-opacity="0.8" stroke-width="${f1(12 * k)}" stroke-linejoin="round" clip-path="url(#ward-${i})"/>`;
  });
  return g;
}
// The Explanation: a sample of each symbol on the sheet, with its name
function explanation(rows, cx, y, fs, k, wards) {
  const sw = fs(64), gap = fs(16), size = fs(16);
  const wMax = Math.max(...rows.map(([, t]) => textWidth(t, FELL_I, size)));
  const x0 = cx - (sw + gap + wMax) / 2, x1 = x0 + sw;
  let g = `<text class="eyebrow" x="${f1(cx)}" y="${f1(y)}" style="font-size:${fs(15)}px;letter-spacing:${fs(5)}px">Explanation</text>`;
  rows.forEach(([kind, t], i) => {
    const yy = y + fs(30) + i * fs(28), m = yy - size * 0.32, line = (w, c, extra = '') => `<path d="M${f1(x0)},${f1(m)}H${f1(x1)}" fill="none" stroke="${c}" stroke-width="${f1(w * k)}" ${extra}/>`;
    g += kind === 'street' ? line(0.6, C.ink)
      : kind === 'major' ? line(2.6, C.ink) + line(1.2, C.paper)
      : kind === 'rail' ? line(1.7, C.ink) + line(0.8, C.paper, `stroke-dasharray="${f1(6 * k)} ${f1(6 * k)}"`)
      : kind === 'park' ? `<rect x="${f1(x0)}" y="${f1(m - fs(6))}" width="${f1(sw)}" height="${f1(fs(12))}" fill="${C.park}"/>`
      : kind === 'grounds' ? `<rect x="${f1(x0)}" y="${f1(m - fs(6))}" width="${f1(sw)}" height="${f1(fs(12))}" fill="${C.grounds}" stroke="${C.mark}" stroke-opacity="0.55" stroke-width="${f1(0.5 * k)}"/>`
      : kind === 'church' || kind === 'hall' ? glyph(kind, (x0 + x1) / 2, m + fs(4), fs(7), k)
      : boundPaths(`M${f1(x0)},${f1(m)}H${f1(x1)}`, 8, 1, wards, k);
    g += `<text class="legend" x="${f1(x1 + gap)}" y="${f1(yy)}" style="font-size:${size}px">${t}</text>`;
  });
  return g;
}
// A district line: a tinted ribbon under a dash-dot rule, or for the ward map a bold red line
function boundPaths(d, rw, lw, wards, k) {
  return `<path d="${d}" fill="none" stroke="${C.bound}" stroke-opacity="${wards ? 0.4 : 0.32}" stroke-width="${f1(rw * k)}" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${C.bound}" stroke-width="${f1(lw * (wards ? 1.9 : 1) * k)}" stroke-linejoin="round"${wards ? '' : ` stroke-dasharray="${f1(10 * k)} ${f1(3 * k)} ${f1(2 * k)} ${f1(3 * k)}"`}/>`;
}
// A landmark's mark, sitting on (x, y): a little house in madder, as the old plans drew each
// building; a church carries a cross, a monument is an obelisk, a park a tree
function glyph(kind, x, y, s, k) {
  const st = `stroke="${C.ink}" stroke-width="${f1(0.6 * k)}" stroke-linejoin="round"`;
  if (kind === 'park') return `<path d="M${f1(x)},${f1(y)}V${f1(y - s * 0.7)}" stroke="${C.ink}" stroke-width="${f1(0.8 * k)}"/><circle cx="${f1(x)}" cy="${f1(y - s * 1.05)}" r="${f1(s * 0.5)}" fill="${C.tree}" ${st}/>`;
  if (kind === 'monument') return `<path d="M${f1(x - s * 0.22)},${f1(y)}L${f1(x - s * 0.12)},${f1(y - s * 1.3)}L${f1(x)},${f1(y - s * 1.55)}L${f1(x + s * 0.12)},${f1(y - s * 1.3)}L${f1(x + s * 0.22)},${f1(y)}Z" fill="${C.mark}" ${st}/>`;
  const w = s * 0.62, h = s * 0.55, r = s * 0.5;
  let g = `<path d="M${f1(x - w)},${f1(y)}V${f1(y - h)}L${f1(x)},${f1(y - h - r)}L${f1(x + w)},${f1(y - h)}V${f1(y)}Z" fill="${C.mark}" ${st}/>`;
  if (kind === 'church') g += `<path d="M${f1(x)},${f1(y - h - r)}V${f1(y - h - r - s * 0.6)}M${f1(x - s * 0.2)},${f1(y - h - r - s * 0.42)}H${f1(x + s * 0.2)}" stroke="${C.ink}" stroke-width="${f1(0.7 * k)}"/>`;
  else if (kind === 'station') g += `<path d="M${f1(x - w * 1.5)},${f1(y)}H${f1(x + w * 1.5)}" stroke="${C.ink}" stroke-width="${f1(0.9 * k)}"/>`;
  return g;
}
