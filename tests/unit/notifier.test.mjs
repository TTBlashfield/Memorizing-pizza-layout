import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDueSlot, parseSchedule, zonedParts, describeSchedule } from '../../notifier/schedule.mjs';
import { buildPayload, pagesUrl, DECLARATIVE_MAGIC } from '../../notifier/payload.mjs';
import { parseSecret, loadSchedule, publicKeyFor } from '../../notifier/send.mjs';
import { ROOT, fixtureText } from './helpers.mjs';

const schedule = parseSchedule({ timeZone: 'Europe/London', quiz: ['10:00', '13:00', '16:00', '19:00'], summary: '21:00' });
const at = (iso) => findDueSlot(new Date(iso), schedule);

test('the shipped default schedule is valid', () => {
  const s = parseSchedule(JSON.parse(readFileSync(join(ROOT, 'notifier', 'default-schedule.json'), 'utf8')));
  assert.equal(describeSchedule(s), 'Quiz at 10:00, 13:00, 16:00, 19:00 · Summary at 21:00 (Europe/London)');
});

test('winter (GMT): UK time equals UTC', () => {
  assert.equal(at('2026-01-15T10:17:00Z').type, 'quiz');
  assert.equal(at('2026-01-15T21:17:00Z').type, 'summary');
  assert.equal(at('2026-01-15T09:17:00Z'), null);
  assert.equal(at('2026-01-15T11:17:00Z'), null);
});

test('summer (BST): UK time is UTC+1', () => {
  assert.equal(at('2026-07-01T09:17:00Z').type, 'quiz', '09:17 UTC is 10:17 BST');
  assert.equal(at('2026-07-01T10:17:00Z'), null, '10:17 UTC is 11:17 BST');
  assert.equal(at('2026-07-01T20:17:00Z').type, 'summary', '20:17 UTC is 21:17 BST');
  assert.equal(at('2026-07-01T21:17:00Z'), null);
});

test('clocks go forward (Sun 29 March 2026, 01:00 UTC)', () => {
  // Saturday, still GMT.
  assert.equal(at('2026-03-28T10:17:00Z').time, '10:00');
  assert.equal(at('2026-03-28T09:17:00Z'), null);
  // Sunday, now BST.
  assert.equal(zonedParts(new Date('2026-03-29T00:30:00Z')).hour, 0);
  assert.equal(zonedParts(new Date('2026-03-29T01:30:00Z')).hour, 2);
  assert.equal(at('2026-03-29T09:17:00Z').time, '10:00');
  assert.equal(at('2026-03-29T10:17:00Z'), null);
  assert.equal(at('2026-03-29T20:17:00Z').type, 'summary');
});

test('clocks go back (Sun 25 October 2026, 01:00 UTC)', () => {
  // Saturday, still BST.
  assert.equal(at('2026-10-24T09:17:00Z').time, '10:00');
  assert.equal(at('2026-10-24T20:17:00Z').type, 'summary');
  // Sunday, now GMT.
  assert.equal(at('2026-10-25T09:17:00Z'), null);
  assert.equal(at('2026-10-25T10:17:00Z').time, '10:00');
  assert.equal(at('2026-10-25T21:17:00Z').type, 'summary');
});

test('the repeated 01:00 hour when clocks go back gets the same key (so it is only sent once)', () => {
  const s = parseSchedule({ quiz: ['01:00'] });
  const first = findDueSlot(new Date('2026-10-25T00:17:00Z'), s); // 01:17 BST
  const second = findDueSlot(new Date('2026-10-25T01:17:00Z'), s); // 01:17 GMT
  assert.ok(first && second);
  assert.equal(first.key, second.key);
});

test('slot keys differ by day and slot', () => {
  assert.notEqual(at('2026-01-15T10:17:00Z').key, at('2026-01-16T10:17:00Z').key);
  assert.notEqual(at('2026-01-15T10:17:00Z').key, at('2026-01-15T13:17:00Z').key);
  assert.match(at('2026-01-15T10:17:00Z').key, /^notify-2026-01-15T10-quiz$/);
});

test('a late run is still matched within the same UK hour', () => {
  assert.equal(at('2026-01-15T10:58:00Z').time, '10:00');
});

