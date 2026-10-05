// Oldal-elrendezés → könyvszerkezet.
// Bemenet: oldalak sorokkal (OCR vagy PDF-szövegréteg, ugyanabban az alakban):
//   pages = [{ n, W, H, lines: [{ t, c, b: [x0, y0, x1, y1] }] }]
// Kimenet: { front: [{ h?, p? }], sections: { [szám]: [bekezdés, …] }, max, warnings, appendixPages }

const DIGITISH = { l: '1', I: '1', '|': '1', i: '1', '!': '1', ']': '1', '[': '1', O: '0', o: '0', D: '0', Q: '0', S: '5', s: '5', $: '5', B: '8', Z: '2', z: '2', G: '6', b: '6', g: '9', q: '9', A: '4', T: '7', 'Ő': '6', 'ő': '6' };

export function ocrNumber(raw) {
  const s = String(raw).trim().replace(/[.,:;]+$/, '');
  if (!s || s.length > 4) return null;
  let out = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') out += ch;
    else if (DIGITISH[ch]) out += DIGITISH[ch];
    else return null;
  }
  return out ? parseInt(out, 10) : null;
}

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]; };

function pageMetrics(page, fallback) {
  const good = page.lines.filter(l => l.c >= 85 && l.t.trim().length > 0);
  const hs = good.map(l => l.b[3] - l.b[1]).filter(h => h > 4);
  const medH = median(hs) || (fallback && fallback.medH) || 30;
  const wide = good.filter(l => (l.b[2] - l.b[0]) > page.W * 0.55);
  if (wide.length >= 3) {
    const colL = pct(wide.map(l => l.b[0]), 0.2), colR = pct(wide.map(l => l.b[2]), 0.8);
    return { medH, colL, colR, wideCount: wide.length };
  }
  if (fallback) return { ...fallback, medH, wideCount: wide.length };
  return { medH, colL: page.W * 0.12, colR: page.W * 0.9, wideCount: wide.length };
}

const RUNHEAD = /^[\dlIOoSB|]{1,3}(\s*[-–—]\s*[\dlIOoSB|]{1,3})?$/;

function classify(page, m) {
  const out = [];
  const colW = m.colR - m.colL, colC = (m.colL + m.colR) / 2;
  let head = null;
  for (const l0 of page.lines) {
    let l = l0;
    // „, 394.” – az illusztrációból átcsúszott írásjel-szemét a fejléc előtt: a szavak dobozából vágjuk le
    // („132. ,” – vagy utána): ha egyetlen szó fejléc-alakú, a többi csak írásjel, a szó dobozát használjuk
    if (l.w && l.w.length > 1) {
      const hdrIdx = l.w.map((wd, i) => /^\d{1,3}[.,]$/.test(wd[0]) ? i : -1).filter(i => i >= 0);
      const othersJunk = hdrIdx.length === 1 && l.w.every((wd, i) => i === hdrIdx[0] || !/[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/.test(wd[0]));
      if (othersJunk) { const hw = l.w[hdrIdx[0]]; l = { ...l, t: hw[0], b: [hw[2], l.b[1], hw[3], l.b[3]] }; }
    }
    const t = l.t.replace(/\s+$/g, '').replace(/^\s+/, '');
    if (!t) continue;
    const [x0, y0, x1, y1] = l.b, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2;
    const top = y0 < page.H * 0.085, bottom = y0 > page.H * 0.9;
    if (top && RUNHEAD.test(t.replace(/\s/g, '')) && l.c >= 40) {
      const parts = t.replace(/\s/g, '').split(/[-–—]/).map(ocrNumber);
      if (parts.every(x => x != null)) { head = { from: parts[0], to: parts[parts.length - 1] }; continue; }
    }
    if ((bottom || top) && /^\d{1,3}$/.test(t) && w < m.medH * 2.2) continue; // oldalszám
    const centered = Math.abs(cx - colC) < Math.max(40, colW * 0.06);
    // fejezetpont-fejléc: rövid, középre zárt, szám(+pont)
    if (centered && w < m.medH * 4.5 && h < m.medH * 1.8 && /\d/.test(t) && /^[\dlIOoSBZzGgqA|!$\]\[ŐőT]{1,3}\s*[.,]$/.test(t)) {
      const num = ocrNumber(t);
      if (num != null) { out.push({ kind: 'hdr', num, raw: t, conf: l.c, y: y0 }); continue; }
    }
    // illusztráció-szemét kiszűrése
    if (l.c < 50) continue;
    if (t.replace(/\s/g, '').length <= 3 && Math.abs(x0 - m.colL) > m.medH) continue;
    const letters = (t.match(/[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]/g) || []).length;
    const aligned = Math.abs(x0 - m.colL) < m.medH * 1.1;
    if (l.c < 80 && !aligned) continue;
    if (l.c < 85 && (h > m.medH * 1.6 || h < m.medH * 0.5)) continue;
    if (letters < t.replace(/\s/g, '').length * 0.5 && !/\d/.test(t)) continue;
    if (l.c < 70 && letters < 6 && !(aligned && letters >= 3 && letters >= t.replace(/\s/g, '').length * 0.5)) continue;
    // a tokenek többsége szemét („V /, 7 1; 1 Lt 13 NI voX?”) → illusztrációból származik
    if (l.c < 85) {
      const toks = t.split(/\s+/).filter(Boolean);
      const wordish = toks.filter(x => /^[„"(—–-]?[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű][a-záéíóöőúüű-]+[.,;:!?…"”)]*$/.test(x) || /^\d{1,3}(?:[-–]\p{L}{1,3})?[.,;:!?]*$/u.test(x) || /^(a|az|s|e|—|–)$/i.test(x)).length;
      if (toks.length >= 3 && wordish < toks.length * 0.6) continue;
    }
    // nincs benne egyetlen valódi szó sem (de a „a 20$8-ra.” jellegű célszám-folytatást megtartjuk)
    if (l.c < 80 && !/[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű]{3,}/.test(t) && !(aligned && /\d\S*-?(?:r[ae]|hoz|hez|höz)\b/.test(t))) continue;
    const isTitle = centered && !aligned && w < colW * 0.8 && l.c >= 80 && x0 > m.colL + m.medH * 1.5;
    out.push({ kind: isTitle ? 'title' : 'text', t, x0, x1, y: y0, conf: l.c, indent: x0 - m.colL, short: x1 < m.colR - m.medH * 1.4, medH: m.medH });
  }
  return { items: out, head };
}

