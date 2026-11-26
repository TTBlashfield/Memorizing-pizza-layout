#!/usr/bin/env node
// Quiz notification sender, run by .github/workflows/quiz-notify.yml.
//
//   node notifier/send.mjs check       decide whether a slot is due now (writes GITHUB_OUTPUT)
//   node notifier/send.mjs send        send one push (TYPE=quiz|summary)
//   node notifier/send.mjs keepalive   stop GitHub switching the schedule off after 60 quiet days
//
// Secrets (repo Settings -> Secrets and variables -> Actions):
//   VAPID_PRIVATE_KEY   the private half of the key pair (never commit it)
//   PUSH_SUBSCRIPTION   JSON copied from the app (Settings -> Notifications -> Copy).
//                       It also carries your notification times.
//   VAPID_SUBJECT       optional, e.g. mailto:you@example.com (defaults to the app's URL)
import { appendFileSync, readFileSync } from 'node:fs';
import { createECDH } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDueSlot, parseSchedule, describeSchedule } from './schedule.mjs';
import { buildPayload, pagesUrl } from './payload.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEDULE_FILE = join(ROOT, 'notifier', 'default-schedule.json');
const CONFIG_FILE = join(ROOT, 'docs', 'js', 'config.js');
const EXPIRED_MSG = 'Re-enable notifications in the app and update PUSH_SUBSCRIPTION';

function output(name, value) {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

export function readPublicKey(file = CONFIG_FILE) {
  const m = /VAPID_PUBLIC_KEY\s*=\s*['"]([A-Za-z0-9_-]+)['"]/.exec(readFileSync(file, 'utf8'));
  if (!m) throw new Error(`Couldn't find VAPID_PUBLIC_KEY in ${file}`);
  return m[1];
}

/** Public key (base64url, uncompressed P-256 point) for a base64url private key. */
export function publicKeyFor(privateKey) {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
  return ecdh.getPublicKey().toString('base64url');
}

/**
 * PUSH_SUBSCRIPTION holds what the app's "Copy my push subscription" button copies:
 *   { "subscription": { endpoint, keys }, "schedule": { timeZone, quiz: [...], summary } }
 * A bare subscription ({ endpoint, keys }) also works and uses the default schedule.
 */
export function parseSecret(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('PUSH_SUBSCRIPTION isn\'t valid JSON. Copy it again from the app (Settings → Notifications → Copy my push subscription).');
  }
  const sub = obj && obj.subscription ? obj.subscription : obj;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('PUSH_SUBSCRIPTION is missing "endpoint" or "keys". Copy it again from the app.');
  }
  return { subscription: sub, schedule: obj && obj.schedule ? obj.schedule : null };
}

export const parseSubscription = (text) => parseSecret(text).subscription;

/** The schedule from the secret if it has one, else the default file. */
export function loadSchedule(secretText) {
  if (secretText && secretText.trim()) {
    let fromSecret = null;
    try { fromSecret = parseSecret(secretText).schedule; } catch { /* reported by the send step */ }
    if (fromSecret) return { schedule: parseSchedule(fromSecret), source: 'your app (PUSH_SUBSCRIPTION)' };
  }
  return { schedule: parseSchedule(JSON.parse(readFileSync(SCHEDULE_FILE, 'utf8'))), source: 'the default schedule' };
}

function check() {
  const event = process.env.EVENT_NAME || 'schedule';
  if (event === 'workflow_dispatch') {
    const type = process.env.INPUT_TYPE === 'summary' ? 'summary' : 'quiz';
    console.log(`Manual run: sending a ${type} notification now.`);
    output('send', 'true');
    output('type', type);
    output('slot_key', `manual-${Date.now()}`);
    return;
  }
  // Not set up yet (no secrets): skip quietly instead of failing (and emailing) every slot.
  // A manual run still fails with a clear message, and an expired subscription still fails.
  if (!(process.env.PUSH_SUBSCRIPTION || '').trim() || process.env.HAS_VAPID_KEY !== 'true') {
    console.log('::notice::Notifications are not set up yet (VAPID_PRIVATE_KEY and PUSH_SUBSCRIPTION secrets). Skipping.');
    output('send', 'false');
    return;
  }
  const { schedule, source } = loadSchedule(process.env.PUSH_SUBSCRIPTION || '');
  const slot = findDueSlot(new Date(), schedule);
  console.log(`Schedule from ${source}: ${describeSchedule(schedule)}`);
  if (!slot) {
    console.log('No notification due this hour.');
    output('send', 'false');
    return;
  }
  console.log(`Due: ${slot.type} for ${slot.time} (UK time now ${slot.local}).`);
  output('send', 'true');
  output('type', slot.type);
  output('slot_key', slot.key);
}

