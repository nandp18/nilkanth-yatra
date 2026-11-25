// Print edition page: the design chooser (style and layout cards with live thumbnails, region,
// size and title chips), the preview at relative physical size, and export.
import { FORMATS, TITLE_FACES, LAYOUTS, LAYOUT_NOTES, STYLES, DETAILS, REFERENCE, kit, extentFor, tileCount, relief, blankRelief, buildSheet, embedFonts, elevationData, elevationSampler, pause } from './print.js';
import { buildLine, buildProfile, buildStrip, buildPanorama, buildRidges, buildScroll, buildMandala } from './print-views.js';
import * as printMod from './print.js';
import { SPANS, drawPlace, placeInfo, cityExtras, CITY_KM, BOX_CORNERS } from './print-place.js';
import { exportDpi, sheetCanvas, jpegBlob, tiffBlob } from './print-export.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  fmt: FORMATS[params.get('size')] ? params.get('size') : '18x24',
  face: TITLE_FACES[params.get('title')] ? params.get('title') : 'didone',
  layout: LAYOUTS[params.get('layout')] ? params.get('layout') : 'classic',
  style: STYLES[params.get('style')] ? params.get('style') : 'antique',
  region: DETAILS[params.get('region')] ? params.get('region') : 'north',
  // Any place: a chart of wherever you like, in the same styles
  mode: params.get('mode') === 'place' ? 'place' : 'journey',
  span: SPANS[params.get('span')] ? params.get('span') : '300',
  towns: params.get('towns') === 'off' ? 'off' : 'on',
  box: BOX_CORNERS.includes(params.get('box')) ? params.get('box') : 'auto',   // where the title box goes
  // city details switched on or off by hand; the rest follow the style's defaults (cityExtras)
  extras: Object.fromEntries(['landmarks', 'refs', 'streets', 'wards'].filter((k) => ['on', 'off'].includes(params.get(k))).map((k) => [k, params.get(k) === 'on'])),
  border: params.get('border') === 'off' ? 'off' : 'on',   // off: borderless sheet, for those who don't want the frame
  place: placeFromParams() || { lat: 28.817, lon: 83.872, title: 'Muktinath', sub: 'Mustang, Nepal' },
};
// The chosen sheet: its format, plus whether it has a border. Borderless map sheets bleed to the edge.
const sheetFormat = () => ({ ...FORMATS[state.fmt], border: state.border === 'on' });
function placeFromParams() {
  const [lat, lon] = (params.get('at') || '').split(',').map(Number);
  if (!params.get('at') || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
  return { lat, lon, title: params.get('name') || 'Untitled', sub: params.get('sub') || '' };
}
const MAPPED = new Set(['classic', 'map', 'charan', 'detail']);      // layouts drawn by buildSheet
const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);
let current = '';
let seq = 0;

// Relief detail follows sheet size: z8 (~300 dpi) for the large poster, z7 otherwise,
// stepping down if the extent would need too many tiles (memory)
const zoomFor = (f, ext, layout = state.layout) => {
  let z = f.w >= 24 ? 8 : 7;
  // Detail sheets cover a small area at a large scale: aim for about 260 dpi
  if (layout === 'detail') z = Math.min(10, Math.ceil(Math.log2(((f.w - 2.1) * 260 * 360) / (256 * (ext.lon1 - ext.lon0)))));
  if (layout === 'strip') z = f.w >= 12 ? 8 : 7;      // strips enlarge the map several times
  if (layout === 'panorama') z = 7;                   // perspective view: z7 texture is plenty
  while (z > 6 && tileCount(z, ext) > 950) z--;
  return z;
};

