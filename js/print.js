// Print edition: an antique-style chart of the journey, drawn as one SVG.
// Units are hundredths of an inch, so a sheet is (inches × 100) units on a side.
// Each format lays out in its own proportions; type is sized for viewing distance.
import { STOPS, REGIONS, REGION_SHORT } from './data/stops.js';
import { LAND, RIVERS } from './data/printdata.js';
import { buildChronology } from './chronology.js';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const EXTENT = { lon0: 66.5, lon1: 97.5, lat0: 5.5, lat1: 35.5 };

export const FORMATS = {
  // Home printers can't print to the edge, so the test sheet sits inside ¼ in margins on Letter
  letter: { w: 8, h: 10.5, label: '8.5 × 11 in (test)', page: [8.5, 11], margin: 0.25 },
  '12x16': { w: 12, h: 16, label: '12 × 16 in' },
  '18x24': { w: 18, h: 24, label: '18 × 24 in' },
  '24x36': { w: 24, h: 36, label: '24 × 36 in' },
  a2: { w: 16.54, h: 23.39, label: 'A2' },
};

// Title faces: all period-appropriate for a late-18th-century chart
export const TITLE_FACES = {
  garamond: { label: 'Garamond', family: "'Cormorant Garamond', Georgia, serif", weight: 600, scale: 1.12, track: 1 },
  didone: { label: 'Didone', family: "'Bodoni Moda', 'Didot', Georgia, serif", weight: 500, scale: 0.98, track: 0 },
  copperplate: { label: 'Copperplate', family: "'Pinyon Script', cursive", weight: 400, scale: 1.3, track: 0 },
  fell: { label: 'Fell', family: "'IM Fell English', Georgia, serif", weight: 400, scale: 1, track: 2 },
};

// Deeper, higher-contrast palette
const C = {
  ink: '#1c120a', ink2: '#3b2a1b', red: '#7a1c10', water: '#2c4a5a',
  paper: '#ebdab0', sea: '#d6d6c0', seaLine: '#d6d6c0', key: '#efe1bb',
};

const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const MY1 = mercY(EXTENT.lat1), MY0 = mercY(EXTENT.lat0);
const MAP_RATIO = (MY1 - MY0) / ((EXTENT.lon1 - EXTENT.lon0) * RAD);
const f1 = (n) => +n.toFixed(1);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const lerp = (a, b, t) => a + (b - a) * t;

function haversineKm([lon1, lat1], [lon2, lat2]) {
  const dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Same softened Catmull-Rom as the web map, so the trail and distances match
function smoothRoute(pts, seg) {
  const out = [];
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
const stopPts = STOPS.map((s) => [s.lon, s.lat]);
const ROUTE = smoothRoute(stopPts, 24);
const LEG_KM = STOPS.slice(0, -1).map((_, i) => {
  let d = 0;
  for (let k = i * 24; k < (i + 1) * 24; k++) d += haversineKm(ROUTE[k], ROUTE[k + 1]);
  return d;
});
const CHRONO = buildChronology(LEG_KM);

// ---------- Engraved relief from Terrarium tiles (cached per zoom) ----------
const reliefCache = {};
export function relief(Z, onProgress) {
  return (reliefCache[Z] ||= engrave(Z, onProgress));
}

async function engrave(Z, onProgress) {
  const n = 2 ** Z;
  const tx = (lon) => ((lon + 180) / 360) * n;
  const ty = (lat) => ((1 - mercY(lat) / Math.PI) / 2) * n;
  const x0 = Math.floor(tx(EXTENT.lon0)), x1 = Math.floor(tx(EXTENT.lon1));
  const y0 = Math.floor(ty(EXTENT.lat1)), y1 = Math.floor(ty(EXTENT.lat0));
  const cols = x1 - x0 + 1, rows = y1 - y0 + 1, W = cols * 256, H = rows * 256;
  const elev = new Int16Array(W * H);                 // metres; Int16 halves memory at z8

  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  let done = 0;
  const worker = async () => {
    const g = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true });
    while (jobs.length) {
      const [x, y] = jobs.shift();
      try {
        const res = await fetch(DEM_URL.replace('{z}', Z).replace('{x}', x).replace('{y}', y));
        g.drawImage(await createImageBitmap(await res.blob()), 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data;
        const ox = (x - x0) * 256, oy = (y - y0) * 256;
        for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
          const k = (j * 256 + i) * 4;
          elev[(oy + j) * W + ox + i] = Math.max(-32000, Math.min(32000, Math.round(d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768)));
        }
      } catch { /* missing tile stays flat */ }
      onProgress?.(0.85 * (++done / (cols * rows)));
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));

  // Horn hillshade from the north-west over a deep sepia hypsometric ramp
  const ramp = [[0, [232, 213, 166]], [250, [226, 203, 152]], [800, [212, 182, 130]], [1800, [192, 158, 112]],
    [3200, [166, 138, 106]], [4600, [168, 154, 138]], [5600, [214, 206, 192]], [6600, [240, 236, 226]]];
  const lut = new Uint8Array(7000 * 3);
  for (let e = 0; e < 7000; e++) {
    let c = ramp[ramp.length - 1][1];
    for (let i = 1; i < ramp.length; i++) if (e < ramp[i][0]) {
      const [ea, ca] = ramp[i - 1], [eb, cb] = ramp[i], t = (e - ea) / (eb - ea);
      c = ca.map((v, k) => v + (cb[k] - v) * t); break;
    }
    lut.set(c, e * 3);
  }
  const az = 315 * RAD, alt = 40 * RAD, zf = 3.1;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const strip = 256;
  for (let sy = 0; sy < H; sy += strip) {               // build the image in strips to bound memory
    const hgt = Math.min(strip, H - sy);
    const img = new ImageData(W, hgt);
    const o = img.data;
    for (let jj = 0; jj < hgt; jj++) {
      const j = Math.min(H - 2, Math.max(1, sy + jj));
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + j / 256)) / n))) / RAD;
      const cell = (40075016 * Math.cos(lat * RAD)) / (256 * n);
      for (let i = 1; i < W - 1; i++) {
        const at = (dx, dy) => Math.max(0, elev[(j + dy) * W + i + dx]);
        const a = at(-1, -1), b = at(0, -1), c = at(1, -1), d = at(-1, 0), f = at(1, 0), g = at(-1, 1), h = at(0, 1), k9 = at(1, 1);
        const dzdx = ((c + 2 * f + k9) - (a + 2 * d + g)) / (8 * cell);
        const dzdy = ((g + 2 * h + k9) - (a + 2 * b + c)) / (8 * cell);
        const slope = Math.atan(zf * Math.hypot(dzdx, dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);
        const hs = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
        const shade = Math.min(1.14, 0.3 + 0.88 * Math.max(0, hs));
        const e = Math.min(6999, at(0, 0)) * 3;
        const p = (jj * W + i) * 4;
        o[p] = Math.min(255, lut[e] * shade); o[p + 1] = Math.min(255, lut[e + 1] * shade); o[p + 2] = Math.min(255, lut[e + 2] * shade * 0.96);
        o[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, sy);
    onProgress?.(0.85 + 0.1 * ((sy + hgt) / H));
    await new Promise((r) => setTimeout(r));           // keep the page responsive
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const href = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  onProgress?.(1);
  const lonOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD;
  return { href, lon0: lonOf(x0), lon1: lonOf(x1 + 1), lat0: latOf(y1 + 1), lat1: latOf(y0) };
}

// ---------- Text measurement ----------
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font, size, track = 0) {
  measureCtx.font = `${font.replace('$', size)}`;
  return measureCtx.measureText(text).width + track * Math.max(0, text.length - 1);
}
const FELL = "$px 'IM Fell English'", FELL_I = "italic $px 'IM Fell English'", FELL_SC = "$px 'IM Fell English SC'";
const boxHit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

