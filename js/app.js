// Kaland · Játék · Kockázat – telefonos lapozgatós játékmotor.
import { analyzeSection, detectSetup, conditionHint, letterSum, STAT_NAMES } from './analyze.js';
import { newCharacter, testLuck, testSkill, combatRound, roll, sum } from './rules.js';
import * as store from './store.js';
import { importFile, validateBook, bookToJson } from './importer.js';
import { DEMO } from './demo.js';

// ---------- apró segédek ----------
const $ = s => document.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// csupa nagybetűs játékszavak (ÜGYESSÉG, ÉLETERŐ…) kiskapitálissal, ahogy a könyvben
const caps = s => s.replace(/[A-ZÁÉÍÓÖŐÚÜŰ]{4,}/g, m => `<span class="sc">${m}</span>`);
const uid = () => Math.random().toString(36).slice(2, 9);
const hhmm = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const article = n => (/^(1|5)(\d\d)?$/.test(String(n)) || /^5\d$/.test(String(n)) ? 'az' : 'a');
const signed = d => (d > 0 ? '+' : '−') + Math.abs(d);
const cap1 = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const STAT_SHORT = { skill: 'ÜGY', stamina: 'ÉLET', luck: 'SZER' };
const dieEl = (v, big) => h('span', { class: 'die' + (big ? ' big' : ''), 'data-v': v, 'aria-label': String(v) }, ...Array.from({ length: 9 }, () => h('i')));
const diceEl = (vals, big) => h('span', { class: 'dice' }, vals.map(v => dieEl(v, big)));
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// ---------- állapot ----------
const S = { settings: store.loadSettings(), books: [], book: null, save: null, ana: new Map(), sheet: null, importing: null, setup: null, view: 'library' };
let saveTimer = null;
function persist() {
  if (!S.book || !S.save) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { S.save.savedAt = Date.now(); store.writeSave(S.book.id, S.save); }, 150);
}
const A = n => {
  if (!S.ana.has(n)) S.ana.set(n, analyzeSection(S.book.sections[n] || [], n, { max: S.book.max }));
  return S.ana.get(n);
};
function log(k, m, extra) {
  const sv = S.save; if (!sv) return;
  sv.log.push({ t: Date.now(), r: sv.round, s: sv.n || 0, k, m, ...(extra || {}) });
  if (sv.log.length > 3000) sv.log.splice(0, sv.log.length - 3000);
}

// ---------- könyv megnyitása, új kör ----------
async function openBook(id) {
  const book = id === DEMO.id ? DEMO : await store.getBook(id);
  if (!book) { toast('A könyv nem található ezen az eszközön.'); return showLibrary(); }
  S.book = book; S.ana = new Map();
  store.setLastBook(id);
  S.save = store.loadSave(id);
  if (!S.save || S.save.v !== 1) S.save = freshSave(book, 1);
  if (S.save.status === 'setup') startSetup(); else { S.view = 'play'; render(); scrollTop(); }
}
function freshSave(book, round, prev) {
  const setup = detectSetup(book.front);
  return { v: 1, bookId: book.id, round, status: 'setup', c: null, gold: setup.gold, food: setup.provisions, mealValue: setup.mealValue || 4, potion: null, items: [], notes: [], n: 0, trail: [], seen: [], sec: null, log: prev ? prev.log : [], history: prev ? prev.history : [], started: Date.now() };
}
function startSetup() {
  const setup = detectSetup(S.book.front);
  S.setup = { c: newCharacter(), setup, potion: setup.potions.length ? null : 'none', rolls: 1 };
  S.view = 'setup'; render(); scrollTop();
}
function beginAdventure() {
  const st = S.setup, sv = S.save;
  sv.c = { skill: st.c.skill, skillInit: st.c.skillInit, stamina: st.c.stamina, staminaInit: st.c.staminaInit, luck: st.c.luck, luckInit: st.c.luckInit };
  const p = st.setup.potions.find(x => x.id === st.potion);
  sv.potion = p ? { id: p.id, name: p.name, used: false } : null;
  sv.items = st.setup.items.map(name => ({ id: uid(), name, kind: 'item', from: 0 }));
  sv.gold = st.setup.gold; sv.food = st.setup.provisions; sv.mealValue = st.setup.mealValue || 4;
  sv.status = 'play'; sv.trail = []; sv.seen = []; sv.started = Date.now();
  log('start', `${sv.round}. kör kezdete. ÜGYESSÉG ${sv.c.skill}, ÉLETERŐ ${sv.c.stamina}, SZERENCSE ${sv.c.luck}` + (p ? `; ital: ${p.name}` : '') + `; ${sv.gold} arany, ${sv.food} adag élelem.`);
  S.setup = null; S.view = 'play';
  enterSection(1, 'start');
}
async function newRound(reason) {
  const sv = S.save;
  if (sv && sv.status === 'play') { sv.history.push({ round: sv.round, result: 'feladva', at: sv.n }); log('end', `A(z) ${sv.round}. kört feladtad a(z) ${sv.n}. pontban.`); }
  S.save = freshSave(S.book, (sv ? sv.round : 0) + 1, sv);
  persist(); closeSheet(); closeDrawer(); startSetup();
}

// ---------- lapozás ----------
function enterSection(n, how, label) {
  const sv = S.save, book = S.book;
  if (!book.sections[n]) { toast(`A(z) ${n}. fejezetpont nem létezik ebben a könyvben.`); return; }
  const from = sv.n;
  sv.n = n; sv.trail.push(n); if (!sv.seen.includes(n)) sv.seen.push(n);
  const a = A(n);
  sv.sec = { n, from, applied: {}, tests: {}, combat: null, sel: null, manual: false, sugs: {}, round: 0 };
  const via = how === 'start' ? 'A kaland kezdete' : how === 'jump' ? 'Kézi lapozás' : how === 'back' ? 'Visszalapozás' : how === 'use' ? 'Tárgyhasználat' : 'Lapozás';
  log('sec', `${via}: ${n}. fejezetpont` + (label ? ` („${label.slice(0, 80)}”)` : ''));
  if (a.enemies.length) {
    const m = a.combat.mods || {};
    sv.sec.combat = { enemies: a.enemies.map(e => ({ name: e.name, skill: e.skill, stamina: e.stamina, max: e.stamina, dead: false })), mode: a.combat.mode, mods: { skill: m.skill || 0, dmgToPlayer: m.dmgToPlayer || 2, dmgToEnemy: m.dmgToEnemy ?? 2 }, target: 0, rounds: [], last: null, over: false, won: false };
  }
  // feltétel nélküli hatások automatikusan
  if (S.settings.autoEffects) a.effects.forEach((e, i) => { if (!e.cond && !e.when && e.choice == null) applyEffect(e, i); });
  if (a.victory) { sv.status = 'won'; sv.history.push({ round: sv.round, result: 'győzelem', at: n }); log('win', `Győzelem! A(z) ${sv.round}. kör sikeresen véget ért (${sv.trail.length} fejezetpont).`); }
  else if (a.death && sv.status === 'play') die(a.deathHint ? 'A történet itt véget ért: elbuktál.' : 'A történet itt véget ért.', true);
  persist(); render(); scrollTop();
}
function confirmChoice(i) {
  const sv = S.save, a = A(sv.n), c = a.choices[i];
  if (!c) return;
  // a választáshoz kötött költség/hatás (pl. „Ha fizetsz 5 Aranytallért…”)
  a.effects.forEach((e, k) => { if (e.choice === i && !sv.sec.applied[k]) applyEffect(e, k); });
  if (sv.status !== 'play') return render();
  log('choice', `Választás (${i + 1}): ${cap1(c.label) || 'Tovább'}`);
  if (c.kind === 'back') {
    const tr = sv.trail; const prev = tr.length >= 2 ? tr[tr.length - 2] : null;
    if (prev == null) return openJump('Nem tudom, honnan jöttél ide. Add meg a fejezetpontot!');
    return enterSection(prev, 'back', c.label);
  }
  if (c.target == null) return openJump('A célszám a beolvasott szövegben sérült' + (c.uncertain && c.uncertain.cands && c.uncertain.cands.length ? ` (lehet: ${c.uncertain.cands.join(', ')})` : '') + '. Írd be, hová lapozol!', c.uncertain && c.uncertain.cands);
  enterSection(c.target, 'choice', c.label);
}
function onKey(i) {
  const sv = S.save; if (!sv || sv.status !== 'play') return;
  const st = choiceState(i);
  if (st.locked) { sv.sec.sel = i; render(); pulseActs(); return; }
  if (sv.sec.sel === i) {
    const a = A(sv.n), c = a.choices[i];
    if (c.kind === 'flee' && sv.sec.combat && !sv.sec.combat.over && !sv.sec.fleePaid) return fleeDialog(i);
    return confirmChoice(i);
  }
  sv.sec.sel = i; persist(); render();
  const span = document.querySelector(`.opt[data-c="${i}"]`);
  if (span) span.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
}
function choiceState(i) {
  const sv = S.save, a = A(sv.n), c = a.choices[i], sec = sv.sec;
  const t = sec.tests, cb = sec.combat;
  let locked = false, why = '';
  if (!sec.manual) {
    if (c.kind === 'luck_yes' || c.kind === 'luck_no') { locked = !t.luck || t.luck.ok !== (c.kind === 'luck_yes'); why = t.luck ? 'A szerencsepróba másképp alakult.' : 'Előbb tedd próbára a SZERENCSÉDET.'; }
    else if (c.kind === 'skill_yes' || c.kind === 'skill_no') { locked = !t.skill || t.skill.ok !== (c.kind === 'skill_yes'); why = t.skill ? 'Az ügyességpróba másképp alakult.' : 'Előbb tedd próbára az ÜGYESSÉGEDET.'; }
    else if (c.kind === 'dice') { locked = !t.dice || !c.dice.includes(t.dice.total); why = t.dice ? 'A dobás eredménye nem ez.' : 'Előbb dobj a kockával.'; }
    else if (c.kind === 'combat_win' && cb) { locked = !cb.won; why = 'Előbb győzd le az ellenfeledet.'; }
  }
  let hint = null;
  if (c.kind === 'conditional') hint = c.condType === 'notVisited' ? (c.target && sv.seen.includes(c.target) ? { has: false, text: 'ezt már megtetted' } : null) : c.condType === 'gold' ? { has: sv.gold > 0, text: `${sv.gold} aranyad van` } : conditionHint(c.cond, sv.items);
  return { locked, why, hint, seen: c.target && sv.seen.includes(c.target) && c.target !== sv.n };
}

