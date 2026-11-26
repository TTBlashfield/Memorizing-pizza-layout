// Checking a "Build it" answer. Pure.
//
// Rules:
// - Layers are identified by index, never by code (C can be cheese AND extra cheese).
// - Layers that share a seq are one step: either order inside the step is right.
// - Two layers that look identical on a chip (same code and name) are interchangeable,
//   so tapping "either" one first is fine.
// - Any decoy tapped makes the answer wrong; so does a missing layer.
import { buildOrder, layerSig, steps } from './data.js';

/** Map layer index -> step number (1-based). */
export function stepOf(pizza) {
  const m = new Map();
  for (const st of steps(pizza)) for (const it of st.items) m.set(it.index, st.n);
  return m;
}

/**
 * Turn tapped layer indices into "canonical" ones: the k-th tap of a chip that looks like X
 * is treated as the k-th X in build order. Returns null for a tap that can't be matched.
 */
export function canonicalize(pizza, tappedIndices) {
  const queues = new Map();
  for (const i of buildOrder(pizza)) {
    const sig = layerSig(pizza.layers[i]);
    if (!queues.has(sig)) queues.set(sig, []);
    queues.get(sig).push(i);
  }
  return tappedIndices.map((i) => {
    const layer = pizza.layers[i];
    if (!layer) return null;
    const q = queues.get(layerSig(layer));
    return q && q.length ? q.shift() : null;
  });
}

/** Indices (into `values`) of one longest non-decreasing subsequence. */
export function longestNonDecreasing(values) {
  const n = values.length;
  if (!n) return new Set();
  const len = new Array(n).fill(1);
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (values[j] <= values[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const keep = new Set();
  for (let i = best; i !== -1; i = prev[i]) keep.add(i);
  return keep;
}

/**
 * Check an ordered answer.
 * @param pizza
 * @param tapped  Array of chips in the order tapped: { kind: 'layer', index } or { kind: 'decoy', ... }
 * @returns {{ correct: boolean, marks: {ok: boolean, reason: 'ok'|'decoy'|'order'|'extra', step?: number}[],
 *            missing: number[], decoys: number }}
 */
export function checkOrder(pizza, tapped) {
  const stepMap = stepOf(pizza);
  const marks = tapped.map(() => null);
  const layerPositions = [];
  const layerIndices = [];
  tapped.forEach((chip, pos) => {
    if (chip.kind === 'layer') {
      layerPositions.push(pos);
      layerIndices.push(chip.index);
    } else {
      marks[pos] = { ok: false, reason: 'decoy' };
    }
  });

  const canon = canonicalize(pizza, layerIndices);
  const ranks = [];
  const rankPositions = [];
  canon.forEach((ci, k) => {
    const pos = layerPositions[k];
    if (ci === null) {
      marks[pos] = { ok: false, reason: 'extra' };
    } else {
      ranks.push(stepMap.get(ci));
      rankPositions.push({ pos, ci });
    }
  });

  const keep = longestNonDecreasing(ranks);
  rankPositions.forEach(({ pos, ci }, k) => {
    marks[pos] = keep.has(k)
      ? { ok: true, reason: 'ok', step: stepMap.get(ci) }
      : { ok: false, reason: 'order', step: stepMap.get(ci) };
  });

  const used = new Set(canon.filter((c) => c !== null));
  const missing = buildOrder(pizza).filter((i) => !used.has(i));
  const decoys = tapped.filter((c) => c.kind !== 'layer').length;
  const correct = decoys === 0 && missing.length === 0 && marks.every((m) => m.ok);
  return { correct, marks, missing, decoys };
}

/** Check an unordered answer (pizzas where orderMatters is false): right toppings, no decoys. */
export function checkPicks(pizza, tapped) {
  const layerIndices = tapped.filter((c) => c.kind === 'layer').map((c) => c.index);
  const canon = canonicalize(pizza, layerIndices);
  const marks = [];
  let k = 0;
  for (const chip of tapped) {
    if (chip.kind !== 'layer') marks.push({ ok: false, reason: 'decoy' });
    else marks.push(canon[k++] === null ? { ok: false, reason: 'extra' } : { ok: true, reason: 'ok' });
  }
  const used = new Set(canon.filter((c) => c !== null));
  const missing = buildOrder(pizza).filter((i) => !used.has(i));
  const decoys = tapped.length - layerIndices.length;
  return { correct: decoys === 0 && missing.length === 0 && marks.every((m) => m.ok), marks, missing, decoys };
}
