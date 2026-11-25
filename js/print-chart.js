// ---------- Old chart: pen-and-ink furniture for the explorer's-chart style ----------
// Peaks with hatched shadow faces, forests of clustered crowns, rhumb lines from the rose,
// sailing ships and sea serpents in the open sea, and a torn, stained, folded sheet.
// Everything is drawn from position hashes, so the same sheet comes out the same every time.
import { kit } from './print.js';

const hash = (a, b) => {
  let h = (Math.round(a * 1e4) * 374761393 + Math.round(b * 1e4) * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- Forests ----------
// Where the old charts drew dense woods: central India, the Western Ghats, the Eastern Ghats,
// the Terai, the hills of the north-east and Burma, the Sundarbans, the wet south-west of Lanka
const ELLIPSES = [[81.6, 22.1, 4.6, 2.7], [83.4, 19.2, 2, 1.8], [84.5, 27.4, 4.6, 0.9], [93.2, 25.6, 3.4, 2.2],
  [96, 21, 2.4, 4], [89, 21.9, 1, 0.55], [80.4, 6.9, 0.8, 0.7], [76.8, 11.4, 0.9, 1.1]];
function ghatsLon(lat) { return lat >= 15 ? 73.5 + (19 - lat) * 0.18 : 74.2 + (15 - lat) * 0.5; }
export function inForest(lon, lat) {
  if (lat > 8.3 && lat < 21 && Math.abs(lon - ghatsLon(lat)) < 0.75) return true;
  return ELLIPSES.some(([x, y, rx, ry]) => ((lon - x) / rx) ** 2 + ((lat - y) / ry) ** 2 < 1);
}

// ---------- Ink motifs ----------
export function inkMotifs(items, ts) {
  const { C, f1: L } = kit;
  const sw = L(0.85 * ts), fine = L(0.5 * ts);
  // Forest clusters are spread into single crowns first, then everything is drawn back to front
  const all = [];
  for (const m of items) {
    if (m.t !== 'tree' && m.t !== 'cypress') { all.push(m); continue; }
    const dense = inForest(m.lon, m.lat), cluster = dense || hash(m.lon, m.lat) < 0.18;
    if (!cluster) { if (hash(m.lat, m.lon) < 0.5) all.push({ ...m, t: 'crown', s: m.s * 0.95 }); continue; }   // open country: a tree here and there
    const n = dense ? 9 : 5, rad = 11 * ts * m.s;
    for (let i = 0; i < n; i++) {
      const r1 = hash(m.lon + i, m.lat), r2 = hash(m.lat - i, m.lon + 3);
      const a = i * 2.4 + r1, d = rad * Math.sqrt((i + 0.5) / n);
      all.push({ t: 'crown', x: m.x + Math.cos(a) * d * 1.3, y: m.y + Math.sin(a) * d * 0.75, s: m.s * (0.7 + 0.25 * r2), lon: m.lon + i, lat: m.lat, dark: dense });
    }
  }
  all.sort((a, b) => a.y - b.y);

  let g = '';
  for (const m of all) {
    const { x, y } = m;
    if (m.t === 'peak') {
      const s = 15 * ts * m.s, r = hash(m.lon, m.lat), h = s * (1.2 + 0.45 * r), tx = x + (hash(m.lat, m.lon) - 0.5) * s * 0.3, top = y - h;
      const snow = m.e > 4000 || m.s > 1.25;
      const sh1 = [x + s * 0.34, y - h * 0.52], sh2 = [x + s * 0.5, y - h * 0.47], lf = [x - s * 0.52, y - h * 0.44], lf2 = [x - s * 0.4, y - h * 0.4];
      const P = (p) => `${L(p[0])},${L(p[1])}`;
      g += `<path d="M${L(x - s)},${L(y)} L${P(lf)} L${P(lf2)} L${L(tx)},${L(top)} L${P(sh1)} L${P(sh2)} L${L(x + s)},${L(y)} Z" fill="${snow ? C.snow : C.peak}" stroke="${C.ink}" stroke-width="${sw}" stroke-linejoin="round"/>`;
      // the shadow face: toned, with hatching that runs down the slope
      const base = [x + s * 0.06, y];
      g += `<path d="M${L(tx)},${L(top)} L${P(sh1)} L${P(sh2)} L${L(x + s)},${L(y)} L${P(base)} Q${L(x - s * 0.08)},${L(y - h * 0.5)} ${L(tx)},${L(top)} Z" fill="${C.ink3}" fill-opacity="${snow ? 0.22 : 0.3}"/>`;
      let hatch = '';
      for (let i = 1; i <= 6; i++) {
        const t = i / 7, ax = tx + (base[0] - tx) * t, ay = top + (base[1] - top) * t;
        const len = (1 - t * 0.6) * s * 0.55;
        hatch += `M${L(ax + s * 0.04)},${L(ay)} l${L(len * 0.72)},${L(len * 0.7)}`;
      }
      g += `<path d="${hatch}" fill="none" stroke="${C.ink}" stroke-width="${fine}" stroke-opacity="0.75"/>`;
      // the ridge from the summit, and a stroke or two of scree on the lit side
      g += `<path d="M${L(tx)},${L(top)} Q${L(x - s * 0.08)},${L(y - h * 0.5)} ${P(base)} M${L(x - s * 0.62)},${L(y - h * 0.18)} l${L(s * 0.16)},${L(-h * 0.08)} M${L(x - s * 0.34)},${L(y - h * 0.28)} l${L(s * 0.12)},${L(-h * 0.07)}" fill="none" stroke="${C.ink}" stroke-width="${fine}"/>`;
    } else if (m.t === 'hill') {
      const s = 11 * ts * m.s, h = s * 0.8;
      g += `<path d="M${L(x - s)},${L(y)} C${L(x - s * 0.6)},${L(y - h * 1.3)} ${L(x + s * 0.5)},${L(y - h * 1.3)} ${L(x + s)},${L(y)} Z" fill="${C.peak}" stroke="${C.ink}" stroke-width="${sw}"/>`;
      g += `<path d="M${L(x + s * 0.2)},${L(y - h * 0.8)} l${L(s * 0.25)},${L(h * 0.35)} M${L(x + s * 0.42)},${L(y - h * 0.55)} l${L(s * 0.24)},${L(h * 0.3)} M${L(x + s * 0.62)},${L(y - h * 0.28)} l${L(s * 0.18)},${L(h * 0.22)}" fill="none" stroke="${C.ink}" stroke-width="${fine}" stroke-opacity="0.75"/>`;
    } else if (m.t === 'crown') {
      const s = 7.5 * ts * m.s, cy = y - s * 1.1;
      g += `<line x1="${L(x)}" y1="${L(y)}" x2="${L(x)}" y2="${L(cy)}" stroke="${C.ink}" stroke-width="${L(0.9 * ts)}"/>`;
      g += `<circle cx="${L(x)}" cy="${L(cy)}" r="${L(s * 0.72)}" fill="${m.dark ? C.forest2 : C.forest}" stroke="${C.ink}" stroke-width="${L(0.7 * ts)}"/>`;
      g += `<path d="M${L(x + s * 0.62)},${L(cy - s * 0.3)} A${L(s * 0.66)},${L(s * 0.66)} 0 0 1 ${L(x - s * 0.3)},${L(cy + s * 0.58)}" fill="none" stroke="${C.ink}" stroke-opacity="0.55" stroke-width="${L(0.9 * ts)}"/>`;
    }
  }
  return `<g class="motifs">${g}</g>`;
}

// ---------- Rhumb lines ----------
// 32 lines out of each node, the cardinal and half-cardinal ones a little darker
export function rhumbLines(nodes, F, ts) {
  const { C, f1: L, RAD } = kit;
  const len = Math.hypot(F.w, F.h) * 1.2;
  let thin = '', bold = '';
  for (const [cx, cy] of nodes) {
    for (let i = 0; i < 32; i++) {
      const a = i * 11.25 * RAD, d = `M${L(cx)},${L(cy)}L${L(cx + Math.sin(a) * len)},${L(cy - Math.cos(a) * len)}`;
      if (i % 4 === 0) bold += d; else thin += d;
    }
  }
  return `<path d="${thin}" fill="none" stroke="${C.ink}" stroke-opacity="0.16" stroke-width="${L(0.6 * ts)}"/>
    <path d="${bold}" fill="none" stroke="${C.ink}" stroke-opacity="0.28" stroke-width="${L(0.9 * ts)}"/>
    ${nodes.slice(1).map(([x, y]) => `<circle cx="${L(x)}" cy="${L(y)}" r="${L(3 * ts)}" fill="${C.ink}" fill-opacity="0.5"/>`).join('')}`;
}

// ---------- Ships and serpents ----------
const inRing = (ring, lon, lat) => {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// Is a sheet point on land? (unproj maps sheet units back to lon/lat)
export function landTest(unproj) {
  const { LAND } = kit;
  const boxes = LAND.map((r) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); c = Math.max(c, r[i]); b = Math.min(b, r[i + 1]); d = Math.max(d, r[i + 1]); } return [a, b, c, d]; });
  return (x, y) => {
    const [lon, lat] = unproj(x, y);
    return LAND.some((r, i) => { const b = boxes[i]; return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && inRing(r, lon, lat); });
  };
}
// Is any of a box (sampled on a grid about every `step` units) on land?
export function boxOnLand(isLand, [x0, y0, x1, y1], step) {
  const nx = Math.max(2, Math.ceil((x1 - x0) / step)), ny = Math.max(2, Math.ceil((y1 - y0) / step));
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) if (isLand(x0 + (i / nx) * (x1 - x0), y0 + (j / ny) * (y1 - y0))) return true;
  return false;
}

