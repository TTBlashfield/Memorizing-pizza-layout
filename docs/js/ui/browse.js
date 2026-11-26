// Browse: searchable list grouped by range, and the pizza page.
import { getData } from '../store.js';
import { rangesIn, normName, shortSizeName } from '../data.js';
import { pizzaById } from '../questions.js';
import * as state from '../state.js';
import { el, clear, screen, sizeBadge, codePill, icon } from './dom.js';
import { buildView, pizzaInfo } from './buildview.js';

let lastQuery = '';
let lastSize = null;

export function renderBrowse() {
  const data = getData();
  const list = el('div', { class: 'browse-list' });
  const input = el('input', {
    type: 'search', class: 'search', placeholder: 'Search name or code', 'aria-label': 'Search pizzas',
    autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search',
    value: lastQuery,
  });
  const draw = () => {
    lastQuery = input.value;
    const q = normName(input.value);
    clear(list);
    let shown = 0;
    for (const range of rangesIn(data)) {
      const pizzas = data.pizzas.filter((p) => p.range === range
        && (!q || normName(p.name).includes(q) || normName(p.code).includes(q)));
      if (!pizzas.length) continue;
      shown += pizzas.length;
      list.append(el('section', { class: 'group' },
        el('h2', { class: 'group-title' }, range, el('span', { class: 'count', text: String(pizzas.length) })),
        el('ul', { class: 'rows' }, pizzas.map((p) => el('li', null,
          el('a', { class: 'row', href: `#/pizza/${encodeURIComponent(p.id)}` },
            el('span', { class: 'row-main' },
              el('span', { class: 'row-name', text: p.name }),
              el('span', { class: 'row-sizes' }, p.sizes.map((s) => sizeBadge(data, s)))),
            codePill(p.code),
            p.layers.some((l) => l.flag) ? el('span', { class: 'flag-dot', title: 'Has something to check', text: '⚠' }) : null))))));
    }
    if (!shown) list.append(el('p', { class: 'empty', text: `Nothing matches “${input.value}”.` }));
  };
  input.addEventListener('input', draw);
  draw();
  const searchBar = el('div', { class: 'searchbar' }, icon('search', 'ic search-ic'), input);
  screen({ title: 'Browse', below: searchBar, body: list, tab: 'browse' });
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
      el('div', { class: 'pizza-meta' }, codePill(pizza.code), el('span', { class: 'muted', text: pizza.range }))),
    pizza.sizes.length > 1 ? switcher : el('div', { class: 'seg seg-one' }, sizeBadge(data, size, { long: true })),
    holder,
    pizzaInfo(pizza));

  const footer = el('div', { class: 'foot-row' },
    el('a', { class: 'btn', href: `#/quiz/flash/${encodeURIComponent(pizza.id)}` }, 'Flashcards'),
    el('a', { class: 'btn btn-primary', href: `#/quiz/build/${encodeURIComponent(pizza.id)}` }, 'Build it'));
  screen({ title: pizza.code, back: '#/browse', backText: 'Browse', body, footer, tab: 'browse' });
}
