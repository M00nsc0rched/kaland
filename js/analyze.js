// Fejezetpont-szöveg → játékmechanika (választások, próbák, ellenfelek, hatások).
// Magyar KJK-szóhasználatra hangolt szabályok; minden kimenet a megjelenítéshez is
// visszaadja a szövegbeli helyét, hogy a választás mondata kiemelhető legyen.

const L = '\\p{L}';
const NUMW = { egy: 1, két: 2, kettő: 2, három: 3, négy: 4, öt: 5, hat: 6, hét: 7, nyolc: 8, kilenc: 9, tíz: 10, tizenegy: 11, tizenkét: 12, tizenkettő: 12, húsz: 20 };
const NUM = `(\\d{1,3}|${Object.keys(NUMW).sort((a, b) => b.length - a.length).join('|')})`;
const toNum = s => { if (s == null) return null; const t = String(s).toLowerCase(); return /^\d+$/.test(t) ? parseInt(t, 10) : (NUMW[t] ?? null); };

// „lapozz a 133-ra”, „Lapozz vissza a 142-re”, „lapozz az annak megfelelő…” (ez utóbbi nem cél).
// A számjegy-csoport tűri az OCR-szemetet ($, §), ezt a fixTarget javítja.
const TARGET_RE = new RegExp(`[lLI1]apozz(?:on|ál|hatsz)?(?:\\s+(?:vissza|tovább|azonnal|rögtön|most|inkább))?\\s+(?:a|az|a\\(z\\))\\s+([$§]?\\d[\\d$§]{0,4})(?![\\d])(?:\\s*[-–]?\\s*(?:re|ra|hoz|hez|höz|es|as|os|ös|ba|be|ik|ös))?(?:\\.?\\s*fejezetpont${L}*)?`, 'gu');
const BACK_RE = /lapozz\s+vissza\s+(?:oda|arra\s+a\s+(?:fejezet)?pontra|ahhoz\s+a\s+(?:fejezet)?ponthoz)[,\s]+(?:ahonn(?:an|ét)|ahol)|ahonn(?:an|ét)\s+ide(?:lapoztál|jöttél|érkeztél)/;
const LATER_RE = /\bvalaha\b|bármikor|ha\s+utad\s+során|valahányszor\s+úgy\s+döntesz|később|jegyezd\s+fel\s+azt\s+a\s+fejezetpontot|aktuális\s+fejezetpont/;
// „ha még nem tetted” – a választás csak akkor él, ha a cél még nem volt meglátogatva
const NOT_YET = /(?:ha|és|\()\s*(?:még|eddig|korábban)\s+(?:még\s+)?nem\s+(?:tetted|tettél|vizsgáltad|nézted|olvastad|jártál|próbáltad|próbálkoztál|játszottál|ittál|ettél|kutattad)|amivel\s+még\s+nem\s+próbálkoztál/;
const COND_MORE = /\bha\s+\S*\s*fizet|aranytallért?\s+(?:adnál|adsz|fizet)|\bha\s+(?:a|az)\s+\p{L}+(?:val|vel)\s+(?:harcolsz|küzdesz|támadsz)|használn(?:ád|ál)|\bha\s+(?:egy\s+)?\p{L}*\s*adnál|\bha\s+kaptál|\bha\s+(?:vízzel|tűzzel)/u;

// OCR-hibás célszám javítása: a félkövér „8”-at a felismerő néha „58”, „$8”, „§” alakban adja.
export function fixTarget(tok, max = 999) {
  const raw = String(tok);
  if (/^\d+$/.test(raw) && +raw >= 1 && +raw <= max) return { n: +raw, raw, fixed: false };
  let s = raw.replace(/§/g, '8').replace(/^\$(?=\d{2})/, '').replace(/\$/g, '');
  if (/^\d+$/.test(s) && +s >= 1 && +s <= max) return { n: +s, raw, fixed: true };
  if (/58/.test(s)) { const t = s.replace('58', '8'); if (+t >= 1 && +t <= max) return { n: +t, raw, fixed: true }; }
  const cands = new Set();
  for (let i = 0; i < s.length; i++) { const t = s.slice(0, i) + s.slice(i + 1); if (/^\d+$/.test(t) && +t >= 1 && +t <= max) cands.add(+t); }
  if (cands.size === 1) return { n: [...cands][0], raw, fixed: true };
  return { n: null, raw, fixed: true, cands: [...cands] };
}

// Szövegszintű OCR-javítások, amelyek a megjelenítést és az elemzést is segítik.
export function fixText(s) {
  return s
    .replace(/\b([lL])a-?\s?[pP][oO0Q]{1,3}[zZ2]{1,3}\b/g, (m, l) => l + 'apozz')
    .replace(/(\d)[\]\[|](?=\s)/g, '$1')
    .replace(/\b[sS][zZ][eE]-\s?(RENCS)/g, 'SZE$1')
    .replace(/([A-ZÁÉÍÓÖŐÚÜŰ])-\s?([A-ZÁÉÍÓÖŐÚÜŰ]{2,})/g, '$1$2');
}

const STAT_WORD = '(ÜGYESSÉG|ÉLETERŐ|ÉLETERE|SZERENCSÉ|SZERENCSE)';
const STAT_KEY = w => /^ÜGY/.test(w) ? 'skill' : /^ÉLET/.test(w) ? 'stamina' : 'luck';

export const STAT_NAMES = { skill: 'ÜGYESSÉG', stamina: 'ÉLETERŐ', luck: 'SZERENCSE' };

// Mondat-/tagmondat-határok (pont, felkiáltó- és kérdőjel, pontosvessző), eltolásokkal.
export function splitClauses(text) {
  const out = [];
  const re = /([.!?…]+["”»)]?|;)(\s+|$)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    const end = m.index + m[1].length;
    // „1–2.”, „15. oldal” jellegű számos pontoknál nem vágunk, ha kisbetű jön
    const next = text.slice(end + m[2].length, end + m[2].length + 1);
    if (m[1] === '.' && /\d$/.test(text.slice(0, m.index)) && /[a-záéíóöőúüű]/.test(next)) continue;
    out.push({ start: last, end, text: text.slice(last, end) });
    last = end + m[2].length;
  }
  if (last < text.length) out.push({ start: last, end: text.length, text: text.slice(last) });
  return out.filter(c => c.text.trim());
}

const low = s => s.toLowerCase();

const RX = {
  luckTest: /próbára\s+(?:a\s+)?\S{0,3}?zerencs|szerencsepróbá/,
  skillTest: /próbára\s+(?:az\s+)?\S{0,4}?gyes+ég|ügyességpróbá/,
  dice1: /dobj\s+(?:egy|1)\s*(?:dobó)?kocká|dobj\s+(?:egy|1)\s+kocká|egy\s+kockával\s+dob/,
  dice2: /dobj\s+(?:két|kettő|2)\s*(?:dobó)?kocká|két\s+kockával\s+dob/,
  luckNo: /nincs\s+szerencséd|balszerencsés|nem\s+vagy\s+szerencsés|szerencsétlen|nem\s+volt\s+szerencséd|nem\s+jártál\s+szerencsével|nem\s+kísér\s+szerencse|szerencséd\s+cserben/,
  luckYes: /szerencséd\s+van|szerencsés\s+vagy|szerencsés\s+voltál|volt\s+szerencséd|szerencsével\s+jár|szerencse\s+kísér|ha\s+szerencsés/,
  testNo: /sikertelen|nem\s+sikerül|nem\s+sikerült|kudarc|elbuk|ha\s+nem\s+(?:jár|teljesít)/,
  testYes: /sikeres|sikerül|sikerült|teljesíted|ha\s+igen/,
  win: /legyőz|győzöl|győztél|győzelm|győzedelm|végz(?:el|ed|tél|ett)|végez(?:n|tél|tek|ted)|megölöd|megölnöd|elpusztít|nullára|(?:^|[^\d])0-ra|legyűr|ha\s+nyersz|megnyered\s+a\s+(?:harcot|csatát|küzdelmet)|túléled\s+a\s+(?:harcot|csatát|küzdelmet)|ellenfeled\s+(?:meghal|holtan)|ha\s+sikerül\s+(?:legyőzn|megöln|elpusztítan|végezn|levágn)/,
  flee: /elmenekül|elmenekül|menekülni|menekülsz|menekülnél|elfut(?:sz|nál|hatsz)|meghátrál|visszavonul/,
  cond: /^\s*(?:—\s*)?(?:ha|hogyha|amennyiben)\s+(?:(?:már|korábban|előzőleg|valaha)\s+)?(?:van|nálad|rendelkez|birtok|ismered|tudod|szerepel|megvan|visel|hordasz|magadnál|nincs|nem\s+(?:rendelkez|tudod|ismered|szerepel)|olvastad|jártál|találkoztál|megtaláltad|megszerezted|láttad|hallottad|elhoztad|felvetted|vetted|ittál|ettél|megittad|megetted)/,
  returnTo: /lapozz\s+vissza/,
  death: /kalandod\s+(?:itt\s+)?(?:véget\s+ér|véget\s+ért|befejeződött|itt\s+ér\s+véget)|meghaltál|halott\s+vagy|leled\s+halálod|véged\s+van|életed\s+itt\s+ér\s+véget|utad\s+itt\s+véget\s+ér|meg\s+kell\s+halnod/,
  numberInput: /megfelelő\s+fejezetpont|annak\s+megfelelő|számú\s+fejezetpont|számmal\s+egyező|a\s+válasznak\s+megfelelő|add?\s+össze|összeadod|betűinek|betűit|kódszám|amelyik\s+számot|azzal\s+a\s+számmal/,
  combatEvent: /harci\s+kör|támadóerő|megsebez|eltalál|sebet\s+ejt/,
};

function diceSet(clauseLow, sides) {
  const max = sides === 2 ? 12 : 6, min = sides === 2 ? 2 : 1;
  const all = []; for (let i = min; i <= max; i++) all.push(i);
  // csak a lapozási utasítás előtti rész számít („Ha az eredmény 6, lapozz az 54-re, … 4 ÉLETERŐ…”)
  const tm = TARGET_RE_LOW().exec(clauseLow);
  const head = tm ? clauseLow.slice(0, tm.index) : clauseLow;
  if (/páratlan/.test(head)) return all.filter(n => n % 2);
  if (/páros/.test(head)) return all.filter(n => !(n % 2));
  const body = head;
  const set = new Set();
  let m;
  const rng = /(\d{1,2})\s*[-–]\s*(\d{1,2})/g;
  let used = body;
  while ((m = rng.exec(body))) { for (let i = +m[1]; i <= +m[2]; i++) set.add(i); used = used.replace(m[0], ' '); }
  const singles = used.match(/\b\d{1,2}\b/g) || [];
  const lessEq = /(?:vagy|és)\s+(?:annál\s+)?(?:kevesebb|kisebb|alacsonyabb)|alatt/.test(body);
  const moreEq = /(?:vagy|és)\s+(?:annál\s+)?(?:több|nagyobb|magasabb)|felett|fölött/.test(body);
  for (const s of singles) {
    const n = +s;
    if (n < min || n > max) continue;
    if (lessEq && singles.length === 1) all.filter(x => x <= n).forEach(x => set.add(x));
    else if (moreEq && singles.length === 1) all.filter(x => x >= n).forEach(x => set.add(x));
    else set.add(n);
  }
  return [...set].filter(n => n >= min && n <= max).sort((a, b) => a - b);
}
const TARGET_RE_LOW = () => new RegExp(TARGET_RE.source, 'giu');

// A választás „címkéje”: a tagmondat a lapozási utasítás nélkül.
function labelOf(clauseText) {
  return clauseText
    .replace(TARGET_RE_LOW(), '')
    .replace(/\s*[,;:—–-]\s*$/, '')
    .replace(/\s*[,;]\s*(?=[.!?]?$)/, '')
    .replace(/\s+([.!?])$/, '$1')
    .replace(/^[\s—–-]+/, '')
    .replace(/[.!]$/, '')
    .trim();
}

// ---- ellenfelek -------------------------------------------------------------
const STAT_LINE = /^(.*?\S)\s+ÜGYESSÉG\s+(\d{1,2}|\?)\s+ÉLETERŐ\s*(\d{1,2}|\?)\s*$/u;
const TABLE_HEAD = /^ÜGYESSÉG\s+ÉLETERŐ$/u;
const TABLE_ROW = /^(.*?\S)\s+(\d{1,2}|\?)(?:\s+(\d{1,2})|\s*(\?))\s*$/u;

// ---- hatások ----------------------------------------------------------------
const LOSS = /veszt|veszít|vonj|vonnod|levon|vond\s+le|csökk|elveszt|elveszíted|kárt\s+okoz|sérül|fizet|elhasznál|elfogyaszt/;
const GAIN = /nyer|kapsz|kapj|adj|add\s+hozzá|hozzáad|növel|növek|visszanyer|visszakap|gyógy|visszaállít|helyreáll|emeld|emelkedik|\bnő\b|találsz|szerzel|szereztél/;
const COMBAT_RULE = /helyett|minden\s+(?:\S+\s+)?(?:harci\s+)?kör|valahányszor|ha\s+eltalál|amikor\s+eltalál|támadóerő|harci\s+körben|ellenfeled\s+(?:minden|ha)/;
const RECURRING = /\bminden\b[^.]*?(?:kor|alkalommal)\b|valahányszor/;
// feltételes / jövőbeli / leíró („Ekkor is elveszted…”, „6 ÉLETERŐ pontot fog majd visszaállítani”)
const HYPO = /\bekkor\b|\bilyenkor\b|használhatod|szokott\s+\d|következő\s+alkalommal|amikor\s+majd|legközelebb|\bfog(?:sz|ja|od)?\s+(?:majd\s+)?(?:\p{L}+\s+){0,3}\p{L}+ni\b|\bmajd\b[^.]*\bfog|-?hatod\s+majd/u;
// a hatás nem a játékost éri, hanem az ellenfelet
const ENEMY_DIR = /ellenfeled\p{L}*|ellenfelednek|a\s+lénytől|a\s+teremtménytől|tőle\b|sebet\s+ejt|sebesülést\s+(?:tudsz\s+)?okoz/u;
function segmentAt(text, pos) {
  let s = text.lastIndexOf(',', pos); s = s < 0 ? 0 : s + 1;
  let e = text.indexOf(',', pos); e = e < 0 ? text.length : e;
  // a „, és” utáni rész önálló, de a „6 ÉLETERŐ és 1 ÜGYESSÉG” egyben marad
  return text.slice(s, e);
}
// „3-4 Rosszul leszel… Vesztesz 2 ÉLETERŐ pontot.” – dobás-táblázat sora
function diceRow(text) {
  const m = /^(\d{1,2})\s*(?:[-–]\s*(\d{1,2}))?\s+\p{Lu}/u.exec(text);
  if (!m) return null;
  const a = +m[1], b = m[2] ? +m[2] : a;
  if (a < 1 || b > 12 || b < a) return null;
  const r = []; for (let i = a; i <= b; i++) r.push(i); return r;
}
const ENEMY_STAT = /ÉLETEREJ|ÜGYESSÉGÉ(?!D)|ÜGYESSÉGÉT|SZERENCSÉJ|ÉLETEREJÉ/;

function statPairs(clause) {
  const pairs = [];
  const A = new RegExp(`${NUM}\\s*(?:-?(?:es|as|os|ös))?\\s+(?:pont(?:ot|nyi|tal)?\\s+)?(?:(?:az?|saját)\\s+)?(?:Kezdeti\\s+)?${STAT_WORD}(${L}*)`, 'giu');
  const B = new RegExp(`${STAT_WORD}(${L}*)\\s+(?:pont${L}*\\s+)?(?:(?:száma|értéke)\\s+)?${NUM}\\s*(?:-?(?:vel|val|gyel|el|al))?\\s*(?:pont${L}*)?`, 'giu');
  const C = new RegExp(`${NUM}\\s*-?(?:vel|val|gyel|el|al)\\s+(?:az?\\s+)?${STAT_WORD}(${L}*)`, 'giu');
  let m;
  for (const [re, ni, si, sfx] of [[A, 1, 2, 3], [C, 1, 2, 3], [B, 3, 1, 2]]) {
    re.lastIndex = 0;
    while ((m = re.exec(clause))) {
      const full = m[si] + (m[sfx] || '');
      const n = toNum(m[ni]);
      if (n == null || n > 30) continue;
      if (pairs.some(p => m.index < p.end && m.index + m[0].length > p.start)) continue;
      pairs.push({ start: m.index, end: m.index + m[0].length, stat: STAT_KEY(m[si].toUpperCase()), n, word: full, enemy: ENEMY_STAT.test(full.toUpperCase()) });
    }
  }
  return pairs.sort((a, b) => a.start - b.start);
}

// Melyik próba-kimenethez kötött egy hatás („Ha nincs szerencséd, vesztesz 2 ÉLETERŐ pontot”)?
function whenOf(cl, hasLuck, hasSkill) {
  const s = cl.replace(/^[\s—–-]+/, '');
  if (hasLuck && RX.luckNo.test(s)) return 'luck_no';
  if (hasLuck && RX.luckYes.test(s)) return 'luck_yes';
  if (hasSkill && /^(?:ha|amennyiben)\s/.test(s) && RX.testNo.test(s)) return 'skill_no';
  if (hasSkill && /^(?:ha|amennyiben)\s/.test(s) && RX.testYes.test(s)) return 'skill_yes';
  if (/^ha\s+nem\b/.test(s)) return hasLuck ? 'luck_no' : hasSkill ? 'skill_no' : null;
  return null;
}
const FLEE_DECL = /elmenekülhetsz|el\s+is\s+menekülhetsz|menekülni\s+is\s+próbálhatsz/;
const COND_ANY =/(?:,|\bés)\s+(?:ha\s+)?(?:szerepel|van\s+nálad|nálad\s+van|rendelkezel|birtokodban\s+van|ismered\s+a|megvan\s+a)|kalandlapodon\s+(?:a|az|szerepel)|szerepel\s+(?:a\s+)?kalandlapodon/;

const GOLD_RE = new RegExp(`${NUM}\\s+(?:darab\\s+)?(?:arany(?:tallér|pénz|érmé|at|${L}*)|tallér${L}*)`, 'giu');
const FOOD_RE = new RegExp(`${NUM}\\s+(?:adag(?:nyi)?\\s+)?(?:élelm${L}*|étel${L}*|élelmiszer${L}*|étkezés${L}*|adag${L}*)`, 'giu');

function itemGuess(sentence) {
  // nagybetűs, nem mondatkezdő szavak (pl. „Kristályszilánk”, „Kaméleonbőr képesség”)
  const caps = [];
  const re = /(\p{Lu}[\p{Ll}-]{2,}(?:\s+\p{Lu}[\p{Ll}-]{2,})*)(?:\s+(képesség|ital|kard|pajzs|gyűrű|kulcs|amulett|tekercs))?/gu;
  let m;
  while ((m = re.exec(sentence))) {
    const before = sentence.slice(0, m.index).trimEnd();
    if (!before || /[.!?—–:(„"]$/.test(before)) continue; // mondatkezdő szó
    const w = m[1];
    if (/^(ÜGYESSÉG|ÉLETERŐ|SZERENCSE|Kalandlap\p{L}*|Ha|Lapozz|Aranytallér\p{L}*|Arany\p{L}*|Élelm\p{L}*)$/u.test(w)) continue;
    caps.push(stripCase(w) + (m[2] ? ' ' + m[2] : ''));
  }
  if (caps.length) return caps[0];
  const verb = /(?:elteszed|elrakod|magadhoz\s+veszed|zsebre\s+teszed|felveszed|eltehetsz|elviszed|elvihetsz|megkapod|kapsz|találsz)\s+(?:egy|a|az)?\s*((?:\p{Ll}+\s+){0,2}\p{Ll}+)/u.exec(sentence);
  if (verb) return capFirst(stripCase(verb[1]));
  return '';
}
function stripCase(w) {
  // tárgyrag és néhány gyakori rag levágása a szó végéről (legalább 3 betű maradjon)
  const m = /^(.*?\p{L}{3})(ért|nek|nak|val|vel|ból|ből|ról|ről|hoz|hez|höz|ot|et|öt|at|t)$/u.exec(w);
  return m ? m[1] : w;
}
const capFirst = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// ---- fő elemző --------------------------------------------------------------
export function analyzeSection(paras0, n, book = {}) {
  const paras = (paras0 || []).map(fixText);
  const out ={ n, paras: [], choices: [], enemies: [], combat: null, tests: [], effects: [], suggestions: [], death: false, victory: false, ending: false, numberInput: false };
  const all = paras.join(' ');
  const allLow = low(all);
  const hasLuck = RX.luckTest.test(allLow), hasSkill = RX.skillTest.test(allLow);
  const diceN = RX.dice2.test(allLow) ? 2 : RX.dice1.test(allLow) ? 1 : 0;

  // 1. kör: ellenfél-adatsorok (a választások besorolásához előre kell tudni, van-e harc)
  const kinds = [];
  let inTable = false;
  for (const text of paras) {
    let m;
    if ((m = STAT_LINE.exec(text))) {
      out.enemies.push({ name: m[1].replace(/[—–-]\s*$/, '').trim(), skill: toNum(m[2]), stamina: toNum(m[3]) });
      kinds.push({ kind: 'stat', name: m[1].trim(), skill: m[2], stamina: m[3] }); inTable = false;
    } else if (TABLE_HEAD.test(text)) { kinds.push({ kind: 'thead' }); inTable = true; }
    else if (inTable && (m = TABLE_ROW.exec(text)) && text.length < 60) {
      const st = m[3] || m[4];
      out.enemies.push({ name: m[1].trim(), skill: toNum(m[2]), stamina: toNum(st) });
      kinds.push({ kind: 'trow', name: m[1].trim(), skill: m[2], stamina: st });
    } else { kinds.push(null); inTable = false; }
  }

  const max = book.max || 999;
  let fleeMode = false;
  paras.forEach((text, pi) => {
    if (kinds[pi]) { out.paras.push(kinds[pi]); return; }

    const clauses = splitClauses(text);
    const spans = [];
    let condPrev = false;
    clauses.forEach((cl, ci) => {
      const cLow = low(cl.text);
      const re = TARGET_RE_LOW();
      let t;
      const targets = [];
      while ((t = re.exec(cl.text))) { const fx = fixTarget(t[1], max); targets.push({ num: fx.n, fix: fx, at: t.index, len: t[0].length }); }
      if (!targets.length && BACK_RE.test(cLow)) targets.push({ num: null, back: true });
      if (/^ha\s+nem\b/.test(cLow.replace(/^[\s—–-]+/, ''))) condPrev = true;
      if (FLEE_DECL.test(cLow) && !targets.length) fleeMode = true; // „Ha akarsz, Elmenekülhetsz…” – az utána jövő irányok menekülési utak
      for (const tg of targets) {
        let kind = 'plain', dice = null, cond = '', condType = null;
        if (tg.back) {
          kind = 'back';
        } else if (LATER_RE.test(cLow)) {
          // „Ha valaha úgy döntenél… jegyezd fel… majd lapozz a 235-re” – nem most választható, hanem eszköz-használat
          out.suggestions.push({ type: 'use', target: tg.num, name: itemGuess(paras.slice(Math.max(0, pi - 1), pi + 1).join(' ')), text: cl.text.trim(), para: pi });
          continue;
        }
        // a lapozási utasítás nélküli tagmondat dönt; a csupasz „Lapozz a 262-re.” az előző feltételes mondatot örökli
        let start = cl.start;
        let label = tg.back ? cl.text.trim() : labelOf(cl.text);
        let ctx = low(label);
        const prev = ci > 0 ? clauses[ci - 1] : null;
        const prevHasTarget = prev && TARGET_RE_LOW().test(prev.text);
        if (!label && prev && !prevHasTarget && (/\?$/.test(prev.text.trim()) || /^[\s—–-]*(?:ha|amennyiben|hogyha)\s/i.test(prev.text))) {
          start = prev.start; label = labelOf(prev.text); ctx = low(prev.text);
        }
        if (!tg.back) {
          if (RX.returnTo.test(cLow)) kind = 'return';
          if ((hasLuck || RX.luckTest.test(ctx)) && RX.luckNo.test(ctx)) kind = 'luck_no';
          else if ((hasLuck || RX.luckTest.test(ctx)) && RX.luckYes.test(ctx)) kind = 'luck_yes';
          else if (diceN && /\d\s*[-–]\s*\d|\bha\s+(?:az\s+(?:eredmény|összeg|dobás)\s+)?\d|páros|páratlan|\d-\p{L}*\s+dob/u.test(ctx) && (dice = diceSet(cLow, diceN)).length) kind = 'dice';
          else if (out.enemies.length && RX.win.test(ctx)) kind = 'combat_win';
          else if (out.enemies.length && (RX.flee.test(ctx) || /így\s+(?:tennél|teszel|döntesz|döntenél)/.test(ctx) || fleeMode)) kind = 'flee';
          else if (hasSkill && RX.testNo.test(ctx)) kind = 'skill_no';
          else if (hasSkill && RX.testYes.test(ctx)) kind = 'skill_yes';
          else if (RX.flee.test(ctx) && /harc|csat|küzd|ellenf/.test(allLow)) kind = 'flee';
          if (kind !== 'dice') dice = null;
          if ((kind === 'plain' || kind === 'return') && !/nem\s+tudod(?:\s+a\s+(?:választ|megoldást))?\s*,?\s*vagy/.test(ctx)) {
            if (NOT_YET.test(ctx)) { kind = 'conditional'; condType = 'notVisited'; cond = label; }
            else if (RX.cond.test(ctx) || COND_ANY.test(ctx) || COND_MORE.test(ctx)) { kind = 'conditional'; cond = label; condType = /fizet|aranytallér/.test(ctx) ? 'gold' : 'item'; }
          }
        }
        out.choices.push({ target: tg.num, kind, dice, cond, condType, label, para: pi, start, end: cl.end, ci, uncertain: tg.fix && tg.fix.n == null ? tg.fix : null, raw: tg.fix && tg.fix.fixed ? tg.fix.raw : null });
        spans.push({ start, end: cl.end, choice: out.choices.length - 1 });
      }
      // hatások ebben a tagmondatban
      const conditional = /(^|\s)(ha|hogyha|amennyiben)\s/.test(cLow) || condPrev;
      const when = whenOf(cLow, hasLuck, hasSkill);
      const combatRule = COMBAT_RULE.test(cLow);
      const forFight = /a\s+harc\s+(?:idejére|során|alatt|végéig)|a\s+küzdelem\s+(?:idejére|során|alatt)/.test(cLow);
      const pairs = statPairs(cl.text);
      const hypo = HYPO.test(cLow);
      const whenDice = diceRow(text);
      for (const p of pairs) {
        if (p.enemy) continue;
        // a pár saját vesszős szakasza dönt az irányról és a harci szabályról („Nyersz 2 SZERENCSE pontot…, és a harcok során…”)
        const seg = segmentAt(cl.text, p.start);
        const sLow = low(seg);
        if (ENEMY_DIR.test(sLow)) continue;
        let loss = LOSS.test(sLow), gain = GAIN.test(sLow);
        if (loss === gain) { loss = LOSS.test(cLow); gain = GAIN.test(cLow); }
        const initial = /kezdeti/i.test(cl.text.slice(Math.max(0, p.start - 20), p.end));
        if ((forFight || /a\s+harc\s+(?:idejére|során|alatt)/.test(sLow)) && p.stat === 'skill') { out.combatMods = out.combatMods || {}; out.combatMods.skill = (loss ? -1 : 1) * p.n; continue; }
        if (COMBAT_RULE.test(sLow) || RECURRING.test(cLow)) continue;
        if (loss === gain) continue; // irány nem egyértelmű
        const restore = /visszaállít|eredeti\s+értékére|kezdeti\s+értékére/.test(sLow);
        out.effects.push({ type: initial && !restore ? 'initial' : 'stat', stat: p.stat, delta: loss ? -p.n : p.n, cond: (conditional || hypo) && !when && !whenDice, when: whenDice ? 'dice' : when, dice: whenDice, para: pi, text: cl.text.slice(p.start, p.end), choice: targets.length ? out.choices.length - 1 : null });
      }
      // arany, élelem
      for (const [re, kind] of [[GOLD_RE, 'gold'], [FOOD_RE, 'food']]) {
        re.lastIndex = 0;
        let g;
        while ((g = re.exec(cl.text))) {
          const nAmt = toNum(g[1]);
          if (nAmt == null) continue;
          const goldGain = /talál|kapsz|kapod|nyer|zsebre|elteszed|elrakod|magadhoz|adj\s+hozzá|szerzel|jutalm|felveszed|összeszed|kínál/.test(cLow);
          const goldLoss = /fizet|kifizet|elveszít|elveszted|veszít|húzz?\s+le|vonj\s+le|vond\s+le|elkér|elvesz|odaadod|átadod|átadsz|odaadsz|adsz\s+(?:neki|oda)|add\s+oda|elfogyaszt|elfogy|megeszel|költs/.test(cLow);
          if (goldGain === goldLoss) continue;
          if (/^\s*(?:—\s*)?(?:ha|amennyiben)\s/.test(cLow) && /fizet|odaadod|átadod/.test(cLow) && targets.length) {
            // „Ha fizetsz 5 Aranytallért, lapozz…” – a választáshoz kötött költség
            out.effects.push({ type: kind, delta: -nAmt, cond: true, when: null, para: pi, text: g[0], choice: out.choices.length - 1 });
            continue;
          }
          out.effects.push({ type: kind, delta: goldGain ? nAmt : -nAmt, cond: (conditional || hypo) && !when && !whenDice, when: whenDice ? 'dice' : when, dice: whenDice, para: pi, text: g[0], choice: targets.length ? out.choices.length - 1 : null });
        }
      }
      // tárgyak, képességek, jegyzetek – csak javaslat, a játékos hagyja jóvá
      if (/(?:írd|jegyezd|vezesd|vedd)\s+(?:fel|be)\s+(?:a\s+)?kalandlap|kalandlapodra|elteszed|elrakod|magadhoz\s+veszed|zsebre\s+teszed|felveszed|hátizsákodba|tarisznyádba|eltehetsz|elviheted|elvihetsz|megkapod/.test(cLow) && !/arany|tallér|élelm|étel|adag/.test(cLow)) {
        const ability = /képesség/.test(cLow);
        const word = /(?:szót|kódszót|jelszót|számot|nevet)\b/.test(cLow);
        out.suggestions.push({ type: word ? 'note' : ability ? 'ability' : 'item', name: itemGuess(cl.text), text: cl.text.trim(), cond: conditional, para: pi });
      }
      if (/(?:húzd|húzz|töröld|radírozd)\s+(?:ki|le)|elveszíted\s+a|elveszted\s+a|odaadod\s+a|nincs\s+többé\s+(?:nálad|meg)/.test(cLow) && !/arany|tallér|élelm/.test(cLow)) {
        out.suggestions.push({ type: 'remove', name: itemGuess(cl.text), text: cl.text.trim(), cond: conditional, para: pi });
      }
      if (!/^ha\s+nem\b/.test(cLow.replace(/^[\s—–-]+/, ''))) condPrev = false;
    });
    out.paras.push({ kind: 'text', text, spans });
  });

  // próbák
  if (hasLuck) out.tests.push({ type: 'luck' });
  if (hasSkill) out.tests.push({ type: 'skill' });
  if (out.choices.some(c => c.kind === 'dice') || (diceN && !out.enemies.length)) out.tests.push({ type: 'dice', n: diceN || 1 });

  // harc
  if (out.enemies.length) {
    const one = /egyesével|egyenként|egymás\s+után|sorban\s+egymás|egyik\s+a\s+másik\s+után|egyszerre\s+csak\s+eggyel/.test(allLow);
    const mods = out.combatMods || {};
    const dmg = /szokásos\s+2\s+helyett\s+(\d)\s+ÉLETERŐ\s+pontot\s+kell\s+levonnod\s+magadtól/i.exec(all);
    if (dmg) mods.dmgToPlayer = +dmg[1];
    const armor = /vértje\s+(\d)-?(?:gyel|vel|el)?\s+csökkenti/i.exec(all);
    if (armor) mods.dmgToEnemy = Math.max(0, 2 - +armor[1]);
    out.combat = { mode: out.enemies.length > 1 ? (one ? 'one_by_one' : 'simultaneous') : 'single', mods, canFlee: out.choices.some(c => c.kind === 'flee'), noFlee: /nem\s+menekülhetsz/.test(allLow) };
  }

  // számbevitel: csak a most érvényes utasítás számít („Ha valaha…” → későbbre szóló jegyzet)
  for (const s of splitClauses(all)) {
    const sl = low(s.text);
    if (!RX.numberInput.test(sl) && !/fejezetpont\s+számához|fejezetpont\s+értékéből|számához\s+adj/.test(sl)) continue;
    const off = /adj\s+(\d+)-?\p{L}*\s+(?:hozzá\s+)?(?:a\s+)?(?:megfelelő\s+)?fejezetpont|fejezetpont\s+(?:számához|értékéhez)\s+adj\s+(?:hozzá\s+)?(\d+)/u.exec(sl);
    const sub = /(?:fejezetpont\s+(?:számából|értékéből)|értékéből)\s+vonj\s+le\s+(\d+)|vonj\s+le\s+(\d+)-?\p{L}*\s+(?:a\s+)?(?:megfelelő\s+)?fejezetpont/u.exec(sl);
    const offset = off ? +(off[1] || off[2]) : sub ? -(sub[1] || sub[2]) : null;
    if (LATER_RE.test(sl)) { if (offset) out.suggestions.push({ type: 'note', name: '', text: s.text.trim(), offset }); continue; }
    out.numberInput = true;
    if (offset) out.numberOffset = offset;
  }
  const deathWords = RX.death.test(allLow);
  if (!out.choices.length) {
    if (book.max && n === book.max) out.victory = true;
    else if (!out.numberInput) { out.death = true; out.ending = !deathWords; }
  }
  out.deathHint = deathWords;
  return out;
}

// Bevezetőből: kezdő felszerelés, arany, élelem, italok.
export function detectSetup(front) {
  const txt = (front || []).map(b => b.p || b.h || '').join(' ');
  const t = low(txt);
  const setup = { gold: 0, provisions: 0, mealValue: 4, potions: [], items: [] };
  let m;
  if ((m = /kezdetben\s+(\d+)\s+arany/.exec(t))) setup.gold = +m[1];
  if ((m = new RegExp(`${NUM}\\s+étkezésre\\s+elegendő`).exec(t))) setup.provisions = toNum(m[1]);
  else if ((m = new RegExp(`${NUM}\\s+adag\\s+élelm`).exec(t))) setup.provisions = toNum(m[1]);
  if ((m = /minden\s+étkezés\s+(\d+)\s+pontot/.exec(t))) setup.mealValue = +m[1];
  if (/ügyesség\s+itala/.test(t)) setup.potions.push({ id: 'skill', name: 'Az Ügyesség Itala', desc: 'Kezdeti értékére állítja vissza ÜGYESSÉG pontjaidat.' });
  if (/erő\s+itala/.test(t)) setup.potions.push({ id: 'stamina', name: 'Az Erő Itala', desc: 'Kezdeti értékére állítja vissza ÉLETERŐ pontjaidat.' });
  if (/szerencse\s+itala/.test(t)) setup.potions.push({ id: 'luck', name: 'A Szerencse Itala', desc: 'Kezdeti értékére állítja vissza SZERENCSE pontjaidat, és 1-gyel növeli Kezdeti SZERENCSÉDET.' });
  const add = (re, name) => { if (re.test(t)) setup.items.push(name); };
  add(/kardod|egy\s+kard/, 'Kard');
  add(/bőrvért/, 'Bőrvért');
  add(/bőrpáncél|bőr\s+páncél/, 'Bőrpáncél');
  add(/pajzsod|egy\s+pajzs/, 'Pajzs');
  add(/hátizsák/, 'Hátizsák');
  add(/lámpás/, 'Lámpás');
  add(/fáklyá/, 'Fáklya');
  if (!setup.provisions && /élelm/.test(t)) setup.provisions = 10;
  return setup;
}

// Feltétel ↔ tárgylista: van-e a feltételben említett dolog a játékosnál?
export function conditionHint(cond, items) {
  if (!cond || !items || !items.length) return null;
  const words = (cond.match(/\p{L}{4,}/gu) || []).map(w => low(w)).filter(w => !/^(rendelkez|szerepel|kalandlap|nálad|birtok|képesség|tárgy|valamilyen|bármilyen|amennyiben|hogyha|korábban|ismered|tudod)/.test(w));
  if (!words.length) return null;
  for (const it of items) {
    const name = low(it.name || it);
    for (const w of words) {
      const stem = w.slice(0, Math.max(4, Math.min(6, w.length - 2)));
      if (name.includes(stem)) return { has: true, item: it.name || it };
    }
  }
  return { has: false };
}

// Titkos fejezetpontokhoz: betű→szám (A=1 … Z=26, ékezet nélkül).
export function letterSum(word) {
  const plain = word.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  let sum = 0; const parts = [];
  for (const ch of plain) { const c = ch.charCodeAt(0); if (c >= 65 && c <= 90) { sum += c - 64; parts.push(`${ch}=${c - 64}`); } }
  return { sum, parts };
}
