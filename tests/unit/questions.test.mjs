import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilds, baseName } from '../../docs/js/data.js';
import { buildItems, effectiveFilters, makeQuestion, buildChips, pizzaItems, pickFormat, modesFor, countFor } from '../../docs/js/questions.js';
import { seededRng } from '../../docs/js/util.js';
import { fixture, clone } from './helpers.mjs';

const data = validateBuilds(fixture()).data;
const ALL = effectiveFilters(data, { showGrams: true });
const NO_GRAMS = effectiveFilters(data, {});
const MC = { format: 'mc' };

test('every item key is unique', () => {
  const items = buildItems(data, ALL);
  assert.equal(new Set(items.map((i) => i.key)).size, items.length);
});

test('keys follow the documented, stable formats', () => {
  const keys = new Set(buildItems(data, ALL).map((i) => i.key));
  for (const k of [
    'portion:T1:L:4', 'order:T1:M', 'card:T3:ONE', 'code-topping:K'.replace('K', 'X'), 'code-pizza:T2',
    'perslice:T1:L:2', 'stage:T1:5', 'fact:T2:0', 'general:0', 'lines:T1:S:5', 'slices:M', 'base:T2',
    'placement:T1', 'extracheese', 'code-topping-rev:Zz', 'code-pizza-rev:T1',
  ]) {
    assert.ok(keys.has(k), `missing ${k}`);
  }
});

test('keys stay the same when the file is re-imported', () => {
  const again = validateBuilds(fixture()).data;
  assert.deepEqual(buildItems(again, ALL).map((i) => i.key), buildItems(data, ALL).map((i) => i.key));
});

test('only sizes a pizza actually has are asked about', () => {
  for (const it of buildItems(data, ALL)) {
    if (!it.size || !it.pizzaId) continue;
    const p = data.pizzas.find((x) => x.id === it.pizzaId);
    assert.ok(p.sizes.includes(it.size), `${it.key} asks about a size ${p.id} doesn't come in`);
  }
});

test('filters limit ranges and sizes', () => {
  const items = buildItems(data, { ranges: ['Classics'], sizes: ['L'] });
  assert.ok(items.length > 0);
  for (const it of items) {
    if (it.pizzaId) assert.equal(it.pizzaId, 'T1');
    if (it.size) assert.equal(it.size, 'L');
  }
  // Topping codes only used by Cheeky Little drop out when that range is off.
  assert.ok(!items.some((i) => i.key === 'code-topping:Cd'));
  assert.ok(items.some((i) => i.key === 'code-topping:X'));
});

test('null-code layers are quizzed by name but never in the code quizzes', () => {
  const items = buildItems(data, ALL);
  const q = makeQuestion({ key: 'portion:T2:M:2', mode: 'portions', kind: 'portion', pizzaId: 'T2', size: 'M', layerIndex: 2 }, data);
  assert.equal(q.subject.code, null);
  assert.equal(q.subject.name, 'Mystery topping');
  const codeItems = items.filter((i) => i.kind.startsWith('code-topping'));
  assert.ok(codeItems.every((i) => i.code && typeof i.code === 'string'));
});

test('portion questions: 4 unique options, one right answer, units always shown', () => {
  const items = buildItems(data, ALL).filter((i) => i.kind === 'portion');
  for (const [n, it] of items.entries()) {
    const q = makeQuestion(it, data, { ...MC, rng: seededRng(n + 1) });
    assert.equal(q.options.length, 4, it.key);
    assert.equal(new Set(q.options.map((o) => o.label)).size, 4, it.key);
    assert.equal(q.options.filter((o) => o.correct).length, 1, it.key);
    const layer = data.pizzas.find((p) => p.id === it.pizzaId).layers[it.layerIndex];
    const unitRe = { g: /\dg$/, slices: / slices?$/, pieces: / pieces?$/, lines: / lines?$/ }[layer.unit];
    for (const o of q.options) assert.match(o.label, unitRe, `${it.key}: ${o.label}`);
    assert.equal(q.options.find((o) => o.correct).label, q.answer);
  }
});

