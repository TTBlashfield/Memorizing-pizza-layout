// Settings → Notifications: status checklist, your times, turn on/off, copy the push
// subscription (which carries your times to GitHub), and send a test.
//
// iOS rules: web push only works in the Home Screen app (iOS 16.4+), and the permission
// prompt must come straight from a tap inside the installed app.
import { VAPID_PUBLIC_KEY, DEFAULT_SCHEDULE } from '../config.js';
import { kvGet, SNAPSHOT_KEY } from '../db.js';
import { getPush, setPush, getSettings, updateSettings } from '../store.js';
import * as state from '../state.js';
import { el, clear, toast, isStandalone, isIOS, installSteps } from './dom.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const QUIZ_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00–23:00
const SUMMARY_HOURS = [17, 18, 19, 20, 21, 22, 23];
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const hourOf = (t) => Number(String(t).slice(0, 2));

function keyBytes(base64url) {
  const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function sameKey(buf, bytes) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  return a.length === bytes.length && a.every((v, i) => v === bytes[i]);
}

/** github.com/<owner>/<repo> for a GitHub Pages site, or null elsewhere. */
export function repoUrl() {
  const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  if (!m) return null;
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first ? `https://github.com/${m[1]}/${first}` : `https://github.com/${m[1]}/${m[1]}.github.io`;
}

/** Your times, cleaned: on the hour, one notification per hour, sorted. */
export function currentSchedule() {
  const s = getSettings().notifySchedule || DEFAULT_SCHEDULE;
  const summary = s.summary && /^\d\d:00$/.test(s.summary) ? s.summary : null;
  const quiz = [...new Set((s.quiz || []).filter((t) => /^\d\d:00$/.test(t) && t !== summary))].sort();
  return { timeZone: 'Europe/London', quiz, summary };
}

