// Home: today's progress, filters, mode buttons.
import { getData, getProgress, getStats, getSettings, updateSettings } from '../store.js';
import { rangesIn, sizesIn, shortSizeName, isLimitedRange, limitedLabel } from '../data.js';
import { modesFor } from '../questions.js';
import { summarize, weakSpots, computeStreak, dayIndex } from '../srs.js';
import { percent, plural } from '../util.js';
import * as state from '../state.js';
import { el, screen, sizeBadge, isStandalone, isIOS, installSteps } from './dom.js';

export function renderHome() {
  const data = getData();
  if (!data) return renderWelcome();

  const today = dayIndex();
  const progress = getProgress();
  const items = state.items();
  const sum = summarize(items, progress, today);
  const days = getStats().days;
  const streak = computeStreak(days, today);
  const t = days[today] || { answered: 0, correct: 0 };
  let acc = percent(t.correct, t.answered);
  let accLabel = 'accuracy today';
  if (acc === null) {
    const total = Object.values(days).reduce((a, d) => ({ answered: a.answered + d.answered, correct: a.correct + d.correct }), { answered: 0, correct: 0 });
    acc = percent(total.correct, total.answered);
    accLabel = 'accuracy so far';
  }

  const tiles = el('div', { class: 'tiles' },
    tile(String(sum.due), 'due today', sum.fresh ? `+${sum.fresh} new` : null, 'tile-due'),
    tile(String(streak), plural(streak, 'day streak', 'day streak'), streak ? '🔥' : null),
    tile(acc === null ? '–' : `${acc}%`, accLabel, t.answered ? `${t.answered} answered` : null));

  const weakCount = weakSpots(items, progress, { limit: 999 }).length;
  const modeButtons = modesFor(state.filters()).map((m) => {
    const modeItems = items.filter((it) => it.mode === m.id);
    const s = summarize(modeItems, progress, today);
    const badge = s.due ? `${s.due} due` : s.fresh ? `${s.fresh} new` : modeItems.length ? 'all done' : 'none';
    return el('a', { class: `mode mode-${m.id}${modeItems.length ? '' : ' mode-empty'}`, href: `#/quiz/${m.id}`, 'aria-disabled': modeItems.length ? null : 'true' },
      el('span', { class: 'mode-title', text: m.title }),
      el('span', { class: 'mode-blurb', text: m.blurb }),
      el('span', { class: `mode-badge${s.due ? ' hot' : ''}`, text: badge }));
  });
  const weakBtn = el('a', { class: `mode mode-weak${weakCount ? '' : ' mode-empty'}`, href: '#/quiz/weak', 'aria-disabled': weakCount ? null : 'true' },
    el('span', { class: 'mode-title', text: 'Weak spots' }),
    el('span', { class: 'mode-blurb', text: 'The ones you miss most' }),
    el('span', { class: `mode-badge${weakCount ? ' hot' : ''}`, text: weakCount ? `${weakCount} to fix` : 'none yet' }));

  const body = el('div', { class: 'home' },
    tiles,
    installHint(),
    filtersCard(state.activeData() || data),
    el('h2', { class: 'section-title', text: 'Practise' }),
    el('div', { class: 'modes' }, modeButtons, weakBtn));

  const footer = el('a', { class: 'btn btn-primary btn-big', href: '#/quiz/due' },
    sum.due ? `Practise ${Math.min(sum.due, 15)} due now` : 'Start a session');

  screen({ title: 'Makeline Trainer', body, footer, tab: 'home' });
}

function tile(value, label, sub, cls = '') {
  return el('div', { class: `tile ${cls}` },
    el('span', { class: 'tile-n', text: value }),
    el('span', { class: 'tile-l', text: label }),
    sub ? el('span', { class: 'tile-s', text: sub }) : null);
}