// ---------- hatások ----------
function changeStat(stat, delta, why, opts = {}) {
  const c = S.save.c; if (!c || !delta) return 0;
  const init = stat + 'Init';
  const before = c[stat];
  let after = before + delta;
  if (delta > 0 && !opts.overInit) after = Math.min(after, Math.max(before, c[init]));
  after = Math.max(0, after);
  c[stat] = after;
  const real = after - before;
  if (real || delta) log(delta < 0 ? 'hurt' : 'gain', `${STAT_NAMES[stat]} ${signed(delta)}${real !== delta ? ` (ténylegesen ${signed(real)})` : ''} → ${after}` + (why ? ` – ${why}` : ''));
  flashStat(stat);
  if (stat === 'stamina' && after <= 0 && S.save.status === 'play') die('Elfogyott az ÉLETERŐD.');
  return real;
}
function applyEffect(e, idx) {
  const sv = S.save; if (!sv || sv.sec.applied[idx] != null) return;
  let real = 0;
  if (e.type === 'stat') real = changeStat(e.stat, e.delta, `„${e.text}”`);
  else if (e.type === 'initial') { const k = e.stat + 'Init'; sv.c[k] = Math.max(0, sv.c[k] + e.delta); if (e.delta < 0) sv.c[e.stat] = Math.min(sv.c[e.stat], sv.c[k]); else sv.c[e.stat] += e.delta; real = e.delta; log(e.delta < 0 ? 'hurt' : 'gain', `Kezdeti ${STAT_NAMES[e.stat]} ${signed(e.delta)} → ${sv.c[k]}`); flashStat(e.stat); }
  else if (e.type === 'gold') { const before = sv.gold; sv.gold = Math.max(0, sv.gold + e.delta); real = sv.gold - before; log(e.delta < 0 ? 'hurt' : 'gain', `Arany ${signed(e.delta)} → ${sv.gold}` + (real !== e.delta ? ' (nem volt elég)' : '')); }
  else if (e.type === 'food') { const before = sv.food; sv.food = Math.max(0, sv.food + e.delta); real = sv.food - before; log(e.delta < 0 ? 'hurt' : 'gain', `Élelem ${signed(e.delta)} adag → ${sv.food}`); }
  sv.sec.applied[idx] = real;
}
function undoEffect(e, idx) {
  const sv = S.save, real = sv.sec.applied[idx]; if (real == null) return;
  if (e.type === 'stat') { sv.c[e.stat] = Math.max(0, sv.c[e.stat] - real); flashStat(e.stat); }
  else if (e.type === 'initial') { sv.c[e.stat + 'Init'] -= real; if (real > 0) sv.c[e.stat] -= real; }
  else if (e.type === 'gold') sv.gold = Math.max(0, sv.gold - real);
  else if (e.type === 'food') sv.food = Math.max(0, sv.food - real);
  delete sv.sec.applied[idx];
  log('manual', `Visszavonva: ${effLabel(e)}`);
}
const effLabel = e => e.type === 'gold' ? `${signed(e.delta)} arany` : e.type === 'food' ? `${signed(e.delta)} élelem` : e.type === 'initial' ? `Kezdeti ${STAT_NAMES[e.stat]} ${signed(e.delta)}` : `${signed(e.delta)} ${STAT_NAMES[e.stat]}`;
function die(reason, fromText) {
  const sv = S.save; if (sv.status !== 'play') return;
  sv.status = 'dead';
  sv.history.push({ round: sv.round, result: 'halál', at: sv.n });
  log('death', `${reason} A(z) ${sv.round}. kör véget ért a(z) ${sv.n}. fejezetpontban.`);
  persist();
}

// ---------- próbák ----------
async function animate(el) { if (reduced() || !el) return; el.classList.add('rolling'); await new Promise(r => setTimeout(r, 450)); el.classList.remove('rolling'); }
function doLuck() {
  const sv = S.save; if (sv.sec.tests.luck) return;
  const r = testLuck(sv.c);
  sv.sec.tests.luck = r;
  log('luck', `Szerencsepróba: ${r.dice.join('+')}=${r.total} (SZERENCSE ${r.before}) – ${r.ok ? 'szerencsés vagy' : 'nincs szerencséd'}. SZERENCSE most ${sv.c.luck}.`);
  flashStat('luck');
  afterTest('luck', r.ok ? 'luck_yes' : 'luck_no');
}
function doSkill() {
  const sv = S.save; if (sv.sec.tests.skill) return;
  const r = testSkill(sv.c);
  sv.sec.tests.skill = r;
  log('skill', `Ügyességpróba: ${r.dice.join('+')}=${r.total} (ÜGYESSÉG ${r.before}) – ${r.ok ? 'sikeres' : 'sikertelen'}.`);
  afterTest('skill', r.ok ? 'skill_yes' : 'skill_no');
}
function doDice(n) {
  const sv = S.save; if (sv.sec.tests.dice) return;
  const dice = roll(n), total = sum(dice);
  sv.sec.tests.dice = { dice, total };
  log('dice', `Kockadobás: ${dice.join('+')}${n > 1 ? '=' + total : ''}.`);
  afterTest('dice', null, total);
}
function afterTest(type, kind, total) {
  const sv = S.save, a = A(sv.n);
  // a kimenethez kötött hatások
  if (S.settings.autoEffects) a.effects.forEach((e, i) => {
    if (kind && e.when === kind) applyEffect(e, i);
    if (type === 'dice' && e.when === 'dice' && e.dice && e.dice.includes(total)) applyEffect(e, i);
  });
  // a megfelelő választás kijelölése (első koppintás)
  const idx = a.choices.findIndex(c => (kind && c.kind === kind) || (type === 'dice' && c.kind === 'dice' && c.dice.includes(total)));
  if (idx >= 0 && sv.status === 'play') sv.sec.sel = idx;
  persist(); render();
  animate(document.querySelector('.mech .result:last-of-type'));
}

