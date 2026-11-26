// Settings → Notifications: status checklist, turn on/off, copy the push subscription,
// send a test, and show the schedule.
//
// iOS rules: web push only works in the Home Screen app (iOS 16.4+), and the permission
// prompt must come straight from a tap inside the installed app.
import { VAPID_PUBLIC_KEY } from '../config.js';
import { kvGet, SNAPSHOT_KEY } from '../db.js';
import { getPush, setPush } from '../store.js';
import * as state from '../state.js';
import { el, clear, toast, isStandalone, isIOS, installSteps } from './dom.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

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

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export function notificationsSection() {
  const sec = el('section', { class: 'card notif', id: 'notifications' });
  draw();
  return sec;

  async function draw() {
    clear(sec);
    sec.append(el('h2', { text: 'Notifications' }));
    const installed = isStandalone();
    const ok = supported();
    const perm = ok ? Notification.permission : 'unsupported';
    let sub = null;
    try { sub = await currentSubscription(); } catch { /* ignore */ }
    const snap = await kvGet(SNAPSHOT_KEY).catch(() => null);
    const queued = snap && snap.hasData ? Math.max(0, snap.entries.length - (snap.next || 0)) : 0;

    const check = (good, label, detail) => el('li', { class: good === true ? 'ok' : good === false ? 'bad' : 'meh' },
      el('span', { class: 'check-ic', 'aria-hidden': 'true', text: good === true ? '✓' : good === false ? '✗' : '–' }),
      el('span', null, el('strong', { text: label }), detail ? el('span', { class: 'muted', text: ` ${detail}` }) : null));

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
      sec.append(subscribedBlock(sub));
    }
    sec.append(await scheduleBlock());
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
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await setPush({ enabled: true, subscription: sub.toJSON(), since: Date.now() });
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
      const sub = await currentSubscription();
      if (sub) await sub.unsubscribe();
    } catch { /* ignore */ }
    await setPush(null);
    toast('Off. Also disable the workflow in GitHub, or its next run will fail.', { ms: 6000 });
    draw();
  }

  function subscribedBlock(sub) {
    const json = JSON.stringify(sub.toJSON ? sub.toJSON() : sub);
    const text = el('textarea', { class: 'sub-json', rows: '4', readonly: true, 'aria-label': 'Your push subscription', value: json });
    const repo = repoUrl();
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(json);
        toast('Copied. Paste it into the PUSH_SUBSCRIPTION secret.');
      } catch {
        text.focus();
        text.select();
        toast('Select all and copy the text below.');
      }
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
        el('li', null, 'Tap ', el('strong', { text: 'Copy my push subscription' }), ' above.'),
        el('li', null, 'In Safari, open ',
          repo ? el('a', { href: `${repo}/settings/secrets/actions/new`, target: '_blank', rel: 'noopener', text: 'your repo’s new-secret page' }) : el('strong', { text: 'your repo → Settings → Secrets and variables → Actions → New repository secret' }),
          '.'),
        el('li', null, 'Name it ', el('code', { text: 'PUSH_SUBSCRIPTION' }), ', paste, and tap ', el('strong', { text: 'Add secret' }), '.')),
      el('details', null, el('summary', { text: 'Show the subscription' }), text),
      el('div', { class: 'foot-row' },
        el('button', { type: 'button', class: 'btn', onclick: test }, 'Send a test notification'),
        el('button', { type: 'button', class: 'btn btn-quiet', onclick: turnOff }, 'Turn off')));
  }
}

async function scheduleBlock() {
  const box = el('div', { class: 'schedule' }, el('h3', { text: 'Your schedule (UK time)' }));
  try {
    const res = await fetch('notify-schedule.json', { cache: 'no-store' });
    const s = await res.json();
    const quiz = Array.isArray(s.quiz) ? s.quiz : [];
    box.append(el('ul', { class: 'sched' },
      el('li', null, el('strong', { text: 'Quiz questions: ' }), quiz.length ? quiz.join(', ') : 'none'),
      el('li', null, el('strong', { text: 'Evening summary: ' }), s.summary || 'none')));
  } catch {
    box.append(el('p', { class: 'muted', text: "Couldn't load the schedule (are you offline?)." }));
  }
  const repo = repoUrl();
  box.append(el('p', { class: 'muted small' }, 'To change the times, edit ',
    repo ? el('a', { href: `${repo}/edit/main/docs/notify-schedule.json`, target: '_blank', rel: 'noopener', text: 'docs/notify-schedule.json' }) : el('code', { text: 'docs/notify-schedule.json' }),
    ' in GitHub. Times are on the hour, UK time, and follow GMT/BST automatically.'));
  return box;
}

/** Used by Settings to show a one-line status. */
export function pushSummary() {
  const p = getPush();
  return p && p.enabled ? 'On' : 'Off';
}
