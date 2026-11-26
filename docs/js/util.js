// Small pure helpers shared by the app and the unit tests. No DOM access here.

/** Deterministic PRNG (mulberry32). Handy for tests; the app uses Math.random. */
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle. Returns a new array. */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Up to n random items from a list. */
export function sample(list, n, rng = Math.random) {
  return shuffle(list, rng).slice(0, Math.max(0, n));
}

export function uniq(list) {
  return [...new Set(list)];
}

export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const isStr = (v) => typeof v === 'string' && v.trim() !== '';
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function plural(n, one, many = one + 's') {
  return n === 1 ? one : many;
}

export function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}
