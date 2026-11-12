// Print edition: the other ways of seeing the journey, each drawn as one SVG sheet in the chosen style.
//   Line      minimalist poster: the route as one bold line, the coast as a hairline
//   Profile   the ground underfoot: elevation along the walk, unrolled in rows
//   Strip     road-book strips (after Ogilby): the route cut into twelve panels, each turned to run up the page
//   Panorama  a bird's-eye view from over the Indian Ocean, looking north to the Himalaya
// Units match print.js: hundredths of an inch, with type scaled to the sheet (ts = W / 1800).
import { kit } from './print.js';

const {
  C, STOPS, ROUTE, CHRONO, LEG_KM, LAND, RIVERS, EXTENT, RAD, mercY, f1, esc, clamp, mixRGB,
  textWidth, FELL, FELL_I, FELL_SC, boxHit, haversineKm, ornamentRule, compassRose, sheetOpen, sheetClose,
  useStyle, styleColor, TITLE_FACES,
} = kit;

const SEG = 24;                                            // ROUTE points per leg (see print.js)
const TOTAL_KM = LEG_KM.reduce((a, b) => a + b, 0);
const KM_FROM_AYODHYA = LEG_KM.slice(1).reduce((a, b) => a + b, 0);
const fmtKm = (v) => Math.round(v).toLocaleString('en-US');
const shortName = (s) => s.key || s.name.split(' – ')[0].split(' & ')[0].replace(/ (Mandir|Kovil|Swami)$/, '');
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const rgbStr = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const FACTS = `1792 · sixty-five tirths · ${fmtKm(KM_FROM_AYODHYA)} km on foot · 1799`;

// Cumulative km along ROUTE, and at each stop
const ROUTE_KM = [0];
for (let i = 1; i < ROUTE.length; i++) ROUTE_KM.push(ROUTE_KM[i - 1] + haversineKm(ROUTE[i - 1], ROUTE[i]));
const STOP_KM = STOPS.map((_, i) => ROUTE_KM[i * SEG]);

function setup(fmt, faceKey, styleKey) {
  const S = useStyle(styleKey);
  const W = Math.round(fmt.w * 100), H = Math.round(fmt.h * 100), k = W / 1800;
  return { S, FX: S.fx, W, H, k, ts: k, fs: (u) => f1(u * k), face: TITLE_FACES[faceKey] };
}

// Title block, as on the Classic sheet; sc shrinks it for views that need the room
function header({ W, fs, ts, face }, top, sub, facts = FACTS, sc = 1) {
  const mid = W / 2;
  const yE = top + fs(62 * sc), yT = yE + fs(150 * Math.min(1.08, face.scale) * sc), yS = yT + fs(56 * sc);
  const yR = yS + fs(26 * sc), yF = yR + fs(44 * sc);
  const svg = `<text class="eyebrow" x="${mid}" y="${f1(yE)}" style="font-size:${fs(30 * sc)}px;letter-spacing:${fs(14 * sc)}px">A chart of Shri Nilkanth Varni’s</text>
  <text class="title" x="${mid}" y="${f1(yT)}" style="font-size:${fs(150 * face.scale * sc)}px;letter-spacing:${f1(face.track * ts)}px">Van Vicharan</text>
  <text class="subtitle" x="${mid}" y="${f1(yS)}" style="font-size:${fs(38 * sc)}px">${esc(sub)}</text>
  ${ornamentRule(mid, yR, fs(330 * sc), ts)}
  <text class="facts" x="${mid}" y="${f1(yF)}" style="font-size:${fs(25 * sc)}px;letter-spacing:${fs(5 * sc)}px">${facts}</text>`;
  return { svg, bottom: yF + fs(22 * sc) };
}
function credits({ W, H, k, fs }, fmt, left, x0 = 110 * k, x1 = W - 110 * k) {
  const y = H - 72 * k;
  return `<text class="credit" x="${f1(x0)}" y="${f1(y)}" style="font-size:${fs(13.5)}px">${left}</text>
  <text class="credit" x="${f1(x1)}" y="${f1(y)}" text-anchor="end" style="font-size:${fs(13.5)}px">${esc(fmt.label)} · Drawn ${new Date().getFullYear()}</text>`;
}
function disc(x, y, i, R, ts, fs, opacity = 1) {
  const end = i <= 1 || i === STOPS.length - 1;
  return `<g${opacity < 1 ? ` opacity="${opacity}"` : ''}><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(R)}" fill="${end ? C.red : C.key}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/>` +
    `<text class="num${end ? ' end' : ''}" x="${f1(x)}" y="${f1(y + R * 0.36)}" style="font-size:${f1(R * 1.09)}px">${STOPS[i].n}</text></g>`;
}
function routeStroke(d, ts, FX, extra = '') {
  return `${FX.glow ? `<path d="${d}" fill="none" stroke="${C.red}" stroke-width="${f1(16 * ts)}" stroke-opacity="0.5" stroke-linejoin="round" filter="url(#glow)"${extra}/>` : ''}
    <path d="${d}" fill="none" stroke="${C.paper}" stroke-width="${f1(8 * ts)}" stroke-linejoin="round" stroke-opacity="0.92"${extra}/>
    <path d="${d}" fill="none" stroke="${C.red}" stroke-width="${f1(3 * ts)}" stroke-dasharray="${f1(11 * ts)} ${f1(6 * ts)}" stroke-linejoin="round"${extra}/>`;
}
// Place a label beside a point: first side that clears the boxes taken so far
function placeLabel(x, y, gap, text, size, font, taken, bounds, sides = ['right', 'left', 'top', 'bottom']) {
  const w = textWidth(text, font, size), h = size * 0.92;
  const cand = {
    right: [x + gap, y - h * 0.62, x + gap + w, y + h * 0.38, 'start', x + gap, y + h * 0.3],
    left: [x - gap - w, y - h * 0.62, x - gap, y + h * 0.38, 'end', x - gap, y + h * 0.3],
    top: [x - w / 2, y - gap - h, x + w / 2, y - gap, 'middle', x, y - gap - h * 0.15],
    bottom: [x - w / 2, y + gap, x + w / 2, y + gap + h, 'middle', x, y + gap + h * 0.8],
  };
  for (const side of sides) {
    const c = cand[side], box = c.slice(0, 4);
    if (bounds && (box[0] < bounds[0] || box[1] < bounds[1] || box[2] > bounds[2] || box[3] > bounds[3])) continue;
    if (taken.some((o) => boxHit(box, o))) continue;
    taken.push(box);
    return { anchor: c[4], x: c[5], y: c[6] };
  }
  return null;
}
const legend = (x, y, fs, ts, items) => {
  let g = `<g transform="translate(${f1(x)}, ${f1(y)})">`, cx = 0;
  for (const [kind, label] of items) {
    if (kind === 'route') { g += `<line x1="${cx}" y1="0" x2="${f1(cx + fs(56))}" y2="0" stroke="${C.red}" stroke-width="${f1(3 * ts)}" stroke-dasharray="${f1(11 * ts)} ${f1(6 * ts)}"/>`; cx += fs(68); }
    else { const R = 11.5 * ts; g += `<circle cx="${f1(cx + R)}" cy="0" r="${f1(R)}" fill="${kind === 'end' ? C.red : C.key}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/>`; cx += R * 2 + fs(10); }
    g += `<text class="legend" x="${f1(cx)}" y="${fs(6)}" style="font-size:${fs(19)}px">${label}</text>`;
    cx += textWidth(label, FELL_I, fs(19)) + fs(46);
  }
  return { svg: g + '</g>', width: cx - fs(46) };
};