// ---------- Compose one sheet ----------
// The stops named on the reference sheet (18 × 24 in). Other formats name exactly
// these, so every size carries the same content.
export const REFERENCE = '18x24';
export let lastNamed = null;

export function buildSheet(fmt, faceKey, reliefData, onlyNames = null) {
  const W = Math.round(fmt.w * 100), H = Math.round(fmt.h * 100);
  const k = W / 1800;                        // geometric scale vs. the 18 in design
  const ts = k;                              // everything scales with the sheet: same content at every size
  const fs = (u) => f1(u * ts);
  const face = TITLE_FACES[faceKey];

  // Vertical layout: title block, map, legend + colophon, chronicle, credits.
  // Every format carries the same content: if the sheet is too short for the
  // chronicle's minimum height, the map narrows to make room; extra height
  // on taller sheets enlarges the chronicle.
  const yCredit = H - 72 * k;
  const titleBlock = fs(62) + fs(150 * Math.min(1.08, face.scale)) + fs(56) + fs(26) + fs(44) + fs(50);
  const footBlock = fs(84) + fs(66) + fs(50);
  let mapW = W - 220 * k;
  let slack = yCredit - fs(30) - (70 * k + titleBlock + mapW * MAP_RATIO + footBlock);
  const CHRON_MIN = fs(215);
  if (slack < CHRON_MIN) { mapW -= (CHRON_MIN - slack) / MAP_RATIO; slack = CHRON_MIN; }
  const chronH = slack;
  const top = 70 * k;
  const yEyebrow = top + fs(62), yTitle = yEyebrow + fs(150 * Math.min(1.08, face.scale)), ySub = yTitle + fs(56);
  const yRule = ySub + fs(26), yFacts = yRule + fs(44);
  const F = { x: (W - mapW) / 2, w: mapW };
  F.y = yFacts + fs(50);
  F.h = F.w * MAP_RATIO;
  const px = (lon) => F.x + ((lon - EXTENT.lon0) / (EXTENT.lon1 - EXTENT.lon0)) * F.w;
  const py = (lat) => F.y + ((MY1 - mercY(lat)) / (MY1 - MY0)) * F.h;
  const unitsPerKm = (lat) => F.w / (EXTENT.lon1 - EXTENT.lon0) / (111.32 * Math.cos(lat * RAD));
  const pathOf = (flat, close) => {
    let d = '';
    for (let i = 0; i < flat.length; i += 2) d += `${i ? 'L' : 'M'}${f1(px(flat[i]))},${f1(py(flat[i + 1]))}`;
    return close ? d + 'Z' : d;
  };
  const bottom = F.y + F.h;
  const yLegend = bottom + fs(84), yColophon = yLegend + fs(66);

  const land = LAND.map((r) => pathOf(r, true)).join('');
  const rivers = RIVERS.map((r) => pathOf(r, false)).join('');
  const routeD = ROUTE.map(([lo, la], i) => `${i ? 'L' : 'M'}${f1(px(lo))},${f1(py(la))}`).join('');
  const R = 11.5 * ts;

  // --- discs, nudged apart where crowded ---
  const discs = STOPS.map((s, i) => ({ i, ax: px(s.lon), ay: py(s.lat), x: px(s.lon), y: py(s.lat) }));
  const min = 2 * R + 3 * ts;
  for (let it = 0; it < 420; it++) {
    for (let a = 0; a < discs.length; a++) for (let b = a + 1; b < discs.length; b++) {
      const A = discs[a], B = discs[b];
      let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < 1e-3) { dx = 1; dy = 0.5; d = 1.1; }
      if (d < min) { const p = (min - d) / 2; A.x -= (dx / d) * p; A.y -= (dy / d) * p; B.x += (dx / d) * p; B.y += (dy / d) * p; }
    }
    for (const N of discs) { N.x += (N.ax - N.x) * 0.02; N.y += (N.ay - N.y) * 0.02; }
  }

  // --- fixed furniture (also obstacles for labels) ---
  const obstacles = [[F.x - 1e4, F.y - 1e4, F.x + F.w + 1e4, F.y + 4], [F.x - 1e4, bottom - 4, F.x + F.w + 1e4, bottom + 1e4],
    [F.x - 1e4, F.y, F.x + 4, bottom], [F.x + F.w - 4, F.y, F.x + F.w + 1e4, bottom]];
  const kx = px(84.3), ky = py(17.6), kw = px(97.1) - kx, kh = py(5.75) - ky;
  obstacles.push([kx - 6, ky - 6, kx + kw + 6, ky + kh + 6]);
  const roseR = 92 * ts, rcx = px(69.6), rcy = py(13.4);
  obstacles.push([rcx - roseR, rcy - roseR * 1.3, rcx + roseR, rcy + roseR]);
  const k500 = 500 * unitsPerKm(20), sx = px(67.6), sy = py(9.1);
  obstacles.push([sx - 10, sy - fs(26), sx + k500 + 10, sy + fs(36)]);

  // area labels: [text, lon, lat, class, size, font, tracking, rotate]
  const AREA = [
    ['Arabian Sea', 70.2, 17.2, 'sea', 36, FELL_I, 8], ['Bay of Bengal', 90.1, 18.45, 'sea', 36, FELL_I, 8],
    ['Indian Ocean', 77.0, 6.15, 'sea', 36, FELL_I, 8],
    ['Himalaya', 88.4, 29.25, 'range', 36, FELL_SC, 28, -8], ['Tibet', 88.2, 33.2, 'region', 28, FELL_SC, 13],
    ['Nepal', 81.25, 28.95, 'region', 20, FELL_SC, 8], ['Bengal', 87.15, 23.75, 'region', 20, FELL_SC, 8],
    ['Deccan', 78.6, 18.5, 'region', 28, FELL_SC, 13], ['Gujarat', 71.2, 23.6, 'region', 20, FELL_SC, 8],
    ['Hindustan', 79.6, 24.3, 'region big', 50, FELL_SC, 32], ['Thar', 71.6, 27.4, 'region', 20, FELL_SC, 8],
    ['Lanka', 80.7, 7.3, 'region', 20, FELL_SC, 8],
  ];
  let areas = '';
  for (const [text, lon, lat, cls, size, font, track, rot] of AREA) {
    const s = fs(size), tr = track * ts, wdt = textWidth(text, font, s, tr), x = px(lon), y = py(lat);
    obstacles.push([x - wdt / 2, y - s * 0.8, x + wdt / 2, y + s * 0.25]);
    areas += `<text class="${cls}" x="${f1(x)}" y="${f1(y)}" style="font-size:${s}px;letter-spacing:${f1(tr)}px"${rot ? ` transform="rotate(${rot} ${f1(x)} ${f1(y)})"` : ''}>${esc(text)}</text>`;
  }

  // start / end annotations
  const ann = (lines, lon, lat, anchor) => {
    const x = px(lon), y = py(lat), s1 = fs(20), s2 = fs(16.5);
    const wdt = Math.max(textWidth(lines[0], FELL_I, s1), textWidth(lines[1], FELL_I, s2));
    const x0 = anchor === 'middle' ? x - wdt / 2 : x;
    obstacles.push([x0, y - s1, x0 + wdt, y + s2 + fs(6)]);
    return `<text class="annot" x="${f1(x)}" y="${f1(y)}" text-anchor="${anchor}" style="font-size:${s1}px">${lines[0]}</text>` +
      `<text class="annot" x="${f1(x)}" y="${f1(y + fs(18))}" text-anchor="${anchor}" style="font-size:${s2}px">${lines[1]}</text>`;
  };
  const annots = ann(['Departs Ayodhya', '29 June 1792'], 82.6, 25.85, 'start') + ann(['Arrives at Loj', '21 August 1799'], 70.05, 20.15, 'middle');

  // --- stop names: milestones first, then as many others as fit at this size ---
  const discBoxes = discs.map((d) => [d.x - R - 1, d.y - R - 1, d.x + R + 1, d.y + R + 1, d.i]);
  const placed = [];
  const PREF = { 1: 'right', 8: 'top' };
  const order = STOPS.map((_, i) => i).sort((a, b) => (STOPS[b].key ? 1 : 0) - (STOPS[a].key ? 1 : 0) || a - b);
  let names = '';
  const named = new Set();
  for (const i of order) {
    if (onlyNames && !onlyNames.has(i)) continue;
    const s = STOPS[i], d = discs[i];
    const major = !!s.key;
    const text = s.key || s.name.split(' – ')[0].split(' & ')[0].replace(/ (Mandir|Kovil|Swami)$/, '');
    // Reference names must appear on every sheet: if no side fits, retry a little smaller
    const sizes = onlyNames ? [1, 0.88, 0.78] : [1];
    for (const shrink of sizes) {
      if (named.has(i)) break;
      const size = f1(fs(major ? 21 : 15.5) * shrink);
      const wdt = textWidth(text, FELL_I, size), hgt = size * 0.92, gap = R + fs(5);
      const cand = {
        right: [d.x + gap, d.y - hgt * 0.62, d.x + gap + wdt, d.y + hgt * 0.38, 'start', d.x + gap, d.y + hgt * 0.3],
        left: [d.x - gap - wdt, d.y - hgt * 0.62, d.x - gap, d.y + hgt * 0.38, 'end', d.x - gap, d.y + hgt * 0.3],
        top: [d.x - wdt / 2, d.y - gap - hgt, d.x + wdt / 2, d.y - gap, 'middle', d.x, d.y - gap - hgt * 0.15],
        bottom: [d.x - wdt / 2, d.y + gap, d.x + wdt / 2, d.y + gap + hgt, 'middle', d.x, d.y + gap + hgt * 0.8],
      };
      const first = PREF[s.n] || s.side;
      const sides = [...new Set([first, 'right', 'left', 'top', 'bottom'].filter(Boolean))];
      for (const side of sides) {
        const b = cand[side];
        const box = b.slice(0, 4);
        if (obstacles.some((o) => boxHit(box, o)) || placed.some((o) => boxHit(box, o)) ||
            discBoxes.some((o) => o[4] !== i && boxHit(box, o))) continue;
        placed.push(box);
        named.add(i);
        names += `<text class="${major ? 'place' : 'place minor'}" x="${f1(b[5])}" y="${f1(b[6])}" text-anchor="${b[4]}" style="font-size:${size}px">${esc(text)}</text>`;
        break;
      }
    }
  }

  lastNamed = named;
  let marks = '';
  for (const d of discs) {
    if (Math.hypot(d.x - d.ax, d.y - d.ay) > R * 0.9) {
      marks += `<line x1="${f1(d.ax)}" y1="${f1(d.ay)}" x2="${f1(d.x)}" y2="${f1(d.y)}" stroke="${C.ink}" stroke-width="${f1(0.8 * ts)}"/><circle cx="${f1(d.ax)}" cy="${f1(d.ay)}" r="${f1(2.2 * ts)}" fill="${C.ink}"/>`;
    }
  }
  discs.forEach((d, i) => {
    const end = i <= 1 || i === STOPS.length - 1;
    marks += `<circle cx="${f1(d.x)}" cy="${f1(d.y)}" r="${f1(R)}" fill="${end ? C.red : C.key}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/>`;
    marks += `<text class="num${end ? ' end' : ''}" x="${f1(d.x)}" y="${f1(d.y + R * 0.36)}" style="font-size:${fs(12.5)}px">${STOPS[i].n}</text>`;
  });

  // --- key in the Indian Ocean ---
  const rows = Math.ceil(STOPS.length / 2);
  const head = fs(64), lh = (kh - head - fs(18)) / rows;
  const keySize = f1(Math.min(fs(14.5), lh * 0.86));
  let key = `<rect x="${f1(kx)}" y="${f1(ky)}" width="${f1(kw)}" height="${f1(kh)}" fill="${C.key}" fill-opacity="0.96" stroke="${C.ink}" stroke-width="${f1(1.6 * ts)}"/>`;
  key += `<rect x="${f1(kx + 6 * ts)}" y="${f1(ky + 6 * ts)}" width="${f1(kw - 12 * ts)}" height="${f1(kh - 12 * ts)}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>`;
  key += `<text class="key-title" x="${f1(kx + kw / 2)}" y="${f1(ky + fs(40))}" style="font-size:${fs(27)}px;letter-spacing:${fs(6)}px">The Sixty-five Tirths</text>`;
  key += ornamentRule(kx + kw / 2, ky + fs(52), fs(110), ts);
  STOPS.forEach((s, i) => {
    const col = i < rows ? 0 : 1, row = i % rows;
    const x = kx + fs(22) + col * (kw / 2), y = ky + head + fs(8) + row * lh;
    key += `<text class="key-n" x="${f1(x + fs(22))}" y="${f1(y)}" style="font-size:${keySize}px">${s.n}.</text>`;
    key += `<text class="key-t" x="${f1(x + fs(30))}" y="${f1(y)}" style="font-size:${keySize}px">${esc(s.name)}${s.alt ? `<tspan class="key-alt"> (${esc(s.alt)})</tspan>` : ''}</text>`;
  });

  // --- scale bar ---
  let scale = '';
  for (let i = 0; i < 5; i++) scale += `<rect x="${f1(sx + (i * k500) / 5)}" y="${f1(sy)}" width="${f1(k500 / 5)}" height="${f1(7 * ts)}" fill="${i % 2 ? C.key : C.ink}" stroke="${C.ink}" stroke-width="${f1(0.8 * ts)}"/>`;
  scale += [0, 250, 500].map((v) => `<text class="deg" x="${f1(sx + (v / 500) * k500)}" y="${f1(sy - fs(7))}" style="font-size:${fs(15)}px">${v}</text>`).join('');
  scale += `<text class="scale-t" x="${f1(sx + k500 / 2)}" y="${f1(sy + fs(30))}" style="font-size:${fs(16)}px">Kilometres (at 20° N)</text>`;

  // --- graticule + water-lining ---
  let grat = '';
  for (let lon = 70; lon <= 95; lon += 5) grat += `M${f1(px(lon))},${f1(F.y)}V${f1(bottom)}`;
  for (let lat = 10; lat <= 35; lat += 5) grat += `M${f1(F.x)},${f1(py(lat))}H${f1(F.x + F.w)}`;
  let waterLines = '';
  for (let i = 8; i >= 1; i--) {
    const wd = i * 7 * k;
    waterLines += `<path d="${land}" fill="none" stroke="${C.water}" stroke-opacity="${(0.16 + 0.1 * (9 - i) / 8).toFixed(3)}" stroke-width="${f1(wd)}" stroke-linejoin="round"/>`;
    waterLines += `<path d="${land}" fill="none" stroke="${C.seaLine}" stroke-width="${f1(wd - 1.7 * k)}" stroke-linejoin="round"/>`;
  }

  const midX = W / 2;
  const rel = rel_(reliefData, px, py);
  const titleSize = fs(150 * face.scale);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${fmt.w}in" height="${fmt.h}in" id="chart">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.6 -0.14"/>
    </filter>
    <filter id="mottle" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.0042 / k).toFixed(5)}" numOctaves="4" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.28  0 0 0 0 0.12  0 0 0 0.62 -0.2"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="58%" stop-color="#5a3b16" stop-opacity="0"/>
      <stop offset="100%" stop-color="#5a3b16" stop-opacity="0.42"/>
    </radialGradient>
    <clipPath id="frame"><rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}"/></clipPath>
    <clipPath id="land"><path d="${land}"/></clipPath>
    <style>
      text { font-family: 'IM Fell English', Georgia, serif; fill: ${C.ink}; }
      .eyebrow, .facts, .range, .region, .key-title, .rose-n, .chron-h, .chron-r { font-family: 'IM Fell English SC', 'IM Fell English', Georgia, serif; }
      .eyebrow { text-anchor: middle; }
      .title { font-family: ${face.family}; font-weight: ${face.weight}; text-anchor: middle; }
      .subtitle { font-style: italic; text-anchor: middle; }
      .facts { text-anchor: middle; fill: ${C.ink2}; }
      .sea { font-style: italic; text-anchor: middle; fill: ${C.water}; }
      .range, .region { text-anchor: middle; fill: #4b321c; }
      .region.big { opacity: 0.85; }
      .num { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 700; text-anchor: middle; }
      .num.end { fill: ${C.key}; }
      .place { font-style: italic; paint-order: stroke; stroke: ${C.paper}; stroke-width: ${fs(5)}px; stroke-linejoin: round; }
      .place.minor { fill: ${C.ink2}; stroke-width: ${fs(4)}px; }
      .annot { font-style: italic; fill: ${C.red}; paint-order: stroke; stroke: ${C.paper}; stroke-width: ${fs(5)}px; }
      .deg { text-anchor: middle; fill: ${C.ink2}; }
      .key-title { text-anchor: middle; }
      .key-n { text-anchor: end; }
      .key-alt { font-style: italic; fill: #54412e; }
      .scale-t { font-style: italic; text-anchor: middle; }
      .rose-n { text-anchor: middle; }
      .legend { font-style: italic; }
      .credit { fill: #54412e; }
      .colophon { font-style: italic; text-anchor: middle; fill: ${C.ink2}; }
      .chron-h { text-anchor: middle; }
      .chron-r { text-anchor: middle; fill: #4b321c; }
      .chron-y { text-anchor: middle; fill: ${C.ink2}; }
      .chron-n { font-style: italic; fill: ${C.red}; }
      .chron-f { font-style: italic; text-anchor: middle; fill: #54412e; }
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <rect width="${W}" height="${H}" filter="url(#mottle)"/>

  ${border(W, H, k)}

  <text class="eyebrow" x="${midX}" y="${f1(yEyebrow)}" style="font-size:${fs(30)}px;letter-spacing:${fs(14)}px">A Chart of the Pilgrimage called</text>
  <text class="title" x="${midX}" y="${f1(yTitle)}" style="font-size:${titleSize}px;letter-spacing:${f1(face.track * ts)}px">Van Vicharan</text>
  <text class="subtitle" x="${midX}" y="${f1(ySub)}" style="font-size:${fs(38)}px">The forest journey of Nilkanth Varni, from Ayodhya to Loj</text>
  ${ornamentRule(midX, yRule, fs(330), ts)}
  <text class="facts" x="${midX}" y="${f1(yFacts)}" style="font-size:${fs(25)}px;letter-spacing:${fs(5)}px">1792 · sixty-five tirths · seven years, one month &amp; eleven days · 1799</text>

  <g clip-path="url(#frame)">
    <rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" fill="${C.sea}"/>
    ${waterLines}
    <g clip-path="url(#land)">
      <image href="${rel.href}" x="${f1(rel.x)}" y="${f1(rel.y)}" width="${f1(rel.w)}" height="${f1(rel.h)}" preserveAspectRatio="none"/>
    </g>
    <path d="${grat}" fill="none" stroke="${C.ink}" stroke-opacity="0.24" stroke-width="${f1(0.8 * k)}"/>
    <path d="${rivers}" fill="none" stroke="${C.water}" stroke-width="${f1(1.5 * k)}" stroke-opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${land}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.6 * k)}" stroke-linejoin="round"/>
    ${areas}
    <path d="${routeD}" fill="none" stroke="${C.paper}" stroke-width="${f1(8 * ts)}" stroke-linejoin="round" stroke-opacity="0.92"/>
    <path d="${routeD}" fill="none" stroke="${C.red}" stroke-width="${f1(3 * ts)}" stroke-dasharray="${f1(11 * ts)} ${f1(6 * ts)}" stroke-linejoin="round"/>
    ${marks}
    ${names}
    ${annots}
    ${compassRose(rcx, rcy, roseR, ts)}
    ${scale}
    ${key}
  </g>
  ${neatline(F, px, py, k, fs)}

  <g transform="translate(${f1(F.x)}, ${f1(yLegend)})">
    <line x1="0" y1="0" x2="${fs(56)}" y2="0" stroke="${C.red}" stroke-width="${f1(3 * ts)}" stroke-dasharray="${f1(11 * ts)} ${f1(6 * ts)}"/>
    <text class="legend" x="${fs(68)}" y="${fs(6)}" style="font-size:${fs(19)}px">The route as charted</text>
    <circle cx="${fs(340)}" cy="0" r="${f1(R)}" fill="${C.key}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/><text class="num" x="${fs(340)}" y="${f1(R * 0.36)}" style="font-size:${fs(12.5)}px">7</text>
    <text class="legend" x="${fs(362)}" y="${fs(6)}" style="font-size:${fs(19)}px">Tirth, numbered as in the key</text>
    <circle cx="${fs(700)}" cy="0" r="${f1(R)}" fill="${C.red}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/><text class="num end" x="${fs(700)}" y="${f1(R * 0.36)}" style="font-size:${fs(12.5)}px">1</text>
    <text class="legend" x="${fs(722)}" y="${fs(6)}" style="font-size:${fs(19)}px">Beginning &amp; end of the journey</text>
  </g>
  <text class="colophon" x="${midX}" y="${f1(yColophon)}" style="font-size:${fs(21)}px">Departed Ayodhya on Ashadh sud 10, Samvat 1849 · Arrived at Loj on Shravan vad 6, Samvat 1856</text>
  ${chronicle(F.x, yColophon + fs(36), F.w, chronH - fs(20), fs, ts)}
  <text class="credit" x="${f1(F.x)}" y="${f1(yCredit)}" style="font-size:${fs(13.5)}px">Relief engraved from Mapzen Terrain Tiles · Coastlines &amp; rivers: Natural Earth · Positions of tirths are approximate</text>
  <text class="credit" x="${f1(F.x + F.w)}" y="${f1(yCredit)}" text-anchor="end" style="font-size:${fs(13.5)}px">${esc(fmt.label)} · Mercator projection · Drawn ${new Date().getFullYear()}</text>

  <rect width="${W}" height="${H}" fill="url(#vignette)" pointer-events="none"/>
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="0.45" pointer-events="none"/>
</svg>`;
}

// relief image placement in this sheet's map units
function rel_(rel, px, py) {
  return { href: rel.href, x: px(rel.lon0), y: py(rel.lat1), w: px(rel.lon1) - px(rel.lon0), h: py(rel.lat0) - py(rel.lat1) };
}

// ---------- Ornaments ----------
function ornamentRule(cx, y, half, ts) {
  const d = 5 * ts, g = 16 * ts;
  return `<g stroke="${C.ink}" fill="${C.ink}">
    <line x1="${f1(cx - half)}" y1="${f1(y)}" x2="${f1(cx - g)}" y2="${f1(y)}" stroke-width="${f1(0.9 * ts)}"/>
    <line x1="${f1(cx + g)}" y1="${f1(y)}" x2="${f1(cx + half)}" y2="${f1(y)}" stroke-width="${f1(0.9 * ts)}"/>
    <polygon points="${f1(cx)},${f1(y - d)} ${f1(cx + d)},${f1(y)} ${f1(cx)},${f1(y + d)} ${f1(cx - d)},${f1(y)}"/>
    <circle cx="${f1(cx - g + 4 * ts)}" cy="${f1(y)}" r="${f1(1.6 * ts)}"/><circle cx="${f1(cx + g - 4 * ts)}" cy="${f1(y)}" r="${f1(1.6 * ts)}"/>
    <circle cx="${f1(cx - half)}" cy="${f1(y)}" r="${f1(2 * ts)}"/><circle cx="${f1(cx + half)}" cy="${f1(y)}" r="${f1(2 * ts)}"/>
  </g>`;
}

function border(W, H, k) {
  const o = 38 * k, i = 50 * k, c = 20 * k;
  let g = `<rect x="${f1(o)}" y="${f1(o)}" width="${f1(W - 2 * o)}" height="${f1(H - 2 * o)}" fill="none" stroke="${C.ink}" stroke-width="${f1(3.2 * k)}"/>`;
  g += `<rect x="${f1(i)}" y="${f1(i)}" width="${f1(W - 2 * i)}" height="${f1(H - 2 * i)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1 * k)}"/>`;
  // corner rosettes between the two rules
  for (const [x, y] of [[(o + i) / 2, (o + i) / 2], [W - (o + i) / 2, (o + i) / 2], [(o + i) / 2, H - (o + i) / 2], [W - (o + i) / 2, H - (o + i) / 2]]) {
    g += `<rect x="${f1(x - c / 2)}" y="${f1(y - c / 2)}" width="${f1(c)}" height="${f1(c)}" fill="${C.paper}" stroke="${C.ink}" stroke-width="${f1(1.2 * k)}"/>`;
    g += `<polygon points="${f1(x)},${f1(y - c * 0.36)} ${f1(x + c * 0.36)},${f1(y)} ${f1(x)},${f1(y + c * 0.36)} ${f1(x - c * 0.36)},${f1(y)}" fill="${C.red}"/>`;
  }
  return g;
}

function compassRose(cx, cy, R, ts) {
  const pt = (ang, rr) => `${f1(cx + Math.sin(ang) * rr)},${f1(cy - Math.cos(ang) * rr)}`;
  let g = `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * 0.92)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.3 * ts)}"/>`;
  g += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * 0.86)}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>`;
  for (let d = 0; d < 360; d += 10) {
    const a = d * RAD;
    g += `<line x1="${f1(cx + Math.sin(a) * R * 0.86)}" y1="${f1(cy - Math.cos(a) * R * 0.86)}" x2="${f1(cx + Math.sin(a) * R * (d % 30 ? 0.82 : 0.77))}" y2="${f1(cy - Math.cos(a) * R * (d % 30 ? 0.82 : 0.77))}" stroke="${C.ink}" stroke-width="${f1(0.7 * ts)}"/>`;
  }
  for (const [rot, len, w] of [[45, 0.55, 0.09], [135, 0.55, 0.09], [225, 0.55, 0.09], [315, 0.55, 0.09], [0, 0.95, 0.13], [90, 0.8, 0.12], [180, 0.8, 0.12], [270, 0.8, 0.12]]) {
    const a = rot * RAD, tip = pt(a, R * len), l = pt(a - Math.PI / 2, R * w), r = pt(a + Math.PI / 2, R * w), c0 = `${f1(cx)},${f1(cy)}`;
    g += `<polygon points="${c0} ${tip} ${l}" fill="${C.ink}"/><polygon points="${c0} ${tip} ${r}" fill="${C.key}" stroke="${C.ink}" stroke-width="${f1(0.8 * ts)}"/>`;
  }
  g += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(R * 0.05)}" fill="${C.red}"/>`;
  g += `<text class="rose-n" x="${f1(cx)}" y="${f1(cy - R * 1.04)}" style="font-size:${f1(30 * ts)}px">N</text>`;
  return g;
}

