// Turns a loaded builds file into quiz items (with stable keys) and questions. Pure.
//
// An "item" is what the scheduler tracks: { key, mode, kind, pizzaId?, size?, layerIndex?, ... }.
// A "question" is built fresh each time an item is shown (options are re-shuffled).
import {
  baseName, formatAmount, formatNum, isDrizzle, isExtraCheese, layerSig, layerTitle, normName,
  rangesIn, shortSizeName, sizesIn, steps, unitWord,
} from './data.js';
import { numericOptions, textOptions } from './distractors.js';
import { isNum, sample, shuffle } from './util.js';

export const MODES = [
  { id: 'flash', title: 'Flashcards', blurb: 'See the pizza, recall the build' },
  { id: 'build', title: 'Build it', blurb: 'Tap the order, type the portions' },
  { id: 'portions', title: 'Quick-fire portions', blurb: 'Pick the right amount' },
  { id: 'codes', title: 'Codes', blurb: 'Topping and pizza codes' },
  { id: 'rules', title: 'Placement & rules', blurb: 'Per slice, drizzles, facts' },
];

/** Without grams the drills are about per-slice counts and placement, so the names change. */
const NO_GRAMS = {
  build: { blurb: 'Tap the order, then per-slice counts' },
  portions: { title: 'Per slice & counts', blurb: 'How many per slice?' },
  rules: { blurb: 'Placement, drizzles, facts' },
};

export function modesFor(filters = {}) {
  return MODES.map((m) => (filters.grams === false && NO_GRAMS[m.id] ? { ...m, ...NO_GRAMS[m.id] } : m));
}

export const modeTitle = (id, filters = {}) =>
  (id === 'weak' ? 'Weak spots' : (modesFor(filters).find((m) => m.id === id) || {}).title || id);

/**
 * What to ask for a layer at a size: per slice if the card gives it, otherwise a count.
 * Gram-only layers return null when grams are off.
 */
export function countFor(layer, size, grams) {
  if (grams) return { kind: 'amount', value: layer.amounts[size], unit: layer.unit };
  if (layer.perSlice && isNum(layer.perSlice[size])) return { kind: 'perslice', value: layer.perSlice[size], unit: 'per slice' };
  if (layer.unit !== 'g') return { kind: 'amount', value: layer.amounts[size], unit: layer.unit };
  return null;
}

/** Saved filters, cleaned against what's actually in the file. Empty means "all". */
export function effectiveFilters(data, saved = {}) {
  const allRanges = rangesIn(data);
  const allSizes = sizesIn(data);
  const ranges = (saved.ranges || []).filter((r) => allRanges.includes(r));
  const sizes = (saved.sizes || []).filter((s) => allSizes.includes(s));
  return {
    ranges: ranges.length ? ranges : allRanges,
    sizes: sizes.length ? sizes : allSizes,
    // Gram amounts are off unless switched on (per-slice counts and placement matter most).
    grams: saved.showGrams === true,
  };
}

const pizzaIndex = new WeakMap();
export function pizzaById(data, id) {
  let m = pizzaIndex.get(data);
  if (!m) {
    m = new Map(data.pizzas.map((p) => [p.id, p]));
    pizzaIndex.set(data, m);
  }
  return m.get(id);
}

const hasPostbake = (p) => p.layers.some((l) => l.stage === 'postbake');

function codesUsed(pizzas) {
  return new Set(pizzas.flatMap((p) => p.layers.map((l) => l.code)).filter((c) => c !== null));
}

