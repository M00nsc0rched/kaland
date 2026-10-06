// Könyv betöltése: kész .json, szöveges PDF, vagy szkennelt PDF (OCR a böngészőben).
import { buildBook, textItemsToLines, textBoxes } from './layout.js';
import { bookId } from './store.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
export const FORMAT = 'kjk-book';

// a pdf.js 4.x a Promise.withResolvers-t használja, ami csak iOS 17.4-től van a Safariban
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
}

let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(PDFJS).then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; })
    .catch(e => { pdfjsP = null; throw new Error('A PDF-olvasó nem töltődött be (nincs internet?). ' + (e && e.message || '')); });
  return pdfjsP;
}
const aborted = () => new DOMException('Megszakítva', 'AbortError');
let tessP = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (!tessP) tessP = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESS; s.async = true;
    s.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('A szövegfelismerő nem töltődött be.'));
    s.onerror = () => { tessP = null; reject(new Error('A szövegfelismerő (Tesseract) nem érhető el – nincs internet, vagy ez a nézet tiltja.')); };
    document.head.appendChild(s);
  });
  return tessP;
}

// Ha a nyelvi adat az oldal mellett is publikálva van (tessdata/hun.traineddata.gz), azt használjuk.
async function langPath() {
  try {
    const u = new URL('tessdata/', location.href).href;
    const r = await fetch(u + 'hun.traineddata.gz', { method: 'HEAD' });
    if (r.ok) return u.replace(/\/$/, '');
  } catch {}
  return undefined;
}

export function validateBook(b) {
  if (!b || b.format !== FORMAT || !b.sections || !b.max) throw new Error('Ez nem KJK-könyvfájl (hiányzik a „kjk-book” formátumjelölés).');
  if (!b.sections[1]) throw new Error('A könyvből hiányzik az 1. fejezetpont.');
  if (!b.id) b.id = bookId(b.title, b.max, (b.sections[1] || []).join(' '));
  return b;
}

export async function importFile(file, onProgress = () => {}, signal) {
  const name = (file.name || 'könyv').replace(/\.(pdf|json|kjk\.json)$/i, '').replace(/[_]+/g, ' ').trim();
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    onProgress({ phase: 'read', msg: 'Fájl beolvasása…' });
    const b = JSON.parse(await file.text());
    return validateBook(b);
  }
  const buf = await file.arrayBuffer();
  return importPdf(buf, name, onProgress, signal);
}

export async function importPdf(buf, name, onProgress = () => {}, signal) {
  onProgress({ phase: 'open', msg: 'PDF megnyitása…' });
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
  try { return await importDoc(doc, name, onProgress, signal); }
  finally { try { await doc.destroy(); } catch {} } // a PDF és a pdf.js munkaszál felszabadítása
}

// oldalanként saját méretarány (egy eltérő méretű borító ne torzítsa a többit)
const scaleOf = p => 1100 / p.getViewport({ scale: 1 }).width;