// Open-sea spots clear of the coast, labels, stops and route: a ship or two and a serpent or two
export function seaBeasts(F, unproj, avoid, discs, routePts, ts) {
  const isLand = landTest(unproj);
  const hw = 100 * ts, hh = 56 * ts, margin = 22 * ts;
  const clear = (x, y) => {
    const box = [x - hw, y - hh * 1.4, x + hw, y + hh * 0.4];
    if (box[0] < F.x + margin || box[2] > F.x + F.w - margin || box[1] < F.y + margin || box[3] > F.y + F.h - margin) return false;
    if (avoid.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) return false;
    if (discs.some((d) => d.x > box[0] - 30 * ts && d.x < box[2] + 30 * ts && d.y > box[1] - 30 * ts && d.y < box[3] + 30 * ts)) return false;
    if (routePts.some(([px, py]) => px > box[0] - 20 * ts && px < box[2] + 20 * ts && py > box[1] - 20 * ts && py < box[3] + 20 * ts)) return false;
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 3; j++) {
      if (isLand(box[0] - margin + (i / 4) * (box[2] - box[0] + 2 * margin), box[1] - margin + (j / 3) * (box[3] - box[1] + 2 * margin))) return false;
    }
    return true;
  };
  const step = 40 * ts, cands = [];
  for (let y = F.y + hh * 1.5; y < F.y + F.h - hh; y += step) for (let x = F.x + hw; x < F.x + F.w - hw; x += step) cands.push([x, y, hash(x / ts, y / ts)]);
  cands.sort((a, b) => a[2] - b[2]);
  const picks = [], far = Math.min(F.w, F.h) * 0.24;
  for (const [x, y] of cands) {
    if (picks.length >= 5) break;
    if (picks.some(([px, py]) => Math.hypot(px - x, py - y) < far)) continue;
    if (clear(x, y)) picks.push([x, y]);
  }
  // serpents in the second and fourth spots; ships face away from the nearest frame edge
  return picks.map(([x, y], i) => {
    const dir = x < F.x + F.w / 2 ? 1 : -1;
    return i === 1 || i === 3 ? serpent(x, y, 0.85 * ts, dir) : ship(x, y, 0.75 * ts, dir);
  }).join('');
}

