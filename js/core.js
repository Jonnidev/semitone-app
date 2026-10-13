// Núcleo compartido entre la interfaz y los workers: color, tramas, muestreo y codificación de archivos.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- color ---------- */
export function hex2rgb(h) { h = String(h).replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
export function rgb2hex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('').toUpperCase(); }
const LIN = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const c = i / 1023; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const fL = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
export function rgb2lab(r, g, b, o, j) {
  const R = LIN[(clamp(r, 0, 1) * 1023 + .5) | 0], G = LIN[(clamp(g, 0, 1) * 1023 + .5) | 0], B = LIN[(clamp(b, 0, 1) * 1023 + .5) | 0];
  const fx = fL((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), fy = fL(0.2126 * R + 0.7152 * G + 0.0722 * B), fz = fL((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  o[j] = 116 * fy - 16; o[j + 1] = 500 * (fx - fy); o[j + 2] = 200 * (fy - fz);
}
export function labOf(hex) { const c = hex2rgb(hex), o = [0, 0, 0]; rgb2lab(c[0], c[1], c[2], o, 0); return o; }
export function lab2rgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200; const inv = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const g = c => { c = clamp(c, 0, 1); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
  return [g(3.2406 * X - 1.5372 * Y - 0.4986 * Z), g(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), g(0.0557 * X - 0.2040 * Y + 1.0570 * Z)];
}
export function colorName(hex) {
  const [r, g, b] = hex2rgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d < 0.1 || (d < 0.16 && (l > 0.88 || l < 0.14))) { if (l > 0.84) return 'Blanco'; if (l < 0.16) return 'Negro'; return 'Gris'; }
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
  if (h < 14 || h >= 345) return l < 0.32 ? 'Burdeo' : 'Rojo'; if (h < 40) return l < 0.4 ? 'Café' : 'Naranja'; if (h < 66) return l < 0.4 ? 'Ocre' : 'Amarillo';
  if (h < 160) return 'Verde'; if (h < 196) return 'Turquesa'; if (h < 250) return l < 0.3 ? 'Azul marino' : 'Azul'; if (h < 290) return 'Violeta'; return 'Magenta';
}

/* ---------- tramas ---------- */
export const TS = 128;
const TILES = {};
function spotFn(shape, u, v) {
  const a = Math.abs(u), b = Math.abs(v);
  switch (shape) {
    case 'round': return u * u + v * v;
    case 'euclid': return a + b <= 0.5 ? a * a + b * b : 2 - ((0.5 - a) ** 2 + (0.5 - b) ** 2);
    case 'ellipse': return a * 0.62 + b <= 0.5 ? 0.55 * u * u + 1.6 * v * v : 3 - (0.55 * (0.5 - a) ** 2 + 1.6 * (0.5 - b) ** 2);
    case 'square': return Math.max(a, b);
    case 'diamond': return a + b;
    case 'line': return b;
    default: return u * u + v * v;
  }
}
// Matriz de umbrales por rango: la cobertura del punto coincide exactamente con el tono pedido.
export function getTile(shape) {
  if (TILES[shape]) return TILES[shape];
  const N = TS * TS, f = new Float64Array(N), idx = new Uint32Array(N);
  for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) { const k = j * TS + i; f[k] = spotFn(shape, (i + 0.5) / TS - 0.5, (j + 0.5) / TS - 0.5) + ((i * 7919 + j * 104729) % 997) * 1e-9; idx[k] = k; }
  idx.sort((x, y) => f[x] - f[y]); const T = new Float32Array(N); for (let r = 0; r < N; r++) T[idx[r]] = (r + 0.5) / N; return TILES[shape] = T;
}
// Ruido azul (void-and-cluster) para la trama FM estocástica.
let BN = null;
export function blueNoise() {
  if (BN) return BN; const N = 64, M = N * N, sig = 1.9, K = new Float32Array(M);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = Math.min(x, N - x), dy = Math.min(y, N - y); K[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig)); }
  let E = new Float32Array(M), bin = new Uint8Array(M); const rank = new Float32Array(M), rnd = mulberry32(7);
  const add = (i, s) => { const iy = (i / N) | 0, ix = i % N; for (let y = 0; y < N; y++) { const ky = ((y - iy + N) % N) * N, ry = y * N; for (let x = 0; x < N; x++) E[ry + x] += s * K[ky + ((x - ix + N) % N)]; } };
  let ones = 0; while (ones < M / 10) { const i = (rnd() * M) | 0; if (!bin[i]) { bin[i] = 1; add(i, 1); ones++; } }
  for (let it = 0; it < 3000; it++) {
    let mx = -1, mi = -1; for (let i = 0; i < M; i++) if (bin[i] && E[i] > mx) { mx = E[i]; mi = i; } bin[mi] = 0; add(mi, -1);
    let mn = 1e9, vi = -1; for (let i = 0; i < M; i++) if (!bin[i] && E[i] < mn) { mn = E[i]; vi = i; } bin[vi] = 1; add(vi, 1); if (vi === mi) break;
  }
  const b0 = bin.slice(), E0 = E.slice();
  for (let r = ones - 1; r >= 0; r--) { let mx = -1, mi = -1; for (let i = 0; i < M; i++) if (bin[i] && E[i] > mx) { mx = E[i]; mi = i; } bin[mi] = 0; add(mi, -1); rank[mi] = r; }
  bin = b0; E = E0;
  for (let r = ones; r < M; r++) { let mn = 1e9, vi = -1; for (let i = 0; i < M; i++) if (!bin[i] && E[i] < mn) { mn = E[i]; vi = i; } bin[vi] = 1; add(vi, 1); rank[vi] = r; }
  for (let i = 0; i < M; i++) rank[i] = (rank[i] + 0.5) / M; return BN = rank;
}