const scheduleKey = (s) => JSON.stringify({ quiz: s.quiz, summary: s.summary });

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export function notificationsSection() {
  const sec = el('section', { class: 'card notif', id: 'notifications' });
  let sub = null;
  draw();
  return sec;

  async function draw() {
    const installed = isStandalone();
    const ok = supported();
    const perm = ok ? Notification.permission : 'unsupported';
    try { sub = await currentSubscription(); } catch { sub = null; }
    const snap = await kvGet(SNAPSHOT_KEY).catch(() => null);
    const queued = snap && snap.hasData ? Math.max(0, snap.entries.length - (snap.next || 0)) : 0;

    const check = (good, label, detail) => el('li', { class: good === true ? 'ok' : good === false ? 'bad' : 'meh' },
      el('span', { class: 'check-ic', 'aria-hidden': 'true', text: good === true ? '✓' : good === false ? '✗' : '–' }),
      el('span', null, el('strong', { text: label }), detail ? el('span', { class: 'muted', text: ` ${detail}` }) : null));

    clear(sec);
    sec.append(el('h2', { text: 'Notifications' }));
    sec.append(el('ul', { class: 'checklist' },
      check(installed, 'Installed to Home Screen', installed ? null : '(open Makeline from its icon)'),
      check(ok, 'Push supported', ok ? null : '(needs iOS 16.4 or later, in the installed app)'),
      check(perm === 'granted' ? true : perm === 'denied' ? false : null, 'Permission',
        perm === 'granted' ? 'allowed' : perm === 'denied' ? 'blocked: turn it on in iPhone Settings → Notifications → Makeline' : 'not asked yet'),
      check(!!sub, 'Subscribed', sub ? null : '(turn on below)'),
      check(queued > 0 ? true : null, 'Questions ready', `${queued} queued on this phone`),
      check('setAppBadge' in navigator ? true : null, 'App icon badge', 'setAppBadge' in navigator ? 'shows cards due' : 'not supported here')));

    if (isIOS() && !installed) {
      sec.append(el('div', { class: 'hint' },
        el('h3', { text: 'Add to Home Screen first' }),
        el('p', { text: 'iPhone only allows notifications for Home Screen apps.' }),
        installSteps(),
        el('p', { class: 'muted', text: 'Then come back here in the installed app.' })));
    } else if (!ok) {
      sec.append(el('p', { class: 'muted', text: "This browser can't receive push notifications." }));
    } else if (!sub) {
      sec.append(el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: turnOn }, 'Turn on quiz notifications'));
    } else {
      sec.append(subscribedBlock());
    }
    sec.append(scheduleEditor());
  }

  async function turnOn() {
    try {
      // Ask straight away, inside the tap (iOS requires that).
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        toast(perm === 'denied' ? 'Blocked. Allow it in iPhone Settings → Notifications → Makeline.' : 'Not allowed this time.', { error: true, ms: 5000 });
        draw();
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const key = keyBytes(VAPID_PUBLIC_KEY);
      let s = await reg.pushManager.getSubscription();
      if (s && !sameKey(s.options && s.options.applicationServerKey, key)) {
        await s.unsubscribe();
        s = null;
      }
      if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await setPush({ enabled: true, subscription: s.toJSON(), since: Date.now() });
      await updateSettings({ scheduleCopied: null });
      state.hooks.dataChanged();
      toast('Notifications on. Now copy your subscription into GitHub.');
    } catch (e) {
      toast(`Couldn't turn on notifications: ${e.message || e}`, { error: true, ms: 6000 });
    }
    draw();
  }

  async function turnOff() {
    if (!confirm('Turn off quiz notifications on this phone?')) return;
    try {
      const s = await currentSubscription();
      if (s) await s.unsubscribe();
    } catch { /* ignore */ }
    await setPush(null);
    toast('Off. Also disable the workflow in GitHub, or its next run will fail.', { ms: 6000 });
    draw();
  }

  /** What "Copy" puts on the clipboard: the subscription plus your times. */
  function secretText() {
    return JSON.stringify({ subscription: sub.toJSON ? sub.toJSON() : sub, schedule: currentSchedule() });
  }

  function subscribedBlock() {
    const repo = repoUrl();
    const text = el('textarea', { class: 'sub-json', rows: '4', readonly: true, 'aria-label': 'Your push subscription', value: secretText() });
    const copy = async () => {
      const json = secretText();
      text.value = json;
      try {
        await navigator.clipboard.writeText(json);
        toast('Copied. Paste it into the PUSH_SUBSCRIPTION secret.');
      } catch {
        text.closest('details').open = true;
        text.focus();
        text.select();
        toast('Select all and copy the text below.');
      }
      await updateSettings({ scheduleCopied: scheduleKey(currentSchedule()), scheduleCopiedAt: Date.now() });
      draw();
    };
    const test = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        (reg.active || navigator.serviceWorker.controller).postMessage({ type: 'TEST_PUSH', kind: 'quiz' });
        toast('Sent. It should appear in a moment (lock your phone to see it as a banner).');
      } catch (e) {
        toast(`Couldn't send a test: ${e.message || e}`, { error: true });
      }
    };
    return el('div', { class: 'subscribed' },
      el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: copy }, 'Copy my push subscription'),
      el('ol', { class: 'steps-list' },
        el('li', null, 'Tap ', el('strong', { text: 'Copy my push subscription' }), ' above. It includes your times.'),
        el('li', null, 'In Safari, open ',
          repo ? el('a', { href: `${repo}/settings/secrets/actions`, target: '_blank', rel: 'noopener', text: 'your repo’s Actions secrets' }) : el('strong', { text: 'your repo → Settings → Secrets and variables → Actions' }),
          '.'),
        el('li', null, 'Add (or edit) ', el('code', { text: 'PUSH_SUBSCRIPTION' }), ', paste, and save.')),
      el('details', null, el('summary', { text: 'Show what gets copied' }), text),
      el('div', { class: 'foot-row' },
        el('button', { type: 'button', class: 'btn', onclick: test }, 'Send a test notification'),
        el('button', { type: 'button', class: 'btn btn-quiet', onclick: turnOff }, 'Turn off')));
  }

  function scheduleEditor() {
    const sched = currentSchedule();
    const settings = getSettings();
    const quizSet = new Set(sched.quiz.map(hourOf));
    const summaryHour = sched.summary ? hourOf(sched.summary) : null;
    const save = async (next) => {
      await updateSettings({ notifySchedule: { timeZone: 'Europe/London', ...next } });
      draw();
    };
    const toggleQuiz = (h) => {
      if (h === summaryHour) { toast('That hour has the evening summary. One notification per hour.'); return; }
      const q = new Set(quizSet);
      if (q.has(h)) q.delete(h); else q.add(h);
      save({ quiz: [...q].sort((a, b) => a - b).map(hh), summary: sched.summary });
    };
    const setSummary = (h) => {
      if (h !== null && quizSet.has(h)) { toast('That hour already has a quiz. One notification per hour.'); return; }
      save({ quiz: sched.quiz, summary: h === null ? null : hh(h) });
    };

    let status;
    if (!sub) {
      status = el('p', { class: 'muted small', text: 'Turn on notifications, then copy your subscription: these times go with it.' });
    } else if (settings.scheduleCopied === scheduleKey(sched)) {
      status = el('p', { class: 'sched-ok', text: '✓ These are the times you last copied to GitHub.' });
    } else {
      status = el('p', { class: 'sched-warn', text: '⚠ Times changed. Tap “Copy my push subscription” again and paste it over PUSH_SUBSCRIPTION in GitHub.' });
    }

    return el('div', { class: 'schedule' },
      el('h3', { text: 'Your times (UK time)' }),
      el('p', { class: 'muted small', text: `Quiz questions: ${sched.quiz.length ? sched.quiz.join(', ') : 'none'} · Summary: ${sched.summary || 'off'}` }),
      el('div', { class: 'hour-label', text: 'Quiz questions' }),
      el('div', { class: 'hours', role: 'group', 'aria-label': 'Quiz notification hours' }, QUIZ_HOURS.map((h) => el('button', {
        type: 'button', class: `hour${quizSet.has(h) ? ' on' : ''}${h === summaryHour ? ' taken' : ''}`,
        'aria-pressed': String(quizSet.has(h)), 'aria-label': `Quiz at ${hh(h)}`, onclick: () => toggleQuiz(h),
      }, hh(h)))),
      el('div', { class: 'hour-label', text: 'Evening summary' }),
      el('div', { class: 'hours', role: 'group', 'aria-label': 'Summary hour' },
        el('button', { type: 'button', class: `hour${summaryHour === null ? ' on' : ''}`, 'aria-pressed': String(summaryHour === null), onclick: () => setSummary(null) }, 'Off'),
        SUMMARY_HOURS.map((h) => el('button', {
          type: 'button', class: `hour${summaryHour === h ? ' on' : ''}${quizSet.has(h) ? ' taken' : ''}`,
          'aria-pressed': String(summaryHour === h), 'aria-label': `Summary at ${hh(h)}`, onclick: () => setSummary(h),
        }, hh(h)))),
      status,
      el('p', { class: 'muted small', text: 'Notifications come within the hour you pick (GitHub runs at about 17 minutes past). Clocks going forward or back are handled for you.' }));
  }
}
