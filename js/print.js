// Print edition: an antique-style chart of the journey, drawn as one SVG.
// Units are hundredths of an inch, so a sheet is (inches × 100) units on a side.
// Each format lays out in its own proportions; type is sized for viewing distance.
import { STOPS, REGIONS, REGION_SHORT } from './data/stops.js';
import { LAND, RIVERS } from './data/printdata.js';
import { buildChronology } from './chronology.js';

const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const EXTENT = { lon0: 66.5, lon1: 97.5, lat0: 5.5, lat1: 35.5 };      // Classic layout
// Route bounds plus breathing room; the Map layout grows this to fill its frame
const ROUTE_BOX = { lon0: 67.2, lon1: 98.6, lat0: 6.0, lat1: 32.8 };

export const LAYOUTS = { classic: 'Classic', map: 'Map', charan: 'Footprints', detail: 'Detail', scroll: 'Tirtha pata', mandala: 'Mandala', panorama: 'Panorama', ridges: 'Ridgelines', strip: 'Strip', profile: 'Profile', line: 'Line' };
// One line each for the chooser
export const LAYOUT_NOTES = {
  classic: 'Title, map, numbered key and a timeline of the years',
  map: 'The map fills the sheet, with every tirth named on it',
  charan: 'The whole walk traced in footprints, circling where he stayed',
  scroll: 'A pilgrim’s scroll: every tirth as a shrine, in order',
  mandala: 'The 65 tirths as lotus petals around the route',
  detail: 'One region up close, every stop named',
  panorama: 'A bird’s-eye view north to the Himalaya',
  ridges: 'The land as stacked lines that rise with the mountains',
  strip: 'The road in twelve strips, like an old road book',
  profile: 'The height of the ground along the whole walk',
  line: 'Just the route: one bold line on an open sheet',
};

// Regional detail sheets: the stops they cover (1-based, inclusive) and their title
export const DETAILS = {
  north: { label: 'Himalaya', title: 'The Himalaya & Nepal', from: 1, to: 18 },
  east: { label: 'East', title: 'Bengal, the Northeast & the Eastern Coast', from: 19, to: 29 },
  south: { label: 'South', title: 'The Tamil Country, Kerala & the Deccan', from: 30, to: 51 },
  west: { label: 'West', title: 'Maharashtra & Gujarat', from: 52, to: 65 },
};

export const FORMATS = {
  // Home printers can't print to the edge, so the test sheet sits inside ¼ in margins on Letter
  letter: { w: 8, h: 10.5, label: '8.5 × 11 in (test)', short: '8.5 × 11', page: [8.5, 11], margin: 0.25 },
  '11x17': { w: 11, h: 17, label: '11 × 17 in (tabloid)', short: '11 × 17' },
  '12x16': { w: 12, h: 16, label: '12 × 16 in', short: '12 × 16' },
  '18x24': { w: 18, h: 24, label: '18 × 24 in', short: '18 × 24' },
  '24x36': { w: 24, h: 36, label: '24 × 36 in', short: '24 × 36' },
  a2: { w: 16.54, h: 23.39, label: 'A2', short: 'A2' },
};

// Title faces: all period-appropriate for a late-18th-century chart
export const TITLE_FACES = {
  garamond: { label: 'Garamond', family: "'Cormorant Garamond', Georgia, serif", weight: 600, scale: 1.12, track: 1 },
  didone: { label: 'Didone', family: "'Bodoni Moda', 'Didot', Georgia, serif", weight: 500, scale: 0.98, track: 0 },
  copperplate: { label: 'Copperplate', family: "'Pinyon Script', cursive", weight: 400, scale: 1.3, track: 0 },
  fell: { label: 'Fell', family: "'IM Fell English', Georgia, serif", weight: 400, scale: 1, track: 2 },
};

// ---------- Map styles ----------
// Each style sets the palette (C), how the relief is tinted (ramp: elevation in metres → RGB,
// tone: ramp colour + hillshade → pixel) and the paper effects. hs is Lambertian hillshade
// from the north-west: about 0.77 on flat ground, 0 in full shadow, 1 on slopes facing the light.
// mottle/grain are [r, g, b, alpha, offset] tints for the turbulence filters.
const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const STYLES = {
  antique: {
    label: 'Antique', note: 'Engraved sepia chart, after the original printed map',
    C: { ink: '#1c120a', ink2: '#3b2a1b', ink3: '#4b321c', ink4: '#54412e', red: '#7a1c10', water: '#2c4a5a',
      paper: '#ebdab0', sea: '#d6d6c0', seaLine: '#d6d6c0', key: '#efe1bb' },
    ramp: [[0, [232, 213, 166]], [250, [226, 203, 152]], [800, [212, 182, 130]], [1800, [192, 158, 112]],
      [3200, [166, 138, 106]], [4600, [168, 154, 138]], [5600, [214, 206, 192]], [6600, [240, 236, 226]]],
    tone: (c, hs) => { const s = Math.min(1.14, 0.3 + 0.88 * hs); return [c[0] * s, c[1] * s, c[2] * s * 0.96]; },
    fx: { mottle: [0.42, 0.28, 0.12, 0.62, -0.2], grain: [0.3, 0.2, 0.1, 0.6, -0.14], grainOpacity: 0.45,
      vignette: ['#5a3b16', 0.42], waterLines: 1, grat: 0.24 },
  },
  // Tom Patterson / US National Park Service: natural-colour relief, soft shading, clean paper
  natural: {
    label: 'Natural', note: 'Natural-colour shaded relief, after Tom Patterson’s Park Service maps',
    C: { ink: '#25272b', ink2: '#474b52', ink3: '#5e4c3a', ink4: '#6b6660', red: '#c0352a', water: '#4a7c98',
      paper: '#f6f3ec', sea: '#c6dce5', seaLine: '#c6dce5', key: '#fcfbf7' },
    ramp: [[0, [160, 188, 134]], [200, [178, 198, 144]], [600, [202, 204, 158]], [1200, [214, 202, 162]],
      [2200, [198, 176, 144]], [3500, [186, 166, 140]], [4800, [196, 180, 156]], [5500, [222, 218, 212]], [6000, [248, 248, 248]], [6600, [255, 255, 255]]],
    tone: (c, hs) => { const s = Math.min(1.12, 0.58 + 0.56 * hs), cool = (1 - hs) * 14; return [c[0] * s - cool * 0.4, c[1] * s, c[2] * s + cool]; },
    fx: { mottle: null, grain: [0.4, 0.4, 0.4, 0.3, -0.1], grainOpacity: 0.2, vignette: null, waterLines: 0.55, grat: 0.14 },
  },
  // Molly O'Halloran / Ekaterina Shchekina: soft pigment washes on cold-press paper
  watercolor: {
    label: 'Watercolor', note: 'Pigment washes on cold-press paper, after Molly O’Halloran',
    C: { ink: '#2d3140', ink2: '#4a4f60', ink3: '#6a586c', ink4: '#6b6874', red: '#b4402e', water: '#5a8ea4',
      paper: '#fbf7ee', sea: '#d2e5ea', seaLine: '#d2e5ea', key: '#fdfaf3' },
    ramp: [[0, [204, 222, 176]], [300, [218, 228, 182]], [800, [238, 220, 170]], [1600, [234, 196, 158]],
      [2800, [216, 174, 168]], [4000, [190, 176, 202]], [5200, [228, 228, 238]], [6600, [250, 250, 252]]],
    tone: (c, hs) => { const s = Math.min(1.08, 0.8 + 0.32 * hs); return [c[0] * s, c[1] * s, c[2] * s]; },
    fx: { mottle: [0.3, 0.45, 0.55, 0.5, -0.16], grain: [0.35, 0.33, 0.3, 0.55, -0.12], grainOpacity: 0.35,
      vignette: null, waterLines: 0.6, grat: 0.12, wash: true },
  },
  // Daniel Huffman: sun-printed cyanotype. Everything is Prussian blue and paper white
  cyanotype: {
    label: 'Cyanotype', note: 'Sun-printed Prussian blue, after Daniel Huffman’s cyanotypes',
    C: { ink: '#f3f6fa', ink2: '#d2dfec', ink3: '#c4d6e9', ink4: '#b7cbe0', red: '#ffffff', water: '#dfe9f4',
      paper: '#1f4a7c', sea: '#1a3f6b', seaLine: '#1a3f6b', key: '#21507f' },
    ramp: [[0, [0, 0, 0]], [6600, [0, 0, 0]]],
    tone: (c, hs, e) => mixRGB([22, 54, 100], [236, 242, 249], clamp(0.06 + e / 16000 + 1.9 * (hs - 0.77), 0, 1)),
    fx: { mottle: [0.85, 0.9, 1, 0.5, -0.2], grain: [1, 1, 1, 0.7, -0.3], grainOpacity: 0.35,
      vignette: ['#0b1e38', 0.55], waterLines: 0.9, grat: 0.28 },
  },
  // Anna Eshelman's Wonderland Trail: moonlit relief with a glowing route
  night: {
    label: 'Night', note: 'Moonlit relief and a lantern-lit route, after Anna Eshelman',
    C: { ink: '#efe6cf', ink2: '#c7c0ae', ink3: '#a9b5c8', ink4: '#99a2b2', red: '#f4b942', water: '#7ea4ca',
      paper: '#101a2b', sea: '#0b1422', seaLine: '#0b1422', key: '#18243a' },
    ramp: [[0, [40, 56, 80]], [500, [46, 62, 88]], [1500, [56, 70, 96]], [3000, [72, 84, 110]],
      [4500, [92, 104, 130]], [5600, [176, 186, 206]], [6600, [222, 230, 242]]],
    tone: (c, hs) => { const s = Math.min(1.3, 0.3 + 1.05 * hs); return [c[0] * s, c[1] * s, c[2] * s]; },
    fx: { mottle: null, grain: [1, 1, 1, 0.5, -0.32], grainOpacity: 0.3, vignette: ['#000000', 0.5], waterLines: 0.8, grat: 0.16, glow: true },
  },
  // Pahari (Kangra/Guler) miniature painting: flat painted grounds, outlined hills, little
  // mountains and trees, patterned water, a lapis rule and a gold-flecked pink margin
  pahari: {
    label: 'Pahari', note: 'Painted grounds, hills and trees, after Pahari miniature painting',
    C: { ink: '#2e1a10', ink2: '#4e2c1a', ink3: '#5c3520', ink4: '#6b4a34', red: '#b8261a', water: '#1f3f5e',
      paper: '#f2e6c8', sea: '#8db0b8', seaLine: '#8db0b8', key: '#f3d27a',
      margin: '#dfa38b', lapis: '#22345c', gold: '#c49a3c', wave: '#eef4ef' },
    paint: {
      outline: 0.66,
      bands: [[0, [190, 198, 140]], [300, [170, 184, 116]], [800, [200, 180, 108]], [1600, [176, 140, 96]],
        [3000, [178, 160, 160]], [5700, [246, 241, 230]]],
    },
    fx: { mottle: [0.45, 0.3, 0.15, 0.4, -0.16], grain: [0.3, 0.2, 0.1, 0.5, -0.14], grainOpacity: 0.3,
      vignette: null, waterLines: 0.45, grat: 0, motifs: true, waves: true, frame: 'miniature' },
  },
  // Pichwai (Nathdwara temple hangings): a night-indigo ground, fields picked out in gold,
  // kadamba trees and cows, lotus ponds for the seas, a red border with a gold vine
  pichwai: {
    label: 'Pichwai', note: 'Gold on indigo, lotus ponds, kadamba trees and cows, after Nathdwara pichwais',
    C: { ink: '#f0d78c', ink2: '#e2c98a', ink3: '#d6b066', ink4: '#bfa477', red: '#ee5a3c', water: '#8cc3c0',
      paper: '#141a2e', sea: '#163a3e', seaLine: '#163a3e', key: '#2b1d3f',
      margin: '#8e1b1f', gold: '#d9b25a' },
    paint: {
      outline: 1, edge: [214, 172, 82],
      bands: [[0, [34, 66, 46]], [300, [44, 78, 50]], [800, [74, 84, 50]], [1600, [92, 72, 66]],
        [3000, [82, 80, 112]], [5700, [222, 218, 204]]],
    },
    fx: { mottle: [0.85, 0.7, 0.35, 0.22, -0.14], grain: [1, 0.85, 0.5, 0.5, -0.3], grainOpacity: 0.3,
      vignette: ['#000000', 0.45], waterLines: 0.3, grat: 0, motifs: 'pichwai', waves: 'lotus', frame: 'pichwai' },
  },
  // Kalamkari (Srikalahasti temple cloths): pen-drawn black outlines, madder red, indigo and
  // mustard on unbleached cotton; rocks, trees of life and peacocks; a paisley (buta) border
  kalamkari: {
    label: 'Kalamkari', note: 'Madder and indigo on cotton, trees of life and peacocks, after Kalamkari temple cloths',
    C: { ink: '#2a170e', ink2: '#43281a', ink3: '#5a3420', ink4: '#6e5440', red: '#a3271b', water: '#2d3f6e',
      paper: '#eedfc0', sea: '#93a2c3', seaLine: '#93a2c3', key: '#f4e4be',
      margin: '#eedfc0', indigo: '#2b3b68', madder: '#9c2a1c', mustard: '#c4952e', leaf: '#5d6a35' },
    paint: {
      outline: 1, edge: [52, 30, 20],
      bands: [[0, [234, 214, 170]], [300, [226, 196, 138]], [800, [212, 168, 104]], [1600, [184, 104, 72]],
        [3000, [168, 170, 194]], [5700, [242, 236, 222]]],
    },
    fx: { mottle: [0.5, 0.38, 0.2, 0.5, -0.16], grain: [0.35, 0.25, 0.15, 0.6, -0.14], grainOpacity: 0.4,
      vignette: ['#6b3a1a', 0.3], waterLines: 0.4, grat: 0, motifs: 'kalamkari', waves: 'kalamkari', frame: 'kalamkari' },
  },
};
// The palette the drawing helpers read; buildSheet points it at the chosen style
const C = { ...STYLES.antique.C };

