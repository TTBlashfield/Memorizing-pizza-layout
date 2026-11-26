// Quiz sessions and the renderers for each kind of question.
import { getData, getProgress, recordAnswer } from '../store.js';
import { buildOrder, layerTitle, parseAmountInput, sameAmount, shortSizeName, steps, unitWord, formatAmount } from '../data.js';
import { makeQuestion, modeTitle, pizzaById, pizzaItems } from '../questions.js';
import { buildSession, weakSpots, requeue, dayIndex } from '../srs.js';
import { checkOrder, checkPicks } from '../order.js';
import { buildNotifyQueue } from '../notify.js';
import { shuffle } from '../util.js';
import * as state from '../state.js';
import { el, clear, screen, contextLine, codePill, flagBox, noteLine, sizeBadge } from './dom.js';
import { buildView, pizzaInfo } from './buildview.js';

const MAX_REPEATS = 2; // a missed question comes back up to twice in one session
const MORE = 3;

// ---------- starting sessions ----------

export function renderQuiz(mode, pizzaId) {
  const data = getData();
  const progress = getProgress();
  const today = dayIndex();
  const items = state.items();
  let list;
  let title = modeTitle(mode);
  let exit = '#/';
  if (mode === 'weak') {
    list = weakSpots(items, progress);
  } else if (mode === 'due') {
    title = 'Practice';
    list = buildSession(items, progress, today);
  } else if (pizzaId) {
    const p = pizzaById(data, pizzaId);
    list = shuffle(pizzaItems(data, pizzaId, mode));
    exit = `#/pizza/${encodeURIComponent(pizzaId)}`;
    if (p) title = `${modeTitle(mode)} · ${p.code}`;
  } else if (['flash', 'build', 'portions', 'codes', 'rules'].includes(mode)) {
    list = buildSession(items.filter((it) => it.mode === mode), progress, today);
  } else {
    location.replace('#/');
    return;
  }
  runSession({ mode, title, items: list, exit });
}

/** #/q/<key>: one question (from a notification), then offer a quick burst. */
export function renderDeepLink(rawKey) {
  let key = rawKey;
  try { key = decodeURIComponent(rawKey); } catch { /* use as is */ }
  const item = state.allItems().find((it) => it.key === key);
  if (!item) {
    screen({
      title: 'Quick question', back: '#/', backIcon: 'close',
      body: el('div', { class: 'card' },
        el('h2', { text: "That question isn't available" }),
        el('p', { text: 'It may be from an older builds file. Your next notification will have a fresh one.' })),
      footer: el('a', { class: 'btn btn-primary btn-big', href: '#/quiz/due' }, 'Practise now'),
    });
    return;
  }
  runSession({ mode: 'single', title: 'Quick question', items: [item], exit: '#/', burst: true });
}

function moreItems(exclude) {
  const recent = new Set(exclude);
  return buildNotifyQueue(state.items(), getProgress(), dayIndex(), { size: MORE + exclude.length, recent })
    .filter((it) => !recent.has(it.key)).slice(0, MORE);
}

// ---------- the session runner ----------

function runSession(cfg) {
  if (!cfg.items.length) {
    screen({
      title: cfg.title, back: cfg.exit, backIcon: 'close', backLabel: 'Close',
      body: el('div', { class: 'card' },
        el('h2', { text: cfg.mode === 'weak' ? 'No weak spots right now' : 'Nothing to practise here' }),
        el('p', { text: cfg.mode === 'weak'
          ? 'Questions you miss show up here until you get them right a few times in a row.'
          : 'Try turning on more ranges or sizes on the Home screen.' })),
      footer: el('a', { class: 'btn btn-primary btn-big', href: cfg.exit }, 'Back'),
    });
    return;
  }
  const s = {
    ...cfg,
    queue: cfg.items.map((item) => ({ item, attempt: 0 })),
    pos: 0,
    first: new Map(),
    missed: [],
    done: [],
  };
  show(s);
}

