// Print edition: an antique-style chart of the journey, drawn as one SVG.
// Units are hundredths of an inch on an 18 × 24 in sheet; other sizes scale (same 3:4).
import { STOPS } from './data/stops.js';
import { LAND, RIVERS } from './data/printdata.js';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const SHEET = { w: 1800, h: 2400 };
const EXTENT = { lon0: 66.5, lon1: 97.5, lat0: 5.5, lat1: 35.5 };
const FRAME = { x: 110, y: 430, w: 1580 };
// Print-specific label placement where the web layout collides at this scale
const PRINT_LABEL = { 1: ['right', 0], 8: ['top', 20] };
const INK = '#2b1d12', RED = '#8a2b1c', WATER = '#4f6878', PAPER = '#f1e6c8';

// ---------- Projection (Mercator, matching the web map) ----------
const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const MY1 = mercY(EXTENT.lat1), MY0 = mercY(EXTENT.lat0);
FRAME.h = Math.round((FRAME.w * (MY1 - MY0)) / ((EXTENT.lon1 - EXTENT.lon0) * RAD));
const px = (lon) => FRAME.x + ((lon - EXTENT.lon0) / (EXTENT.lon1 - EXTENT.lon0)) * FRAME.w;
const py = (lat) => FRAME.y + ((MY1 - mercY(lat)) / (MY1 - MY0)) * FRAME.h;
const unitsPerKm = (lat) => FRAME.w / (EXTENT.lon1 - EXTENT.lon0) / (111.32 * Math.cos(lat * RAD));

const f1 = (n) => +n.toFixed(1);
const pathOf = (flat, close) => {
  let d = '';
  for (let i = 0; i < flat.length; i += 2) d += `${i ? 'L' : 'M'}${f1(px(flat[i]))},${f1(py(flat[i + 1]))}`;
  return close ? d + 'Z' : d;
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// Same softened Catmull-Rom as the web map, so the trail matches
function smoothRoute(pts, seg = 14) {
  const out = [];
  const lerp = (a, b, t) => a + (b - a) * t;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      const cr = [0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t +
        (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3));
      out.push([lerp(lerp(p1[0], p2[0], t), cr[0], 0.55), lerp(lerp(p1[1], p2[1], t), cr[1], 0.55)]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- Engraved relief from Terrarium tiles ----------
async function engraveRelief(onProgress) {
  const Z = 7, n = 2 ** Z;
  const tx = (lon) => ((lon + 180) / 360) * n;
  const ty = (lat) => ((1 - mercY(lat) / Math.PI) / 2) * n;
  const x0 = Math.floor(tx(EXTENT.lon0)), x1 = Math.floor(tx(EXTENT.lon1));
  const y0 = Math.floor(ty(EXTENT.lat1)), y1 = Math.floor(ty(EXTENT.lat0));
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1, W = cols * 256, H = rows * 256;
  const elev = new Float32Array(W * H);

  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let done = 0;
  const scratch = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
  const worker = async () => {
    while (jobs.length) {
      const [x, y] = jobs.shift();
      try {
        const res = await fetch(DEM_URL.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
        const bmp = await createImageBitmap(await res.blob());
        scratch.drawImage(bmp, 0, 0);
        const d = scratch.getImageData(0, 0, 256, 256).data;
        const ox = (x - x0) * 256, oy = (y - y0) * 256;
        for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
          const k = (j * 256 + i) * 4;
          elev[(oy + j) * W + ox + i] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
        }
      } catch { /* missing tile: leave flat */ }
      onProgress(++done / (cols * rows));
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  // Horn hillshade, light from the north-west, warm sepia ramp by elevation
  const out = new ImageData(W, H);
  const o = out.data;
  const ramp = [[0, [241, 230, 200]], [300, [236, 224, 190]], [900, [226, 207, 166]], [2000, [212, 188, 148]],
    [3500, [196, 174, 144]], [4800, [205, 194, 178]], [6000, [240, 236, 226]]];
  const tint = (e) => {
    if (e <= ramp[0][0]) return ramp[0][1];
    for (let i = 1; i < ramp.length; i++) if (e < ramp[i][0]) {
      const [ea, ca] = ramp[i - 1], [eb, cb] = ramp[i], t = (e - ea) / (eb - ea);
      return ca.map((c, k) => c + (cb[k] - c) * t);
    }
    return ramp[ramp.length - 1][1];
  };
  const az = 315 * RAD, alt = 42 * RAD, zf = 2.6;
  for (let j = 1; j < H - 1; j++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + j / 256)) / n))) / RAD;
    const cell = (40075016 * Math.cos(lat * RAD)) / (256 * n);
    for (let i = 1; i < W - 1; i++) {
      const at = (dx, dy) => Math.max(0, elev[(j + dy) * W + i + dx]);
      const dzdx = ((at(1, -1) + 2 * at(1, 0) + at(1, 1)) - (at(-1, -1) + 2 * at(-1, 0) + at(-1, 1))) / (8 * cell);
      const dzdy = ((at(-1, 1) + 2 * at(0, 1) + at(1, 1)) - (at(-1, -1) + 2 * at(0, -1) + at(1, -1))) / (8 * cell);
      const slope = Math.atan(zf * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const hs = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
      const shade = Math.min(1.12, 0.42 + 0.78 * Math.max(0, hs));
      const c = tint(at(0, 0));
      const k = (j * W + i) * 4;
      o[k] = Math.min(255, c[0] * shade); o[k + 1] = Math.min(255, c[1] * shade); o[k + 2] = Math.min(255, c[2] * shade * 0.97);
      o[k + 3] = 255;
    }
  }
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d').putImageData(out, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  const href = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

  // Tile mosaic corners in map units
  const lonOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD;
  return { href, x: px(lonOf(x0)), y: py(latOf(y0)), w: px(lonOf(x1 + 1)) - px(lonOf(x0)), h: py(latOf(y1 + 1)) - py(latOf(y0)) };
}

// ---------- Marker layout: nudge crowded discs apart, with leader lines ----------
function layoutDiscs(r) {
  const nodes = STOPS.map((s) => ({ ax: px(s.lon), ay: py(s.lat), x: px(s.lon), y: py(s.lat) }));
  const min = 2 * r + 3;
  for (let it = 0; it < 400; it++) {
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const A = nodes[a], B = nodes[b];
      let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { dx = 1; dy = 0.5; d = 1.1; }
      if (d < min) {
        const push = (min - d) / 2;
        A.x -= (dx / d) * push; A.y -= (dy / d) * push;
        B.x += (dx / d) * push; B.y += (dy / d) * push;
      }
    }
    for (const N of nodes) { N.x += (N.ax - N.x) * 0.02; N.y += (N.ay - N.y) * 0.02; }
  }
  return nodes;
}