// ---------- harc ----------
function attack() {
  const sv = S.save, cb = sv.sec.combat; if (!cb || cb.over || sv.status !== 'play') return;
  if (cb.enemies.some(e => !e.dead && (e.skill == null || e.stamina == null))) { toast('Add meg az ellenfél hiányzó értékeit (a szövegben olvashatatlan volt).'); return; }
  if (cb.mode === 'one_by_one' || cb.mode === 'single') cb.target = cb.enemies.findIndex(e => !e.dead);
  if (cb.enemies[cb.target] && cb.enemies[cb.target].dead) cb.target = cb.enemies.findIndex(e => !e.dead);
  const res = combatRound(sv.c, cb.enemies, cb.target, { mode: cb.mode, skill: cb.mods.skill });
  cb.rounds.push(1); const k = cb.rounds.length;
  const parts = [];
  for (const v of res.vs) {
    const e = cb.enemies[v.i];
    if (v.out === 'hit') { e.stamina = Math.max(0, e.stamina - cb.mods.dmgToEnemy); parts.push(`megsebezted: ${e.name} (${v.eAS}) −${cb.mods.dmgToEnemy} → ${e.stamina}`); }
    else if (v.out === 'hurt') parts.push(`${e.name} (${v.eAS}) megsebzett`);
    else if (v.out === 'parry') parts.push(`${e.name} (${v.eAS}) támadását hárítod`);
    else parts.push(`${e.name} (${v.eAS}): kivédtétek egymás csapását`);
  }
  cb.last = { res, k, luck: null };
  log('combat', `${k}. harci kör – Támadóerőd ${res.pAS} (${res.pDice.join('+')}+${sv.c.skill}${cb.mods.skill ? signed(cb.mods.skill) : ''}): ${parts.join('; ')}.`);
  for (const v of res.vs) {
    const e = cb.enemies[v.i];
    if (v.out === 'hit' && e.stamina <= 0 && !e.dead) { e.dead = true; log('win', `Legyőzted: ${e.name}.`); }
  }
  if (res.hurt) changeStat('stamina', -cb.mods.dmgToPlayer * res.hurt, 'harci sebesülés');
  checkCombatEnd();
  persist(); render();
  animate(document.querySelector('.roundres'));
}
function checkCombatEnd() {
  const sv = S.save, cb = sv.sec.combat;
  if (cb.enemies.every(e => e.dead) && !cb.over) {
    cb.over = true; cb.won = true;
    log('win', `Megnyerted a harcot (${cb.rounds.length} kör).`);
    const a = A(sv.n);
    const idx = a.choices.findIndex(c => c.kind === 'combat_win');
    if (idx >= 0 && sv.status === 'play') sv.sec.sel = idx;
  }
  if (cb.target < 0 || (cb.enemies[cb.target] && cb.enemies[cb.target].dead)) cb.target = cb.enemies.findIndex(e => !e.dead);
}
function combatLuck(mode) {
  const sv = S.save, cb = sv.sec.combat; if (!cb || !cb.last || cb.last.luck) return;
  const r = testLuck(sv.c);
  cb.last.luck = { ...r, mode };
  const e = cb.enemies[cb.last.res.target];
  if (mode === 'attack' && e) {
    if (r.ok) { e.stamina = Math.max(0, e.stamina - 2); log('luck', `Szerencse a harcban (${r.dice.join('+')}=${r.total}): szerencsés – súlyos seb, ${e.name} −2 → ${e.stamina}.`); if (e.stamina <= 0 && !e.dead) { e.dead = true; log('win', `Legyőzted: ${e.name}.`); } }
    else { e.stamina += 1; log('luck', `Szerencse a harcban (${r.dice.join('+')}=${r.total}): balszerencse – csak karcolás, ${e.name} +1 → ${e.stamina}.`); }
  } else {
    if (r.ok) { log('luck', `Szerencse a harcban (${r.dice.join('+')}=${r.total}): szerencsés – enyhébb seb.`); changeStat('stamina', 1, 'szerencsés kivédés'); }
    else { log('luck', `Szerencse a harcban (${r.dice.join('+')}=${r.total}): balszerencse – súlyosabb seb.`); changeStat('stamina', -1, 'balszerencse a harcban'); }
  }
  flashStat('luck');
  checkCombatEnd(); persist(); render();
}
function fleeDialog(i) {
  modal('Menekülés', 'Ha elmenekülsz, ellenfeled még egyszer lesújt: vesztesz 2 ÉLETERŐ pontot. Szerencsepróbával csökkentheted (szerencsével −1, balszerencsével −3).', [
    ['Mégse', null], ['Szerencsepróbával', 'luck'], ['Menekülök', 'plain'],
  ]).then(v => {
    if (!v) return;
    const sv = S.save;
    let dmg = 2;
    if (v === 'luck') { const r = testLuck(sv.c); dmg = r.ok ? 1 : 3; log('luck', `Szerencse menekülésnél: ${r.dice.join('+')}=${r.total} – ${r.ok ? 'szerencsés' : 'balszerencse'}.`); }
    sv.sec.fleePaid = true;
    log('combat', 'Elmenekültél a harcból.');
    changeStat('stamina', -dmg, 'menekülés');
    if (sv.status === 'play') confirmChoice(i); else { persist(); render(); }
  });
}

// ---------- étkezés, ital, tárgyak, jegyzetek ----------
function eat() {
  const sv = S.save;
  if (sv.food <= 0) return toast('Nincs több élelmed.');
  if (sv.sec && sv.sec.combat && !sv.sec.combat.over && sv.sec.combat.rounds.length) return toast('Harc közben nem ehetsz.');
  sv.food--; log('meal', `Étkezés: ${sv.food} adag maradt.`);
  changeStat('stamina', sv.mealValue || 4, 'étkezés');
  persist(); render(); rerenderSheet();
}
function drinkPotion() {
  const sv = S.save, p = sv.potion; if (!p || p.used) return;
  p.used = true;
  if (p.id === 'skill') { const d = sv.c.skillInit - sv.c.skill; sv.c.skill = sv.c.skillInit; log('potion', `${p.name}: ÜGYESSÉG visszaállt ${sv.c.skill}-ra/re (+${d}).`); flashStat('skill'); }
  if (p.id === 'stamina') { const d = sv.c.staminaInit - sv.c.stamina; sv.c.stamina = sv.c.staminaInit; log('potion', `${p.name}: ÉLETERŐ visszaállt (+${d}) → ${sv.c.stamina}.`); flashStat('stamina'); }
  if (p.id === 'luck') { sv.c.luckInit += 1; sv.c.luck = sv.c.luckInit; log('potion', `${p.name}: Kezdeti SZERENCSE +1, SZERENCSE → ${sv.c.luck}.`); flashStat('luck'); }
  persist(); render(); rerenderSheet();
}
function addItem(name, kind = 'item', use = null) {
  name = (name || '').trim(); if (!name) return;
  S.save.items.push({ id: uid(), name, kind, use, from: S.save.n });
  log('item', `${kind === 'ability' ? 'Új képesség' : 'Új tárgy'}: ${name}` + (use ? ` (használat: → ${use})` : '') + '.');
  persist(); render(); rerenderSheet();
}
function removeItem(id) {
  const sv = S.save, it = sv.items.find(x => x.id === id); if (!it) return;
  sv.items = sv.items.filter(x => x.id !== id);
  log('item', `Elvesztett tárgy: ${it.name}.`);
  persist(); render(); rerenderSheet();
}
function addNote(text, offset) {
  text = (text || '').trim(); if (!text) return;
  S.save.notes.push({ id: uid(), text, offset: offset || null, from: S.save.n });
  log('note', `Jegyzet: ${text.slice(0, 120)}`);
  persist(); render(); rerenderSheet();
}
function jump(n, how = 'jump') {
  n = parseInt(n, 10);
  if (!n || !S.book.sections[n]) return toast(`Nincs ${n || '?'}. fejezetpont ebben a könyvben (1–${S.book.max}).`);
  closeSheet(); closeDrawer();
  if (S.save.status !== 'play') return toast('A kör véget ért – kezdj újat a menüben.');
  enterSection(n, how);
}

// ---------- megjelenítés ----------
function render() {
  renderBar();
  const page = $('#page'), dock = $('#dock');
  page.replaceChildren(); dock.replaceChildren();
  if (S.view === 'library' || !S.book) return renderLibrary(page, dock);
  if (S.view === 'setup') return renderSetup(page, dock);
  renderSection(page, dock);
}
function renderBar() {
  const bar = $('#bar'); bar.replaceChildren();
  bar.append(h('button', { class: 'menu-key', 'aria-label': 'Menü', onclick: openDrawer }, h('span')));
  const sv = S.save;
  if (S.view === 'play' && sv && sv.c) {
    bar.append(h('div', { class: 'runhead', 'aria-live': 'polite' }, `§ ${sv.n}`, h('small', null, `${sv.round}. kör`)));
    const st = (k, lbl, low) => h('span', { class: 'stat' + (low ? ' low' : ''), 'data-stat': k }, h('b', null, sv.c[k]), h('i', null, lbl));
    bar.append(h('button', { class: 'stats', 'aria-label': 'Kalandlap', onclick: () => openSheet('kalandlap') },
      st('skill', 'ügy'), st('stamina', 'élet', sv.c.stamina <= 4), st('luck', 'szer')));
  } else {
    bar.append(h('div', { class: 'runhead' }, S.view === 'setup' ? 'Kalandlap' : 'Könyvtár'));
  }
}
function flashStat(k) { requestAnimationFrame(() => { const el = document.querySelector(`.stat[data-stat="${k}"]`); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }); }
function scrollTop() { const p = $('#page'); if (p) p.scrollTop = 0; }

