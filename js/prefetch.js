// Warm the HTTP cache with the tiles a camera move is about to need, so they are
// already on disk when MapLibre asks for them on arrival. Low priority, capped,
// and each URL is fetched at most once per page load.

const seen = new Set();
const queue = [];
let inFlight = 0;
const MAX_IN_FLIGHT = 6;
const MAX_SEEN = 4000;

function pump() {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const url = queue.shift();
    inFlight++;
    fetch(url, { priority: 'low', mode: 'cors', credentials: 'same-origin' })
      .then((r) => r.arrayBuffer())   // read the body so it is fully cached
      .catch(() => seen.delete(url))
      .finally(() => { inFlight--; pump(); });
  }
}

const tileXY = ([lon, lat], z) => {
  const n = 2 ** z, r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};

/**
 * Queue the tiles of each template around `lngLat` for a map zoom of `zoom`.
 * templates: [{ url: 'https://…/{z}/{x}/{y}.png', maxzoom, tileSize }]
 * radius: tiles each side at the main level (the parent level gets half).
 * front: true puts these ahead of anything already queued (the destination of a flight).
 */
export function prefetchAround(templates, lngLat, zoom, { radius = 2, front = false } = {}) {
  if (navigator.connection?.saveData) return;
  const urls = [];
  for (const { url, maxzoom = 14, tileSize = 256 } of templates) {
    // MapLibre zoom is defined on 512 px tiles, so 256 px tiles sit one level deeper
    const z0 = Math.min(maxzoom, Math.max(0, Math.round(zoom + (tileSize === 256 ? 1 : 0))));
    for (const [z, rad] of [[z0, radius], [z0 - 1, Math.ceil(radius / 2)]]) {
      if (z < 0) continue;
      const n = 2 ** z;
      const [cx, cy] = tileXY(lngLat, z).map(Math.floor);
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const y = cy + dy;
          if (y < 0 || y >= n) continue;
          const x = (((cx + dx) % n) + n) % n;
          const u = url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
          if (seen.has(u)) continue;
          seen.add(u);
          urls.push(u);
        }
      }
    }
  }
  if (seen.size > MAX_SEEN) seen.clear();
  if (front) queue.unshift(...urls); else queue.push(...urls);
  if (queue.length > 400) queue.length = 400;     // drop the stalest look-ahead work
  pump();
}
