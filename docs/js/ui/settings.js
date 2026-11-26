// Settings: data, notifications, progress backup/reset, app version and updates.
import { computeStats } from '../data.js';
import { getBuilds, getProgress, exportProgress, importProgress, resetProgress } from '../store.js';
import * as state from '../state.js';
import { el, screen, toast } from './dom.js';
import { statsLine, statsDetail } from './load.js';
import { notificationsSection } from './notifications.js';

export function renderSettings({ checkForUpdate, version, registration }) {
  const builds = getBuilds();
  const tracked = Object.keys(getProgress()).length;

  const dataCard = el('section', { class: 'card' },
    el('h2', { text: 'Builds' }),
    builds
      ? [
        el('p', { class: 'big-line', text: statsLine(computeStats(builds.data)) }),
        el('p', { class: 'muted', text: statsDetail(computeStats(builds.data)) }),
        el('p', { class: 'muted small', text: `Loaded ${new Date(builds.loadedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${builds.fileName ? ` from ${builds.fileName}` : ''}.` }),
      ]
      : el('p', { text: 'No builds loaded yet.' }),
    el('a', { class: 'btn btn-primary', href: '#/load' }, builds ? 'Re-import builds' : 'Load builds'),
    el('p', { class: 'muted small', text: 'Re-importing an updated file keeps your progress.' }));

  const importInput = el('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'progress-file' });
  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    importInput.value = '';
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!confirm('Replace your current progress with this backup?')) return;
      const n = await importProgress(obj);
      state.hooks.dataChanged();
      toast(`Progress restored: ${n} questions.`);
      rerender();
    } catch (e) {
      toast(e.message || String(e), { error: true, ms: 5000 });
    }
  });

  const progressCard = el('section', { class: 'card' },
    el('h2', { text: 'Progress' }),
    el('p', { class: 'muted', text: `${tracked} questions tracked on this phone.` }),
    el('div', { class: 'btn-stack' },
      el('button', { type: 'button', class: 'btn', onclick: () => exportNow(version) }, 'Export progress'),
      el('label', { class: 'btn', for: 'progress-file' }, 'Import progress'),
      importInput,
      el('button', {
        type: 'button', class: 'btn btn-danger', onclick: async () => {
          if (!confirm('Reset all progress? Your builds stay loaded.')) return;
          await resetProgress();
          state.hooks.dataChanged();
          toast('Progress reset');
          rerender();
        },
      }, 'Reset progress')));

  const updateStatus = el('span', { class: 'muted small', 'aria-live': 'polite' });
  const appCard = el('section', { class: 'card' },
    el('h2', { text: 'App' }),
    el('p', null, 'Makeline Trainer ', el('strong', { text: `v${version}` })),
    el('button', {
      type: 'button', class: 'btn', onclick: async () => {
        updateStatus.textContent = ' Checking…';
        const r = await checkForUpdate(true);
        updateStatus.textContent = r === 'found' ? ' Update found: tap the banner.' : r === 'offline' ? " You're offline." : r === 'no-sw' ? ' Not available here.' : ' You have the latest version.';
      },
    }, 'Check for updates'), updateStatus,
    el('p', { class: 'muted small', text: 'Your builds and progress are stored only on this phone. The website has no build data, and notifications carry none either: the question is picked on your phone.' }));

  function rerender() { renderSettings({ checkForUpdate, version, registration }); }

  screen({ title: 'Settings', body: el('div', { class: 'settings' }, dataCard, notificationsSection(), progressCard, appCard), tab: 'settings' });
}

async function exportNow(version) {
  const json = JSON.stringify(exportProgress(version), null, 1);
  const name = `makeline-progress-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Makeline progress' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Progress exported');
}
