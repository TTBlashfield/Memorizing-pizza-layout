import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBuildsText, validateBuilds, steps, layerTitle, formatAmount, amountExtras,
  parseAmountInput, isDrizzle, isExtraCheese, shortSizeName, sizesIn, rangesIn,
} from '../../docs/js/data.js';
import { fixture, fixtureText, clone } from './helpers.mjs';

test('the fake fixture is valid and counted correctly', () => {
  const res = parseBuildsText(fixtureText());
  assert.equal(res.ok, true, res.errors && res.errors.join('\n'));
  assert.equal(res.stats.pizzas, 3);
  assert.deepEqual(res.stats.byRange, [
    { range: 'Classics', count: 1 },
    { range: 'Italianos', count: 1 },
    { range: 'Cheeky Little', count: 1 },
  ]);
  assert.equal(res.stats.flagged, 2);
});

test('rejects the wrong schema with a friendly message', () => {
  const d = fixture();
  d.schema = 'something-else/v9';
  const res = validateBuilds(d);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /makeline-builds\/v1/);
  assert.match(res.errors[0], /something-else\/v9/);

  delete d.schema;
  assert.match(validateBuilds(d).errors[0], /no "schema" field/);
});

test('rejects bad JSON and empty input with friendly messages', () => {
  assert.match(parseBuildsText('').errors[0], /empty/);
  assert.match(parseBuildsText('{ not json').errors[0], /isn't valid JSON/);
  assert.match(parseBuildsText('[1,2]').errors[0], /builds object/);
});

test('tolerates a BOM and curly quotes from a notes app', () => {
  assert.equal(parseBuildsText('﻿' + fixtureText()).ok, true);
  const curly = fixtureText().replace(/"/g, (m, i) => (i % 2 ? '“' : '”'));
  const res = parseBuildsText(curly);
  assert.equal(res.ok, true);
  assert.match(res.warnings[0], /Curly quotes/);
});

test('reports a missing amount with pizza, layer and size names', () => {
  const d = fixture();
  delete d.pizzas[0].layers[2].amounts.M;
  const res = validateBuilds(d);
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Test Feast Supreme Deluxe/);
  assert.match(res.errors[0], /Pepperoni/);
  assert.match(res.errors[0], /Medium/);
});

test('rejects duplicate pizza ids, bad units, bad stages and unknown sizes', () => {
  const d = fixture();
  d.pizzas[1].id = 'T1';
  d.pizzas[0].layers[0].unit = 'cups';
  d.pizzas[0].layers[1].stage = 'during';
  d.pizzas[2].sizes = ['XL'];
  const res = validateBuilds(d);
  assert.equal(res.ok, false);
  const all = res.errors.join('\n');
  assert.match(all, /unique/);
  assert.match(all, /unit "cups"/);
  assert.match(all, /stage/);
  assert.match(all, /size "XL"/);
});

test('null codes and decimal amounts are fine', () => {
  const res = validateBuilds(fixture());
  const t2 = res.data.pizzas.find((p) => p.id === 'T2');
  assert.equal(t2.layers[2].code, null);
  const t3 = res.data.pizzas.find((p) => p.id === 'T3');
  assert.equal(t3.layers[1].amounts.ONE, 52.5);
  assert.equal(formatAmount(52.5, 'g'), '52.5g');
});

test('fills in optional fields and keeps flags and notes', () => {
  const d = fixture();
  delete d.pizzas[0].facts;
  delete d.pizzas[0].base;
  delete d.generalFacts;
  const res = validateBuilds(d);
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.pizzas[0].facts, []);
  assert.equal(res.data.pizzas[0].base, null);
  assert.deepEqual(res.data.generalFacts, []);
  assert.equal(res.data.pizzas[0].layers[3].flag, 'Test flag text.');
  assert.equal(res.data.pizzas[0].layers[0].note, 'Standard portion');
});

test('extra amount keys for sizes a pizza lacks are dropped with a warning', () => {
  const d = fixture();
  d.pizzas[1].layers[0].amounts.P = 5;
  const res = validateBuilds(d);
  assert.equal(res.ok, true);
  assert.equal(res.data.pizzas[1].layers[0].amounts.P, undefined);
  assert.ok(res.warnings.some((w) => /ignored/.test(w)));
});

test('steps group layers that share a seq, and split out post-bake', () => {
  const p = validateBuilds(fixture()).data.pizzas[0];
  const st = steps(p);
  assert.deepEqual(st.map((s) => s.items.map((i) => i.index)), [[0], [1], [2, 3], [4], [5]]);
  assert.equal(st[4].stage, 'postbake');
  assert.deepEqual(st.map((s) => s.n), [1, 2, 3, 4, 5]);
});

test('steps sort by seq even if the file is out of order', () => {
  const d = clone(fixture());
  const p = d.pizzas[0];
  [p.layers[0], p.layers[1]] = [p.layers[1], p.layers[0]];
  const res = validateBuilds(d);
  assert.equal(res.ok, true);
  assert.ok(res.warnings.some((w) => /sorted/.test(w)));
  assert.deepEqual(steps(res.data.pizzas[0])[0].items.map((i) => i.layer.name), ['Pizza sauce']);
});

test('layer titles disambiguate identical names on one pizza', () => {
  const d = fixture();
  d.pizzas[0].layers[4].name = 'Cheese';
  const p = validateBuilds(d).data.pizzas[0];
  assert.equal(layerTitle(p, 1), 'Cheese (step 2)');
  assert.equal(layerTitle(p, 4), 'Cheese (step 4)');
  assert.equal(layerTitle(p, 0), 'Pizza sauce');
});

test('formatting helpers', () => {
  const p = validateBuilds(fixture()).data.pizzas[0];
  assert.equal(formatAmount(1, 'slices'), '1 slice');
  assert.equal(formatAmount(16, 'slices'), '16 slices');
  assert.equal(formatAmount(6, 'lines'), '6 lines');
  assert.deepEqual(amountExtras(p.layers[2], 'L'), ['2 per slice']);
  assert.deepEqual(amountExtras(p.layers[5], 'S'), ['6 lines']);
  assert.equal(parseAmountInput(' 52,5 '), 52.5);
  assert.equal(parseAmountInput('112g'), 112);
  assert.ok(Number.isNaN(parseAmountInput('')));
  assert.ok(Number.isNaN(parseAmountInput('abc')));
});

test('drizzle and extra-cheese detection, sizes and ranges', () => {
  const data = validateBuilds(fixture()).data;
  const p = data.pizzas[0];
  assert.equal(isDrizzle(p.layers[5]), true);
  assert.equal(isDrizzle(p.layers[0]), false);
  assert.equal(isExtraCheese(p.layers[4]), true);
  assert.equal(isExtraCheese(p.layers[1]), false);
  assert.equal(shortSizeName(data, 'ONE'), 'One size');
  assert.deepEqual(sizesIn(data), ['P', 'S', 'M', 'L', 'ONE']);
  assert.deepEqual(rangesIn(data), ['Classics', 'Italianos', 'Cheeky Little']);
});