/** Every item for the given filters, across all modes. */
export function buildItems(data, filters) {
  const ranges = new Set(filters.ranges);
  const sizes = new Set(filters.sizes);
  const pizzas = data.pizzas.filter((p) => ranges.has(p.range));
  const items = [];
  const add = (it) => items.push(it);
  const withPlacement = data.pizzas.filter((p) => p.placement).length;

  for (const p of pizzas) {
    for (const s of p.sizes.filter((k) => sizes.has(k))) {
      add({ key: `card:${p.id}:${s}`, mode: 'flash', kind: 'card', pizzaId: p.id, size: s });
      add({ key: `order:${p.id}:${s}`, mode: 'build', kind: 'build', pizzaId: p.id, size: s });
      p.layers.forEach((l, i) => {
        const perSlice = l.perSlice && isNum(l.perSlice[s]);
        if (filters.grams !== false) {
          add({ key: `portion:${p.id}:${s}:${i}`, mode: 'portions', kind: 'portion', pizzaId: p.id, size: s, layerIndex: i });
          if (perSlice) add({ key: `perslice:${p.id}:${s}:${i}`, mode: 'rules', kind: 'perslice', pizzaId: p.id, size: s, layerIndex: i });
        } else if (perSlice) {
          // No grams: per slice is the number to know.
          add({ key: `perslice:${p.id}:${s}:${i}`, mode: 'portions', kind: 'perslice', pizzaId: p.id, size: s, layerIndex: i });
        } else if (l.unit !== 'g') {
          // No per-slice figure on the card, but it's a count (bacon slices, meatball pieces, lines).
          add({ key: `portion:${p.id}:${s}:${i}`, mode: 'portions', kind: 'portion', pizzaId: p.id, size: s, layerIndex: i });
        }
        if (l.lines && isNum(l.lines[s])) {
          add({ key: `lines:${p.id}:${s}:${i}`, mode: 'rules', kind: 'lines', pizzaId: p.id, size: s, layerIndex: i });
        }
      });
    }
    p.layers.forEach((l, i) => {
      if (isDrizzle(l)) add({ key: `stage:${p.id}:${i}`, mode: 'rules', kind: 'stage', pizzaId: p.id, layerIndex: i });
    });
    p.facts.forEach((f, i) => add({ key: `fact:${p.id}:${i}`, mode: 'rules', kind: 'fact', pizzaId: p.id, factIndex: i }));
    if (p.base) add({ key: `base:${p.id}`, mode: 'rules', kind: 'base', pizzaId: p.id });
    if (p.placement) add({ key: `placement:${p.id}`, mode: 'rules', kind: 'placement', pizzaId: p.id });
    if (p.placement && withPlacement >= 2) add({ key: `placement-which:${p.id}`, mode: 'rules', kind: 'placement-which', pizzaId: p.id });
    if (p.orderMatters) {
      const n = steps(p).length;
      for (let k = 1; k < n; k++) add({ key: `next:${p.id}:${k}`, mode: 'rules', kind: 'next', pizzaId: p.id, step: k });
    }
    if (data.pizzas.length >= 2 && new Set(p.layers.map((l) => baseName(l.name))).size >= 3) {
      add({ key: `noton:${p.id}`, mode: 'rules', kind: 'noton', pizzaId: p.id });
    }
    if (data.pizzas.length >= 2) {
      add({ key: `code-pizza:${p.id}`, mode: 'codes', kind: 'code-pizza', pizzaId: p.id });
      add({ key: `code-pizza-rev:${p.id}`, mode: 'codes', kind: 'code-pizza-rev', pizzaId: p.id });
    }
  }

  // Topping codes: those used by the chosen ranges, plus any no pizza uses.
  const used = codesUsed(pizzas);
  const usedAnywhere = codesUsed(data.pizzas);
  const codeEntries = Object.entries(data.toppingCodes);
  if (codeEntries.length >= 2) {
    for (const [code] of codeEntries) {
      if (used.has(code) || !usedAnywhere.has(code)) {
        add({ key: `code-topping:${code}`, mode: 'codes', kind: 'code-topping', code });
        add({ key: `code-topping-rev:${code}`, mode: 'codes', kind: 'code-topping-rev', code });
      }
    }
  }

  // Slices per size (only sizes the chosen pizzas come in).
  const pizzaSizes = new Set(pizzas.flatMap((p) => p.sizes));
  for (const s of data.sizes) {
    if (sizes.has(s.key) && pizzaSizes.has(s.key) && isNum(s.slices)) {
      add({ key: `slices:${s.key}`, mode: 'rules', kind: 'slices', size: s.key });
    }
  }

  if (pizzas.length >= 2 && pizzas.some((p) => p.layers.some(isExtraCheese))) {
    add({ key: 'extracheese', mode: 'rules', kind: 'extracheese' });
  }

  if (pizzas.some(hasPostbake) && pizzas.some((p) => !hasPostbake(p))) {
    add({ key: 'postbake-which', mode: 'rules', kind: 'postbake-which' });
  }

  // Which sizes a range comes in (when every pizza in the range agrees).
  if (sizesIn(data).length >= 2) {
    for (const r of rangesIn(data).filter((x) => ranges.has(x))) {
      const ps = data.pizzas.filter((p) => p.range === r);
      if (ps.every((p) => p.sizes.join() === ps[0].sizes.join())) add({ key: `range-sizes:${r}`, mode: 'rules', kind: 'range-sizes', range: r });
    }
  }

  data.generalFacts.forEach((f, i) => add({ key: `general:${i}`, mode: 'rules', kind: 'general', factIndex: i }));
  return items;
}