// Draw one sheet. `zoom` overrides the relief detail (the chooser's thumbnails use small zooms).
async function drawSheet(f, face, style, layout, region, { zoom, progress, alive = () => true } = {}) {
  const ALL = kit.EXTENT, z = (ext) => zoom ?? zoomFor(f, ext, layout);
  const elevZ = zoom ?? 7;
  if (layout === 'line' || layout === 'mandala') { await document.fonts.ready; return (layout === 'line' ? buildLine : buildMandala)(f, face, style); }
  if (layout === 'profile' || layout === 'ridges' || layout === 'scroll') {
    const sample = elevationSampler(await elevationData(elevZ, ALL, progress?.('Reading elevations')));
    await document.fonts.ready;
    return ({ profile: buildProfile, ridges: buildRidges, scroll: buildScroll })[layout](f, face, style, sample);
  }
  if (layout === 'strip') return buildStrip(f, face, style, await relief(z(ALL), ALL, style, progress?.('Engraving relief')));
  if (layout === 'panorama') {
    const rel = await relief(elevZ, ALL, style, progress?.('Engraving relief'));
    if (!alive()) return null;
    return buildPanorama(f, face, style, await elevationData(elevZ, ALL), rel, progress?.('Drawing the panorama'));
  }
  const ext = extentFor(f, layout, region);
  const rel = await relief(z(ext), ext, style, progress?.('Engraving relief'));
  await document.fonts.ready;
  if (!alive()) return null;
  // Classic: name exactly the stops that fit on the reference sheet, at every size.
  // Map and Detail: there's no key, so every stop is named.
  let names = null;
  if (layout === 'classic') {
    const refExt = extentFor(FORMATS[REFERENCE], 'classic');
    buildSheet(FORMATS[REFERENCE], face, blankRelief(refExt), null, 'classic', refExt);   // layout pass only
    names = printMod.lastNamed;
  }
  return buildSheet(f, face, rel, names, layout, ext, style);
}

function sizePreview() {
  const f = sheetFormat();
  const PLACE = state.mode === 'place';
  const maxH = Math.max(420, window.innerHeight - 150);
  const h = maxH * Math.sqrt(f.h / 36);            // bigger sheets preview bigger
  const w = Math.min(h * (f.w / f.h), $('sheet-wrap').clientWidth - 48);
  $('sheet').style.width = `${w}px`;
  $('sheet').style.aspectRatio = `${f.w} / ${f.h}`;
  const ext = extentFor(f, state.layout, state.region), z = zoomFor(f, ext);
  const dpi = PLACE ? placeInfo(f, state.place, state.span).dpi : Math.round((256 * 2 ** z * ((ext.lon1 - ext.lon0) / 360)) / (f.w * (state.layout === 'classic' ? 0.8 : 0.88)));
  const [pw, ph] = f.page || [f.w, f.h];
  $('caption').textContent = f.page
    ? `${f.label} · prints ${f.w} × ${f.h} in inside ${f.margin} in margins · type is ${Math.round((f.w / 18) * 100)}% of the 18 × 24 in size`
    : `${f.label} · ${(f.w * 2.54).toFixed(1)} × ${(f.h * 2.54).toFixed(1)} cm${PLACE ? ` · ${SPANS[state.span].label} across` : ''}${PLACE || MAPPED.has(state.layout) ? ` · relief at about ${dpi} dpi` : ''}`;
  pageStyle.textContent = `@page { size: ${pw}in ${ph}in; margin: ${f.margin || 0}in; }`;
  $('hint').innerHTML = f.page
    ? 'Test print for a home printer: choose <b>Letter</b> paper, margins <b>Default</b>, scale <b>100%</b>, and turn on <b>Background graphics</b>. Check colour and layout; the key is small at this size.'
    : 'Vector map: prints sharp at any size. In the print dialog choose <b>Save as PDF</b>, set margins to <b>None</b>, and turn on <b>Background graphics</b>.';
}

// The loading card over the preview: what's happening, in words, and how far along
const STEPS = {
  'Engraving relief': (p) => (p < 0.85 ? 'Fetching elevation tiles · quicker once cached' : 'Shading the mountains and coasts'),
  'Reading elevations': () => 'Fetching elevation tiles · quicker once cached',
  'Tracing the coast': () => 'Finding the shoreline, rivers and towns',
  'Gathering map detail': () => 'Roads, rivers and towns from OpenStreetMap',
  'Drawing the panorama': () => 'Ray-casting the view north to the Himalaya',
};
const stepFor = (label, p) => (STEPS[label] || (() => ''))(p);
function showLoader(title, step, p) {
  document.body.classList.add('busy');
  $('loader-title').textContent = title;
  $('loader-step').textContent = step;
  const known = typeof p === 'number';
  $('loader-fill').parentElement.classList.toggle('indeterminate', !known);
  $('loader-fill').style.width = known ? `${Math.round(p * 100)}%` : '';
  $('loader-pct').textContent = known ? `${Math.round(p * 100)}%` : '';
  document.querySelector('.toolbar').style.setProperty('--p', known ? p : 0.08);
  $('busy-pill').textContent = known ? `${title}… ${Math.round(p * 100)}%` : `${title}…`;
}