async function importDoc(doc, name, onProgress, signal) {
  let title = name;
  try { const md = await doc.getMetadata(); const t = md && md.info && md.info.Title; if (t && t.length > 3 && !/microsoft|untitled|\.doc|\.pdf/i.test(t)) title = t; } catch {}
  const N = doc.numPages;

  // van-e szövegréteg? (mintavétel)
  let chars = 0;
  const probe = [...new Set([Math.min(N, 10), Math.max(1, Math.floor(N / 2)), Math.max(1, N - 10)])];
  for (const n of probe) { const tc = await (await doc.getPage(n)).getTextContent(); chars += tc.items.reduce((a, it) => a + (it.str || '').length, 0); }
  const pages = [];
  const t0 = performance.now();
  if (chars > Math.min(600, probe.length * 150)) {
    for (let n = 1; n <= N; n++) {
      if (signal && signal.aborted) throw aborted();
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1 }), scale = scaleOf(p);
      const tc = await p.getTextContent();
      const pg = { n, W: Math.round(vp.width * scale), H: Math.round(vp.height * scale), conf: 100, lines: textItemsToLines(tc.items, vp, scale) };
      // illusztrációk: az oldal képét is meg kell rajzolni
      try {
        const rvp = p.getViewport({ scale });
        const c = document.createElement('canvas'); c.width = pg.W; c.height = pg.H;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: ctx, viewport: rvp, intent: 'print' }).promise;
        pg.figs = findFigures(c, pg);
        c.width = c.height = 0;
      } catch {}
      pages.push(pg);
      onProgress({ phase: 'text', page: n, total: N, msg: `Szöveg és képek kinyerése: ${n}/${N}. oldal` });
    }
  } else {
    await ocrPages(doc, N, pages, onProgress, signal, t0);
  }
  if (signal && signal.aborted) throw aborted();
  onProgress({ phase: 'layout', msg: 'Fejezetpontok szétválogatása…' });
  if (location.hostname === 'localhost') { try { window.__kjkPages = pages; } catch {} } // fejlesztéshez: nyers oldalak újraelemzése OCR nélkül
  const built = buildBook(pages);
  if (!built.max || !built.sections[1]) throw new Error('Nem találtam számozott fejezetpontokat ebben a PDF-ben. Biztosan KJK-lapozgatós könyv?');
  // mellékletek (pl. betű–szám táblázat) képként
  const appendix = [];
  for (const n of built.appendixPages.slice(0, 6)) {
    try {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 760 / p.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
      appendix.push({ page: n, img: c.toDataURL('image/jpeg', 0.72) });
    } catch {}
  }
  const book = {
    format: FORMAT, v: 1, title, source: name + '.pdf', importedAt: new Date().toISOString(),
    max: built.max, front: built.front, sections: built.sections, figs: built.figs, cover: await renderCover(doc),
    appendix, warnings: built.warnings, ocr: chars <= 600,
  };
  book.id = bookId(book.title, book.max, (book.sections[1] || []).join(' '));
  return book;
}

// ---- OCR -------------------------------------------------------------------
const NUMISH = /^[\d$§\]\[|lIOoSBŐő]{1,5}$/u;
const SUFFIX = /^([\d$§\]\[|lIOoSBŐő]{1,5})([-–]?\p{L}{0,3})([.,;:!?]*)$/u;

