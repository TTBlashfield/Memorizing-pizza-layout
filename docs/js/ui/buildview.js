// The build for one pizza at one size, as numbered steps. Used by the pizza page,
// flashcard backs and the "Build it" answer.
import { amountExtras, steps } from '../data.js';
import { amountNode, codePill, el, flagBox, noteLine } from './dom.js';

/**
 * marks: optional Map(layerIndex -> { bad: bool, yours: string }) to highlight mistakes.
 */
export function buildView(data, pizza, size, { marks = null, compact = false } = {}) {
  const all = steps(pizza);
  const pre = all.filter((s) => s.stage !== 'postbake');
  const post = all.filter((s) => s.stage === 'postbake');
  return el('div', { class: `build${compact ? ' build-compact' : ''}` },
    el('ol', { class: 'build-steps' }, pre.map((st) => stepNode(st, size, marks))),
    post.length ? el('div', { class: 'after-bake' },
      el('h3', { class: 'after-bake-title', text: 'After the bake' }),
      el('ol', { class: 'build-steps' }, post.map((st) => stepNode(st, size, marks)))) : null);
}

function stepNode(st, size, marks) {
  return el('li', { class: 'step', dataset: { step: String(st.n) } },
    el('span', { class: 'step-n', 'aria-label': `Step ${st.n}`, text: String(st.n) }),
    el('div', { class: 'step-layers' }, st.items.map(({ index, layer }) => layerNode(layer, index, size, marks)),
      st.items.length > 1 ? el('p', { class: 'step-hint', text: 'Same step: either order' }) : null));
}

function layerNode(layer, index, size, marks) {
  const m = marks && marks.get(index);
  const extras = amountExtras(layer, size);
  return el('div', { class: `layer${m && m.bad ? ' layer-bad' : ''}${m && m.ok ? ' layer-ok' : ''}`, dataset: { layer: String(index) } },
    el('div', { class: 'layer-row' },
      el('div', { class: 'layer-name' }, codePill(layer.code), el('span', { text: layer.name }), layer.flag ? el('span', { class: 'flag-dot', title: 'Check with your manager', text: '⚠' }) : null),
      el('div', { class: 'layer-amt' },
        m && m.bad && m.yours !== undefined ? el('s', { class: 'yours', text: m.yours || '—' }) : null,
        amountNode(layer.amounts[size], layer.unit))),
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
