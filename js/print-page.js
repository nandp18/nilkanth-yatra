// Print edition page: format + title pickers, preview at relative physical size, export.
import { FORMATS, TITLE_FACES, relief, buildSheet, embedFonts } from './print.js';

const $ = (id) => document.getElementById(id);
const state = { fmt: '18x24', face: 'didone' };
const pageStyle = document.createElement('style');
document.head.appendChild(pageStyle);
let current = '';
let seq = 0;

// Relief detail follows sheet size: z8 (~300 dpi) for the large poster, z7 otherwise
const zoomFor = (f) => (f.w >= 24 ? 8 : 7);

function sizePreview() {
  const f = FORMATS[state.fmt];
  const maxH = Math.max(420, window.innerHeight - 200);
  const h = maxH * Math.sqrt(f.h / 36);            // bigger sheets preview bigger
  const w = Math.min(h * (f.w / f.h), $('sheet-wrap').clientWidth - 48);
  $('sheet').style.width = `${w}px`;
  $('sheet').style.aspectRatio = `${f.w} / ${f.h}`;
  const z = zoomFor(f), dpi = Math.round((256 * 2 ** z * (31 / 360)) / (f.w * 0.877));
  $('caption').textContent = `${f.label} · ${(f.w * 2.54).toFixed(1)} × ${(f.h * 2.54).toFixed(1)} cm · relief at about ${dpi} dpi`;
  pageStyle.textContent = `@page { size: ${f.w}in ${f.h}in; margin: 0; }`;
}

async function render() {
  const my = ++seq;
  const f = FORMATS[state.fmt];
  sizePreview();
  $('btn-print').disabled = $('btn-svg').disabled = true;
  document.body.classList.remove('ready');
  const rel = await relief(zoomFor(f), (p) => { if (my === seq) $('status').textContent = `Engraving relief… ${Math.round(p * 100)}%`; });
  await document.fonts.ready;
  if (my !== seq) return;
  current = buildSheet(f, state.face, rel);
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
$('sizes').innerHTML = '<span>Size</span>' + Object.entries(FORMATS).map(([k, f]) => `<button data-v="${k}" class="${k === state.fmt ? 'on' : ''}">${f.label}</button>`).join('');
$('faces').innerHTML = '<span>Title</span>' + Object.entries(TITLE_FACES).map(([k, f]) => `<button data-v="${k}" class="${k === state.face ? 'on' : ''}" style="font-family:${f.family}">${f.label}</button>`).join('');
bindSeg($('sizes'), 'fmt', render);
bindSeg($('faces'), 'face', render);
window.addEventListener('resize', sizePreview);

$('btn-print').onclick = () => window.print();
$('btn-svg').onclick = async () => {
  $('status').textContent = 'Embedding fonts…';
  const svg = await embedFonts(current);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  a.download = `van-vicharan-${state.fmt}.svg`;
  a.click();
  $('status').textContent = 'Ready to print';
};

render();
