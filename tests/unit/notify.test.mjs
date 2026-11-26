import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuilds } from '../../docs/js/data.js';
import { buildItems, effectiveFilters } from '../../docs/js/questions.js';
import { buildNotifyQueue, buildSnapshot, dueByDay, notificationText } from '../../docs/js/notify.js';
import { makeQuestion } from '../../docs/js/questions.js';
import { dayIndex } from '../../docs/js/srs.js';
import { seededRng } from '../../docs/js/util.js';
import { fixture } from './helpers.mjs';

const data = validateBuilds(fixture()).data;
const ALL = effectiveFilters(data, {});
const NOW = new Date(2026, 10, 26, 9, 0);
const TODAY = dayIndex(NOW);

test('the queue respects range and size filters', () => {
  const filters = { ranges: ['Classics'], sizes: ['M', 'L'] };
  const items = buildItems(data, filters);
  const allowed = new Set(items.map((i) => i.key));
  const queue = buildNotifyQueue(items, {}, TODAY, { rng: seededRng(1) });
  assert.equal(queue.length, 30);
  for (const it of queue) {
    assert.ok(allowed.has(it.key));
    if (it.pizzaId) assert.equal(it.pizzaId, 'T1');
    if (it.size) assert.ok(['M', 'L'].includes(it.size), it.key);
  }
});

test('the queue favours due and often-missed questions', () => {
  const items = buildItems(data, ALL);
  const progress = {};
  const dueWeak = items.slice(0, 3).map((i) => i.key);
  const dueOnly = items.slice(10, 14).map((i) => i.key);
  const weakOnly = items.slice(20, 22).map((i) => i.key);
  for (const k of dueWeak) progress[k] = { box: 1, due: TODAY, wrong: 3, right: 0, seen: 3 };
  for (const k of dueOnly) progress[k] = { box: 3, due: TODAY - 1, wrong: 0, right: 2, seen: 2 };
  for (const k of weakOnly) progress[k] = { box: 2, due: TODAY + 1, wrong: 2, right: 1, seen: 3 };
  // Plenty of learned, not-due ones that should come last.
  for (const it of items.slice(30, 60)) progress[it.key] = { box: 5, due: TODAY + 10, wrong: 0, right: 5, seen: 5 };

  const queue = buildNotifyQueue(items, progress, TODAY, { rng: seededRng(7) });
  const firstNine = new Set(queue.slice(0, 9).map((i) => i.key));
  for (const k of [...dueWeak, ...dueOnly, ...weakOnly]) assert.ok(firstNine.has(k), `${k} should be near the front`);
  const first3 = queue.slice(0, 3).map((i) => i.key);
  assert.ok(first3.filter((k) => dueWeak.includes(k)).length >= 2, 'due + missed comes first');
  const learnedPositions = queue.map((it, i) => (progress[it.key] && progress[it.key].box === 5 ? i : -1)).filter((i) => i >= 0);
  assert.ok(learnedPositions.every((i) => i >= 9));
});

test('the queue mixes question types', () => {
  const items = buildItems(data, ALL);
  const queue = buildNotifyQueue(items, {}, TODAY, { rng: seededRng(3) });
  const modes = queue.slice(0, 6).map((i) => i.mode);
  assert.ok(new Set(modes).size >= 3, `modes: ${modes}`);
  for (let i = 2; i < queue.length; i++) {
    const [a, b, c] = [queue[i - 2].mode, queue[i - 1].mode, queue[i].mode];
    if (a === b && b === c) {
      // Only allowed once the other types have run out.
      const rest = queue.slice(i).map((x) => x.mode);
      assert.ok(rest.every((m) => m === c));
    }
  }
});

test('recently sent questions go to the back', () => {
  const items = buildItems(data, ALL);
  const progress = {};
  for (const it of items.slice(0, 5)) progress[it.key] = { box: 1, due: TODAY, wrong: 1, right: 0, seen: 1 };
  const recent = new Set([items[0].key]);
  const queue = buildNotifyQueue(items, progress, TODAY, { rng: seededRng(2), recent });
  assert.ok(queue.findIndex((i) => i.key === items[0].key) === -1 || queue.findIndex((i) => i.key === items[0].key) > 4);
});

test('notification text comes from the file and looks like the spec', () => {
  const it = { key: 'portion:T1:L:2', kind: 'portion', pizzaId: 'T1', size: 'L', layerIndex: 2, mode: 'portions' };
  const t = notificationText(it, makeQuestion(it, data, { format: 'mc' }), data);
  assert.equal(t.title, 'Large · Test Feast Supreme Deluxe');
  assert.equal(t.body, 'Pepperoni: how many slices? Tap to answer');
  const code = { key: 'code-topping:Zz', kind: 'code-topping', code: 'Zz', mode: 'codes' };
  assert.equal(notificationText(code, makeQuestion(code, data, { format: 'mc' }), data).body, "Zz: what's this topping? Tap to answer");
});

test('due counts for the coming days', () => {
  const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
  const progress = { a: { due: TODAY - 3 }, b: { due: TODAY }, c: { due: TODAY + 2 } };
  const m = dueByDay(items, progress, TODAY, 4);
  assert.deepEqual(m, { [TODAY]: 2, [TODAY + 1]: 2, [TODAY + 2]: 3, [TODAY + 3]: 3 });
});

test('the snapshot holds ~30 entries with keys, titles and bodies, and no data → hasData false', () => {
  const items = buildItems(data, ALL);
  const snap = buildSnapshot({ data, items, progress: {}, statsDays: { [TODAY - 1]: { answered: 3 } }, now: NOW, rng: seededRng(1) });
  assert.equal(snap.hasData, true);
  assert.equal(snap.entries.length, 30);
  assert.equal(snap.next, 0);
  for (const e of snap.entries) {
    assert.ok(e.key && e.title && e.body);
    assert.ok(items.some((i) => i.key === e.key));
  }
  assert.deepEqual(snap.activeDays, [TODAY - 1]);
  assert.equal(typeof snap.dueByDay[TODAY], 'number');

  const empty = buildSnapshot({ data: null, now: NOW });
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.entries, []);
});

test('notifications never give the answer away', () => {
  const items = buildItems(data, ALL);
  for (const [n, it] of items.entries()) {
    const q = makeQuestion(it, data, { format: 'mc', rng: seededRng(n + 1) });
    if (!q || q.kind !== 'mc') continue;
    const { title, body } = notificationText(it, q, data);
    const text = `${title} ${body}`;
    if (it.kind === 'code-pizza') assert.ok(!text.includes(data.pizzas.find((p) => p.id === it.pizzaId).name), `${it.key}: ${text}`);
    if (it.kind === 'code-topping') assert.ok(!text.includes(data.toppingCodes[it.code]), `${it.key}: ${text}`);
    if (it.kind === 'code-topping-rev' || it.kind === 'code-pizza-rev') assert.ok(!new RegExp(`\\b${q.answer}\\b`).test(title), `${it.key}: ${text}`);
    if (it.kind === 'portion') assert.ok(!text.includes(q.answer), `${it.key}: ${text}`);
  }
});
