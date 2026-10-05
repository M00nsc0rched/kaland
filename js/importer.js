// Könyv betöltése: kész .json, szöveges PDF, vagy szkennelt PDF (OCR a böngészőben).
import { buildBook, textItemsToLines } from './layout.js';
import { bookId } from './store.js';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
export const FORMAT = 'kjk-book';

let pdfjsP = null;
function loadPdfjs() {
  if (!pdfjsP) pdfjsP = import(PDFJS).then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return m; });
  return pdfjsP;
}
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
  let title = name;
  try { const md = await doc.getMetadata(); const t = md && md.info && md.info.Title; if (t && t.length > 3 && !/microsoft|untitled|\.doc|\.pdf/i.test(t)) title = t; } catch {}
  const N = doc.numPages;
  const W0 = (await doc.getPage(1)).getViewport({ scale: 1 }).width;
  const scale = 1100 / W0;

  // van-e szövegréteg? (mintavétel)
  let chars = 0;
  const probe = [Math.min(N, 10), Math.min(N, Math.floor(N / 2)), Math.max(1, N - 10)];
  for (const n of probe) { const tc = await (await doc.getPage(n)).getTextContent(); chars += tc.items.reduce((a, it) => a + (it.str || '').length, 0); }
  const pages = [];
  const t0 = performance.now();
  if (chars > 600) {
    for (let n = 1; n <= N; n++) {
      if (signal && signal.aborted) throw new DOMException('Megszakítva', 'AbortError');
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      pages.push({ n, W: Math.round(vp.width * scale), H: Math.round(vp.height * scale), conf: 100, lines: textItemsToLines(tc.items, vp, scale) });
      onProgress({ phase: 'text', page: n, total: N, msg: `Szöveg kinyerése: ${n}/${N}. oldal` });
    }
  } else {
    await ocrPages(doc, N, scale, pages, onProgress, signal, t0);
  }
  onProgress({ phase: 'layout', msg: 'Fejezetpontok szétválogatása…' });
  if (location.hostname === 'localhost') { try { window.__kjkPages = pages; } catch {} } // fejlesztéshez: nyers oldalak újraelemzése OCR nélkül
  const built = buildBook(pages);
  if (!built.max || !built.sections[1]) throw new Error('Nem találtam számozott fejezetpontokat ebben a PDF-ben. Biztosan KJK-lapozgatós könyv?');
  // mellékletek (pl. betű–szám táblázat) képként
  const appendix = [];
  for (const n of built.appendixPages.slice(0, 6)) {
    try {
      const p = await doc.getPage(n);
      const vp = p.getViewport({ scale: 760 / W0 });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
      appendix.push({ page: n, img: c.toDataURL('image/jpeg', 0.72) });
    } catch {}
  }
  const book = {
    format: FORMAT, v: 1, title, source: name + '.pdf', importedAt: new Date().toISOString(),
    max: built.max, front: built.front, sections: built.sections, appendix, warnings: built.warnings, ocr: chars <= 600,
  };
  book.id = bookId(book.title, book.max, (book.sections[1] || []).join(' '));
  return book;
}

// ---- OCR -------------------------------------------------------------------
const NUMISH = /^[\d$§\]\[|lIOoSBŐő]{1,5}$/u;
const SUFFIX = /^([\d$§\]\[|lIOoSBŐő]{1,5})([-–]?\p{L}{0,3})([.,;:!?]*)$/u;

async function ocrPages(doc, N, scale, pages, onProgress, signal, t0) {
  onProgress({ phase: 'ocr-init', msg: 'Szövegfelismerő betöltése (első alkalommal ~15 MB letöltés)…' });
  const T = await loadTesseract();
  const lp = await langPath();
  const opts = lp ? { langPath: lp } : {};
  const cores = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const workers = [];
  try {
    for (let i = 0; i < cores; i++) workers.push(await T.createWorker('hun', 1, opts));
    const digit = await T.createWorker('hun', 1, opts);
    await digit.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '8' });
    workers.push(digit);
  } catch (e) {
    for (const w of workers) { try { await w.terminate(); } catch {} }
    throw new Error('A szövegfelismerő nem indult el ebben a nézetben. Próbáld asztali böngészőben, vagy tölts be kész .kjk.json fájlt. (' + (e && e.message || e) + ')');
  }
  const digit = workers.pop();
  let done = 0, next = 1;
  const render = async n => {
    const p = await doc.getPage(n);
    const vp = p.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await p.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    return c;
  };
  const runWorker = async w => {
    while (next <= N) {
      if (signal && signal.aborted) return;
      const n = next++;
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

// Exportálás: a könyv .kjk.json fájlként (más eszközre átvihető).
export function bookToJson(book) {
  return JSON.stringify(book);
}
