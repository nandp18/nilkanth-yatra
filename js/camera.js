// Cinematic camera for MapLibre, after the feel of watched.earth:
//  - flights last 1.4–3.6 s, scaled by how far and how much the zoom changes;
//  - zoom moves in log space with a pull-back arc on long hops, and the camera
//    flattens its pitch while it is pulled back, then tilts in again on arrival;
//  - the centre moves at a constant *screen* speed, so most of the travel
//    happens while zoomed out (no smear of tiles at street level);
//  - a new flight started mid-air keeps the current velocity (no jolt when
//    you tap "next" twice);
//  - the height of the ground under the centre is smoothed, so the camera
//    doesn't bob or pop as finer terrain tiles arrive;
//  - one render per frame, drawn in the same frame as the HTML markers move.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const shortest = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

// Hermite ease from u=0 to 1 with initial slope s0 (in units of u per unit t) and zero end slope
const hermite = (s0) => (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const t2 = t * t, t3 = t2 * t;
  return 3 * t2 - 2 * t3 + s0 * (t3 - 2 * t2 + t);
};
const hermiteSlope = (s0, t) => {
  if (t <= 0) return s0;
  if (t >= 1) return 0;
  return 6 * t - 6 * t * t + s0 * (3 * t * t - 4 * t + 1);
};

// Critically damped spring, exact step
export function spring(x, v, target, omega, dt) {
  const d = x - target, e = Math.exp(-omega * dt);
  return [target + (d + (v + omega * d) * dt) * e, (v - omega * (v + omega * d) * dt) * e];
}

const padEq = (a, b) => a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right;
const padLerp = (a, b, t) => ({
  top: lerp(a.top, b.top, t), bottom: lerp(a.bottom, b.bottom, t),
  left: lerp(a.left, b.left, t), right: lerp(a.right, b.right, t),
});

