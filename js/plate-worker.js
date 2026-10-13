// Genera un fotolito en segundo plano para que la interfaz no se congele.
import { renderPlate } from './core.js';

self.onmessage = async (e) => {
  try {
    const out = await renderPlate(e.data, f => self.postMessage({ prog: f }));
    self.postMessage({ done: true, ...out }, [out.idat.buffer]);
  } catch (err) {
    self.postMessage({ err: String(err && err.message || err) });
  }
};
