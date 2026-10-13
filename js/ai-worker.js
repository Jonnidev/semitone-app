// Quitar fondo con IA, todo en el navegador del usuario (ONNX Runtime Web).
// Los modelos se sirven desde el propio sitio (carpeta /models), así no dependen de servicios externos.
//  - MODNet (Apache-2.0): recorte de personas.
//  - BiRefNet lite (MIT): cualquier objeto, alta calidad. Necesita WebGPU.
const ORT_DIR = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const MODELS_URL = new URL('../models/', import.meta.url);
const CACHE = 'trama-modelos-v1';

const CFG = {
  people: { key: 'modnet', size: 'short512', mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], needsGpu: false },
  general: { key: 'birefnet', size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], needsGpu: true },
};

let ort = null, manifest = null;
const sessions = {};
const post = (m, t) => self.postMessage(m, t || []);

async function hasWebGPU() {
  try { return !!(self.navigator.gpu && await self.navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

async function loadOrt() {
  if (ort) return ort;
  ort = await import(ORT_DIR + 'ort.webgpu.min.mjs');
  ort.env.wasm.wasmPaths = ORT_DIR;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
  return ort;
}

async function getManifest() {
  if (manifest) return manifest;
  const r = await fetch(new URL('models.json', MODELS_URL), { cache: 'no-cache' });
  if (!r.ok) throw new Error('Los modelos de IA todavía no están publicados en el sitio.');
  return manifest = await r.json();
}

// Descarga las partes del modelo (o las toma de la caché del navegador) y las une.
async function fetchModel(key) {
  const m = (await getManifest())[key];
  const cache = await caches.open(CACHE).catch(() => null);
  if (cache) {
    // Borra partes de versiones anteriores de este modelo que ya no se usan.
    const keep = new Set(m.files.map(f => new URL(f, MODELS_URL).href)), prefix = new URL(key + '/', MODELS_URL).href;
    for (const req of await cache.keys()) if (req.url.startsWith(prefix) && !keep.has(req.url)) await cache.delete(req);
  }
  const out = new Uint8Array(m.size); let off = 0, done = 0;
  for (const f of m.files) {
    const url = new URL(f, MODELS_URL).href;
    let res = cache ? await cache.match(url) : null;
    const fromCache = !!res;
    if (!res) { res = await fetch(url); if (!res.ok) throw new Error(`No se pudo descargar ${f} (${res.status}).`); }
    const body = fromCache ? res : res.clone();
    const reader = body.body.getReader();
    for (;;) {
      const { value, done: end } = await reader.read(); if (end) break;
      out.set(value, off); off += value.length; done += value.length;
      if (!fromCache) post({ stage: 'download', loaded: done, total: m.size });
    }
    if (!fromCache && cache) await cache.put(url, res).catch(() => {});
  }
  if (off !== m.size) throw new Error('El modelo descargado está incompleto. Inténtalo de nuevo.');
  return out;
}

async function getSession(model) {
  if (sessions[model]) return sessions[model];
  const cfg = CFG[model], gpu = await hasWebGPU();
  if (cfg.needsGpu && !gpu) throw new Error('El modelo "Cualquier objeto" necesita un navegador con WebGPU (Chrome o Edge actualizados, o Safari 26). Prueba con el modelo de personas.');
  await loadOrt();
  const bytes = await fetchModel(cfg.key);
  post({ stage: 'init' });
  let session, device = gpu ? 'webgpu' : 'wasm';
  try { session = await ort.InferenceSession.create(bytes, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'], graphOptimizationLevel: 'all' }); }
  catch (e) {
    if (!gpu || cfg.needsGpu) throw e;
    device = 'wasm'; session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  }
  return sessions[model] = { session, device };
}

/* ---------- utilidades numéricas ---------- */
function f32ToF16(v) {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer); f[0] = v; const x = u[0];
  const s = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112, m = x & 0x7fffff;
  if (e <= 0) return s; if (e >= 31) return s | 0x7c00; return s | (e << 10) | (m >> 13);
}
function f16ToF32(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024); if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}
// Redimensiona RGBA con interpolación bilineal y normaliza a tensor NCHW.
function toTensorData(rgba, w, h, W, H, mean, std) {
  const out = new Float32Array(3 * W * H), plane = W * H, kx = w / W, ky = h / H;
  for (let y = 0; y < H; y++) {
    let sy = (y + 0.5) * ky - 0.5; if (sy < 0) sy = 0; if (sy > h - 1) sy = h - 1;
    const y0 = sy | 0, y1 = Math.min(h - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      let sx = (x + 0.5) * kx - 0.5; if (sx < 0) sx = 0; if (sx > w - 1) sx = w - 1;
      const x0 = sx | 0, x1 = Math.min(w - 1, x0 + 1), fx = sx - x0;
      const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const t = rgba[a + ch] + (rgba[b + ch] - rgba[a + ch]) * fx, u = rgba[c + ch] + (rgba[d + ch] - rgba[c + ch]) * fx;
        out[ch * plane + y * W + x] = ((t + (u - t) * fy) / 255 - mean[ch]) / std[ch];
      }
    }
  }
  return out;
}

async function run(model, rgba, w, h) {
  const cfg = CFG[model], { session, device } = await getSession(model);
  post({ stage: 'run', device });
  let W, H;
  if (cfg.size === 'short512') {
    const s = 512 / Math.min(w, h);
    W = Math.max(32, Math.round(w * s / 32) * 32); H = Math.max(32, Math.round(h * s / 32) * 32);
  } else { W = H = cfg.size; }
  const data = toTensorData(rgba, w, h, W, H, cfg.mean, cfg.std);
  const name = session.inputNames[0];
  let out;
  try { out = await session.run({ [name]: new ort.Tensor('float32', data, [1, 3, H, W]) }); }
  catch (e) {
    // Algunos modelos fp16 esperan la entrada en float16.
    const h16 = new Uint16Array(data.length); for (let i = 0; i < data.length; i++) h16[i] = f32ToF16(data[i]);
    out = await session.run({ [name]: new ort.Tensor('float16', h16, [1, 3, H, W]) });
  }
  const t = out[session.outputNames[0]], dims = t.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  let src = t.data;
  if (!(src instanceof Float32Array)) { const f = new Float32Array(ow * oh); for (let i = 0; i < f.length; i++) f[i] = src instanceof Uint16Array ? f16ToF32(src[i]) : Number(src[i]); src = f; }
  // Si el modelo entrega logits (valores fuera de 0..1), se pasan por sigmoide.
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < ow * oh; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const sig = mn < -0.01 || mx > 1.01, small = new Float32Array(ow * oh);
  for (let i = 0; i < small.length; i++) { const v = src[i]; small[i] = sig ? 1 / (1 + Math.exp(-v)) : (v < 0 ? 0 : v > 1 ? 1 : v); }
  // Vuelve la máscara al tamaño de trabajo de la imagen.
  const matte = new Float32Array(w * h), kx = ow / w, ky = oh / h;
  for (let y = 0; y < h; y++) {
    let sy = (y + 0.5) * ky - 0.5; if (sy < 0) sy = 0; if (sy > oh - 1) sy = oh - 1;
    const y0 = sy | 0, y1 = Math.min(oh - 1, y0 + 1), fy = sy - y0;
    for (let x = 0; x < w; x++) {
      let sx = (x + 0.5) * kx - 0.5; if (sx < 0) sx = 0; if (sx > ow - 1) sx = ow - 1;
      const x0 = sx | 0, x1 = Math.min(ow - 1, x0 + 1), fx = sx - x0;
      const a = small[y0 * ow + x0], b = small[y0 * ow + x1], c = small[y1 * ow + x0], d = small[y1 * ow + x1];
      const top = a + (b - a) * fx; matte[y * w + x] = top + ((c + (d - c) * fx) - top) * fy;
    }
  }
  return { matte, device };
}

self.onmessage = async (e) => {
  const { model, rgba, w, h } = e.data;
  try { const r = await run(model, rgba, w, h); post({ done: true, matte: r.matte, device: r.device }, [r.matte.buffer]); }
  catch (err) { post({ err: String(err && err.message || err) }); }
};