function paraHtml(p, choiceStates, sel) {
  const t = p.text;
  let out = '', pos = 0;
  for (const sp of [...p.spans].sort((a, b) => a.start - b.start)) {
    if (sp.start < pos) continue;
    out += caps(esc(t.slice(pos, sp.start)));
    const st = choiceStates[sp.choice] || {};
    out += `<span class="opt${st.locked ? ' locked' : ''}${sel === sp.choice ? ' sel' : ''}" data-c="${sp.choice}" role="button" tabindex="-1"><span class="badge">${sp.choice + 1}</span>${caps(esc(t.slice(sp.start, sp.end)))}</span>`;
    pos = sp.end;
  }
  out += caps(esc(t.slice(pos)));
  return out;
}

function renderSection(page, dock) {
  const sv = S.save, a = A(sv.n), sec = sv.sec;
  const wrap = h('div', { class: 'sheet-inner' });
  wrap.append(h('h2', { class: 'secno' }, `${sv.n}.`));
  const states = a.choices.map((c, i) => choiceState(i));
  const prose = h('div', { class: 'prose', style: `--text:${S.settings.textSize}px` });
  let prevStat = false;
  for (const p of a.paras) {
    if (p.kind === 'stat') { prose.append(h('div', { class: 'foe' }, h('em', null, p.name), h('span', { html: `<span class="sc">ÜGYESSÉG</span> ${esc(p.skill)}` }), h('span', { html: `<span class="sc">ÉLETERŐ</span> ${esc(p.stamina)}` }))); prevStat = true; continue; }
    if (p.kind === 'thead') { prose.append(h('div', { class: 'foe-head' }, h('span'), h('span', { class: 'sc' }, 'ÜGYESSÉG'), h('span', { class: 'sc' }, 'ÉLETERŐ'))); continue; }
    if (p.kind === 'trow') { prose.append(h('div', { class: 'foe row' }, h('em', null, p.name), h('span', null, p.skill), h('span', null, p.stamina))); prevStat = true; continue; }
    prose.append(h('p', { class: prevStat ? 'cont' : null, html: paraHtml(p, states, sec.sel) }));
    prevStat = false;
  }
  prose.addEventListener('click', ev => { const o = ev.target.closest('.opt'); if (o) onKey(+o.dataset.c); });
  wrap.append(prose);
  const mech = renderMech(a, sv);
  if (mech.childElementCount) wrap.append(mech);
  if (sv.status === 'dead') wrap.append(h('div', { class: 'ending' }, h('b', null, 'Meghaltál. '), 'Ez a kör véget ért. Az eseménynaplóban visszanézheted, mi történt.'));
  if (sv.status === 'won') wrap.append(h('div', { class: 'ending won' }, h('b', null, 'Győztél! '), 'Végigjártad a kalandot.'));
  page.append(wrap);
  renderDock(dock, a, sv, states);
}