const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
const MY1 = mercY(EXTENT.lat1), MY0 = mercY(EXTENT.lat0);
const MAP_RATIO = (MY1 - MY0) / ((EXTENT.lon1 - EXTENT.lon0) * RAD);
const latOfMerc = (m) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / RAD;

// Map layout: the frame fills the sheet inside the border
function mapFrame(fmt) {
  const W = Math.round(fmt.w * 100), H = Math.round(fmt.h * 100), k = W / 1800;
  return { x: 104 * k, y: 104 * k, w: W - 208 * k, h: H - 208 * k };
}

// Geographic extent for a layout: Classic is fixed; Map grows the route box to the
// frame's proportions, giving most of the extra height to the open sea in the south
export function extentFor(fmt, layout, region = 'north') {
  if (layout === 'detail') return detailExtent(fmt, region);
  if (layout !== 'map' && layout !== 'charan') return EXTENT;
  const F = mapFrame(fmt), aspect = F.h / F.w;
  let { lon0, lon1, lat0, lat1 } = ROUTE_BOX;
  let m0 = mercY(lat0), m1 = mercY(lat1);
  const need = aspect * (lon1 - lon0) * RAD;
  if (need > m1 - m0) {
    const extra = need - (m1 - m0);
    m0 -= extra * 0.62; m1 += extra * 0.38;
  } else {
    const L = (m1 - m0) / aspect / RAD, c = (lon0 + lon1) / 2;
    lon0 = c - L / 2; lon1 = c + L / 2;
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  return { lon0: r(lon0), lon1: r(lon1), lat0: r(latOfMerc(m0)), lat1: r(latOfMerc(m1)) };
}
// Detail: the region's stops plus a margin, grown on whichever axis the frame needs
function detailExtent(fmt, region) {
  const D = DETAILS[region] || DETAILS.north, F = mapFrame(fmt), aspect = F.h / F.w;
  const ss = STOPS.slice(D.from - 1, D.to);
  let lon0 = Math.min(...ss.map((s) => s.lon)) - 1.1, lon1 = Math.max(...ss.map((s) => s.lon)) + 1.1;
  let m0 = mercY(Math.min(...ss.map((s) => s.lat)) - 0.9), m1 = mercY(Math.max(...ss.map((s) => s.lat)) + 0.9);
  const need = aspect * (lon1 - lon0) * RAD;
  if (need > m1 - m0) { const extra = need - (m1 - m0); m0 -= extra / 2; m1 += extra / 2; }
  else { const L = (m1 - m0) / aspect / RAD, c = (lon0 + lon1) / 2; lon0 = c - L / 2; lon1 = c + L / 2; }
  const r = (v) => Math.round(v * 1000) / 1000;
  return { lon0: r(lon0), lon1: r(lon1), lat0: r(latOfMerc(m0)), lat1: r(latOfMerc(m1)), region: region in DETAILS ? region : 'north' };
}
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
// Elevation grids are kept for the last few extents (one can be >100 MB at z8); tinted images per style are cached.
const elevCache = new Map();                 // key → promise; the last few extents/zooms
const ELEV_SLOTS = 5;
const reliefCache = {};
export function relief(Z, ext, styleKey = 'antique', onProgress) {
  const key = `${Z}:${ext.lon0},${ext.lon1},${ext.lat0},${ext.lat1}`;
  return (reliefCache[`${key}:${styleKey}`] ||= (async () => {
    return engrave(await elevationData(Z, ext, (p) => onProgress?.(0.85 * p)), STYLES[styleKey], (p) => onProgress?.(0.85 + 0.15 * p));
  })());
}
// Placeholder relief for layout-only passes (nothing is drawn from it)
export const blankRelief = (ext) => ({ href: '', ...ext });
// Tiles needed at a zoom for an extent (used to cap memory for big sheets)
export function tileCount(Z, ext) {
  const n = 2 ** Z, tx = (lon) => Math.floor(((lon + 180) / 360) * n), ty = (lat) => Math.floor(((1 - mercY(lat) / Math.PI) / 2) * n);
  return (tx(ext.lon1) - tx(ext.lon0) + 1) * (ty(ext.lat0) - ty(ext.lat1) + 1);
}

async function loadElevation(Z, EXTENT, onProgress) {
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
      onProgress?.(++done / (cols * rows));
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  return { elev, W, H, n, x0, y0, x1, y1 };
}

// Horn hillshade from the north-west over the style's hypsometric ramp
async function engrave(data, style, onProgress) {
  if (style.paint) return paint(data, style, onProgress);
  const { elev, W, H, n, y0 } = data;
  const { ramp, tone } = style;
  const lut = new Float32Array(7000 * 3);
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
        const ev = Math.min(6999, at(0, 0)), e = ev * 3;
        const rgb = tone([lut[e], lut[e + 1], lut[e + 2]], Math.max(0, hs), ev);
        const p = (jj * W + i) * 4;
        o[p] = clamp(rgb[0]); o[p + 1] = clamp(rgb[1]); o[p + 2] = clamp(rgb[2]);
        o[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, sy);
    onProgress?.(0.9 * ((sy + hgt) / H));
    await new Promise((r) => setTimeout(r));           // keep the page responsive
  }
  return finish(canvas, data, onProgress);
}

// Encode the relief canvas and report its geographic bounds
async function finish(canvas, { n, x0, y0, x1, y1 }, onProgress, extra = {}) {
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const href = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  onProgress?.(1);
  const lonOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD;
  return { href, lon0: lonOf(x0), lon1: lonOf(x1 + 1), lat0: latOf(y1 + 1), lat1: latOf(y0), ...extra };
}

// ---------- Painted relief (Pahari miniature) ----------
// Flat colour bands from smoothed elevation, each outlined in a darker tone, with only
// three steps of light (shadow, ground, highlight), the way a miniature paints its hills.
// Also samples the terrain for the painted motifs (peaks, hills, trees) drawn on top.
async function paint(data, style, onProgress) {
  const { elev, W, H, n, x0, y0 } = data;
  const { bands, outline, edge: edgeRGB } = style.paint;
  // Smoothed elevation: block means, sampled bilinearly, so band edges flow like brushwork
  const B = 6, gw = Math.ceil(W / B), gh = Math.ceil(H / B), grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let sum = 0, cnt = 0;
    for (let y = gy * B; y < Math.min(H, gy * B + B); y++) for (let x = gx * B; x < Math.min(W, gx * B + B); x++) { sum += Math.max(0, elev[y * W + x]); cnt++; }
    grid[gy * gw + gx] = sum / cnt;
  }
  const smooth = (i, j) => {
    const fx = Math.max(0, Math.min(gw - 1.001, i / B - 0.5)), fy = Math.max(0, Math.min(gh - 1.001, j / B - 0.5));
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = iy * gw + ix;
    return (grid[o] * (1 - tx) + grid[o + 1] * tx) * (1 - ty) + (grid[o + gw] * (1 - tx) + grid[o + gw + 1] * tx) * ty;
  };
  const bandOf = (e) => { let b = 0; while (b < bands.length - 1 && e >= bands[b + 1][0]) b++; return b; };

  const az = 315 * RAD, alt = 40 * RAD, zf = 3.1;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const strip = 256;
  for (let sy = 0; sy < H; sy += strip) {
    const hgt = Math.min(strip, H - sy);
    const img = new ImageData(W, hgt);
    const o = img.data;
    for (let jj = 0; jj < hgt; jj++) {
      const j = Math.min(H - 2, Math.max(1, sy + jj));
      const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y0 + j / 256)) / n))) / RAD;
      const cell = (40075016 * Math.cos(lat * RAD)) / (256 * n);
      let bRight = bandOf(smooth(1, j));
      for (let i = 1; i < W - 1; i++) {
        const at = (dx, dy) => Math.max(0, elev[(j + dy) * W + i + dx]);
        const a = at(-1, -1), b = at(0, -1), c = at(1, -1), d = at(-1, 0), f = at(1, 0), g = at(-1, 1), h = at(0, 1), k9 = at(1, 1);
        const dzdx = ((c + 2 * f + k9) - (a + 2 * d + g)) / (8 * cell);
        const dzdy = ((g + 2 * h + k9) - (a + 2 * b + c)) / (8 * cell);
        const slope = Math.atan(zf * Math.hypot(dzdx, dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);
        const hs = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect);
        const band = bRight;
        bRight = bandOf(smooth(i + 1, j));
        const edge = band !== bRight || band !== bandOf(smooth(i, j + 1)) || band !== bandOf(smooth(i, j + 2));
        const col = edge && edgeRGB ? edgeRGB : bands[band][1];
        const s = edge ? outline : hs < 0.6 ? 0.86 : hs > 0.9 ? 1.07 : 1;
        const p = (jj * W + i) * 4;
        o[p] = clamp(col[0] * s); o[p + 1] = clamp(col[1] * s); o[p + 2] = clamp(col[2] * s);
        o[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, sy);
    onProgress?.(0.9 * ((sy + hgt) / H));
    await new Promise((r) => setTimeout(r));
  }
  return finish(canvas, data, onProgress, { motifs: motifs(data, smooth) });
}

