// Tárolás: könyvek IndexedDB-ben (nagyok), mentések és beállítások localStorage-ban.
// Minden hozzáférés try/catch-ben: privát ablakban vagy tiltott tárolásnál is működjön az oldal.

const DB = 'kjk', STORE = 'books';
let dbp = null;
const memBooks = new Map(); // tartalék, ha nincs IndexedDB

function open() {
  if (dbp) return dbp;
  dbp = new Promise(resolve => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    try {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    } catch (e) { reject(e); }
  });
}

// Igazat ad vissza, ha a könyv tartósan (IndexedDB-ben) elmentődött; különben csak erre a munkamenetre él.
export async function putBook(book) {
  memBooks.set(book.id, book);
  const db = await open();
  let ok = false;
  if (db) { try { await tx(db, 'readwrite', st => st.put(book)); ok = true; } catch (e) { console.warn('putBook', e); } }
  const meta = listMetaSync().filter(m => m.id !== book.id);
  meta.unshift(metaOf(book));
  lsSet('kjk:books', meta);
  return ok;
}

export async function getBook(id) {
  if (memBooks.has(id)) return memBooks.get(id);
  const db = await open();
  if (!db) return null;
  try { const b = await tx(db, 'readonly', st => st.get(id)); if (b) memBooks.set(id, b); return b || null; } catch { return null; }
}

export async function deleteBook(id) {
  memBooks.delete(id);
  const db = await open();
  if (db) { try { await tx(db, 'readwrite', st => st.delete(id)); } catch {} }
  lsSet('kjk:books', listMetaSync().filter(m => m.id !== id));
  lsDel('kjk:save:' + id);
}

export async function listBooks() {
  const meta = listMetaSync();
  const db = await open();
  if (!db) return meta;
  try {
    const keys = await tx(db, 'readonly', st => st.getAllKeys());
    // a localStorage-lista lehet hiányos (törölt adatok) – az IndexedDB az irányadó
    const known = new Set(meta.map(m => m.id));
    for (const k of keys || []) if (!known.has(k)) { const b = await getBook(k); if (b) meta.push(metaOf(b)); }
    return meta.filter(m => (keys || []).includes(m.id) || memBooks.has(m.id));
  } catch { return meta; }
}
function listMetaSync() { return lsGet('kjk:books', []); }
const metaOf = b => ({ id: b.id, title: b.title, max: b.max, importedAt: b.importedAt, source: b.source, cover: b.cover || null, figs: b.figs ? Object.values(b.figs).reduce((a, x) => a + x.length, 0) : 0 });

export const loadSave = id => lsGet('kjk:save:' + id, null);
export const writeSave = (id, s) => lsSet('kjk:save:' + id, s);
export const loadSettings = () => ({ textSize: 19, autoEffects: true, ...lsGet('kjk:settings', {}) });
export const writeSettings = s => lsSet('kjk:settings', s);
export const lastBook = () => lsGet('kjk:last', null);
export const setLastBook = id => lsSet('kjk:last', id);

function lsGet(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch {} }

// Könyv-azonosító: cím + pontszám + az 1. pont elejének FNV-1a hash-e (eszközök között is egyezik).
export function bookId(title, max, first) {
  let h = 0x811c9dc5;
  const s = `${title}|${max}|${(first || '').slice(0, 200)}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'b' + h.toString(36);
}