function show(s) {
  const data = getData();
  const entry = s.queue[s.pos];
  if (!entry) { summary(s); return; }
  const q = makeQuestion(entry.item, data, { filters: state.filters() });
  if (!q || !RENDER[q.kind]) { s.pos++; show(s); return; }

  const footer = el('div', { class: 'foot-row' });
  const ctx = {
    data, q, item: entry.item, footer,
    isLast: () => s.pos >= s.queue.length - 1,
    done: (correct, extra = {}) => finish(s, entry, q, correct, extra),
    next: () => { clearTimeout(s.timer); s.pos++; show(s); },
    nextButton: (label) => el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => ctx.next() },
      label || (s.pos >= s.queue.length - 1 ? 'Finish' : 'Next')),
    autoNext: () => { s.timer = setTimeout(() => { if (s.queue[s.pos] === entry) ctx.next(); }, 750); },
  };
  const body = RENDER[q.kind](q, ctx);
  const total = s.queue.length;
  const bar = el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(s.pos) },
    el('span', { class: 'progress-fill', style: null }));
  bar.firstChild.style.width = `${Math.round((s.pos / total) * 100)}%`;
  screen({
    title: s.title,
    back: () => { clearTimeout(s.timer); location.hash = s.exit; },
    backIcon: 'close', backLabel: 'End session',
    right: el('span', { class: 'counter', text: `${s.pos + 1} / ${total}` }),
    below: bar,
    body: el('div', { class: `quiz quiz-${q.kind}`, dataset: { key: entry.item.key, kind: q.kind } }, body),
    footer,
    cls: 'scroll-quiz',
  });
}

function finish(s, entry, q, correct, extra) {
  if (entry.answered) return;
  entry.answered = true;
  recordAnswer(entry.item.key, correct);
  for (const p of extra.portions || []) recordAnswer(p.key, p.correct, { count: false });
  if (!s.first.has(entry.item.key)) {
    s.first.set(entry.item.key, correct);
    s.done.push(entry.item.key);
    if (!correct) s.missed.push({ item: entry.item, q, answer: extra.answerText || answerText(q) });
  }
  if (!correct && entry.attempt < MAX_REPEATS) {
    s.queue = requeue(s.queue, s.pos, { item: entry.item, attempt: entry.attempt + 1 }, 3);
  }
  state.hooks.afterAnswer();
}

function answerText(q) {
  if (q.kind === 'mc') return q.answer;
  if (q.kind === 'flip') return q.back;
  if (q.kind === 'multi') return q.options.filter((o) => o.correct).map((o) => o.label).join(', ');
  return null;
}

function summary(s) {
  const data = getData();
  const total = s.first.size;
  const right = [...s.first.values()].filter(Boolean).length;
  const missedList = s.missed.length
    ? el('div', { class: 'card' },
      el('h3', { text: 'To go over' }),
      el('ul', { class: 'missed' }, s.missed.map((m) => el('li', null,
        contextLine(data, m.q.context),
        el('div', { class: 'missed-q', text: missedPrompt(m.q) }),
        m.answer ? el('div', { class: 'missed-a', text: m.answer }) : null,
        m.item.pizzaId ? el('a', { class: 'link', href: `#/pizza/${encodeURIComponent(m.item.pizzaId)}${m.item.size ? `/${m.item.size}` : ''}` }, 'See the build') : null))))
    : null;
  const body = el('div', { class: 'summary' },
    el('div', { class: 'score' },
      el('span', { class: 'score-n', text: `${right}/${total}` }),
      el('span', { class: 'score-l', text: total === 1 ? (right ? 'Right!' : 'Not this time') : 'right first time' })),
    el('p', { class: 'muted center', text: right === total ? 'Nice. Those will come back later so they stick.' : 'Missed ones come back sooner, and show up in Weak spots.' }),
    missedList);
  const footer = el('div', { class: 'foot-row' });
  if (s.burst) {
    footer.append(
      el('a', { class: 'btn', href: '#/' }, 'Done'),
      el('button', {
        type: 'button', class: 'btn btn-primary',
        onclick: () => runSession({ mode: 'burst', title: `${MORE} more`, items: moreItems(s.done), exit: '#/', burst: true }),
      }, `${MORE} more?`));
  } else {
    footer.append(
      el('a', { class: 'btn', href: s.exit }, s.exit === '#/' ? 'Home' : 'Back'),
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => {
        if (s.exit !== '#/' || s.mode === 'single') runSession({ ...s, items: shuffle(s.items) });
        else renderQuiz(s.mode);
      } }, 'Go again'));
  }
  screen({ title: s.title, back: s.exit, backIcon: 'close', backLabel: 'Close', body, footer });
}