async function ocrPages(doc, N, pages, onProgress, signal, t0) {
  onProgress({ phase: 'ocr-init', msg: 'Szövegfelismerő betöltése (első alkalommal ~15 MB letöltés)…' });
  const T = await loadTesseract();
  if (signal && signal.aborted) throw aborted();
  const lp = await langPath();
  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  // a Tesseract createWorker-je sosem tér vissza, ha a nyelvi adat nem tölthető le: időkorlát + megszakítás
  const mk = () => new Promise((res, rej) => {
    const onAbort = () => rej(aborted());
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const to = setTimeout(() => rej(new Error('a magyar nyelvi adat nem tölthető le')), 90000);
    T.createWorker('hun', 1, { ...(lp ? { langPath: lp } : {}), errorHandler: e => rej(new Error(String(e))) })
      .then(w => { workers.push(w); res(w); }, rej)
      .finally(() => { clearTimeout(to); if (signal) signal.removeEventListener('abort', onAbort); });
  });
  try {
    for (let i = 0; i < cores; i++) await mk();
    const digit = await mk();
    await digit.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '8' });
  } catch (e) {
    for (const w of workers) { try { await w.terminate(); } catch {} }
    if (e && e.name === 'AbortError') throw e;
    throw new Error('A szövegfelismerő nem indult el ebben a nézetben. Próbáld asztali böngészőben vagy a telepített webappban, vagy tölts be kész .kjk.json fájlt. (' + (e && e.message || e) + ')');
  }
  const digit = workers.pop();
  let done = 0, next = 1, failed = 0;
  const render = async n => {
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale: scaleOf(p) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    return c;
  };
  const runWorker = async w => {
    while (next <= N) {
      if (signal && signal.aborted) return;
      const n = next++;
      try { await ocrOne(w, n); } catch (e) {
        // egy hibás oldal miatt nem vész el az egész munka: üres oldalként megy tovább
        failed++; console.warn('OCR oldal hiba', n, e);
        pages[n - 1] = { n, W: 1100, H: 1700, conf: 0, lines: [] };
        done++;
      }
    }
  };
  const ocrOne = async (w, n) => {
    {
      const c = await render(n);
      const { data } = await w.recognize(c, {}, { text: false, blocks: true, hocr: false, tsv: false });
      const lines = [];
      let inTable = false;
      for (const b of data.blocks || []) for (const par of b.paragraphs) for (const l of par.lines) {
        const words = l.words.map(wd => ({ t: wd.text, c: wd.confidence, b: wd.bbox }));
        const lt = words.map(x => x.t).join(' ');
        const isStat = /ÜGYESS|ÉLETER|ÉLETER/i.test(lt);
        const head = /^\S*G\S*\s+\S*ÉLETER/i.test(lt.trim());
        inTable = head || (inTable && words.length <= 6);
        // célszám- és adatsor-javítás számjegy-felismeréssel
        for (let k = 0; k < words.length; k++) {
          const wd = words[k];
          const m = SUFFIX.exec(wd.t);
          const prevW = k > 0 ? words[k - 1].t.toLowerCase() : '';
          const prev2 = k > 1 ? words[k - 2].t.toLowerCase() : '';
          const isTarget = m && (prevW === 'a' || prevW === 'az') && /apozz|vissza/.test(prev2);
          const isStatVal = (isStat || inTable) && k >= words.length - 3 && (NUMISH.test(wd.t) || /^\[\w\]$/.test(wd.t));
          const suspicious = (isTarget && (!/^\d{1,3}$/.test(m[1]) || +m[1] === 0)) || (isStatVal && !/^\d{1,2}$/.test(wd.t));
          if (!suspicious) continue;
          const fixed = await reocr(digit, c, wd.b);
          if (fixed) { wd.t = isTarget ? fixed + m[2] + m[3] : fixed; wd.fixed = true; }
        }
        lines.push({ t: words.map(x => x.t).join(' '), c: Math.round(l.confidence), b: [l.bbox.x0, l.bbox.y0, l.bbox.x1, l.bbox.y1], w: words.map(x => [x.t, Math.round(x.c), x.b.x0, x.b.x1]) });
      }
      pages[n - 1] = { n, W: c.width, H: c.height, conf: Math.round(data.confidence), lines };
      pages[n - 1].figs = findFigures(c, pages[n - 1]);
      c.width = c.height = 0; // telefonon számít a memória
      done++;
      const el = (performance.now() - t0) / 1000;
      const eta = Math.round(el / done * (N - done));
      onProgress({ phase: 'ocr', page: done, total: N, eta, msg: `Szövegfelismerés: ${done}/${N}. oldal` });
    }
  };
  try {
    await Promise.all(workers.map(runWorker));
  } finally {
    for (const w of [...workers, digit]) { try { await w.terminate(); } catch {} }
  }
  if (signal && signal.aborted) throw new DOMException('Megszakítva', 'AbortError');
  for (let i = 0; i < N; i++) if (!pages[i]) pages[i] = { n: i + 1, W: 1100, H: 1700, conf: 0, lines: [] };
}