/** Items for one pizza (used by "Practise this pizza"), ignoring the size filter. */
export function pizzaItems(data, pizzaId, mode, { grams = true } = {}) {
  const p = pizzaById(data, pizzaId);
  if (!p) return [];
  return buildItems(data, { ranges: [p.range], sizes: p.sizes, grams })
    .filter((it) => it.pizzaId === pizzaId && it.mode === mode);
}

// ---------- questions ----------

const ASK = { g: 'How much?', slices: 'How many slices?', pieces: 'How many pieces?', lines: 'How many lines?' };

function sameTopping(a, b) {
  if (a.unit !== b.unit) return false;
  return a.code ? a.code === b.code : baseName(a.name) === baseName(b.name);
}

/** Values of the same topping at `size` on other layers (other pizzas, or a repeat on this one). */
function sameToppingValues(data, pizza, index, size, field, answer) {
  const layer = pizza.layers[index];
  const out = [];
  for (const q of data.pizzas) {
    q.layers.forEach((m, j) => {
      if (q === pizza && j === index) return;
      if (!sameTopping(layer, m)) return;
      const v = m[field] && m[field][size];
      if (isNum(v) && v >= answer * 0.4 && v <= answer * 2.5) out.push(v);
    });
  }
  return out;
}

function otherSizeValues(map, size) {
  return Object.entries(map || {}).filter(([k, v]) => k !== size && isNum(v)).map(([, v]) => v);
}

function layerFlags(layer) {
  return layer.flag ? [layer.flag] : [];
}

export const FORMATS = ['mc', 'type', 'tf'];

/**
 * How to ask this time, so you can't just recognise the answer among the options:
 * multiple choice, type it in, or "right or wrong?". New or missed questions lean towards
 * multiple choice; ones you know lean towards typing. ctx.format forces one (tests, notifications).
 */
export function pickFormat(ctx = {}, allowed = FORMATS) {
  if (ctx.format) return allowed.includes(ctx.format) ? ctx.format : allowed[0];
  const rng = ctx.rng || Math.random;
  const weights = (ctx.box || 0) >= 2 ? { mc: 0.3, type: 0.45, tf: 0.25 } : { mc: 0.5, type: 0.25, tf: 0.25 };
  const total = allowed.reduce((a, f) => a + (weights[f] || 0), 0);
  let r = rng() * total;
  for (const f of allowed) {
    r -= weights[f] || 0;
    if (r < 0) return f;
  }
  return allowed[0];
}

const pickOne = (list, rng) => list[Math.floor(rng() * list.length)];