// Sample the land on a staggered 0.42° grid: rugged high ground → painted peaks,
// rugged middle ground → rounded hills, gentle low ground → trees (fewer in the dry north-west)
function motifs({ elev, W, H, n, x0, y0 }, smooth) {
  const out = [], step = 0.42;
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const toPx = (lon, lat) => [((lon + 180) / 360) * n * 256 - x0 * 256, ((1 - mercY(lat) / Math.PI) / 2) * n * 256 - y0 * 256];
  const lonOf = (x) => ((x / 256 + x0) / n) * 360 - 180, latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (y / 256 + y0)) / n))) / RAD;
  const lonA = lonOf(0), lonB = lonOf(W), latA = latOf(H), latB = latOf(0);
  let row = 0;
  for (let lat = latA + step / 2; lat < latB; lat += step * 0.87, row++) {
    let col = 0;
    for (let lon = lonA + step / 2 + (row % 2) * step / 2; lon < lonB; lon += step, col++) {
      const r1 = hash(row, col), r2 = hash(col + 999, row), r3 = hash(row + 77, col + 31);
      const jl = lon + (r1 - 0.5) * step * 0.6, jt = lat + (r2 - 0.5) * step * 0.5;
      const [cx, cy] = toPx(jl, jt), half = Math.max(2, Math.round(((step / 360) * n * 256) / 2));
      if (cx < half || cy < half || cx >= W - half || cy >= H - half) continue;
      let lo = Infinity, hi = -Infinity, sea = 0, cnt = 0;
      for (let y = cy - half; y < cy + half; y += 2) for (let x = cx - half; x < cx + half; x += 2) {
        const e = elev[(y | 0) * W + (x | 0)]; cnt++;
        if (e <= 0) sea++;
        if (e < lo) lo = e; if (e > hi) hi = e;
      }
      if (sea / cnt > 0.08) continue;                       // keep motifs off the coasts
      const e = smooth(cx, cy), relief = hi - lo;
      // Thinned so the glyphs (wider than a cell) overlap in loose rows rather than a solid mass
      if (e > 1800 && relief > 1300) { if (r3 < clamp((relief - 1300) / 2600, 0.3, 0.85)) out.push({ t: 'peak', lon: jl, lat: jt, e, s: 0.8 + 0.45 * Math.min(1, (hi - 1800) / 5000) + 0.4 * r3 }); }
      else if (e > 250 && e < 3000 && relief > 380) { if (r3 < 0.42) out.push({ t: 'hill', lon: jl, lat: jt, e, s: 0.75 + 0.6 * r3 }); }
      else if (e >= 3000) continue;                          // open plateau: leave it painted, unadorned
      else if (e < 1500 && relief < 900) {
        const dry = jl < 76 && jt > 23 ? 0.1 : 0.4;          // Thar and the dry north-west
        if (r3 < dry) out.push({ t: r1 < 0.28 ? 'cypress' : 'tree', lon: jl, lat: jt, e, s: 0.8 + 0.4 * r2 });
      }
    }
  }
  return out;
}