// Parámetros de trama para una placa. z = píxeles de pantalla por píxel de salida (1 al exportar).
export function screenParams({ screen, shape, dpi, lpi, grain, angle, index, z }) {
  const a = angle * Math.PI / 180;
  if (screen === 'am') { const cell = dpi / lpi; return { am: true, cs: Math.cos(a), sn: Math.sin(a), inv: 1 / cell, tile: getTile(shape), tone: cell * z < 3 }; }
  const g = Math.max(1, grain / 25.4 * dpi);
  return { am: false, ig: 1 / g, ox: index * 17 + 3, oy: index * 29 + 11, bn: blueNoise(), tone: g * z < 1.6 };
}
export function sampleCov(cov, sx, sy, sw, sh) {
  if (sx < 0) sx = 0; else if (sx > sw - 1) sx = sw - 1; if (sy < 0) sy = 0; else if (sy > sh - 1) sy = sh - 1;
  const x = sx | 0, y = sy | 0, fx = sx - x, fy = sy - y, x1 = x + 1 < sw ? x + 1 : x, y1 = y + 1 < sh ? y + 1 : y, r0 = y * sw, r1 = y1 * sw;
  const a = cov[r0 + x], b = cov[r0 + x1], c = cov[r1 + x], d = cov[r1 + x1], t = a + (b - a) * fx; return t + ((c + (d - c) * fx) - t) * fy;
}
export function hitAt(q, X, Y, c) {
  if (q.am) { const u = (X * q.cs + Y * q.sn) * q.inv, v = (Y * q.cs - X * q.sn) * q.inv; return c > q.tile[(((v - Math.floor(v)) * TS) | 0) * TS + (((u - Math.floor(u)) * TS) | 0)]; }
  const gx = (Math.floor(X * q.ig) + q.ox) & 63, gy = (Math.floor(Y * q.ig) + q.oy) & 63; return c > q.bn[gy * 64 + gx];
}

/* ---------- fotolito de 1 bit ---------- */
// job: { cov, sw, sh, outW, outH, dpi, marks, mirror, screen:{...screenParams sin z}, label:{w,h,bits}|null }
// Devuelve las filas PNG ya filtradas y comprimidas (zlib), que sirven tanto para PNG como para PDF.
export async function renderPlate(job, prog = () => {}) {
  const { cov, sw, sh, outW, outH, dpi, marks, mirror, label } = job;
  const m = marks ? Math.round(1.3 / 2.54 * dpi) : 0, W = outW + 2 * m, H = outH + 2 * m;
  const rowLen = ((W + 7) >> 3) + 1, raw = new Uint8Array(rowLen * H); raw.fill(255); for (let y = 0; y < H; y++) raw[y * rowLen] = 0;
  const q = screenParams({ ...job.screen, dpi, z: 1 }), kx = sw / outW, ky = sh / outH;
  const black = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; raw[y * rowLen + 1 + (x >> 3)] &= ~(0x80 >> (x & 7)); };
  let lastT = Date.now();
  for (let y = 0; y < outH; y++) {
    const Y = y + 0.5, sy = Y * ky - 0.5, off = (y + m) * rowLen + 1;
    for (let x = 0; x < outW; x++) {
      const X = x + 0.5, c = sampleCov(cov, (mirror ? outW - X : X) * kx - 0.5, sy, sw, sh); if (c <= 0) continue;
      if (c >= 1 || hitAt(q, X, Y, c)) { const bx = x + m; raw[off + (bx >> 3)] &= ~(0x80 >> (bx & 7)); }
    }
    if ((y & 31) === 0 && Date.now() - lastT > 120) { lastT = Date.now(); prog(y / outH * 0.92); await tick(); }
  }
  if (m) {
    const R = Math.round(0.24 / 2.54 * dpi), t = Math.max(2, Math.round(0.22 / 25.4 * dpi)), L = Math.round(R * 1.55);
    for (const [cx, cy] of [[m >> 1, H >> 1], [W - (m >> 1), H >> 1], [W >> 1, m >> 1], [W >> 1, H - (m >> 1)]])
      for (let y = cy - L; y <= cy + L; y++) for (let x = cx - L; x <= cx + L; x++) { const d = Math.hypot(x - cx, y - cy); if (Math.abs(d - R) <= t / 2 || Math.abs(x - cx) <= t / 2 || Math.abs(y - cy) <= t / 2) black(x, y); }
    if (label) { const ox = m, oy = H - (m >> 1) - (label.h >> 1), lw = Math.min(label.w, Math.max(0, (W >> 1) - L - m - 8)); for (let y = 0; y < label.h; y++) for (let x = 0; x < lw; x++) if (label.bits[y * label.w + x]) black(ox + x, oy + y); }
  }
  prog(0.95);
  const idat = await zdeflate(raw);
  prog(1);
  return { idat, W, H, dpi };
}

