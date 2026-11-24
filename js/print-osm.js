// Print edition: OpenStreetMap detail for the any-place sheets, from OpenFreeMap's vector tiles
// (the same tiles the interactive map uses). Roads, railways, rivers, lakes and towns, chosen
// by the sheet's scale, plus parks, district lines and river names for the period styles.
// Tiles are Mapbox Vector Tiles (protobuf), decoded here.

const OFM = 'https://tiles.openfreemap.org/planet';
const RAD = Math.PI / 180;

// What each scale shows (km = distance across the sheet). Wider sheets take fewer classes.
export function osmPlan(km) {
  if (km > 400) return null;                                       // Natural Earth suits the wide views
  const city = km <= 40, region = km <= 150;
  return {
    roads: city ? ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor']
      : region ? ['motorway', 'trunk', 'primary'] : ['motorway', 'trunk'],
    rail: region,
    waterways: city ? ['river', 'canal', 'stream'] : region ? ['river', 'canal'] : ['river'],
    places: city ? ['city', 'town', 'village', 'suburb', 'quarter'] : region ? ['city', 'town', 'village'] : ['city', 'town'],
    parks: region,
    // admin levels: 4 state or province, 6 county, 7–8 township or city, 10 ward or neighbourhood
    bounds: city ? [4, 6, 7, 8, 10] : region ? [4, 6] : [2, 4],
  };
}

// Importance of each kind of place: the sheet labels the lowest first; 2 and under are set large
const PLACE_RANK = { city: 2, town: 4, suburb: 5, village: 6, quarter: 7 };
const WATER = new Set(['lake', 'river', 'dock']);                    // the sea comes from the traced coast
// Green ground: city parks and playing fields (landcover), cemeteries (landuse), reserves (park)
const GREEN = { landcover: new Set(['park', 'recreation_ground', 'golf_course', 'garden']), landuse: new Set(['cemetery']),
  park: new Set(['national_park', 'state_park', 'nature_reserve', 'conservation', 'protected_area', 'park']) };
const OPEN_WATER = new Set(['ocean', 'river', 'lake']);
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}\p{M}]+$/u;

// Tile zoom: about three tiles across the sheet, fewer if the sheet would need too many
function tileZoom(pad, lat, km) {
  let z = Math.max(5, Math.min(14, Math.round(Math.log2((40075 * Math.cos(lat * RAD) * 3) / km))));
  while (z > 5 && tileRange(z, pad).count > 36) z--;
  return z;
}
function tileRange(z, ext) {
  const n = 2 ** z, tx = (lon) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat) => Math.floor(((1 - Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / Math.PI) / 2) * n);
  const x0 = Math.max(0, tx(ext.lon0)), x1 = Math.min(n - 1, tx(ext.lon1)), y0 = Math.max(0, ty(ext.lat1)), y1 = Math.min(n - 1, ty(ext.lat0));
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