export class Camera {
  constructor(map, { reducedMotion = false } = {}) {
    this.map = map;
    this.reducedMotion = reducedMotion;
    this.flight = null;
    this.raf = 0;
    this.elev = null;          // smoothed centre elevation (m, exaggerated)
    this.elevV = 0;
    this.settle = 0;           // seconds left to keep smoothing after a flight
    this.listeners = new Set();
    this.busy = false;
    this.settleToken = 0;
    // Any direct manipulation cancels the flight and hands the ground straight back to
    // MapLibre (no settling: its drag and inertia handlers own the camera now)
    const stop = () => {
      if (!this.busy && !this.flight) return;
      this.cancel(false);
      this._setBusy(false);
      map.setCenterClampedToGround(true);
    };
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) =>
      map.getCanvasContainer().addEventListener(ev, stop, { passive: true }));
  }

  /** Subscribe to busy-state changes: fn(true) when the camera starts driving, fn(false) when it lets go. */
  onBusy(fn) { this.listeners.add(fn); }
  _setBusy(on) {
    if (on === this.busy) return;
    this.busy = on;
    // Tell MapLibre the view is in motion, as its own flyTo does: it then spreads
    // raster tile decoding over frames instead of landing a burst in one frame,
    // and holds 'idle' until we stop. (jumpTo alone leaves the map "at rest".)
    this.map._moving = on;
    if (!on) this.map.triggerRepaint();
    this.listeners.forEach((fn) => fn(on));
  }

  pose() {
    const m = this.map;
    const c = m.getCenter();
    return { center: [c.lng, c.lat], zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), padding: m.getPadding() };
  }

  /** Smoothed ground height under `lngLat`. Call once per frame while driving the camera. */
  groundAt(lngLat, dt) {
    const raw = this.map.queryTerrainElevation(lngLat);
    if (raw == null) return null;                     // terrain off
    if (this.elev == null) { this.elev = raw; this.elevV = 0; }
    [this.elev, this.elevV] = spring(this.elev, this.elevV, raw, 3.2, dt);
    return this.elev;
  }

  /**
   * Put the camera at `opts` this frame, with a smoothed ground height, and draw now.
   * Used by the flight loop and by the playback follow-cam.
   */
  frame(opts, dt) {
    const m = this.map;
    if (m.getTerrain()) {
      if (m.getCenterClampedToGround()) {
        m.setCenterClampedToGround(false);
        this.elev = m.transform.elevation;            // start from where MapLibre had it
        this.elevV = 0;
      }
      const e = this.groundAt(opts.center, dt);
      if (e != null) opts.elevation = e;
    }
    m.jumpTo(opts);
    m.redraw();
  }

  /** Hand the ground back to MapLibre once the smoothed height has caught up. */
  release() {
    this._setBusy(false);
    const m = this.map;
    if (m.getCenterClampedToGround() || !m.getTerrain()) { m.setCenterClampedToGround(true); return; }
    this.settle = 1.5;
    const token = ++this.settleToken;
    let last = performance.now();
    const step = (now) => {
      if (this.flight || this.busy || token !== this.settleToken) return;   // something else took over
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      this.settle -= dt;
      const raw = m.queryTerrainElevation(m.getCenter());
      if (raw == null || this.settle <= 0 || Math.abs(raw - this.elev) < 1) {
        m.setCenterClampedToGround(true);
        m.triggerRepaint();
        return;
      }
      [this.elev, this.elevV] = spring(this.elev, this.elevV, raw, 3.2, dt);
      m.jumpTo({ elevation: this.elev });
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Stop driving entirely and leave the ground setting alone (look-up mode owns the camera). */
  detach() { this.cancel(false); this.settleToken++; this._setBusy(false); }

  /** Used by the playback engine: mark the camera as driven without a flight. */
  hold() { this.cancel(false); this._setBusy(true); }

  cancel(release = true) {
    const f = this.flight;
    if (f) { this.flight = null; cancelAnimationFrame(this.raf); f.resolve(false); }
    if (release && this.busy) this.release();
  }

  /**
   * Fly to {center, zoom, pitch, bearing, padding}. Resolves true on arrival, false if interrupted.
   * `speed` scales the duration (playback speed); `duration` (ms) overrides it.
   */
  flyTo(target, { speed = 1, duration } = {}) {
    const m = this.map;
    const prev = this.flight;
    const now = performance.now();
    const from = this.pose();
    const to = {
      center: target.center ? [target.center[0] ?? target.center.lng, target.center[1] ?? target.center.lat] : from.center,
      zoom: target.zoom ?? from.zoom,
      pitch: target.pitch ?? from.pitch,
      bearing: shortest(from.bearing, target.bearing ?? from.bearing),
      padding: { ...from.padding, ...(target.padding || {}) },
    };

    const M = maplibregl.MercatorCoordinate;
    const a = M.fromLngLat(from.center), b = M.fromLngLat(to.center);
    // longitudes: take the short way round
    let bx = b.x;
    if (bx - a.x > 0.5) bx -= 1; else if (a.x - bx > 0.5) bx += 1;
    const dx = bx - a.x, dy = b.y - a.y;
    const dWorld = Math.hypot(dx, dy) * 512;          // px at zoom 0
    const { clientWidth: W, clientHeight: H } = m.getContainer();
    const view = Math.max(200, Math.min(W, H));

    // Pull back far enough that both ends would fit in ~60% of the view
    const zFit = dWorld > 0 ? Math.log2((0.6 * view) / dWorld) : Infinity;
    const bump = this.reducedMotion ? 0 : Math.max(0, Math.min(from.zoom, to.zoom) - zFit);
    const flatten = clamp(bump / 1.5, 0, 1) * 0.75;

    // Duration: how far on screen (at the closer zoom) plus how much the zoom changes
    const screen = dWorld * 2 ** Math.max(from.zoom, to.zoom) / Math.hypot(W, H);
    const dz = Math.abs(to.zoom - from.zoom) + bump;
    let secs = lerp(1.4, 2.4, clamp(screen / 1.5, 0, 1)) + 1.2 * clamp(dz / 4, 0, 1);
    if (screen < 0.02 && dz < 0.05 && Math.abs(to.pitch - from.pitch) < 1 && Math.abs(to.bearing - from.bearing) < 1) secs = 0.6;
    secs /= speed;
    if (duration != null) secs = duration / 1000;
    if (this.reducedMotion) secs = Math.min(secs, 0.8);

    // Velocity carried over from a flight already in the air
    let s0 = 0;
    if (prev) {
      const t = clamp((now - prev.start) / prev.dur, 0, 1);
      const du = hermiteSlope(prev.s0, t) / prev.dur;   // u per ms in the old flight
      const pd = Math.hypot(prev.dx, prev.dy) || 1e-9, nd = Math.hypot(dx, dy) || 1e-9;
      const cos = (prev.dx * dx + prev.dy * dy) / (pd * nd);
      s0 = clamp(du * secs * 1000 * Math.max(0, cos) * Math.min(1, pd / nd), 0, 2.5);
      this.flight = null;
      cancelAnimationFrame(this.raf);
      prev.resolve(false);
    }

    // Centre progress follows screen distance: weight each step by 2^-zoom
    const zoomAt = (u) => lerp(from.zoom, to.zoom, u) - bump * Math.sin(Math.PI * u);
    const N = 96, cum = new Float64Array(N + 1);
    for (let k = 1; k <= N; k++) {
      const um = (k - 0.5) / N;
      cum[k] = cum[k - 1] + 2 ** -zoomAt(um);
    }
    const total = cum[N] || 1;
    const centreAt = (u) => {
      const f = u * N, k = Math.min(N - 1, Math.floor(f));
      return (cum[k] + (cum[k + 1] - cum[k]) * (f - k)) / total;
    };
    // Tilt in on the second half when pitching up, out on the first half when flattening
    const pitchEase = (u) => smooth(to.pitch > from.pitch + 0.1 ? clamp((u - 0.4) / 0.6, 0, 1)
      : to.pitch < from.pitch - 0.1 ? clamp(u / 0.6, 0, 1) : u);

    return new Promise((resolve) => {
      const flight = { start: now, dur: Math.max(1, secs * 1000), s0, dx, dy, resolve };
      const ease = hermite(s0);
      this.flight = flight;
      this._setBusy(true);
      let last = now;
      const step = (t) => {
        if (this.flight !== flight) return;
        // request the next frame first, so our redraw() cancels MapLibre's own
        // scheduled render instead of running in addition to it
        this.raf = requestAnimationFrame(step);
        const dt = Math.min(0.05, Math.max(0, t - last) / 1000); last = t;
        const k = clamp((t - flight.start) / flight.dur, 0, 1);
        const u = ease(k);
        const c = centreAt(u);
        const ll = new M(a.x + dx * c, a.y + dy * c).toLngLat();
        const s = Math.sin(Math.PI * u);
        this.frame({
          center: [ll.lng, ll.lat],
          zoom: zoomAt(u),
          pitch: lerp(from.pitch, to.pitch, pitchEase(u)) * (1 - flatten * s),
          bearing: lerp(from.bearing, to.bearing, u),
          padding: padEq(from.padding, to.padding) ? to.padding : padLerp(from.padding, to.padding, smooth(k)),
        }, dt);
        if (k >= 1) {
          cancelAnimationFrame(this.raf);
          this.flight = null;
          this.release();
          resolve(true);
        }
      };
      this.raf = requestAnimationFrame(step);
    });
  }
}
