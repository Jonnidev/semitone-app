// Quitar fondo con IA, todo en el navegador del usuario (Transformers.js + ONNX Runtime Web).
// Modelos con licencias permisivas para poder usarlos en un sitio público:
//  - MODNet (Apache-2.0): recorte de personas, liviano.
//  - BiRefNet lite (MIT): cualquier objeto, alta calidad, pesado.
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

const MODELS = {
  people: { id: 'Xenova/modnet', gpu: 'fp32', cpu: 'fp32', inputs: ['input'] },
  general: { id: 'onnx-community/BiRefNet_lite-ONNX', gpu: 'fp16', cpu: 'fp32', inputs: ['input_image'] },
};

let T = null;
const loaded = {};

function half2float(h) {
  const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + f / 1024);
}

async function pickDevice() {
  try { if (self.navigator.gpu && await self.navigator.gpu.requestAdapter()) return 'webgpu'; } catch (e) { /* sin WebGPU */ }
  return 'wasm';
}

async function load(key) {
  if (loaded[key]) return loaded[key];
  if (!T) { T = await import(TRANSFORMERS_URL); T.env.allowLocalModels = false; }
  const cfg = MODELS[key], files = {};
  const progress_callback = (p) => {
    if (p.status === 'progress' && p.total) {
      files[p.file] = { l: p.loaded, t: p.total };
      let l = 0, t = 0; for (const k in files) { l += files[k].l; t += files[k].t; }
      self.postMessage({ stage: 'download', loaded: l, total: t });
    }
  };
  let device = await pickDevice(), model;
  try {
    model = await T.AutoModel.from_pretrained(cfg.id, { device, dtype: device === 'webgpu' ? cfg.gpu : cfg.cpu, progress_callback });
  } catch (err) {
    if (device !== 'webgpu') throw err;
    device = 'wasm';
    model = await T.AutoModel.from_pretrained(cfg.id, { device, dtype: cfg.cpu, progress_callback });
  }
  const processor = await T.AutoProcessor.from_pretrained(cfg.id);
  return loaded[key] = { model, processor, device, cfg };
}

async function run(key, rgba, w, h) {
  const m = await load(key);
  self.postMessage({ stage: 'run', device: m.device });
  const image = new T.RawImage(rgba, w, h, 4).rgb();
  const { pixel_values } = await m.processor(image);
  const sessionInput = m.model.sessions?.model?.inputNames?.[0];
  const names = [...new Set([sessionInput, ...m.cfg.inputs, 'input', 'input_image', 'pixel_values'].filter(Boolean))];
  let out = null, lastErr = null;
  for (const name of names) {
    try { out = await m.model({ [name]: pixel_values }); break; } catch (err) { lastErr = err; }
  }
  if (!out) throw lastErr || new Error('El modelo no aceptó la imagen.');
  const t = Object.values(out)[0];
  const dims = t.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  let src = t.data;
  if (!(src instanceof Float32Array)) {
    const f = new Float32Array(ow * oh);
    if (t.type === 'float16' && src instanceof Uint16Array) for (let i = 0; i < f.length; i++) f[i] = half2float(src[i]);
    else for (let i = 0; i < f.length; i++) f[i] = Number(src[i]);
    src = f;
  }
  // Algunos modelos entregan logits: si salen del rango 0..1, se pasan por sigmoide.
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < ow * oh; i++) { const v = src[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const sig = mn < -0.01 || mx > 1.01;
  const small = new Float32Array(ow * oh);
  for (let i = 0; i < small.length; i++) { const v = src[i]; small[i] = sig ? 1 / (1 + Math.exp(-v)) : (v < 0 ? 0 : v > 1 ? 1 : v); }
  // Reescala la máscara al tamaño de trabajo de la imagen.
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
  return { matte, device: m.device };
}

self.onmessage = async (e) => {
  const { model, rgba, w, h } = e.data;
  try {
    const r = await run(model, rgba, w, h);
    self.postMessage({ done: true, matte: r.matte, device: r.device }, [r.matte.buffer]);
  } catch (err) {
    self.postMessage({ err: String(err && err.message || err) });
  }
};
