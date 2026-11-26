// Wrong-but-believable answer options for multiple choice. Pure.
import { isNum, shuffle, uniq } from './util.js';

const round2 = (v) => Math.round(v * 100) / 100;

/** Values near the answer: ±1, ±2 for counts; about ±12% steps for grams. */
export function neighbours(answer, { integer = Number.isInteger(answer) } = {}) {
  const a = round2(answer);
  let step;
  if (integer && a <= 12) step = 1;
  else if (integer) step = Math.max(1, Math.round(a * 0.12));
  else step = Math.max(0.5, Math.round(a * 0.12 * 2) / 2); // keep halves like 52.5
  const out = [];
  for (let d = 1; d <= 3; d++) out.push(round2(a - d * step), round2(a + d * step));
  return out;
}

/**
 * Numeric options: the answer plus `count - 1` unique distractors.
 * `pools` are candidate lists in priority order, e.g.
 *   [same topping at other sizes, same topping & size on other pizzas].
 * One value is taken from each pool, then neighbours fill the rest.
 * Returns numbers sorted low to high, always including the answer exactly once.
 */
export function numericOptions(answer, pools = [], { count = 4, rng = Math.random, integer } = {}) {
  const ans = round2(answer);
  const isInt = integer ?? Number.isInteger(ans);
  const taken = new Set([ans]);
  const picked = [];
  const need = () => picked.length < count - 1;
  const ok = (v) => isNum(v) && v > 0 && !taken.has(round2(v)) && (!isInt || Number.isInteger(round2(v)));
  const take = (v) => { taken.add(round2(v)); picked.push(round2(v)); };

  for (const pool of pools) {
    if (!need()) break;
    const cands = shuffle(uniq((pool || []).map(round2)).filter(ok), rng);
    if (cands.length) take(cands[0]);
  }
  // Prefer the nearest neighbours, in random order within each distance.
  const near = neighbours(ans, { integer: isInt });
  for (let i = 0; i < near.length && need(); i += 2) {
    for (const v of shuffle([near[i], near[i + 1]], rng)) if (need() && ok(v)) take(v);
  }
  for (const v of shuffle(uniq(pools.flat().map(round2)), rng)) if (need() && ok(v)) take(v);
  // Last resort: keep walking upwards so we always have enough options.
  for (let d = 1; need() && d < 1000; d++) {
    const v = round2(ans + d * (isInt ? 1 : 0.5));
    if (ok(v)) take(v);
  }
  return [ans, ...picked].sort((a, b) => a - b);
}

/**
 * Text options: the answer plus unique distractors (case-insensitive).
 * `prefer` are the most confusable candidates (e.g. codes that start with the same letter).
 * Returns shuffled options including the answer exactly once.
 */
export function textOptions(answer, candidates = [], { count = 4, rng = Math.random, prefer = [], maxPreferred = count - 1 } = {}) {
  const norm = (s) => String(s).trim().toLowerCase();
  const taken = new Set([norm(answer)]);
  const picked = [];
  const tryTake = (c) => {
    if (picked.length >= count - 1 || typeof c !== 'string' || !c.trim() || taken.has(norm(c))) return false;
    taken.add(norm(c));
    picked.push(c);
    return true;
  };
  let preferred = 0;
  for (const c of shuffle(uniq(prefer), rng)) {
    if (preferred >= maxPreferred) break;
    if (tryTake(c)) preferred++;
  }
  for (const c of shuffle(uniq(candidates), rng)) tryTake(c);
  return shuffle([answer, ...picked], rng);
}
