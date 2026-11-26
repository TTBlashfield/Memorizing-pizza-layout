import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  review, isDue, buildSession, weakSpots, requeue, summarize, computeStreak, dayIndex, INTERVALS,
} from '../../docs/js/srs.js';
import { seededRng } from '../../docs/js/util.js';

const TODAY = 20000;

test('intervals are 0 / 1 / 3 / 7 / 14 days for boxes 1–5', () => {
  assert.deepEqual(INTERVALS, { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 });
});

test('a right answer moves the question up one box and schedules it', () => {
  let s = review(undefined, true, TODAY);
  assert.equal(s.box, 2);
  assert.equal(s.due, TODAY + 1);
  s = review(s, true, TODAY + 1);
  assert.equal(s.box, 3);
  assert.equal(s.due, TODAY + 4);
  s = review(s, true, TODAY + 4);
  assert.equal(s.box, 4);
  assert.equal(s.due, TODAY + 11);
  s = review(s, true, TODAY + 11);
  assert.equal(s.box, 5);
  assert.equal(s.due, TODAY + 25);
  s = review(s, true, TODAY + 25);
  assert.equal(s.box, 5, 'box 5 is the top');
  assert.equal(s.due, TODAY + 39);
  assert.equal(s.right, 5);
  assert.equal(s.seen, 5);
});

test('a wrong answer sends it back to box 1, due again today', () => {
  let s = review(undefined, true, TODAY);
  s = review(s, true, TODAY + 1);
  s = review(s, false, TODAY + 4);
  assert.equal(s.box, 1);
  assert.equal(s.due, TODAY + 4);
  assert.equal(s.wrong, 1);
  assert.equal(isDue(s, TODAY + 4), true);
});

test('review does not mutate the previous state', () => {
  const prev = { box: 3, due: TODAY, seen: 2, right: 2, wrong: 0, last: TODAY - 3 };
  review(prev, false, TODAY);
  assert.equal(prev.box, 3);
});

test('isDue', () => {
  assert.equal(isDue(undefined, TODAY), false);
  assert.equal(isDue({ due: TODAY }, TODAY), true);
  assert.equal(isDue({ due: TODAY + 1 }, TODAY), false);
});

const items = (n, prefix = 'k') => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}` }));

test('a session is ~15 items: due first, plus a few new ones', () => {
  const all = items(100);
  const progress = {};
  for (let i = 0; i < 40; i++) progress[`k${i}`] = { box: 2, due: TODAY - (i % 5), seen: 1, right: 1, wrong: 0 };
  const s = buildSession(all, progress, TODAY, { rng: seededRng(1) });
  assert.equal(s.length, 15);
  const fresh = s.filter((it) => !progress[it.key]);
  const due = s.filter((it) => progress[it.key]);
  assert.equal(fresh.length, 3, 'a few new ones');
  assert.equal(due.length, 12);
  assert.equal(new Set(s.map((it) => it.key)).size, 15, 'no repeats');
});

test('most overdue questions are picked first', () => {
  const all = items(30);
  const progress = {};
  for (let i = 0; i < 30; i++) progress[`k${i}`] = { box: 1, due: TODAY - i, seen: 1, right: 0, wrong: 1 };
  const s = buildSession(all, progress, TODAY, { rng: seededRng(2) });
  const keys = new Set(s.map((it) => it.key));
  for (let i = 15; i < 30; i++) assert.ok(keys.has(`k${i}`), `k${i} (overdue by ${i}) should be in`);
});

test('few due: new ones fill the session', () => {
  const all = items(50);
  const progress = { k0: { box: 1, due: TODAY, seen: 1, right: 0, wrong: 1 } };
  const s = buildSession(all, progress, TODAY, { rng: seededRng(3) });
  assert.equal(s.length, 15);
  assert.ok(s.some((it) => it.key === 'k0'));
});

test('nothing due or new: reviews ahead, lowest box first', () => {
  const all = items(20);
  const progress = {};
  for (let i = 0; i < 20; i++) progress[`k${i}`] = { box: i < 5 ? 2 : 5, due: TODAY + 5, seen: 3, right: 3, wrong: 0 };
  const s = buildSession(all, progress, TODAY, { rng: seededRng(4) });
  assert.equal(s.length, 15);
  for (let i = 0; i < 5; i++) assert.ok(s.some((it) => it.key === `k${i}`));
});

test('small pools give short sessions', () => {
  assert.equal(buildSession(items(4), {}, TODAY).length, 4);
  assert.equal(buildSession([], {}, TODAY).length, 0);
});

test('weak spots: most missed first, ignoring ones relearned to box 4+', () => {
  const all = items(5);
  const progress = {
    k0: { box: 1, wrong: 1, right: 0, seen: 1, last: TODAY },
    k1: { box: 1, wrong: 5, right: 1, seen: 6, last: TODAY },
    k2: { box: 2, wrong: 3, right: 2, seen: 5, last: TODAY },
    k3: { box: 4, wrong: 9, right: 9, seen: 18, last: TODAY },
    k4: { box: 3, wrong: 0, right: 3, seen: 3, last: TODAY },
  };
  assert.deepEqual(weakSpots(all, progress).map((it) => it.key), ['k1', 'k2', 'k0']);
});

test('requeue puts a missed question back a few places later', () => {
  const q = ['a', 'b', 'c', 'd', 'e', 'f'];
  assert.deepEqual(requeue(q, 0, 'a2'), ['a', 'b', 'c', 'd', 'a2', 'e', 'f']);
  assert.deepEqual(requeue(q, 4, 'e2'), ['a', 'b', 'c', 'd', 'e', 'f', 'e2']);
  assert.deepEqual(requeue(q, 5, 'f2'), ['a', 'b', 'c', 'd', 'e', 'f', 'f2']);
});

test('summarize counts due and new', () => {
  const all = items(4);
  const progress = { k0: { box: 1, due: TODAY }, k1: { box: 4, due: TODAY + 3 } };
  assert.deepEqual(summarize(all, progress, TODAY), { total: 4, due: 1, fresh: 2, learned: 1 });
});

test('streak counts consecutive active days and survives until midnight', () => {
  const days = { [TODAY - 1]: { answered: 3 }, [TODAY - 2]: { answered: 1 }, [TODAY - 4]: { answered: 9 } };
  assert.equal(computeStreak(days, TODAY), 2, 'not practised yet today: yesterday streak still alive');
  days[TODAY] = { answered: 1 };
  assert.equal(computeStreak(days, TODAY), 3);
  assert.equal(computeStreak({}, TODAY), 0);
  assert.equal(computeStreak({ [TODAY - 2]: { answered: 1 } }, TODAY), 0);
});

test('dayIndex uses local calendar days', () => {
  const a = new Date(2026, 10, 26, 0, 5);
  const b = new Date(2026, 10, 26, 23, 55);
  const c = new Date(2026, 10, 27, 0, 5);
  assert.equal(dayIndex(a), dayIndex(b));
  assert.equal(dayIndex(c), dayIndex(a) + 1);
});
