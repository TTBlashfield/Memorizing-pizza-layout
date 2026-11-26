// App state kept in memory and saved to IndexedDB on this device.
// Builds, progress, stats, settings and the push subscription never leave the phone
// (unless you copy the subscription or export your progress yourself).
import { kvGetMany, kvSet, kvDel, requestPersistence } from './db.js';
import { review, dayIndex } from './srs.js';
import { isObj } from './util.js';

export const PROGRESS_SCHEMA = 'makeline-progress/v1';
const KEYS = ['builds', 'progress', 'stats', 'settings', 'push'];

const mem = { builds: null, progress: {}, stats: { days: {} }, settings: {}, push: null };
let onError = (e) => console.error(e);
const writing = new Map(); // key -> { busy, again }

export function setErrorHandler(fn) { onError = fn; }

export async function initStore() {
  const v = await kvGetMany(KEYS);
  mem.builds = v.builds || null;
  mem.progress = isObj(v.progress) ? v.progress : {};
  mem.stats = isObj(v.stats) && isObj(v.stats.days) ? v.stats : { days: {} };
  mem.settings = isObj(v.settings) ? v.settings : {};
  mem.push = isObj(v.push) ? v.push : null;
}

/** Save one key. Rapid calls are merged: at most one write in flight, then one more. */
function persist(key) {
  const w = writing.get(key) || { busy: null, again: false };
  writing.set(key, w);
  if (w.busy) { w.again = true; return w.busy; }
  const go = () => kvSet(key, mem[key]).catch((e) => onError(e)).then(() => {
    if (w.again) { w.again = false; w.busy = go(); return w.busy; }
    w.busy = null;
    return undefined;
  });
  w.busy = go();
  return w.busy;
}

export const getBuilds = () => mem.builds;
export const getData = () => (mem.builds ? mem.builds.data : null);

export async function setBuilds(data, { warnings = [], fileName = '' } = {}) {
  mem.builds = { data, loadedAt: Date.now(), warnings, fileName };
  await kvSet('builds', mem.builds);
  requestPersistence();
}

export async function clearBuilds() {
  mem.builds = null;
  await kvDel('builds');
}

export const getProgress = () => mem.progress;
export const getStats = () => mem.stats;

/** Record one answer. `count: false` updates the schedule without counting towards today's stats. */
export function recordAnswer(key, correct, { count = true, now = new Date() } = {}) {
  const today = dayIndex(now);
  mem.progress[key] = review(mem.progress[key], correct, today);
  persist('progress');
  if (count) {
    const d = mem.stats.days[today] || { answered: 0, correct: 0 };
    d.answered += 1;
    if (correct) d.correct += 1;
    mem.stats.days[today] = d;
    for (const k of Object.keys(mem.stats.days)) if (Number(k) < today - 400) delete mem.stats.days[k];
    persist('stats');
  }
  return mem.progress[key];
}

export const getSettings = () => mem.settings;
export function updateSettings(patch) {
  mem.settings = { ...mem.settings, ...patch };
  return persist('settings');
}

export const getPush = () => mem.push;
export function setPush(value) {
  mem.push = value;
  return value ? persist('push') : kvDel('push').catch(onError);
}

export function exportProgress(appVersion = '') {
  return {
    schema: PROGRESS_SCHEMA,
    exportedAt: new Date().toISOString(),
    appVersion,
    progress: mem.progress,
    stats: mem.stats,
    settings: { ranges: mem.settings.ranges, sizes: mem.settings.sizes },
  };
}

/** Replace progress with an exported backup. Returns the number of questions restored. */
export async function importProgress(obj) {
  if (!isObj(obj) || obj.schema !== PROGRESS_SCHEMA) {
    throw new Error(`That isn't a Makeline progress backup (expected "${PROGRESS_SCHEMA}").`);
  }
  if (!isObj(obj.progress)) throw new Error('The backup has no progress in it.');
  const progress = {};
  for (const [k, s] of Object.entries(obj.progress)) {
    if (isObj(s) && typeof s.box === 'number' && typeof s.due === 'number') {
      progress[k] = {
        box: Math.min(5, Math.max(1, Math.round(s.box))), due: s.due,
        seen: s.seen | 0, right: s.right | 0, wrong: s.wrong | 0, last: typeof s.last === 'number' ? s.last : null,
      };
    }
  }
  mem.progress = progress;
  mem.stats = isObj(obj.stats) && isObj(obj.stats.days) ? obj.stats : { days: {} };
  if (isObj(obj.settings)) {
    mem.settings = { ...mem.settings, ...(obj.settings.ranges ? { ranges: obj.settings.ranges } : {}), ...(obj.settings.sizes ? { sizes: obj.settings.sizes } : {}) };
  }
  await Promise.all([kvSet('progress', mem.progress), kvSet('stats', mem.stats), kvSet('settings', mem.settings)]);
  return Object.keys(progress).length;
}

export async function resetProgress() {
  mem.progress = {};
  mem.stats = { days: {} };
  await Promise.all([kvSet('progress', mem.progress), kvSet('stats', mem.stats)]);
}

/** Wait for pending writes (used before reloads). */
export async function flush() {
  await Promise.all([...writing.values()].map((w) => w.busy).filter(Boolean));
}