function waves(x0, x1, y, amp, stroke, w) {
  let d = `M${x0},${y}`;
  for (let x = x0; x < x1; x += amp * 4) d += ` q${amp},${-amp * 0.7} ${amp * 2},0 q${amp},${amp * 0.7} ${amp * 2},0`;
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

// A three-masted ship under sail, in local units about 110 wide, waterline at y = 0
// (stroke widths are local units too, so they scale with the ship)
function ship(x, y, sc, dir) {
  const { C, f1: L } = kit;
  const sail = (mx, top, hw, hh) => `<path d="M${mx - hw},${top} C${mx - hw + 3},${top + hh * 0.5} ${mx - hw + 3},${top + hh * 0.85} ${mx - hw + 5},${top + hh} Q${mx},${top + hh + 6} ${mx + hw - 5},${top + hh} C${mx + hw - 3},${top + hh * 0.85} ${mx + hw - 3},${top + hh * 0.5} ${mx + hw},${top} Z" fill="${C.sail}" stroke="${C.ink}" stroke-width="1.1"/>
    <path d="M${mx + hw * 0.25},${top + 3} C${mx + hw * 0.45},${top + hh * 0.5} ${mx + hw * 0.45},${top + hh * 0.8} ${mx + hw * 0.3},${top + hh}" fill="none" stroke="${C.ink}" stroke-width="0.6" stroke-opacity="0.6"/>
    <line x1="${mx - hw - 2}" y1="${top}" x2="${mx + hw + 2}" y2="${top}" stroke="${C.ink}" stroke-width="1.4"/>`;
  let g = '';
  // rigging behind the sails
  g += `<path d="M-44,-20 L-22,-78 L2,-98 L24,-84 L62,-40 M-44,-20 L2,-98 M24,-84 L46,-26" fill="none" stroke="${C.ink}" stroke-width="0.6" stroke-opacity="0.7"/>`;
  for (const [mx, hgt] of [[-22, 62], [2, 82], [24, 68]]) g += `<line x1="${mx}" y1="-16" x2="${mx}" y2="${-16 - hgt}" stroke="${C.ink}" stroke-width="1.6"/>`;
  g += `<line x1="44" y1="-24" x2="64" y2="-40" stroke="${C.ink}" stroke-width="1.4"/>`;
  g += `<path d="M62,-39 L25,-80 L30,-30 Z" fill="${C.sail}" stroke="${C.ink}" stroke-width="1"/>`;
  g += sail(-22, -74, 12, 20) + sail(-22, -50, 14, 20) + sail(2, -94, 14, 22) + sail(2, -68, 17, 26) + sail(24, -80, 12, 20) + sail(24, -56, 15, 24);
  g += `<path d="M2,-98 L16,-95 L2,-91 Z M-22,-78 L-12,-76 L-22,-73 Z" fill="${C.red}" stroke="${C.ink}" stroke-width="0.6"/>`;
  // the hull: high stern castle, a gunwale stripe, gun ports
  g += `<path d="M-50,-26 L-46,-34 L-34,-32 L-32,-18 L32,-18 L46,-26 L50,-22 C46,-10 40,0 28,2 L-36,2 C-46,-4 -50,-14 -50,-26 Z" fill="${C.hull}" stroke="${C.ink}" stroke-width="1.3" stroke-linejoin="round"/>`;
  g += `<path d="M-46,-14 C-20,-12 20,-12 44,-14" fill="none" stroke="${C.sail}" stroke-width="1.6" stroke-opacity="0.85"/>`;
  for (let i = -36; i <= 30; i += 11) g += `<rect x="${i}" y="-9" width="4" height="3.4" fill="${C.ink}"/>`;
  g += `<path d="M-46,-24 h12 M-46,-29 h12" stroke="${C.ink}" stroke-width="0.6"/>`;
  // the sea it rides on
  g += waves(-62, 62, 4, 4, C.ink, 0.9) + waves(-44, 40, 10, 3, C.ink, 0.6);
  g += `<path d="M-70,8 h8 M66,6 h10 M-20,16 h12 M18,15 h8" stroke="${C.ink}" stroke-width="0.6"/>`;
  return `<g transform="translate(${L(x)} ${L(y)}) scale(${(sc * dir).toFixed(3)} ${sc.toFixed(3)})">${g}</g>`;
}

// A sea serpent: three coils breaking the water, a horned head with open jaws, a forked tail
function serpent(x, y, sc, dir) {
  const { C, f1: L } = kit;
  const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]); };
  let g = '', fins = '', scales = '', ripples = '';
  for (const [cx, hw, h] of [[-52, 12, 19], [-20, 14, 26], [14, 13, 21]]) {
    const t = 7, a = cx - hw, b = cx + hw, k = 1.33;
    g += `<path d="M${a},0 C${a},${-h * k} ${b},${-h * k} ${b},0 L${b - t},0 C${b - t},${-h * k + t * 1.5} ${a + t},${-h * k + t * 1.5} ${a + t},0 Z" fill="${C.beast}" stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
    // spines along the crest
    for (let s = 0.2; s <= 0.8; s += 0.15) {
      const p = bez([a, 0], [a, -h * k], [b, -h * k], [b, 0], s), q = bez([a, 0], [a, -h * k], [b, -h * k], [b, 0], s + 0.07);
      const nx = (p[0] - cx) / hw, ny = -1;
      const n = Math.hypot(nx, ny);
      fins += `M${L(p[0])},${L(p[1])} L${L((p[0] + q[0]) / 2 + (nx / n) * 5 - 2)},${L((p[1] + q[1]) / 2 + (ny / n) * 5)} L${L(q[0])},${L(q[1])}`;
    }
    const m = t / 2;
    scales += `M${a + m},0 C${a + m},${-h * k + m * 1.4} ${b - m},${-h * k + m * 1.4} ${b - m},0`;
    ripples += `M${a - 8},1.5 q3,-2.5 6,0 M${b + 2},1.5 q3,-2.5 6,0`;
  }
  // neck and head rising at the front, tail at the back
  g += `<path d="M36,0 C33,-24 44,-44 60,-47 L76,-45 L86,-39 L74,-37 L82,-30 L66,-33 C57,-31 50,-20 50,0 Z" fill="${C.beast}" stroke="${C.ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
  g += `<path d="M42,-4 C40,-22 48,-36 60,-40" fill="none" stroke="${C.beastHi}" stroke-width="2.2" stroke-linecap="round"/>`;
  g += `<path d="M58,-47 L50,-60 L63,-48 M66,-47 L62,-58 L70,-46" fill="${C.beast}" stroke="${C.ink}" stroke-width="1" stroke-linejoin="round"/>`;
  fins += 'M36,-14 L28,-20 L35,-22 M38,-25 L30,-33 L41,-32 M44,-36 L38,-46 L50,-42';
  g += `<circle cx="65" cy="-42" r="1.8" fill="${C.ink}"/><path d="M74,-37 L80,-34" stroke="${C.red}" stroke-width="1.4"/>`;
  g += `<path d="M86,-39 q8,-2 12,4 M86,-39 q6,4 4,10" fill="none" stroke="${C.red}" stroke-width="0.9"/>`;
  g += `<path d="M-72,0 C-74,-16 -82,-26 -94,-27 C-88,-20 -83,-10 -81,0 Z M-93,-27 L-112,-40 L-104,-25 L-114,-13 Z" fill="${C.beast}" stroke="${C.ink}" stroke-width="1.1" stroke-linejoin="round"/>`;
  ripples += 'M-86,1.5 q3,-2.5 6,0 M-70,1.5 q3,-2.5 6,0 M28,1.5 q3,-2.5 6,0 M52,1.5 q3,-2.5 6,0';
  g += `<path d="${fins}" fill="${C.beastHi}" stroke="${C.ink}" stroke-width="0.8" stroke-linejoin="round"/>`;
  g += `<path d="${scales}" fill="none" stroke="${C.beastHi}" stroke-width="1.2" stroke-dasharray="2 2.6"/>`;
  g += `<path d="${ripples}" fill="none" stroke="${C.ink}" stroke-width="0.8" stroke-linecap="round"/>`;
  g += waves(-96, 70, 11, 3, C.ink, 0.5);
  return `<g transform="translate(${L(x)} ${L(y)}) scale(${(sc * dir).toFixed(3)} ${sc.toFixed(3)})">${g}</g>`;
}

