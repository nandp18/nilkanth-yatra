// The night sky over a place on a given date: stars, Milky Way, constellations,
// planets and Moon from astronomy-engine, plus the Hindu lunar day (tithi) and the
// Moon's nakshatra. Renders as a 2D chart (for the card) or as a 3D sky dome
// matched to the MapLibre camera.
import * as A from 'https://unpkg.com/astronomy-engine@2.1.19/esm/astronomy.js';
import { STARS, LINES, MW, NAMES } from './data/skydata.js';

const RAD = Math.PI / 180;

// ---------- Catalog as J2000 unit vectors, computed once ----------
const NS = STARS.length / 4;
const starVec = new Float32Array(NS * 3);
const starMag = new Float32Array(NS);
const starCol = [];
for (let i = 0; i < NS; i++) {
  const ra = STARS[i * 4] * RAD, dec = STARS[i * 4 + 1] * RAD;
  starVec.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3);
  starMag[i] = STARS[i * 4 + 2];
  starCol.push(bvColor(STARS[i * 4 + 3]));
}
const toVecs = (flat) => {
  const v = new Float32Array((flat.length / 2) * 3);
  for (let i = 0; i < flat.length / 2; i++) {
    const ra = flat[i * 2] * RAD, dec = flat[i * 2 + 1] * RAD;
    v.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3);
  }
  return v;
};
const lineVecs = LINES.map(toVecs);
const mwVecs = MW.map((rings) => rings.map(toVecs));

// B–V colour index to an approximate star colour
function bvColor(bv) {
  const t = Math.max(-0.4, Math.min(2, bv));
  const r = t < 0.4 ? 0.62 + 0.38 * ((t + 0.4) / 0.8) : 1;
  const g = t < 0.4 ? 0.75 + 0.2 * ((t + 0.4) / 0.8) : 0.95 - 0.35 * ((t - 0.4) / 1.6);
  const b = t < 0.4 ? 1 : 1 - 0.55 * ((t - 0.4) / 1.6);
  return `${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}`;
}

// ---------- Calendar ----------
const NAKSHATRA = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula',
  'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'];

export function tithi(date) {
  const e = A.MoonPhase(date);                      // Sun–Moon elongation, 0..360
  const k = Math.floor(e / 12);                     // each tithi spans 12°
  return { paksha: k < 15 ? 'Shukla' : 'Krishna', day: (k % 15) + 1, elongation: e };
}

export function nakshatra(date) {
  const t = A.MakeTime(date);
  const ecl = A.Ecliptic(A.GeoVector(A.Body.Moon, t, true));
  const ayanamsa = 23.853 + (t.tt / 365.25) * (50.29 / 3600);   // Lahiri, precessing
  const sid = (((ecl.elon - ayanamsa) % 360) + 360) % 360;
  return NAKSHATRA[Math.floor(sid / (360 / 27))];
}

// Local mean solar time -> UTC. Good to a few minutes, plenty for a sky view.
export function localNight(date, lon, hour) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(d.getTime() + (hour - lon / 15) * 3600000);
}

// ---------- Sky state for a moment and place ----------
const PLANETS = [
  ['Venus', 'Shukra', '#fff4d8'], ['Jupiter', 'Guru', '#ffe7b8'], ['Mars', 'Mangala', '#ff9a6a'],
  ['Saturn', 'Shani', '#f1dfae'], ['Mercury', 'Budha', '#e8e2d6'],
];

export function computeSky(date, lat, lon) {
  const obs = new A.Observer(lat, lon, 0);
  const time = A.MakeTime(date);
  const m = A.Rotation_EQJ_HOR(time, obs).rot;     // J2000 equatorial -> horizon (x N, y W, z up)
  const rot = (v, i, out, j) => {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    // astronomy-engine stores rot[col][row]
    out[j] = m[0][0] * x + m[1][0] * y + m[2][0] * z;
    out[j + 1] = m[0][1] * x + m[1][1] * y + m[2][1] * z;
    out[j + 2] = m[0][2] * x + m[1][2] * y + m[2][2] * z;
  };
  const rotAll = (vecs) => { const o = new Float32Array(vecs.length); for (let i = 0; i < vecs.length; i += 3) rot(vecs, i, o, i); return o; };

  const horizonOf = (body) => {
    const eq = A.Equator(body, time, obs, true, true);
    const h = A.Horizon(time, obs, eq.ra, eq.dec, 'normal');
    return { alt: h.altitude, az: h.azimuth };
  };
  const sun = horizonOf(A.Body.Sun);
  const moon = horizonOf(A.Body.Moon);
  const ill = A.Illumination(A.Body.Moon, time);
  const planets = PLANETS.map(([name, skt, color]) => ({
    name, skt, color, ...horizonOf(A.Body[name]), mag: A.Illumination(A.Body[name], time).mag,
  }));

  return {
    date, lat, lon, sun, planets,
    moon: { ...moon, fraction: ill.phase_fraction, elongation: A.MoonPhase(time) },
    stars: rotAll(starVec),
    lines: lineVecs.map(rotAll),
    mw: mwVecs.map((rings) => rings.map(rotAll)),
    tithi: tithi(time),
    nakshatra: nakshatra(time),
  };
}

