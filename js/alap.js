// Alaptörténetek titkosítása. A könyvek szövege szerzői jog alatt áll, ezért nem nyíltan, hanem
// titkosítva kerülnek a tárolóba (alap/*.kjke). Eszközönként egyszer kell megadni a kulcsot; a feloldott
// könyv utána az eszközön (IndexedDB) marad, és internet nélkül is játszható.
// (A katalógus az app.js-ben van; ezt a modult csak feloldáskor töltjük be, így egy félig frissült
// gyorsítótár sem akadályozhatja az alkalmazás indulását.)

// A kulcs 12 jelből áll (I, L, O, 0, 1 nélkül), kötőjelekkel tagolva; a beírásnál a kis- és
// nagybetű, a szóköz és a kötőjel nem számít.
export const normKey = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const KEY_LS = 'kjk:alapkulcs';
export function savedKey() { try { return localStorage.getItem(KEY_LS) || ''; } catch { return ''; } }
export function saveKey(k) { try { localStorage.setItem(KEY_LS, normKey(k)); } catch {} }
export function forgetKey() { try { localStorage.removeItem(KEY_LS); } catch {} }

// Fájlformátum: "KJKE" | verzió (1 bájt) | só (16) | IV (12) | AES-256-GCM titkosított JSON
const MAGIC = [0x4b, 0x4a, 0x4b, 0x45], ITER = 300000;
async function aesKey(pass, salt, usage) {
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(normKey(pass)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, raw, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export class BadKey extends Error {}

// Titkosított alaptörténet letöltése haladásjelzéssel (csak az első megnyitáskor kell internet).
export async function fetchBase(base, onProgress = () => {}, signal) {
  const mb = Math.round((base.size || 0) / 1e6);
  let res;
  try { res = await fetch(base.file, { cache: 'no-cache', signal }); }
  catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error(`Az első megnyitáshoz internet kell (a könyv letöltése kb. ${mb} MB).`); }
  if (!res.ok) throw new Error(`A könyvet nem sikerült letölteni (${res.status}). Próbáld újra később.`);
  const total = +res.headers.get('content-length') || base.size || 0;
  try {
    if (!res.body || !res.body.getReader) { const all = new Uint8Array(await res.arrayBuffer()); onProgress(1); return all; }
    const reader = res.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onProgress(Math.min(1, got / total));
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    // jellemzően: gyenge térerő, vagy az iPhone felfüggesztette a háttérbe került alkalmazást
    throw new Error('A letöltés megszakadt. Próbáld újra jó térerővel, és amíg tart, maradjon előtérben az alkalmazás.');
  }
}

export async function decryptBook(bytes, pass) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('Ez a böngésző nem támogatja a titkosítást (csak https-en működik).');
  if (bytes.length < 34 || MAGIC.some((b, i) => bytes[i] !== b) || bytes[4] !== 1) throw new Error('A letöltött fájl nem alaptörténet.');
  const salt = bytes.slice(5, 21), iv = bytes.slice(21, 33), ct = bytes.slice(33);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(pass, salt, 'decrypt'), ct); }
  catch { throw new BadKey('Hibás kulcs.'); }
  return JSON.parse(new TextDecoder().decode(plain));
}

// Fejlesztéshez (új alaptörténet készítése): a .kjk.json titkosítása ugyanebbe a formátumba.
export async function encryptBook(jsonText, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(pass, salt, 'encrypt'), new TextEncoder().encode(jsonText)));
  const out = new Uint8Array(5 + 16 + 12 + ct.length);
  out.set(MAGIC, 0); out[4] = 1; out.set(salt, 5); out.set(iv, 21); out.set(ct, 33);
  return out;
}

export function newKey() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let k = '';
  while (k.length < 12) { const x = crypto.getRandomValues(new Uint8Array(1))[0]; if (x < 248) k += A[x % 31]; } // torzításmentes
  return `${k.slice(0, 4)}-${k.slice(4, 8)}-${k.slice(8)}`;
}