test('bad schedules give readable errors', () => {
  assert.throws(() => parseSchedule({ quiz: ['10am'] }), /isn't a time/);
  assert.throws(() => parseSchedule({ quiz: ['10:00', '10:30'] }), /same|two notifications/);
  assert.throws(() => parseSchedule({ timeZone: 'Mars/Base', quiz: [] }), /unknown timeZone/);
});

test('payload is Declarative Web Push with mutable alongside notification', () => {
  const p = buildPayload('quiz', 'https://someone.github.io/makeline/');
  assert.equal(p.web_push, DECLARATIVE_MAGIC);
  assert.equal(p.web_push, 8030);
  assert.equal(p.mutable, true);
  assert.ok(!('mutable' in p.notification), 'mutable must not be inside notification');
  assert.deepEqual(Object.keys(p).sort(), ['mutable', 'notification', 'web_push']);
  assert.equal(typeof p.notification.title, 'string');
  assert.equal(p.notification.navigate, 'https://someone.github.io/makeline/#/quiz/due', 'navigate is absolute');
  assert.equal(p.notification.tag, 'quiz');
  assert.deepEqual(p.notification.data, { type: 'quiz' });
  assert.equal(p.notification.body, '🍕 Quiz time, tap to practise');
  assert.equal(buildPayload('summary', 'https://a.github.io/b/').notification.data.type, 'summary');
});

test('payload carries no build data', () => {
  const text = JSON.stringify([buildPayload('quiz', 'https://a.github.io/b/'), buildPayload('summary', 'https://a.github.io/b/')]);
  const fixture = JSON.parse(fixtureText());
  const words = new Set();
  for (const p of fixture.pizzas) {
    words.add(p.name);
    for (const l of p.layers) words.add(l.name);
  }
  for (const n of Object.values(fixture.toppingCodes)) words.add(n);
  for (const w of words) assert.ok(!text.includes(w), `payload mentions "${w}"`);
  assert.ok(text.length < 600, 'tiny payload');
});

test('payload refuses non-https app URLs', () => {
  assert.throws(() => buildPayload('quiz', 'http://example.com/'), /https/);
});

test('pages URL from the repo name', () => {
  assert.equal(pagesUrl('TTBlashfield/MyRepo'), 'https://ttblashfield.github.io/MyRepo/');
  assert.equal(pagesUrl('Someone/someone.github.io'), 'https://someone.github.io/');
});

const SUB = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'BPx', auth: 'au' } };

test('PUSH_SUBSCRIPTION: what the app copies (subscription + times) is read correctly', () => {
  const text = JSON.stringify({ subscription: SUB, schedule: { timeZone: 'Europe/London', quiz: ['08:00', '12:00'], summary: null } });
  const { subscription, schedule } = parseSecret(text);
  assert.equal(subscription.endpoint, SUB.endpoint);
  const loaded = loadSchedule(text);
  assert.match(loaded.source, /app/);
  assert.equal(describeSchedule(loaded.schedule), 'Quiz at 08:00, 12:00 (Europe/London)');
  assert.equal(findDueSlot(new Date('2026-07-01T07:17:00Z'), loaded.schedule).time, '08:00', '07:17 UTC is 08:17 BST');
});

test('PUSH_SUBSCRIPTION: a bare subscription uses the default times', () => {
  const loaded = loadSchedule(JSON.stringify(SUB));
  assert.match(loaded.source, /default/);
  assert.equal(loaded.schedule.slots.length, 5);
  assert.equal(parseSecret(JSON.stringify(SUB)).schedule, null);
});

test('PUSH_SUBSCRIPTION: missing or broken gives clear errors, schedule falls back to default', () => {
  assert.throws(() => parseSecret('nope'), /isn't valid JSON/);
  assert.throws(() => parseSecret('{"subscription":{}}'), /endpoint/);
  assert.match(loadSchedule('').source, /default/);
  assert.match(loadSchedule('garbage').source, /default/);
});

test('the VAPID public key in the app matches its private key format', () => {
  // A throwaway key pair, to prove the derivation used to catch a wrong VAPID_PRIVATE_KEY works.
  const priv = Buffer.alloc(32, 7).toString('base64url');
  const pub = publicKeyFor(priv);
  assert.equal(Buffer.from(pub, 'base64url').length, 65);
});