test('the decimal Cheeky Little portion works', () => {
  const q = makeQuestion({ key: 'portion:T3:ONE:1', kind: 'portion', pizzaId: 'T3', size: 'ONE', layerIndex: 1 }, data, { ...MC, rng: seededRng(2) });
  assert.equal(q.answer, '52.5g');
  assert.ok(q.options.some((o) => o.correct && o.label === '52.5g'));
});

test('flagged layers are still quizzed and carry the flag text', () => {
  const items = buildItems(data, ALL);
  assert.ok(items.some((i) => i.key === 'portion:T1:M:3'));
  const q = makeQuestion({ key: 'portion:T1:M:3', kind: 'portion', pizzaId: 'T1', size: 'M', layerIndex: 3 }, data, MC);
  assert.deepEqual(q.flags, ['Test flag text.']);
});

test('same code twice: cheese and extra cheese are separate questions with different answers', () => {
  const a = makeQuestion({ kind: 'portion', pizzaId: 'T1', size: 'L', layerIndex: 1 }, data, MC);
  const b = makeQuestion({ kind: 'portion', pizzaId: 'T1', size: 'L', layerIndex: 4 }, data, MC);
  assert.equal(a.answer, '41g');
  assert.equal(b.answer, '4g');
  assert.equal(b.subject.name, 'Extra cheese (on top)');
});

test('before/after the bake for drizzles', () => {
  const q = makeQuestion({ kind: 'stage', pizzaId: 'T1', layerIndex: 5 }, data);
  assert.equal(q.answer, 'After the bake');
  assert.equal(q.options.filter((o) => o.correct).length, 1);
});

test('per-slice, lines and slices-per-size questions', () => {
  const ps = makeQuestion({ kind: 'perslice', pizzaId: 'T1', size: 'L', layerIndex: 2 }, data, { ...MC, rng: seededRng(3) });
  assert.equal(ps.answer, '2 per slice');
  const ln = makeQuestion({ kind: 'lines', pizzaId: 'T1', size: 'M', layerIndex: 5 }, data, { ...MC, rng: seededRng(4) });
  assert.equal(ln.answer, '8 lines');
  const sl = makeQuestion({ kind: 'slices', size: 'L' }, data, { ...MC, rng: seededRng(5) });
  assert.equal(sl.answer, '10 slices');
  for (const q of [ps, ln, sl]) assert.equal(new Set(q.options.map((o) => o.label)).size, 4);
});

test('codes both ways', () => {
  const a = makeQuestion({ kind: 'code-topping', code: 'P' }, data, { ...MC, rng: seededRng(1) });
  assert.equal(a.answer, 'Pepperoni');
  assert.equal(a.options.filter((o) => o.correct).length, 1);
  const b = makeQuestion({ kind: 'code-topping-rev', code: 'C' }, data, { ...MC, rng: seededRng(1) });
  assert.equal(b.answer, 'C');
  assert.ok(b.options.some((o) => o.label === 'Cd'), 'look-alike code offered');
  const c = makeQuestion({ kind: 'code-pizza', pizzaId: 'T2' }, data, { ...MC, rng: seededRng(1) });
  assert.equal(c.answer, 'Test Italiano');
  const d = makeQuestion({ kind: 'code-pizza-rev', pizzaId: 'T2' }, data, { ...MC, rng: seededRng(1) });
  assert.equal(d.answer, 'T2');
});

test('extra cheese on top: multi-select with the right pizzas marked', () => {
  const q = makeQuestion({ kind: 'extracheese' }, data, { rng: seededRng(1), filters: ALL });
  assert.equal(q.kind, 'multi');
  assert.deepEqual(q.options.filter((o) => o.correct).map((o) => o.id), ['T1']);
  assert.ok(q.options.length >= 2);
});

test('facts and general facts become flip cards', () => {
  assert.equal(makeQuestion({ kind: 'fact', pizzaId: 'T2', factIndex: 0 }, data).back, 'Test pizza answer');
  assert.equal(makeQuestion({ kind: 'general', factIndex: 0 }, data).back, 'Test general answer');
  assert.equal(makeQuestion({ kind: 'base', pizzaId: 'T2' }, data, MC).back, 'Test base (small, medium and large only)');
});