// ---------- Ornaments ----------
function compassRose(cx, cy, R) {
  const pts = (rot, len, w) => {
    const a = rot * RAD, p = (ang, rr) => `${f1(cx + Math.sin(ang) * rr)},${f1(cy - Math.cos(ang) * rr)}`;
    return [p(a, len), p(a + Math.PI / 2, w), p(a + Math.PI, w * 0.3), p(a - Math.PI / 2, w)];
  };
  let g = `<g class="rose">`;
  g += `<circle cx="${cx}" cy="${cy}" r="${R * 0.92}" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
  g += `<circle cx="${cx}" cy="${cy}" r="${R * 0.86}" fill="none" stroke="${INK}" stroke-width="0.6"/>`;
  for (let d = 0; d < 360; d += 10) {
    const a = d * RAD, r1 = R * 0.86, r2 = R * (d % 30 ? 0.82 : 0.78);
    g += `<line x1="${f1(cx + Math.sin(a) * r1)}" y1="${f1(cy - Math.cos(a) * r1)}" x2="${f1(cx + Math.sin(a) * r2)}" y2="${f1(cy - Math.cos(a) * r2)}" stroke="${INK}" stroke-width="0.7"/>`;
  }
  for (const [rot, len, w] of [[45, 0.55, 0.09], [135, 0.55, 0.09], [225, 0.55, 0.09], [315, 0.55, 0.09], [0, 0.95, 0.13], [90, 0.8, 0.12], [180, 0.8, 0.12], [270, 0.8, 0.12]]) {
    const [tip, l, , rgt] = pts(rot, R * len, R * w);
    g += `<polygon points="${f1(cx)},${f1(cy)} ${tip} ${l}" fill="${INK}"/><polygon points="${f1(cx)},${f1(cy)} ${tip} ${rgt}" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/>`;
  }
  g += `<circle cx="${cx}" cy="${cy}" r="${R * 0.05}" fill="${RED}"/>`;
  g += `<text x="${cx}" y="${f1(cy - R * 1.04)}" class="rose-n">N</text></g>`;
  return g;
}

function neatline() {
  // alternating ink/paper degree segments around the map frame, labels every 5°
  const t = 9, { x, y, w, h } = FRAME;
  let g = `<rect x="${x - t}" y="${y - t}" width="${w + 2 * t}" height="${h + 2 * t}" fill="none" stroke="${INK}" stroke-width="1.4"/>`;
  g += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${INK}" stroke-width="1"/>`;
  for (let lon = Math.ceil(EXTENT.lon0); lon < EXTENT.lon1; lon++) {
    if (lon % 2) continue;
    const a = px(lon), b = px(Math.min(lon + 1, EXTENT.lon1));
    g += `<rect x="${f1(a)}" y="${y - t}" width="${f1(b - a)}" height="${t}" fill="${INK}"/><rect x="${f1(a)}" y="${y + h}" width="${f1(b - a)}" height="${t}" fill="${INK}"/>`;
  }
  for (let lat = Math.ceil(EXTENT.lat0); lat < EXTENT.lat1; lat++) {
    if (lat % 2) continue;
    const a = py(Math.min(lat + 1, EXTENT.lat1)), b = py(lat);
    g += `<rect x="${x - t}" y="${f1(a)}" width="${t}" height="${f1(b - a)}" fill="${INK}"/><rect x="${x + w}" y="${f1(a)}" width="${t}" height="${f1(b - a)}" fill="${INK}"/>`;
  }
  for (let lon = 70; lon <= 95; lon += 5) {
    g += `<text class="deg" x="${f1(px(lon))}" y="${y - t - 8}">${lon}° E</text><text class="deg" x="${f1(px(lon))}" y="${y + h + t + 20}">${lon}° E</text>`;
  }
  for (let lat = 10; lat <= 35; lat += 5) {
    g += `<text class="deg" transform="translate(${x - t - 10},${f1(py(lat))}) rotate(-90)">${lat}° N</text>`;
    g += `<text class="deg" transform="translate(${x + w + t + 18},${f1(py(lat))}) rotate(-90)">${lat}° N</text>`;
  }
  return g;
}