// ---------- Fleur-de-lis for the rose's north point ----------
export function fleur(cx, cy, size, fill) {
  const { f1: L } = kit, s = size / 40;
  return `<g transform="translate(${L(cx)} ${L(cy)}) scale(${s.toFixed(3)})" fill="${fill}">
    <path d="M0,-40 C7,-30 8,-20 3,-11 L3,0 L-3,0 L-3,-11 C-8,-20 -7,-30 0,-40 Z"/>
    <path d="M-3,-12 C-11,-13 -19,-22 -14,-33 C-13,-25 -9,-21 -3,-20 Z M3,-12 C11,-13 19,-22 14,-33 C13,-25 9,-21 3,-20 Z"/>
    <rect x="-9" y="-13" width="18" height="4"/>
    <path d="M-3,-8 C-8,-6 -11,-2 -13,1 L-10,1 C-8,-2 -6,-4 -3,-5 Z M3,-8 C8,-6 11,-2 13,1 L10,1 C8,-2 6,-4 3,-5 Z"/></g>`;
}

// ---------- The aged sheet ----------
// Stains and fold creases over the picture, a darkened, burnt edge, and the torn outline
// with dark ground beyond it. Drawn last, under the grain.
export function agedSheet(W, H) {
  const { C, f1: L } = kit, k = W / 1800, rnd = seeded(29);
  // the torn outline: a slow wander, fine jitter, a few tears and two bitten corners
  const ph = Array.from({ length: 6 }, () => rnd() * Math.PI * 2);
  const tears = Array.from({ length: 7 }, () => [rnd(), 0.004 + rnd() * 0.01, (10 + rnd() * 18) * k]);
  const bitten = [rnd() < 0.5 ? 0 : 2, rnd() < 0.5 ? 1 : 3];
  const pts = [];
  const per = 6 * k, perim = 2 * (W + H);
  const corners = [[0, 0], [W, 0], [W, H], [0, H]];
  for (let p = 0; p < perim; p += per) {
    const u = p / perim;
    let inset = 9 * k + 5 * k * Math.sin(u * 37 + ph[0]) * Math.sin(u * 11 + ph[1]) + 3 * k * Math.sin(u * 151 + ph[2]) + 2.6 * k * rnd();
    for (const [c, wdt, depth] of tears) { const d = Math.abs(u - c); if (d < wdt) inset += depth * (1 - d / wdt); }
    let x, y, nx, ny;
    if (p < W) { x = p; y = 0; nx = 0; ny = 1; } else if (p < W + H) { x = W; y = p - W; nx = -1; ny = 0; } else if (p < 2 * W + H) { x = W - (p - W - H); y = H; nx = 0; ny = -1; } else { x = 0; y = H - (p - 2 * W - H); nx = 1; ny = 0; }
    for (const ci of bitten) { const [cx, cy] = corners[ci], d = Math.hypot(x - cx, y - cy); if (d < 70 * k) inset += (70 * k - d) * 0.55; }
    pts.push(`${L(x + nx * inset)},${L(y + ny * inset)}`);
  }
  const torn = `M${pts.join('L')}Z`;
  // coffee and water stains: rings and soft blots
  let stains = '';
  for (const [fx, fy, r] of [[0.82, 0.16, 70], [0.12, 0.62, 55], [0.9, 0.7, 46], [0.34, 0.08, 38], [0.6, 0.9, 60]]) {
    const x = W * fx, y = H * fy, rr = r * k * (0.8 + rnd() * 0.5);
    stains += `<ellipse cx="${L(x)}" cy="${L(y)}" rx="${L(rr)}" ry="${L(rr * (0.75 + rnd() * 0.3))}" fill="${C.burn}" fill-opacity="0.025" stroke="${C.burn}" stroke-opacity="0.14" stroke-width="${L(2.4 * k)}"/>`;
    if (rnd() < 0.6) stains += `<ellipse cx="${L(x + rr * 0.6)}" cy="${L(y - rr * 0.3)}" rx="${L(rr * 0.5)}" ry="${L(rr * 0.45)}" fill="${C.burn}" fill-opacity="0.025"/>`;
  }
  // creases: one fold down the middle, one across, each a dark line with a lit edge beside it
  const crease = (d, dx, dy) => `<path d="${d}" fill="none" stroke="#3a2410" stroke-opacity="0.16" stroke-width="${L(2.2 * k)}"/>
    <path d="${d}" transform="translate(${L(dx)} ${L(dy)})" fill="none" stroke="#fff8e6" stroke-opacity="0.22" stroke-width="${L(2.4 * k)}"/>`;
  return `<defs>
    <clipPath id="sheetEdge"><path d="${torn}"/></clipPath>
    <filter id="burnBlur" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${L(16 * k)}"/></filter>
    <filter id="creaseBlur" x="-1%" y="-1%" width="102%" height="102%"><feGaussianBlur stdDeviation="${L(1.4 * k)}"/></filter>
    <filter id="stainEdge" x="-10%" y="-10%" width="120%" height="120%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.02 / k).toFixed(4)}" numOctaves="2" seed="5" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="${L(22 * k)}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g filter="url(#stainEdge)" pointer-events="none">${stains}</g>
  <g filter="url(#creaseBlur)" pointer-events="none">${crease(`M${L(W / 2)},0V${H}`, 3 * k, 0)}${crease(`M0,${L(H / 2)}H${W}`, 0, 3 * k)}</g>
  <g clip-path="url(#sheetEdge)" pointer-events="none"><path d="${torn}" fill="none" stroke="${C.burn}" stroke-opacity="0.6" stroke-width="${L(44 * k)}" filter="url(#burnBlur)"/></g>
  <path d="M0,0H${W}V${H}H0Z ${torn}" fill="${C.beyond}" fill-rule="evenodd" pointer-events="none"/>
  <path d="${torn}" fill="none" stroke="#2a1608" stroke-opacity="0.75" stroke-width="${L(1.6 * k)}" pointer-events="none"/>`;
}