function renderMech(a, sv) {
  const sec = sv.sec, mech = h('div', { class: 'mech' });
  // próbák eredményei
  const t = sec.tests;
  if (t.luck) mech.append(h('div', { class: 'panel' }, h('h4', null, 'Szerencsepróba'), h('div', { class: 'result' }, diceEl(t.luck.dice), h('span', null, `= ${t.luck.total} (SZERENCSE ${t.luck.before})`), h('span', { class: 'verdict ' + (t.luck.ok ? 'ok' : 'no') }, t.luck.ok ? 'Szerencsés vagy!' : 'Nincs szerencséd.'))));
  if (t.skill) mech.append(h('div', { class: 'panel' }, h('h4', null, 'Ügyességpróba'), h('div', { class: 'result' }, diceEl(t.skill.dice), h('span', null, `= ${t.skill.total} (ÜGYESSÉG ${t.skill.before})`), h('span', { class: 'verdict ' + (t.skill.ok ? 'ok' : 'no') }, t.skill.ok ? 'Sikeres!' : 'Sikertelen.'))));
  if (t.dice) mech.append(h('div', { class: 'panel' }, h('h4', null, 'Kockadobás'), h('div', { class: 'result' }, diceEl(t.dice.dice), t.dice.dice.length > 1 ? h('span', null, `= ${t.dice.total}`) : null)));
  // harc
  const cb = sec.combat;
  if (cb) {
    const panel = h('div', { class: 'panel' });
    panel.append(h('h4', null, cb.over ? 'Harc – vége' : cb.mode === 'simultaneous' ? 'Harc – egyszerre támadnak (koppints a célpontra)' : cb.mode === 'one_by_one' ? 'Harc – egyesével' : 'Harc'));
    const foes = h('div', { class: 'foes' });
    cb.enemies.forEach((e, i) => {
      const pct = e.max ? Math.max(0, Math.min(100, (e.stamina / e.max) * 100)) : 0;
      const missing = e.skill == null || e.stamina == null;
      foes.append(h('div', { class: 'foecard' + (e.dead ? ' dead' : '') + (i === cb.target && !cb.over && cb.mode === 'simultaneous' ? ' target' : ''), onclick: () => { if (!e.dead && cb.mode === 'simultaneous') { cb.target = i; persist(); render(); } } },
        h('span', { class: 'nm' }, e.name),
        missing ? h('span', { class: 'nums' }, h('button', { class: 'mini', onclick: ev => { ev.stopPropagation(); editFoe(i); } }, 'Értékek megadása'))
          : h('span', { class: 'nums' }, `ÜGY ${e.skill} · ÉLET ${e.stamina}`, ' ', h('span', { class: 'adj' },
            h('button', { 'aria-label': 'ÉLETERŐ −1', onclick: ev => { ev.stopPropagation(); e.stamina = Math.max(0, e.stamina - 1); if (e.stamina <= 0 && !e.dead) { e.dead = true; log('win', `Legyőzted: ${e.name} (kézi).`); } checkCombatEnd(); persist(); render(); } }, '−'),
            h('button', { 'aria-label': 'ÉLETERŐ +1', onclick: ev => { ev.stopPropagation(); e.stamina += 1; if (e.dead && e.stamina > 0) { e.dead = false; cb.over = false; cb.won = false; } persist(); render(); } }, '+'))),
        h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` }))));
    });
    panel.append(foes);
    if (cb.last) {
      const r = cb.last.res;
      const rr = h('div', { class: 'result roundres', style: 'margin-top:8px' }, h('span', null, `${cb.last.k}. kör:`), diceEl(r.pDice), h('span', null, `→ ${r.pAS}`));
      for (const v of r.vs) rr.append(h('span', { class: 'muted' }, ` ${cb.enemies[v.i].name}:`), diceEl(v.eDice), h('span', { class: 'verdict ' + (v.out === 'hit' || v.out === 'parry' ? 'ok' : v.out === 'hurt' ? 'no' : '') }, `${v.eAS} ${v.out === 'hit' ? '– megsebezted' : v.out === 'hurt' ? '– megsebzett' : v.out === 'parry' ? '– hárítva' : '– döntetlen'}`));
      if (cb.last.luck) rr.append(h('span', { class: 'verdict ' + (cb.last.luck.ok ? 'ok' : 'no') }, cb.last.luck.ok ? ' · Szerencse!' : ' · Balszerencse.'));
      panel.append(rr);
    }
    panel.append(h('div', { class: 'mods', style: 'margin-top:8px' },
      h('label', null, 'Ügyesség-módosító', h('input', { type: 'number', id: 'mod-skill', value: cb.mods.skill, onchange: ev => { cb.mods.skill = parseInt(ev.target.value, 10) || 0; persist(); } })),
      h('label', null, 'Sebzésed', h('input', { type: 'number', id: 'mod-dmge', min: 0, value: cb.mods.dmgToEnemy, onchange: ev => { cb.mods.dmgToEnemy = Math.max(0, parseInt(ev.target.value, 10) || 0); persist(); } })),
      h('label', null, 'Sérülésed', h('input', { type: 'number', id: 'mod-dmgp', min: 0, value: cb.mods.dmgToPlayer, onchange: ev => { cb.mods.dmgToPlayer = Math.max(0, parseInt(ev.target.value, 10) || 0); persist(); } }))));
    mech.append(panel);
  }
  // hatások
  const chips = [];
  a.effects.forEach((e, i) => {
    const applied = sec.applied[i] != null;
    if (e.when && !applied) {
      const done = (e.when === 'dice' && t.dice) || (e.when.startsWith('luck') && t.luck) || (e.when.startsWith('skill') && t.skill);
      const matches = done && ((e.when === 'dice' && e.dice.includes(t.dice.total)) || (e.when === 'luck_yes' && t.luck && t.luck.ok) || (e.when === 'luck_no' && t.luck && !t.luck.ok) || (e.when === 'skill_yes' && t.skill && t.skill.ok) || (e.when === 'skill_no' && t.skill && !t.skill.ok));
      if (done && !matches) return;
    }
    if (e.choice != null && !applied) return; // választáskor érvényesül
    const label = effLabel(e);
    chips.push(h('button', { class: 'chip' + (applied ? ' on' : ''), title: e.text, onclick: () => { if (sv.status !== 'play') return; if (applied) undoEffect(e, i); else applyEffect(e, i); persist(); render(); } },
      applied ? `✓ ${label}` : `${label}`, h('span', { class: 'x' }, applied ? 'visszavon' : (e.when ? 'próbától függ' : 'alkalmaz'))));
  });
  if (chips.length) mech.append(h('div', { class: 'panel' }, h('h4', null, 'Változások'), h('div', { class: 'chips' }, chips)));
  // javaslatok: tárgy, képesség, jegyzet, használat
  const sugs = [];
  a.suggestions.forEach((s, i) => {
    if (sec.sugs[i]) return;
    const done = () => { sec.sugs[i] = true; persist(); render(); };
    if (s.type === 'remove') sugs.push(h('button', { class: 'chip', onclick: () => openSheet('targyak', { removeHint: s.text }) }, '− Tárgy törlése…'));
    else if (s.type === 'use') sugs.push(h('button', { class: 'chip', onclick: () => { addItem(s.name || 'Tárgy', 'item', s.target); done(); } }, `+ ${s.name || 'Tárgy'} (használat → ${s.target})`));
    else if (s.type === 'note') sugs.push(h('button', { class: 'chip', onclick: () => { addNote(s.text, s.offset); done(); } }, s.offset ? `+ Jegyzet (${signed(s.offset)} a pontszámhoz)` : '+ Jegyzet felírása'));
    else sugs.push(h('button', { class: 'chip', onclick: () => editItemDialog(s.name, s.type === 'ability' ? 'ability' : 'item').then(ok => { if (ok) done(); }) }, `+ ${s.name || (s.type === 'ability' ? 'Képesség' : 'Tárgy')}`, h('span', { class: 'x' }, s.type === 'ability' ? 'képesség' : 'felírom')));
  });
  if (sugs.length) mech.append(h('div', { class: 'panel' }, h('h4', null, 'Kalandlapra'), h('div', { class: 'chips' }, sugs)));
  return mech;
}

function renderDock(dock, a, sv, states) {
  if (sv.status === 'dead' || sv.status === 'won') {
    const won = sv.status === 'won';
    dock.append(h('div', { class: 'endbox' },
      h('h3', null, won ? 'Győzelem!' : 'Meghaltál'),
      h('p', null, won ? `A(z) ${sv.round}. kör sikerrel zárult.` : `A(z) ${sv.round}. kör véget ért a(z) ${sv.n}. fejezetpontban.`),
      h('div', { class: 'acts' },
        h('button', { class: 'act quiet', onclick: () => openSheet('naplo') }, 'Eseménynapló'),
        h('button', { class: 'act', onclick: () => newRound() }, 'Új kör'))));
    return;
  }
  const sec = sv.sec;
  // kijelölt választás magyarázata
  const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
  if (sec.sel != null && a.choices[sec.sel]) {
    const c = a.choices[sec.sel], st = states[sec.sel];
    if (st.locked) hint.append(h('b', null, `${sec.sel + 1}`), ` · ${st.why} `, h('button', { onclick: () => { sec.manual = true; log('manual', 'Kézi döntés: minden választás feloldva ebben a pontban.'); persist(); render(); } }, 'Kézi döntés'));
    else {
      hint.append(h('b', null, `${sec.sel + 1}`), ` · ${c.label ? cap1(c.label.slice(0, 120)) : 'Tovább'}`);
      if (st.hint) hint.append(` (${st.hint.text || (st.hint.has ? 'van: ' + st.hint.item : 'nincs nálad')})`);
      hint.append(' — koppints újra a lapozáshoz');
    }
  } else if (a.choices.length) hint.append('Válassz: első koppintás kijelöl, második lapoz.');
  else if (a.numberInput) hint.append('A továbblépéshez ki kell számolnod a fejezetpont számát.');
  dock.append(hint);
  // műveletek
  const acts = h('div', { class: 'acts' });
  const t = sec.tests;
  for (const tt of a.tests) {
    if (tt.type === 'luck' && !t.luck) acts.append(h('button', { class: 'act', onclick: doLuck }, 'Szerencsepróba'));
    if (tt.type === 'skill' && !t.skill) acts.append(h('button', { class: 'act', onclick: doSkill }, 'Ügyességpróba'));
    if (tt.type === 'dice' && !t.dice) acts.append(h('button', { class: 'act', onclick: () => doDice(tt.n) }, tt.n > 1 ? 'Dobás (2 kocka)' : 'Dobás (1 kocka)'));
  }
  const cb = sec.combat;
  if (cb && !cb.over) {
    acts.append(h('button', { class: 'act', onclick: attack }, cb.rounds.length ? 'Következő kör' : 'Harc: támadás'));
    if (cb.last && !cb.last.luck) {
      const r = cb.last.res;
      if (r.hitEnemy) acts.append(h('button', { class: 'act quiet', onclick: () => combatLuck('attack') }, 'Szerencse: súlyosabb seb'));
      if (r.hurt) acts.append(h('button', { class: 'act quiet', onclick: () => combatLuck('defend') }, 'Szerencse: enyhébb seb'));
    }
  }
  if (a.numberInput || (!a.choices.length && !a.death && !a.victory)) acts.append(h('button', { class: 'act' + (a.choices.length ? ' quiet' : ''), onclick: () => openJump(null, null, a.numberOffset) }, 'Számra lapozok'));
  if (!a.choices.length && a.numberInput) acts.append(h('button', { class: 'act danger', onclick: () => modal('Feladod?', 'Ha nem tudod a választ, a kalandod itt véget ér.', [['Mégse', null], ['Feladom', 'y']]).then(v => { if (v) { die('Nem találtad meg a megoldást.'); render(); } }) }, 'Feladom'));
  if (acts.childElementCount) dock.append(acts);
  // választógombok
  const keys = h('div', { class: 'keys', role: 'group', 'aria-label': 'Választások' });
  a.choices.forEach((c, i) => {
    const st = states[i];
    keys.append(h('button', { class: 'key' + (sec.sel === i ? ' sel' : '') + (st.locked ? ' locked' : '') + (c.kind === 'conditional' ? ' cond' : '') + (st.seen ? ' seen' : ''), 'aria-label': `${i + 1}. választás: ${c.label || 'tovább'}`, 'aria-pressed': sec.sel === i ? 'true' : 'false', onclick: () => onKey(i) },
      c.kind === 'back' ? '↩' : String(i + 1), st.locked ? h('small', null, 'zárva') : null));
  });
  if (a.choices.length) dock.append(keys);
}
function pulseActs() { const b = document.querySelector('#dock .act'); if (b) { b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); } }
function editFoe(i) {
  const e = S.save.sec.combat.enemies[i];
  const sk = h('input', { class: 'field', type: 'number', id: 'foe-skill', value: e.skill ?? '' }), stm = h('input', { class: 'field', type: 'number', id: 'foe-st', value: e.stamina ?? '' });
  modal(`${e.name} értékei`, h('div', { class: 'row' }, h('label', { class: 'grow' }, 'ÜGYESSÉG', sk), h('label', { class: 'grow' }, 'ÉLETERŐ', stm)), [['Mégse', null], ['Mentés', 'ok']]).then(v => {
    if (!v) return;
    e.skill = parseInt(sk.value, 10) || 0; e.stamina = parseInt(stm.value, 10) || 0; e.max = e.stamina;
    persist(); render();
  });
}

// ---------- telepítés (iOS: Főképernyőhöz adás) ----------
const isPwaShell = () => document.documentElement.classList.contains('pwa');
const standalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch { return false; } };
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function installHint() {
  if (!isPwaShell() || standalone() || !isIOS()) return null;
  return h('div', { class: 'panel install' },
    h('b', null, 'Telepítsd a főképernyőre'),
    h('span', { class: 'muted', html: 'Safariban koppints a <span class="shr" aria-hidden="true"></span> Megosztás gombra, majd a „Főképernyőhöz adás” pontra. Így teljes képernyőn, internet nélkül is indul, és a mentéseid megmaradnak.' }));
}

// ---------- könyvtár ----------
async function showLibrary() { S.view = 'library'; S.books = await store.listBooks(); closeDrawer(); closeSheet(); render(); scrollTop(); }
function renderLibrary(page, dock) {
  const wrap = h('div', { class: 'sheet-inner lib' });
  wrap.append(h('h1', null, 'Kaland · Játék · Kockázat'));
  wrap.append(h('p', { class: 'lead' }, 'A lapozgatós kalandkönyvek szövegét olvasod, a végén választasz. A kockát, a harcot, a tárgyakat és az eseménynaplót a játék vezeti.'));
  const ih = installHint(); if (ih) wrap.append(ih);
  if (S.importing) {
    const im = S.importing;
    wrap.append(h('div', { class: 'panel', style: 'display:grid;gap:8px' }, h('b', null, im.name), h('div', { class: 'prog' }, h('i', { style: `width:${im.pct || 2}%` })), h('div', { class: 'muted' }, im.msg + (im.eta ? ` · kb. ${Math.ceil(im.eta / 60)} perc van hátra` : '')),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => im.ctrl.abort() }, 'Megszakítás')), h('div', { class: 'muted' }, 'A felismerés közben maradjon nyitva ez az oldal.')));
  }
  const books = h('div', { class: 'books' });
  const all = [{ id: DEMO.id, title: DEMO.title, max: DEMO.max, demo: true }, ...S.books];
  for (const b of all) {
    const sv = store.loadSave(b.id);
    const status = !sv ? 'Még nem játszottad' : sv.status === 'setup' ? `${sv.round}. kör – karakteralkotás` : sv.status === 'play' ? `${sv.round}. kör – a ${sv.n}. pontnál tartasz` : sv.status === 'dead' ? `${sv.round}. kör – meghaltál` : `${sv.round}. kör – győzelem`;
    books.append(h('div', { class: 'book' },
      h('div', { class: 't' }, b.title),
      h('div', { class: 's' }, `${b.max} fejezetpont · ${status}`),
      h('button', { class: 'btn pri go', onclick: () => openBook(b.id) }, sv && sv.status === 'play' ? 'Folytatás' : 'Megnyitás'),
      b.demo ? null : h('div', { class: 'more' },
        h('button', { class: 'btn', onclick: () => exportBook(b.id) }, 'Mentés fájlba (.kjk.json)'),
        h('button', { class: 'btn red', onclick: () => modal('Könyv törlése', `Törlöd erről az eszközről: „${b.title}”? A mentett állás is törlődik.`, [['Mégse', null], ['Törlés', 'y']]).then(async v => { if (v) { await store.deleteBook(b.id); showLibrary(); } }) }, 'Törlés'))));
  }
  wrap.append(books);
  const file = h('input', { type: 'file', id: 'bookfile', accept: '.pdf,.json,application/pdf,application/json', hidden: true, onchange: ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) doImport(f); } });
  wrap.append(h('div', { class: 'drop' },
    h('b', null, 'Könyv betöltése'),
    h('span', { class: 'muted' }, 'PDF a zagor.hu letöltések oldaláról, vagy egy korábban elmentett .kjk.json fájl. A szkennelt PDF-ek szövegét a játék felismeri (ez asztali gépen 3–5 perc, telefonon tovább tart). A felismert könyvet mentsd fájlba, és azt töltsd be a telefonon.'),
    h('div', { class: 'row' }, h('button', { class: 'btn pri', disabled: !!S.importing, onclick: () => file.click() }, 'Fájl kiválasztása'), h('a', { href: 'https://zagor.hu/index.php?oldal=letoltes', target: '_blank', rel: 'noopener', class: 'muted' }, 'zagor.hu – letöltések')), file));
  page.append(wrap);
  dock.append(h('div', { class: 'hint' }, 'A mentések ezen az eszközön, ebben a böngészőben maradnak.'));
}
async function doImport(file) {
  const ctrl = new AbortController();
  S.importing = { name: file.name, msg: 'Indítás…', pct: 2, ctrl };
  render();
  try {
    const book = await importFile(file, p => {
      if (!S.importing) return;
      S.importing.msg = p.msg || S.importing.msg;
      if (p.total) S.importing.pct = Math.round(p.page / p.total * 96) + 2;
      S.importing.eta = p.eta || 0;
      const bar = document.querySelector('.prog > i'), m = document.querySelector('.lib .panel .muted');
      if (bar) bar.style.width = S.importing.pct + '%';
      if (m) m.textContent = S.importing.msg + (S.importing.eta ? ` · kb. ${Math.ceil(S.importing.eta / 60)} perc van hátra` : '');
    }, ctrl.signal);
    await store.putBook(book);
    S.importing = null;
    const warn = (book.warnings || []).filter(w => /hiányzó/.test(w));
    toast(`Betöltve: ${book.title} (${Object.keys(book.sections).length} fejezetpont)` + (warn.length ? ' – figyelmeztetés: ' + warn[0] : ''));
    S.books = await store.listBooks();
    openBook(book.id);
  } catch (e) {
    S.importing = null;
    render();
    if (e && e.name === 'AbortError') toast('A betöltés megszakítva.');
    else modal('Nem sikerült betölteni', (e && e.message) || String(e), [['Rendben', 'ok']]);
  }
}
async function exportBook(id) {
  const b = await store.getBook(id); if (!b) return;
  const data = bookToJson(b), filename = `${b.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 60)}.kjk.json`;
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { await dl.save({ filename, data }); return; }
  } catch (e) { if (e && /declin|cancel|denied/i.test(e.code || e.message || '')) return; }
  try {
    const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: filename });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  } catch { toast('A mentés ebben a nézetben nem érhető el.'); }
}

// ---------- karakteralkotás ----------
function renderSetup(page, dock) {
  const st = S.setup, c = st.c, sp = st.setup;
  const wrap = h('div', { class: 'sheet-inner setup' });
  wrap.append(h('h2', null, S.book.title), h('p', { class: 'muted' }, `${S.save.round}. kör · a játék dob helyetted`));
  const row = (lbl, sub, dice, v) => h('div', { class: 'rollrow' }, h('div', { class: 'lbl', html: `<span class="sc">${lbl}</span><small>${sub}</small>` }), diceEl(dice, true), h('div', { class: 'v' }, v));
  const rolls = h('div', { class: 'rolls' },
    row('ÜGYESSÉG', '1 kocka + 6', c.rolls.skill, c.skill),
    row('ÉLETERŐ', '2 kocka + 12', c.rolls.stamina, c.stamina),
    row('SZERENCSE', '1 kocka + 6', c.rolls.luck, c.luck));
  wrap.append(rolls);
  wrap.append(h('div', { class: 'row', style: 'margin:10px 0 18px' }, h('button', { class: 'btn', onclick: () => { st.c = newCharacter(); st.rolls++; render(); animate(document.querySelector('.rolls')); } }, 'Újradobás'), h('span', { class: 'muted' }, st.rolls > 1 ? `${st.rolls}. dobás` : '')));
  if (sp.potions.length) {
    wrap.append(h('h5', { class: 'muted', style: 'margin:0 0 8px;letter-spacing:.1em;text-transform:uppercase' }, 'Válassz egy italt'));
    wrap.append(h('div', { class: 'potions' }, sp.potions.map(p => h('button', { class: 'potion' + (st.potion === p.id ? ' sel' : ''), 'aria-pressed': st.potion === p.id ? 'true' : 'false', onclick: () => { st.potion = p.id; render(); } }, h('b', null, p.name), h('span', { html: caps(esc(p.desc)) })))));
  }
  const gear = [...sp.items, sp.gold ? `${sp.gold} Aranytallér` : null, sp.provisions ? `${sp.provisions} adag élelem (+${sp.mealValue} ÉLETERŐ étkezésenként)` : null].filter(Boolean);
  if (gear.length) wrap.append(h('p', { class: 'muted', style: 'margin-top:16px' }, 'Felszerelés: ' + gear.join(', ') + '.'));
  wrap.append(h('p', null, h('button', { class: 'btn', onclick: () => openSheet('bevezeto') }, 'Bevezető és szabályok')));
  page.append(wrap);
  const ready = st.potion != null;
  dock.append(h('div', { class: 'hint' }, ready ? 'Ha készen állsz, indulhat a kaland.' : 'Válassz egy italt a kezdéshez.'));
  dock.append(h('div', { class: 'acts' }, h('button', { class: 'act', disabled: !ready, onclick: beginAdventure }, 'Kaland indítása')));
}

// ---------- menü és lapok ----------
function openDrawer() {
  const d = $('#drawer'); d.replaceChildren();
  const sv = S.save, inGame = S.book && sv && S.view !== 'library';
  d.append(h('div', { class: 'brand' }, 'Kaland · Játék · Kockázat'), h('div', { class: 'brand-sub' }, S.book && S.view !== 'library' ? S.book.title : 'Könyvtár'));
  const mi = (ic, label, fn, ct, cls) => h('button', { class: 'mi' + (cls ? ' ' + cls : ''), onclick: fn }, h('span', { class: 'ic', 'aria-hidden': 'true' }, ic), label, ct != null ? h('span', { class: 'ct' }, ct) : null);
  if (inGame && sv.c) {
    d.append(mi('◈', 'Kalandlap', () => openSheet('kalandlap')));
    d.append(mi('⚱', 'Tárgyak', () => openSheet('targyak'), sv.items.length + (sv.notes.length ? ` · ${sv.notes.length} jegyzet` : '')));
    d.append(mi('☰', 'Eseménynapló', () => openSheet('naplo'), sv.log.length));
    d.append(mi('§', 'Lapozás számra', () => openJump()));
    d.append(mi('⚄', 'Kockadobás', () => openSheet('kocka')));
  } else if (inGame) d.append(mi('☰', 'Eseménynapló', () => openSheet('naplo'), sv ? sv.log.length : 0));
  if (S.book && S.view !== 'library') {
    d.append(mi('¶', 'Bevezető és szabályok', () => openSheet('bevezeto')));
    if (S.book.appendix && S.book.appendix.length) d.append(mi('▦', 'Mellékletek', () => openSheet('melleklet')));
    d.append(h('div', { class: 'msep' }));
    d.append(mi('↻', 'Új kör', () => modal('Új kör', sv && sv.status === 'play' ? 'Feladod a jelenlegi kört, és új karakterrel kezdesz? Az eseménynapló megmarad.' : 'Új karakterrel kezdesz? Az eseménynapló megmarad.', [['Mégse', null], ['Új kör', 'y']]).then(v => { if (v) newRound(); }), null, 'red'));
  }
  d.append(mi('▤', 'Könyvtár', showLibrary));
  d.append(mi('⚙', 'Beállítások', () => openSheet('beallitas')));
  d.classList.add('open');
  let scrim = $('.scrim'); if (!scrim) { scrim = h('div', { class: 'scrim', onclick: () => { closeDrawer(); closeSheet(); } }); document.body.append(scrim); }
}
function closeDrawer() { $('#drawer').classList.remove('open'); if (!S.sheet) { const s = $('.scrim'); if (s) s.remove(); } }

function openSheet(kind, opts = {}) {
  $('#drawer').classList.remove('open');
  S.sheet = { kind, opts };
  rerenderSheet();
  if (!$('.scrim')) document.body.append(h('div', { class: 'scrim', onclick: () => { closeDrawer(); closeSheet(); } }));
}
function closeSheet() { S.sheet = null; const s = $('#sheet'); s.hidden = true; s.replaceChildren(); if (!$('#drawer').classList.contains('open')) { const sc = $('.scrim'); if (sc) sc.remove(); } }
function rerenderSheet() {
  if (!S.sheet) return;
  const el = $('#sheet'), body = h('div', { class: 'sh-body' });
  const keepScroll = el.querySelector('.sh-body') ? el.querySelector('.sh-body').scrollTop : 0;
  const title = SHEETS[S.sheet.kind](body, S.sheet.opts);
  el.replaceChildren(h('div', { class: 'sh-head' }, h('h3', null, title), h('button', { class: 'sh-close', 'aria-label': 'Bezárás', onclick: closeSheet }, '×')), body);
  el.hidden = false;
  if (S.sheet.kind !== 'naplo') body.scrollTop = keepScroll;
}

const SHEETS = {
  kalandlap(b) {
    const sv = S.save, c = sv.c;
    const box = (k, lbl) => h('div', { class: 'sbox' }, h('span', { class: 'lbl' }, lbl), h('span', { class: 'val' }, c[k]), h('span', { class: 'ini' }, `Kezdeti: ${c[k + 'Init']}`),
      h('span', { class: 'adj' }, h('button', { 'aria-label': lbl + ' −1', onclick: () => { changeStat(k, -1, 'kézi módosítás'); persist(); render(); rerenderSheet(); } }, '−'), h('button', { 'aria-label': lbl + ' +1', onclick: () => { changeStat(k, 1, 'kézi módosítás', { overInit: true }); persist(); render(); rerenderSheet(); } }, '+')));
    b.append(h('div', { class: 'statgrid' }, box('skill', 'Ügyesség'), box('stamina', 'Életerő'), box('luck', 'Szerencse')));
    b.append(h('div', { class: 'li' }, h('span', { class: 'nm' }, h('b', null, 'Arany: '), `${sv.gold} Aranytallér`), h('span', { class: 'adj' },
      h('button', { onclick: () => { sv.gold = Math.max(0, sv.gold - 1); log('manual', `Arany −1 → ${sv.gold}`); persist(); rerenderSheet(); } }, '−'), h('button', { onclick: () => { sv.gold++; log('manual', `Arany +1 → ${sv.gold}`); persist(); rerenderSheet(); } }, '+'))));
    b.append(h('div', { class: 'li' }, h('span', { class: 'nm' }, h('b', null, 'Élelem: '), `${sv.food} adag (+${sv.mealValue} ÉLETERŐ)`), h('button', { class: 'btn', disabled: sv.food <= 0 || sv.status !== 'play', onclick: eat }, 'Étkezés'),
      h('span', { class: 'adj' }, h('button', { onclick: () => { sv.food = Math.max(0, sv.food - 1); log('manual', `Élelem −1 → ${sv.food}`); persist(); rerenderSheet(); } }, '−'), h('button', { onclick: () => { sv.food++; log('manual', `Élelem +1 → ${sv.food}`); persist(); rerenderSheet(); } }, '+'))));
    if (sv.potion) b.append(h('div', { class: 'li' }, h('span', { class: 'nm' }, h('b', null, 'Ital: '), sv.potion.name + (sv.potion.used ? ' (elfogyott)' : '')), h('button', { class: 'btn', disabled: sv.potion.used || sv.status !== 'play', onclick: () => modal('Ital', `Megiszod: ${sv.potion.name}?`, [['Mégse', null], ['Megiszom', 'y']]).then(v => { if (v) drinkPotion(); }) }, 'Megiszom')));
    b.append(h('p', { class: 'muted' }, `${S.book.title} · ${sv.round}. kör · ${sv.trail.length} meglátogatott fejezetpont`));
    return 'Kalandlap';
  },
  targyak(b, opts) {
    const sv = S.save;
    if (opts.removeHint) b.append(h('div', { class: 'panel muted' }, `A szöveg szerint: „${opts.removeHint}” – koppints a törlendő tárgy „Törlés” gombjára.`));
    const items = sv.items.filter(i => i.kind !== 'ability'), abil = sv.items.filter(i => i.kind === 'ability');
    const itemRow = it => h('div', { class: 'li' }, h('span', { class: 'nm' }, it.name, it.from ? h('span', { class: 'meta' }, ` · ${it.from}. pont`) : null),
      it.use ? h('button', { class: 'btn pri', disabled: sv.status !== 'play', onclick: () => { log('item', `Használat: ${it.name} → ${it.use}.`); jump(it.use, 'use'); } }, `Használat → ${it.use}`) : null,
      h('button', { class: 'btn red', onclick: () => removeItem(it.id) }, 'Törlés'));
    b.append(h('h5', null, `Tárgyak (${items.length})`));
    b.append(items.length ? h('div', { class: 'list' }, items.map(itemRow)) : h('p', { class: 'muted' }, 'Még nincs tárgyad.'));
    if (abil.length) { b.append(h('h5', null, 'Képességek')); b.append(h('div', { class: 'list' }, abil.map(itemRow))); }
    const nm = h('input', { class: 'field grow', id: 'new-item', placeholder: 'Új tárgy neve', enterkeyhint: 'done', onkeydown: ev => { if (ev.key === 'Enter') { addItem(nm.value); nm.value = ''; } } });
    b.append(h('div', { class: 'row' }, nm, h('button', { class: 'btn pri', onclick: () => { addItem(nm.value); nm.value = ''; } }, 'Felírom'), h('button', { class: 'btn', onclick: () => { addItem(nm.value, 'ability'); nm.value = ''; } }, 'Képesség')));
    b.append(h('h5', null, `Jegyzetek (${sv.notes.length})`));
    b.append(sv.notes.length ? h('div', { class: 'list' }, sv.notes.map(n => h('div', { class: 'li' }, h('span', { class: 'nm' }, n.text, h('span', { class: 'meta' }, ` · ${n.from}. pont` + (n.offset ? ` · ${signed(n.offset)}` : ''))), h('button', { class: 'btn red', onclick: () => { sv.notes = sv.notes.filter(x => x.id !== n.id); log('note', 'Jegyzet törölve.'); persist(); rerenderSheet(); } }, 'Törlés')))) : h('p', { class: 'muted' }, 'Kódszavak, számok, emlékeztetők.'));
    const nt = h('input', { class: 'field grow', id: 'new-note', placeholder: 'Új jegyzet', onkeydown: ev => { if (ev.key === 'Enter') { addNote(nt.value); nt.value = ''; } } });
    b.append(h('div', { class: 'row' }, nt, h('button', { class: 'btn', onclick: () => { addNote(nt.value); nt.value = ''; } }, 'Felírom')));
    return 'Tárgyak és jegyzetek';
  },
  naplo(b) {
    const sv = S.save;
    const lg = h('div', { class: 'log' });
    let lastR = null;
    const entries = [...sv.log].reverse();
    if (!entries.length) lg.append(h('p', { class: 'muted' }, 'Még nem történt semmi.'));
    for (const e of entries) {
      if (e.r !== lastR) { lastR = e.r; const hs = sv.history.find(x => x.round === e.r); lg.append(h('div', { class: 'rnd' }, `${e.r}. kör` + (hs ? ` – ${hs.result}` : e.r === sv.round ? ' – folyamatban' : ''))); }
      lg.append(h('div', { class: 'e k-' + e.k }, h('span', { class: 'tm' }, hhmm(e.t)), h('span', { class: 'sn' }, e.s ? `§${e.s}` : ''), h('span', { class: 'm', html: caps(esc(e.m)) })));
    }
    b.append(lg);
    return `Eseménynapló (${sv.log.length})`;
  },
  kocka(b) {
    const out = h('div', { class: 'result', style: 'min-height:48px' });
    const go = n => { const d = roll(n); out.replaceChildren(diceEl(d, true), h('b', { style: 'font-size:22px' }, n > 1 ? `= ${sum(d)}` : '')); log('dice', `Szabad dobás: ${d.join('+')}${n > 1 ? '=' + sum(d) : ''}.`); persist(); animate(out); };
    b.append(h('div', { class: 'row' }, h('button', { class: 'btn pri', onclick: () => go(1) }, '1 kocka'), h('button', { class: 'btn pri', onclick: () => go(2) }, '2 kocka')), out, h('p', { class: 'muted' }, 'A dobások bekerülnek az eseménynaplóba.'));
    return 'Kockadobás';
  },
  bevezeto(b) {
    const pr = h('div', { class: 'prose-sm' });
    for (const x of S.book.front || []) pr.append(x.h ? h('h4', null, x.h) : h('p', { html: caps(esc(x.p)) }));
    b.append(pr);
    return 'Bevezető és szabályok';
  },
  melleklet(b) {
    for (const a of S.book.appendix || []) b.append(h('img', { class: 'appimg', src: a.img, alt: `Melléklet – ${a.page}. oldal` }));
    b.append(h('p', { class: 'muted' }, 'A titkos fejezetpontokhoz: a „Lapozás számra” lapon a betű–szám átváltás is megtalálható (A=1 … Z=26).'));
    return 'Mellékletek';
  },
  jump(b, opts) {
    const sv = S.save;
    if (opts.msg) b.append(h('div', { class: 'panel' }, opts.msg));
    const inp = h('input', { class: 'field grow', id: 'jump-n', type: 'number', inputmode: 'numeric', min: 1, max: S.book.max, placeholder: `1–${S.book.max}`, onkeydown: ev => { if (ev.key === 'Enter') jump(inp.value); } });
    b.append(h('div', { class: 'row' }, inp, h('button', { class: 'btn pri', onclick: () => jump(inp.value) }, 'Lapozás')));
    if (opts.cands && opts.cands.length) b.append(h('div', { class: 'chips' }, opts.cands.map(n => h('button', { class: 'chip', onclick: () => jump(n) }, `${n}.`))));
    const offs = [...new Set([opts.offset, ...sv.notes.map(n => n.offset)].filter(Boolean))];
    if (offs.length) {
      b.append(h('h5', null, 'Jegyzetelt számítások'));
      b.append(h('div', { class: 'chips' }, offs.map(o => h('button', { class: 'chip', onclick: () => { inp.value = sv.n + o; } }, `${sv.n} ${o > 0 ? '+' : '−'} ${Math.abs(o)} = ${sv.n + o}`))));
    }
    b.append(h('h5', null, 'Betű → szám (A=1 … Z=26, ékezet nélkül)'));
    const w = h('input', { class: 'field', id: 'jump-word', placeholder: 'Írd be a szót', autocapitalize: 'characters' });
    const plus = h('input', { class: 'field', id: 'jump-plus', type: 'number', placeholder: 'Hozzáadandó (pl. 17)', style: 'max-width:12em' });
    const res = h('div', { class: 'muted' });
    const upd = () => { const r = letterSum(w.value); const add = parseInt(plus.value, 10) || 0; res.textContent = r.parts.length ? `${r.parts.join(' + ')} = ${r.sum}` + (add ? ` → ${r.sum} ${add > 0 ? '+' : '−'} ${Math.abs(add)} = ${r.sum + add}` : '') : ''; if (r.parts.length) inp.value = r.sum + add; };
    w.addEventListener('input', upd); plus.addEventListener('input', upd);
    b.append(w, h('div', { class: 'row' }, plus), res);
    b.append(h('p', { class: 'muted' }, 'A kézi lapozás bekerül az eseménynaplóba. Ha a szöveg nem illik a történethez, rossz számot választottál.'));
    setTimeout(() => inp.focus(), 50);
    return 'Lapozás számra';
  },
  beallitas(b) {
    const st = S.settings;
    const size = h('input', { type: 'range', id: 'set-size', min: 15, max: 26, value: st.textSize, oninput: ev => { st.textSize = +ev.target.value; store.writeSettings(st); render(); } });
    b.append(h('label', { class: 'li' }, h('span', { class: 'nm' }, 'Betűméret'), size));
    const auto = h('input', { type: 'checkbox', id: 'set-auto', checked: st.autoEffects, onchange: ev => { st.autoEffects = ev.target.checked; store.writeSettings(st); } });
    b.append(h('label', { class: 'li' }, h('span', { class: 'nm' }, 'Pontváltozások automatikus alkalmazása', h('br'), h('span', { class: 'muted' }, 'A feltétel nélküli „Vesztesz 2 ÉLETERŐ pontot” jellegű utasításokat a játék magától végrehajtja (visszavonható).')), auto));
    b.append(h('p', { class: 'muted' }, 'A könyvek és a mentett állások ezen az eszközön, ebben a böngészőben tárolódnak.'));
    return 'Beállítások';
  },
};
function openJump(msg, cands, offset) { openSheet('jump', { msg, cands, offset }); }

async function editItemDialog(name, kind) {
  const inp = h('input', { class: 'field', id: 'item-name', value: name || '' });
  const v = await modal(kind === 'ability' ? 'Új képesség' : 'Új tárgy a Kalandlapra', inp, [['Mégse', null], ['Felírom', 'ok']], () => inp.focus());
  if (!v || !inp.value.trim()) return false;
  addItem(inp.value, kind);
  return true;
}

// ---------- modális ablak, értesítés ----------
function modal(title, body, buttons, onOpen) {
  return new Promise(resolve => {
    const close = v => { m.remove(); resolve(v); };
    const m = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: ev => { if (ev.target === m) close(null); } },
      h('div', { class: 'box' }, h('b', { style: 'font-size:17px' }, title), typeof body === 'string' ? h('p', { html: caps(esc(body)) }) : body,
        h('div', { class: 'row' }, buttons.map(([lbl, v], i) => h('button', { class: 'btn' + (i === buttons.length - 1 ? ' pri' : ''), onclick: () => close(v) }, lbl)))));
    document.body.append(m);
    if (onOpen) setTimeout(onOpen, 30); else { const bt = m.querySelector('.btn.pri'); if (bt) bt.focus(); }
  });
}
let toastT = null;
function toast(msg) {
  let t = $('.toast'); if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => t.remove(), 3800);
}

// ---------- indulás ----------
async function boot() {
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeSheet(); closeDrawer(); } });
  // függő mentés kiírása, ha az oldal háttérbe kerül vagy bezárul
  const flush = () => { if (saveTimer && S.book && S.save) { clearTimeout(saveTimer); saveTimer = null; S.save.savedAt = Date.now(); store.writeSave(S.book.id, S.save); } };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  // önálló webapp: offline működés és tartós tárhely (a claude.ai-os nézetben nincs .pwa osztály)
  if (isPwaShell()) {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    try { if (navigator.storage && navigator.storage.persist && standalone()) navigator.storage.persist(); } catch {}
  }
  S.books = await store.listBooks();
  const last = store.lastBook();
  if (last && (last === DEMO.id || S.books.some(b => b.id === last))) await openBook(last);
  else { S.view = 'library'; render(); }
  // fejlesztéshez: window.__kjk
  window.__kjk = { S, openBook, jump, store, validateBook };
}
boot();
