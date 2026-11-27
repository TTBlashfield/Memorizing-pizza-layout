import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilds } from '../../docs/js/data.js';
import { toppingGroups, sharedSections, groupValue, quizGroups, toppingKey, makeKeyer } from '../../docs/js/groups.js';
import { buildItems, effectiveFilters, makeQuestion } from '../../docs/js/questions.js';
import { seededRng } from '../../docs/js/util.js';
import { fixture } from './helpers.mjs';

const data = validateBuilds(fixture()).data;
const ids = (members) => members.map((m) => m.pizzaId).sort();

test('same topping = same code, or the same name when there is no code', () => {
  assert.equal(toppingKey({ code: 'P', name: 'Pepperoni' }), 'c:P');
  assert.equal(toppingKey({ code: null, name: 'Mystery topping (new)' }), 'n:mystery topping');
  const pep = toppingGroups(data).find((g) => g.key === 'c:P');
  assert.deepEqual(ids(pep.members), ['T1', 'T3']);
  assert.equal(pep.title, 'Pepperoni');
});

test('sections: unusual sauce/cheese, extra cheese, after the bake, shared and one-pizza toppings', () => {
  const { base, extra, post, shared, unique } = sharedSections(data);
  // Pizza sauce and mozzarella are the usual ones; the Cheeky Little cheese (Cd) isn't.
  assert.deepEqual(base.map((g) => g.key), ['c:Cd']);
  assert.deepEqual(ids(extra), ['T1']);
  assert.deepEqual(post.map((m) => `${m.pizzaId}:${m.layerIndex}`), ['T1:5']);
  assert.deepEqual(shared.map((g) => g.key), ['c:P']);
  assert.deepEqual(unique.map((g) => g.title).sort(), ['Mystery topping', 'Red onion', 'Test drizzle']);
  // The usual sauce and cheese, and extra cheese, never show up as topping groups.
  for (const g of [...shared, ...unique]) assert.ok(!['c:X', 'c:C'].includes(g.key));
});

test('values: per slice first, then counts; grams only when switched on', () => {
  const t1 = data.pizzas[0];
  assert.deepEqual(groupValue(t1.layers[2], 'M', false), { value: 2, kind: 'perslice' });
  assert.deepEqual(groupValue(data.pizzas[2].layers[2], 'ONE', false), { value: 8, kind: 'count', unit: 'slices' });
  assert.equal(groupValue(t1.layers[3], 'M', false), null);
  assert.deepEqual(groupValue(t1.layers[3], 'M', true), { value: 7, kind: 'count', unit: 'g' });
  assert.deepEqual(groupValue(t1.layers[5], 'M', false), { value: 8, kind: 'count', unit: 'lines' });
  assert.equal(groupValue(t1.layers[2], 'ONE', false), null, 'no value for a size the pizza lacks');
});

test('"Which of these have X?" questions for shared toppings', () => {
  assert.deepEqual(quizGroups(data).map((g) => g.key), ['c:P']);
  const ALL = effectiveFilters(data, {});
  assert.ok(buildItems(data, ALL).some((i) => i.key === 'has:c:P'));
  const q = makeQuestion({ kind: 'has', group: 'c:P' }, data, { filters: ALL, rng: seededRng(1) });
  assert.equal(q.kind, 'multi');
  assert.equal(q.prompt, 'Which of these have Pepperoni?');
  assert.deepEqual(q.options.filter((o) => o.correct).map((o) => o.id).sort(), ['T1', 'T3']);
  assert.ok(q.options.some((o) => !o.correct));
  // Only one range selected: needs pizzas both with and without it.
  assert.ok(!buildItems(data, { ...ALL, ranges: ['Classics'] }).some((i) => i.kind === 'has'));
});

test('a topping with no code groups with the coded one of the same name', () => {
  const d = fixture();
  d.pizzas[1].layers[2].name = 'Pepperoni'; // T2's codeless "Mystery topping" is now plain Pepperoni
  d.pizzas[1].layers[2].unit = 'slices';
  const big = validateBuilds(d).data;
  const keyOf = makeKeyer(big);
  assert.equal(keyOf(big.pizzas[1].layers[2]), 'c:P');
  assert.deepEqual(ids(toppingGroups(big).find((g) => g.key === 'c:P').members), ['T1', 'T2', 'T3']);
});