// Horizon vector (x N, y W, z up) from alt/az in degrees
const vecFromAltAz = (alt, az) => [Math.cos(alt * RAD) * Math.cos(az * RAD), -Math.cos(alt * RAD) * Math.sin(az * RAD), Math.sin(alt * RAD)];

// How dark the sky is: 0 in daylight, 1 once the Sun is 18° below the horizon
export const darkness = (sky) => Math.max(0, Math.min(1, (-sky.sun.alt - 2) / 16));

// ---------- Shared drawing ----------
function drawSky(ctx, sky, project, scale, opts) {
  const dark = darkness(sky);
  const moonGlare = sky.moon.alt > 0 ? sky.moon.fraction * 0.55 : 0;
  const limit = 1.2 + 4.3 * dark * (1 - moonGlare * 0.5);   // faintest visible magnitude

  // Milky Way: stacked translucent contours
  if (dark > 0.4) {
    const a = 0.035 * (dark - 0.4) / 0.6 * (1 - moonGlare);
    ctx.fillStyle = `rgba(190,205,255,${a})`;
    for (const level of sky.mw) {
      ctx.beginPath();
      for (const ring of level) {
        let started = false;
        for (let i = 0; i < ring.length; i += 3) {
          const p = project(ring[i], ring[i + 1], ring[i + 2], true);
          if (!p) { started = false; continue; }
          if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
        }
        if (opts.closeRings) ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }

  if (opts.lines) {
    ctx.beginPath();
    for (const ln of sky.lines) {
      let prev = null;
      for (let i = 0; i < ln.length; i += 3) {
        const p = ln[i + 2] > -0.02 ? project(ln[i], ln[i + 1], ln[i + 2]) : null;
        if (p && prev) { ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); }
        prev = p;
      }
    }
    ctx.strokeStyle = `rgba(150,175,225,${0.28 * dark})`;
    ctx.lineWidth = 0.7 * scale;
    ctx.stroke();
  }

  // Stars, brightest last, dimmed by atmospheric extinction near the horizon
  for (let i = NS - 1; i >= 0; i--) {
    const z = sky.stars[i * 3 + 2];
    if (z < 0) continue;
    const mag = starMag[i] + 0.25 / Math.max(z, 0.06) - 0.25;
    if (mag > limit) continue;
    const p = project(sky.stars[i * 3], sky.stars[i * 3 + 1], z);
    if (!p) continue;
    const r = Math.max(0.45, (2.9 - 0.42 * mag)) * scale;
    const a = Math.min(1, 0.25 + (limit - mag) / 2.5);
    ctx.fillStyle = `rgba(${starCol[i]},${a})`;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
    if (mag < 1.2) {
      const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r * 5);
      g.addColorStop(0, `rgba(${starCol[i]},${0.3 * a})`); g.addColorStop(1, `rgba(${starCol[i]},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p[0], p[1], r * 5, 0, 6.283); ctx.fill();
    }
  }

  const labelFont = `${11 * scale}px Inter, system-ui, sans-serif`;
  const label = (text, x, y, color) => {
    ctx.font = labelFont; ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 7 * scale, y);
  };

  if (opts.names && dark > 0.3) {
    for (const [idx, skt, west] of NAMES) {
      const z = sky.stars[idx * 3 + 2];
      if (z < 0.05) continue;
      const p = project(sky.stars[idx * 3], sky.stars[idx * 3 + 1], z);
      if (p) label(skt || west, p[0], p[1], `rgba(205,215,240,${0.7 * dark})`);
    }
  }

  for (const pl of sky.planets) {
    if (pl.alt < 0) continue;
    const v = vecFromAltAz(pl.alt, pl.az);
    const p = project(v[0], v[1], v[2]);
    if (!p) continue;
    const r = Math.max(1.6, 3.4 - 0.4 * pl.mag) * scale;
    ctx.fillStyle = pl.color;
    ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.283); ctx.fill();
    label(opts.short ? pl.skt : `${pl.skt} · ${pl.name}`, p[0], p[1], 'rgba(255,226,170,.92)');
  }

  if (sky.moon.alt > -1) {
    const v = vecFromAltAz(sky.moon.alt, sky.moon.az);
    const p = project(v[0], v[1], v[2]);
    if (p) {
      const s = vecFromAltAz(sky.sun.alt, sky.sun.az);
      const ps = project(s[0], s[1], s[2], true) || [p[0], p[1] + 100];
      drawMoon(ctx, p[0], p[1], opts.moonR * scale, sky.moon.elongation, Math.atan2(ps[1] - p[1], ps[0] - p[0]));
      label(opts.short ? 'Chandra' : 'Chandra · Moon', p[0] + opts.moonR * scale, p[1], 'rgba(255,248,225,.95)');
    }
  }
}

// Moon disc with the lit side facing the Sun
function drawMoon(ctx, x, y, r, elong, toSun) {
  const phase = elong * RAD;                        // 0 new, π full
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(toSun);
  const glow = ctx.createRadialGradient(0, 0, r, 0, 0, r * 4);
  glow.addColorStop(0, `rgba(255,250,230,${0.25 * (1 - Math.cos(phase)) / 2})`);
  glow.addColorStop(1, 'rgba(255,250,230,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 4, 0, 6.283); ctx.fill();
  ctx.fillStyle = 'rgba(60,66,80,.9)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
  // lit region: half disc towards +x, plus/minus a terminator ellipse
  const k = Math.cos(phase);                        // 1 new .. -1 full
  ctx.fillStyle = '#fbf6e6';
  ctx.beginPath();
  ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.ellipse(0, 0, Math.abs(k) * r, r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
  ctx.fill();
  ctx.restore();
}

// ---------- 2D chart: zenith at centre, horizon at the rim, north up, east left ----------
export function drawChart(canvas, sky) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const S = canvas.clientWidth;
  if (canvas.width !== S * dpr || canvas.height !== S * dpr) { canvas.width = canvas.height = S * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const c = S / 2, R = S / 2 - 16;
  ctx.clearRect(0, 0, S, S);

  const dark = darkness(sky);
  const bg = ctx.createRadialGradient(c, c, 0, c, c, R);
  bg.addColorStop(0, mix('#3d6a96', '#060b18', dark));
  bg.addColorStop(1, mix('#7aa3c8', '#111d33', dark));
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.arc(c, c, R, 0, 6.283); ctx.fill();

  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, R, 0, 6.283); ctx.clip();
  // below-horizon points (loose) land outside the rim and are clipped, keeping rings continuous
  const project = (x, y, z, loose) => {
    if (!loose && z < -0.01) return null;
    const alt = Math.asin(Math.max(-1, Math.min(1, z))), az = Math.atan2(-y, x);
    const r = (1 - alt / (Math.PI / 2)) * R;
    return [c - r * Math.sin(az), c - r * Math.cos(az)];
  };
  drawSky(ctx, sky, project, S / 300, { lines: true, names: true, moonR: 5, closeRings: true, short: true });
  ctx.restore();

  ctx.strokeStyle = 'rgba(30,26,22,.85)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(c, c, R, 0, 6.283); ctx.stroke();
  ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.fillStyle = '#4a433b';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  [['N', 0, -1], ['E', -1, 0], ['S', 0, 1], ['W', 1, 0]].forEach(([t, dx, dy]) => ctx.fillText(t, c + dx * (R + 9), c + dy * (R + 9)));
}

function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

// ---------- 3D: project onto the screen using the MapLibre camera ----------
// The map canvas is transparent above the horizon, so this canvas sits behind it
// and the terrain itself hides stars behind mountains.
export function drawDome(canvas, sky, cam) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const dark = darkness(sky);

  // camera basis in horizon coords (x N, y W, z up); pitch measured from straight down
  const az = cam.bearing * RAD, alt = (cam.pitch - 90) * RAD;
  const fwd = [Math.cos(alt) * Math.cos(az), -Math.cos(alt) * Math.sin(az), Math.sin(alt)];
  const right = [-Math.sin(az), -Math.cos(az), 0];                 // 90° clockwise of forward (east when facing north)
  const up = [fwd[1] * right[2] - fwd[2] * right[1], fwd[2] * right[0] - fwd[0] * right[2], fwd[0] * right[1] - fwd[1] * right[0]];
  if (up[2] < 0) up.forEach((_, i) => (up[i] = -up[i]));
  const f = (H / 2) / Math.tan((cam.fov * RAD) / 2);

  const project = (x, y, z, loose) => {
    const zc = x * fwd[0] + y * fwd[1] + z * fwd[2];
    if (zc < 0.05) return null;
    if (!loose && z < -0.02) return null;
    return [W / 2 + (f * (x * right[0] + y * right[1] + z * right[2])) / zc, H / 2 - (f * (x * up[0] + y * up[1] + z * up[2])) / zc];
  };

  // sky gradient: zenith to horizon, twilight-aware
  const hz = project(fwd[0], fwd[1], 0, true);
  const yH = hz ? hz[1] : H;
  const g = ctx.createLinearGradient(0, yH - H, 0, yH);
  g.addColorStop(0, mix('#4f86bd', '#03060f', dark));
  g.addColorStop(0.75, mix('#8db7dc', '#0b1426', dark));
  g.addColorStop(1, mix('#f1c9a0', '#1d2a44', dark));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  drawSky(ctx, sky, project, 1.25, { lines: cam.lines, names: true, moonR: 9 });
}