// ---------- Kalamkari ----------
const rectR = (W, H, inset, stroke, w) => `<rect x="${f1(inset)}" y="${f1(inset)}" width="${f1(W - 2 * inset)}" height="${f1(H - 2 * inset)}" fill="none" stroke="${stroke}" stroke-width="${f1(w)}"/>`;
// A buta (paisley): a teardrop whose tip curls over, pointing along `rot` degrees
function buta(x, y, s, rot, fill) {
  const L = (n) => f1(n);
  return `<g transform="translate(${L(x)} ${L(y)}) rotate(${f1(rot)})">
    <path d="M0,${L(s)} C${L(-s * 0.95)},${L(s)} ${L(-s * 0.95)},${L(-s * 0.2)} ${L(-s * 0.3)},${L(-s * 0.6)} C${L(0)},${L(-s * 0.8)} ${L(s * 0.15)},${L(-s * 1.2)} ${L(s * 0.55)},${L(-s * 1.05)} C${L(s * 0.2)},${L(-s * 0.85)} ${L(s * 0.9)},${L(-s * 0.4)} ${L(s * 0.7)},${L(s * 0.3)} C${L(s * 0.6)},${L(s * 0.7)} ${L(s * 0.35)},${L(s)} 0,${L(s)} Z" fill="${fill}" stroke="${C.ink}" stroke-width="${L(s * 0.09)}"/>
    <path d="M${L(-s * 0.1)},${L(s * 0.6)} C${L(-s * 0.55)},${L(s * 0.5)} ${L(-s * 0.45)},${L(-s * 0.1)} ${L(0)},${L(-s * 0.3)}" fill="none" stroke="${C.paper}" stroke-width="${L(s * 0.08)}"/>
    <circle cx="${L(s * 0.05)}" cy="${L(s * 0.25)}" r="${L(s * 0.16)}" fill="${C.mustard}" stroke="${C.ink}" stroke-width="${L(s * 0.05)}"/></g>`;
}
// Cotton border between pen-drawn rules: butas alternating madder and indigo, rows of dots
function kalamkariBorder(W, H, k) {
  const o = 50 * k, mid = o / 2, per = o * 1.05, s = o * 0.26;
  let g = `<path d="M0,0H${W}V${H}H0Z M${f1(o)},${f1(o)}V${f1(H - o)}H${f1(W - o)}V${f1(o)}Z" fill="${C.margin}" fill-rule="evenodd"/>`;
  let dots = '';
  const side = (len, at, rot) => {
    const n = Math.max(2, Math.round(len / per)), step = len / n;
    for (let i = 0; i < n; i++) {
      const [x, y] = at((i + 0.5) * step);
      g += buta(x, y, s, rot + (i % 2 ? 180 : 0), i % 2 ? C.indigo : C.madder);
    }
    for (let t = step * 0.25; t < len; t += step / 4) for (const off of [-o * 0.36, o * 0.36]) {
      const [x, y] = at(t, off);
      dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(1.3 * k)}"/>`;
    }
  };
  side(W - 2 * o, (t, off = 0) => [o + t, mid + off], 90);
  side(W - 2 * o, (t, off = 0) => [o + t, H - mid + off], 90);
  side(H - 2 * o, (t, off = 0) => [mid + off, o + t], 0);
  side(H - 2 * o, (t, off = 0) => [W - mid + off, o + t], 0);
  g += `<g fill="${C.madder}">${dots}</g>`;
  for (const [x, y] of [[mid, mid], [W - mid, mid], [mid, H - mid], [W - mid, H - mid]]) {
    g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(o * 0.34)}" fill="${C.indigo}" stroke="${C.ink}" stroke-width="${f1(1.2 * k)}"/>`;
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g += `<circle cx="${f1(x + Math.cos(a) * o * 0.2)}" cy="${f1(y + Math.sin(a) * o * 0.2)}" r="${f1(o * 0.07)}" fill="${C.paper}"/>`; }
    g += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(o * 0.09)}" fill="${C.mustard}"/>`;
  }
  g += rectR(W, H, 4 * k, C.ink, 2.2 * k) + rectR(W, H, o - 2 * k, C.ink, 2.6 * k) + rectR(W, H, o + 3 * k, C.madder, 1.4 * k);
  return g;
}
function kalamkariNeatline(F, k) {
  const { x, y, w, h } = F, t = 6 * k;
  return `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.ink}" stroke-width="${f1(2.4 * k)}"/>
  <rect x="${f1(x - t / 2)}" y="${f1(y - t / 2)}" width="${f1(w + t)}" height="${f1(h + t)}" fill="none" stroke="${C.madder}" stroke-width="${f1(2 * k)}"/>
  <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1 * k)}"/>`;
}
// Water drawn with a kalam: rows of curling waves, and now and then a fish
function kalamkariWaves(k) {
  const w = 120 * k, h = 70 * k, u = k;
  const curl = (x, y, l) => `<path d="M${f1(x)},${f1(y)} q${f1(l * 0.25)},${f1(-l * 0.32)} ${f1(l * 0.5)},${f1(-l * 0.1)} q${f1(l * 0.16)},${f1(l * 0.1)} ${f1(l * 0.02)},${f1(l * 0.2)} q${f1(-l * 0.1)},${f1(l * 0.02)} ${f1(-l * 0.08)},${f1(-l * 0.08)} M${f1(x + l * 0.5)},${f1(y - l * 0.1)} q${f1(l * 0.25)},${f1(-l * 0.05)} ${f1(l * 0.5)},${f1(l * 0.1)}"/>`;
  const fish = (x, y, l, dir) => `<g transform="translate(${f1(x)} ${f1(y)}) scale(${dir} 1)"><path d="M${f1(-l / 2)},0 Q0,${f1(-l * 0.32)} ${f1(l / 2)},0 Q0,${f1(l * 0.32)} ${f1(-l / 2)},0 Z M${f1(l / 2)},0 l${f1(l * 0.22)},${f1(-l * 0.18)} v${f1(l * 0.36)} Z" fill="#f2e6c8" stroke="#2b3b68" stroke-width="${f1(0.7 * u)}"/><circle cx="${f1(-l * 0.28)}" cy="${f1(-l * 0.03)}" r="${f1(l * 0.05)}" fill="#2b3b68"/><path d="M${f1(-l * 0.1)},${f1(-l * 0.12)} v${f1(l * 0.24)} M${f1(l * 0.1)},${f1(-l * 0.12)} v${f1(l * 0.24)}" stroke="#9c2a1c" stroke-width="${f1(0.6 * u)}"/></g>`;
  return `<pattern id="waves" width="${f1(w)}" height="${f1(h)}" patternUnits="userSpaceOnUse">
    <g fill="none" stroke="#2b3b68" stroke-opacity="0.55" stroke-width="${f1(1 * u)}" stroke-linecap="round">
      ${curl(4 * u, 20 * u, 28 * u)}${curl(64 * u, 20 * u, 28 * u)}${curl(34 * u, 54 * u, 28 * u)}${curl(94 * u, 54 * u, 28 * u)}
    </g>${fish(92 * u, 32 * u, 18 * u, 1)}</pattern>`;
}
// Kalamkari motifs: lined madder rocks (snow-capped high up), mustard hillocks, trees of life, peacocks
function kalamkariMotifs(items, ts) {
  const L = (n) => f1(n);
  let g = '';
  for (const m of items) {
    const { x, y } = m, sw = L(0.85 * ts);
    if (m.t === 'peak') {
      const s = 12 * ts * m.s, snow = m.e > 4200 || m.s > 1.25;
      // three pointed pinnacles, each with a pen line following its edge; snow on the tallest
      for (const [dx, hh, sc] of [[-0.55, 0.85, 0.7], [0.55, 0.95, 0.72], [0, 1.45, 1]]) {
        const bx = x + dx * s, w = s * 0.62 * sc, top = y - s * hh;
        g += `<path d="M${L(bx - w)},${L(y)} C${L(bx - w * 0.7)},${L(y - s * hh * 0.45)} ${L(bx - w * 0.18)},${L(top + s * 0.12)} ${L(bx)},${L(top)} C${L(bx + w * 0.18)},${L(top + s * 0.12)} ${L(bx + w * 0.7)},${L(y - s * hh * 0.45)} ${L(bx + w)},${L(y)} Z" fill="${C.madder}" stroke="${C.ink}" stroke-width="${sw}" stroke-linejoin="round"/>`;
        g += `<path d="M${L(bx - w * 0.5)},${L(y)} C${L(bx - w * 0.38)},${L(y - s * hh * 0.5)} ${L(bx - w * 0.1)},${L(top + s * 0.3)} ${L(bx)},${L(top + s * 0.22)}" fill="none" stroke="${C.paper}" stroke-width="${L(0.6 * ts)}" stroke-opacity="0.8"/>`;
        if (snow && sc === 1) g += `<path d="M${L(bx)},${L(top)} C${L(bx + w * 0.14)},${L(top + s * 0.1)} ${L(bx + w * 0.3)},${L(top + s * 0.3)} ${L(bx + w * 0.38)},${L(top + s * 0.42)} Q${L(bx + w * 0.15)},${L(top + s * 0.32)} ${L(bx)},${L(top + s * 0.44)} Q${L(bx - w * 0.15)},${L(top + s * 0.32)} ${L(bx - w * 0.38)},${L(top + s * 0.42)} C${L(bx - w * 0.3)},${L(top + s * 0.3)} ${L(bx - w * 0.14)},${L(top + s * 0.1)} ${L(bx)},${L(top)} Z" fill="#f6eee0" stroke="${C.ink}" stroke-width="${L(0.6 * ts)}"/>`;
      }
    } else if (m.t === 'hill') {
      const s = 10 * ts * m.s;
      g += `<path d="M${L(x - s)},${L(y)} C${L(x - s * 0.7)},${L(y - s * 0.95)} ${L(x + s * 0.7)},${L(y - s * 0.95)} ${L(x + s)},${L(y)} Z" fill="${C.mustard}" stroke="${C.ink}" stroke-width="${sw}"/>`;
      for (const [dx, dy] of [[-0.4, -0.3], [0, -0.45], [0.4, -0.3], [-0.2, -0.15], [0.2, -0.15]]) g += `<circle cx="${L(x + dx * s)}" cy="${L(y + dy * s)}" r="${L(0.9 * ts)}" fill="${C.ink}"/>`;
    } else if (m.t === 'cypress') {
      // a peacock in profile, tail sweeping behind
      const s = 7 * ts * m.s, dir = (Math.round(m.lon * 97) % 2) ? 1 : -1, X = (v) => L(x + dir * v);
      g += `<path d="M${X(-s * 0.2)},${L(y - s * 0.6)} C${X(-s * 1.6)},${L(y - s * 0.4)} ${X(-s * 2.2)},${L(y + s * 0.1)} ${X(-s * 2.4)},${L(y - s * 0.1)} C${X(-s * 1.9)},${L(y - s * 0.9)} ${X(-s * 1)},${L(y - s * 1.1)} ${X(-s * 0.2)},${L(y - s * 0.9)} Z" fill="${C.leaf}" stroke="${C.ink}" stroke-width="${L(0.6 * ts)}"/>`;
      for (const t of [0.9, 1.4, 1.9]) g += `<circle cx="${X(-s * t)}" cy="${L(y - s * (0.55 - t * 0.08))}" r="${L(s * 0.13)}" fill="${C.indigo}" stroke="${C.mustard}" stroke-width="${L(0.5 * ts)}"/>`;
      g += `<path d="M${X(-s * 0.4)},${L(y - s * 0.6)} C${X(-s * 0.4)},${L(y - s * 1.2)} ${X(s * 0.3)},${L(y - s * 1.3)} ${X(s * 0.25)},${L(y - s * 1.7)} C${X(s * 0.25)},${L(y - s * 2)} ${X(s * 0.65)},${L(y - s * 2)} ${X(s * 0.6)},${L(y - s * 1.75)} C${X(s * 0.55)},${L(y - s * 1.3)} ${X(s * 0.6)},${L(y - s * 0.6)} ${X(-s * 0.4)},${L(y - s * 0.6)} Z" fill="${C.indigo}" stroke="${C.ink}" stroke-width="${L(0.6 * ts)}"/>`;
      g += `<path d="M${X(s * 0.4)},${L(y - s * 2)} l${L(dir * -s * 0.1)},${L(-s * 0.3)} M${X(s * 0.5)},${L(y - s * 2)} l${L(dir * s * 0.05)},${L(-s * 0.32)}" stroke="${C.ink}" stroke-width="${L(0.5 * ts)}"/><path d="M${X(s * 0.62)},${L(y - s * 1.85)} l${L(dir * s * 0.25)},${L(s * 0.06)}" stroke="${C.mustard}" stroke-width="${L(0.8 * ts)}"/>`;
      g += `<path d="M${X(-s * 0.1)},${L(y - s * 0.6)} v${L(s * 0.6)} M${X(s * 0.15)},${L(y - s * 0.6)} v${L(s * 0.6)}" stroke="${C.ink}" stroke-width="${L(0.6 * ts)}"/>`;
    } else {
      // tree of life: a curving trunk, a crown of outlined leaves, red flowers
      const s = 8 * ts * m.s;
      g += `<path d="M${L(x)},${L(y)} C${L(x - s * 0.15)},${L(y - s * 0.4)} ${L(x + s * 0.15)},${L(y - s * 0.7)} ${L(x)},${L(y - s * 1.1)}" fill="none" stroke="${C.ink3}" stroke-width="${L(1.5 * ts)}"/>`;
      g += `<circle cx="${L(x)}" cy="${L(y - s * 1.65)}" r="${L(s * 0.85)}" fill="${C.leaf}" stroke="${C.ink}" stroke-width="${L(0.7 * ts)}"/>`;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; g += `<ellipse cx="${L(x + Math.cos(a) * s * 0.5)}" cy="${L(y - s * 1.65 + Math.sin(a) * s * 0.5)}" rx="${L(s * 0.22)}" ry="${L(s * 0.1)}" transform="rotate(${f1(a / RAD)} ${L(x + Math.cos(a) * s * 0.5)} ${L(y - s * 1.65 + Math.sin(a) * s * 0.5)})" fill="none" stroke="${C.paper}" stroke-width="${L(0.45 * ts)}"/>`; }
      g += `<circle cx="${L(x)}" cy="${L(y - s * 1.65)}" r="${L(s * 0.17)}" fill="${C.madder}" stroke="${C.ink}" stroke-width="${L(0.4 * ts)}"/>`;
    }
  }
  return `<g class="motifs">${g}</g>`;
}

// ---------- Footprints (charan) ----------
// The route traced as alternating footprints, and a circle of them round the long stays
function footprints(px, py, ts, R) {
  const foot = `<path d="M0,4.6C-1.6,4.6-1.9,2.6-1.6,0.8C-1.3,-1-2.1,-2.4-1.8,-3.6C-1.4,-4.9,1.7,-4.9,1.9,-3.4C2.1,-2,1.4,-0.6,1.4,1C1.4,2.8,1.4,4.6,0,4.6Z"/><circle cx="1.5" cy="-5.5" r="0.62"/><circle cx="0.5" cy="-6" r="0.5"/><circle cx="-0.4" cy="-6" r="0.44"/><circle cx="-1.15" cy="-5.6" r="0.4"/><circle cx="-1.7" cy="-5" r="0.34"/>`;
  const sc = 1.3 * ts, step = 12 * ts, off = 3.4 * ts;
  const pts = ROUTE.map(([lo, la]) => [px(lo), py(la)]);
  let g = '', acc = step / 2, n = 0;
  const put = (x, y, ang, right) => { g += `<use href="#foot" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)}) scale(${f1((right ? -sc : sc) * 1.35)} ${f1(sc)})"/>`; };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const ux = (bx - ax) / len, uy = (by - ay) / len, ang = Math.atan2(uy, ux) / RAD + 90;
    while (acc <= len) {
      const right = n++ % 2 === 1, side = right ? 1 : -1;
      put(ax + ux * acc - uy * off * side, ay + uy * acc + ux * off * side, ang, right);
      acc += step;
    }
    acc -= len;
  }
  // pradakshina: a ring of steps round Muktinath, Gopal Yogi's ashram and Jagannath Puri
  for (const num of Object.keys(STAY_NOTE)) {
    const s = STOPS[num - 1], cx = px(s.lon), cy = py(s.lat), rr = R + 16 * ts, m = 10;
    for (let j = 0; j < m; j++) {
      const a = (j / m) * Math.PI * 2, right = j % 2 === 1, r2 = rr + (right ? off : -off) * 0.6;
      put(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, a / RAD + 180, right);
    }
  }
  return `<defs><g id="foot">${foot}</g></defs><g fill="${C.red}" stroke="${C.paper}" stroke-width="0.6" paint-order="stroke">${g}</g>`;
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

