// Pizzas grouped by what they share, to learn them side by side. Pure, derived from the file only.
import { baseName, isExtraCheese, steps } from './data.js';
import { isNum } from './util.js';

/** Same topping = same code, or (no code) same name ignoring a trailing "(...)". */
export const toppingKey = (layer) => (layer.code ? `c:${layer.code}` : `n:${baseName(layer.name)}`);

/**
 * Like toppingKey, but a layer with no code joins the coded topping with the same name
 * (e.g. a codeless "Pepperoni" groups with the coded "P Pepperoni").
 */
export function makeKeyer(data) {
  const codesByName = new Map();
  for (const p of data.pizzas) {
    for (const l of p.layers) {
      if (!l.code) continue;
      const n = baseName(l.name);
      if (!codesByName.has(n)) codesByName.set(n, new Set());
      codesByName.get(n).add(l.code);
    }
  }
  return (layer) => {
    if (layer.code) return `c:${layer.code}`;
    const codes = codesByName.get(baseName(layer.name));
    return codes && codes.size === 1 ? `c:${[...codes][0]}` : `n:${baseName(layer.name)}`;
  };
}

/** The most common topping key at a build step (1 = sauce, 2 = cheese) across the pizzas. */
function usualAtStep(data, n, keyOf) {
  const counts = new Map();
  for (const p of data.pizzas) {
    const st = steps(p)[n - 1];
    if (!st) continue;
    for (const k of new Set(st.items.map((it) => keyOf(it.layer)))) counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  for (const [k, c] of counts) if (!best || c > best[1]) best = [k, c];
  return best ? best[0] : null;
}

/**
 * Topping groups: { key, title, code, members: [{ pizzaId, layerIndex }] }, one member per pizza.
 * Extra-cheese layers are left out (they have their own group).
 */
export function toppingGroups(data) {
  const keyOf = makeKeyer(data);
  const map = new Map();
  for (const p of data.pizzas) {
    p.layers.forEach((l, i) => {
      if (isExtraCheese(l)) return;
      const key = keyOf(l);
      const code = key.startsWith('c:') ? key.slice(2) : null;
      if (!map.has(key)) map.set(key, { key, title: (code && data.toppingCodes[code]) || l.name, code, members: [] });
      const g = map.get(key);
      if (!g.members.some((m) => m.pizzaId === p.id)) g.members.push({ pizzaId: p.id, layerIndex: i });
    });
  }
  return [...map.values()];
}

/**
 * All the sections for the "Shared toppings" view, in a sensible order:
 *   base     - pizzas whose sauce or cheese isn't the usual one, grouped by what they use instead
 *   extra    - extra cheese on top
 *   post     - something after the bake
 *   topping  - each topping on 2+ pizzas (not the usual sauce/cheese), most pizzas first
 *   unique   - toppings on just one pizza
 */
export function sharedSections(data) {
  const keyOf = makeKeyer(data);
  const usual = new Set([usualAtStep(data, 1, keyOf), usualAtStep(data, 2, keyOf)].filter(Boolean));
  const groups = toppingGroups(data);
  const baseKeys = new Set();
  for (const p of data.pizzas) {
    for (const n of [1, 2]) {
      const st = steps(p)[n - 1];
      if (st) st.items.forEach((it) => { const k = keyOf(it.layer); if (!usual.has(k)) baseKeys.add(k); });
    }
  }
  const base = groups.filter((g) => baseKeys.has(g.key));
  const extra = data.pizzas
    .map((p) => ({ pizzaId: p.id, layerIndex: p.layers.findIndex(isExtraCheese) }))
    .filter((m) => m.layerIndex >= 0);
  const post = [];
  for (const p of data.pizzas) p.layers.forEach((l, i) => { if (l.stage === 'postbake') post.push({ pizzaId: p.id, layerIndex: i }); });
  const rest = groups.filter((g) => !usual.has(g.key) && !baseKeys.has(g.key));
  const shared = rest.filter((g) => g.members.length >= 2).sort((a, b) => (b.members.length - a.members.length) || a.title.localeCompare(b.title));
  const unique = rest.filter((g) => g.members.length === 1).sort((a, b) => a.title.localeCompare(b.title));
  return { base, extra, post, shared, unique };
}

/** Number to show next to a pizza in a topping group: per slice, else a count, else (grams on) grams. */
export function groupValue(layer, size, grams) {
  if (!layer.amounts[size] && layer.amounts[size] !== 0) return null;
  if (layer.perSlice && isNum(layer.perSlice[size])) return { value: layer.perSlice[size], kind: 'perslice' };
  if (layer.unit !== 'g') return { value: layer.amounts[size], kind: 'count', unit: layer.unit };
  if (layer.lines && isNum(layer.lines[size])) return { value: layer.lines[size], kind: 'count', unit: 'lines' };
  return grams ? { value: layer.amounts[size], kind: 'count', unit: 'g' } : null;
}

/** Groups worth a "Which of these have X?" question: 2+ pizzas, but not most of them. */
export function quizGroups(data) {
  const { base, shared } = sharedSections(data);
  return [...base, ...shared].filter((g) => g.members.length >= 2 && g.members.length <= Math.max(2, Math.floor(data.pizzas.length * 0.6)));
}
