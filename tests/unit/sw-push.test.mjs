// The push handler must ALWAYS show a notification (Safari revokes permission otherwise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { DOCS } from './helpers.mjs';
import { computeStreak, dayIndex } from '../../docs/js/srs.js';

function loadPush() {
  const sandbox = { URL, Promise, setTimeout, clearTimeout, console, Object, JSON, Date, Math, String, Number, Array };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(DOCS, 'sw-push.js'), 'utf8'), sandbox, { filename: 'sw-push.js' });
  return sandbox.MakelinePush;
}
const P = loadPush();

const NOW = new Date(2026, 10, 26, 13, 17);
const TODAY = dayIndex(NOW);

function mockReg({ failTimes = 0 } = {}) {
  const calls = [];
  let fails = failTimes;
  return {
    calls,
    showNotification(title, options) {
      calls.push({ title, options });
      if (fails > 0) { fails--; return Promise.reject(new Error('boom')); }
      return Promise.resolve();
    },
  };
}

const snapshot = () => ({
  v: 1, hasData: true, day: TODAY, next: 0,
  entries: [
    { key: 'portion:T1:L:2', title: 'Large · Test Feast', body: 'Pepperoni: how many slices? Tap to answer' },
    { key: 'code-topping:X', title: 'Topping code', body: "X: what's this topping? Tap to answer" },
  ],
  dueByDay: { [TODAY]: 12, [TODAY + 1]: 14 },
  activeDays: [TODAY - 5, TODAY - 4, TODAY - 3, TODAY - 2, TODAY - 1],
  sent: [],
});

// iOS 18.4+ declarative + mutable: event.data is null, event.notification is set.
const declarativeEvent = (type) => ({ data: null, notification: { title: 'Makeline', data: { type } } });
// Older iOS / other browsers: the JSON arrives as plain push data.
const plainEvent = (obj) => ({ data: { json: () => obj } });

test('shows the next queued question with tag "quiz" and a deep link, then advances the queue', async () => {
  const reg = mockReg();
  let written = null;
  let badge = null;
  await P.handlePush(declarativeEvent('quiz'), {
    registration: reg, now: () => NOW,
    readSnapshot: async () => snapshot(),
    writeSnapshot: async (s) => { written = s; },
    setBadge: async (n) => { badge = n; },
  });
  assert.equal(reg.calls.length, 1);
  assert.equal(reg.calls[0].title, 'Large · Test Feast');
  assert.equal(reg.calls[0].options.body, 'Pepperoni: how many slices? Tap to answer');
  assert.equal(reg.calls[0].options.tag, 'quiz');
  assert.equal(reg.calls[0].options.data.url, './#/q/portion%3AT1%3AL%3A2');
  assert.equal(written.next, 1);
  assert.equal(written.sent[0].key, 'portion:T1:L:2');
  assert.equal(badge, 12);
});

test('also works with the plain (non-declarative) payload', async () => {
  const reg = mockReg();
  const payload = { web_push: 8030, notification: { title: 'Makeline', body: 'x', navigate: 'https://a/', data: { type: 'quiz' } }, mutable: true };
  await P.handlePush(plainEvent(payload), { registration: reg, now: () => NOW, readSnapshot: async () => snapshot() });
  assert.equal(reg.calls.length, 1);
  assert.equal(reg.calls[0].options.data.key, 'portion:T1:L:2');
});

test('summary: due count and streak', async () => {
  const reg = mockReg();
  await P.handlePush(declarativeEvent('summary'), { registration: reg, now: () => NOW, readSnapshot: async () => snapshot() });
  assert.equal(reg.calls.length, 1);
  assert.equal(reg.calls[0].options.tag, 'summary');
  assert.equal(reg.calls[0].options.data.url, './#/quiz/due');
  assert.match(reg.calls[0].options.body, /^12 due today · 🔥 5-day streak\. \d+ minutes?\?$/);
});

test('empty queue still shows a notification', async () => {
  const reg = mockReg();
  const s = snapshot();
  s.entries = [];
  await P.handlePush(declarativeEvent('quiz'), { registration: reg, now: () => NOW, readSnapshot: async () => s });
  assert.equal(reg.calls.length, 1);
  assert.equal(reg.calls[0].options.body, P.FALLBACK.body);
});

