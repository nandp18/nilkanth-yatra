// Lightweight weather overlay: a single 2D canvas drawn at CSS-pixel resolution,
// plus a tint layer. Effects crossfade; the loop sleeps when nothing is visible.

const MAX = { snow: 380, rain: 520, heat: 40, mist: 7, clear: 0 };

export const WEATHER_LABEL = {
  snow: 'Snowfall',
  flurries: 'Light snow',
  rain: 'Monsoon rain',
  mist: 'Hill mist',
  heat: 'Heat haze',
  clear: 'Clear skies',
};

// Fog/sky per condition, merged over the map theme's sky
export const WEATHER_SKY = {
  snow: { 'sky-color': '#c4d2dd', 'horizon-color': '#f1f4f7', 'fog-color': '#e8edf2', 'horizon-fog-blend': 0.95, 'fog-ground-blend': 0.5 },
  rain: { 'sky-color': '#8e9daa', 'horizon-color': '#c0c8ce', 'fog-color': '#b9c2c8', 'horizon-fog-blend': 0.95, 'fog-ground-blend': 0.45 },
  mist: { 'sky-color': '#cdd6db', 'horizon-color': '#efeee9', 'fog-color': '#ebeae4', 'horizon-fog-blend': 1, 'fog-ground-blend': 0.55 },
  heat: { 'sky-color': '#a9c6dc', 'horizon-color': '#f6e6cb', 'fog-color': '#f1e1c4', 'horizon-fog-blend': 0.8 },
  clear: {},
};

