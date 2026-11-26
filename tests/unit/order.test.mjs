import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilds } from '../../docs/js/data.js';
import { checkOrder, checkPicks, canonicalize, longestNonDecreasing } from '../../docs/js/order.js';
import { fixture } from './helpers.mjs';

const data = validateBuilds(fixture()).data;
const T1 = data.pizzas[0]; // X(1) C(2) P(3) O(3) C-extra(4) Zz(5, postbake)
const T3 = data.pizzas[2]; // orderMatters false
const L = (index) => ({ kind: 'layer', index });
const D = (name) => ({ kind: 'decoy', name });

test('the exact build order is correct', () => {
  const r = checkOrder(T1, [0, 1, 2, 3, 4, 5].map(L));
  assert.equal(r.correct, true);
  assert.ok(r.marks.every((m) => m.ok));
  assert.deepEqual(r.missing, []);
});

test('layers sharing a seq can go on in either order', () => {
  const r = checkOrder(T1, [0, 1, 3, 2, 4, 5].map(L));
  assert.equal(r.correct, true);
});

test('same code twice (cheese, then extra cheese) is told apart by index', () => {
  // Extra cheese (index 4) before the onion/pepperoni step is wrong even though it is also "C".
  const r = checkOrder(T1, [0, 1, 4, 2, 3, 5].map(L));
  assert.equal(r.correct, false);
  assert.equal(r.marks.filter((m) => !m.ok).length, 1);
  // Swapping cheese and extra cheese entirely is wrong too.
  const r2 = checkOrder(T1, [0, 4, 2, 3, 1, 5].map(L));
  assert.equal(r2.correct, false);
});

test('identical-looking chips are interchangeable', () => {
  const d = fixture();
  d.pizzas[0].layers[4].name = 'Cheese'; // now two "C Cheese" layers, steps 2 and 4
  const p = validateBuilds(d).data.pizzas[0];
  // Tapping the step-4 chip first and the step-2 chip later looks the same to the user.
  assert.deepEqual(canonicalize(p, [4, 1]), [1, 4]);
  const r = checkOrder(p, [0, 4, 2, 3, 1, 5].map(L));
  assert.equal(r.correct, true);
});

test('a decoy makes it wrong but the real layers are still judged on order', () => {
  const r = checkOrder(T1, [L(0), L(1), D('Ham'), L(2), L(3), L(4), L(5)]);
  assert.equal(r.correct, false);
  assert.equal(r.decoys, 1);
  assert.equal(r.marks[2].reason, 'decoy');
  assert.equal(r.marks.filter((m) => m.reason === 'order').length, 0);
});

test('a missing layer makes it wrong and is reported', () => {
  const r = checkOrder(T1, [0, 1, 2, 3, 5].map(L));
  assert.equal(r.correct, false);
  assert.deepEqual(r.missing, [4]);
  assert.ok(r.marks.every((m) => m.ok)); // what was tapped is in the right relative order
});

test('out-of-order layers are highlighted (smallest set of moves)', () => {
  // Sauce tapped last: only that one is out of place.
  const r = checkOrder(T1, [1, 2, 3, 4, 5, 0].map(L));
  assert.equal(r.correct, false);
  assert.deepEqual(r.marks.map((m) => m.ok), [true, true, true, true, true, false]);
  assert.equal(r.marks[5].reason, 'order');
});

test('postbake drizzle must come last', () => {
  const r = checkOrder(T1, [0, 1, 5, 2, 3, 4].map(L));
  assert.equal(r.correct, false);
});

test('unordered picks for pizzas where order does not matter', () => {
  assert.equal(checkPicks(T3, [L(2), L(0), L(1)]).correct, true);
  const withDecoy = checkPicks(T3, [L(2), L(0), L(1), D('Ham')]);
  assert.equal(withDecoy.correct, false);
  assert.equal(withDecoy.marks[3].reason, 'decoy');
  const missing = checkPicks(T3, [L(0), L(1)]);
  assert.equal(missing.correct, false);
  assert.deepEqual(missing.missing, [2]);
});

test('longest non-decreasing subsequence', () => {
  assert.deepEqual([...longestNonDecreasing([1, 2, 3])].sort(), [0, 1, 2]);
  assert.equal(longestNonDecreasing([3, 1, 2]).size, 2);
  assert.equal(longestNonDecreasing([2, 2, 1, 3]).size, 3);
  assert.equal(longestNonDecreasing([]).size, 0);
});
