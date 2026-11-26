import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilds, baseName } from '../../docs/js/data.js';
import { buildItems, effectiveFilters, makeQuestion, buildChips, pizzaItems } from '../../docs/js/questions.js';
import { seededRng } from '../../docs/js/util.js';
import { fixture, clone } from './helpers.mjs';

const data = validateBuilds(fixture()).data;
const ALL = effectiveFilters(data, {});

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
    const q = makeQuestion(it, data, { rng: seededRng(n + 1) });
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
  const q = makeQuestion({ key: 'portion:T3:ONE:1', kind: 'portion', pizzaId: 'T3', size: 'ONE', layerIndex: 1 }, data, { rng: seededRng(2) });
  assert.equal(q.answer, '52.5g');
  assert.ok(q.options.some((o) => o.correct && o.label === '52.5g'));
});

test('flagged layers are still quizzed and carry the flag text', () => {
  const items = buildItems(data, ALL);
  assert.ok(items.some((i) => i.key === 'portion:T1:M:3'));
  const q = makeQuestion({ key: 'portion:T1:M:3', kind: 'portion', pizzaId: 'T1', size: 'M', layerIndex: 3 }, data);
  assert.deepEqual(q.flags, ['Test flag text.']);
});

test('same code twice: cheese and extra cheese are separate questions with different answers', () => {
  const a = makeQuestion({ kind: 'portion', pizzaId: 'T1', size: 'L', layerIndex: 1 }, data);
  const b = makeQuestion({ kind: 'portion', pizzaId: 'T1', size: 'L', layerIndex: 4 }, data);
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
  const ps = makeQuestion({ kind: 'perslice', pizzaId: 'T1', size: 'L', layerIndex: 2 }, data, { rng: seededRng(3) });
  assert.equal(ps.answer, '2 per slice');
  const ln = makeQuestion({ kind: 'lines', pizzaId: 'T1', size: 'M', layerIndex: 5 }, data, { rng: seededRng(4) });
  assert.equal(ln.answer, '8 lines');
  const sl = makeQuestion({ kind: 'slices', size: 'L' }, data, { rng: seededRng(5) });
  assert.equal(sl.answer, '10 slices');
  for (const q of [ps, ln, sl]) assert.equal(new Set(q.options.map((o) => o.label)).size, 4);
});

test('codes both ways', () => {
  const a = makeQuestion({ kind: 'code-topping', code: 'P' }, data, { rng: seededRng(1) });
  assert.equal(a.answer, 'Pepperoni');
  assert.equal(a.options.filter((o) => o.correct).length, 1);
  const b = makeQuestion({ kind: 'code-topping-rev', code: 'C' }, data, { rng: seededRng(1) });
  assert.equal(b.answer, 'C');
  assert.ok(b.options.some((o) => o.label === 'Cd'), 'look-alike code offered');
  const c = makeQuestion({ kind: 'code-pizza', pizzaId: 'T2' }, data, { rng: seededRng(1) });
  assert.equal(c.answer, 'Test Italiano');
  const d = makeQuestion({ kind: 'code-pizza-rev', pizzaId: 'T2' }, data, { rng: seededRng(1) });
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
  assert.equal(makeQuestion({ kind: 'base', pizzaId: 'T2' }, data).back, 'Test base (small, medium and large only)');
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