/* ---------- PNG, PDF y ZIP ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(parts) { let c = 0xFFFFFFFF; for (const b of parts) for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer), tb = new TextEncoder().encode(type);
  dv.setUint32(0, data.length); out.set(tb, 4); out.set(data, 8); dv.setUint32(8 + data.length, crc32([tb, data])); return out;
}
export async function zdeflate(u8) { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate')); return new Uint8Array(await new Response(s).arrayBuffer()); }
export const u8 = async b => new Uint8Array(await b.arrayBuffer());

// PNG en escala de grises de 1 bit con resolución grabada (pHYs) y blanco transparente opcional.
export function encodePNG({ W, H, idat, dpi }, transparent) {
  const ih = new Uint8Array(13), d = new DataView(ih.buffer); d.setUint32(0, W); d.setUint32(4, H); ih[8] = 1; ih[9] = 0;
  const ph = new Uint8Array(9), pd = new DataView(ph.buffer), ppm = Math.round(dpi / 0.0254); pd.setUint32(0, ppm); pd.setUint32(4, ppm); ph[8] = 1;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('pHYs', ph)];
  if (transparent) parts.push(chunk('tRNS', new Uint8Array([0, 1])));
  parts.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)));
  return new Blob(parts, { type: 'image/png' });
}

// PDF con una página por placa al tamaño real. Cada placa es una máscara de imagen de 1 bit:
// los píxeles en 0 se pintan en negro y el resto queda sin tinta (transparente).
export function encodePDF(pages, title = 'Fotolitos') {
  const enc = new TextEncoder(), parts = [], offsets = []; let pos = 0;
  const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = pos; push(`${n} 0 obj\n`); push(body);
    if (stream) { push('\nstream\n'); push(stream); push('\nendstream'); }
    push('\nendobj\n');
  };
  push('%PDF-1.4\n'); push(new Uint8Array([37, 226, 227, 207, 211, 10]));
  const n = pages.length, kids = [];
  for (let i = 0; i < n; i++) kids.push(`${3 + i * 3} 0 R`);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${kids.join(' ')}] >>`);
  pages.forEach((p, i) => {
    const pn = 3 + i * 3, cn = pn + 1, im = pn + 2, w = (p.W / p.dpi * 72).toFixed(3), h = (p.H / p.dpi * 72).toFixed(3);
    obj(pn, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`);
    const content = enc.encode(`q 0 g ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    obj(cn, `<< /Length ${content.length} >>`, content);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${p.W} /Height ${p.H} /ImageMask true /BitsPerComponent 1 /Decode [0 1] /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 1 /BitsPerComponent 1 /Columns ${p.W} >> /Length ${p.idat.length} >>`, p.idat);
  });
  const info = 3 + n * 3; obj(info, `<< /Title (${title.replace(/[()\\]/g, '')}) /Producer (Trama Serigrafica) >>`);
  const xref = pos, total = info + 1;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x); push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), d = f.data, crc = crc32([d]);
    const lh = new Uint8Array(30 + nm.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(12, 0x21, true); v.setUint32(14, crc, true); v.setUint32(18, d.length, true); v.setUint32(22, d.length, true); v.setUint16(26, nm.length, true); lh.set(nm, 30);
    parts.push(lh, d);
    const ch = new Uint8Array(46 + nm.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true); ch.set(nm, 46);
    central.push(ch); off += lh.length + d.length;
  }
  const cd = central.reduce((a, b) => a + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cd, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