function neatline(F, px, py, k, fs) {
  const t = 9 * k, { x, y, w, h } = F;
  let g = `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.5 * k)}"/>`;
  g += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1 * k)}"/>`;
  for (let lon = Math.ceil(EXTENT.lon0); lon < EXTENT.lon1; lon += 2) {
    const a = px(lon), b = px(Math.min(lon + 1, EXTENT.lon1));
    g += `<rect x="${f1(a)}" y="${f1(y - t)}" width="${f1(b - a)}" height="${f1(t)}" fill="${C.ink}"/><rect x="${f1(a)}" y="${f1(y + h)}" width="${f1(b - a)}" height="${f1(t)}" fill="${C.ink}"/>`;
  }
  for (let lat = Math.ceil(EXTENT.lat0); lat < EXTENT.lat1; lat += 2) {
    const a = py(Math.min(lat + 1, EXTENT.lat1)), b = py(lat);
    g += `<rect x="${f1(x - t)}" y="${f1(a)}" width="${f1(t)}" height="${f1(b - a)}" fill="${C.ink}"/><rect x="${f1(x + w)}" y="${f1(a)}" width="${f1(t)}" height="${f1(b - a)}" fill="${C.ink}"/>`;
  }
  const s = fs(15);
  for (let lon = 70; lon <= 95; lon += 5) {
    g += `<text class="deg" x="${f1(px(lon))}" y="${f1(y - t - s * 0.55)}" style="font-size:${s}px">${lon}° E</text><text class="deg" x="${f1(px(lon))}" y="${f1(y + h + t + s * 1.3)}" style="font-size:${s}px">${lon}° E</text>`;
  }
  for (let lat = 10; lat <= 35; lat += 5) {
    g += `<text class="deg" transform="translate(${f1(x - t - s * 0.6)},${f1(py(lat))}) rotate(-90)" style="font-size:${s}px">${lat}° N</text>`;
    g += `<text class="deg" transform="translate(${f1(x + w + t + s * 1.2)},${f1(py(lat))}) rotate(-90)" style="font-size:${s}px">${lat}° N</text>`;
  }
  return g;
}

