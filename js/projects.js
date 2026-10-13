// Proyectos guardados en el navegador (IndexedDB). Nada se sube a internet.
const DB_NAME = 'trama-serigrafica', STORE = 'projects';

function open() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE); let out;
    Promise.resolve(fn(st)).then(v => { out = v; });
    t.oncomplete = () => { db.close(); res(out); };
    t.onerror = () => { db.close(); rej(t.error); };
    t.onabort = () => { db.close(); rej(t.error || new Error('Operación cancelada')); };
  });
}
const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const thumbUrls = new Map();
export async function listProjects() {
  const all = await tx('readonly', st => req2p(st.getAll()));
  return (all || []).sort((a, b) => b.date - a.date).map(p => {
    if (thumbUrls.has(p.id)) URL.revokeObjectURL(thumbUrls.get(p.id));
    const url = p.thumb ? URL.createObjectURL(p.thumb) : ''; thumbUrls.set(p.id, url);
    return { id: p.id, name: p.name, date: p.date, thumbUrl: url };
  });
}
export async function saveProject(rec) {
  const id = rec.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  await tx('readwrite', st => req2p(st.put({ ...rec, id })));
  return id;
}
export function loadProject(id) { return tx('readonly', st => req2p(st.get(id))); }
export function deleteProject(id) { return tx('readwrite', st => req2p(st.delete(id))); }
