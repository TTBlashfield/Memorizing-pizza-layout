// Makeline Trainer: boot, routing, service worker, update banner, badge and notification snapshot.
import { VERSION } from './version.js';
import { initStore, setErrorHandler, getData, getProgress, getStats, flush } from './store.js';
import { kvGet, saveSnapshot, SNAPSHOT_KEY } from './db.js';
import { buildSnapshot } from './notify.js';
import { summarize, dayIndex } from './srs.js';
import * as state from './state.js';
import { el, toast, screen } from './ui/dom.js';
import { renderHome } from './ui/home.js';
import { renderBrowse, renderPizza } from './ui/browse.js';
import { renderLoad } from './ui/load.js';
import { renderSettings } from './ui/settings.js';
import { renderQuiz, renderDeepLink } from './ui/quiz.js';

let swRegistration = null;
let updateRequested = false;

function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [name, ...rest] = raw.split('/');
  const arg = rest.map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const needsData = !['', 'load', 'settings'].includes(name);
  if (needsData && !getData()) {
    renderLoad({ reason: name === 'q' ? 'Load your builds first, then tap the notification again.' : null });
    return;
  }
  switch (name) {
    case '': return renderHome();
    case 'load': return renderLoad();
    case 'browse': return renderBrowse();
    case 'pizza': return renderPizza(arg[0], arg[1]);
    case 'settings': return renderSettings({ checkForUpdate, version: VERSION, registration: () => swRegistration });
    case 'quiz': return renderQuiz(arg[0], arg[1]);
    case 'q': return renderDeepLink(rest.join('/'));
    default: location.replace('#/'); return undefined;
  }
}

// ---------- notification snapshot + badge ----------

let snapTimer = null;
function scheduleSnapshot(delay = 1200) {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(refreshSnapshot, delay);
}

async function refreshSnapshot() {
  try {
    const data = state.activeData();
    const previous = await kvGet(SNAPSHOT_KEY).catch(() => null);
    const snap = buildSnapshot({
      data, items: state.items(), progress: getProgress(), statsDays: getStats().days,
      previous, appVersion: VERSION, filters: state.filters(),
    });
    await saveSnapshot(snap);
    updateBadge();
  } catch (e) {
    console.warn('Could not save the notification queue', e);
  }
}

function updateBadge() {
  try {
    if (!getData()) return;
    const due = summarize(state.items(), getProgress(), dayIndex()).due;
    if (due > 0 && navigator.setAppBadge) navigator.setAppBadge(due).catch(() => {});
    else if (due === 0 && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch { /* badges are a nice-to-have */ }
}

state.hooks.afterAnswer = () => scheduleSnapshot(1500);
state.hooks.dataChanged = () => scheduleSnapshot(0);
state.hooks.settingsChanged = () => scheduleSnapshot(600);

// ---------- service worker + updates ----------

function showUpdateBanner() {
  if (document.getElementById('update')) return;
  const banner = el('button', {
    id: 'update', class: 'update', type: 'button',
    onclick: () => applyUpdate(),
  }, el('strong', { text: 'Update available' }), el('span', { text: ' · tap to refresh' }));
  document.body.append(banner);
}

async function applyUpdate() {
  updateRequested = true;
  await flush().catch(() => {});
  const waiting = swRegistration && swRegistration.waiting;
  if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  else location.reload();
}

function watchForUpdates(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner();
    });
  });
}

let lastUpdateCheck = 0;
async function checkForUpdate(force = false) {
  if (!swRegistration) return 'no-sw';
  if (!force && Date.now() - lastUpdateCheck < 15 * 60 * 1000) return 'skipped';
  lastUpdateCheck = Date.now();
  try {
    await swRegistration.update();
    return swRegistration.waiting || swRegistration.installing ? 'found' : 'none';
  } catch {
    return 'offline';
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    watchForUpdates(swRegistration);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload();
    });
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data || {};
      if (msg.type === 'OPEN_URL' && typeof msg.url === 'string') {
        const url = new URL(msg.url, location.href);
        if (url.origin === location.origin) {
          if (url.hash === location.hash) route();
          else location.hash = url.hash;
        }
      }
    });
  } catch (e) {
    console.warn('Service worker registration failed', e);
  }
}

// ---------- boot ----------

async function boot() {
  setErrorHandler((e) => toast(`Couldn't save on this device: ${e && e.message ? e.message : e}`, { error: true, ms: 5000 }));
  try {
    await initStore();
  } catch (e) {
    screen({
      title: 'Makeline Trainer',
      body: el('div', { class: 'card' },
        el('h2', { text: "Storage isn't available" }),
        el('p', { text: `Makeline keeps your builds and progress on this device, but storage couldn't be opened (${e.message || e}). If you're in a private browsing window, open it normally instead.` })),
    });
    return;
  }
  window.addEventListener('hashchange', route);
  route();
  registerServiceWorker();
  scheduleSnapshot(800);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate();
      updateBadge();
      scheduleSnapshot(2000);
    } else {
      flush().catch(() => {});
    }
  });
}

boot();