const setExports = (on) => { for (const id of ['btn-print', 'btn-svg', 'btn-jpg', 'btn-tiff']) $(id).disabled = !on; };

async function render() {
  const my = ++seq, f = sheetFormat();
  sizePreview();
  syncChooser();
  setExports(false);
  document.body.classList.remove('ready');
  $('sheet').style.background = STYLES[state.style].C.paper;
  showLoader('Drawing your map', 'Preparing the sheet', null);
  const progress = (label) => (p) => {
    if (my !== seq) return;
    $('status').textContent = `${label}… ${Math.round(p * 100)}%`;
    showLoader(label, stepFor(label, p), p);
  };
  let svg;
  try {
    svg = state.mode === 'place'
      ? await drawPlace(f, state.face, state.style, state.place, { span: state.span, towns: state.towns === 'on', extras: state.extras, box: state.box, progress, alive: () => my === seq })
      : await drawSheet(f, state.face, state.style, state.layout, state.region, { progress, alive: () => my === seq });
  } catch (err) {
    console.error(err);
    if (my === seq) { $('status').textContent = `Could not draw this view: ${err.message}`; document.body.classList.remove('busy'); }
    return;
  }
  if (my !== seq || !svg) return;
  await pause();                                           // let the loader's last frame paint before the sheet goes in
  if (my !== seq) return;
  current = svg;
  $('sheet').innerHTML = current;
  zoom.attach();
  $('status').textContent = 'Ready to print';
  document.body.classList.remove('busy');
  setExports(true);
  document.body.classList.add('ready');
  thumbs.request();
}

// ---------- Chooser ----------
const card = (group, k, name, note) => `<button class="card" role="radio" data-group="${group}" data-v="${k}" aria-checked="false">
  <span class="thumb loading" style="--paper:${STYLES[group === 'style' ? k : 'antique'].C.paper}"><img alt="" hidden></span>
  <span class="name">${name}</span><span class="note">${note}</span></button>`;
const chip = (group, k, label, extra = '') => `<button class="chip" role="radio" data-group="${group}" data-v="${k}" aria-checked="false"${extra}>${label}</button>`;
// Styles in families, so the list stays easy to scan as it grows. A style not listed here
// lands in a last group of its own, so a new one is never lost from the chooser.
const STYLE_GROUPS = [
  ['Shaded relief', 'Hills drawn from the elevation data', ['antique', 'natural', 'watercolor', 'cyanotype', 'night']],
  ['Painted', 'Flat painted grounds with drawn peaks and trees', ['pahari', 'pichwai', 'kalamkari', 'poster']],
  ['Illustrated', 'Pen-and-ink peaks and forests, ships and sea serpents', ['chart']],
  ['City plans', 'Best on an Any place sheet of a city, 10 or 25 km across', ['gazetteer', 'cityplan', 'wardmap']],
];
{
  const listed = new Set(STYLE_GROUPS.flatMap(([, , ks]) => ks));
  const rest = Object.keys(STYLES).filter((k) => !listed.has(k));
  $('styles').innerHTML = [...STYLE_GROUPS, ...(rest.length ? [['More styles', '', rest]] : [])].map(([name, note, keys]) => {
    const cards = keys.filter((k) => STYLES[k]).map((k) => card('style', k, STYLES[k].label, STYLES[k].note.replace(/, after .*/, ''))).join('');
    return `<div class="style-group"><h3>${name}</h3>${note ? `<p class="group-note">${note}</p>` : ''}<div class="cards">${cards}</div></div>`;
  }).join('');
}
$('layouts').innerHTML = Object.entries(LAYOUTS).map(([k, l]) => card('layout', k, l, LAYOUT_NOTES[k])).join('');
$('regions').innerHTML = Object.entries(DETAILS).map(([k, d]) => chip('region', k, d.label, ` title="${d.title}"`)).join('');
$('sizes').innerHTML = Object.entries(FORMATS).map(([k, f]) => chip('fmt', k, f.short, ` title="${f.label}"`)).join('');
$('faces').innerHTML = Object.entries(TITLE_FACES).map(([k, f]) => chip('face', k, f.label, ` style="font-family:${f.family}"`)).join('');
$('modes').innerHTML = chip('mode', 'journey', 'The journey') + chip('mode', 'place', 'Any place');
$('spans').innerHTML = Object.entries(SPANS).map(([k, s]) => chip('span', k, s.label)).join('');
$('towns').innerHTML = chip('towns', 'on', 'Named') + chip('towns', 'off', 'Hidden');
const EXTRAS = [['landmarks', 'Landmarks', 'Neighbourhoods in capitals, and churches, halls, museums and parks, each with a small drawn mark'],
  ['refs', 'Numbered landmarks', 'Landmarks with no room for a name get a number, listed under References'],
  ['streets', 'Street names', 'Avenues and main streets named along their course'], ['wards', 'Ward colours', 'A colour wash for each quarter']];