// =====================================================================
// Line: the route as a single bold line on an open sheet
// =====================================================================
export function buildLine(fmt, faceKey, styleKey) {
  const E = setup(fmt, faceKey, styleKey), { W, H, k, ts, fs, face, FX } = E;
  const M = 150 * k, foot = fs(420);
  const F = { x: M, y: M + fs(30), w: W - 2 * M, h: H - 2 * M - foot - fs(30) };
  // Fit every stop, with breathing room, into the frame (Mercator, centred)
  const lon0 = Math.min(...STOPS.map((s) => s.lon)) - 0.8, lon1 = Math.max(...STOPS.map((s) => s.lon)) + 0.8;
  const m0 = mercY(Math.min(...STOPS.map((s) => s.lat)) - 0.8), m1 = mercY(Math.max(...STOPS.map((s) => s.lat)) + 0.8);
  const sc = Math.min(F.w / ((lon1 - lon0) * RAD), F.h / (m1 - m0));
  const cx = F.x + F.w / 2, cy = F.y + F.h / 2, clon = (lon0 + lon1) / 2, cm = (m0 + m1) / 2;
  const px = (lon) => cx + (lon - clon) * RAD * sc, py = (lat) => cy - (mercY(lat) - cm) * sc;
  const path = (flat, close) => { let d = ''; for (let i = 0; i < flat.length; i += 2) d += `${i ? 'L' : 'M'}${f1(px(flat[i]))},${f1(py(flat[i + 1]))}`; return close ? d + 'Z' : d; };
  const land = LAND.map((r) => path(r, true)).join('');
  const routeD = ROUTE.map(([lo, la], i) => `${i ? 'L' : 'M'}${f1(px(lo))},${f1(py(la))}`).join('');

  // dots for every tirth; names for the milestones only
  const taken = [];
  let dots = '', names = '';
  STOPS.forEach((s, i) => {
    const x = px(s.lon), y = py(s.lat), end = i === 1 || i === STOPS.length - 1;
    const r = end ? 9 * ts : s.key ? 5 * ts : 3.2 * ts;
    taken.push([x - r, y - r, x + r, y + r]);
    dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${end ? C.red : C.paper}" stroke="${end ? C.paper : C.ink}" stroke-width="${f1((end ? 2.5 : 1.3) * ts)}"/>`;
  });
  const named = STOPS.map((s, i) => [s, i]).filter(([s, i]) => s.key || i === 1);
  for (const [s, i] of named) {
    const text = (i === 1 ? 'Ayodhya' : s.key).toUpperCase(), size = fs(15);
    const sides = [s.side || 'right', 'right', 'left', 'top', 'bottom'];
    const p = placeLabel(px(s.lon), py(s.lat), fs(12), text, size, `$px 'IM Fell English SC'`, taken, null, [...new Set(sides)]);
    if (p) names += `<text class="line-name" x="${f1(p.x)}" y="${f1(p.y)}" text-anchor="${p.anchor}" style="font-size:${size}px;letter-spacing:${fs(3)}px">${esc(text)}</text>`;
  }

  // foot: the title set large and quiet
  const mid = W / 2, yT = H - M - fs(200);
  const foot2 = `<text class="eyebrow" x="${mid}" y="${f1(yT - fs(150 * face.scale))}" style="font-size:${fs(24)}px;letter-spacing:${fs(16)}px">A chart of Shri Nilkanth Varni’s</text>
  <text class="title" x="${mid}" y="${f1(yT)}" style="font-size:${fs(140 * face.scale)}px;letter-spacing:${f1((face.track + 6) * ts)}px">Van Vicharan</text>
  <line x1="${f1(mid - fs(60))}" y1="${f1(yT + fs(52))}" x2="${f1(mid + fs(60))}" y2="${f1(yT + fs(52))}" stroke="${C.red}" stroke-width="${f1(2.4 * ts)}"/>
  <text class="facts" x="${mid}" y="${f1(yT + fs(108))}" style="font-size:${fs(22)}px;letter-spacing:${fs(8)}px">AYODHYA TO LOJ · 1792 – 1799 · ${fmtKm(KM_FROM_AYODHYA)} KM · 65 TIRTHS</text>`;

  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, `<clipPath id="frame"><rect x="${f1(F.x - M * 0.6)}" y="${f1(F.y - M * 0.6)}" width="${f1(F.w + M * 1.2)}" height="${f1(F.h + M * 1.2)}"/></clipPath>
    <style>.line-name { font-family: 'IM Fell English SC', Georgia, serif; fill: ${C.ink2}; paint-order: stroke; stroke: ${C.paper}; stroke-width: ${fs(5)}px; stroke-linejoin: round; }</style>`, { border: false })}
  <g clip-path="url(#frame)">
    <path d="${land}" fill="${C.ink}" fill-opacity="0.05" stroke="${C.ink}" stroke-opacity="0.5" stroke-width="${f1(1.1 * k)}" stroke-linejoin="round"/>
  </g>
  ${FX.glow ? `<path d="${routeD}" fill="none" stroke="${C.red}" stroke-width="${f1(22 * ts)}" stroke-opacity="0.45" stroke-linejoin="round" filter="url(#glow)"/>` : ''}
  <path d="${routeD}" fill="none" stroke="${C.red}" stroke-width="${f1(5 * ts)}" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  ${names}
  ${foot2}
  ${sheetClose(W, H, FX)}`;
}

// =====================================================================
// Profile: the elevation of the ground along the route, in rows
// =====================================================================
export function buildProfile(fmt, faceKey, styleKey, sample) {
  const E = setup(fmt, faceKey, styleKey), { S, W, H, k, ts, fs, face, FX } = E;
  const hd = header(E, 70 * k, 'The ground underfoot, from Chhapaiya to Loj', FACTS, 0.82);
  const ROWS = 4, mx = 150 * k, x0 = mx, x1 = W - mx * 0.8, rowW = x1 - x0;
  const yTop = hd.bottom + fs(30), yBot = H - fs(150);
  const rowH = (yBot - yTop) / ROWS, labelBand = fs(118), axisBand = fs(62), plotH = rowH - labelBand - axisBand;

  // sample the route every ~1.5 km, lightly smoothed
  const step = 1.5, N = Math.ceil(TOTAL_KM / step) + 1, elev = new Float32Array(N);
  let seg = 0;
  for (let i = 0; i < N; i++) {
    const km = Math.min(TOTAL_KM, i * step);
    while (seg < ROUTE.length - 2 && ROUTE_KM[seg + 1] < km) seg++;
    const t = (km - ROUTE_KM[seg]) / Math.max(1e-6, ROUTE_KM[seg + 1] - ROUTE_KM[seg]);
    elev[i] = Math.max(0, sample(ROUTE[seg][0] + (ROUTE[seg + 1][0] - ROUTE[seg][0]) * t, ROUTE[seg][1] + (ROUTE[seg + 1][1] - ROUTE[seg][1]) * t));
  }
  const sm = elev.map((_, i) => (elev[Math.max(0, i - 1)] + 2 * elev[i] + elev[Math.min(N - 1, i + 1)]) / 4);
  let iMax = 0;
  for (let i = 1; i < N; i++) if (sm[i] > sm[iMax]) iMax = i;
  const top = Math.max(2000, Math.ceil(sm[iMax] / 1000) * 1000);
  const kmPerRow = TOTAL_KM / ROWS;
  const X = (km) => x0 + ((km % kmPerRow) / kmPerRow) * rowW;
  const rowOf = (km) => Math.min(ROWS - 1, Math.floor(km / kmPerRow));
  const base = (r) => yTop + r * rowH + labelBand + plotH;
  // stretched height scale, so the Deccan and the Ghats read beside the Himalaya; the gridlines carry the true heights
  const HP = 0.6, hy = (e) => (Math.max(0, e) / top) ** HP;
  const Y = (r, e) => base(r) - hy(e) * plotH;

  // date at any km: interpolate the chronology between stops
  const dateAt = (km) => {
    let i = 0;
    while (i < STOPS.length - 2 && STOP_KM[i + 1] < km) i++;
    // leaves stop i after its stay, arrives at i + 1 on its date
    const t = clamp((km - STOP_KM[i]) / Math.max(1e-6, STOP_KM[i + 1] - STOP_KM[i]), 0, 1);
    const leave = CHRONO[i].date.getTime() + CHRONO[i].stay * 864e5;
    return leave + t * (CHRONO[i + 1].date.getTime() - leave);
  };

  let defs = '', body = '';
  const ramp = [0, 200, 500, 1000, 1600, 2400, 3200, 4200, 5200, 6200].filter((e) => e <= top + 1000);
  for (let r = 0; r < ROWS; r++) {
    const b = base(r), a0 = r * kmPerRow, a1 = a0 + kmPerRow;
    defs += `<linearGradient id="pg${r}" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(b)}" x2="0" y2="${f1(Y(r, top))}">${ramp.map((e) => `<stop offset="${hy(e).toFixed(3)}" stop-color="${rgbStr(styleColor(S, e))}"/>`).join('')}</linearGradient>`;
    // grid + elevation labels
    for (const e of [200, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000].filter((v) => v <= top)) {
      body += `<line x1="${f1(x0)}" y1="${f1(Y(r, e))}" x2="${f1(x1)}" y2="${f1(Y(r, e))}" stroke="${C.ink}" stroke-opacity="0.18" stroke-width="${f1(0.8 * k)}" stroke-dasharray="${f1(2 * k)} ${f1(5 * k)}"/>`;
      body += `<text class="deg" x="${f1(x0 - fs(8))}" y="${f1(Y(r, e) + fs(5))}" text-anchor="end" style="font-size:${fs(13)}px;text-anchor:end">${fmtKm(e)} m</text>`;
    }
    // the profile itself
    const i0 = Math.floor(a0 / step), i1 = Math.min(N - 1, Math.ceil(a1 / step));
    let d = `M${f1(x0)},${f1(b)}`;
    for (let i = i0; i <= i1; i++) d += `L${f1(x0 + ((i * step - a0) / kmPerRow) * rowW)},${f1(Y(r, sm[i]))}`;
    d += `L${f1(x1)},${f1(b)}Z`;
    body += `<path d="${d}" fill="url(#pg${r})" stroke="${C.ink}" stroke-width="${f1(1.1 * ts)}" stroke-linejoin="round"/>`;
    body += `<line x1="${f1(x0)}" y1="${f1(b)}" x2="${f1(x1)}" y2="${f1(b)}" stroke="${C.ink}" stroke-width="${f1(1.4 * ts)}"/>`;
    // km ticks
    for (let km = Math.ceil(a0 / 250) * 250; km <= a1 + 1e-6; km += 250) {
      const x = X(km === a1 ? a1 - 1e-6 : km), major = km % 1000 === 0;
      body += `<line x1="${f1(x)}" y1="${f1(b)}" x2="${f1(x)}" y2="${f1(b + fs(major ? 9 : 5))}" stroke="${C.ink}" stroke-width="${f1(0.9 * ts)}"/>`;
      if (major) body += `<text class="deg" x="${f1(x)}" y="${f1(b + fs(24))}" style="font-size:${fs(13)}px">${fmtKm(km)} km</text>`;
    }
    // new years along the way
    for (let yr = 1793; yr <= 1799; yr++) {
      const t = Date.UTC(yr, 0, 1);
      let lo = 0, hi = TOTAL_KM;
      for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (dateAt(m) < t) lo = m; else hi = m; }
      if (rowOf(lo) !== r) continue;
      const x = X(lo);
      body += `<line x1="${f1(x)}" y1="${f1(b + fs(2))}" x2="${f1(x)}" y2="${f1(b + fs(34))}" stroke="${C.red}" stroke-width="${f1(1.6 * ts)}"/>`;
      body += `<text class="chron-n" x="${f1(x + fs(5))}" y="${f1(b + fs(46))}" style="font-size:${fs(16)}px">${yr}</text>`;
    }
  }

  // stops: discs above the profile (nudged apart within each row), names set at an angle above them
  const R = 10.5 * ts;
  const rows = Array.from({ length: ROWS }, () => []);
  STOPS.forEach((s, i) => { const km = STOP_KM[i]; const r = rowOf(Math.min(km, TOTAL_KM - 1e-6)); rows[r].push({ i, ax: X(Math.min(km, (r + 1) * kmPerRow - 1e-6)), km }); });
  for (const [r, list] of rows.entries()) {
    list.sort((a, b) => a.ax - b.ax);
    list.forEach((d) => { d.x = d.ax; });
    for (let it = 0; it < 200; it++) {
      for (let j = 1; j < list.length; j++) {
        const gap = list[j].x - list[j - 1].x, need = 2 * R + 2 * ts;
        if (gap < need) { const p = (need - gap) / 2; list[j - 1].x -= p; list[j].x += p; }
      }
      for (const d of list) { d.x += (d.ax - d.x) * 0.05; d.x = clamp(d.x, x0 + R, x1 - R); }
    }
    const yDisc = yTop + r * rowH + labelBand - fs(18);
    for (const d of list) {
      const e = sm[Math.min(N - 1, Math.round(d.km / step))], yG = Y(r, e);
      body += `<path d="M${f1(d.ax)},${f1(yG)}V${f1(yDisc + R + fs(10))}L${f1(d.x)},${f1(yDisc + R)}" fill="none" stroke="${C.ink}" stroke-opacity="0.3" stroke-width="${f1(0.7 * ts)}"/>`;
      body += `<circle cx="${f1(d.ax)}" cy="${f1(yG)}" r="${f1(2.4 * ts)}" fill="${C.ink}"/>`;
      body += disc(d.x, yDisc, d.i, R, ts, fs);
      const s = STOPS[d.i], size = fs(s.key ? 15.5 : 13.5);
      body += `<text class="${s.key ? 'place' : 'place minor'}" transform="translate(${f1(d.x + fs(3))},${f1(yDisc - R - fs(5))}) rotate(-52)" style="font-size:${size}px">${esc(shortName(s))}</text>`;
    }
  }
  // highest ground crossed
  {
    const r = rowOf(iMax * step), x = X(iMax * step), y = Y(r, sm[iMax]);
    body += `<text class="annot" x="${f1(x + fs(10))}" y="${f1(y + fs(4))}" style="font-size:${fs(16)}px">highest ground crossed, about ${fmtKm(Math.round(sm[iMax] / 50) * 50)} m</text>`;
  }

  const leg = legend(x0, H - fs(108), fs, ts, [['stop', 'Tirth, by its number on the route'], ['end', 'Beginning & end']]);
  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, defs)}
  ${hd.svg}
  ${body}
  ${leg.svg}
  <text class="legend" x="${f1(x1)}" y="${f1(H - fs(102))}" text-anchor="end" style="font-size:${fs(17)}px">Height of the ground under the route as charted · heights on a stretched scale; read them from the gridlines</text>
  ${credits(E, fmt, 'Elevation: Mapzen Terrain Tiles · Distances along the smoothed route · Dates between Ayodhya and Loj are estimates')}
  ${sheetClose(W, H, FX)}`;
}

// =====================================================================
// Strip: the route cut into six road-book panels, each turned to run up the page
// =====================================================================
export function buildStrip(fmt, faceKey, styleKey, rel) {
  const E = setup(fmt, faceKey, styleKey), { S, W, H, k, ts, fs, face, FX } = E;
  const hd = header(E, 70 * k, 'The road, in twelve strips', FACTS, 0.82);
  // base projection: Mercator over EXTENT, 1000 units wide (the relief image lives in these units)
  const BS = 1000 / ((EXTENT.lon1 - EXTENT.lon0) * RAD), my1 = mercY(EXTENT.lat1);
  const bx = (lon) => (lon - EXTENT.lon0) * RAD * BS, by = (lat) => (my1 - mercY(lat)) * BS;
  const bpath = (flat, close) => { let d = ''; for (let i = 0; i < flat.length; i += 2) d += `${i ? 'L' : 'M'}${(bx(flat[i])).toFixed(2)},${(by(flat[i + 1])).toFixed(2)}`; return close ? d + 'Z' : d; };
  const landB = LAND.map((r) => bpath(r, true)).join(''), riversB = RIVERS.map((r) => bpath(r, false)).join('');
  const RB = ROUTE.map(([lo, la]) => [bx(lo), by(la)]);

  // twelve segments of about equal length, cut at stops, in two rows of six
  const P = 12, COLS = 6, cuts = [0];
  for (let j = 1; j < P; j++) {
    const target = (TOTAL_KM * j) / P;
    let best = cuts[j - 1] + 1;
    for (let i = best; i < STOPS.length - 1; i++) if (Math.abs(STOP_KM[i] - target) < Math.abs(STOP_KM[best] - target)) best = i;
    cuts.push(best);
  }
  cuts.push(STOPS.length - 1);

  const mx = 110 * k, gap = fs(34), pw = (W - 2 * mx - (COLS - 1) * gap) / COLS;
  const headH = fs(112), rowGap = fs(26), yStart = hd.bottom + fs(30), yEnd = H - fs(170);
  const ph = (yEnd - yStart - 2 * headH - rowGap) / 2;
  const landTint = rgbStr(styleColor(S, 300));
  let defs = `<clipPath id="landB"><path d="${landB}"/></clipPath><image id="reliefB" href="${rel.href}" x="${bx(rel.lon0).toFixed(2)}" y="${by(rel.lat1).toFixed(2)}" width="${(bx(rel.lon1) - bx(rel.lon0)).toFixed(2)}" height="${(by(rel.lat0) - by(rel.lat1)).toFixed(2)}" preserveAspectRatio="none"/>`;
  let body = '';
  for (let j = 0; j < P; j++) {
    const a = cuts[j], b = cuts[j + 1], pts = RB.slice(a * SEG, b * SEG + 1);
    const X0 = mx + (j % COLS) * (pw + gap), yP = yStart + headH + Math.floor(j / COLS) * (ph + headH + rowGap), pad = fs(40);
    // turn the segment to whichever angle lets it fill the strip largest, then make it run bottom to top
    const mxp = pts.reduce((t, p) => t + p[0], 0) / pts.length, myp = pts.reduce((t, p) => t + p[1], 0) / pts.length;
    const fit = (th) => {
      const ct = Math.cos(th), st = Math.sin(th);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { const u = (x - mxp) * ct - (y - myp) * st, v = (x - mxp) * st + (y - myp) * ct; x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); }
      return { th, s: Math.min((pw - 2 * pad) / Math.max(1e-6, x1 - x0), (ph - 2 * pad) / Math.max(1e-6, y1 - y0)) };
    };
    let best = fit(0);
    for (let deg = 3; deg < 180; deg += 3) { const f = fit(deg * RAD); if (f.s > best.s) best = f; }
    let th = best.th;
    {
      const ct = Math.cos(th), st = Math.sin(th), A0 = pts[0], A1 = pts[pts.length - 1];
      if ((A1[0] - mxp) * st + (A1[1] - myp) * ct > (A0[0] - mxp) * st + (A0[1] - myp) * ct) th += Math.PI;   // end must sit above the start
    }
    const ct = Math.cos(th), st = Math.sin(th);
    const rot = ([x, y]) => [(x - mxp) * ct - (y - myp) * st, (x - mxp) * st + (y - myp) * ct];
    const rp = pts.map(rot);
    const bx0 = Math.min(...rp.map((p) => p[0])), bx1 = Math.max(...rp.map((p) => p[0]));
    const by0 = Math.min(...rp.map((p) => p[1])), by1 = Math.max(...rp.map((p) => p[1]));
    const s = best.s;
    const ox = X0 + pw / 2 - s * (bx0 + bx1) / 2, oy = yP + ph / 2 - s * (by0 + by1) / 2;
    const toP = (p) => { const [x, y] = rot(p); return [ox + s * x, oy + s * y]; };
    const T = `translate(${f1(ox)},${f1(oy)}) rotate(${(th / RAD).toFixed(3)}) scale(${s.toFixed(5)}) translate(${(-mxp).toFixed(2)},${(-myp).toFixed(2)})`;
    defs += `<clipPath id="pc${j}"><rect x="${f1(X0)}" y="${f1(yP)}" width="${f1(pw)}" height="${f1(ph)}"/></clipPath>`;

    // the whole route in panel space (faint), the segment bold
    const all = RB.map(toP), segP = all.slice(a * SEG, b * SEG + 1);
    const dAll = all.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)},${f1(y)}`).join('');
    const dSeg = segP.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)},${f1(y)}`).join('');

    // stops: this panel's numbered, neighbours faint
    const taken = [], bounds = [X0 + fs(6), yP + fs(6), X0 + pw - fs(6), yP + ph - fs(6)];
    const R = 10.5 * ts;
    let marks = '', names = '';
    const inPanel = ([x, y]) => x > X0 && x < X0 + pw && y > yP && y < yP + ph;
    const own = [];
    STOPS.forEach((st0, i) => {
      const p = toP([bx(st0.lon), by(st0.lat)]);
      if (!inPanel(p)) return;
      if (i >= a && i <= b) own.push([i, p]); else marks += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${f1(3 * ts)}" fill="${C.ink}" fill-opacity="0.45"/>`;
    });
    for (const [, p] of own) taken.push([p[0] - R, p[1] - R, p[0] + R, p[1] + R]);
    for (const [i, p] of own) marks += disc(p[0], p[1], i, R, ts, fs);
    for (const [i, p] of own) {
      const st0 = STOPS[i], size = fs(st0.key ? 16 : 13.5), text = shortName(st0);
      const L = placeLabel(p[0], p[1], R + fs(4), text, size, FELL_I, taken, bounds);
      if (L) names += `<text class="${st0.key ? 'place' : 'place minor'}" x="${f1(L.x)}" y="${f1(L.y)}" text-anchor="${L.anchor}" style="font-size:${size}px">${esc(text)}</text>`;
    }

    // north arrow and scale bar in the panel's lower corners
    const na = th, nx = X0 + pw - fs(28), ny = yP + ph - fs(40), nl = fs(22);
    const north = `<g transform="translate(${f1(nx)},${f1(ny)}) rotate(${(na / RAD).toFixed(2)})">
      <circle r="${fs(15)}" fill="${C.key}" fill-opacity="0.9" stroke="${C.ink}" stroke-width="${f1(0.8 * ts)}"/>
      <path d="M0,${f1(-nl * 0.6)} L${f1(nl * 0.22)},${f1(nl * 0.35)} L0,${f1(nl * 0.15)} L${f1(-nl * 0.22)},${f1(nl * 0.35)}Z" fill="${C.ink}"/></g>
      <text class="rose-n" x="${f1(nx)}" y="${f1(ny - fs(22))}" style="font-size:${fs(12)}px">N</text>`;
    const latMid = STOPS.slice(a, b + 1).reduce((t, q) => t + q.lat, 0) / (b - a + 1);
    const perKm = (BS / (6371 * Math.cos(latMid * RAD))) * s;
    const km = [500, 300, 200, 100, 50, 25].find((v) => v * perKm <= pw * 0.45) || 25, L = km * perKm;
    const sx = X0 + fs(14), sy = yP + ph - fs(22);
    const scale = `<rect x="${f1(sx - fs(6))}" y="${f1(sy - fs(26))}" width="${f1(L + fs(18))}" height="${fs(38)}" fill="${C.key}" fill-opacity="0.85"/>
      <rect x="${f1(sx)}" y="${f1(sy)}" width="${f1(L / 2)}" height="${fs(5)}" fill="${C.ink}"/><rect x="${f1(sx + L / 2)}" y="${f1(sy)}" width="${f1(L / 2)}" height="${fs(5)}" fill="${C.key}" stroke="${C.ink}" stroke-width="${f1(0.6 * ts)}"/>
      <text class="deg" x="${f1(sx + L / 2)}" y="${f1(sy - fs(8))}" style="font-size:${fs(12)}px">${km} km</text>`;

    body += `<g clip-path="url(#pc${j})">
      <rect x="${f1(X0)}" y="${f1(yP)}" width="${f1(pw)}" height="${f1(ph)}" fill="${C.sea}"/>
      ${FX.waves ? `<rect x="${f1(X0)}" y="${f1(yP)}" width="${f1(pw)}" height="${f1(ph)}" fill="url(#waves)"/>` : ''}
      <g transform="${T}">
        <path d="${landB}" fill="${landTint}"/>
        <g clip-path="url(#landB)"><use href="#reliefB"/></g>
        <path d="${riversB}" fill="none" stroke="${C.water}" stroke-width="${(1.5 * k / s).toFixed(4)}" stroke-opacity="0.9" stroke-linejoin="round"/>
        <path d="${landB}" fill="none" stroke="${C.ink}" stroke-width="${(1.5 * k / s).toFixed(4)}" stroke-linejoin="round"/>
      </g>
      <path d="${dAll}" fill="none" stroke="${C.red}" stroke-opacity="0.35" stroke-width="${f1(2 * ts)}" stroke-linejoin="round"/>
      ${routeStroke(dSeg, ts, FX)}
      ${marks}
      ${names}
      ${north}
      ${scale}
    </g>
    <rect x="${f1(X0)}" y="${f1(yP)}" width="${f1(pw)}" height="${f1(ph)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.6 * k)}"/>
    <rect x="${f1(X0 - fs(6))}" y="${f1(yP - fs(6))}" width="${f1(pw + fs(12))}" height="${f1(ph + fs(12))}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.6 * k)}"/>`;

    // panel heading
    const A = STOPS[a], Bs = STOPS[b], cxH = X0 + pw / 2;
    const ya = CHRONO[a].date.getUTCFullYear(), yb = CHRONO[b].date.getUTCFullYear();
    const legKm = STOP_KM[b] - STOP_KM[a];
    const fitSize = (text, font, size, w) => Math.min(size, size * w / Math.max(1, textWidth(text, font, size)));
    const route = `${shortName(A)} to ${shortName(Bs)}`;
    const facts = `${ya === yb ? ya : `${ya} – ${yb}`} · ${fmtKm(legKm)} km · tirths ${A.n} – ${Bs.n}`;
    body += `<text class="title" x="${f1(cxH)}" y="${f1(yP - headH + fs(44))}" style="font-size:${fs(46)}px">${ROMAN[j]}</text>
      <text class="subtitle" x="${f1(cxH)}" y="${f1(yP - headH + fs(76))}" style="font-size:${f1(fitSize(route, FELL_I, fs(19), pw))}px">${esc(route)}</text>
      <text class="facts" x="${f1(cxH)}" y="${f1(yP - headH + fs(100))}" style="font-size:${f1(fitSize(facts, FELL_SC, fs(13), pw))}px">${facts}</text>`;
  }

  const leg = legend(mx, H - fs(116), fs, ts, [['route', 'The route through this strip'], ['stop', 'Tirth, by number'], ['end', 'Beginning & end']]);
  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, defs)}
  ${hd.svg}
  ${body}
  ${leg.svg}
  <text class="legend" x="${f1(W - mx)}" y="${f1(H - fs(110))}" text-anchor="end" style="font-size:${fs(17)}px">Read each strip from the bottom up, left to right · every strip is turned to its own road, so mind its north arrow</text>
  ${credits(E, fmt, 'Relief: Mapzen Terrain Tiles · Coastlines &amp; rivers: Natural Earth · After the strip road-books of John Ogilby', mx, W - mx)}
  ${sheetClose(W, H, FX)}`;
}

// =====================================================================
// Panorama: a bird's-eye view from over the Indian Ocean, looking north
// =====================================================================
// Renders the terrain with a column ray-caster (draw near to far, each column only above what is
// already drawn), textured with the style's tinted relief and hazed with distance.
async function renderPanorama(data, texHref, SW, SH, pal, onProgress) {
  const { elev, W, H, n, x0, y0 } = data;
  const bmp = await createImageBitmap(await (await fetch(texHref)).blob());
  const tc = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
  tc.drawImage(bmp, 0, 0, W, H);
  const tex = tc.getImageData(0, 0, W, H).data;

  const gx = (lon) => (((lon + 180) / 360) * n - x0) * 256, gy = (lat) => (((1 - mercY(lat) / Math.PI) / 2) * n - y0) * 256;
  // Heights from block means (about 5 km), sampled bilinearly: exaggerated raw pixels turn to streaks
  const B = 4, bw = Math.ceil(W / B), bh = Math.ceil(H / B), grid = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sum = 0, cnt = 0;
    for (let y = by * B; y < Math.min(H, by * B + B); y++) for (let x = bx * B; x < Math.min(W, bx * B + B); x++) { sum += Math.max(0, elev[y * W + x]); cnt++; }
    grid[by * bw + bx] = sum / cnt;
  }
  // the style's colours, averaged over the same blocks so neighbouring columns agree
  const tgrid = new Float32Array(bw * bh * 3);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let r = 0, g = 0, b = 0, cnt = 0;
    for (let y = by * B; y < Math.min(H, by * B + B); y++) for (let x = bx * B; x < Math.min(W, bx * B + B); x++) { const q = (y * W + x) * 4; r += tex[q]; g += tex[q + 1]; b += tex[q + 2]; cnt++; }
    const o = (by * bw + bx) * 3; tgrid[o] = r / cnt; tgrid[o + 1] = g / cnt; tgrid[o + 2] = b / cnt;
  }
  const colour = (x, y) => {
    const fx = clamp(x / B - 0.5, 0, bw - 1.001), fy = clamp(y / B - 0.5, 0, bh - 1.001);
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = (iy * bw + ix) * 3, o2 = o + bw * 3;
    return [0, 1, 2].map((c) => (tgrid[o + c] * (1 - tx) + tgrid[o + 3 + c] * tx) * (1 - ty) + (tgrid[o2 + c] * (1 - tx) + tgrid[o2 + 3 + c] * tx) * ty);
  };
  const height = (x, y) => {
    const fx = x / B - 0.5, fy = y / B - 0.5;
    if (fx < 0 || fy < 0 || fx >= bw - 1 || fy >= bh - 1) return 0;
    const ix = fx | 0, iy = fy | 0, tx = fx - ix, ty = fy - iy, o = iy * bw + ix;
    return (grid[o] * (1 - tx) + grid[o + 1] * tx) * (1 - ty) + (grid[o + bw] * (1 - tx) + grid[o + bw + 1] * tx) * ty;
  };
  const mPerPx = (40075016 * Math.cos(20 * RAD)) / (256 * n), V = PANO_V;      // vertical exaggeration
  const camX = gx(81.2), camY = gy(-3.5), camH = 520;
  const zNear = camY - gy(7.4), zFar = camY - gy(35.2);
  // frame: Kanyakumari at the foot of the picture, the far edge of Tibet a fifth of the way down
  const focal = (SH * (0.98 - 0.2)) / (camH * (1 / zNear - 1 / zFar));
  const horizon = SH * 0.98 - (camH * focal) / zNear;

  const { sky0, sky1, haze, sea } = pal;
  const img = new ImageData(SW, SH), o = img.data;
  for (let y = 0; y < SH; y++) {
    const t = clamp(y / Math.max(1, horizon), 0, 1), c = mixRGB(sky0, sky1, t);
    for (let x = 0; x < SW; x++) { const p = (y * SW + x) * 4; o[p] = c[0]; o[p + 1] = c[1]; o[p + 2] = c[2]; o[p + 3] = 255; }
  }
  const ybuf = new Float32Array(SW).fill(SH), depth = new Float32Array(SW * SH).fill(Infinity);
  let z = zNear * 0.86, dz = 0.5, step = 0;
  while (z < zFar * 1.06) {
    const wy = camY - z, iy = Math.round(wy), inY = iy >= 0 && iy < H;
    // haze thickens with distance and closes in completely at the far edge of the data
    const tz = clamp((z - zNear) / (zFar - zNear), 0, 1.06);
    const fog = clamp(tz ** 1.6 * 0.55 + clamp((tz - 0.9) / 0.16, 0, 1) * 0.45, 0, 1);
    for (let sx = 0; sx < SW; sx++) {
      const wx = camX + ((sx - SW / 2) * z) / focal, ix = Math.round(wx);
      let e = 0, c;
      if (inY && ix >= 0 && ix < W) {
        const q = iy * W + ix;
        e = height(wx, wy);
        if (elev[q] > 0) {
          // light the exaggerated surface from the south-west, towards the viewer
          const k3 = V / mPerPx / (2 * B), nx = -(height(wx + B, wy) - height(wx - B, wy)) * k3, ny = -(height(wx, wy + B) - height(wx, wy - B)) * k3;
          const lam = (nx * -0.45 + ny * 0.55 + 0.7) / Math.hypot(nx, ny, 1);
          const sh = 0.62 + 0.5 * Math.max(0, lam);
          c = colour(wx, wy).map((v) => v * sh);
        } else c = sea;
      } else c = sea;
      const sy = horizon + ((camH - (e / mPerPx) * V) / z) * focal;
      if (sy >= ybuf[sx]) continue;
      const col = mixRGB(c, haze, fog);
      const yA = Math.max(0, Math.floor(sy)), yB = Math.min(SH, Math.ceil(ybuf[sx]));
      for (let y = yA; y < yB; y++) { const p = (y * SW + sx) * 4; o[p] = col[0]; o[p + 1] = col[1]; o[p + 2] = col[2]; depth[y * SW + sx] = z; }
      ybuf[sx] = sy;
    }
    z += dz; dz *= 1.0028;
    if (++step % 60 === 0) { onProgress?.(clamp((z - zNear * 0.86) / (zFar * 1.06 - zNear * 0.86), 0, 1)); await new Promise((r) => setTimeout(r)); }
  }
  const cv = new OffscreenCanvas(SW, SH);
  cv.getContext('2d').putImageData(img, 0, 0);
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const href = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  const sampleE = (lon, lat) => height(gx(lon), gy(lat));
  // screen position of a place, and whether the terrain hides it
  const project = (lon, lat) => {
    const e = sampleE(lon, lat), zz = camY - gy(lat);
    const x = SW / 2 + ((gx(lon) - camX) / zz) * focal, y = horizon + ((camH - (e / mPerPx) * V) / zz) * focal;
    const xi = Math.round(x), yi = Math.round(y) - 1;
    const hidden = xi >= 0 && xi < SW && yi >= 0 && yi < SH && depth[yi * SW + xi] < zz - zz * 0.012 - 2;
    return [x, y, hidden];
  };
  return { href, project };
}

const PANO_V = 36;
const panoCache = new Map();
export async function buildPanorama(fmt, faceKey, styleKey, data, rel, onProgress) {
  const E = setup(fmt, faceKey, styleKey), { W, H, k, ts, fs, face, FX } = E;
  const hd = header(E, 70 * k, 'Seen from above the Indian Ocean, looking north', FACTS, 0.82);
  const mx = 120 * k, fw = W - 2 * mx, fh = Math.min(fw / 1.42, (H - hd.bottom) * 0.62);
  const F = { x: mx, y: hd.bottom + fs(34), w: fw, h: fh };
  const SW = Math.round((fw / 100) * 150), SH = Math.round((fh / 100) * 150), q = fw / SW;
  const ck = `${rel.href.length}:${rel.href.slice(-64)}:${SW}x${SH}`;
  // colours are taken now: the shared palette may change while the view renders
  const pal = { sky0: mixRGB(hex(C.paper), hex(C.water), 0.5), sky1: mixRGB(hex(C.paper), [255, 255, 255], 0.15),
    haze: mixRGB(hex(C.paper), hex(C.sea), 0.35), sea: hex(C.sea) };
  if (!panoCache.has(ck)) { panoCache.clear(); panoCache.set(ck, renderPanorama(data, rel.href, SW, SH, pal, onProgress)); }
  const pano = await panoCache.get(ck);
  useStyle(styleKey);

  // route, split into seen and hidden runs
  const pts = ROUTE.map(([lo, la]) => { const [x, y, h] = pano.project(lo, la); return [F.x + x * q, F.y + y * q, h]; });
  let seen = '', hidden = '';
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay, ah] = pts[i - 1], [bx2, by2, bh] = pts[i], seg = `M${f1(ax)},${f1(ay)}L${f1(bx2)},${f1(by2)}`;
    if (ah || bh) hidden += seg; else seen += seg;
  }
  const R = 9.5 * ts, taken = [];
  const ds = STOPS.map((s, i) => { const [x, y, h] = pano.project(s.lon, s.lat); return { i, x: F.x + x * q, y: F.y + y * q, h }; });
  for (const d of ds) taken.push([d.x - R, d.y - R, d.x + R, d.y + R]);
  let marks = '', names = '';
  for (const d of [...ds].sort((a, b) => a.y - b.y)) marks += disc(d.x, d.y, d.i, R, ts, fs, d.h ? 0.6 : 1);
  const bounds = [F.x + fs(8), F.y + fs(8), F.x + F.w - fs(8), F.y + F.h - fs(8)];
  for (const d of ds.filter((d) => STOPS[d.i].key || d.i === 1)) {
    const s = STOPS[d.i], text = d.i === 1 ? 'Ayodhya' : s.key, size = fs(17);
    const L = placeLabel(d.x, d.y, R + fs(4), text, size, FELL_I, taken, bounds, ['top', 'right', 'left', 'bottom']);
    if (L) names += `<text class="place" x="${f1(L.x)}" y="${f1(L.y)}" text-anchor="${L.anchor}" style="font-size:${size}px">${esc(text)}</text>`;
  }
  // a few far names to read the view by
  let areas = '';
  for (const [text, lon, lat, size] of [['Himalaya', 87.4, 29.2, 26], ['Tibet', 88, 33.3, 22], ['Arabian Sea', 69.5, 15, 24], ['Bay of Bengal', 88.5, 16.5, 24], ['Deccan', 77.6, 17.6, 20], ['Hindustan', 79.2, 25.2, 24]]) {
    const [x, y] = pano.project(lon, lat), X = F.x + x * q, Y = F.y + y * q;
    if (X < F.x || X > F.x + F.w || Y < F.y || Y > F.y + F.h) continue;
    const cls = /Sea|Bay/.test(text) ? 'sea' : 'region';
    areas += `<text class="${cls}" x="${f1(X)}" y="${f1(Y)}" style="font-size:${fs(size)}px;letter-spacing:${fs(6)}px;paint-order:stroke;stroke:${C.paper};stroke-opacity:0.6;stroke-width:${fs(4)}px">${esc(text)}</text>`;
  }

  // key of all sixty-five, in four columns under the view
  const kY = F.y + F.h + fs(70), kH = H - fs(150) - kY, cols = 4, rows = Math.ceil(STOPS.length / cols);
  const lh = (kH - fs(50)) / rows, kSize = f1(Math.min(fs(15), lh * 0.84)), cw = fw / cols;
  let key = `<text class="key-title" x="${f1(W / 2)}" y="${f1(kY)}" style="font-size:${fs(25)}px;letter-spacing:${fs(6)}px">The Sixty-five Tirths</text>${ornamentRule(W / 2, kY + fs(14), fs(110), ts)}`;
  STOPS.forEach((s, i) => {
    const c = Math.floor(i / rows), r = i % rows, x = F.x + c * cw, y = kY + fs(50) + r * lh;
    key += `<text class="key-n" x="${f1(x + fs(28))}" y="${f1(y)}" style="font-size:${kSize}px">${s.n}.</text><text class="key-t" x="${f1(x + fs(36))}" y="${f1(y)}" style="font-size:${kSize}px">${esc(s.name)}</text>`;
  });

  return `${sheetOpen(fmt, W, H, k, ts, fs, face, FX, `<clipPath id="pano"><rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}"/></clipPath>`)}
  ${hd.svg}
  <g clip-path="url(#pano)">
    <image href="${pano.href}" x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" preserveAspectRatio="none"/>
    ${areas}
    <path d="${hidden}" fill="none" stroke="${C.red}" stroke-opacity="0.55" stroke-width="${f1(1.6 * ts)}" stroke-dasharray="${f1(2 * ts)} ${f1(4 * ts)}"/>
    ${routeStroke(seen, ts, FX, ' stroke-linecap="round"')}
    ${marks}
    ${names}
  </g>
  <rect x="${f1(F.x)}" y="${f1(F.y)}" width="${f1(F.w)}" height="${f1(F.h)}" fill="none" stroke="${C.ink}" stroke-width="${f1(1.6 * k)}"/>
  <rect x="${f1(F.x - fs(8))}" y="${f1(F.y - fs(8))}" width="${f1(F.w + fs(16))}" height="${f1(F.h + fs(16))}" fill="none" stroke="${C.ink}" stroke-width="${f1(0.7 * k)}"/>
  ${key}
  <text class="legend" x="${f1(W / 2)}" y="${f1(H - fs(108))}" text-anchor="middle" style="font-size:${fs(16)}px">Heights exaggerated about ${PANO_V} times · dotted where the route passes behind the mountains · the key gives every tirth by number</text>
  ${credits(E, fmt, 'Relief: Mapzen Terrain Tiles · Drawn in perspective from the elevation data', mx, W - mx)}
  ${sheetClose(W, H, FX)}`;
}
