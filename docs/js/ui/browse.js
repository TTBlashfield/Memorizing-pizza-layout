// Browse: searchable list grouped by range or by shared toppings, and the pizza page.
import { getData, getSettings, updateSettings } from '../store.js';
import { rangesIn, normName, shortSizeName, sizesIn, formatNum, unitWord, limitedLabel, hasEnded, isLimited, formatDay } from '../data.js';
import { pizzaById } from '../questions.js';
import { sharedSections, groupValue } from '../groups.js';
import * as state from '../state.js';
import { el, clear, screen, sizeBadge, codePill, icon } from './dom.js';
import { buildView, pizzaInfo } from './buildview.js';

let lastQuery = '';
let lastSize = null;
let sharedSize = null;

export function renderBrowse() {
  const data = getData();
  const list = el('div', { class: 'browse-list' });
  let view = getSettings().browseView === 'shared' ? 'shared' : 'range';
  const input = el('input', {
    type: 'search', class: 'search', placeholder: 'Search name, code or topping', 'aria-label': 'Search pizzas',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    value: lastQuery,
  });
  const viewSeg = el('div', { class: 'viewseg', role: 'tablist', 'aria-label': 'Group pizzas' });
  const drawSeg = () => {
    clear(viewSeg);
    for (const [id, label] of [['range', 'By range'], ['shared', 'Shared toppings']]) {
      viewSeg.append(el('button', {
        type: 'button', role: 'tab', class: `viewseg-btn${view === id ? ' on' : ''}`, 'aria-selected': String(view === id),
        onclick: () => { view = id; updateSettings({ browseView: id }); drawSeg(); draw(); },
      }, label));
    }
  };
  const draw = () => {
    lastQuery = input.value;
    clear(list);
    if (view === 'shared') drawShared(state.activeData() || data, list, normName(input.value), draw);
    else drawRanges(data, list, normName(input.value), input.value);
  };
  input.addEventListener('input', draw);
  drawSeg();
  draw();
  const searchBar = el('div', { class: 'searchbar' }, icon('search', 'ic search-ic'), input, viewSeg);
  screen({ title: 'Browse', below: searchBar, body: list, tab: 'browse' });
}

function pizzaRow(data, p, extra = null, size = null) {
  return el('li', null,
    el('a', { class: 'row', href: `#/pizza/${encodeURIComponent(p.id)}${size && p.sizes.includes(size) ? `/${size}` : ''}` },
      el('span', { class: 'row-main' },
        el('span', { class: 'row-name', text: p.name }),
        extra || el('span', { class: 'row-sizes' }, p.sizes.map((s) => sizeBadge(data, s)))),
      codePill(p.code),
      hasEnded(p) ? el('span', { class: 'ended', text: 'Ended' }) : null,
      p.layers.some((l) => l.flag) ? el('span', { class: 'flag-dot', title: 'Has something to check', text: '⚠' }) : null));
}

function drawRanges(data, list, q, raw) {
  let shown = 0;
  for (const range of rangesIn(data)) {
    const pizzas = data.pizzas.filter((p) => p.range === range
      && (!q || normName(p.name).includes(q) || normName(p.code).includes(q)));
    if (!pizzas.length) continue;
    shown += pizzas.length;
    list.append(el('section', { class: 'group' },
      el('h2', { class: 'group-title' }, range, el('span', { class: 'count', text: String(pizzas.length) }),
        limitedLabel(data, range) ? el('span', { class: 'limited-tag', text: `Limited time · ${limitedLabel(data, range)}` }) : null),
      el('ul', { class: 'rows' }, pizzas.map((p) => pizzaRow(data, p)))));
  }
  if (!shown) list.append(el('p', { class: 'empty', text: `Nothing matches “${raw}”.` }));
}