const extrasNow = () => cityExtras(state.style, state.extras);
$('extras').innerHTML = EXTRAS.map(([k, label, tip]) => `<button class="chip" data-toggle="${k}" aria-pressed="false" title="${tip}">${label}</button>`).join('');
$('boxes').innerHTML = [['auto', 'Auto', 'The corner with the least land under it'], ['tl', 'Top left'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['br', 'Bottom right']]
  .map(([k, label, tip]) => chip('box', k, label, tip ? ` title="${tip}"` : '')).join('');
$('borders').innerHTML = chip('border', 'on', 'Framed') + chip('border', 'off', 'Borderless');
const GROUP_KEY = { style: 'style', layout: 'layout', region: 'region', fmt: 'fmt', face: 'face', mode: 'mode', span: 'span', towns: 'towns', box: 'box', border: 'border' };

document.querySelector('.panel').addEventListener('click', (e) => {
  const t = e.target.closest('button[data-toggle]');
  if (t) {
    // remember a choice only where it differs from the style's default, so changing style keeps the rest natural
    const k = t.dataset.toggle, v = !extrasNow()[k];
    if (v === cityExtras(state.style)[k]) delete state.extras[k]; else state.extras[k] = v;
    render(); return;
  }
  const b = e.target.closest('button[data-group]');
  if (!b) return;
  const key = GROUP_KEY[b.dataset.group];
  if (state[key] === b.dataset.v) return;
  state[key] = b.dataset.v;
  render();
});
// arrow keys move within a group, like a radio group
document.querySelector('.panel').addEventListener('keydown', (e) => {
  const b = e.target.closest('button[data-group]');
  if (!b || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
  const all = [...document.querySelectorAll(`button[data-group="${b.dataset.group}"]`)];
  const next = all[(all.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
  next.focus(); next.click(); e.preventDefault();
});

function syncChooser() {
  for (const b of document.querySelectorAll('.panel button[data-group]')) {
    const on = state[GROUP_KEY[b.dataset.group]] === b.dataset.v;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
    b.tabIndex = on ? 0 : -1;
  }
  $('region-row').hidden = state.layout !== 'detail';
  const X = extrasNow();
  for (const b of document.querySelectorAll('.panel button[data-toggle]')) {
    const on = X[b.dataset.toggle];
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.disabled = b.dataset.toggle === 'refs' && !X.landmarks;      // numbers only go on landmarks
  }
  const f = FORMATS[state.fmt], PLACE = state.mode === 'place', P = state.place;
  $('place-section').hidden = !PLACE;
  $('layout-section').hidden = PLACE;
  $('extras-row').hidden = !PLACE || SPANS[state.span].km > CITY_KM;
  if (document.activeElement !== $('place-title')) $('place-title').value = P.title;
  if (document.activeElement !== $('place-sub')) $('place-sub').value = P.sub;
  $('summary').textContent = PLACE ? `${P.title} · ${STYLES[state.style].label} · ${f.short}`
    : `${STYLES[state.style].label} · ${LAYOUTS[state.layout]}${state.layout === 'detail' ? ` (${DETAILS[state.region].label})` : ''} · ${f.short}`;
  // keep the address shareable
  const q = new URLSearchParams(PLACE
    ? { mode: 'place', at: `${P.lat},${P.lon}`, name: P.title, ...(P.sub ? { sub: P.sub } : {}), span: state.span, ...(state.towns === 'off' ? { towns: 'off' } : {}), ...(state.box !== 'auto' ? { box: state.box } : {}), style: state.style, size: state.fmt }
    : { style: state.style, layout: state.layout, size: state.fmt });
  if (!PLACE && state.layout === 'detail') q.set('region', state.region);
  if (state.border === 'off') q.set('border', 'off');
  if (PLACE) for (const [k, on] of Object.entries(state.extras)) q.set(k, on ? 'on' : 'off');
  if (state.face !== 'didone') q.set('title', state.face);
  history.replaceState(null, '', `?${q}`);
}

// ---------- Live thumbnails ----------
// Each card shows the real design, drawn small: style cards show the Map layout in that style,
// layout cards show each layout in the chosen style. Drawn one at a time after the main sheet,
// framed or borderless as chosen (the border is part of the key, so each kind is drawn once).
const THUMB = { w: 6, h: 8, label: '', short: '' };     // 3:4, like 18 × 24
const thumbs = {
  done: new Map(), queue: [], busy: false,
  wanted() {
    const list = Object.keys(STYLES).map((s) => [s, 'map', state.border]);
    if (state.mode !== 'place') for (const l of Object.keys(LAYOUTS)) list.push([state.style, l, state.border]);
    return list;
  },
  request() {
    this.queue = this.wanted().filter((item) => !this.done.has(item.join('|')));
    this.paint();
    if (!this.busy) this.next();
  },
  async next() {
    const item = this.queue.shift();
    if (!item) { this.busy = false; return; }
    this.busy = true;
    const [s, l, border] = item, key = item.join('|');
    try {
      if (!this.done.has(key)) {
        const zoom = l === 'detail' ? 6 : 5;
        const svg = await drawSheet({ ...THUMB, border: border === 'on' }, 'didone', s, l, 'north', { zoom });
        this.done.set(key, await rasterize(svg, 300, 400));
        this.paint();
      }
    } catch (err) { console.warn('thumbnail', key, err); }
    await new Promise((r) => setTimeout(r, 30));
    this.next();
  },
  paint() {
    for (const b of document.querySelectorAll('.card')) {
      const key = b.dataset.group === 'style' ? `${b.dataset.v}|map|${state.border}` : `${state.style}|${b.dataset.v}|${state.border}`;
      const url = this.done.get(key), box = b.querySelector('.thumb'), img = box.querySelector('img');
      if (b.dataset.group === 'layout') box.style.setProperty('--paper', STYLES[state.style].C.paper);
      if (url) { if (img.src !== url) img.src = url; img.hidden = false; box.classList.remove('loading'); }
      else box.classList.add('loading');          // keep the previous picture while the new one draws
    }
  },
};
async function rasterize(svg, w, h) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.86);
  } finally { URL.revokeObjectURL(url); }
}

// ---------- Any place: search, pick, title ----------
// Place search is OpenStreetMap's Nominatim: one request per search (no type-ahead), per its usage policy
const note = (html) => { $('place-note').innerHTML = html; };
const OSM_NOTE = 'Search by <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>. The coast is traced at sea level from the elevation data.';
note(OSM_NOTE);
function choosePlace(p, widthKm) {
  state.place = p;
  if (widthKm) {                                         // open on the span that best frames what was found
    const want = Math.max(100, widthKm * 1.5);         // a town opens with its surroundings; 25 km is a click away
    state.span = Object.keys(SPANS).reduce((a, b) => (Math.abs(Math.log(SPANS[b].km / want)) < Math.abs(Math.log(SPANS[a].km / want)) ? b : a));
  }
  $('place-results').hidden = true;
  render();
}
let found = [];
$('place-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('place-q').value.trim();
  if (!q) return;
  const ll = q.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
  if (ll && Math.abs(+ll[1]) <= 90 && Math.abs(+ll[2]) <= 180) {
    choosePlace({ lat: +ll[1], lon: +ll[2], title: state.place.title, sub: state.place.sub });
    note('Centred on those coordinates. Set the title below.');
    return;
  }
  const btn = $('place-form').querySelector('button');
  btn.disabled = true;
  note('Searching…');
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=en&q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(res.status);
    found = (await res.json()).map((r) => {
      const parts = r.display_name.split(', ').filter((x) => !/^[\d\s-]+$/.test(x)), [s, n, w, e2] = (r.boundingbox || []).map(Number);
      const title = r.name || parts[0], rest = parts.filter((x) => x !== title);
      // subtitle: the widest two parts of the address (state or region, country)
      const km = Number.isFinite(w) ? (e2 - w) * 111.32 * Math.cos((+r.lat * Math.PI) / 180) : 0;
      return { place: { lat: +(+r.lat).toFixed(4), lon: +(+r.lon).toFixed(4), title, sub: rest.slice(-2).join(', ') }, km, full: rest.join(', ') };
    });
    const ul = $('place-results');
    ul.replaceChildren(...found.map((f, i) => {
      const li = document.createElement('li'), b = document.createElement('button'), t = document.createElement('b'), s = document.createElement('span');
      b.type = 'button'; b.dataset.i = i; t.textContent = f.place.title; s.textContent = f.full;
      b.append(t, s); li.append(b);
      return li;
    }));
    ul.hidden = !found.length;
    note(found.length ? OSM_NOTE : 'Nothing found for that. Try another spelling, or type coordinates like <b>21.53, 70.46</b>.');
    if (found.length === 1) choosePlace(found[0].place, found[0].km);
  } catch (err) {
    console.error(err);
    note('The place search could not be reached. Try again, or type coordinates like <b>21.53, 70.46</b>.');
  } finally { btn.disabled = false; }
});
$('place-results').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-i]');
  if (b) choosePlace(found[b.dataset.i].place, found[b.dataset.i].km);
});
let titleTimer = 0;
for (const [id, key] of [['place-title', 'title'], ['place-sub', 'sub']]) {
  $(id).addEventListener('input', () => {
    state.place = { ...state.place, [key]: $(id).value };
    clearTimeout(titleTimer);
    titleTimer = setTimeout(render, 450);
  });
}

