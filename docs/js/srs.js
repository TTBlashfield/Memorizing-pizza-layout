// Leitner-box spaced repetition. Pure: works on plain objects, the caller saves them.
//
// Each question key has a state { box, due, seen, right, wrong, last }.
// `due` and `last` are local day numbers (see dayIndex), so "due tomorrow" means
// any time tomorrow, not exactly 24 hours later.
import { shuffle } from './util.js';

export const MIN_BOX = 1;
export const MAX_BOX = 5;
/** Days until a question in each box comes back. */
export const INTERVALS = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 14 };
export const SESSION_SIZE = 15;

/** Local calendar day number (days since 1970-01-01 in the device's time zone). */
export function dayIndex(date = new Date()) {
  return Math.floor((date.getTime() - date.getTimezoneOffset() * 60000) / 86400000);
}

/** Apply one answer. Right: up a box. Wrong: back to box 1, due today. */
export function review(prev, correct, today) {
  const s = prev
    ? { ...prev }
    : { box: MIN_BOX, due: today, seen: 0, right: 0, wrong: 0, last: null };
  s.seen += 1;
  s.last = today;
  if (correct) {
    s.right += 1;
    s.box = Math.min(MAX_BOX, s.box + 1);
  } else {
    s.wrong += 1;
    s.box = MIN_BOX;
  }
  s.due = today + INTERVALS[s.box];
  return s;
}

export function isDue(state, today) {
  return !!state && state.due <= today;
}

/**
 * Pick about `size` items: due ones first (most overdue, lowest box), plus a few new ones.
 * When few are due, more new ones fill the gap; when nothing is due or new, it reviews ahead.
 */
export function buildSession(items, progress, today, { size = SESSION_SIZE, minNew = 3, rng = Math.random } = {}) {
  const due = [];
  const fresh = [];
  const ahead = [];
  for (const it of items) {
    const s = progress[it.key];
    if (!s) fresh.push(it);
    else if (s.due <= today) due.push(it);
    else ahead.push(it);
  }
  const st = (it) => progress[it.key];
  const dueSorted = shuffle(due, rng).sort((a, b) => (st(a).due - st(b).due) || (st(a).box - st(b).box));
  const newCount = Math.min(fresh.length, Math.max(minNew, size - due.length));
  const dueCount = Math.min(dueSorted.length, size - newCount);
  const picked = [...dueSorted.slice(0, dueCount), ...shuffle(fresh, rng).slice(0, newCount)];
  if (picked.length < size) {
    const aheadSorted = shuffle(ahead, rng).sort((a, b) => (st(a).box - st(b).box) || (st(a).due - st(b).due));
    picked.push(...aheadSorted.slice(0, size - picked.length));
  }
  return shuffle(picked, rng);
}

/**
 * The questions you miss most: missed at least once and not yet back up to box 4.
 * Most misses first, then lowest box, then most recently seen.
 */
export function weakSpots(items, progress, { limit = SESSION_SIZE } = {}) {
  return items
    .filter((it) => {
      const s = progress[it.key];
      return s && s.wrong > 0 && s.box < 4;
    })
    .sort((a, b) => {
      const sa = progress[a.key];
      const sb = progress[b.key];
      return (sb.wrong - sa.wrong) || (sa.box - sb.box) || ((sb.last ?? 0) - (sa.last ?? 0));
    })
    .slice(0, limit);
}

/** Put a missed question back into the queue a few places later (or at the end). */
export function requeue(queue, currentPos, entry, gap = 3) {
  const at = Math.min(queue.length, currentPos + 1 + gap);
  const q = [...queue];
  q.splice(at, 0, entry);
  return q;
}

/** Counts for the home screen. */
export function summarize(items, progress, today) {
  let due = 0;
  let fresh = 0;
  let learned = 0;
  for (const it of items) {
    const s = progress[it.key];
    if (!s) fresh++;
    else {
      if (s.due <= today) due++;
      if (s.box >= 4) learned++;
    }
  }
  return { total: items.length, due, fresh, learned };
}

/**
 * Days in a row with at least one answer. Today counts if you've practised;
 * if not, the streak from yesterday is still alive until midnight.
 */
export function computeStreak(days, today) {
  const active = (d) => !!days[d] && days[d].answered > 0;
  let d = active(today) ? today : today - 1;
  let n = 0;
  while (active(d)) { n++; d--; }
  return n;
}