/** A numeric question in whichever format pickFormat chooses. */
function numericQuestion({ context, subject, ask, answer, pools, label, unit, integer, notes = [], flags = [], rng, ctx }) {
  const ans = Math.round(answer * 100) / 100;
  const values = numericOptions(answer, pools, { rng, integer });
  const base = { context, subject, ask, answer: label(ans), notes, flags };
  const how = pickFormat(ctx);
  if (how === 'type') return { ...base, kind: 'type', numeric: true, value: ans, unit };
  if (how === 'tf') {
    const wrong = values.filter((v) => v !== ans);
    const truthful = !wrong.length || rng() < 0.5;
    return { ...base, kind: 'tf', claim: label(truthful ? ans : pickOne(wrong, rng)), claimTrue: truthful };
  }
  return { ...base, kind: 'mc', options: values.map((v) => ({ label: label(v), correct: v === ans })) };
}

/** A question whose answer is one text option among `labels` (which include the answer). */
function textQuestion({ base, answer, labels, rng, ctx, allowed = ['mc', 'tf'] }) {
  const how = pickFormat(ctx, allowed);
  if (how === 'type') return { ...base, kind: 'type', numeric: false, value: answer, answer };
  if (how === 'tf') {
    const wrong = labels.filter((l) => l !== answer);
    const truthful = !wrong.length || rng() < 0.5;
    return { ...base, kind: 'tf', claim: truthful ? answer : pickOne(wrong, rng), claimTrue: truthful, answer };
  }
  return { ...base, kind: 'mc', options: labels.map((l) => ({ label: l, correct: l === answer })), answer };
}

/** Build the chips for "Build it": the pizza's layers plus 3–4 believable decoys from other pizzas. */
export function buildChips(data, pizza, rng = Math.random) {
  const own = pizza.layers.map((l, index) => ({ kind: 'layer', index, code: l.code, name: l.name }));
  const ownNames = new Set(pizza.layers.map((l) => baseName(l.name)));
  const ownCodes = new Set(pizza.layers.map((l) => l.code).filter(Boolean));
  const seenSig = new Set();
  const seenName = new Set();
  const sameRange = [];
  const otherRange = [];
  for (const q of data.pizzas) {
    if (q.id === pizza.id) continue;
    for (const l of q.layers) {
      const bn = baseName(l.name);
      const sig = layerSig(l);
      if (seenSig.has(sig) || seenName.has(bn) || ownNames.has(bn)) continue;
      // Same code usually means the same topping under another name, which would be unfair,
      // except "extra" layers (extra cheese on top), which are a classic mix-up.
      if (l.code && ownCodes.has(l.code) && !/\bextra\b/i.test(l.name)) continue;
      seenSig.add(sig);
      seenName.add(bn);
      (q.range === pizza.range ? sameRange : otherRange).push({ kind: 'decoy', code: l.code, name: l.name });
    }
  }
  // Mostly from the same range (more believable), at least one from elsewhere when possible.
  const want = 3 + (rng() < 0.5 ? 1 : 0);
  const sameShuffled = shuffle(sameRange, rng);
  const ordered = [...sameShuffled.slice(0, want - 1), ...shuffle(otherRange, rng), ...sameShuffled.slice(want - 1)];
  const decoys = ordered.slice(0, want);
  return shuffle([...own, ...decoys], rng).map((c, i) => ({ ...c, id: `chip${i}` }));
}