const UP = 'A-ZÁÉÍÓÖŐÚÜŰ', LO = 'a-záéíóöőúüű';
const NUMTOK = '[\\dŐő\\[\\]|lIOoSB$]{1,3}';
const STAT_LINE = new RegExp(`(ÜGYESSÉG|ÉLETERŐ)\\s+${NUMTOK}\\s*$`);
const STAT_HEAD = /^ÜGYESSÉG\s+ÉLETERŐ\s*$/;
const STAT_ROW = new RegExp(`^\\S.*\\s${NUMTOK}\\s+(${NUMTOK}|\\[\\w\\])\\s*$`);
const ENDS_TARGET = new RegExp(`\\d{1,3}-?[${LO}]{0,3}[.;!?]$`);

// Sorok bekezdésekké fűzése (elválasztás, behúzás, rövid sor alapján).
function joinLines(lines) {
  const paras = [];
  let cur = null, prev = null, inTable = false;
  for (const l0 of lines) {
    const t = normalizeOcr(l0.t);
    const l = { ...l0, t };
    // ellenfél-adatsor / táblázat: mindig külön bekezdés
    const statHead = STAT_HEAD.test(t);
    const stat = statHead || STAT_LINE.test(t) || (inTable && STAT_ROW.test(t));
    inTable = statHead || (inTable && stat);
    const indented = l.indent > l.medH * 0.38;
    // függő behúzás: felsorolás-elem folytatása, vagy az előző sorral egy vonalban kezdődő behúzott sor
    const listItem = cur && /^\d{1,2}\.\s/.test(cur.t) && !/^\d{1,2}\.\s/.test(t);
    const hanging = prev && indented && (listItem || (Math.abs(l.x0 - prev.x0) < 8 && !prev.short));
    const prevEndsSentence = prev && /[.!?:…"”»)]$/.test(prev.t);
    const optionLine = prev && ENDS_TARGET.test(prev.t) && new RegExp(`^[${UP}—–-]`).test(t); // „…? Lapozz a 35-re.” sorok
    const bothTitles = prev && prev.kind === 'title' && l.kind === 'title';
    // új bekezdés behúzással csak mondatvég után kezdődhet (a választás-listák folytatósorai is behúzottak)
    const brk = !cur || stat || (prev && prev.stat) || (!bothTitles && ((l.kind === 'title') !== (prev && prev.kind === 'title'))) ||
      (!bothTitles && indented && !hanging && ((prevEndsSentence && !/:$/.test(prev.t)) || (prev && prev.kind === 'title'))) || (prev && prev.short && prevEndsSentence && !bothTitles) || (/^[—–-]\s/.test(t) && prevEndsSentence) || optionLine;
    if (brk) {
      if (cur) paras.push(cur);
      cur = { kind: l.kind === 'title' ? 'h' : 'p', t: stat ? cleanStat(t, statHead) : t };
    } else {
      const pt = cur.t;
      if (/\d-$/.test(pt)) cur.t = pt + t; // „133-” + „ra.”
      else if (new RegExp(`[${UP}]{2}-$`).test(pt) && new RegExp(`^[${UP}]{2}`).test(t)) cur.t = pt.slice(0, -1) + t; // „ÜGYESSÉ-” + „GEDET”
      else if (new RegExp(`[${UP}${LO}]-$`).test(pt) && new RegExp(`^[${LO}]`).test(t)) cur.t = pt.slice(0, -1) + t; // elválasztás
      else if (/-$/.test(pt)) cur.t = pt + t; // „Ember-” + „Ork”
      else cur.t = pt + ' ' + t;
    }
    l.stat = stat;
    prev = l;
  }
  if (cur) paras.push(cur);
  return paras.map(p => ({ kind: p.kind, t: tidy(p.t) }));
}

// Adatsor számainak OCR-javítása (Ő→6, ]→1 …); a felismerhetetlen marad „?”.
function cleanStat(t, isHead) {
  if (isHead) return 'ÜGYESSÉG ÉLETERŐ';
  return t.replace(new RegExp(`(\\s)(${NUMTOK}|\\[\\w\\])(?=\\s|$)`, 'g'), (m, sp, tok) => {
    const n = ocrNumber(tok);
    return sp + (n == null ? '?' : n);
  });
}

// Gyakori OCR-torzulások a játékszavakban (kiskapitális ÜGYESSÉG/SZERENCSE stb.).
export function normalizeOcr(s) {
  return s
    .replace(/(^|[\s(„"])([ÜüÖöUu0O][GgCc]{0,2}[cCxXrR]?[yYgG]{0,2}[Ee][Ss]{1,3}[ÉéEe][Gg])([A-ZÁÉÍÓÖŐÚÜŰa-záéíóöőúüű]*)/g, (m, pre, core, suf) => {
      // csak a „kiskapitális” torzulásokat javítjuk; a sima „ügyesség”/„Ügyesség” szó marad
      if ((core.slice(1).match(/[A-ZÁÉÍÓÖŐÚÜŰ]/g) || []).length < 2) return m;
      return pre + 'ÜGYESSÉG' + suf.toUpperCase();
    })
    .replace(/(^|[\s(„"])[Ss][Zz]{1,2}E?(?=[Ee]?RENCS)/g, '$1SZE')
    .replace(/SZEERENCS/g, 'SZERENCS')
    .replace(/\bK(ezd[eé]n|ezderi|ezderni)\b/g, 'Kezdeti')
    .replace(/(^|\s)[\]\[|lI](?=\s+(?:ÜGYESSÉG|ÉLETERŐ|SZERENCSE|pont|Arany|adag))/g, '$11');
}

export function tidy(s) {
  return s
    .replace(/\b([lL])a-?\s?[pP][oO0Q]{1,3}[zZ2]{1,3}\b/g, (m, l) => l + 'apozz') // „la-PoOzz” (elválasztott, rosszul felismert)
    .replace(/(\d)[\]\[|](?=\s)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/(\d)\s*[—–]\s*(\d)/g, '$1–$2')
    .replace(/„\s+/g, '„')
    .trim();
}

export function buildBook(pages, opts = {}) {
  const warnings = [];
  const sections = {};
  const front = [];
  const appendixPages = [];
  let state = 'pre', cur = 0, curLines = [], frontLines = [], lastSeenHead = null;
  let fallback = null, headsSeen = 0, tail = null; // tail: fej nélküli oldalak pufferje (lehet hátsó anyag)
  const flush = () => { if (cur > 0) { const paras = joinLines(curLines).map(p => p.t); sections[cur] = (sections[cur] || []).concat(paras); } curLines = []; };
  for (const page of pages) {
    const m = pageMetrics(page, fallback);
    if (m.wideCount >= 3) fallback = { medH: m.medH, colL: m.colL, colR: m.colR };
    const { items, head } = classify(page, m);
    const hdrs = items.filter(i => i.kind === 'hdr');
    if (state === 'pre') {
      // az 1. fejezetpont előtti „próza-oldalak” a bevezető
      const firstHdr = hdrs.find(h => h.num === 1);
      const pre = firstHdr ? items.filter(i => i.y < firstHdr.y) : items;
      const proseLines = pre.filter(i => i.kind === 'text' && (i.x1 - i.x0) > (m.colR - m.colL) * 0.6).length;
      if (proseLines >= 4 || (frontLines.length && proseLines >= 1)) frontLines.push(...pre.filter(i => i.kind !== 'hdr'));
      if (!firstHdr) continue;
      state = 'sec';
    } else if (!head && !hdrs.length && headsSeen >= 10) {
      // oldalfej nélküli oldal egy oldalfejes könyvben: illusztráció vagy hátsó anyag – pufferbe
      if (!tail) tail = { lines: [], pages: [] };
      // fej nélküli oldalról csak a biztosan felismert sorok jöhetnek (az illusztrációk zaja nem)
      tail.lines.push(...items.filter(i => i.kind !== 'hdr' && i.conf >= 85));
      tail.pages.push(page);
      continue;
    }
    if (head) headsSeen++;
    if (tail) {
      // mégis folytatódik a könyv: a pufferelt sorok a folyó ponthoz tartoztak
      if (tail.lines.length) warnings.push(`p${tail.pages.map(p => p.n).join(',')}: oldalfej nélküli oldal(ak) a(z) ${cur}. ponthoz csatolva`);
      curLines.push(...tail.lines);
      tail = null;
    }
    if (head) {
      if (head.from < (lastSeenHead ? lastSeenHead.from : 0)) warnings.push(`p${page.n}: oldalfej visszalépett (${head.from}-${head.to})`);
      lastSeenHead = head;
    }
    for (const it of items) {
      if (state === 'pre') { if (it.kind === 'hdr' && it.num === 1) { state = 'sec'; } else continue; }
      if (it.kind === 'hdr') {
        if (state === 'pre' || (cur === 0 && it.num !== 1)) continue;
        let n = it.num;
        const expected = cur + 1;
        if (n !== expected) {
          const inHead = head && n >= head.from && n <= head.to;
          if (n > expected && n <= expected + 2 && inHead) {
            warnings.push(`p${page.n}: hiányzó fejezetpont(ok) ${expected}…${n - 1} ('${it.raw}' előtt)`);
          } else if (head && expected >= head.from && expected <= head.to) {
            warnings.push(`p${page.n}: fejléc '${it.raw}' (${n}) → ${expected} javítva`);
            n = expected;
          } else if (n > expected && n <= expected + 2 && !head) {
            warnings.push(`p${page.n}: hiányzó fejezetpont(ok) ${expected}…${n - 1} (oldalfej nélkül)`);
          } else {
            // nem illeszkedő, oldalfejjel sem igazolható szám: zaj, kihagyjuk
            warnings.push(`p${page.n}: '${it.raw}' (${n}) kihagyva, várt: ${expected}`);
            continue;
          }
        }
        flush();
        cur = n;
        continue;
      }
      if (cur > 0) curLines.push(it);
    }
    if (head && hdrs.length === 0 && cur && (cur < head.from || cur > head.to)) warnings.push(`p${page.n}: oldalfej ${head.from}-${head.to}, de a folyó pont ${cur}`);
    if (head) for (let k = head.from; k <= head.to; k++) if (k > cur) warnings.push(`p${page.n}: oldalfej szerint ${k} itt kezdődik, de nem találtam a fejlécét`);
  }
  flush();
  if (tail) for (const p of tail.pages) if (p.conf == null || p.conf < 80) appendixPages.push(p.n);
  // bevezető
  for (const p of joinLines(frontLines)) front.push(p.kind === 'h' ? { h: p.t } : { p: p.t });
  const nums = Object.keys(sections).map(Number);
  const max = nums.length ? Math.max(...nums) : 0;
  const missing = [];
  for (let k = 1; k <= max; k++) if (!sections[k]) missing.push(k);
  if (missing.length) warnings.push(`hiányzó fejezetpontok: ${missing.join(', ')}`);
  return { front, sections, max, warnings, appendixPages };
}

// PDF szövegréteg → ugyanaz a sor-alak, mint az OCR-é (conf = 100).
export function textItemsToLines(items, viewport, scale) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = it.transform;
    const x = tx[4] * scale, yBase = (viewport.height - tx[5]) * scale;
    const h = Math.max(4, Math.hypot(tx[2], tx[3]) * scale);
    const w = (it.width || it.str.length * h * 0.5) * scale;
    let row = rows.find(r => Math.abs(r.yBase - yBase) < h * 0.45);
    if (!row) { row = { yBase, h, parts: [] }; rows.push(row); }
    row.parts.push({ x, w, s: it.str });
  }
  rows.sort((a, b) => a.yBase - b.yBase);
  return rows.map(r => {
    r.parts.sort((a, b) => a.x - b.x);
    let t = '', end = null;
    for (const p of r.parts) { if (end != null && p.x - end > r.h * 0.18 && !/\s$/.test(t)) t += ' '; t += p.s; end = p.x + p.w; }
    const x0 = r.parts[0].x, x1 = Math.max(...r.parts.map(p => p.x + p.w));
    return { t, c: 100, b: [Math.round(x0), Math.round(r.yBase - r.h), Math.round(x1), Math.round(r.yBase + r.h * 0.2)] };
  });
}