window.addEventListener('resize', sizePreview);

// ---------- Preview zoom ----------
// Zooming changes only the preview SVG's viewBox: the vector stays sharp, and the sheet that
// prints or exports (the `current` markup) is untouched. Pinch or Ctrl/⌘-scroll zooms about the
// pointer, scrolling or dragging moves about once zoomed in, double-click zooms in there.
const zoom = {
  full: null, box: null, raf: 0, MAX: 16,
  svg() { return $('sheet').querySelector('svg'); },
  // after each redraw: keep the view if the sheet is the same shape, else show it whole
  attach() {
    const svg = this.svg();
    if (!svg) return;
    const vb = svg.viewBox.baseVal, full = [vb.x, vb.y, vb.width, vb.height];
    const same = this.full && this.full.every((v, i) => Math.abs(v - full[i]) < 0.5);
    this.full = full;
    if (same && this.box) this.apply(); else this.set(full);
  },
  level() { return this.full && this.box ? this.full[2] / this.box[2] : 1; },
  set([x, y, w]) {
    const [fx, fy, fw, fh] = this.full;
    w = Math.min(fw, Math.max(fw / this.MAX, w));
    const h = (w * fh) / fw;
    this.box = [Math.min(fx + fw - w, Math.max(fx, x)), Math.min(fy + fh - h, Math.max(fy, y)), w, h];
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.apply(); });
  },
  apply() {
    const svg = this.svg();
    if (!svg || !this.box) return;
    svg.setAttribute('viewBox', this.box.map((v) => +v.toFixed(2)).join(' '));
    const z = this.level();
    $('zoom-level').textContent = `${Math.round(z * 100)}%`;
    $('zoom-out').disabled = z <= 1.001;
    $('zoom-in').disabled = z >= this.MAX - 0.01;
    $('sheet').classList.toggle('zoomed', z > 1.001);
  },
  // zoom by `k` keeping the sheet point under (cx, cy) on screen where it is
  by(k, cx, cy) {
    const svg = this.svg();
    if (!svg || !this.box) return;
    const r = svg.getBoundingClientRect(), [x, y, w, h] = this.box;
    if (cx === undefined) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const u = (cx - r.left) / r.width, v = (cy - r.top) / r.height;
    const nw = Math.min(this.full[2], Math.max(this.full[2] / this.MAX, w / k)), nh = (nw * h) / w;
    this.set([x + u * w - u * nw, y + v * h - v * nh, nw]);
  },
  // move by a screen distance
  pan(dx, dy) {
    const r = this.svg().getBoundingClientRect(), [x, y, w, h] = this.box;
    this.set([x - (dx * w) / r.width, y - (dy * h) / r.height, w]);
  },
};
$('zoom-in').onclick = () => zoom.by(1.6);
$('zoom-out').onclick = () => zoom.by(1 / 1.6);
$('zoom-level').onclick = () => zoom.full && zoom.set(zoom.full);
$('sheet').addEventListener('wheel', (e) => {
  if (!zoom.box || document.body.classList.contains('busy')) return;
  if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom.by(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.004)), e.clientX, e.clientY); }
  else if (zoom.level() > 1.001) { e.preventDefault(); zoom.pan(-e.deltaX, -e.deltaY); }     // zoomed in: scrolling moves the map
}, { passive: false });
$('sheet').addEventListener('mousedown', (e) => { if (e.detail > 1) e.preventDefault(); });     // a double-click zooms, it doesn't pick a word
$('sheet').addEventListener('dblclick', (e) => { window.getSelection()?.removeAllRanges(); if (zoom.box) zoom.by(e.shiftKey ? 1 / 2 : 2, e.clientX, e.clientY); });
{
  // drag to move; two fingers pinch
  const pts = new Map();
  let pinch = 0;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  $('sheet').addEventListener('pointerdown', (e) => {
    if (!zoom.box || (e.pointerType === 'mouse' && (e.button !== 0 || zoom.level() <= 1.001))) return;
    if (e.pointerType === 'mouse') e.preventDefault();          // no text selection or image drag
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    $('sheet').setPointerCapture(e.pointerId);
    if (pts.size === 2) pinch = spread();
    $('sheet').classList.add('dragging');
  });
  $('sheet').addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 1 && zoom.level() > 1.001) zoom.pan(e.clientX - p.x, e.clientY - p.y);
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      const d = spread(), [a, b] = [...pts.values()];
      if (pinch) zoom.by(d / pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch = d;
    }
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) $('sheet').classList.remove('dragging'); };
  $('sheet').addEventListener('pointerup', up);
  $('sheet').addEventListener('pointercancel', up);
}
// print the whole sheet, whatever the preview is showing
window.addEventListener('beforeprint', () => { if (zoom.full) zoom.svg()?.setAttribute('viewBox', zoom.full.join(' ')); });
window.addEventListener('afterprint', () => zoom.apply());
$('btn-print').onclick = () => window.print();