// ---------- Compose ----------
export async function buildSheet(onProgress) {
  const relief = await engraveRelief(onProgress);
  const land = LAND.map((r) => pathOf(r, true)).join('');
  const rivers = RIVERS.map((r) => pathOf(r, false)).join('');
  const route = smoothRoute(STOPS.map((s) => [s.lon, s.lat]));
  const routeD = route.map(([lo, la], i) => `${i ? 'L' : 'M'}${f1(px(lo))},${f1(py(la))}`).join('');
  const { x, y, w, h } = FRAME;
  const R = 11.5;
  const discs = layoutDiscs(R);

  // Graticule
  let grat = '';
  for (let lon = 70; lon <= 95; lon += 5) grat += `M${f1(px(lon))},${y}V${y + h}`;
  for (let lat = 10; lat <= 35; lat += 5) grat += `M${x},${f1(py(lat))}H${x + w}`;

  // Water-lining: concentric strokes of the coast, ink then paper, outermost first
  let waterLines = '';
  for (let k = 7; k >= 1; k--) {
    const wd = k * 7.5;
    waterLines += `<path d="${land}" fill="none" stroke="${WATER}" stroke-opacity="${(0.09 + 0.05 * (8 - k) / 7).toFixed(3)}" stroke-width="${wd}" stroke-linejoin="round"/>`;
    waterLines += `<path d="${land}" fill="none" stroke="#e7dcbf" stroke-width="${wd - 1.6}" stroke-linejoin="round"/>`;
  }

  const label = (text, lon, lat, cls, extra = '') => `<text class="${cls}" x="${f1(px(lon))}" y="${f1(py(lat))}" ${extra}>${esc(text)}</text>`;
  const areas = [
    label('Arabian Sea', 70.2, 17.2, 'sea'),
    label('Bay of Bengal', 90.1, 18.45, 'sea'),
    label('Indian Ocean', 77.6, 6.6, 'sea'),
    label('Himalaya', 88.4, 29.25, 'range', `transform="rotate(-8 ${f1(px(88.4))} ${f1(py(29.25))})"`),
    label('Tibet', 88.2, 33.2, 'region'),
    label('Nepal', 81.25, 28.95, 'region small'),
    label('Bengal', 87.15, 23.75, 'region small'),
    label('Deccan', 78.6, 18.5, 'region'),
    label('Gujarat', 71.2, 23.6, 'region small'),
    label('Hindustan', 79.6, 24.3, 'region big'),
    label('Thar', 71.6, 27.4, 'region small'),
    label('Lanka', 80.7, 7.3, 'region small'),
  ].join('');

  // Discs, leaders, milestone names
  let marks = '';
  discs.forEach((d, i) => {
    const s = STOPS[i];
    const moved = Math.hypot(d.x - d.ax, d.y - d.ay) > R * 0.9;
    if (moved) marks += `<line x1="${f1(d.ax)}" y1="${f1(d.ay)}" x2="${f1(d.x)}" y2="${f1(d.y)}" stroke="${INK}" stroke-width="0.7"/><circle cx="${f1(d.ax)}" cy="${f1(d.ay)}" r="2" fill="${INK}"/>`;
  });
  discs.forEach((d, i) => {
    const s = STOPS[i];
    const end = i === 0 || i === 1 || i === STOPS.length - 1;
    marks += `<circle cx="${f1(d.x)}" cy="${f1(d.y)}" r="${R}" fill="${end ? RED : PAPER}" stroke="${INK}" stroke-width="1.3"/>`;
    marks += `<text class="num${end ? ' end' : ''}" x="${f1(d.x)}" y="${f1(d.y + 4.2)}">${s.n}</text>`;
    if (s.key) {
      const [side, extra] = PRINT_LABEL[s.n] || [s.side || 'right', 0];
      const gap = R + 6 + extra;
      const [tx, ty, anchor] = side === 'left' ? [d.x - gap, d.y + 5, 'end'] : side === 'top' ? [d.x, d.y - gap - 2, 'middle']
        : side === 'bottom' ? [d.x, d.y + gap + 14, 'middle'] : [d.x + gap, d.y + 5, 'start'];
      marks += `<text class="place" x="${f1(tx)}" y="${f1(ty)}" text-anchor="${anchor}">${esc(s.key)}</text>`;
    }
  });

  // Key, set in the Indian Ocean like the original map
  const kx = px(84.3), ky = py(17.6), kw = px(97.1) - kx, kh = py(5.75) - ky;
  const rows = Math.ceil(STOPS.length / 2), lh = (kh - 74) / rows;
  let key = `<g class="key"><rect x="${f1(kx)}" y="${f1(ky)}" width="${f1(kw)}" height="${f1(kh)}" fill="${PAPER}" fill-opacity="0.94" stroke="${INK}" stroke-width="1.4"/>`;
  key += `<rect x="${f1(kx + 6)}" y="${f1(ky + 6)}" width="${f1(kw - 12)}" height="${f1(kh - 12)}" fill="none" stroke="${INK}" stroke-width="0.6"/>`;
  key += `<text class="key-title" x="${f1(kx + kw / 2)}" y="${f1(ky + 40)}">The Sixty-five Tirths</text>`;
  STOPS.forEach((s, i) => {
    const col = i < rows ? 0 : 1, row = i % rows;
    const tx = kx + 22 + col * (kw / 2), ty = ky + 70 + row * lh;
    key += `<text class="key-n" x="${f1(tx + 22)}" y="${f1(ty)}">${s.n}.</text>`;
    key += `<text class="key-t" x="${f1(tx + 30)}" y="${f1(ty)}">${esc(s.name)}${s.alt ? `<tspan class="key-alt"> (${esc(s.alt)})</tspan>` : ''}</text>`;
  });
  key += '</g>';

  // Scale bar for 20° N
  const k500 = 500 * unitsPerKm(20), sx = px(67.6), sy = py(9.1);
  let scale = `<g class="scale">`;
  for (let i = 0; i < 5; i++) scale += `<rect x="${f1(sx + (i * k500) / 5)}" y="${f1(sy)}" width="${f1(k500 / 5)}" height="7" fill="${i % 2 ? PAPER : INK}" stroke="${INK}" stroke-width="0.8"/>`;
  scale += [0, 250, 500].map((v) => `<text class="deg" x="${f1(sx + (v / 500) * k500)}" y="${f1(sy - 7)}">${v}</text>`).join('');
  scale += `<text class="scale-t" x="${f1(sx + k500 / 2)}" y="${f1(sy + 30)}">Kilometres (at 20° N)</text></g>`;

  const startA = `<text class="annot" x="${f1(px(82.6))}" y="${f1(py(25.85))}">Departs Ayodhya</text><text class="annot sub" x="${f1(px(82.6))}" y="${f1(py(25.85) + 17)}">29 June 1792</text>`;
  const endA = `<text class="annot" x="${f1(px(70.05))}" y="${f1(py(20.15))}" text-anchor="middle">Arrives at Loj</text><text class="annot sub" x="${f1(px(70.05))}" y="${f1(py(20.15) + 17)}" text-anchor="middle">21 August 1799</text>`;

  const midX = SHEET.w / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET.w} ${SHEET.h}" id="chart">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.25  0 0 0 0 0.12  0 0 0 0.55 -0.12"/>
    </filter>
    <filter id="mottle" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="4" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.32  0 0 0 0 0.14  0 0 0 0.5 -0.18"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="62%" stop-color="#6b4a22" stop-opacity="0"/>
      <stop offset="100%" stop-color="#6b4a22" stop-opacity="0.32"/>
    </radialGradient>
    <clipPath id="frame"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>
    <clipPath id="land"><path d="${land}"/></clipPath>
    <style>
      text { font-family: 'IM Fell English', 'Iowan Old Style', Georgia, serif; fill: ${INK}; }
      .sc { font-family: 'IM Fell English SC', 'IM Fell English', Georgia, serif; }
      .eyebrow { font-family: 'IM Fell English SC', Georgia, serif; font-size: 30px; letter-spacing: 14px; text-anchor: middle; }
      .title { font-size: 150px; text-anchor: middle; letter-spacing: 2px; }
      .subtitle { font-style: italic; font-size: 38px; text-anchor: middle; }
      .facts { font-family: 'IM Fell English SC', Georgia, serif; font-size: 25px; letter-spacing: 5px; text-anchor: middle; fill: #4a3523; }
      .sea { font-style: italic; font-size: 34px; letter-spacing: 7px; text-anchor: middle; fill: ${WATER}; }
      .range { font-family: 'IM Fell English SC', Georgia, serif; font-size: 34px; letter-spacing: 26px; text-anchor: middle; fill: #5a3f26; }
      .region { font-family: 'IM Fell English SC', Georgia, serif; font-size: 26px; letter-spacing: 12px; text-anchor: middle; fill: #5a3f26; }
      .region.small { font-size: 20px; letter-spacing: 8px; }
      .region.big { font-size: 46px; letter-spacing: 30px; fill: #5a3f26; opacity: 0.8; }
      .num { font-family: Inter, system-ui, sans-serif; font-weight: 600; font-size: 11.5px; text-anchor: middle; }
      .num.end { fill: ${PAPER}; }
      .place { font-style: italic; font-size: 21px; paint-order: stroke; stroke: ${PAPER}; stroke-width: 5px; stroke-linejoin: round; }
      .annot { font-style: italic; font-size: 19px; fill: ${RED}; paint-order: stroke; stroke: ${PAPER}; stroke-width: 5px; }
      .annot.sub { font-size: 16px; }
      .deg { font-size: 15px; text-anchor: middle; fill: #4a3523; }
      .key-title { font-family: 'IM Fell English SC', Georgia, serif; font-size: 27px; letter-spacing: 6px; text-anchor: middle; }
      .key-n { font-size: 14.5px; text-anchor: end; }
      .key-t { font-size: 14.5px; }
      .key-alt { font-style: italic; fill: #5c4a38; }
      .scale-t { font-style: italic; font-size: 16px; text-anchor: middle; }
      .rose-n { font-family: 'IM Fell English SC', Georgia, serif; font-size: 30px; text-anchor: middle; }
      .legend { font-style: italic; font-size: 19px; }
      .credit { font-size: 13.5px; fill: #5c4a38; }
      .colophon { font-style: italic; font-size: 21px; text-anchor: middle; fill: #4a3523; }
    </style>
  </defs>

  <rect width="${SHEET.w}" height="${SHEET.h}" fill="${PAPER}"/>
  <rect width="${SHEET.w}" height="${SHEET.h}" filter="url(#mottle)"/>

  <!-- border -->
  <rect x="38" y="38" width="${SHEET.w - 76}" height="${SHEET.h - 76}" fill="none" stroke="${INK}" stroke-width="3"/>
  <rect x="50" y="50" width="${SHEET.w - 100}" height="${SHEET.h - 100}" fill="none" stroke="${INK}" stroke-width="0.9"/>

  <!-- title -->
  <text class="eyebrow" x="${midX}" y="130">A Chart of the Pilgrimage called</text>
  <text class="title" x="${midX}" y="262">Van Vicharan</text>
  <text class="subtitle" x="${midX}" y="318">The forest journey of Nilkanth Varni, from Ayodhya to Loj</text>
  <line x1="${midX - 300}" y1="342" x2="${midX + 300}" y2="342" stroke="${INK}" stroke-width="0.8"/>
  <text class="facts" x="${midX}" y="384">1792 · sixty-five tirths · seven years, one month &amp; eleven days · 1799</text>

  <!-- map -->
  <g clip-path="url(#frame)">
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#e7dcbf"/>
    ${waterLines}
    <g clip-path="url(#land)">
      <image href="${relief.href}" x="${f1(relief.x)}" y="${f1(relief.y)}" width="${f1(relief.w)}" height="${f1(relief.h)}" preserveAspectRatio="none"/>
    </g>
    <path d="${grat}" fill="none" stroke="${INK}" stroke-opacity="0.22" stroke-width="0.7"/>
    <path d="${rivers}" fill="none" stroke="${WATER}" stroke-width="1.3" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${land}" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linejoin="round"/>
    ${areas}
    <path d="${routeD}" fill="none" stroke="${PAPER}" stroke-width="7" stroke-linejoin="round" stroke-opacity="0.9"/>
    <path d="${routeD}" fill="none" stroke="${RED}" stroke-width="2.6" stroke-dasharray="10 6" stroke-linejoin="round"/>
    ${marks}
    ${startA}${endA}
    ${compassRose(px(69.6), py(13.4), 92)}
    ${scale}
    ${key}
  </g>
  ${neatline()}

  <!-- legend & colophon -->
  <g transform="translate(${x}, ${y + h + 78})">
    <line x1="0" y1="0" x2="54" y2="0" stroke="${RED}" stroke-width="2.6" stroke-dasharray="10 6"/>
    <text class="legend" x="66" y="6">The route as charted</text>
    <circle cx="340" cy="0" r="${R}" fill="${PAPER}" stroke="${INK}" stroke-width="1.3"/><text class="num" x="340" y="4.2">7</text>
    <text class="legend" x="360" y="6">Tirth, numbered as in the key</text>
    <circle cx="700" cy="0" r="${R}" fill="${RED}" stroke="${INK}" stroke-width="1.3"/><text class="num end" x="700" y="4.2">1</text>
    <text class="legend" x="720" y="6">Beginning &amp; end of the journey</text>
  </g>
  <text class="colophon" x="${midX}" y="${y + h + 140}">Departed Ayodhya on Ashadh sud 10, Samvat 1849 · Arrived at Loj on Shravan vad 6, Samvat 1856</text>
  <text class="credit" x="${x}" y="${SHEET.h - 76}">Relief engraved from Mapzen Terrain Tiles · Coastlines &amp; rivers: Natural Earth · Positions of tirths are approximate</text>
  <text class="credit" x="${x + w}" y="${SHEET.h - 76}" text-anchor="end">Drawn ${new Date().getFullYear()} · Mercator projection</text>

  <rect width="${SHEET.w}" height="${SHEET.h}" fill="url(#vignette)" pointer-events="none"/>
  <rect width="${SHEET.w}" height="${SHEET.h}" filter="url(#grain)" opacity="0.5" pointer-events="none"/>
</svg>`;
}

// ---------- Page wiring ----------
const SIZES = { '12x16': [12, 16], '18x24': [18, 24], '24x32': [24, 32] };
const sheetEl = document.getElementById('sheet');
const status = document.getElementById('status');
const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);

function setSize(key) {
  const [wIn, hIn] = SIZES[key];
  pageStyle.textContent = `@page { size: ${wIn}in ${hIn}in; margin: 0; } @media print { #chart { width: ${wIn}in; height: ${hIn}in; } }`;
  document.querySelectorAll('.sizes button').forEach((b) => b.classList.toggle('on', b.dataset.size === key));
}
document.querySelectorAll('.sizes button').forEach((b) => (b.onclick = () => setSize(b.dataset.size)));
setSize('18x24');

const svg = await buildSheet((p) => (status.textContent = `Engraving relief… ${Math.round(p * 100)}%`));
await document.fonts.ready;
sheetEl.innerHTML = svg;
status.textContent = 'Ready to print';
document.body.classList.add('ready');

const btnPrint = document.getElementById('btn-print');
const btnSvg = document.getElementById('btn-svg');
btnPrint.disabled = btnSvg.disabled = false;
btnPrint.onclick = () => window.print();
btnSvg.onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = 'van-vicharan-map.svg';
  a.click();
};