export function buildSheet(fmt, faceKey, reliefData, onlyNames = null, layout = 'classic', EXT = EXTENT, styleKey = 'antique') {
  const S = STYLES[styleKey] || STYLES.antique, FX = S.fx;
  Object.assign(C, S.C);
  const DETAIL = layout === 'detail';
  const MAPL = layout === 'map' || layout === 'charan' || DETAIL;
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
  let F = { x: (W - mapW) / 2, w: mapW };
  F.y = yFacts + fs(50);
  F.h = F.w * MAP_RATIO;
  if (MAPL) F = mapFrame(fmt);
  const ey1 = mercY(EXT.lat1), ey0 = mercY(EXT.lat0);
  const px = (lon) => F.x + ((lon - EXT.lon0) / (EXT.lon1 - EXT.lon0)) * F.w;
  const py = (lat) => F.y + ((ey1 - mercY(lat)) / (ey1 - ey0)) * F.h;
  const unitsPerKm = (lat) => F.w / (EXT.lon1 - EXT.lon0) / (111.32 * Math.cos(lat * RAD));
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
  // Scale bar: 500 km on the whole-route sheets; on a detail sheet the longest round length that fits
  const latMid = DETAIL ? (EXT.lat0 + EXT.lat1) / 2 : 20;
  const SK = DETAIL ? [500, 250, 200, 100, 50].find((v) => v * unitsPerKm(latMid) <= fs(330)) || 50 : 500;
  const k500 = SK * unitsPerKm(latMid);
  // Map layout: title cartouche in the open sea at lower left, compass rose above it
  const cart = { w: Math.max(fs(560), textWidth('Van Vicharan', `${face.weight} $px ${face.family}`, fs(100 * face.scale)) + fs(90)), h: fs(372) };
  cart.x = F.x + fs(40); cart.y = F.y + F.h - fs(40) - cart.h;
  const roseR = 92 * ts;
  // Map layout: rose out in the open Indian Ocean, clear of the crowded southern tip
  let rcx = MAPL ? px(89.4) : px(69.6), rcy = MAPL ? Math.min(py(2.4), F.y + F.h - roseR * 1.6) : py(13.4);
  if (DETAIL) {
    // Detail: put the cartouche, then the rose, in whichever corners cover the fewest stops and route
    const busy = (x0, y0, x1, y1) => discs.filter((d) => d.x > x0 && d.x < x1 && d.y > y0 && d.y < y1).length * 40 +
      ROUTE.filter(([lo, la]) => { const x = px(lo), y = py(la); return x > x0 && x < x1 && y > y0 && y < y1; }).length;
    const m = fs(40), corners = [[F.x + m, F.y + F.h - m - cart.h], [F.x + F.w - m - cart.w, F.y + F.h - m - cart.h], [F.x + m, F.y + m + fs(30)], [F.x + F.w - m - cart.w, F.y + m + fs(30)]];
    const score = corners.map(([x, y]) => busy(x, y, x + cart.w, y + cart.h));
    const best = score.indexOf(Math.min(...score));
    [cart.x, cart.y] = corners[best];
    const rr = roseR * 1.5, rc = [[F.x + rr, F.y + F.h - rr], [F.x + F.w - rr, F.y + F.h - rr], [F.x + rr, F.y + rr * 1.2], [F.x + F.w - rr, F.y + rr * 1.2]];
    const rs = rc.map(([x, y], i) => (i === best ? Infinity : busy(x - roseR, y - roseR * 1.3, x + roseR, y + roseR)));
    [rcx, rcy] = rc[rs.indexOf(Math.min(...rs))];
  }
  const sx = MAPL ? cart.x + (cart.w - k500) / 2 : px(67.6), sy = MAPL ? cart.y + cart.h - fs(86) : py(9.1);
  if (MAPL) obstacles.push([cart.x - 8, cart.y - 8, cart.x + cart.w + 8, cart.y + cart.h + 8]);
  else {
    obstacles.push([kx - 6, ky - 6, kx + kw + 6, ky + kh + 6]);
    obstacles.push([sx - 10, sy - fs(26), sx + k500 + 10, sy + fs(36)]);
  }
  obstacles.push([rcx - roseR, rcy - roseR * 1.3, rcx + roseR, rcy + roseR]);

  // area labels: [text, lon, lat, class, size, font, tracking, rotate]
  const AREA = [
    ['Arabian Sea', 70.2, 17.2, 'sea', 36, FELL_I, 8], ['Bay of Bengal', 90.1, 18.45, 'sea', 36, FELL_I, 8],
    ['Indian Ocean', 77.0, 6.15, 'sea', 36, FELL_I, 8],
    ['Himalaya', 88.4, 29.25, 'range', 36, FELL_SC, 28, -8], ['Tibet', 88.2, 33.2, 'region', 28, FELL_SC, 13],
    ['Nepal', 81.25, 28.95, 'region', 20, FELL_SC, 8], ['Bengal', 87.15, 23.75, 'region', 20, FELL_SC, 8],
    ['Deccan', 78.6, 18.5, 'region', 28, FELL_SC, 13], ['Gujarat', 71.2, 23.6, 'region', 20, FELL_SC, 8],
    ['Hindustan', 79.6, 24.3, 'region big', 50, FELL_SC, 32], ['Thar', 71.6, 27.4, 'region', 20, FELL_SC, 8],
    ['Lanka', 80.7, 7.3, 'region', 20, FELL_SC, 8],
    ...(MAPL ? [['Burma', 95.4, 22.4, 'region', 20, FELL_SC, 8], ['Laccadive Islands', 71.6, 9.6, 'region', 15, FELL_SC, 4]] : []),
  ].map((a) => (MAPL && a[0] === 'Indian Ocean' ? ['Indian Ocean', 84.2, Math.max(EXT.lat0 + 6.6, 4.6), 'sea', 40, FELL_I, 10] : a))
   .filter(([, lon, lat]) => lon > EXT.lon0 && lon < EXT.lon1 && lat > EXT.lat0 && lat < EXT.lat1);
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
    const sizes = onlyNames || MAPL ? [1, 0.88, 0.78] : [1];
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
    // Map layout names every stop: if nothing fits beside the disc, set the label
    // further out in clear space and draw a fine leader line back to it
    if (MAPL && !named.has(i)) {
      const size = f1(fs(major ? 19 : 14));
      const wdt = textWidth(text, FELL_I, size), hgt = size * 0.92;
      const clearPath = (x0, y0, x1, y1) => {
        for (let t = 0.15; t <= 1; t += 0.12) {
          const qx = x0 + (x1 - x0) * t, qy = y0 + (y1 - y0) * t;
          if (discBoxes.some((o) => o[4] !== i && qx > o[0] && qx < o[2] && qy > o[1] && qy < o[3])) return false;
          if (placed.some((o) => qx > o[0] && qx < o[2] && qy > o[1] && qy < o[3])) return false;
        }
        return true;
      };
      search: for (const r of [2.4, 3.3, 4.4, 5.8, 7.5, 9.5, 12, 15].map((m) => R * m)) {
        for (let a = 0; a < 24; a++) {
          const ang = (a / 24) * Math.PI * 2, cx = Math.cos(ang), cy = Math.sin(ang);
          const lx = d.x + cx * r, ly = d.y + cy * r;
          const anchor = cx >= 0 ? 'start' : 'end';
          const bx0 = anchor === 'start' ? lx + fs(3) : lx - fs(3) - wdt;
          const box = [bx0, ly - hgt * 0.62, bx0 + wdt, ly + hgt * 0.38];
          if (obstacles.some((o) => boxHit(box, o)) || placed.some((o) => boxHit(box, o)) ||
              discBoxes.some((o) => o[4] !== i && boxHit(box, o))) continue;
          const ex = d.x + cx * R, ey = d.y + cy * R;
          if (!clearPath(ex, ey, lx, ly)) continue;
          placed.push(box);
          named.add(i);
          names += `<line x1="${f1(ex)}" y1="${f1(ey)}" x2="${f1(lx)}" y2="${f1(ly)}" stroke="${C.ink2}" stroke-width="${f1(0.7 * ts)}" stroke-opacity="0.8"/>`;
          names += `<text class="${major ? 'place' : 'place minor'}" x="${f1(anchor === 'start' ? lx + fs(3) : lx - fs(3))}" y="${f1(ly + hgt * 0.3)}" text-anchor="${anchor}" style="font-size:${size}px">${esc(text)}</text>`;
          break search;
        }
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
  scale += [0, SK / 2, SK].map((v) => `<text class="deg" x="${f1(sx + (v / SK) * k500)}" y="${f1(sy - fs(7))}" style="font-size:${fs(15)}px">${v}</text>`).join('');
  scale += `<text class="scale-t" x="${f1(sx + k500 / 2)}" y="${f1(sy + fs(30))}" style="font-size:${fs(16)}px">Kilometres (at ${Math.round(latMid)}° N)</text>`;

  // --- graticule + water-lining ---
  let grat = '';
  for (let lon = Math.ceil(EXT.lon0 / 5) * 5; lon < EXT.lon1; lon += 5) grat += `M${f1(px(lon))},${f1(F.y)}V${f1(bottom)}`;
  for (let lat = Math.ceil(EXT.lat0 / 5) * 5; lat < EXT.lat1; lat += 5) grat += `M${f1(F.x)},${f1(py(lat))}H${f1(F.x + F.w)}`;
  let waterLines = '';
  for (let i = 8; i >= 1; i--) {
    const wd = i * 7 * k;
    waterLines += `<path d="${land}" fill="none" stroke="${C.water}" stroke-opacity="${((0.16 + 0.1 * (9 - i) / 8) * FX.waterLines).toFixed(3)}" stroke-width="${f1(wd)}" stroke-linejoin="round"/>`;
    waterLines += `<path d="${land}" fill="none" stroke="${C.seaLine}" stroke-width="${f1(wd - 1.7 * k)}" stroke-linejoin="round"/>`;
  }

  const midX = W / 2;
  let cartouche = '';
  if (MAPL) {
    const cx = cart.x + cart.w / 2;
    const yT = cart.y + fs(54), yTitle = yT + fs(92 * Math.min(1.08, face.scale)), ySub = yTitle + fs(44), yFacts = ySub + fs(40);
    cartouche = `<rect x="${f1(cart.x)}" y="${f1(cart.y)}" width="${f1(cart.w)}" height="${f1(cart.h)}" fill="${C.key}" fill-opacity="0.96" stroke="${C.ink}" stroke-width="${f1(1.6 * ts)}"/>
      <rect x="${f1(cart.x + 7 * ts)}" y="${f1(cart.y + 7 * ts)}" width="${f1(cart.w - 14 * ts)}" height="${f1(cart.h - 14 * ts)}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>
      <text class="eyebrow" x="${f1(cx)}" y="${f1(yT)}" style="font-size:${fs(19)}px;letter-spacing:${fs(8)}px">A chart of Shri Nilkanth Varni’s</text>
      <text class="title" x="${f1(cx)}" y="${f1(yTitle)}" style="font-size:${fs(100 * face.scale)}px;letter-spacing:${f1(face.track * ts)}px">Van Vicharan</text>
      <text class="subtitle" x="${f1(cx)}" y="${f1(ySub)}" style="font-size:${fs(25)}px">${DETAIL ? esc(DETAILS[EXT.region].title) : 'The journey of Nilkanth Varni'}</text>
      ${ornamentRule(cx, ySub + fs(18), fs(150), ts)}
      <text class="facts" x="${f1(cx)}" y="${f1(yFacts)}" style="font-size:${fs(17)}px;letter-spacing:${fs(4)}px">${DETAIL ? detailFacts(EXT.region) : 'Ayodhya to Loj · 1792 – 1799'}</text>
      <text class="credit" x="${f1(cx)}" y="${f1(cart.y + cart.h - fs(22))}" text-anchor="middle" style="font-size:${fs(11)}px">Relief: Mapzen Terrain Tiles · Coastlines: Natural Earth · Tirth positions approximate</text>`;
  }
  const rel = rel_(reliefData, px, py);
  const motifSvg = FX.motifs ? paintMotifs(reliefData.motifs || [], px, py, ts, discs, R, [...obstacles, ...placed], FX.motifs) : '';
  const titleSize = fs(150 * face.scale);

  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, `<clipPath id="frame"><rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}"/></clipPath>
    <clipPath id="land"><path d="${land}"/></clipPath>`)}

  ${MAPL ? '' : `<text class="eyebrow" x="${midX}" y="${f1(yEyebrow)}" style="font-size:${fs(30)}px;letter-spacing:${fs(14)}px">A chart of Shri Nilkanth Varni’s</text>
  <text class="title" x="${midX}" y="${f1(yTitle)}" style="font-size:${titleSize}px;letter-spacing:${f1(face.track * ts)}px">Van Vicharan</text>
  <text class="subtitle" x="${midX}" y="${f1(ySub)}" style="font-size:${fs(38)}px">The journey of Nilkanth Varni</text>
  ${ornamentRule(midX, yRule, fs(330), ts)}
  <text class="facts" x="${midX}" y="${f1(yFacts)}" style="font-size:${fs(25)}px;letter-spacing:${fs(5)}px">1792 · sixty-five tirths · seven years, one month &amp; eleven days · 1799</text>`}

  <g clip-path="url(#frame)">
    <rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" fill="${C.sea}"/>
    ${FX.waves ? `<rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" fill="url(#waves)"/>` : ''}
    ${waterLines}
    <g clip-path="url(#land)">
      <image href="${rel.href}" x="${f1(rel.x)}" y="${f1(rel.y)}" width="${f1(rel.w)}" height="${f1(rel.h)}" preserveAspectRatio="none"/>
      ${FX.wash ? `<rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" filter="url(#pigment)" opacity="0.55"/>
      <path d="${land}" fill="none" stroke="${C.ink3}" stroke-width="${f1(16 * k)}" stroke-opacity="0.32" filter="url(#bleed)"/>` : ''}
    </g>
    <path d="${grat}" fill="none" stroke="${C.ink}" stroke-opacity="${FX.grat}" stroke-width="${f1(0.8 * k)}"/>
    <path d="${rivers}" fill="none" stroke="${C.water}" stroke-width="${f1(1.5 * k)}" stroke-opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${land}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.6 * k)}" stroke-linejoin="round"/>
    ${motifSvg}
    ${areas}
    ${FX.glow ? `<path d="${routeD}" fill="none" stroke="${C.red}" stroke-width="${f1(16 * ts)}" stroke-opacity="0.5" stroke-linejoin="round" filter="url(#glow)"/>` : ''}
    ${layout === 'charan' ? footprints(px, py, ts, R) : `<path d="${routeD}" fill="none" stroke="${C.paper}" stroke-width="${f1(8 * ts)}" stroke-linejoin="round" stroke-opacity="0.92"/>
    <path d="${routeD}" fill="none" stroke="${C.red}" stroke-width="${f1(3 * ts)}" stroke-dasharray="${f1(11 * ts)} ${f1(6 * ts)}" stroke-linejoin="round"/>`}
    ${marks}
    ${names}
    ${annots}
    ${compassRose(rcx, rcy, roseR, ts)}
    ${cartouche}
    ${scale}
    ${MAPL ? '' : key}
  </g>
  ${FX.frame === 'miniature' ? miniatureNeatline(F, k) : FX.frame === 'pichwai' ? pichwaiNeatline(F, k) : FX.frame === 'kalamkari' ? kalamkariNeatline(F, k) : neatline(F, px, py, k, fs, EXT)}

  ${MAPL ? '' : `<g transform="translate(${f1(F.x)}, ${f1(yLegend)})">
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
  <text class="credit" x="${f1(F.x + F.w)}" y="${f1(yCredit)}" text-anchor="end" style="font-size:${fs(13.5)}px">${esc(fmt.label)} · Mercator projection · Drawn ${new Date().getFullYear()}</text>`}

  ${sheetClose(W, H, FX)}`;
}

// [r, g, b, alpha, offset] → feColorMatrix that tints noise one colour
const tint = ([r, g, b, a, o]) => `0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  0 0 0 ${a} ${o}`;


// ---------- Sheet shell shared by every layout and view ----------
// Opens the SVG: shared filters + type styles, paper, mottle and the border (unless opts.border is false)
export function sheetOpen(fmt, W, H, k, ts, fs, face, FX, extraDefs = '', opts = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${fmt.w}in" height="${fmt.h}in" id="chart">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n"/>
      <feColorMatrix in="n" type="matrix" values="${tint(FX.grain)}"/>
    </filter>
    <filter id="mottle" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.0042 / k).toFixed(5)}" numOctaves="4" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="${tint(FX.mottle || [0, 0, 0, 0, 0])}"/>
    </filter>
    <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
      <stop offset="58%" stop-color="${FX.vignette?.[0] || '#000'}" stop-opacity="0"/>
      <stop offset="100%" stop-color="${FX.vignette?.[0] || '#000'}" stop-opacity="${FX.vignette?.[1] || 0}"/>
    </radialGradient>
    <filter id="pigment" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.0065 / k).toFixed(5)}" numOctaves="3" seed="11" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.34  0 0 0 0 0.4  0 0 0 0.75 -0.3"/>
    </filter>
    <filter id="bleed" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${f1(6 * k)}"/></filter>
    ${FX.waves === 'lotus' ? lotusPattern(k) : FX.waves === 'kalamkari' ? kalamkariWaves(k) : FX.waves ? wavePattern(k) : ''}
    <filter id="glow" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${f1(7 * ts)}"/></filter>
    ${extraDefs}
    <style>
      text { font-family: 'IM Fell English', Georgia, serif; fill: ${C.ink}; }
      .eyebrow, .facts, .range, .region, .key-title, .rose-n, .chron-h, .chron-r { font-family: 'IM Fell English SC', 'IM Fell English', Georgia, serif; }
      .eyebrow { text-anchor: middle; }
      .title { font-family: ${face.family}; font-weight: ${face.weight}; text-anchor: middle; }
      .subtitle { font-style: italic; text-anchor: middle; }
      .facts { text-anchor: middle; fill: ${C.ink2}; }
      .sea { font-style: italic; text-anchor: middle; fill: ${C.water}; }
      .range, .region { text-anchor: middle; fill: ${C.ink3}; }
      .region.big { opacity: 0.85; }
      .num { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 700; text-anchor: middle; }
      .num.end { fill: ${C.key}; }
      .place { font-style: italic; paint-order: stroke; stroke: ${C.paper}; stroke-width: ${fs(5)}px; stroke-linejoin: round; }
      .place.minor { fill: ${C.ink2}; stroke-width: ${fs(4)}px; }
      .annot { font-style: italic; fill: ${C.red}; paint-order: stroke; stroke: ${C.paper}; stroke-width: ${fs(5)}px; }
      .deg { text-anchor: middle; fill: ${C.ink2}; }
      .key-title { text-anchor: middle; }
      .key-n { text-anchor: end; }
      .key-alt { font-style: italic; fill: ${C.ink4}; }
      .scale-t { font-style: italic; text-anchor: middle; }
      .rose-n { text-anchor: middle; }
      .legend { font-style: italic; }
      .credit { fill: ${C.ink4}; }
      .colophon { font-style: italic; text-anchor: middle; fill: ${C.ink2}; }
      .chron-h { text-anchor: middle; }
      .chron-r { text-anchor: middle; fill: ${C.ink3}; }
      .chron-y { text-anchor: middle; fill: ${C.ink2}; }
      .chron-n { font-style: italic; fill: ${C.red}; }
      .chron-f { font-style: italic; text-anchor: middle; fill: ${C.ink4}; }
    </style>
  </defs>

  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  ${FX.mottle ? `<rect width="${W}" height="${H}" filter="url(#mottle)"/>` : ''}
  ${opts.border === false ? '' : FX.frame === 'miniature' ? miniatureBorder(W, H, k) : FX.frame === 'pichwai' ? pichwaiBorder(W, H, k) : FX.frame === 'kalamkari' ? kalamkariBorder(W, H, k) : border(W, H, k)}
`;
}
export function sheetClose(W, H, FX) {
  return `${FX.vignette ? `<rect width="${W}" height="${H}" fill="url(#vignette)" pointer-events="none"/>` : ''}
  <rect width="${W}" height="${H}" filter="url(#grain)" opacity="${FX.grainOpacity}" pointer-events="none"/>
</svg>`;
}

