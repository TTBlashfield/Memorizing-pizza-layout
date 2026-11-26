// Load builds: pick builds.json from the Files app, or paste it. It stays on this device.
import { parseBuildsText, computeStats } from '../data.js';
import { getBuilds, setBuilds, clearBuilds } from '../store.js';
import * as state from '../state.js';
import { el, clear, screen, toast, isStandalone, isIOS, installSteps } from './dom.js';
import { plural } from '../util.js';

export function statsLine(stats) {
  return `${stats.pizzas} ${plural(stats.pizzas, 'pizza')} loaded`;
}

export function statsDetail(stats) {
  const ranges = stats.byRange.map((r) => `${r.count} ${r.range}`).join(', ');
  return `${ranges} · ${stats.flagged} flagged ${plural(stats.flagged, 'layer')}`;
}

export function renderLoad({ reason = null } = {}) {
  const result = el('div', { class: 'load-result', 'aria-live': 'polite' });
  const current = getBuilds();

  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'builds-file' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    // Don't trust file.type: iOS often reports "" or "text/plain" for .json files.
    let text;
    try {
      text = typeof file.text === 'function' ? await file.text() : await readAsText(file);
    } catch (e) {
      showErrors(result, [`Couldn't read that file (${e.message || e}).`]);
      return;
    } finally {
      fileInput.value = '';
    }
    await accept(text, file.name, result);
  });

  const paste = el('textarea', {
    class: 'paste', rows: '6', placeholder: 'Paste the whole builds.json here',
    autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Paste builds JSON',
  });

  const body = el('div', { class: 'load' },
    reason ? el('div', { class: 'card hint' }, el('p', { text: reason })) : null,
    !isStandalone() && isIOS()
      ? el('div', { class: 'card hint' },
        el('h3', { text: 'Add to Home Screen first' }),
        el('p', { text: 'Safari and the Home Screen app keep separate storage. Install first, then load your builds inside the app.' }),
        installSteps())
      : null,
    el('div', { class: 'card' },
      el('h2', { text: 'Your builds file' }),
      el('p', { text: 'Pick builds.json from the Files app. It stays on this phone: nothing is uploaded, and it never goes in the app or on the website.' }),
      el('label', { class: 'btn btn-primary btn-big file-btn', for: 'builds-file' }, 'Choose builds.json'),
      fileInput,
      current ? el('p', { class: 'muted small' }, `Loaded now: ${statsLine(computeStats(current.data))}. Loading a new file keeps your progress.`) : null),
    result,
    el('details', { class: 'card' },
      el('summary', { text: 'Or paste the JSON instead' }),
      paste,
      el('button', {
        type: 'button', class: 'btn', onclick: () => accept(paste.value, 'pasted text', result),
      }, 'Load pasted text')),
    current ? el('div', { class: 'card' },
      el('h3', { text: 'Remove from this device' }),
      el('p', { class: 'muted', text: 'Deletes the builds from this phone. Your progress is kept unless you reset it in Settings.' }),
      el('button', {
        type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!confirm('Remove your builds from this device?')) return;
          await clearBuilds();
          state.hooks.dataChanged();
          toast('Builds removed from this device');
          renderLoad();
        },
      }, 'Remove builds')) : null);

  screen({ title: 'Load builds', back: getBuilds() ? '#/settings' : null, body, tab: getBuilds() ? 'settings' : 'home' });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function showErrors(target, errors) {
  clear(target);
  target.append(el('div', { class: 'card error' },
    el('h3', { text: "That file couldn't be loaded" }),
    el('ul', null, errors.map((e) => el('li', { text: e })))));
}

async function accept(text, fileName, target) {
  const res = parseBuildsText(text);
  if (!res.ok) {
    showErrors(target, res.errors);
    return;
  }
  try {
    await setBuilds(res.data, { warnings: res.warnings, fileName });
  } catch (e) {
    showErrors(target, [`It's a valid file, but it couldn't be saved on this device (${e.message || e}).`]);
    return;
  }
  state.hooks.dataChanged();
  clear(target);
  target.append(el('div', { class: 'card success' },
    el('h3', { text: statsLine(res.stats) }),
    el('p', { text: statsDetail(res.stats) }),
    res.data.about ? el('p', { class: 'muted', text: res.data.about }) : null,
    res.warnings.length ? el('details', null,
      el('summary', { text: `${res.warnings.length} ${plural(res.warnings.length, 'note')} about the file` }),
      el('ul', null, res.warnings.map((w) => el('li', { text: w })))) : null,
    el('a', { class: 'btn btn-primary btn-big', href: '#/' }, 'Start practising')));
  target.scrollIntoView({ block: 'start' });
}