// ---------- Chronicle strip (taller formats) ----------
const STAY_NOTE = { 14: 'Austerities at Muktinath · about 2½ months', 15: 'With Gopal Yogi, mastering Ashtanga Yoga · 9 months', 27: 'At Jagannath Puri · about 6 months' };

function chronicle(x, y, w, h, fsBase, ts) {
  const natural = fsBase(250);
  const c = Math.min(1.45, h / natural);
  const fs = (u) => fsBase(u * c);
  y += (h - natural * c) / 2;
  const t0 = CHRONO[1].date.getTime(), t1 = CHRONO[STOPS.length - 1].date.getTime();
  const X = (t) => x + ((t - t0) / (t1 - t0)) * w;
  const yHead = y + fs(26), yBand = yHead + fs(26), bandH = fs(30), yAxis = yBand + bandH + fs(10);
  let g = `<text class="chron-h" x="${f1(x + w / 2)}" y="${f1(yHead)}" style="font-size:${fs(26)}px;letter-spacing:${fs(6)}px">A Chronicle of the Journey</text>`;

  // region bands
  const runs = [];
  STOPS.forEach((s, i) => { const r = runs[runs.length - 1]; if (r && r.region === s.region) r.end = i; else runs.push({ region: s.region, start: i, end: i }); });
  runs.forEach((r, k) => {
    const a = X(CHRONO[Math.max(1, r.start)].date.getTime());
    const b = k < runs.length - 1 ? X(CHRONO[runs[k + 1].start].date.getTime()) : x + w;
    g += `<rect x="${f1(a)}" y="${f1(yBand)}" width="${f1(Math.max(0, b - a))}" height="${f1(bandH)}" fill="${C.ink}" fill-opacity="${k % 2 ? 0.05 : 0.12}" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>`;
    const label = REGION_SHORT[r.region];
    if (textWidth(label, FELL_SC, fs(15), fs(2)) < b - a - fs(8)) {
      g += `<text class="chron-r" x="${f1((a + b) / 2)}" y="${f1(yBand + bandH * 0.66)}" style="font-size:${fs(15)}px;letter-spacing:${fs(2)}px">${esc(label)}</text>`;
    }
  });

  // axis with years
  g += `<line x1="${f1(x)}" y1="${f1(yAxis)}" x2="${f1(x + w)}" y2="${f1(yAxis)}" stroke="${C.ink}" stroke-width="${f1(1.2 * ts)}"/>`;
  const endW = textWidth('21 August 1799', FELL, fs(15)) + fs(30);   // keep year labels clear of the end dates
  for (let yr = 1793; yr <= 1799; yr++) {
    const xx = X(Date.UTC(yr, 0, 1));
    g += `<line x1="${f1(xx)}" y1="${f1(yAxis - fs(6))}" x2="${f1(xx)}" y2="${f1(yAxis + fs(6))}" stroke="${C.ink}" stroke-width="${f1(1 * ts)}"/>`;
    if (xx - x > endW && x + w - xx > endW) g += `<text class="chron-y" x="${f1(xx)}" y="${f1(yAxis + fs(26))}" style="font-size:${fs(17)}px">${yr}</text>`;
  }
  g += `<text class="chron-y" x="${f1(x)}" y="${f1(yAxis + fs(26))}" style="font-size:${fs(15)}px;text-anchor:start">29 June 1792</text>`;
  g += `<text class="chron-y" x="${f1(x + w)}" y="${f1(yAxis + fs(26))}" style="font-size:${fs(15)}px;text-anchor:end">21 August 1799</text>`;

  // long stays: crimson bars on the axis, captions staggered below
  let row = 0;
  for (const n of [14, 15, 27]) {
    const c = CHRONO[n - 1], a = X(c.date.getTime()), b = X(c.date.getTime() + c.stay * 86400000);
    g += `<rect x="${f1(a)}" y="${f1(yAxis - fs(4))}" width="${f1(b - a)}" height="${fs(8)}" fill="${C.red}"/>`;
    const yy = yAxis + fs(54) + row * fs(24);
    g += `<line x1="${f1((a + b) / 2)}" y1="${f1(yAxis + fs(5))}" x2="${f1((a + b) / 2)}" y2="${f1(yy - fs(15))}" stroke="${C.red}" stroke-width="${f1(0.7 * ts)}"/>`;
    g += `<text class="chron-n" x="${f1((a + b) / 2 + fs(4))}" y="${f1(yy)}" style="font-size:${fs(16)}px">${esc(STAY_NOTE[n])}</text>`;
    row = (row + 1) % 2;
  }
  {
    g += `<text class="chron-f" x="${f1(x + w / 2)}" y="${f1(yAxis + fs(54) + fs(24) + fs(42))}" style="font-size:${fs(15)}px">Dates between Ayodhya and Loj are estimated from the distances walked and the stays recorded in his biographies.</text>`;
  }
  return g;
}

// ---------- Fonts embedded for the SVG download ----------
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=IM+Fell+English+SC&family=Cormorant+Garamond:wght@600;700&family=Bodoni+Moda:opsz,wght@6..96,500&family=Pinyon+Script&display=block';
export async function embedFonts(svg) {
  const chars = [...new Set(svg.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&'))].join('');
  const css = await (await fetch(`${FONT_CSS}&text=${encodeURIComponent(chars + '0123456789.,·°&()–-')}`)).text();
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  let out = css;
  for (const u of urls) {
    const buf = await (await fetch(u)).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out = out.replace(u, `data:font/woff2;base64,${btoa(bin)}`);
  }
  return svg.replace('<style>', `<style>${out}\n`);
}