async function reocr(worker, canvas, bb) {
  try {
    const pad = 6, k = 2;
    const x = Math.max(0, bb.x0 - pad), y = Math.max(0, bb.y0 - pad);
    const w = Math.min(canvas.width - x, bb.x1 - bb.x0 + pad * 2), h = Math.min(canvas.height - y, bb.y1 - bb.y0 + pad * 2);
    if (w < 4 || h < 4) return null;
    const c = document.createElement('canvas'); c.width = w * k; c.height = h * k;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.drawImage(canvas, x, y, w, h, 0, 0, w * k, h * k);
    const { data } = await worker.recognize(c);
    const t = (data.text || '').replace(/\D/g, '');
    return /^\d{1,3}$/.test(t) ? t : null;
  } catch { return null; }
}

// ---- illusztrációk -------------------------------------------------------------
// Szkennelt oldalon a kép nem külön objektum: ahol tinta van, de nincs elfogadott szövegsor,
// ott illusztráció áll. A sávot kivágjuk, és JPEG-ként a könyvbe tesszük.
export function findFigures(canvas, page) {
  const { boxes, medH } = textBoxes(page);
  const W = canvas.width, H = canvas.height;
  let data;
  try { data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data; } catch { return []; }
  const masked = new Uint8Array(H);
  for (const b of boxes) for (let y = Math.max(0, b[1] - 6); y <= Math.min(H - 1, b[3] + 6); y++) masked[y] = 1;
  const xa = Math.floor(W * 0.03), xb = Math.ceil(W * 0.97), ya = Math.floor(H * 0.015), yb = Math.ceil(H * 0.985);
  const rowInk = new Uint32Array(H);
  for (let y = ya; y < yb; y++) {
    let c = 0;
    for (let x = xa, i = (y * W + xa) * 4; x < xb; x++, i += 4) if (data[i] + data[i + 1] + data[i + 2] < 450) c++;
    rowInk[y] = c;
  }
  const minH = Math.max(60, medH * 2.2), gapMax = Math.round(medH * 0.9);
  const figs = [];
  let y = ya;
  while (y < yb) {
    if (masked[y] || rowInk[y] < 2) { y++; continue; }
    let start = y, end = y, gap = 0, ink = 0;
    for (y = start; y < yb && !masked[y]; y++) {
      if (rowInk[y] >= 2) { end = y; gap = 0; ink += rowInk[y]; } else if (++gap > gapMax) break;
    }
    const h = end - start + 1;
    if (h < minH || ink < h * W * 0.004) continue;
    // vízszintes határok: a tintás képpontok 0,5–99,5%-os szélei (a porszemek nem tágítják a keretet)
    const colInk = new Uint32Array(W);
    let total = 0;
    for (let yy = start; yy <= end; yy++) for (let x = xa, i = (yy * W + xa) * 4; x < xb; x++, i += 4) if (data[i] + data[i + 1] + data[i + 2] < 450) { colInk[x]++; total++; }
    let acc = 0, left = xa, right = xb - 1;
    for (let x = xa; x < xb; x++) { acc += colInk[x]; if (acc > total * 0.005) { left = x; break; } }
    acc = 0;
    for (let x = xb - 1; x >= xa; x--) { acc += colInk[x]; if (acc > total * 0.005) { right = x; break; } }
    if (right - left < W * 0.15) continue;
    const pad = 10;
    const cx = Math.max(0, left - pad), cy = Math.max(0, start - pad), cw = Math.min(W, right + pad) - cx, ch = Math.min(H, end + pad) - cy;
    const scale = Math.min(1, 640 / cw);
    const out = document.createElement('canvas'); out.width = Math.round(cw * scale); out.height = Math.round(ch * scale);
    const octx = out.getContext('2d'); octx.fillStyle = '#fff'; octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, cx, cy, cw, ch, 0, 0, out.width, out.height);
    figs.push({ y0: start, y1: end, w: out.width, h: out.height, img: out.toDataURL('image/jpeg', 0.72) });
  }
  return figs;
}

async function renderCover(doc) {
  try {
    const p = await doc.getPage(1);
    const vp0 = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: 240 / vp0.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

// Exportálás: a könyv .kjk.json fájlként (más eszközre átvihető).
export function bookToJson(book) {
  return JSON.stringify(book);
}
