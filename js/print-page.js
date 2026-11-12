// Print edition page: format + title pickers, preview at relative physical size, export.
import { FORMATS, TITLE_FACES, LAYOUTS, STYLES, DETAILS, REFERENCE, kit, extentFor, tileCount, relief, blankRelief, buildSheet, embedFonts, elevationData, elevationSampler } from './print.js';
import { buildLine, buildProfile, buildStrip, buildPanorama } from './print-views.js';
import * as printMod from './print.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  fmt: FORMATS[params.get('size')] ? params.get('size') : '18x24',
  face: 'didone',
  layout: LAYOUTS[params.get('layout')] ? params.get('layout') : 'classic',
  style: STYLES[params.get('style')] ? params.get('style') : 'antique',
  region: DETAILS[params.get('region')] ? params.get('region') : 'north',
};
const MAPPED = new Set(['classic', 'map', 'detail']);      // layouts drawn by buildSheet
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

function sizePreview() {
  const f = FORMATS[state.fmt];
  const maxH = Math.max(420, window.innerHeight - 200);
  const h = maxH * Math.sqrt(f.h / 36);            // bigger sheets preview bigger
  const w = Math.min(h * (f.w / f.h), $('sheet-wrap').clientWidth - 48);
  $('sheet').style.width = `${w}px`;
  $('sheet').style.aspectRatio = `${f.w} / ${f.h}`;
  const ext = extentFor(f, state.layout, state.region), z = zoomFor(f, ext);
  const dpi = Math.round((256 * 2 ** z * ((ext.lon1 - ext.lon0) / 360)) / (f.w * (state.layout === 'classic' ? 0.8 : 0.88)));
  const [pw, ph] = f.page || [f.w, f.h];
  $('caption').textContent = f.page
    ? `${f.label} · prints ${f.w} × ${f.h} in inside ${f.margin} in margins · type is ${Math.round((f.w / 18) * 100)}% of the 18 × 24 in size`
    : `${f.label} · ${(f.w * 2.54).toFixed(1)} × ${(f.h * 2.54).toFixed(1)} cm${MAPPED.has(state.layout) ? ` · relief at about ${dpi} dpi` : ''}`;
  pageStyle.textContent = `@page { size: ${pw}in ${ph}in; margin: ${f.margin || 0}in; }`;
  $('hint').innerHTML = f.page
    ? 'Test print for a home printer: choose <b>Letter</b> paper, margins <b>Default</b>, scale <b>100%</b>, and turn on <b>Background graphics</b>. Check colour and layout; the key is small at this size.'
    : 'Vector map: prints sharp at any size. In the print dialog choose <b>Save as PDF</b>, set margins to <b>None</b>, and turn on <b>Background graphics</b>.';
}

async function render() {
  const my = ++seq;
  const f = FORMATS[state.fmt];
  sizePreview();
  $('btn-print').disabled = $('btn-svg').disabled = true;
  document.body.classList.remove('ready');
  $('regions').hidden = state.layout !== 'detail';
  $('sheet').style.background = STYLES[state.style].C.paper;
  const prog = (label) => (p) => { if (my === seq) $('status').textContent = `${label}… ${Math.round(p * 100)}%`; };
  if (!MAPPED.has(state.layout)) {
    let svg;
    try {
      const L = state.layout, ALL = kit.EXTENT;
      await document.fonts.ready;
      if (L === 'line') svg = buildLine(f, state.face, state.style);
      else if (L === 'profile') svg = buildProfile(f, state.face, state.style, elevationSampler(await elevationData(7, ALL, prog('Reading elevations'))));
      else if (L === 'strip') svg = buildStrip(f, state.face, state.style, await relief(zoomFor(f, ALL), ALL, state.style, prog('Engraving relief')));
      else if (L === 'panorama') {
        const rel = await relief(7, ALL, state.style, prog('Engraving relief'));
        if (my !== seq) return;
        svg = await buildPanorama(f, state.face, state.style, await elevationData(7, ALL), rel, prog('Drawing the panorama'));
      }
    } catch (err) {
      console.error(err);
      if (my === seq) $('status').textContent = `Could not draw this view: ${err.message}`;
      return;
    }
    if (my !== seq) return;
    return show(svg);
  }
  const ext = extentFor(f, state.layout, state.region);
  const rel = await relief(zoomFor(f, ext), ext, state.style, prog('Engraving relief'));
  await document.fonts.ready;
  if (my !== seq) return;
  // Classic: name exactly the stops that fit on the reference sheet, at every size.
  // Map: there's no key, so every stop is named.
  let names = null;
  if (state.layout === 'classic') {
    const refExt = extentFor(FORMATS[REFERENCE], 'classic');
    buildSheet(FORMATS[REFERENCE], state.face, blankRelief(refExt), null, 'classic', refExt);   // layout pass only
    names = printMod.lastNamed;
  }
  if (my !== seq) return;
  show(buildSheet(f, state.face, rel, names, state.layout, ext, state.style));
}
function show(svg) {
  current = svg;
  $('sheet').innerHTML = current;
  $('status').textContent = 'Ready to print';
  $('btn-print').disabled = $('btn-svg').disabled = false;
  document.body.classList.add('ready');
}

function bindSeg(el, key, onPick) {
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      state[key] = b.dataset.v;
      onPick();
    };
  });
}
$('styles').innerHTML = '<span>Style</span>' + Object.entries(STYLES).map(([k, s]) => `<button data-v="${k}" class="${k === state.style ? 'on' : ''}" title="${s.note}"><i class="swatch" style="background:linear-gradient(135deg, ${s.C.paper} 50%, ${s.C.red} 50%)"></i>${s.label}</button>`).join('');
$('sizes').innerHTML = '<span>Size</span>' + Object.entries(FORMATS).map(([k, f]) => `<button data-v="${k}" class="${k === state.fmt ? 'on' : ''}" title="${f.label}">${f.short}</button>`).join('');
$('layouts').innerHTML = '<span>Layout</span>' + Object.entries(LAYOUTS).map(([k, l]) => `<button data-v="${k}" class="${k === state.layout ? 'on' : ''}">${l}</button>`).join('');
$('regions').innerHTML = '<span>Region</span>' + Object.entries(DETAILS).map(([k, d]) => `<button data-v="${k}" class="${k === state.region ? 'on' : ''}" title="${d.title}">${d.label}</button>`).join('');
$('faces').innerHTML = '<span>Title</span>' + Object.entries(TITLE_FACES).map(([k, f]) => `<button data-v="${k}" class="${k === state.face ? 'on' : ''}" style="font-family:${f.family}">${f.label}</button>`).join('');
bindSeg($('sizes'), 'fmt', render);
bindSeg($('faces'), 'face', render);
bindSeg($('layouts'), 'layout', render);
bindSeg($('styles'), 'style', render);
bindSeg($('regions'), 'region', render);
$('layouts').title = 'Layout'; $('faces').title = 'Title typeface'; $('sizes').title = 'Sheet size';
window.addEventListener('resize', sizePreview);

$('btn-print').onclick = () => window.print();
$('btn-svg').onclick = async () => {
  $('status').textContent = 'Embedding fonts…';
  const svg = await embedFonts(current);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `van-vicharan-${state.style}-${state.layout}${state.layout === 'detail' ? `-${state.region}` : ''}-${state.fmt}.svg`;
  a.click();
  $('status').textContent = 'Ready to print';
};

render();
