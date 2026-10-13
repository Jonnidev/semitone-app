// Abre los formatos que llegan a un taller de serigrafía y los entrega como imagen o canvas listo para procesar.
// Las librerías externas (HEIC y PDF) se cargan solo cuando se necesitan.
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const HEIC2ANY = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
const TARGET = 3000; // lado mayor al rasterizar vectores (SVG, PDF, AI)

export const ACCEPT = 'image/*,.heic,.heif,.svg,.pdf,.ai';

export function fileKind(f) {
  const n = (f.name || '').toLowerCase(), t = (f.type || '').toLowerCase(), ext = n.includes('.') ? n.split('.').pop() : '';
  if (t === 'application/pdf' || ext === 'pdf' || ext === 'ai') return 'pdf';
  if (t === 'image/svg+xml' || ext === 'svg') return 'svg';
  if (t === 'image/heic' || t === 'image/heif' || ext === 'heic' || ext === 'heif') return 'heic';
  if (ext === 'psd' || t.includes('photoshop')) return 'psd';
  if (ext === 'tif' || ext === 'tiff' || t === 'image/tiff') return 'tiff';
  if (['eps', 'cdr', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'rar'].includes(ext)) return 'unsupported';
  return 'image';
}

function loadImg(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), im = new Image();
    im.onload = () => (im.naturalWidth ? res(im) : rej(new Error('vacía')));
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('no decodificable')); };
    im.src = url;
  });
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('No se pudo descargar el lector de este formato. Revisa tu conexión.'));
    document.head.appendChild(s);
  });
}

async function decodeHeic(f, status) {
  try { return await loadImg(f); } catch (e) { /* Safari lo lee directo; el resto necesita convertir */ }
  status('Convirtiendo foto HEIC…');
  if (!window.heic2any) await loadScript(HEIC2ANY);
  let out = await window.heic2any({ blob: f, toType: 'image/png' });
  if (Array.isArray(out)) out = out[0];
  return await loadImg(out);
}

async function decodeSvg(f) {
  const txt = await f.text();
  const doc = new DOMParser().parseFromString(txt, 'image/svg+xml'), svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('El SVG está dañado o no es un SVG válido.');
  let w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (!(w > 0 && h > 0) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
  if (!(w > 0 && h > 0)) { w = 1000; h = 1000; }
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const k = TARGET / Math.max(w, h), W = Math.round(w * k), H = Math.round(h * k);
  svg.setAttribute('width', W); svg.setAttribute('height', H);
  const im = await loadImg(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H);
  return c;
}

async function decodePdf(f, status) {
  status('Abriendo PDF…');
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  let doc;
  try { doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; }
  catch (e) { throw new Error(/\.ai$/i.test(f.name) ? 'Este archivo AI no tiene compatibilidad PDF. En Illustrator, guárdalo con "Crear archivo compatible con PDF" o expórtalo como PDF o PNG.' : 'No se pudo abrir el PDF: ' + (e.message || e)); }
  const page = await doc.getPage(1), base = page.getViewport({ scale: 1 });
  const scale = Math.min(12, TARGET / Math.max(base.width, base.height)), vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  status('Rasterizando la primera página…');
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp, background: 'rgba(0,0,0,0)' }).promise;
  return c;
}

// Devuelve { source, kind }: source es un <img> o <canvas>.
export async function decodeFile(f, status = () => {}) {
  const kind = fileKind(f);
  if (kind === 'psd') throw new Error('Los archivos PSD no se pueden abrir en el navegador. Expórtalo como PNG desde Photoshop (Archivo → Exportar → Exportar como).');
  if (kind === 'unsupported') throw new Error('Ese formato no es compatible. Usa PNG, JPG, WebP, HEIC, SVG, PDF o AI.');
  if (kind === 'heic') return { source: await decodeHeic(f, status), kind };
  if (kind === 'svg') return { source: await decodeSvg(f), kind };
  if (kind === 'pdf') return { source: await decodePdf(f, status), kind };
  try { return { source: await loadImg(f), kind }; }
  catch (e) {
    if (kind === 'tiff') throw new Error('Este navegador no abre TIFF. Expórtalo como PNG, o ábrelo desde Safari.');
    throw new Error('No se pudo leer la imagen. Puede estar dañada o en un formato no compatible: prueba con PNG o JPG.');
  }
}