// "Tirths 1 – 18 · 1792 – 1795" for a detail cartouche
function detailFacts(region) {
  const D = DETAILS[region], y0 = CHRONO[D.from - 1].date.getUTCFullYear(), y1 = CHRONO[D.to - 1].date.getUTCFullYear();
  return `Tirths ${D.from} – ${D.to} · ${y0 === y1 ? y0 : `${y0} – ${y1}`}`;
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

// Pahari page: gold-flecked pink margin (hashiya), white-edged lapis band, red inner rule
function miniatureBorder(W, H, k) {
  const o = 44 * k, band = 12 * k;
  let g = `<path d="M0,0H${W}V${H}H0Z M${f1(o)},${f1(o)}V${f1(H - o)}H${f1(W - o)}V${f1(o)}Z" fill="${C.margin}" fill-rule="evenodd"/>`;
  let flecks = '', seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const side = i % 4, t = rnd(), d = rnd() * (o - band) * 0.9;
    const [x, y] = side === 0 ? [t * W, d] : side === 1 ? [t * W, H - d] : side === 2 ? [d, t * H] : [W - d, t * H];
    flecks += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1((0.6 + rnd() * 1.4) * k)}"/>`;
  }
  g += `<g fill="${C.gold}" opacity="0.8">${flecks}</g>`;
  const r = (inset, stroke, w) => `<rect x="${f1(inset)}" y="${f1(inset)}" width="${f1(W - 2 * inset)}" height="${f1(H - 2 * inset)}" fill="none" stroke="${stroke}" stroke-width="${f1(w)}"/>`;
  g += r(o - band / 2, C.lapis, band) + r(o - band - 1.2 * k, '#f8f1e2', 1.6 * k) + r(o + 1.2 * k, '#f8f1e2', 1.6 * k) + r(o + 6 * k, C.red, 2.4 * k);
  return g;
}
// Pichwai: deep red border carrying a gold vine with cream flowers, between gold rules
function pichwaiBorder(W, H, k) {
  const o = 48 * k, mid = o / 2, amp = o * 0.17, per = o * 1.25;
  let g = `<path d="M0,0H${W}V${H}H0Z M${f1(o)},${f1(o)}V${f1(H - o)}H${f1(W - o)}V${f1(o)}Z" fill="${C.margin}" fill-rule="evenodd"/>`;
  let vine = '', flowers = '';
  const flower = (x, y, r) => {
    let f = '';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      f += `<ellipse cx="${f1(x + Math.cos(a) * r * 0.55)}" cy="${f1(y + Math.sin(a) * r * 0.55)}" rx="${f1(r * 0.5)}" ry="${f1(r * 0.3)}" transform="rotate(${f1((a / RAD))} ${f1(x + Math.cos(a) * r * 0.55)} ${f1(y + Math.sin(a) * r * 0.55)})"/>`;
    }
    return `<g fill="#f6e7c4">${f}</g><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.24)}" fill="${C.gold}"/>`;
  };
  // one side at a time: a sine vine along the middle of the band, flowers on alternate crests
  const side = (len, at) => {
    const n = Math.max(2, Math.round(len / per)), step = len / n;
    let d = '';
    for (let i = 0; i <= n * 8; i++) { const t = (i / 8) * step, [x, y] = at(t, Math.sin((t / step) * Math.PI) * amp); d += `${i ? 'L' : 'M'}${f1(x)},${f1(y)}`; }
    vine += `<path d="${d}" fill="none" stroke="${C.gold}" stroke-width="${f1(1.3 * k)}"/>`;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * step, [x, y] = at(t, (i % 2 ? -1 : 1) * amp * 1.05);
      flowers += flower(x, y, o * 0.2);
      const [lx, ly] = at(t + step * 0.28, 0);
      flowers += `<ellipse cx="${f1(lx)}" cy="${f1(ly)}" rx="${f1(o * 0.11)}" ry="${f1(o * 0.05)}" fill="${C.gold}" opacity="0.85"/>`;
    }
  };
  side(W - 2 * o, (t, off) => [o + t, mid + off]);
  side(W - 2 * o, (t, off) => [o + t, H - mid + off]);
  side(H - 2 * o, (t, off) => [mid + off, o + t]);
  side(H - 2 * o, (t, off) => [W - mid + off, o + t]);
  g += vine + flowers;
  for (const [x, y] of [[mid, mid], [W - mid, mid], [mid, H - mid], [W - mid, H - mid]]) g += flower(x, y, o * 0.32);
  const r = (inset, stroke, w) => `<rect x="${f1(inset)}" y="${f1(inset)}" width="${f1(W - 2 * inset)}" height="${f1(H - 2 * inset)}" fill="none" stroke="${stroke}" stroke-width="${f1(w)}"/>`;
  g += r(3 * k, C.gold, 1.6 * k) + r(o - 1.5 * k, C.gold, 2.4 * k) + r(o + 3 * k, C.gold, 0.8 * k);
  return g;
}
function pichwaiNeatline(F, k) {
  const { x, y, w, h } = F, t = 6 * k;
  return `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.gold}" stroke-width="${f1(2.6 * k)}"/>
  <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.gold}" stroke-width="${f1(1 * k)}"/>`;
}
// Seas as lotus ponds: lily pads, open lotuses and buds among gold ripples
function lotusPattern(k) {
  const w = 150 * k, h = 128 * k, u = k;
  const pad = (x, y, r, rot) => `<path d="M${f1(x)},${f1(y)} L${f1(x + Math.cos(rot) * r)},${f1(y + Math.sin(rot) * r)} A${f1(r)},${f1(r)} 0 1 1 ${f1(x + Math.cos(rot + 0.5) * r)},${f1(y + Math.sin(rot + 0.5) * r)} Z" fill="#2c5a3a" stroke="#c9a95a" stroke-width="${f1(0.6 * u)}"/>`;
  const lotus = (x, y, r) => {
    let f = '';
    for (const a of [-60, -30, 0, 30, 60]) f += `<ellipse cx="${f1(x)}" cy="${f1(y - r * 0.5)}" rx="${f1(r * 0.24)}" ry="${f1(r * 0.55)}" transform="rotate(${a} ${f1(x)} ${f1(y)})" fill="#e79ab2" stroke="#b9506f" stroke-width="${f1(0.5 * u)}"/>`;
    return f + `<circle cx="${f1(x)}" cy="${f1(y - r * 0.15)}" r="${f1(r * 0.16)}" fill="#e8c35a"/>`;
  };
  const bud = (x, y, r) => `<path d="M${f1(x)},${f1(y)} q${f1(-r * 0.45)},${f1(-r * 0.6)} 0,${f1(-r * 1.2)} q${f1(r * 0.45)},${f1(r * 0.6)} 0,${f1(r * 1.2)}Z" fill="#e79ab2" stroke="#b9506f" stroke-width="${f1(0.5 * u)}"/><line x1="${f1(x)}" y1="${f1(y)}" x2="${f1(x)}" y2="${f1(y + r * 0.9)}" stroke="#2c5a3a" stroke-width="${f1(0.9 * u)}"/>`;
  const rip = (x, y, l) => `<path d="M${f1(x)},${f1(y)} q${f1(l / 4)},${f1(-l / 6)} ${f1(l / 2)},0 q${f1(l / 4)},${f1(l / 6)} ${f1(l / 2)},0" fill="none" stroke="#c9a95a" stroke-opacity="0.45" stroke-width="${f1(0.7 * u)}"/>`;
  return `<pattern id="waves" width="${f1(w)}" height="${f1(h)}" patternUnits="userSpaceOnUse">
    ${rip(8 * u, 18 * u, 26 * u)}${rip(70 * u, 64 * u, 30 * u)}${rip(112 * u, 112 * u, 24 * u)}${rip(30 * u, 100 * u, 22 * u)}
    ${pad(30 * u, 42 * u, 11 * u, 0.4)}${pad(46 * u, 52 * u, 7 * u, 2.2)}${lotus(38 * u, 36 * u, 10 * u)}
    ${pad(108 * u, 30 * u, 9 * u, 4.1)}${bud(122 * u, 26 * u, 7 * u)}
    ${pad(92 * u, 92 * u, 12 * u, 1.3)}${lotus(96 * u, 88 * u, 11 * u)}${pad(76 * u, 100 * u, 6 * u, 5.2)}
    ${pad(14 * u, 116 * u, 7 * u, 3.3)}${bud(140 * u, 76 * u, 6 * u)}
  </pattern>`;
}
// Pichwai motifs: gold-edged rock mounds, silver snow mounds, kadamba trees in flower, grazing cows
function pichwaiMotifs(items, ts) {
  const L = (n) => f1(n), gold = C.gold;
  let g = '';
  for (const m of items) {
    const { x, y } = m, sw = L(0.8 * ts);
    if (m.t === 'peak' || m.t === 'hill') {
      const s = (m.t === 'peak' ? 13 : 10) * ts * m.s, snow = m.t === 'peak' && (m.e > 4200 || m.s > 1.25);
      const fill = m.t === 'peak' ? '#57547a' : '#3f5a3a';
      g += `<path d="M${L(x - s)},${L(y)} C${L(x - s)},${L(y - s * 0.9)} ${L(x - s * 0.45)},${L(y - s * 1.2)} ${L(x)},${L(y - s * 1.2)} C${L(x + s * 0.45)},${L(y - s * 1.2)} ${L(x + s)},${L(y - s * 0.9)} ${L(x + s)},${L(y)} Z" fill="${fill}" stroke="${gold}" stroke-width="${sw}"/>`;
      if (snow) g += `<path d="M${L(x - s * 0.62)},${L(y - s * 0.95)} C${L(x - s * 0.4)},${L(y - s * 1.2)} ${L(x + s * 0.4)},${L(y - s * 1.2)} ${L(x + s * 0.62)},${L(y - s * 0.95)} Q${L(x + s * 0.3)},${L(y - s * 0.8)} ${L(x)},${L(y - s * 0.92)} Q${L(x - s * 0.3)},${L(y - s * 0.8)} ${L(x - s * 0.62)},${L(y - s * 0.95)} Z" fill="#e4e0d4"/>`;
      g += `<path d="M${L(x - s * 0.6)},${L(y - s * 0.35)} q${L(s * 0.3)},${L(-s * 0.3)} ${L(s * 0.6)},0 M${L(x - s * 0.1)},${L(y - s * 0.75)} q${L(s * 0.3)},${L(-s * 0.25)} ${L(s * 0.55)},0" fill="none" stroke="${gold}" stroke-width="${L(0.6 * ts)}" stroke-opacity="0.85"/>`;
    } else if (m.t === 'cypress') {
      // a cow, facing left or right
      const s = 6.5 * ts * m.s, dir = (Math.round(m.lon * 97) % 2) ? 1 : -1, X = (v) => L(x + dir * v);
      g += `<g stroke="#3a2a1a" stroke-width="${L(0.5 * ts)}"><line x1="${X(-s * 0.6)}" y1="${L(y - s * 0.5)}" x2="${X(-s * 0.6)}" y2="${L(y)}"/><line x1="${X(s * 0.5)}" y1="${L(y - s * 0.5)}" x2="${X(s * 0.5)}" y2="${L(y)}"/>
        <ellipse cx="${L(x)}" cy="${L(y - s * 0.75)}" rx="${L(s * 0.85)}" ry="${L(s * 0.42)}" fill="#f3ead8"/>
        <ellipse cx="${X(s * 1.0)}" cy="${L(y - s * 1.0)}" rx="${L(s * 0.32)}" ry="${L(s * 0.24)}" fill="#f3ead8"/>
        <path d="M${X(s * 0.9)},${L(y - s * 1.2)} l${L(dir * -s * 0.1)},${L(-s * 0.3)} M${X(s * 1.1)},${L(y - s * 1.2)} l${L(dir * s * 0.12)},${L(-s * 0.3)}" fill="none" stroke="${gold}"/></g>`;
    } else {
      // kadamba in flower
      const s = 8 * ts * m.s;
      g += `<line x1="${L(x)}" y1="${L(y)}" x2="${L(x)}" y2="${L(y - s * 0.9)}" stroke="#4a2e1a" stroke-width="${L(1.4 * ts)}"/>`;
      g += `<circle cx="${L(x)}" cy="${L(y - s * 1.6)}" r="${L(s * 0.95)}" fill="#1d4a2c" stroke="${gold}" stroke-width="${L(0.6 * ts)}"/>`;
      for (const [dx, dy] of [[-0.45, -0.3], [0.35, -0.45], [0, 0.1], [-0.15, -0.75], [0.5, 0.15]]) g += `<circle cx="${L(x + dx * s)}" cy="${L(y - s * 1.6 + dy * s)}" r="${L(s * 0.13)}" fill="#f2dc8a"/>`;
    }
  }
  return `<g class="motifs">${g}</g>`;
}
function miniatureNeatline(F, k) {
  const { x, y, w, h } = F, t = 7 * k;
  return `<rect x="${f1(x - t)}" y="${f1(y - t)}" width="${f1(w + 2 * t)}" height="${f1(h + 2 * t)}" fill="none" stroke="${C.lapis}" stroke-width="${f1(5 * k)}"/>
  <rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="none" stroke="${C.red}" stroke-width="${f1(1.6 * k)}"/>`;
}
// Water as miniatures paint it: rows of small scalloped ripples
function wavePattern(k) {
  const w = 34 * k, h = 20 * k, a = w / 4;
  const row = (y, dx) => `M${f1(dx - a)},${f1(y)} q${f1(a)},${f1(-a * 0.8)} ${f1(2 * a)},0 M${f1(dx + a)},${f1(y)} q${f1(a)},${f1(-a * 0.8)} ${f1(2 * a)},0 M${f1(dx + 3 * a)},${f1(y)} q${f1(a)},${f1(-a * 0.8)} ${f1(2 * a)},0`;
  return `<pattern id="waves" width="${f1(w)}" height="${f1(h)}" patternUnits="userSpaceOnUse">
    <path d="${row(h * 0.45, 0)} ${row(h * 0.95, a)}" fill="none" stroke="${C.wave}" stroke-opacity="0.5" stroke-width="${f1(1.1 * k)}" stroke-linecap="round"/></pattern>`;
}
// Painted motifs, drawn back to front, kept clear of the route, stops and furniture
function paintMotifs(list, px, py, ts, discs, R, obstacles, kind = true) {
  const pts = ROUTE.map(([lo, la]) => [px(lo), py(la)]);
  const clearR = 14 * ts, stopR = R * 2.4;
  const items = list.map((m) => ({ ...m, x: px(m.lon), y: py(m.lat) })).filter((m) => {
    const hw = 22 * ts * m.s;
    if (obstacles.some((b) => m.x + hw > b[0] && m.x - hw < b[2] && m.y > b[1] && m.y - hw * 1.6 < b[3])) return false;
    if (discs.some((d) => Math.hypot(d.x - m.x, d.y - m.y) < stopR)) return false;
    for (const [x, y] of pts) if (Math.abs(x - m.x) < clearR && Math.abs(y - m.y) < clearR) return false;
    return true;
  }).sort((a, b) => a.y - b.y);
  const L = (n) => f1(n);
  if (kind === 'pichwai') return pichwaiMotifs(items, ts);
  if (kind === 'kalamkari') return kalamkariMotifs(items, ts);
  let g = '';
  for (const m of items) {
    const { x, y } = m, sw = L(0.9 * ts);
    if (m.t === 'peak') {
      const s = 14 * ts * m.s, snow = m.e > 4200 || m.s > 1.25;
      g += `<path d="M${L(x - s)},${L(y)} C${L(x - s * 0.55)},${L(y - s * 0.5)} ${L(x - s * 0.32)},${L(y - s * 1.25)} ${L(x)},${L(y - s * 1.3)} C${L(x + s * 0.32)},${L(y - s * 1.25)} ${L(x + s * 0.55)},${L(y - s * 0.5)} ${L(x + s)},${L(y)} Z" fill="${snow ? '#c9b8b2' : '#b59670'}" stroke="${C.ink3}" stroke-width="${sw}"/>`;
      g += `<path d="M${L(x)},${L(y - s * 1.3)} C${L(x + s * 0.32)},${L(y - s * 1.25)} ${L(x + s * 0.55)},${L(y - s * 0.5)} ${L(x + s)},${L(y)} L${L(x + s * 0.1)},${L(y)} C${L(x + s * 0.25)},${L(y - s * 0.5)} ${L(x + s * 0.1)},${L(y - s)} ${L(x)},${L(y - s * 1.3)} Z" fill="${C.ink3}" fill-opacity="0.28"/>`;
      if (snow) g += `<path d="M${L(x - s * 0.36)},${L(y - s * 0.95)} C${L(x - s * 0.24)},${L(y - s * 1.22)} ${L(x + s * 0.24)},${L(y - s * 1.22)} ${L(x + s * 0.36)},${L(y - s * 0.95)} Q${L(x + s * 0.12)},${L(y - s * 0.82)} ${L(x)},${L(y - s * 0.98)} Q${L(x - s * 0.12)},${L(y - s * 0.82)} ${L(x - s * 0.36)},${L(y - s * 0.95)} Z" fill="#fbf7ee" stroke="${C.ink3}" stroke-width="${L(0.5 * ts)}"/>`;
    } else if (m.t === 'hill') {
      const s = 11 * ts * m.s;
      g += `<path d="M${L(x - s)},${L(y)} C${L(x - s * 0.7)},${L(y - s * 0.9)} ${L(x + s * 0.7)},${L(y - s * 0.9)} ${L(x + s)},${L(y)} Z" fill="#93a35c" stroke="${C.ink3}" stroke-width="${sw}"/>`;
      g += `<path d="M${L(x - s * 0.45)},${L(y - s * 0.42)} q${L(s * 0.2)},${L(-s * 0.2)} ${L(s * 0.4)},${L(-s * 0.22)}" fill="none" stroke="#c9d08e" stroke-width="${L(1.2 * ts)}" stroke-linecap="round"/>`;
    } else if (m.t === 'cypress') {
      const s = 9 * ts * m.s;
      g += `<line x1="${L(x)}" y1="${L(y)}" x2="${L(x)}" y2="${L(y - s * 0.5)}" stroke="#5a3b22" stroke-width="${L(1.2 * ts)}"/>`;
      g += `<path d="M${L(x)},${L(y - s * 2.6)} C${L(x + s * 0.65)},${L(y - s * 1.8)} ${L(x + s * 0.5)},${L(y - s * 0.6)} ${L(x)},${L(y - s * 0.45)} C${L(x - s * 0.5)},${L(y - s * 0.6)} ${L(x - s * 0.65)},${L(y - s * 1.8)} ${L(x)},${L(y - s * 2.6)} Z" fill="#3f5a2c" stroke="#2c3f1e" stroke-width="${L(0.6 * ts)}"/>`;
    } else {
      const s = 8 * ts * m.s;
      g += `<line x1="${L(x)}" y1="${L(y)}" x2="${L(x)}" y2="${L(y - s * 0.9)}" stroke="#5a3b22" stroke-width="${L(1.4 * ts)}"/>`;
      g += `<circle cx="${L(x)}" cy="${L(y - s * 1.55)}" r="${L(s * 0.9)}" fill="#4d6a32" stroke="#2c3f1e" stroke-width="${L(0.6 * ts)}"/>`;
      g += `<circle cx="${L(x - s * 0.3)}" cy="${L(y - s * 1.85)}" r="${L(s * 0.32)}" fill="#7d9a4c"/>`;
    }
  }
  return `<g class="motifs">${g}</g>`;
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

function neatline(F, px, py, k, fs, EXTENT) {
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
  for (let lon = Math.ceil(EXTENT.lon0 / 5) * 5; lon < EXTENT.lon1; lon += 5) {
    g += `<text class="deg" x="${f1(px(lon))}" y="${f1(y - t - s * 0.55)}" style="font-size:${s}px">${lon}° E</text><text class="deg" x="${f1(px(lon))}" y="${f1(y + h + t + s * 1.3)}" style="font-size:${s}px">${lon}° E</text>`;
  }
  for (let lat = Math.ceil(EXTENT.lat0 / 5) * 5; lat < EXTENT.lat1; lat += 5) {
    const lab = lat === 0 ? 'Equator' : `${Math.abs(lat)}° ${lat < 0 ? 'S' : 'N'}`;
    g += `<text class="deg" transform="translate(${f1(x - t - s * 0.6)},${f1(py(lat))}) rotate(-90)" style="font-size:${s}px">${lab}</text>`;
    g += `<text class="deg" transform="translate(${f1(x + w + t + s * 1.2)},${f1(py(lat))}) rotate(-90)" style="font-size:${s}px">${lab}</text>`;
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

// ---------- Shared with the other views (js/print-views.js) ----------
// Point the drawing palette at a style and return it
function useStyle(styleKey) {
  const S = STYLES[styleKey] || STYLES.antique;
  Object.assign(C, S.C);
  return S;
}
// The colour a style paints ground of a given elevation (flat light), for profiles and keys
function styleColor(S, e) {
  if (S.paint) { const b = S.paint.bands; let i = 0; while (i < b.length - 1 && e >= b[i + 1][0]) i++; return b[i][1]; }
  const r = S.ramp; let c = r[r.length - 1][1];
  for (let i = 1; i < r.length; i++) if (e < r[i][0]) { const t = (e - r[i - 1][0]) / (r[i][0] - r[i - 1][0]); c = mixRGB(r[i - 1][1], r[i][1], t); break; }
  return S.tone(c, 0.82, e).map((v) => clamp(Math.round(v)));
}
// Raw elevation grid for an extent (shares the relief's cache), and a bilinear sampler over it
export function elevationData(Z, ext, onProgress) {
  const key = `${Z}:${ext.lon0},${ext.lon1},${ext.lat0},${ext.lat1}`;
  if (!elevCache.has(key)) {
    elevCache.set(key, loadElevation(Z, ext, onProgress));
    while (elevCache.size > ELEV_SLOTS) elevCache.delete(elevCache.keys().next().value);
  } else { const p = elevCache.get(key); elevCache.delete(key); elevCache.set(key, p); }   // most recent last
  return elevCache.get(key);
}
export function elevationSampler({ elev, W, H, n, x0, y0 }) {
  return (lon, lat) => {
    const gx = (((lon + 180) / 360) * n - x0) * 256, gy = (((1 - mercY(lat) / Math.PI) / 2) * n - y0) * 256;
    if (gx < 0 || gy < 0 || gx >= W - 1 || gy >= H - 1) return 0;
    const ix = gx | 0, iy = gy | 0, tx = gx - ix, ty = gy - iy, o = iy * W + ix;
    return (elev[o] * (1 - tx) + elev[o + 1] * tx) * (1 - ty) + (elev[o + W] * (1 - tx) + elev[o + W + 1] * tx) * ty;
  };
}
export const kit = {
  C, STOPS, ROUTE, CHRONO, LEG_KM, LAND, RIVERS, EXTENT, RAD, mercY, latOfMerc, f1, esc, lerp, clamp, mixRGB,
  textWidth, FELL, FELL_I, FELL_SC, boxHit, haversineKm, ornamentRule, compassRose, sheetOpen, sheetClose,
  useStyle, styleColor, TITLE_FACES,
};
