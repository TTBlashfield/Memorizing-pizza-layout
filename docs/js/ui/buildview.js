// The build for one pizza at one size, as numbered steps. Used by the pizza page,
// flashcard backs and the "Build it" answer.
import { amountExtras, steps, formatAmount, formatNum } from '../data.js';
import { isNum } from '../util.js';
import { amountNode, codePill, el, flagBox, noteLine } from './dom.js';

/**
 * marks: optional Map(layerIndex -> { bad: bool, yours: string }) to highlight mistakes.
 */
export function buildView(data, pizza, size, { marks = null, compact = false, grams = true } = {}) {
  const all = steps(pizza);
  const pre = all.filter((s) => s.stage !== 'postbake');
  const post = all.filter((s) => s.stage === 'postbake');
  return el('div', { class: `build${compact ? ' build-compact' : ''}` },
    el('ol', { class: 'build-steps' }, pre.map((st) => stepNode(st, size, marks, grams))),
    post.length ? el('div', { class: 'after-bake' },
      el('h3', { class: 'after-bake-title', text: 'After the bake' }),
      el('ol', { class: 'build-steps' }, post.map((st) => stepNode(st, size, marks, grams)))) : null);
}

function stepNode(st, size, marks, grams) {
  return el('li', { class: 'step', dataset: { step: String(st.n) } },
    el('span', { class: 'step-n', 'aria-label': `Step ${st.n}`, text: String(st.n) }),
    el('div', { class: 'step-layers' }, st.items.map(({ index, layer }) => layerNode(layer, index, size, marks, grams)),
      st.items.length > 1 ? el('p', { class: 'step-hint', text: 'Same step: either order' }) : null));
}

/**
 * The number shown for a layer. With grams: the amount, plus per slice / lines as extras.
 * Without: per slice if the card gives it, else the count (slices, pieces, lines), else nothing.
 */
function amountParts(layer, size, grams) {
  if (grams) return { main: amountNode(layer.amounts[size], layer.unit), extras: amountExtras(layer, size) };
  const lines = layer.lines && isNum(layer.lines[size]) ? layer.lines[size] : null;
  if (layer.perSlice && isNum(layer.perSlice[size])) {
    const extras = [];
    if (layer.unit !== 'g') extras.push(`${formatAmount(layer.amounts[size], layer.unit)} in total`);
    if (lines !== null) extras.push(formatAmount(lines, 'lines'));
    return {
      main: el('span', { class: 'amt' }, el('span', { class: 'amt-n', text: formatNum(layer.perSlice[size]) }), el('span', { class: 'amt-u', text: ' per slice' })),
      extras,
    };
  }
  if (layer.unit !== 'g') return { main: amountNode(layer.amounts[size], layer.unit), extras: lines !== null ? [formatAmount(lines, 'lines')] : [] };
  if (lines !== null) return { main: amountNode(lines, 'lines'), extras: [] };
  return { main: null, extras: [] };
}

function layerNode(layer, index, size, marks, grams) {
  const m = marks && marks.get(index);
  const { main, extras } = amountParts(layer, size, grams);
  return el('div', { class: `layer${m && m.bad ? ' layer-bad' : ''}${m && m.ok ? ' layer-ok' : ''}`, dataset: { layer: String(index) } },
    el('div', { class: 'layer-row' },
      el('div', { class: 'layer-name' }, codePill(layer.code), el('span', { text: layer.name }), layer.flag ? el('span', { class: 'flag-dot', title: 'Check with your manager', text: '⚠' }) : null),
      el('div', { class: 'layer-amt' },
        m && m.bad && m.yours !== undefined ? el('s', { class: 'yours', text: m.yours || '—' }) : null,
        main)),
    extras.length ? el('div', { class: 'layer-extra', text: `· ${extras.join(' · ')}` }) : null,
    m && m.reason ? el('div', { class: 'layer-why', text: m.reason }) : null,
    layer.note ? noteLine(layer.note) : null,
    layer.flag ? flagBox(layer.flag) : null);
}

/** Base / placement / facts block for a pizza. */
export function pizzaInfo(pizza, { facts = true } = {}) {
  const rows = [];
  if (pizza.base) rows.push(el('div', { class: 'info' }, el('h3', { text: 'Base' }), el('p', { text: pizza.base })));
  if (pizza.placement) rows.push(el('div', { class: 'info' }, el('h3', { text: 'Placement' }), el('p', { text: pizza.placement })));
  if (facts && pizza.facts.length) {
    rows.push(el('div', { class: 'info' }, el('h3', { text: 'Good to know' }),
      el('dl', { class: 'facts' }, pizza.facts.map((f) => [el('dt', { text: f.q }), el('dd', { text: f.a })]))));
  }
  if (!pizza.orderMatters) rows.push(el('p', { class: 'muted', text: 'The card gives no topping order for this one.' }));
  return rows.length ? el('div', { class: 'infos' }, rows) : null;
}
