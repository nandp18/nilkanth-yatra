// Print edition: a chart of any place, in the same styles as the journey's map.
// Give it a point and a distance across; it engraves the relief from the same elevation
// tiles, traces the coast from them (sea level), and adds rivers, lakes and towns from
// Natural Earth, fetched on demand. Units match print.js: hundredths of an inch.
import { kit, relief, elevationData, elevationSampler, tileCount } from './print.js';

const {
  C, RAD, mercY, latOfMerc, f1, esc, clamp, textWidth, FELL_I, boxHit, ornamentRule, compassRose,
  sheetOpen, sheetClose, useStyle, TITLE_FACES, mapFrame, rel_, paintMotifs, styleNeatline,
} = kit;

// Distance across the sheet, east to west
export const SPANS = {
  25: { km: 25, label: '25 km' }, 100: { km: 100, label: '100 km' }, 300: { km: 300, label: '300 km' },
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
const coastCache = new WeakMap();
function coastline(data) {
  if (coastCache.has(data)) return coastCache.get(data);
  const { elev, W, H, n, x0, y0 } = data;
  const s = Math.max(1, Math.ceil(Math.max(W, H) / 1600));
  const cw = Math.ceil(W / s), ch = Math.ceil(H / s), gw = cw + 2, gh = ch + 2;
  const v = new Float32Array(gw * gh).fill(-1);
  for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
    let sum = 0, cnt = 0;
    for (let y = gy * s, y1 = Math.min(H, y + s); y < y1; y++) {
      const o = y * W;
      for (let x = gx * s, x1 = Math.min(W, x + s); x < x1; x++) { const e = elev[o + x]; sum += e > 6 ? 6 : e < -6 ? -6 : e; cnt++; }
    }
    v[(gy + 1) * gw + gx + 1] = sum / cnt - 0.5;          // land is a metre or more above the sea
  }
  // each crossing: the edge it enters a cell by → the edge it leaves by
  const next = new Map();
  for (let cy = 0; cy < gh - 1; cy++) for (let cx = 0; cx < gw - 1; cx++) {
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
  const point = (id) => {
    const o = id >> 1, cx = o % gw, cy = (o / gw) | 0, a = v[o];
    return id & 1 ? [cx, cy + a / (a - v[o + gw])] : [cx + a / (a - v[o + 1]), cy];
  };
  const lonOf = (gx) => ((((gx - 0.5) * s) / 256 + x0) / n) * 360 - 180;
  const latOf = (gy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (((gy - 0.5) * s) / 256 + y0)) / n))) / RAD;
  const rings = [];
  while (next.size) {
    const start = next.keys().next().value, pts = [];
    let e = start;
    do { pts.push(point(e)); const to = next.get(e); next.delete(e); e = to; } while (e !== undefined && e !== start);
    if (pts.length < 4) continue;
    let ax = Infinity, bx = -Infinity, ay = Infinity, by = -Infinity;
    for (const [x, y] of pts) { if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
    if (bx - ax < 1.2 && by - ay < 1.2) continue;          // specks
    const mid = pts.length >> 1;
    const simple = [...simplify(pts.slice(0, mid + 1), 0.3), ...simplify(pts.slice(mid), 0.3).slice(1)];
    const flat = [];
    for (const [x, y] of simple) flat.push(lonOf(x), latOf(y));
    rings.push(flat);
  }
  coastCache.set(data, rings);
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

async function vectors(ext, pad, wantTowns) {
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
export async function drawPlace(fmt, faceKey, styleKey, place, { span = 300, towns = true, progress, alive = () => true } = {}) {
  const ext = placeExtent(fmt, place.lat, place.lon, SPANS[span].km), pad = padExtent(ext), z = placeZoom(fmt, ext, pad);
  const opts = { zf: +clamp(3.1 * 0.8 ** (z - 7), 1, 3.1).toFixed(2), motifStep: r4((ext.lon1 - ext.lon0) / 72), world: true };
  const vec = vectors(ext, pad, towns);                    // alongside the tiles
  const rel = await relief(z, pad, styleKey, progress?.('Engraving relief'), opts);
  if (!alive()) return null;
  const data = await elevationData(z, pad);
  progress?.('Tracing the coast')(0.5);
  await new Promise((r) => setTimeout(r));
  const sample = elevationSampler(data);
  const geo = { land: coastline(data), landAt: (lon, lat) => sample(lon, lat) > 0.5, ...(await vec) };
  await document.fonts.ready;
  if (!alive()) return null;
  return buildPlace(fmt, faceKey, styleKey, rel, ext, place, geo);
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

export function buildPlace(fmt, faceKey, styleKey, reliefData, EXT, place, geo) {
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
  const land = geo.land.map((r) => pathOf(r, true)).join('');
  const rivers = geo.rivers.map((r) => pathOf(r, false)).join('');
  const lakes = geo.lakes.map((poly) => poly.map((r) => pathOf(r, true)).join('')).join('');
  const R = 11.5 * ts, mx = px(place.lon), my = py(place.lat);

  // --- cartouche: sized to the title, set in the corner with the least land under it; the rose takes another ---
  const title = (place.title || '').trim() || 'Untitled', sub = (place.sub || '').trim();
  const titleFont = `${face.weight} $px ${face.family}`, maxW = F.w * 0.66;
  let tSize = fs(100 * face.scale), sSize = fs(25);
  const tw = textWidth(title, titleFont, tSize, face.track * ts), sw = textWidth(sub, FELL_I, sSize);
  const cart = { w: clamp(Math.max(tw + fs(90), sw + fs(80)), fs(560), maxW), h: fs(372) };
  if (tw + fs(90) > cart.w) tSize = f1((tSize * (cart.w - fs(90))) / tw);
  if (sw + fs(80) > cart.w) sSize = f1((sSize * (cart.w - fs(80))) / sw);
  const landUnder = (x0, y0, x1, y1) => {
    let c = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) c += geo.landAt(lonAt(x0 + ((i + 0.5) / 6) * (x1 - x0)), latAt(y0 + ((j + 0.5) / 6) * (y1 - y0))) ? 1 : 0;
    return c / 36;
  };
  const m = fs(40), roseR = 92 * ts, rr = roseR * 1.5;
  const corners = [[F.x + m, bottom - m - cart.h], [F.x + F.w - m - cart.w, bottom - m - cart.h], [F.x + m, F.y + m + fs(30)], [F.x + F.w - m - cart.w, F.y + m + fs(30)]];
  const cScore = corners.map(([x, y], i) => landUnder(x, y, x + cart.w, y + cart.h) + i * 0.02);
  const best = cScore.indexOf(Math.min(...cScore));
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
  const label = (x, y, text, size, cls, gap, avoid = []) => {
    const wdt = textWidth(text, FELL_I, size), hgt = size * 0.92;
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
  for (const t of geo.towns) {
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
  if (neat === null) {
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
    <text class="eyebrow" x="${f1(cx)}" y="${f1(yT)}" style="font-size:${fs(19)}px;letter-spacing:${fs(8)}px">A chart of</text>
    <text class="title" x="${f1(cx)}" y="${f1(yTitle)}" style="font-size:${tSize}px;letter-spacing:${f1(face.track * ts)}px">${esc(title)}</text>
    <text class="subtitle" x="${f1(cx)}" y="${f1(ySub)}" style="font-size:${sSize}px">${esc(sub)}</text>
    ${ornamentRule(cx, ySub + fs(18), fs(150), ts)}
    <text class="facts" x="${f1(cx)}" y="${f1(yFacts)}" style="font-size:${fs(17)}px;letter-spacing:${fs(4)}px">${dm(place.lat, 'N', 'S')} · ${dm(place.lon, 'E', 'W')}</text>
    <text class="credit" x="${f1(cx)}" y="${f1(cart.y + cart.h - fs(22))}" text-anchor="middle" style="font-size:${fs(11)}px">Relief: Mapzen Terrain Tiles · Rivers, lakes &amp; towns: Natural Earth</text>`;

  const rel = rel_(reliefData, px, py);
  const frameRect = `x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}"`;
  const motifSvg = FX.motifs ? paintMotifs(reliefData.motifs || [], px, py, ts, [{ x: mx, y: my }], R, [...obstacles, ...placed], FX.motifs, []) : '';

  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, `<clipPath id="frame"><rect ${frameRect}/></clipPath>
    <path id="landp" d="${land}"/>
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
    <path d="${rivers}" fill="none" stroke="${C.water}" stroke-width="${f1(1.5 * k)}" stroke-opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>
    ${lakes ? `<path d="${lakes}" fill="${C.sea}" fill-rule="evenodd" stroke="${C.ink}" stroke-width="${f1(1 * k)}" stroke-linejoin="round"/>` : ''}
    <use href="#landp" fill="none" stroke="${C.ink}" stroke-width="${f1(1.6 * k)}" stroke-linejoin="round"/>
    ${motifSvg}
    ${dots}
    ${marker}
    ${names}
    ${compassRose(rcx, rcy, roseR, ts)}
    ${cartouche}
    ${scale}
  </g>
  ${neat}

  ${sheetClose(W, H, FX)}`;
}