test('a question for something no longer in the file returns null', () => {
  assert.equal(makeQuestion({ kind: 'portion', pizzaId: 'GONE', size: 'M', layerIndex: 0 }, data), null);
  assert.equal(makeQuestion({ kind: 'portion', pizzaId: 'T1', size: 'M', layerIndex: 99 }, data), null);
  assert.equal(makeQuestion({ kind: 'card', pizzaId: 'T2', size: 'P' }, data), null);
});

test('build chips: all layers plus 3–4 believable decoys from other pizzas', () => {
  const d = clone(fixture());
  d.pizzas.push({
    id: 'T4', name: 'Test Extra', code: 'T4', range: 'Classics', sizes: ['M'], orderMatters: true,
    base: null, placement: null, facts: [],
    layers: [
      { seq: 1, code: 'X', name: 'Pizza sauce', unit: 'g', amounts: { M: 1 }, stage: 'prebake' },
      { seq: 2, code: 'C', name: 'Mozzarella cheese', unit: 'g', amounts: { M: 1 }, stage: 'prebake' },
      { seq: 3, code: 'Hx', name: 'Test ham', unit: 'slices', amounts: { M: 1 }, stage: 'prebake' },
      { seq: 3, code: 'Kx', name: 'Test bacon', unit: 'slices', amounts: { M: 1 }, stage: 'prebake' },
      { seq: 4, code: 'Mx', name: 'Test mushroom', unit: 'g', amounts: { M: 1 }, stage: 'prebake' },
      { seq: 5, code: null, name: 'Test sauce drizzle', unit: 'lines', amounts: { M: 1 }, stage: 'postbake' },
    ],
  });
  const big = validateBuilds(d).data;
  const t1 = big.pizzas[0];
  for (let seed = 1; seed <= 50; seed++) {
    const chips = buildChips(big, t1, seededRng(seed));
    const layers = chips.filter((c) => c.kind === 'layer');
    const decoys = chips.filter((c) => c.kind === 'decoy');
    assert.deepEqual(layers.map((c) => c.index).sort(), [0, 1, 2, 3, 4, 5]);
    assert.ok(decoys.length >= 3 && decoys.length <= 4, `got ${decoys.length} decoys`);
    assert.equal(new Set(chips.map((c) => c.id)).size, chips.length);
    const own = new Set(t1.layers.map((l) => baseName(l.name)));
    for (const dc of decoys) {
      assert.ok(!own.has(baseName(dc.name)), `decoy ${dc.name} is on the pizza already`);
      assert.notEqual(dc.name, 'Mozzarella cheese', 'same code (C) under another name is not a fair decoy');
    }
  }
});

test('pizzaItems gives every size of one pizza', () => {
  assert.deepEqual(pizzaItems(data, 'T2', 'build').map((i) => i.key), ['order:T2:S', 'order:T2:M', 'order:T2:L']);
});


// ---------- no grams (per slice & counts) ----------

test('grams are off by default: no gram questions, per slice first, counts otherwise', () => {
  assert.equal(NO_GRAMS.grams, false);
  const items = buildItems(data, NO_GRAMS);
  const keys = new Set(items.map((i) => i.key));
  // Gram layers (sauce, cheese, onion...) aren't asked as amounts.
  assert.ok(!keys.has('portion:T1:M:0'));
  assert.ok(!keys.has('portion:T1:M:1'));
  assert.ok(!keys.has('portion:T3:ONE:1'), 'the 52.5g cheese is not asked');
  // Pepperoni has a per-slice figure: that's what's asked (in the per-slice drill), not the total.
  assert.ok(keys.has('perslice:T1:M:2'));
  assert.ok(!keys.has('portion:T1:M:2'));
  assert.equal(items.find((i) => i.key === 'perslice:T1:M:2').mode, 'portions');
  // A count with no per-slice figure is asked as a count.
  assert.ok(keys.has('portion:T3:ONE:2'), 'Cheeky Little pepperoni: 8 slices');
  // Drizzle lines, order, placement etc. are all still there.
  for (const k of ['lines:T1:M:5', 'order:T1:M', 'placement:T1', 'stage:T1:5']) assert.ok(keys.has(k), k);
  for (const it of items) {
    if (it.kind !== 'portion') continue;
    const l = data.pizzas.find((p) => p.id === it.pizzaId).layers[it.layerIndex];
    assert.notEqual(l.unit, 'g', `${it.key} asks grams`);
  }
});

