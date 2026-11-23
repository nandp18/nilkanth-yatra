// Print edition: raster export of the sheet. The SVG is drawn onto a canvas at print resolution,
// then written as JPEG (the browser's encoder, with its JFIF density set to the export dpi) or
// as uncompressed 8-bit RGB TIFF (browsers can't encode TIFF, so the header is written here).

export const EXPORT_DPI = 300;
// Canvas size cap: about 60 megapixels (a 24 × 36 in sheet drops to about 263 dpi to stay under it)
const MAX_PIXELS = 60e6;

export function exportDpi(f) {
  return Math.min(EXPORT_DPI, Math.floor(Math.sqrt(MAX_PIXELS / (f.w * f.h))));
}

// Draw the SVG sheet at the export size, over the paper colour so no pixel is transparent
export async function sheetCanvas(svg, f, dpi, paper) {
  const W = Math.round(f.w * dpi), H = Math.round(f.h * dpi);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('this browser cannot make a canvas this large');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

export async function jpegBlob(canvas, dpi) {
  const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('JPEG encoding failed'))), 'image/jpeg', 0.95));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // JFIF APP0 header: units (13) 1 = dots per inch, then X and Y density (14–17), big-endian
  const jfif = bytes[2] === 0xff && bytes[3] === 0xe0 && String.fromCharCode(...bytes.subarray(6, 10)) === 'JFIF';
  if (jfif) {
    bytes[13] = 1;
    bytes[14] = bytes[16] = dpi >> 8;
    bytes[15] = bytes[17] = dpi & 255;
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

// Uncompressed baseline TIFF, little-endian, 8 bits per channel RGB, one strip, dpi in the tags
export function tiffBlob(canvas, dpi) {
  const W = canvas.width, H = canvas.height;
  const px = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const pixels = W * H * 3;
  // Layout: 8-byte header, IFD (2 + TAGS × 12 + 4 bytes), then the out-of-line values, then pixels
  const TAGS = 13, IFD = 8, EXTRA = IFD + 2 + TAGS * 12 + 4;
  const BPS = EXTRA, XRES = BPS + 6, YRES = XRES + 8, DATA = YRES + 8;
  const buf = new ArrayBuffer(DATA + pixels);
  const dv = new DataView(buf), out = new Uint8Array(buf);

  dv.setUint16(0, 0x4949, true);            // 'II': little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, IFD, true);

  const tags = [
    [256, 4, 1, W],                         // ImageWidth
    [257, 4, 1, H],                         // ImageLength
    [258, 3, 3, BPS],                       // BitsPerSample: 8, 8, 8 (stored at BPS)
    [259, 3, 1, 1],                         // Compression: none
    [262, 3, 1, 2],                         // Photometric: RGB
    [273, 4, 1, DATA],                      // StripOffsets
    [277, 3, 1, 3],                         // SamplesPerPixel
    [278, 4, 1, H],                         // RowsPerStrip: the whole image
    [279, 4, 1, pixels],                    // StripByteCounts
    [282, 5, 1, XRES],                      // XResolution (rational, stored at XRES)
    [283, 5, 1, YRES],                      // YResolution
    [284, 3, 1, 1],                         // PlanarConfiguration: chunky
    [296, 3, 1, 2],                         // ResolutionUnit: inches
  ];
  if (tags.length !== TAGS) throw new Error('TIFF tag count out of step with the layout');
  dv.setUint16(IFD, tags.length, true);
  tags.forEach(([tag, type, count, value], i) => {
    const o = IFD + 2 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(o + 8, value, true);   // SHORT values sit in the first two bytes
    else dv.setUint32(o + 8, value, true);
  });
  dv.setUint32(IFD + 2 + TAGS * 12, 0, true);                           // no next IFD

  dv.setUint16(BPS, 8, true); dv.setUint16(BPS + 2, 8, true); dv.setUint16(BPS + 4, 8, true);
  dv.setUint32(XRES, dpi, true); dv.setUint32(XRES + 4, 1, true);
  dv.setUint32(YRES, dpi, true); dv.setUint32(YRES + 4, 1, true);

  for (let i = 0, j = DATA, n = W * H * 4; i < n; i += 4) {
    out[j++] = px[i]; out[j++] = px[i + 1]; out[j++] = px[i + 2];
  }
  return new Blob([buf], { type: 'image/tiff' });
}