/** Build a question for an item. `ctx` = { rng, filters }. Returns null if the item no longer fits the data. */
export function makeQuestion(item, data, ctx = {}) {
  const rng = ctx.rng || Math.random;
  const pizza = item.pizzaId ? pizzaById(data, item.pizzaId) : null;
  if (item.pizzaId && !pizza) return null;
  const layer = pizza && item.layerIndex !== undefined ? pizza.layers[item.layerIndex] : null;
  if (item.layerIndex !== undefined && !layer) return null;
  if (item.size && pizza && !pizza.sizes.includes(item.size)) return null;
  const subject = layer ? { code: layer.code, name: layerTitle(pizza, item.layerIndex) } : null;
  const context = { size: item.size || null, pizzaId: pizza ? pizza.id : null };

  switch (item.kind) {
    case 'card':
      return { kind: 'flash', context, pizzaId: pizza.id, size: item.size };

    case 'build':
      return {
        kind: 'build', context, pizzaId: pizza.id, size: item.size, chips: buildChips(data, pizza, rng),
        grams: !ctx.filters || ctx.filters.grams !== false,
      };

    case 'portion': {
      const answer = layer.amounts[item.size];
      return numericQuestion({
        context, subject, ask: ASK[layer.unit] || 'How much?', answer, rng, ctx,
        integer: layer.unit !== 'g' && Number.isInteger(answer),
        pools: [otherSizeValues(layer.amounts, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'amounts', answer)],
        label: (v) => formatAmount(v, layer.unit),
        unit: layer.unit === 'g' ? 'g' : unitWord(layer.unit, 2),
        notes: layer.note ? [layer.note] : [],
        flags: layerFlags(layer),
      });
    }

    case 'perslice': {
      const answer = layer.perSlice[item.size];
      return numericQuestion({
        context, subject, ask: 'How many per slice?', answer, rng, ctx, integer: Number.isInteger(answer),
        pools: [otherSizeValues(layer.perSlice, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'perSlice', answer)],
        label: (v) => `${formatNum(v)} per slice`,
        unit: 'per slice',
        notes: layer.unit !== 'g' || (ctx.filters && ctx.filters.grams) ? [`That's ${formatAmount(layer.amounts[item.size], layer.unit)} in total.`] : [],
        flags: layerFlags(layer),
      });
    }

    case 'lines': {
      const answer = layer.lines[item.size];
      return numericQuestion({
        context, subject, ask: 'How many lines?', answer, rng, ctx, integer: Number.isInteger(answer),
        pools: [otherSizeValues(layer.lines, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'lines', answer)],
        label: (v) => formatAmount(v, 'lines'),
        unit: 'lines',
        notes: layer.note ? [layer.note] : [],
        flags: layerFlags(layer),
      });
    }

    case 'slices': {
      const size = data.sizes.find((s) => s.key === item.size);
      if (!size || !isNum(size.slices)) return null;
      const others = data.sizes.filter((s) => s.key !== item.size && isNum(s.slices)).map((s) => s.slices);
      return numericQuestion({
        context: { size: item.size, pizzaId: null, label: 'Slices per pizza' },
        subject: { code: null, name: shortSizeName(data, item.size) },
        ask: 'How many slices?', answer: size.slices, rng, ctx, integer: true,
        pools: [others],
        label: (v) => `${formatNum(v)} slices`,
        unit: 'slices',
      });
    }

    case 'stage': {
      const post = layer.stage === 'postbake';
      return {
        kind: 'mc', context, subject, ask: 'Before or after the bake?', fixedOrder: true,
        options: [
          { label: 'Before the bake', correct: !post },
          { label: 'After the bake', correct: post },
        ],
        answer: post ? 'After the bake' : 'Before the bake',
        notes: layer.note ? [layer.note] : [],
        flags: layerFlags(layer),
      };
    }

    case 'code-topping':
    case 'code-topping-rev': {
      const name = data.toppingCodes[item.code];
      if (!name) return null;
      const entries = Object.entries(data.toppingCodes).filter(([c, n]) => c !== item.code && normName(n) !== normName(name));
      const first = (x) => String(x).charAt(0).toLowerCase();
      if (item.kind === 'code-topping') {
        const prefer = entries.filter(([c]) => first(c) === first(item.code)).map(([, n]) => n);
        return textQuestion({
          base: { context: { label: 'Topping code' }, subject: { code: item.code, big: true }, ask: "What's this topping?", notes: [], flags: [] },
          answer: name, labels: textOptions(name, entries.map(([, n]) => n), { rng, prefer }), rng, ctx,
        });
      }
      const prefer = entries.filter(([c]) => first(c) === first(item.code) || first(c) === first(name)).map(([c]) => c);
      return textQuestion({
        base: { context: { label: 'Topping code' }, subject: { name }, ask: "What's the code?", mono: true, notes: [], flags: [] },
        answer: item.code, labels: textOptions(item.code, entries.map(([c]) => c), { rng, prefer }), rng, ctx,
        allowed: FORMATS,
      });
    }

    case 'code-pizza':
    case 'code-pizza-rev': {
      const others = data.pizzas.filter((q) => q.code !== pizza.code && normName(q.name) !== normName(pizza.name));
      const first = (x) => String(x).charAt(0).toLowerCase();
      if (item.kind === 'code-pizza') {
        const prefer = others.filter((q) => q.range === pizza.range && first(q.code) === first(pizza.code)).map((q) => q.name);
        const pool = [...others.filter((q) => q.range === pizza.range), ...others].map((q) => q.name);
        return textQuestion({
          base: { context: { label: 'Pizza code' }, subject: { code: pizza.code, big: true }, ask: 'Which pizza is this?', notes: [], flags: [] },
          answer: pizza.name, labels: textOptions(pizza.name, pool, { rng, prefer, maxPreferred: 2 }), rng, ctx,
        });
      }
      const prefer = others.filter((q) => first(q.code) === first(pizza.code) || first(q.code) === first(pizza.name)).map((q) => q.code);
      return textQuestion({
        base: { context: { label: 'Pizza code' }, subject: { name: pizza.name }, ask: "What's the code?", mono: true, notes: [], flags: [] },
        answer: pizza.code, labels: textOptions(pizza.code, others.map((q) => q.code), { rng, prefer }), rng, ctx,
        allowed: FORMATS,
      });
    }

    case 'next': {
      // "After X, what goes on?" Any layer of the next step is right; only one is offered.
      if (!pizza.orderMatters) return null;
      const st = steps(pizza);
      const cur = st[item.step - 1];
      const nxt = st[item.step];
      if (!cur || !nxt) return null;
      const nextNames = new Set(nxt.items.map((it) => baseName(it.layer.name)));
      const curNames = new Set(cur.items.map((it) => baseName(it.layer.name)));
      const answer = pickOne(nxt.items, rng).layer.name;
      const ownOthers = pizza.layers.map((l) => l.name).filter((n) => !nextNames.has(baseName(n)) && !curNames.has(baseName(n)));
      const decoys = buildChips(data, pizza, rng).filter((c) => c.kind === 'decoy').map((c) => c.name);
      const labels = textOptions(answer, [...ownOthers, ...decoys], { rng, prefer: ownOthers, maxPreferred: 2 });
      if (labels.length < 2) return null;
      const notes = [];
      if (nxt.items.length > 1) notes.push(`Same step: ${nxt.items.map((it) => it.layer.name).join(' and ')}, in either order.`);
      if (nxt.stage === 'postbake') notes.push('That one goes on after the bake.');
      return textQuestion({
        base: {
          context, subject: { code: cur.items.length === 1 ? cur.items[0].layer.code : null, name: cur.items.map((it) => it.layer.name).join(' + ') },
          ask: 'What goes on next?', notes, flags: [],
        },
        answer, labels, rng, ctx,
      });
    }

    case 'noton': {
      // Odd one out: three toppings that are on it and one that isn't.
      const real = [];
      const seen = new Set();
      for (const l of pizza.layers) {
        if (!seen.has(baseName(l.name))) { seen.add(baseName(l.name)); real.push(l.name); }
      }
      const decoy = buildChips(data, pizza, rng).find((c) => c.kind === 'decoy');
      if (real.length < 3 || !decoy) return null;
      const labels = shuffle([...sample(real, 3, rng), decoy.name], rng);
      return {
        kind: 'mc', context: { label: 'Odd one out' }, subject: { name: pizza.name }, ask: 'Which of these is NOT on it?',
        options: labels.map((l) => ({ label: l, correct: l === decoy.name })), answer: decoy.name,
        notes: [`On a ${pizza.name}: ${real.join(', ')}.`], flags: [],
      };
    }

    case 'fact': {
      const f = pizza.facts[item.factIndex];
      if (!f) return null;
      return { kind: 'flip', context, front: f.q, back: f.a, notes: [], flags: [] };
    }

    case 'general': {
      const f = data.generalFacts[item.factIndex];
      if (!f) return null;
      return { kind: 'flip', context: { label: 'General' }, front: f.q, back: f.a, notes: [], flags: [] };
    }

    case 'base':
      if (!pizza.base) return null;
      return { kind: 'flip', context, front: 'Base?', back: pizza.base, notes: [], flags: [] };

    case 'placement': {
      if (!pizza.placement) return null;
      // Sometimes recall it (flip), sometimes pick it out from other pizzas' placements.
      const others = [...new Set(data.pizzas.filter((q) => q.placement && q.placement !== pizza.placement).map((q) => q.placement))];
      const asMc = others.length >= 2 && (ctx.format ? ctx.format === 'mc' : rng() < 0.5);
      if (!asMc) return { kind: 'flip', context, front: 'How do the toppings go on?', back: pizza.placement, notes: [], flags: [] };
      const labels = shuffle([pizza.placement, ...sample(others, 3, rng)], rng);
      return {
        kind: 'mc', context: { label: 'Placement' }, subject: { code: pizza.code, name: pizza.name }, ask: 'How do the toppings go on?',
        options: labels.map((l) => ({ label: l, correct: l === pizza.placement })), answer: pizza.placement, notes: [], flags: [],
      };
    }

    case 'placement-which': {
      if (!pizza.placement) return null;
      const others = data.pizzas.filter((q) => q.id !== pizza.id && q.placement && q.placement !== pizza.placement);
      if (!others.length) return null;
      const prefer = others.filter((q) => q.range === pizza.range).map((q) => q.name);
      return textQuestion({
        base: { context: { label: 'Placement' }, quote: pizza.placement, subject: null, ask: 'Which pizza is this?', notes: [], flags: [] },
        answer: pizza.name, labels: textOptions(pizza.name, others.map((q) => q.name), { rng, prefer, maxPreferred: 2 }), rng, ctx,
      });
    }

    case 'extracheese': {
      const filters = ctx.filters || { ranges: rangesIn(data) };
      const pool = data.pizzas.filter((p) => filters.ranges.includes(p.range));
      const yes = pool.filter((p) => p.layers.some(isExtraCheese));
      const no = pool.filter((p) => !p.layers.some(isExtraCheese));
      if (!yes.length || pool.length < 2) return null;
      const shown = shuffle([...yes, ...sample(no, Math.max(2, Math.min(no.length, 10 - yes.length)), rng)], rng);
      return {
        kind: 'multi', context: { label: 'Extra cheese' }, prompt: 'Which of these get extra cheese on top?',
        options: shown.map((p) => ({ id: p.id, label: p.name, code: p.code, correct: yes.includes(p) })),
        notes: [], flags: [],
      };
    }

    case 'postbake-which': {
      const filters = ctx.filters || { ranges: rangesIn(data) };
      const pool = data.pizzas.filter((p) => filters.ranges.includes(p.range));
      const yes = pool.filter(hasPostbake);
      const no = pool.filter((p) => !hasPostbake(p));
      if (!yes.length || !no.length) return null;
      const shown = shuffle([...sample(yes, 6, rng), ...sample(no, Math.max(2, Math.min(no.length, 10 - Math.min(yes.length, 6))), rng)], rng);
      return {
        kind: 'multi', context: { label: 'After the bake' }, prompt: 'Which of these get something after the bake?',
        options: shown.map((p) => ({ id: p.id, label: p.name, code: p.code, correct: yes.includes(p) })),
        notes: yes.filter((p) => shown.includes(p)).map((p) => `${p.name}: ${p.layers.filter((l) => l.stage === 'postbake').map((l) => l.name).join(', ')}`),
        flags: [],
      };
    }

    case 'range-sizes': {
      const ps = data.pizzas.filter((p) => p.range === item.range);
      if (!ps.length) return null;
      const set = ps[0].sizes;
      return {
        kind: 'multi', context: { label: 'Sizes' }, prompt: `Which sizes do ${item.range} pizzas come in?`,
        options: sizesIn(data).map((k) => ({ id: k, label: shortSizeName(data, k), size: k, correct: set.includes(k) })),
        notes: [], flags: [],
      };
    }

    default:
      return null;
  }
}
