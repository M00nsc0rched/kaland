// KJK-szabályok: kockák, karakteralkotás, próbák, harci kör.

export function d6() {
  try {
    const a = new Uint8Array(1);
    // torzításmentes: 252 = 6 * 42 alatti értékek
    do { crypto.getRandomValues(a); } while (a[0] >= 252);
    return (a[0] % 6) + 1;
  } catch { return 1 + Math.floor(Math.random() * 6); }
}
export const roll = n => Array.from({ length: n }, d6);
export const sum = a => a.reduce((x, y) => x + y, 0);

export function newCharacter() {
  const s = roll(1), st = roll(2), l = roll(1);
  const skill = s[0] + 6, stamina = sum(st) + 12, luck = l[0] + 6;
  return { skill, skillInit: skill, stamina, staminaInit: stamina, luck, luckInit: luck, rolls: { skill: s, stamina: st, luck: l } };
}

// Szerencsepróba: 2 kocka ≤ SZERENCSE → szerencsés; utána SZERENCSE −1.
export function testLuck(c) {
  const dice = roll(2), total = sum(dice), before = c.luck;
  const ok = total <= before;
  c.luck = Math.max(0, c.luck - 1);
  return { type: 'luck', dice, total, ok, before };
}

// Ügyességpróba: 2 kocka ≤ ÜGYESSÉG → sikeres (ÜGYESSÉG nem csökken).
export function testSkill(c) {
  const dice = roll(2), total = sum(dice);
  return { type: 'skill', dice, total, ok: total <= c.skill, before: c.skill };
}

// Egy harci kör. A kiválasztott ellenféllel vív a játékos; egyszerre-harcnál a többiek is támadnak,
// de ha ellenük nagyobb a Támadóerőd, csak hárítasz (nem sebzel).
export function combatRound(c, enemies, target, mods = {}) {
  const pDice = roll(2);
  const pAS = sum(pDice) + c.skill + (mods.skill || 0);
  const res = { pDice, pAS, vs: [], hitEnemy: false, hurt: 0, target };
  const alive = enemies.map((e, i) => ({ e, i })).filter(x => !x.e.dead);
  const fighters = mods.mode === 'simultaneous' ? alive : alive.filter(x => x.i === target);
  for (const { e, i } of fighters) {
    const eDice = roll(2), eAS = sum(eDice) + e.skill + (e.asMod || 0);
    const r = { i, eDice, eAS, out: 'tie' };
    if (pAS > eAS) r.out = i === target ? 'hit' : 'parry';
    else if (eAS > pAS) r.out = 'hurt';
    res.vs.push(r);
    if (r.out === 'hit') res.hitEnemy = true;
    if (r.out === 'hurt') res.hurt++;
  }
  return res;
}