function filtersCard(data) {
  const f = state.filters();
  const ranges = rangesIn(data);
  const sizes = sizesIn(data);
  const toggle = (field, value, all) => {
    const cur = new Set(f[field]);
    if (cur.has(value)) {
      if (cur.size === 1) return; // keep at least one
      cur.delete(value);
    } else cur.add(value);
    const next = all.filter((v) => cur.has(v));
    updateSettings({ [field]: next.length === all.length ? [] : next });
    state.hooks.settingsChanged();
    renderHome();
  };
  return el('div', { class: 'card filters' },
    // (ranges/sizes come from the active data: ended limited-time pizzas are gone)
    el('div', { class: 'filter-row' },
      el('span', { class: 'filter-label', text: 'Ranges' }),
      el('div', { class: 'chips' }, ranges.map((r) => el('button', {
        type: 'button', class: `chip${f.ranges.includes(r) ? ' on' : ''}${isLimitedRange(data, r) ? ' chip-limited' : ''}`, 'aria-pressed': String(f.ranges.includes(r)),
        title: limitedLabel(data, r) || null, onclick: () => toggle('ranges', r, ranges),
      }, r, isLimitedRange(data, r) ? el('span', { class: 'chip-sub', text: limitedLabel(data, r) }) : null)))),
    el('div', { class: 'filter-row' },
      el('span', { class: 'filter-label', text: 'Sizes' }),
      el('div', { class: 'chips' }, sizes.map((s) => el('button', {
        type: 'button', class: `chip chip-size chip-${s}${f.sizes.includes(s) ? ' on' : ''}`, 'aria-pressed': String(f.sizes.includes(s)),
        'aria-label': shortSizeName(data, s), onclick: () => toggle('sizes', s, sizes),
      }, sizeBadge(data, s), el('span', { class: 'chip-sz-name', text: shortSizeName(data, s) }))))),
    el('div', { class: 'filter-row' },
      el('span', { class: 'filter-label', text: 'Amounts' }),
      el('div', { class: 'chips' },
        el('button', {
          type: 'button', class: `chip${f.grams ? ' on' : ''}`, 'aria-pressed': String(f.grams),
          onclick: () => {
            updateSettings({ showGrams: !f.grams });
            state.hooks.settingsChanged();
            renderHome();
          },
        }, 'Grams'),
        el('span', { class: 'filter-hint', text: f.grams ? 'Asking grams too' : 'Per slice & counts only' }))));
}

function installHint() {
  if (isStandalone() || !isIOS() || getSettings().hideInstallHint) return null;
  return el('div', { class: 'card hint' },
    el('h3', { text: 'Install it for the full app' }),
    el('p', { text: 'Add Makeline to your Home Screen for full screen, offline use and quiz notifications. Safari and the Home Screen app keep separate storage, so load your builds inside the installed app.' }),
    installSteps(),
    el('button', { type: 'button', class: 'btn btn-quiet', onclick: () => { updateSettings({ hideInstallHint: true }); renderHome(); } }, 'Hide this'));
}

function renderWelcome() {
  const body = el('div', { class: 'welcome' },
    el('div', { class: 'welcome-art', 'aria-hidden': 'true' }, el('img', { src: 'icons/icon.svg', alt: '', width: '96', height: '96' })),
    el('h2', { text: 'Learn every build by heart' }),
    el('p', { text: 'Makeline Trainer drills toppings, build order, portions, per-slice placement and drizzles until you know them cold.' }),
    el('p', { class: 'muted', text: 'It works from your own builds.json file, which stays on this device. Nothing is uploaded.' }),
    !isStandalone() && isIOS()
      ? el('div', { class: 'card hint' }, el('h3', { text: 'First, add it to your Home Screen' }), installSteps(),
        el('p', { class: 'muted', text: 'Then open Makeline from the Home Screen and load your builds there.' }))
      : null);
  const footer = el('a', { class: 'btn btn-primary btn-big', href: '#/load' }, 'Load builds');
  screen({ title: 'Makeline Trainer', body, footer, tab: 'home' });
}