function missedPrompt(q) {
  if (q.kind === 'mc') return `${q.subject ? `${q.subject.name || q.subject.code}: ` : ''}${q.ask}`;
  if (q.kind === 'flip') return q.front;
  if (q.kind === 'multi') return q.prompt;
  if (q.kind === 'build') return 'Build it';
  return 'Flashcard';
}

// ---------- shared bits ----------

function subjectNode(q) {
  if (!q.subject) return null;
  if (q.subject.big) return el('div', { class: 'subject subject-big', text: q.subject.code });
  return el('div', { class: 'subject' }, codePill(q.subject.code), el('span', { text: q.subject.name }));
}

function feedbackNode(correct, answer, notes = [], flags = []) {
  return el('div', { class: `feedback ${correct ? 'fb-right' : 'fb-wrong'}`, role: 'status' },
    el('div', { class: 'fb-head' },
      el('span', { class: 'fb-mark', 'aria-hidden': 'true', text: correct ? '✓' : '✗' }),
      el('span', { text: correct ? 'Right' : 'The answer is ' }),
      !correct && answer ? el('strong', { class: 'fb-answer', text: answer }) : null),
    notes.map((n) => noteLine(n)),
    flags.map((f) => flagBox(f)));
}

function gradeButtons(ctx, onGrade) {
  clear(ctx.footer);
  ctx.footer.append(
    el('button', { type: 'button', class: 'btn btn-wrong', onclick: () => onGrade(false) }, 'Missed it'),
    el('button', { type: 'button', class: 'btn btn-right', onclick: () => onGrade(true) }, 'Got it'));
}

// ---------- renderers ----------

function renderMc(q, ctx) {
  const feedback = el('div', { class: 'fb-slot', 'aria-live': 'polite' });
  const long = q.options.some((o) => o.label.length > 12);
  const opts = el('div', { class: `options ${long ? 'options-list' : 'options-grid'}${q.mono ? ' mono' : ''}` });
  let answered = false;
  const buttons = q.options.map((o) => {
    const b = el('button', { type: 'button', class: 'opt', onclick: () => pick(o, b) }, o.label);
    return b;
  });
  function pick(o, b) {
    if (answered) return;
    answered = true;
    buttons.forEach((btn, i) => {
      const opt = q.options[i];
      btn.disabled = true;
      if (opt.correct) btn.classList.add('opt-right');
      else if (btn === b) btn.classList.add('opt-wrong');
      else btn.classList.add('opt-dim');
    });
    feedback.append(feedbackNode(o.correct, q.answer, q.notes, q.flags));
    ctx.done(o.correct);
    ctx.footer.append(ctx.nextButton());
    if (o.correct && !q.notes.length && !q.flags.length && !ctx.isLast()) ctx.autoNext();
  }
  opts.append(...buttons);
  return [
    el('div', { class: 'q-top' }, contextLine(ctx.data, q.context), subjectNode(q), el('p', { class: 'ask', text: q.ask }), feedback),
    opts,
  ];
}

