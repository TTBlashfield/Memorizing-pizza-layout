// Turns a loaded builds file into quiz items (with stable keys) and questions. Pure.
//
// An "item" is what the scheduler tracks: { key, mode, kind, pizzaId?, size?, layerIndex?, ... }.
// A "question" is built fresh each time an item is shown (options are re-shuffled).
import {
  baseName, formatAmount, formatNum, isDrizzle, isExtraCheese, layerSig, layerTitle, normName,
  rangesIn, shortSizeName, sizesIn,
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

export const modeTitle = (id) => (id === 'weak' ? 'Weak spots' : (MODES.find((m) => m.id === id) || {}).title || id);

/** Saved filters, cleaned against what's actually in the file. Empty means "all". */
export function effectiveFilters(data, saved = {}) {
  const allRanges = rangesIn(data);
  const allSizes = sizesIn(data);
  const ranges = (saved.ranges || []).filter((r) => allRanges.includes(r));
  const sizes = (saved.sizes || []).filter((s) => allSizes.includes(s));
  return { ranges: ranges.length ? ranges : allRanges, sizes: sizes.length ? sizes : allSizes };
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

  for (const p of pizzas) {
    for (const s of p.sizes.filter((k) => sizes.has(k))) {
      add({ key: `card:${p.id}:${s}`, mode: 'flash', kind: 'card', pizzaId: p.id, size: s });
      add({ key: `order:${p.id}:${s}`, mode: 'build', kind: 'build', pizzaId: p.id, size: s });
      p.layers.forEach((l, i) => {
        add({ key: `portion:${p.id}:${s}:${i}`, mode: 'portions', kind: 'portion', pizzaId: p.id, size: s, layerIndex: i });
        if (l.perSlice && isNum(l.perSlice[s])) {
          add({ key: `perslice:${p.id}:${s}:${i}`, mode: 'rules', kind: 'perslice', pizzaId: p.id, size: s, layerIndex: i });
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

  data.generalFacts.forEach((f, i) => add({ key: `general:${i}`, mode: 'rules', kind: 'general', factIndex: i }));
  return items;
}

/** Items for one pizza (used by "Practise this pizza"), ignoring the size filter. */
export function pizzaItems(data, pizzaId, mode) {
  const p = pizzaById(data, pizzaId);
  if (!p) return [];
  return buildItems(data, { ranges: [p.range], sizes: p.sizes })
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

function numericMc({ context, subject, ask, answer, pools, format, integer, notes = [], flags = [], rng }) {
  const values = numericOptions(answer, pools, { rng, integer });
  return {
    kind: 'mc',
    context,
    subject,
    ask,
    options: values.map((v) => ({ label: format(v), correct: v === Math.round(answer * 100) / 100 })),
    answer: format(answer),
    notes,
    flags,
  };
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
      return { kind: 'build', context, pizzaId: pizza.id, size: item.size, chips: buildChips(data, pizza, rng) };

    case 'portion': {
      const answer = layer.amounts[item.size];
      return numericMc({
        context, subject, ask: ASK[layer.unit] || 'How much?', answer, rng,
        integer: layer.unit !== 'g' && Number.isInteger(answer),
        pools: [otherSizeValues(layer.amounts, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'amounts', answer)],
        format: (v) => formatAmount(v, layer.unit),
        notes: layer.note ? [layer.note] : [],
        flags: layerFlags(layer),
      });
    }

    case 'perslice': {
      const answer = layer.perSlice[item.size];
      return numericMc({
        context, subject, ask: 'How many per slice?', answer, rng, integer: Number.isInteger(answer),
        pools: [otherSizeValues(layer.perSlice, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'perSlice', answer)],
        format: (v) => `${formatNum(v)} per slice`,
        notes: [`That's ${formatAmount(layer.amounts[item.size], layer.unit)} in total.`],
        flags: layerFlags(layer),
      });
    }

    case 'lines': {
      const answer = layer.lines[item.size];
      return numericMc({
        context, subject, ask: 'How many lines?', answer, rng, integer: Number.isInteger(answer),
        pools: [otherSizeValues(layer.lines, item.size), sameToppingValues(data, pizza, item.layerIndex, item.size, 'lines', answer)],
        format: (v) => formatAmount(v, 'lines'),
        notes: layer.note ? [layer.note] : [],
        flags: layerFlags(layer),
      });
    }

    case 'slices': {
      const size = data.sizes.find((s) => s.key === item.size);
      if (!size || !isNum(size.slices)) return null;
      const others = data.sizes.filter((s) => s.key !== item.size && isNum(s.slices)).map((s) => s.slices);
      return numericMc({
        context: { size: item.size, pizzaId: null, label: 'Slices per pizza' },
        subject: { code: null, name: shortSizeName(data, item.size) },
        ask: 'How many slices?', answer: size.slices, rng, integer: true,
        pools: [others],
        format: (v) => `${formatNum(v)} slices`,
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
      const first = (s) => String(s).charAt(0).toLowerCase();
      if (item.kind === 'code-topping') {
        const prefer = entries.filter(([c]) => first(c) === first(item.code)).map(([, n]) => n);
        const labels = textOptions(name, entries.map(([, n]) => n), { rng, prefer });
        return {
          kind: 'mc', context: { label: 'Topping code' }, subject: { code: item.code, big: true }, ask: "What's this topping?",
          options: labels.map((l) => ({ label: l, correct: l === name })), answer: name, notes: [], flags: [],
        };
      }
      const prefer = entries.filter(([c]) => first(c) === first(item.code) || first(c) === first(name)).map(([c]) => c);
      const labels = textOptions(item.code, entries.map(([c]) => c), { rng, prefer });
      return {
        kind: 'mc', context: { label: 'Topping code' }, subject: { name }, ask: "What's the code?", mono: true,
        options: labels.map((l) => ({ label: l, correct: l === item.code })), answer: item.code, notes: [], flags: [],
      };
    }

    case 'code-pizza':
    case 'code-pizza-rev': {
      const others = data.pizzas.filter((q) => q.code !== pizza.code && normName(q.name) !== normName(pizza.name));
      const first = (s) => String(s).charAt(0).toLowerCase();
      if (item.kind === 'code-pizza') {
        const prefer = others.filter((q) => q.range === pizza.range && first(q.code) === first(pizza.code)).map((q) => q.name);
        const pool = [...others.filter((q) => q.range === pizza.range), ...others].map((q) => q.name);
        const labels = textOptions(pizza.name, pool, { rng, prefer, maxPreferred: 2 });
        return {
          kind: 'mc', context: { label: 'Pizza code' }, subject: { code: pizza.code, big: true }, ask: 'Which pizza is this?',
          options: labels.map((l) => ({ label: l, correct: l === pizza.name })), answer: pizza.name, notes: [], flags: [],
        };
      }
      const prefer = others.filter((q) => first(q.code) === first(pizza.code) || first(q.code) === first(pizza.name)).map((q) => q.code);
      const labels = textOptions(pizza.code, others.map((q) => q.code), { rng, prefer });
      return {
        kind: 'mc', context: { label: 'Pizza code' }, subject: { name: pizza.name }, ask: "What's the code?", mono: true,
        options: labels.map((l) => ({ label: l, correct: l === pizza.code })), answer: pizza.code, notes: [], flags: [],
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

    case 'placement':
      if (!pizza.placement) return null;
      return { kind: 'flip', context, front: 'How do the toppings go on?', back: pizza.placement, notes: [], flags: [] };

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

    default:
      return null;
  }
}