let tileUrl = null;
const tileCache = new Map();                                      // the last 160 decoded tiles
const BASE = ['transportation', 'waterway', 'water', 'place', 'landcover', 'landuse', 'park', 'boundary'];
function tile(z, x, y, layers = BASE) {
  const key = `${z}/${x}/${y}/${layers === BASE ? '' : layers.join()}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      tileUrl ||= fetch(OFM).then((r) => r.json()).then((j) => j.tiles[0]).catch((e) => { tileUrl = null; throw e; });
      const res = await fetch((await tileUrl).replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (!res.ok) throw new Error(`tile ${key}: ${res.status}`);
      return decode(new Uint8Array(await res.arrayBuffer()), layers);
    })().catch((e) => { tileCache.delete(key); throw e; }));         // a failed tile is fetched again next time
    while (tileCache.size > 160) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(key);
}

// Fetch and sort the detail for an extent. Lines and rings are flat [lon, lat, …] arrays, like the
// rest of the any-place data. Throws if the tiles can't be reached (the caller falls back).
export async function osmDetail(ext, pad, km, plan) {
  const lat = (ext.lat0 + ext.lat1) / 2, z = tileZoom(pad, lat, km), { x0, x1, y0, y1 } = tileRange(z, pad), n = 2 ** z;
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push(tile(z, x, y).then((t) => [x, y, t]));
  const tiles = await Promise.all(jobs);

  const roads = Object.fromEntries(plan.roads.map((c) => [c, []])), rail = [], waterways = Object.fromEntries(plan.waterways.map((c) => [c, []]));
  const water = [], places = [], parks = [], bounds = [], named = new Map(), seen = new Set();
  const wantRoad = new Set(plan.roads), wantWay = new Set(plan.waterways), wantPlace = new Set(plan.places), wantBound = new Set(plan.bounds);
  for (const [tx, ty, layers] of tiles) {
    for (const [name, L] of Object.entries(layers)) {
      const toLon = (gx) => ((tx + gx / L.extent) / n) * 360 - 180;
      const toLat = (gy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + gy / L.extent)) / n))) / RAD;
      const lonLat = (part, tol) => {
        const p = tol ? simplify(part, tol) : part, out = new Array(p.length);
        for (let i = 0; i < p.length; i += 2) { out[i] = toLon(p[i]); out[i + 1] = toLat(p[i + 1]); }
        return out;
      };
      const tol = L.extent / 1500;                                 // well under a printed hairline
      for (const f of L.features) {
        const p = f.props;
        if (name === 'transportation') {
          if (p.brunnel === 'tunnel' || p.ramp) continue;
          if (wantRoad.has(p.class)) { for (const g of f.geometry()) if (g.length >= 4) roads[p.class].push(lonLat(g, tol)); }
          else if (plan.rail && p.class === 'rail' && (!p.subclass || p.subclass === 'rail')) for (const g of f.geometry()) if (g.length >= 4) rail.push(lonLat(g, tol));
        } else if (name === 'waterway') {
          if (!wantWay.has(p.class) || p.brunnel === 'tunnel') continue;
          const label = (p.class === 'river' || p.class === 'canal') && (p['name:en'] || p.name_en || p.name);
          for (const g of f.geometry()) {
            if (g.length < 4) continue;
            const line = lonLat(g, tol);
            waterways[p.class].push(line);
            if (label && LATIN.test(label)) (named.get(label) || named.set(label, []).get(label)).push(line);
          }
        } else if (GREEN[name]) {
          const cls = name === 'landcover' ? p.subclass : p.class;
          if (plan.parks && f.type === 3 && GREEN[name].has(cls)) parks.push(f.geometry().filter((g) => g.length >= 6).map((g) => lonLat(g, tol)));
        } else if (name === 'boundary') {
          if (wantBound.has(p.admin_level) && !p.maritime && !p.disputed) for (const g of f.geometry()) if (g.length >= 4) bounds.push({ level: p.admin_level, line: lonLat(g, tol) });
        } else if (name === 'water') {
          if (WATER.has(p.class) && f.type === 3) water.push(f.geometry().filter((g) => g.length >= 6).map((g) => lonLat(g, tol)));
        } else if (name === 'place' && f.type === 1 && wantPlace.has(p.class)) {
          // English or transliterated names: the chart's typefaces are Latin only
          const label = p['name:en'] || p.name_en || p['name:latin'] || p.name_int || p.name;
          const [g] = f.geometry(), lon = toLon(g[0]), la = toLat(g[1]);
          if (!label || !LATIN.test(label) || !(lon > ext.lon0 && lon < ext.lon1 && la > ext.lat0 && la < ext.lat1)) continue;
          const key = `${label}|${lon.toFixed(2)}|${la.toFixed(2)}`;                 // a label can sit in two tiles' buffers
          if (seen.has(key)) continue;
          seen.add(key);
          // US townships are tagged as towns but are areas, not settlements: name them only if there's room
          const rank = (PLACE_RANK[p.class] ?? 8) + (/ Township$/.test(label) ? 3 : 0);
          places.push({ name: label, lon, lat: la, rank, order: p.rank ?? 99, pop: 0 });
        }
      }
    }
  }
  places.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { roads, rail, waterways, water, places, parks, bounds, named };
}

// ---------- Gazetteer: neighbourhoods, landmarks and public grounds ----------
// The pocket-atlas plans named each quarter of the city in spaced capitals and marked the
// churches, halls and public buildings with a small drawn house. Those names live in the
// detailed (z14) tiles; a sheet too wide for that many tiles takes z13, which still has the
// suburbs, the stations and the historic sites.
const DISTRICT = { suburb: 1, quarter: 2, neighbourhood: 3 };
// poi class → [glyph, priority]; lower priorities are placed first
const LANDMARK = {
  museum: ['hall', 1], town_hall: ['hall', 1], castle: ['hall', 1], monument: ['monument', 2], college: ['hall', 2],
  stadium: ['hall', 3], place_of_worship: ['church', 3], hospital: ['hall', 3], railway: ['station', 3],
  attraction: ['hall', 4], park: ['park', 4], library: ['hall', 5], theatre: ['hall', 5],
};
const SITE = { historic_site: 0, 'World Heritage Site': 0, 'National Memorial': 0, national_park: 0, state_park: 1, park: 3 };
const GROUNDS = new Set(['university', 'college', 'school', 'hospital', 'stadium', 'library']);
// Names that aren't landmarks: playing fields and play lots tagged as parks, buildings on a campus
const MINOR = {
  park: /play ?(lot|ground)|field|courts?$|recreation|rec cent|dog|tot lot|garden$/i,
  college: /^(?!.*(universit|college|institute|academy|seminary|school of))/i,
  library: /school|branch|reading room/i,
};
const LABEL_LAYERS = ['place', 'poi', 'park', 'landuse', 'transportation_name'];
// Streets named along their course: the avenues and main streets, not every lane
const STREET = { trunk: 1, primary: 1, secondary: 2, tertiary: 3 };
const nameOf = (p) => p['name:en'] || p.name_en || p['name:latin'] || p.name_int || p.name;

export async function osmLandmarks(ext, pad, km) {
  if (km > 40) return null;
  const lat = (ext.lat0 + ext.lat1) / 2;
  let z = Math.max(13, tileZoom(pad, lat, km));
  if (z < 14 && tileRange(14, pad).count <= 90) z = 14;
  const { x0, x1, y0, y1 } = tileRange(z, pad), n = 2 ** z, jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push(tile(z, x, y, LABEL_LAYERS).then((t) => [x, y, t]));
  const districts = [], landmarks = [], grounds = [], streets = new Map(), seen = new Set();
  const inside = (lon, la) => lon > ext.lon0 && lon < ext.lon1 && la > ext.lat0 && la < ext.lat1;
  for (const [tx, ty, layers] of await Promise.all(jobs)) {
    for (const [name, L] of Object.entries(layers)) {
      const toLon = (gx) => ((tx + gx / L.extent) / n) * 360 - 180;
      const toLat = (gy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + gy / L.extent)) / n))) / RAD;
      for (const f of L.features) {
        const p = f.props;
        if (name === 'landuse') {
          if (f.type === 3 && GROUNDS.has(p.class)) grounds.push(f.geometry().filter((g) => g.length >= 6).map((g) => {
            const s = simplify(g, L.extent / 1500), o = new Array(s.length);
            for (let i = 0; i < s.length; i += 2) { o[i] = toLon(s[i]); o[i + 1] = toLat(s[i + 1]); }
            return o;
          }));
          continue;
        }
        if (name === 'transportation_name') {
          const label = p.name;                                // the local name: a street sign, not a translation
          if (f.type !== 2 || !STREET[p.class] || !label || !LATIN.test(label) || p.brunnel === 'tunnel') continue;
          const st = streets.get(label) || streets.set(label, { name: label, rank: STREET[p.class], parts: [] }).get(label);
          st.rank = Math.min(st.rank, STREET[p.class]);
          for (const g of f.geometry()) if (g.length >= 4) {
            const o = new Array(g.length);
            for (let i = 0; i < g.length; i += 2) { o[i] = toLon(g[i]); o[i + 1] = toLat(g[i + 1]); }
            st.parts.push(o);
          }
          continue;
        }
        if (f.type !== 1) continue;                            // labels are points (the park layer also has its outlines)
        const label = nameOf(p);
        if (!label || !LATIN.test(label) || label.length > 34) continue;
        const [g] = f.geometry(), lon = toLon(g[0]), la = toLat(g[1]);
        if (!inside(lon, la) || seen.has(label)) continue;     // one mark per name: tiles overlap, and sites come as point and area
        if (name === 'place') {
          if (!DISTRICT[p.class]) continue;
          districts.push({ name: label, lon, lat: la, kind: DISTRICT[p.class], order: p.rank ?? 99 });
        } else if (name === 'park') {
          if (!(p.class in SITE)) continue;
          landmarks.push({ name: label.replace(/ World Heritage Site$/, ''), lon, lat: la, cls: 'site', pri: SITE[p.class], order: 0,
            glyph: /Memorial/.test(p.class) ? 'monument' : /park/.test(p.class) ? 'park' : 'hall' });
        } else {
          const kind = LANDMARK[p.class];
          if (!kind) continue;
          if (p.class === 'railway' && p.subclass !== 'station') continue;
          if (p.class === 'hospital' && p.subclass !== 'hospital') continue;
          if (p.class === 'library' && p.subclass !== 'library') continue;
          if (p.class === 'town_hall' && !['townhall', 'courthouse'].includes(p.subclass)) continue;
          if (MINOR[p.class]?.test(label)) continue;
          landmarks.push({ name: label, lon, lat: la, cls: p.class, glyph: kind[0], pri: kind[1], order: p.rank ?? 99 });
        }
        seen.add(label);
      }
    }
  }
  districts.sort((a, b) => a.kind - b.kind || a.order - b.order);
  landmarks.sort((a, b) => a.pri - b.pri || a.order - b.order);
  // take the kinds in turn, the best of each first, so a city of museums still shows its churches
  const byKind = new Map();
  for (const t of landmarks) (byKind.get(t.cls) || byKind.set(t.cls, []).get(t.cls)).push(t);
  const mixed = [], lists = [...byKind.values()];
  for (let i = 0; mixed.length < 400 && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length) mixed.push(l[i]);
  return { districts, landmarks: mixed.slice(0, 400), grounds, streets: [...streets.values()].sort((a, b) => a.rank - b.rank) };
}

// Open water as OpenStreetMap maps it: sea, rivers and lakes (polygons cut at tile edges) over an
// extent, at a tile zoom that suits the distance across. Any place sheets trace their coast from
// these at every scale: elevation alone fills in low deltas and tidal flats (the Sundarbans, the
// Meghna, whose mouth OpenStreetMap maps as river, not sea) and floods land below sea level.
// Rivers and lakes only reach the tiles once they're wide enough to see. Throws if the tiles can't
// be reached.
export async function seaPolygons(pad, km) {
  const lat = (pad.lat0 + pad.lat1) / 2, z = tileZoom(pad, lat, km), { x0, x1, y0, y1 } = tileRange(z, pad), n = 2 ** z;
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push(tile(z, x, y).then((t) => [x, y, t]));
  const out = [];
  for (const [tx, ty, layers] of await Promise.all(jobs)) {
    const L = layers.water;
    if (!L) continue;
    for (const f of L.features) {
      if (f.type !== 3 || !OPEN_WATER.has(f.props.class) || f.props.intermittent) continue;
      out.push(f.geometry().filter((g) => g.length >= 6).map((g) => {
        const o = new Array(g.length);
        for (let i = 0; i < g.length; i += 2) {
          o[i] = ((tx + g[i] / L.extent) / n) * 360 - 180;
          o[i + 1] = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + g[i + 1] / L.extent)) / n))) / RAD;
        }
        return o;
      }));
    }
  }
  return out;
}

// Douglas–Peucker over a flat [x, y, …] array
function simplify(p, tol) {
  const m = p.length / 2;
  if (m < 3) return p;
  const keep = new Uint8Array(m); keep[0] = keep[m - 1] = 1;
  const stack = [0, m - 1];
  while (stack.length) {
    const b = stack.pop(), a = stack.pop();
    const ax = p[2 * a], ay = p[2 * a + 1], dx = p[2 * b] - ax, dy = p[2 * b + 1] - ay, L = Math.hypot(dx, dy);
    let dmax = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const x = p[2 * i] - ax, y = p[2 * i + 1] - ay;
      const d = L < 1e-9 ? Math.hypot(x, y) : Math.abs(dy * x - dx * y) / L;
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (dmax > tol) { keep[idx] = 1; stack.push(a, idx, idx, b); }
  }
  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}

// ---------- Mapbox Vector Tile decoding (spec 2.1) ----------
// decode(bytes, wanted) → { layerName: { extent, features: [{ type, props, geometry() }] } } for the wanted layers.
// geometry() returns flat [x, y, …] parts in tile units: points, lines, or polygon rings (closed).
const utf8 = new TextDecoder();
export function decode(buf, wanted) {
  const r = new Reader(buf), layers = {};
  while (r.pos < buf.length) {
    const [field, wire] = r.key();
    if (field === 3 && wire === 2) {
      const end = r.varint() + r.pos, L = readLayer(r, end, wanted);
      if (L) layers[L.name] = L;
      r.pos = end;
    } else r.skip(wire);
  }
  return layers;
}
function readLayer(r, end, wanted) {
  const L = { name: '', extent: 4096, keys: [], values: [], features: [] }, spans = [];
  while (r.pos < end) {
    const [field, wire] = r.key();
    if (field === 1) { L.name = r.string(); if (!wanted.includes(L.name)) return null; }
    else if (field === 2) { const len = r.varint(); spans.push(r.pos, r.pos + len); r.pos += len; }
    else if (field === 3) L.keys.push(r.string());
    else if (field === 4) { const e = r.varint() + r.pos; L.values.push(readValue(r, e)); r.pos = e; }
    else if (field === 5) L.extent = r.varint();
    else r.skip(wire);
  }
  for (let i = 0; i < spans.length; i += 2) L.features.push(readFeature(r, spans[i], spans[i + 1], L));
  return L;
}
function readValue(r, end) {
  let v = null;
  while (r.pos < end) {
    const [field, wire] = r.key();
    if (field === 1) v = r.string();
    else if (field === 2) { v = r.view.getFloat32(r.pos, true); r.pos += 4; }
    else if (field === 3) { v = r.view.getFloat64(r.pos, true); r.pos += 8; }
    else if (field === 4 || field === 5) v = r.varint();
    else if (field === 6) { const u = r.varint(); v = u % 2 ? -(u + 1) / 2 : u / 2; }
    else if (field === 7) v = !!r.varint();
    else r.skip(wire);
  }
  return v;
}
function readFeature(r, start, end, L) {
  r.pos = start;
  let type = 0, cmds = null;
  const props = {};
  while (r.pos < end) {
    const [field, wire] = r.key();
    if (field === 2) { const e = r.varint() + r.pos; while (r.pos < e) { const k = r.varint(), v = r.varint(); props[L.keys[k]] = L.values[v]; } }
    else if (field === 3) type = r.varint();
    else if (field === 4) { const e = r.varint() + r.pos; cmds = []; while (r.pos < e) cmds.push(r.varint()); }
    else r.skip(wire);
  }
  return { type, props, geometry: () => geometry(cmds || [], type) };
}
function geometry(cmds, type) {
  const parts = [];
  let x = 0, y = 0, cur = null;
  const zz = (n) => (n >>> 1) ^ -(n & 1);
  for (let i = 0; i < cmds.length;) {
    const id = cmds[i] & 7, count = cmds[i++] >>> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        x += zz(cmds[i++]); y += zz(cmds[i++]);
        if (id === 1) { cur = []; parts.push(cur); }
        cur.push(x, y);
      }
    } else if (id === 7 && cur && type === 3) cur.push(cur[0], cur[1]);     // ClosePath
  }
  return parts;
}
class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  varint() {                                    // up to 2^53, which is all a tile needs
    let v = 0, s = 1, b;
    do { b = this.buf[this.pos++]; v += (b & 0x7f) * s; s *= 128; } while (b & 0x80);
    return v;
  }
  key() { const k = this.varint(); return [Math.floor(k / 8), k % 8]; }
  string() { const len = this.varint(), s = utf8.decode(this.buf.subarray(this.pos, this.pos + len)); this.pos += len; return s; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`unknown protobuf wire type ${wire}`);
  }
}