function renderFlip(q, ctx) {
  const answer = el('div', { class: 'flip-answer', hidden: true }, el('p', { text: q.back }), q.flags.map((f) => flagBox(f)));
  const reveal = () => {
    answer.hidden = false;
    card.classList.add('flipped');
    gradeButtons(ctx, (ok) => { ctx.done(ok); ctx.next(); });
  };
  const card = el('button', { type: 'button', class: 'flipcard', onclick: () => { if (answer.hidden) reveal(); } },
    el('span', { class: 'flip-q', text: q.front }),
    el('span', { class: 'flip-tap', text: 'Tap to see the answer' }));
  ctx.footer.append(el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: reveal }, 'Show answer'));
  return [el('div', { class: 'q-top' }, contextLine(ctx.data, q.context)), card, answer];
}

function renderFlash(q, ctx) {
  const data = ctx.data;
  const pizza = pizzaById(data, q.pizzaId);
  const back = el('div', { class: 'flash-back', hidden: true });
  const front = el('button', { type: 'button', class: 'flashcard', onclick: () => { if (back.hidden) reveal(); } },
    sizeBadge(data, q.size, { long: true }),
    el('span', { class: 'flash-title', text: `${shortSizeName(data, q.size)} · ${pizza.name}` }),
    el('span', { class: 'flash-code', text: `(${pizza.code})` }),
    el('span', { class: 'flip-tap', text: 'Picture the whole build, then tap to flip' }));
  function reveal() {
    back.hidden = false;
    front.classList.add('flipped');
    back.append(buildView(data, pizza, q.size), pizzaInfo(pizza, { facts: false }));
    gradeButtons(ctx, (ok) => { ctx.done(ok); ctx.next(); });
    back.scrollIntoView({ block: 'start' });
  }
  ctx.footer.append(el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: reveal }, 'Show build'));
  return [front, back];
}

function renderMulti(q, ctx) {
  const chosen = new Set();
  const feedback = el('div', { class: 'fb-slot', 'aria-live': 'polite' });
  const chips = q.options.map((o) => {
    const b = el('button', {
      type: 'button', class: 'pick', 'aria-pressed': 'false',
      onclick: () => {
        if (b.disabled) return;
        if (chosen.has(o.id)) chosen.delete(o.id); else chosen.add(o.id);
        b.classList.toggle('on', chosen.has(o.id));
        b.setAttribute('aria-pressed', String(chosen.has(o.id)));
      },
    }, el('span', { class: 'pick-name', text: o.label }), codePill(o.code));
    return b;
  });
  const check = () => {
    let ok = true;
    q.options.forEach((o, i) => {
      const b = chips[i];
      b.disabled = true;
      const picked = chosen.has(o.id);
      if (o.correct && picked) b.classList.add('pick-right');
      else if (o.correct && !picked) { b.classList.add('pick-missed'); ok = false; }
      else if (!o.correct && picked) { b.classList.add('pick-wrong'); ok = false; }
      else b.classList.add('pick-dim');
    });
    feedback.append(feedbackNode(ok, q.options.filter((o) => o.correct).map((o) => o.label).join(', ')));
    ctx.done(ok);
    clear(ctx.footer);
    ctx.footer.append(ctx.nextButton());
  };
  ctx.footer.append(el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: check }, 'Check'));
  return [
    el('div', { class: 'q-top' }, contextLine(ctx.data, q.context), el('p', { class: 'ask ask-big', text: q.prompt }),
      el('p', { class: 'muted', text: 'Tap all that apply.' }), feedback),
    el('div', { class: 'picks' }, chips),
  ];
}