test('missing data shows "Open Makeline to load your builds"', async () => {
  for (const readSnapshot of [async () => null, async () => ({ hasData: false }), async () => { throw new Error('no idb'); }]) {
    const reg = mockReg();
    await P.handlePush(declarativeEvent('quiz'), { registration: reg, now: () => NOW, readSnapshot });
    assert.equal(reg.calls.length, 1);
    assert.equal(reg.calls[0].options.body, P.NO_DATA.body);
  }
});

test('no snapshot reader, garbage payload, broken entries: still shows one', async () => {
  const cases = [
    { event: { data: { json: () => { throw new Error('not json'); } } }, deps: {} },
    { event: undefined, deps: {} },
    { event: plainEvent({}), deps: { readSnapshot: async () => ({ hasData: true, entries: [{ key: '', title: '' }] }) } },
    { event: plainEvent({}), deps: { readSnapshot: async () => ({ hasData: true, entries: 'nope' }) } },
  ];
  for (const c of cases) {
    const reg = mockReg();
    await P.handlePush(c.event, { registration: reg, now: () => NOW, ...c.deps });
    assert.equal(reg.calls.length, 1, JSON.stringify(c.deps));
  }
});

test('a snapshot read that hangs times out and still shows a notification', async () => {
  const reg = mockReg();
  await P.handlePush(declarativeEvent('quiz'), { registration: reg, now: () => NOW, readSnapshot: () => new Promise(() => {}) });
  assert.equal(reg.calls.length, 1);
});

test('if showing the question throws, the fallback is shown', async () => {
  const reg = mockReg({ failTimes: 1 });
  await P.handlePush(declarativeEvent('quiz'), { registration: reg, now: () => NOW, readSnapshot: async () => snapshot() });
  assert.equal(reg.calls.length, 2);
  assert.equal(reg.calls[1].options.body, P.FALLBACK.body);
});

test('badge or snapshot write failures do not cause a second notification', async () => {
  const reg = mockReg();
  await P.handlePush(declarativeEvent('quiz'), {
    registration: reg, now: () => NOW, readSnapshot: async () => snapshot(),
    writeSnapshot: async () => { throw new Error('quota'); },
    setBadge: async () => { throw new Error('no badge'); },
  });
  assert.equal(reg.calls.length, 1);
});

test('the queue wraps around instead of going silent', () => {
  const s = snapshot();
  s.next = 2;
  assert.equal(P.nextQuiz(s, TODAY).n.key, 'portion:T1:L:2');
});

test('streak logic matches the app', () => {
  const days = [TODAY - 3, TODAY - 2, TODAY - 1];
  const asObj = Object.fromEntries(days.map((d) => [d, { answered: 1 }]));
  assert.equal(P.streakFrom(days, TODAY), computeStreak(asObj, TODAY));
  assert.equal(P.streakFrom([...days, TODAY], TODAY), computeStreak({ ...asObj, [TODAY]: { answered: 1 } }, TODAY));
  assert.equal(P.streakFrom([], TODAY), 0);
  assert.equal(P.dayIndex(NOW), TODAY);
});

test('notification click focuses an open window and sends it to the question', async () => {
  const scope = 'https://example.github.io/app/';
  const posted = [];
  let opened = null;
  let focused = false;
  const win = { url: scope + '#/', focus: async () => { focused = true; return win; }, postMessage: (m) => posted.push(m) };
  const event = { notification: { data: { url: './#/q/stage%3AT1%3A5' }, close() {} } };
  await P.handleNotificationClick(event, { scope, clients: { matchAll: async () => [win], openWindow: async (u) => { opened = u; } } });
  assert.equal(focused, true);
  assert.equal(opened, null);
  assert.deepEqual(JSON.parse(JSON.stringify(posted)), [{ type: 'OPEN_URL', url: scope + '#/q/stage%3AT1%3A5' }]);
});

test('notification click opens the app at the deep link when it is closed', async () => {
  const scope = 'https://example.github.io/app/';
  let opened = null;
  const event = { notification: { data: { url: './#/q/general%3A0' }, close() {} } };
  await P.handleNotificationClick(event, { scope, clients: { matchAll: async () => [], openWindow: async (u) => { opened = u; } } });
  assert.equal(opened, scope + '#/q/general%3A0');
});