test('mode names follow the grams setting', () => {
  assert.equal(modesFor(NO_GRAMS).find((m) => m.id === 'portions').title, 'Per slice & counts');
  assert.equal(modesFor(ALL).find((m) => m.id === 'portions').title, 'Quick-fire portions');
});

test('countFor: per slice, else a count, else nothing (grams off)', () => {
  const t1 = data.pizzas[0];
  assert.deepEqual(countFor(t1.layers[2], 'L', false), { kind: 'perslice', value: 2, unit: 'per slice' });
  assert.equal(countFor(t1.layers[0], 'L', false), null);
  assert.deepEqual(countFor(data.pizzas[2].layers[2], 'ONE', false), { kind: 'amount', value: 8, unit: 'slices' });
  assert.deepEqual(countFor(t1.layers[0], 'L', true), { kind: 'amount', value: 40, unit: 'g' });
});

test('Build it carries the grams setting', () => {
  assert.equal(makeQuestion({ kind: 'build', pizzaId: 'T1', size: 'M' }, data, { filters: NO_GRAMS }).grams, false);
  assert.equal(makeQuestion({ kind: 'build', pizzaId: 'T1', size: 'M' }, data, { filters: ALL }).grams, true);
});

// ---------- formats: multiple choice, type it, right or wrong ----------

test('pickFormat: forced, allowed lists, and leaning by box', () => {
  assert.equal(pickFormat({ format: 'type' }), 'type');
  assert.equal(pickFormat({ format: 'type' }, ['mc', 'tf']), 'mc');
  const count = (box) => {
    const c = { mc: 0, type: 0, tf: 0 };
    const rng = seededRng(box + 11);
    for (let i = 0; i < 2000; i++) c[pickFormat({ rng, box })]++;
    return c;
  };
  const fresh = count(0);
  const known = count(4);
  assert.ok(fresh.mc > fresh.type, 'new questions lean to multiple choice');
  assert.ok(known.type > known.mc, 'known questions lean to typing');
  assert.ok(fresh.tf > 300 && known.tf > 300, 'right-or-wrong shows up too');
});

test('type-it questions carry the exact answer and unit', () => {
  const q = makeQuestion({ kind: 'perslice', pizzaId: 'T1', size: 'L', layerIndex: 2 }, data, { format: 'type' });
  assert.equal(q.kind, 'type');
  assert.equal(q.numeric, true);
  assert.equal(q.value, 2);
  assert.equal(q.unit, 'per slice');
  assert.equal(q.answer, '2 per slice');
  const c = makeQuestion({ kind: 'code-topping-rev', code: 'Zz' }, data, { format: 'type' });
  assert.equal(c.kind, 'type');
  assert.equal(c.numeric, false);
  assert.equal(c.value, 'Zz');
  // Names are never typed (spelling would get in the way).
  assert.equal(makeQuestion({ kind: 'code-topping', code: 'Zz' }, data, { format: 'type' }).kind, 'mc');
});

test('right-or-wrong claims are true about half the time and always say the real answer', () => {
  let trueCount = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const q = makeQuestion({ kind: 'portion', pizzaId: 'T3', size: 'ONE', layerIndex: 2 }, data, { format: 'tf', rng: seededRng(seed) });
    assert.equal(q.kind, 'tf');
    assert.equal(q.answer, '8 slices');
    assert.equal(q.claimTrue, q.claim === '8 slices');
    if (q.claimTrue) trueCount++;
  }
  assert.ok(trueCount > 60 && trueCount < 140, `true ${trueCount}/200`);
});