async function send() {
  const type = process.env.TYPE === 'summary' ? 'summary' : 'quiz';
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subText = (process.env.PUSH_SUBSCRIPTION || '').trim();
  if (!privateKey) fail('The VAPID_PRIVATE_KEY secret is missing. Add it under Settings → Secrets and variables → Actions.');
  if (!subText) fail(`The PUSH_SUBSCRIPTION secret is missing. ${EXPIRED_MSG}.`);

  let subscription;
  try { subscription = parseSecret(subText).subscription; } catch (e) { fail(e.message); }

  const publicKey = readPublicKey();
  let derived;
  try { derived = publicKeyFor(privateKey); } catch { fail('VAPID_PRIVATE_KEY isn\'t a valid key. Paste it again exactly as given (no spaces or quotes).'); }
  if (derived !== publicKey) {
    fail('VAPID_PRIVATE_KEY doesn\'t match the public key in docs/js/config.js. Check you pasted the right private key.');
  }

  const appUrl = (process.env.APP_URL || '').trim() || pagesUrl(process.env.GITHUB_REPOSITORY);
  const subject = (process.env.VAPID_SUBJECT || '').trim() || appUrl;
  const payload = buildPayload(type, appUrl);

  const { default: webpush } = await import('web-push');
  webpush.setVapidDetails(subject, publicKey, privateKey);
  try {
    const res = await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 4 * 60 * 60, // a quiz that's 4 hours late isn't worth showing
      urgency: 'normal',
      topic: type, // an undelivered older message of the same type is replaced, not stacked
    });
    console.log(`Sent ${type} notification (push service said ${res.statusCode}).`);
  } catch (e) {
    const code = e && e.statusCode;
    if (code === 404 || code === 410) {
      fail(`The push service says this subscription has gone (${code}). ${EXPIRED_MSG}.`);
    }
    if (code === 403 || code === 401) {
      fail(`The push service rejected the keys (${code}: ${e.body || e.message}). Check VAPID_PRIVATE_KEY, and that VAPID_SUBJECT is a mailto: or https: address.`);
    }
    fail(`Sending failed${code ? ` (${code})` : ''}: ${(e && (e.body || e.message)) || e}`);
  }
}

/**
 * GitHub switches off scheduled workflows in public repos after 60 days with no activity.
 * Re-enabling the workflow through the API once a day resets that, with no commits needed.
 */
async function keepalive() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const workflow = process.env.WORKFLOW_FILE || 'quiz-notify.yml';
  if (!token || !repo) { console.log('No token or repo, skipping keepalive.'); return; }
  // Once a day is plenty (the run at 03:17 UTC).
  if (!process.env.FORCE_KEEPALIVE && new Date().getUTCHours() !== 3) { console.log('Keepalive runs once a day at 03:17 UTC.'); return; }
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/enable`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (res.ok) console.log('Keepalive: workflow re-enabled, so the 60-day timer is reset.');
  else console.log(`::warning::Keepalive call failed (${res.status}). The schedule could be switched off after 60 quiet days.`);
}

const cmd = process.argv[2];
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    if (cmd === 'check') check();
    else if (cmd === 'send') await send();
    else if (cmd === 'keepalive') await keepalive();
    else fail('Usage: node notifier/send.mjs check|send|keepalive');
  } catch (e) {
    fail(e.message || String(e));
  }
}
