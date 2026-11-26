// DOM helpers and small shared components. Text is always set with textContent, never HTML.
import { formatNum, shortSizeName } from '../data.js';
import { pizzaById } from '../questions.js';

export function el(tag, props = null, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'dataset') Object.assign(n.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') n.value = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(n, kids);
  return n;
}

export function append(n, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    n.append(k instanceof Node ? k : String(k));
  }
  return n;
}

export function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  back: 'M15 18l-6-6 6-6',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  check: 'M20 6 9 17l-5-5',
  cross: 'M18 6 6 18M6 6l12 12',
};

export function icon(name, cls = 'ic') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}

/** Coloured size badge. Same colour per size everywhere. */
export function sizeBadge(data, key, { long = false } = {}) {
  const text = long ? shortSizeName(data, key) : (key === 'ONE' ? '1' : key);
  return el('span', { class: `sz sz-${key}${long ? ' sz-long' : ''}`, title: shortSizeName(data, key), text });
}

export function codePill(code) {
  return code ? el('span', { class: 'code', text: code }) : null;
}

export function flagBox(text) {
  return el('div', { class: 'flag', role: 'note' },
    el('span', { class: 'flag-ic', 'aria-hidden': 'true', text: '⚠' }),
    el('div', null, el('strong', { text: 'Check with your manager. ' }), text));
}

export function noteLine(text) {
  return el('p', { class: 'note', text });
}

/** "[L] Large · Some Pizza (SP)" or a plain label. */
export function contextLine(data, ctx) {
  if (!ctx) return null;
  const pizza = ctx.pizzaId ? pizzaById(data, ctx.pizzaId) : null;
  const bits = [];
  if (ctx.size) bits.push(sizeBadge(data, ctx.size));
  const text = [];
  if (ctx.size && pizza) text.push(shortSizeName(data, ctx.size));
  if (pizza) text.push(`${pizza.name} (${pizza.code})`);
  else if (ctx.label) text.push(ctx.label);
  return el('div', { class: 'ctx' }, bits, el('span', { class: 'ctx-text', text: text.join(' · ') }));
}

/** Big number + small unit. */
export function amountNode(n, unit) {
  const unitText = unit === 'g' ? 'g' : ` ${unit === 'slices' ? (n === 1 ? 'slice' : 'slices') : unit === 'pieces' ? (n === 1 ? 'piece' : 'pieces') : n === 1 ? 'line' : 'lines'}`;
  return el('span', { class: 'amt' }, el('span', { class: 'amt-n', text: formatNum(n) }), el('span', { class: 'amt-u', text: unitText }));
}

let toastTimer = null;
export function toast(message, { error = false, ms = 2600 } = {}) {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(t);
  }
  t.textContent = message;
  t.className = `toast show${error ? ' toast-error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

/**
 * Render a screen into #app.
 * opts: { title, back (hash or fn), right (node), body (node), footer (node), tab ('home'|'browse'|'settings'|null), cls }
 */
export function screen(opts) {
  const app = document.getElementById('app');
  const backBtn = opts.back
    ? el('button', {
      class: 'bar-btn', 'aria-label': opts.backLabel || 'Back',
      onclick: () => (typeof opts.back === 'function' ? opts.back() : (location.hash = opts.back)),
    }, icon(opts.backIcon || 'back'), opts.backText ? el('span', { text: opts.backText }) : null)
    : el('span', { class: 'bar-spacer' });
  const header = el('header', { class: 'bar' },
    el('div', { class: 'bar-in' },
      backBtn,
      el('h1', { class: 'bar-title', text: opts.title || 'Makeline Trainer' }),
      opts.right || el('span', { class: 'bar-spacer' })),
    opts.below || null);
  const main = el('main', { class: `scroll ${opts.cls || ''}`, id: 'main' }, el('div', { class: 'content' }, opts.body));
  const parts = [header, main];
  if (opts.footer) parts.push(el('footer', { class: 'foot' }, opts.footer));
  if (opts.tab !== undefined && opts.tab !== null) parts.push(tabBar(opts.tab));
  clear(app);
  append(app, parts);
  app.className = opts.tab ? 'has-tabs' : '';
  main.scrollTop = 0;
  return { header, main };
}

function tabBar(active) {
  const tab = (id, label, ic, hash) => el('a', {
    class: `tab${active === id ? ' on' : ''}`, href: hash, 'aria-current': active === id ? 'page' : null,
  }, icon(ic), el('span', { text: label }));
  return el('nav', { class: 'tabs', 'aria-label': 'Main' },
    tab('home', 'Home', 'home', '#/'),
    tab('browse', 'Browse', 'list', '#/browse'),
    tab('settings', 'Settings', 'gear', '#/settings'));
}

export function button(text, onclick, cls = 'btn') {
  return el('button', { class: cls, type: 'button', onclick }, text);
}

export const isStandalone = () =>
  (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** "Add to Home Screen" steps for iPhone. */
export function installSteps() {
  return el('ol', { class: 'steps-list' },
    el('li', null, 'In ', el('strong', { text: 'Safari' }), ', tap the ', el('strong', { text: 'Share' }), ' button (the square with an arrow).'),
    el('li', null, 'Scroll down and tap ', el('strong', { text: 'Add to Home Screen' }), '. Leave “Open as Web App” on.'),
    el('li', null, 'Open ', el('strong', { text: 'Makeline' }), ' from your Home Screen, not from Safari.'));
}