// ---------- new rule questions ----------

test('what goes on next: the right answer is in the next step, no other next-step layer is a decoy', () => {
  const items = buildItems(data, NO_GRAMS);
  assert.deepEqual(items.filter((i) => i.kind === 'next' && i.pizzaId === 'T1').map((i) => i.key), ['next:T1:1', 'next:T1:2', 'next:T1:3', 'next:T1:4']);
  assert.ok(!items.some((i) => i.key.startsWith('next:T3')), 'no order questions when the card gives no order');
  for (let seed = 1; seed <= 40; seed++) {
    const q = makeQuestion({ kind: 'next', pizzaId: 'T1', step: 2 }, data, { ...MC, rng: seededRng(seed) });
    assert.equal(q.subject.name, 'Cheese');
    assert.ok(['Pepperoni', 'Red onion'].includes(q.answer));
    assert.equal(q.options.filter((o) => o.correct).length, 1);
    const wrongLabels = q.options.filter((o) => !o.correct).map((o) => o.label);
    assert.ok(!wrongLabels.includes('Pepperoni') && !wrongLabels.includes('Red onion'), 'the other step-3 layer is also right, so never a decoy');
    assert.match(q.notes[0], /either order/);
  }
  const last = makeQuestion({ kind: 'next', pizzaId: 'T1', step: 4 }, data, MC);
  assert.equal(last.answer, 'Test drizzle');
  assert.ok(last.notes.some((n) => /after the bake/.test(n)));
});

test('odd one out: exactly one option is not on the pizza', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const q = makeQuestion({ kind: 'noton', pizzaId: 'T1' }, data, { rng: seededRng(seed) });
    assert.equal(q.options.length, 4);
    const onPizza = new Set(data.pizzas[0].layers.map((l) => l.name));
    const notOn = q.options.filter((o) => !onPizza.has(o.label));
    assert.equal(notOn.length, 1);
    assert.equal(notOn[0].correct, true);
  }
});

test('placement: flip or pick-the-right-tip, and which pizza from a tip', () => {
  const d = fixture();
  d.pizzas[1].placement = 'Tip two.';
  d.pizzas[2].placement = 'Tip three.';
  const big = validateBuilds(d).data;
  const mc = makeQuestion({ kind: 'placement', pizzaId: 'T1' }, big, { format: 'mc', rng: seededRng(1) });
  assert.equal(mc.kind, 'mc');
  assert.equal(mc.options.find((o) => o.correct).label, 'Test placement tip.');
  assert.equal(makeQuestion({ kind: 'placement', pizzaId: 'T1' }, big, { format: 'flip' }).kind, 'flip');
  const which = makeQuestion({ kind: 'placement-which', pizzaId: 'T2' }, big, { ...MC, rng: seededRng(2) });
  assert.equal(which.quote, 'Tip two.');
  assert.equal(which.answer, 'Test Italiano');
  assert.ok(buildItems(big, ALL).some((i) => i.key === 'placement-which:T1'));
  // With only one placement tip in the file there's nothing to pick from.
  assert.ok(!buildItems(data, ALL).some((i) => i.kind === 'placement-which'));
});

test('which pizzas get something after the bake', () => {
  const q = makeQuestion({ kind: 'postbake-which' }, data, { filters: ALL, rng: seededRng(1) });
  assert.equal(q.kind, 'multi');
  assert.deepEqual(q.options.filter((o) => o.correct).map((o) => o.id), ['T1']);
  assert.match(q.notes[0], /Test drizzle/);
});

test('which sizes does a range come in', () => {
  const items = buildItems(data, ALL);
  assert.ok(items.some((i) => i.key === 'range-sizes:Italianos'));
  const q = makeQuestion({ kind: 'range-sizes', range: 'Italianos' }, data);
  assert.deepEqual(q.options.filter((o) => o.correct).map((o) => o.id), ['S', 'M', 'L']);
  assert.equal(q.options.length, 5);
});