// File name without extension, e.g. van-vicharan-antique-classic-11x14
function fileBase() {
  const slug = state.place.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'map';
  const border = state.border === 'off' ? '-borderless' : '';
  return state.mode === 'place' ? `${slug}-${state.style}-${state.fmt}${border}`
    : `van-vicharan-${state.style}-${state.layout}${state.layout === 'detail' ? `-${state.region}` : ''}-${state.fmt}${border}`;
}
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);     // a large TIFF can take a while to hand over
}

$('btn-svg').onclick = async () => {
  $('status').textContent = 'Embedding fonts…';
  const svg = await embedFonts(current);
  saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  $('status').textContent = 'Ready to print';
};

// JPG or TIFF of the sheet at print resolution, fonts embedded so it matches the preview.
// Everything about the sheet is read up front, so changing the design mid-export can't mislabel
// the file; one export runs at a time.
let exporting = false;
async function exportImage(kind) {
  if (exporting || !current) return;
  exporting = true;
  const KIND = kind.toUpperCase(), svg = current, name = `${fileBase()}.${kind === 'tiff' ? 'tif' : 'jpg'}`;
  const f = sheetFormat(), dpi = exportDpi(f), paper = STYLES[state.style].C.paper;
  $('status').textContent = `Rendering ${KIND} at ${dpi} dpi…`;
  try {
    const canvas = await sheetCanvas(await embedFonts(svg), f, dpi, paper);
    const blob = kind === 'tiff' ? tiffBlob(canvas, dpi) : await jpegBlob(canvas, dpi);
    saveBlob(blob, name);
    $('status').textContent = `Ready to print · ${KIND} at ${dpi} dpi, ${(blob.size / 1048576).toFixed(1)} MB`;
  } catch (err) {
    console.error(err);
    $('status').textContent = `Could not export ${KIND}: ${err.message}`;
  } finally { exporting = false; }
}
$('btn-jpg').onclick = () => exportImage('jpg');
$('btn-tiff').onclick = () => exportImage('tiff');

// The Download menu closes on a choice, a click elsewhere, or Escape
const menu = $('download');
menu.addEventListener('click', (e) => { if (e.target.closest('button:not(:disabled)')) menu.open = false; });
document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
});

render();
