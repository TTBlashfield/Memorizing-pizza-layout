// Notification questions, worked out on the phone. Pure: no DOM, no storage.
//
// The push message from the server carries no build data at all. Instead, whenever the app
// is open it precomputes a "snapshot": the next ~30 notification questions (title, body, key),
// the due count for the coming days and recent active days. The service worker reads the
// snapshot when a push arrives (see sw-push.js).
import { shortSizeName } from './data.js';
import { makeQuestion, pizzaById } from './questions.js';
import { dayIndex } from './srs.js';
import { shuffle } from './util.js';

export const NOTIFY_QUEUE_SIZE = 30;
export const SNAPSHOT_VERSION = 1;

/**
 * Pick the questions for upcoming notifications.
 * Priority: due AND often missed > due > missed > new > the rest. Within that, question
 * types are mixed so you don't get five portions in a row.
 * `recent` = keys already sent as notifications lately; they go to the back.
 */
export function buildNotifyQueue(items, progress, today, { size = NOTIFY_QUEUE_SIZE, rng = Math.random, recent = new Set() } = {}) {
  const tierOf = (it) => {
    const s = progress[it.key];
    if (!s) return 3;
    const due = s.due <= today;
    const weak = s.wrong > 0 && s.box < 4;
    if (due && weak) return 0;
    if (due) return 1;
    if (weak) return 2;
    return 4;
  };
  const scored = shuffle(items, rng).map((it) => {
    const s = progress[it.key];
    return {
      it,
      tier: tierOf(it) + (recent.has(it.key) ? 10 : 0),
      // More misses first; then most overdue / soonest due.
      wrong: s ? s.wrong : 0,
      due: s ? s.due : today,
    };
  });
  scored.sort((a, b) => (a.tier - b.tier) || (b.wrong - a.wrong) || (a.due - b.due));

  // Mix types: one queue per mode (each already in priority order). Always take from the best
  // tier available; among modes tied on tier, take the one used least recently (round robin).
  const queues = new Map();
  for (const s of scored) {
    if (!queues.has(s.it.mode)) queues.set(s.it.mode, []);
    queues.get(s.it.mode).push(s);
  }
  const lastUsed = new Map([...queues.keys()].map((m) => [m, -1]));
  const out = [];
  while (out.length < size) {
    let best = null;
    for (const [mode, q] of queues) {
      if (!q.length) continue;
      const head = q[0];
      if (!best
        || head.tier < best.head.tier
        || (head.tier === best.head.tier && lastUsed.get(mode) < lastUsed.get(best.mode))) {
        best = { mode, head };
      }
    }
    if (!best) break;
    queues.get(best.mode).shift();
    lastUsed.set(best.mode, out.length);
    out.push(best.head.it);
  }
  return out;
}

const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const TAP = 'Tap to answer';

/** Title and body for a notification, built from a question (which is built from the file). */
export function notificationText(item, question, data) {
  const pizza = item.pizzaId ? pizzaById(data, item.pizzaId) : null;
  const sizeName = item.size ? shortSizeName(data, item.size) : null;
  const pizzaTitle = pizza ? (sizeName ? `${sizeName} · ${pizza.name}` : pizza.name) : null;
  const q = question;
  switch (q.kind) {
    case 'flash':
      return { title: `${pizzaTitle} (${pizza.code})`, body: 'Can you remember the whole build? Tap to check' };
    case 'build':
      return { title: `${pizzaTitle} (${pizza.code})`, body: 'Build it: tap the toppings in order. Tap to start' };
    case 'mc': {
      const title = pizzaTitle || (q.context && q.context.label) || 'Makeline';
      if (q.subject && q.subject.big && q.subject.code) {
        return { title, body: `${q.subject.code}: ${lowerFirst(q.ask)} ${TAP}` };
      }
      const name = q.subject ? (q.subject.name || q.subject.code) : null;
      return { title, body: name ? `${name}: ${lowerFirst(q.ask)} ${TAP}` : `${q.ask} ${TAP}` };
    }
    case 'flip':
      return { title: pizzaTitle || (q.context && q.context.label) || 'Makeline', body: `${q.front} ${TAP}` };
    case 'multi':
      return { title: (q.context && q.context.label) || 'Makeline', body: `${q.prompt} ${TAP}` };
    default:
      return { title: 'Makeline', body: `Quiz time. ${TAP}` };
  }
}

/** How many questions will be due on each of the next `days` days (no new ones counted). */
export function dueByDay(items, progress, today, days = 21) {
  const counts = new Array(days).fill(0);
  for (const it of items) {
    const s = progress[it.key];
    if (!s) continue;
    const offset = Math.max(0, s.due - today);
    if (offset < days) counts[offset]++;
  }
  const out = {};
  let running = 0;
  for (let i = 0; i < days; i++) {
    running += counts[i];
    out[today + i] = running;
  }
  return out;
}

/**
 * Everything the service worker needs to show a notification without the app open.
 * `previous` is the last snapshot (to carry over what was already sent).
 */
export function buildSnapshot({ data, items, progress, statsDays, now = new Date(), rng = Math.random, previous = null, appVersion = '' }) {
  const today = dayIndex(now);
  if (!data) {
    return { v: SNAPSHOT_VERSION, createdAt: now.getTime(), day: today, hasData: false, entries: [], next: 0, dueByDay: {}, activeDays: [], sent: [] };
  }
  const sent = (previous && Array.isArray(previous.sent) ? previous.sent : []).filter((s) => s && s.day >= today - 2).slice(-30);
  const recent = new Set(sent.map((s) => s.key));
  const entries = [];
  for (const it of buildNotifyQueue(items, progress, today, { rng, recent })) {
    const q = makeQuestion(it, data, { rng });
    if (!q) continue;
    const { title, body } = notificationText(it, q, data);
    entries.push({ key: it.key, title, body });
  }
  const activeDays = Object.entries(statsDays || {})
    .filter(([, v]) => v && v.answered > 0)
    .map(([d]) => Number(d))
    .filter((d) => d > today - 400)
    .sort((a, b) => a - b);
  return {
    v: SNAPSHOT_VERSION,
    createdAt: now.getTime(),
    appVersion,
    day: today,
    hasData: true,
    entries,
    next: 0,
    dueByDay: dueByDay(items, progress, today),
    activeDays,
    sent,
  };
}
