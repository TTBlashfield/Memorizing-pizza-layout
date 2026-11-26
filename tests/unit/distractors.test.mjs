import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericOptions, textOptions, neighbours } from '../../docs/js/distractors.js';
import { seededRng } from '../../docs/js/util.js';

function checkNumeric(opts, answer) {
  assert.equal(opts.length, 4, `expected 4 options, got ${opts}`);
  assert.equal(new Set(opts).size, 4, `duplicates in ${opts}`);
  assert.equal(opts.filter((v) => v === answer).length, 1, `answer ${answer} must appear once in ${opts}`);
  assert.ok(opts.every((v) => v > 0), `non-positive option in ${opts}`);
  assert.deepEqual([...opts].sort((a, b) => a - b), opts, 'sorted low to high');
}

test('numeric options always include the answer once and are unique', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rng = seededRng(seed);
    const answer = [1, 2, 4, 12, 35, 52.5, 90, 154][seed % 8];
    const pools = [[answer * 2, answer * 3, answer], [answer, answer + 1, answer * 1.1]];
    checkNumeric(numericOptions(answer, pools, { rng }), answer);
  }
});

test('numeric options prefer other sizes and other pizzas, then neighbours', () => {
  const opts = numericOptions(112, [[35, 70, 154], [84]], { rng: seededRng(7) });
  checkNumeric(opts, 112);
  assert.ok(opts.some((v) => [35, 70, 154].includes(v)), 'one from other sizes');
  assert.ok(opts.includes(84), 'one from the same size on another pizza');
});

test('duplicate pool values never produce duplicate options', () => {
  const opts = numericOptions(10, [[10, 10, 10, 20, 20], [20, 20]], { rng: seededRng(3) });
  checkNumeric(opts, 10);
});

test('works with empty pools and tiny answers', () => {
  checkNumeric(numericOptions(1, [], { rng: seededRng(1) }), 1);
  checkNumeric(numericOptions(1, [[]], { rng: seededRng(2), integer: true }), 1);
  const opts = numericOptions(2, [], { rng: seededRng(4), integer: true });
  assert.ok(opts.every(Number.isInteger));
});

test('counts stay whole numbers, grams can keep halves', () => {
  const counts = numericOptions(16, [[4.5, 12, 20]], { rng: seededRng(9), integer: true });
  checkNumeric(counts, 16);
  assert.ok(counts.every(Number.isInteger));
  checkNumeric(numericOptions(52.5, [[35]], { rng: seededRng(5) }), 52.5);
});

test('neighbours are close to the answer and positive-friendly', () => {
  assert.deepEqual(neighbours(4, { integer: true }).slice(0, 2), [3, 5]);
  const g = neighbours(100, { integer: true });
  assert.ok(g.every((v) => Math.abs(v - 100) <= 36));
});

test('text options include the answer once, unique, case-insensitive', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const opts = textOptions('Bacon', ['bacon', 'Beef', 'Ham', 'Ham', 'Pepperoni', 'Chicken'], {
      rng: seededRng(seed), prefer: ['Beef'],
    });
    assert.equal(opts.length, 4);
    assert.equal(new Set(opts.map((o) => o.toLowerCase())).size, 4);
    assert.equal(opts.filter((o) => o === 'Bacon').length, 1);
    assert.ok(opts.includes('Beef'), 'preferred distractor used');
  }
});

test('text options cope with too few candidates', () => {
  const opts = textOptions('A', ['B'], { rng: seededRng(1) });
  assert.deepEqual([...opts].sort(), ['A', 'B']);
});