export class WeatherFX {
  constructor(canvas, tint) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tint = tint;
    this.type = 'clear';      // what is currently drawn
    this.target = 'clear';
    this.level = 0;           // 0..1 visible strength of `type`
    this.targetLevel = 0;
    this.particles = [];
    this.running = false;
    this.last = 0;
    this.enabled = true;
    this.light = true;        // light basemap (Atlas) needs darker particles to read
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.w = this.canvas.width = Math.round(r.width);
    this.h = this.canvas.height = Math.round(r.height);
  }

  set(kind, intensity) {
    const type = kind === 'flurries' ? 'snow' : kind;
    this.target = this.enabled ? type : 'clear';
    this.targetLevel = this.enabled ? intensity : 0;
    if (!this.running && (this.targetLevel > 0 || this.level > 0)) {
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame((t) => this.frame(t));
    }
  }

  setLightBasemap(on) { this.light = on; }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.set('clear', 0);
  }

  spawn(type, fresh) {
    const { w, h } = this;
    const y = fresh ? Math.random() * h : -20;
    if (type === 'snow') {
      const z = Math.random();                       // depth: 0 far, 1 near
      return { x: Math.random() * w, y, z, r: 0.8 + z * 2.8, vy: 22 + z * 60, ph: Math.random() * 6.28, sw: 8 + z * 22 };
    }
    if (type === 'rain') {
      const z = Math.random();
      return { x: Math.random() * (w + 200) - 100, y: fresh ? y : -40, z, len: 10 + z * 18, vy: 650 + z * 500 };
    }
    if (type === 'heat') {
      return { x: Math.random() * w, y: Math.random() * h, r: 1 + Math.random() * 1.6, vx: 6 + Math.random() * 10, vy: -4 - Math.random() * 6, ph: Math.random() * 6.28 };
    }
    if (type === 'mist') {
      return { x: Math.random() * w, y: h * (0.25 + Math.random() * 0.7), rx: w * (0.25 + Math.random() * 0.3), ry: h * (0.08 + Math.random() * 0.1), vx: 6 + Math.random() * 10 };
    }
    return null;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    // Crossfade: fade out the old effect before bringing in a new one
    const goal = this.type === this.target ? this.targetLevel : 0;
    this.level += (goal - this.level) * Math.min(1, dt * 2.6);
    if (this.type !== this.target && this.level < 0.02) {
      this.type = this.target;
      this.level = 0;
      this.particles = [];
    }
    this.tint.dataset.wx = this.type;
    this.tint.style.opacity = this.level.toFixed(3);

    const want = Math.round((MAX[this.type] || 0) * Math.min(1, this.level * 1.2));
    while (this.particles.length < want) this.particles.push(this.spawn(this.type, true));
    if (this.particles.length > want) this.particles.length = want;

    this.draw(dt, now / 1000);

    if (this.level < 0.005 && this.targetLevel === 0 && this.type === this.target) {
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.running = false;
      return;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  draw(dt, t) {
    const { ctx, w, h, particles: ps } = this;
    ctx.clearRect(0, 0, w, h);
    const a = this.level;

    if (this.type === 'snow') {
      // three depth bands, one path each, to keep fill calls low
      for (let band = 0; band < 3; band++) {
        ctx.beginPath();
        for (const p of ps) {
          if (Math.min(2, Math.floor(p.z * 3)) !== band) continue;
          p.y += p.vy * dt;
          p.x += Math.sin(t * 0.8 + p.ph) * p.sw * dt + (10 + 10 * band) * dt;  // nearer flakes drift faster
          if (p.y > h + 10 || p.x > w + 10) Object.assign(p, this.spawn('snow', false), { x: Math.random() * w });
          ctx.moveTo(p.x + p.r, p.y);
          ctx.arc(p.x, p.y, p.r, 0, 6.283);
        }
        ctx.fillStyle = `rgba(255,255,255,${(0.55 + band * 0.2) * a})`;
        ctx.fill();
        if (this.light) {          // hairline edge so flakes read against snowy relief
          ctx.strokeStyle = `rgba(70,92,115,${(0.22 + band * 0.1) * a})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
    } else if (this.type === 'rain') {
      ctx.beginPath();
      for (const p of ps) {
        p.y += p.vy * dt;
        p.x += p.vy * 0.18 * dt;
        if (p.y > h + 20) Object.assign(p, this.spawn('rain', false));
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.len * 0.18, p.y - p.len);
      }
      ctx.strokeStyle = this.light ? `rgba(52,78,104,${0.42 * a})` : `rgba(214,226,236,${0.55 * a})`;
      ctx.lineWidth = this.light ? 0.9 : 1;
      ctx.stroke();
    } else if (this.type === 'heat') {
      ctx.beginPath();
      for (const p of ps) {
        p.x += p.vx * dt + Math.sin(t + p.ph) * 4 * dt;
        p.y += p.vy * dt;
        if (p.x > w + 5 || p.y < -5) Object.assign(p, this.spawn('heat', false), { x: -5, y: Math.random() * h });
        ctx.moveTo(p.x + p.r, p.y);
        ctx.arc(p.x, p.y, p.r, 0, 6.283);
      }
      ctx.fillStyle = this.light ? `rgba(196,128,52,${0.35 * a})` : `rgba(255,236,200,${0.5 * a})`;
      ctx.fill();
    } else if (this.type === 'mist') {
      for (const p of ps) {
        p.x += p.vx * dt;
        if (p.x - p.rx > w) p.x = -p.rx;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rx);
        g.addColorStop(0, `rgba(255,255,255,${0.5 * a})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(1, p.ry / p.rx);
        ctx.translate(-p.x, -p.y);
        ctx.fillRect(p.x - p.rx, p.y - p.rx, p.rx * 2, p.rx * 2);
        ctx.restore();
      }
    }
  }
}

// ---------- Elevation sampling straight from the Terrarium tiles ----------
const ELEV_Z = 10;
const tiles = new Map();   // key -> Promise<Uint8ClampedArray>, insertion-ordered for LRU

function tile(url, z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tiles.has(key)) {
    const p = tiles.get(key);
    tiles.delete(key);
    tiles.set(key, p);
    return p;
  }
  const p = fetch(url.replace('{z}', z).replace('{x}', x).replace('{y}', y))
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
    .then((bmp) => {
      const c = new OffscreenCanvas(256, 256);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, 256, 256).data;
    })
    .catch(() => { tiles.delete(key); return null; });
  tiles.set(key, p);
  if (tiles.size > 48) tiles.delete(tiles.keys().next().value);
  return p;
}

export async function elevationAt(url, [lon, lat]) {
  const n = 2 ** ELEV_Z;
  const x = ((lon + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const tx = Math.floor(x), ty = Math.floor(y);
  const d = await tile(url, ELEV_Z, tx, ty);
  if (!d) return null;
  const px = Math.min(255, Math.floor((x - tx) * 256));
  const py = Math.min(255, Math.floor((y - ty) * 256));
  const i = (py * 256 + px) * 4;
  return d[i] * 256 + d[i + 1] + d[i + 2] / 256 - 32768;
}