/** Pizzas side by side by what they share, with per-slice counts for one size. */
function drawShared(data, list, q, redraw) {
  const grams = state.filters().grams;
  const sizes = sizesIn(data);
  if (!sharedSize || !sizes.includes(sharedSize)) sharedSize = sizes.includes('M') ? 'M' : sizes[0];
  const size = sharedSize;
  const P = (id) => pizzaById(data, id);
  const matches = (title, members) => !q || normName(title).includes(q)
    || members.some((m) => normName(P(m.pizzaId).name).includes(q) || normName(P(m.pizzaId).code).includes(q));

  list.append(el('div', { class: 'seg seg-shared', role: 'tablist', 'aria-label': 'Size for the counts' },
    sizes.map((s) => el('button', {
      type: 'button', role: 'tab', class: `seg-btn seg-${s}${s === size ? ' on' : ''}`, 'aria-selected': String(s === size),
      onclick: () => { sharedSize = s; redraw(); },
    }, sizeBadge(data, s), el('span', { text: shortSizeName(data, s) })))));

  const valueText = (v) => {
    if (!v) return null;
    if (v.kind === 'perslice') return `${formatNum(v.value)} / slice`;
    return v.unit === 'g' ? `${formatNum(v.value)}g` : `${formatNum(v.value)} ${unitWord(v.unit, v.value)}`;
  };
  const memberRows = (members, withValues) => {
    const rows = members.map((m) => {
      const p = P(m.pizzaId);
      const layer = p.layers[m.layerIndex];
      const has = p.sizes.includes(size);
      const v = withValues && has ? groupValue(layer, size, grams) : null;
      return { p, v, has };
    });
    const anyValue = rows.some((r) => r.v);
    rows.sort((a, b) => (Number(b.has) - Number(a.has)) || ((b.v ? b.v.value : -1) - (a.v ? a.v.value : -1)) || a.p.name.localeCompare(b.p.name));
    return el('ul', { class: 'rows' }, rows.map(({ p, v, has }) => pizzaRow(data, p,
      el('span', { class: 'row-sizes' }, v ? el('span', { class: `val val-${v.kind}`, text: valueText(v) }) : !has && anyValue ? el('span', { class: 'muted small', text: `no ${shortSizeName(data, size)}` }) : null),
      size)));
  };
  const section = (title, hint, cards) => {
    const kept = cards.filter(Boolean);
    if (!kept.length) return;
    list.append(el('section', { class: 'group' },
      el('h2', { class: 'group-title' }, title),
      hint ? el('p', { class: 'muted small group-hint', text: hint }) : null,
      kept));
  };
  const groupCard = (g, withValues) => (matches(g.title, g.members)
    ? el('div', { class: 'share-card' },
      el('h3', { class: 'share-title' }, codePill(g.code), el('span', { text: g.title }), el('span', { class: 'count', text: String(g.members.length) })),
      memberRows(g.members, withValues))
    : null);

  const { base, extra, post, shared, unique } = sharedSections(data);
  section('Different sauce or cheese', 'Not the usual pizza sauce and cheese.', base.map((g) => groupCard(g, true)));
  section('Extra cheese on top', null, [matches('extra cheese', extra) ? el('div', { class: 'share-card' }, memberRows(extra, true)) : null]);
  section('After the bake', null, [matches('after the bake', post) ? el('div', { class: 'share-card' },
    el('ul', { class: 'rows' }, post.map((m) => {
      const p = P(m.pizzaId);
      const l = p.layers[m.layerIndex];
      return pizzaRow(data, p, el('span', { class: 'row-sizes' }, codePill(l.code), el('span', { class: 'muted small', text: l.name })), size);
    }))) : null]);
  section('Toppings on more than one pizza', `Counts are for a ${shortSizeName(data, size)}${grams ? '' : ' (per slice where the card gives it)'}.`, shared.map((g) => groupCard(g, true)));
  section('Only on one pizza', null, [unique.some((g) => matches(g.title, g.members)) ? el('div', { class: 'share-card' },
    el('ul', { class: 'rows' }, unique.filter((g) => matches(g.title, g.members)).map((g) => {
      const p = P(g.members[0].pizzaId);
      return el('li', null, el('a', { class: 'row', href: `#/pizza/${encodeURIComponent(p.id)}` },
        el('span', { class: 'row-main' },
          el('span', { class: 'row-name' }, codePill(g.code), ` ${g.title}`),
          el('span', { class: 'muted small', text: `only on ${p.name}` }))));
    }))) : null]);
  if (!list.querySelector('.share-card')) list.append(el('p', { class: 'empty', text: 'Nothing matches that search.' }));
}

export function renderPizza(id, sizeArg) {
  const data = getData();
  const pizza = pizzaById(data, id);
  if (!pizza) {
    screen({ title: 'Not found', back: '#/browse', body: el('p', { class: 'empty', text: "That pizza isn't in your builds file." }), tab: 'browse' });
    return;
  }
  const filtered = state.filters().sizes;
  let size = [sizeArg, lastSize, ...filtered].find((s) => s && pizza.sizes.includes(s)) || pizza.sizes[0];

  const holder = el('div');
  const switcher = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'Size' });
  const draw = () => {
    lastSize = size;
    clear(switcher);
    for (const s of pizza.sizes) {
      switcher.append(el('button', {
        type: 'button', role: 'tab', class: `seg-btn seg-${s}${s === size ? ' on' : ''}`, 'aria-selected': String(s === size),
        onclick: () => { size = s; draw(); },
      }, sizeBadge(data, s), el('span', { text: shortSizeName(data, s) })));
    }
    clear(holder);
    holder.append(buildView(data, pizza, size, { grams: state.filters().grams }));
  };
  draw();

  const body = el('div', { class: 'pizza' },
    el('div', { class: 'pizza-head' },
      el('h2', { class: 'pizza-name', text: pizza.name }),
      el('div', { class: 'pizza-meta' }, codePill(pizza.code), el('span', { class: 'muted', text: pizza.range }),
        isLimited(pizza) ? el('span', { class: hasEnded(pizza) ? 'ended' : 'limited-tag', text: hasEnded(pizza) ? `Ended ${formatDay(pizza.limitedUntil)}` : `Limited time · until ${formatDay(pizza.limitedUntil)}` }) : null)),
    pizza.sizes.length > 1 ? switcher : el('div', { class: 'seg seg-one' }, sizeBadge(data, size, { long: true })),
    holder,
    pizzaInfo(pizza));

  const footer = el('div', { class: 'foot-row' },
    el('a', { class: 'btn', href: `#/quiz/flash/${encodeURIComponent(pizza.id)}` }, 'Flashcards'),
    el('a', { class: 'btn btn-primary', href: `#/quiz/build/${encodeURIComponent(pizza.id)}` }, 'Build it'));
  screen({ title: pizza.code, back: '#/browse', backText: 'Browse', body, footer, tab: 'browse' });
}
