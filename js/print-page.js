// Print edition page: format + title pickers, preview at relative physical size, export.
import { FORMATS, TITLE_FACES, LAYOUTS, STYLES, REFERENCE, extentFor, tileCount, relief, blankRelief, buildSheet, embedFonts } from './print.js';
import * as printMod from './print.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const state = {
  fmt: FORMATS[params.get('size')] ? params.get('size') : '18x24',
  face: 'didone',
  layout: LAYOUTS[params.get('layout')] ? params.get('layout') : 'classic',
  style: STYLES[params.get('style')] ? params.get('style') : 'antique',
};
const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);
let current = '';
let seq = 0;

// Relief detail follows sheet size: z8 (~300 dpi) for the large poster, z7 otherwise,
// stepping down if the extent would need too many tiles (memory)
const zoomFor = (f, ext) => {
  let z = f.w >= 24 ? 8 : 7;
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
  const ext = extentFor(f, state.layout), z = zoomFor(f, ext);
  const dpi = Math.round((256 * 2 ** z * ((ext.lon1 - ext.lon0) / 360)) / (f.w * (state.layout === 'map' ? 0.88 : 0.8)));
  const [pw, ph] = f.page || [f.w, f.h];
  $('caption').textContent = f.page
    ? `${f.label} · prints ${f.w} × ${f.h} in inside ${f.margin} in margins · type is ${Math.round((f.w / 18) * 100)}% of the 18 × 24 in size`
    : `${f.label} · ${(f.w * 2.54).toFixed(1)} × ${(f.h * 2.54).toFixed(1)} cm · relief at about ${dpi} dpi`;
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
  const ext = extentFor(f, state.layout);
  $('sheet').style.background = STYLES[state.style].C.paper;
  const rel = await relief(zoomFor(f, ext), ext, state.style, (p) => { if (my === seq) $('status').textContent = `Engraving relief… ${Math.round(p * 100)}%`; });
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
  current = buildSheet(f, state.face, rel, names, state.layout, ext, state.style);
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
$('faces').innerHTML = '<span>Title</span>' + Object.entries(TITLE_FACES).map(([k, f]) => `<button data-v="${k}" class="${k === state.face ? 'on' : ''}" style="font-family:${f.family}">${f.label}</button>`).join('');
bindSeg($('sizes'), 'fmt', render);
bindSeg($('faces'), 'face', render);
bindSeg($('layouts'), 'layout', render);
bindSeg($('styles'), 'style', render);
$('layouts').title = 'Layout'; $('faces').title = 'Title typeface'; $('sizes').title = 'Sheet size';
window.addEventListener('resize', sizePreview);

$('btn-print').onclick = () => window.print();
$('btn-svg').onclick = async () => {
  $('status').textContent = 'Embedding fonts…';
  const svg = await embedFonts(current);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `van-vicharan-${state.style}-${state.layout}-${state.fmt}.svg`;
  a.click();
  $('status').textContent = 'Ready to print';
};

render();