function renderBuild(q, ctx) {
  const data = ctx.data;
  const pizza = pizzaById(data, q.pizzaId);
  const size = q.size;
  const ordered = pizza.orderMatters;
  const root = el('div', { class: 'buildit' });
  let tapped = [];
  let orderResult = null;

  const head = () => el('div', { class: 'q-top' }, contextLine(data, q.context));

  function pickPhase() {
    clear(root);
    clear(ctx.footer);
    const tray = el('ol', { class: `tray${ordered ? '' : ' tray-unordered'}`, 'aria-label': 'Your build' });
    const palette = el('div', { class: 'palette', 'aria-label': 'Toppings' });
    const checkBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: checkOrderNow }, ordered ? 'Check order' : 'Check toppings');
    const clearBtn = el('button', { type: 'button', class: 'btn', onclick: () => { tapped = []; draw(); } }, 'Clear');
    const draw = () => {
      clear(tray);
      clear(palette);
      if (!tapped.length) tray.append(el('li', { class: 'tray-empty', text: ordered ? 'Tap the toppings below in build order' : 'Tap the toppings that go on' }));
      tapped.forEach((chip, i) => tray.append(el('li', null, el('button', {
        type: 'button', class: 'chip-layer in-tray', 'aria-label': `Remove ${chipLabel(chip)}`,
        onclick: () => { tapped.splice(i, 1); draw(); },
      }, ordered ? el('span', { class: 'tray-n', text: String(i + 1) }) : null, codePill(chip.code), el('span', { text: chip.name })))));
      for (const chip of q.chips) {
        if (tapped.includes(chip)) continue;
        palette.append(el('button', {
          type: 'button', class: 'chip-layer', 'aria-label': chipLabel(chip),
          onclick: () => { tapped.push(chip); draw(); },
        }, codePill(chip.code), el('span', { text: chip.name })));
      }
      checkBtn.disabled = tapped.length === 0;
      clearBtn.disabled = tapped.length === 0;
    };
    root.append(head(),
      el('p', { class: 'ask', text: ordered ? 'Tap the toppings in build order. Sauce and cheese first.' : 'Which toppings go on? (Any order: the card gives no order.)' }),
      tray,
      el('h3', { class: 'palette-title', text: 'Toppings' }),
      palette);
    ctx.footer.append(clearBtn, checkBtn);
    draw();
  }

  function checkOrderNow() {
    orderResult = ordered ? checkOrder(pizza, tapped) : checkPicks(pizza, tapped);
    clear(root);
    clear(ctx.footer);
    const tray = el('ol', { class: 'tray tray-checked', 'aria-label': 'Your build, marked' });
    tapped.forEach((chip, i) => {
      const m = orderResult.marks[i];
      const why = m.reason === 'decoy' ? "doesn't go on" : m.reason === 'order' ? 'out of order' : m.reason === 'extra' ? 'extra' : null;
      tray.append(el('li', { class: `chip-layer ${m.ok ? 'mark-ok' : 'mark-bad'}` },
        ordered ? el('span', { class: 'tray-n', text: String(i + 1) }) : null,
        el('span', { class: 'mark', 'aria-hidden': 'true', text: m.ok ? '✓' : '✗' }),
        codePill(chip.code), el('span', { text: chip.name }),
        why ? el('span', { class: 'why', text: why }) : null));
    });
    const missing = orderResult.missing.map((i) => pizza.layers[i]);
    root.append(head(),
      feedbackNode(orderResult.correct, null),
      el('h3', { text: 'Your build' }), tray,
      missing.length ? el('p', { class: 'missing' }, el('strong', { text: 'Missed: ' }), missing.map((l) => l.name).join(', ')) : null,
      el('h3', { text: ordered ? 'Correct order' : 'What goes on' }),
      orderList(pizza, ordered));
    ctx.footer.append(el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: amountsPhase }, 'Next: portions'));
    root.scrollIntoView({ block: 'start' });
  }

  function amountsPhase() {
    clear(root);
    clear(ctx.footer);
    const inputs = new Map();
    const rows = buildOrder(pizza).map((i) => {
      const layer = pizza.layers[i];
      const id = `amt-${i}`;
      const input = el('input', {
        id, class: 'amt-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', autocorrect: 'off',
        spellcheck: 'false', enterkeyhint: 'next', 'aria-label': `${layerTitle(pizza, i)}, ${unitWord(layer.unit, 2)}`,
      });
      inputs.set(i, input);
      return el('div', { class: 'amt-row' },
        el('label', { for: id, class: 'amt-label' }, codePill(layer.code), el('span', { text: layerTitle(pizza, i) })),
        el('div', { class: 'amt-field' }, input, el('span', { class: 'amt-unit', text: unitWord(layer.unit, 2) })));
    });
    const checkBtn = el('button', { type: 'button', class: 'btn btn-primary btn-big', onclick: () => reveal(inputs) }, 'Check portions');
    root.append(head(),
      el('p', { class: 'ask' }, 'Type each portion for a ', el('strong', { text: shortSizeName(data, size) }), '.'),
      el('div', { class: 'amt-form' }, rows),
      checkBtn);
    setTimeout(() => { const first = inputs.values().next().value; if (first) first.focus({ preventScroll: true }); }, 50);
  }

  function reveal(inputs) {
    const marks = new Map();
    const portions = [];
    let amountsOk = true;
    for (const [i, input] of inputs) {
      const layer = pizza.layers[i];
      const got = parseAmountInput(input.value);
      const ok = sameAmount(got, layer.amounts[size]);
      if (!ok) amountsOk = false;
      portions.push({ key: `portion:${pizza.id}:${size}:${i}`, correct: ok });
      marks.set(i, ok ? { ok: true } : { bad: true, yours: input.value.trim() ? formatAmount(got, layer.unit).replace(/^\?.*/, input.value.trim()) : '' });
    }
    for (const m of orderResult.marks) {
      if (!m.ok && m.reason === 'order' && m.index !== undefined) {
        marks.set(m.index, { ...(marks.get(m.index) || {}), bad: true, reason: 'Out of order' });
      }
    }
    for (const i of orderResult.missing) marks.set(i, { ...(marks.get(i) || {}), bad: true, reason: 'You missed this one' });
    const decoys = tapped.filter((c) => c.kind === 'decoy');
    const correct = orderResult.correct && amountsOk;
    const right = portions.filter((p) => p.correct).length;
    clear(root);
    clear(ctx.footer);
    root.append(head(),
      feedbackNode(correct, null),
      el('div', { class: 'result-chips' },
        el('span', { class: `rchip ${orderResult.correct ? 'ok' : 'bad'}`, text: `${ordered ? 'Order' : 'Toppings'} ${orderResult.correct ? '✓' : '✗'}` }),
        el('span', { class: `rchip ${amountsOk ? 'ok' : 'bad'}`, text: `Portions ${right}/${portions.length}` })),
      decoys.length ? el('p', { class: 'missing' }, el('strong', { text: "Doesn't go on: " }), decoys.map((d) => d.name).join(', ')) : null,
      buildView(data, pizza, size, { marks }),
      pizzaInfo(pizza, { facts: false }));
    ctx.done(correct, { portions });
    ctx.footer.append(ctx.nextButton());
    root.scrollIntoView({ block: 'start' });
  }

  pickPhase();
  return [root];
}

function chipLabel(chip) {
  return chip.code ? `${chip.name} (${chip.code})` : chip.name;
}

/** Names only (amounts are asked next, so they're not shown yet). */
function orderList(pizza, ordered) {
  return el('ol', { class: 'order-list' }, steps(pizza).map((st) => el('li', null,
    ordered ? el('span', { class: 'step-n small', text: String(st.n) }) : null,
    el('span', { class: 'order-names' }, st.items.map(({ layer }, k) => [
      k ? el('span', { class: 'amp', text: ' + ' }) : null,
      codePill(layer.code), el('span', { text: layer.name }),
    ])),
    st.stage === 'postbake' ? el('span', { class: 'tag-post', text: 'after the bake' }) : null)));
}

const RENDER = { mc: renderMc, flip: renderFlip, flash: renderFlash, multi: renderMulti, build: renderBuild };
