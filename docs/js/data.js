// Loading, validating and describing a builds file. Pure: no DOM, no storage.
// Nothing in here knows any real pizza. Every name, code and amount comes from the file.
import { isNum, isStr, isObj } from './util.js';

export const SCHEMA = 'makeline-builds/v1';
export const SIZE_KEYS = ['P', 'S', 'M', 'L', 'ONE'];
export const UNITS = ['g', 'slices', 'pieces', 'lines'];
export const STAGES = ['prebake', 'postbake'];
export const RANGE_ORDER = ['Classics', 'Italianos', 'Plant Based', 'Cheeky Little'];

const MAX_ERRORS = 12;

/** Parse text (from a file or the paste box) and validate it. */
export function parseBuildsText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, errors: ['The file is empty.'], warnings: [] };
  }
  const clean = text.replace(/^﻿/, '');
  let obj;
  try {
    obj = JSON.parse(clean);
  } catch (e) {
    // Notes apps sometimes turn straight quotes into curly ones. Try fixing that once.
    if (/[“”]/.test(clean)) {
      try {
        obj = JSON.parse(clean.replace(/[“”]/g, '"'));
        const res = validateBuilds(obj);
        if (res.ok) res.warnings.unshift('Curly quotes were swapped for straight ones so the file could be read.');
        return res;
      } catch { /* fall through to the friendly error */ }
    }
    return {
      ok: false,
      errors: [`This isn't valid JSON, so it can't be read. Make sure you picked or pasted the whole builds.json file. (${e.message})`],
      warnings: [],
    };
  }
  return validateBuilds(obj);
}

/**
 * Check a parsed builds object. Returns { ok, data, errors, warnings, stats }.
 * `data` is a cleaned copy with optional fields filled in (facts: [], base: null, ...).
 */
export function validateBuilds(obj) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!isObj(obj)) {
    return { ok: false, errors: ["This file doesn't contain a builds object."], warnings };
  }
  if (obj.schema !== SCHEMA) {
    const msg = obj.schema === undefined
      ? `This doesn't look like a Makeline builds file: it has no "schema" field. It should say "${SCHEMA}".`
      : `This file's schema is "${String(obj.schema)}", but Makeline Trainer needs "${SCHEMA}".`;
    return { ok: false, errors: [msg], warnings };
  }

  // Sizes
  const sizes = [];
  const sizeNames = {};
  if (!Array.isArray(obj.sizes) || obj.sizes.length === 0) {
    err('"sizes" must be a list of sizes (Personal, Small, ...).');
  } else {
    obj.sizes.forEach((s, i) => {
      if (!isObj(s) || !SIZE_KEYS.includes(s.key)) {
        err(`Size #${i + 1} needs a key of ${SIZE_KEYS.join(', ')}.`);
        return;
      }
      if (sizeNames[s.key]) { err(`Size ${s.key} is listed twice.`); return; }
      if (!isStr(s.name)) err(`Size ${s.key} needs a name.`);
      if (!(s.slices === null || isNum(s.slices))) err(`Size ${s.key}: "slices" must be a number or null.`);
      sizeNames[s.key] = isStr(s.name) ? s.name : s.key;
      sizes.push({ key: s.key, name: sizeNames[s.key], slices: isNum(s.slices) ? s.slices : null });
    });
    sizes.sort((a, b) => SIZE_KEYS.indexOf(a.key) - SIZE_KEYS.indexOf(b.key));
  }
  const sizeLabel = (k) => sizeNames[k] || k;

  // Topping codes
  const toppingCodes = {};
  if (obj.toppingCodes === undefined) {
    warn('No "toppingCodes" found, so the topping-code quiz will be empty.');
  } else if (!isObj(obj.toppingCodes)) {
    err('"toppingCodes" must map codes to names, like { "X": "Pizza sauce" }.');
  } else {
    for (const [code, name] of Object.entries(obj.toppingCodes)) {
      if (isStr(code) && isStr(name)) toppingCodes[code] = name;
      else warn(`Topping code "${code}" was skipped because it has no name.`);
    }
  }

  const generalFacts = readFacts(obj.generalFacts, 'General facts', err, warn);

  // Pizzas
  const pizzas = [];
  if (!Array.isArray(obj.pizzas) || obj.pizzas.length === 0) {
    err('"pizzas" must be a list with at least one pizza.');
  } else {
    const ids = new Set();
    obj.pizzas.forEach((p, pi) => {
      const where = `Pizza #${pi + 1}${isObj(p) && isStr(p.name) ? ` “${p.name}”` : ''}`;
      if (!isObj(p)) { err(`${where} isn't an object.`); return; }
      const before = errors.length;
      if (!isStr(p.id)) err(`${where} needs an "id".`);
      else if (ids.has(p.id)) err(`${where}: the id "${p.id}" is used by another pizza. Each id must be unique.`);
      else ids.add(p.id);
      if (!isStr(p.name)) err(`${where} needs a "name".`);
      if (!isStr(p.code)) err(`${where} needs a "code".`);
      // Limited-time pizzas (e.g. range "Christmas") say when they end: "limitedUntil": "2027-01-03".
      let limitedUntil = null;
      if (p.limitedUntil !== undefined && p.limitedUntil !== null) {
        if (isIsoDate(p.limitedUntil)) limitedUntil = p.limitedUntil;
        else err(`${where}: "limitedUntil" must be a date like "2027-01-03".`);
      }
      if (!isStr(p.range)) err(`${where} needs a "range".`);
      else if (!RANGE_ORDER.includes(p.range) && !limitedUntil && p.limitedUntil === undefined) {
        warn(`${where}: range "${p.range}" isn't one of ${RANGE_ORDER.join(', ')}. It will be listed last.`);
      }

      let psizes = [];
      if (!Array.isArray(p.sizes) || p.sizes.length === 0) {
        err(`${where} needs a list of "sizes".`);
      } else {
        for (const k of p.sizes) {
          if (!sizeNames[k]) err(`${where}: size "${k}" isn't in the file's size list.`);
          else if (psizes.includes(k)) warn(`${where}: size ${k} is listed twice.`);
          else psizes.push(k);
        }
        psizes.sort((a, b) => SIZE_KEYS.indexOf(a) - SIZE_KEYS.indexOf(b));
      }

      let orderMatters = p.orderMatters;
      if (typeof orderMatters !== 'boolean') {
        if (orderMatters !== undefined) err(`${where}: "orderMatters" must be true or false.`);
        else warn(`${where}: "orderMatters" is missing, so order will be checked.`);
        orderMatters = true;
      }
      const base = readNullableText(p.base, `${where}: "base"`, err);
      const placement = readNullableText(p.placement, `${where}: "placement"`, err);
      const facts = readFacts(p.facts, `${where} facts`, err, warn);

      const layers = [];
      if (!Array.isArray(p.layers) || p.layers.length === 0) {
        err(`${where} needs at least one layer.`);
      } else {
        let lastSeq = -Infinity;
        p.layers.forEach((l, li) => {
          const lw = `${where}, layer ${li + 1}${isObj(l) && isStr(l.name) ? ` “${l.name}”` : ''}`;
          if (!isObj(l)) { err(`${lw} isn't an object.`); return; }
          if (!isNum(l.seq)) err(`${lw} needs a "seq" number (its build step).`);
          else {
            if (l.seq < lastSeq) warn(`${lw}: steps aren't in order. They'll be sorted by "seq".`);
            lastSeq = Math.max(lastSeq, l.seq);
          }
          let code = l.code;
          if (code === undefined || code === '') code = null;
          if (code !== null && !isStr(code)) err(`${lw}: "code" must be text or null.`);
          if (!isStr(l.name)) err(`${lw} needs a "name".`);
          if (!UNITS.includes(l.unit)) err(`${lw}: unit "${l.unit}" should be one of ${UNITS.join(', ')}.`);
          if (!STAGES.includes(l.stage)) err(`${lw}: stage should be "prebake" or "postbake".`);

          const amounts = {};
          if (!isObj(l.amounts)) {
            err(`${lw} needs "amounts" for each size.`);
          } else {
            for (const k of psizes) {
              if (isNum(l.amounts[k])) amounts[k] = l.amounts[k];
              else err(`${lw}: the amount for ${sizeLabel(k)} is missing or not a number.`);
            }
            const extra = Object.keys(l.amounts).filter((k) => !psizes.includes(k));
            if (extra.length) warn(`${lw}: amounts for ${extra.join(', ')} were ignored because the pizza doesn't come in that size.`);
          }

          const layer = { seq: l.seq, code, name: l.name, unit: l.unit, amounts, stage: l.stage };
          for (const field of ['perSlice', 'lines']) {
            if (l[field] === undefined || l[field] === null) continue;
            if (!isObj(l[field])) { err(`${lw}: "${field}" must map sizes to numbers.`); continue; }
            const m = {};
            for (const [k, v] of Object.entries(l[field])) {
              if (!psizes.includes(k)) continue;
              if (isNum(v)) m[k] = v;
              else err(`${lw}: ${field} for ${sizeLabel(k)} must be a number.`);
            }
            if (Object.keys(m).length) layer[field] = m;
          }
          for (const field of ['note', 'flag']) {
            if (l[field] === undefined || l[field] === null || l[field] === '') continue;
            if (isStr(l[field])) layer[field] = l[field];
            else warn(`${lw}: "${field}" was ignored because it isn't text.`);
          }
          layers.push(layer);
        });
      }

      if (errors.length === before) {
        pizzas.push({
          id: p.id, name: p.name, code: p.code, range: p.range, sizes: psizes, limitedUntil,
          orderMatters, base, placement, facts, layers,
        });
      }
    });
  }

  if (errors.length) {
    const shown = errors.slice(0, MAX_ERRORS);
    if (errors.length > MAX_ERRORS) shown.push(`…and ${errors.length - MAX_ERRORS} more problems.`);
    return { ok: false, errors: shown, warnings };
  }

  const data = {
    schema: SCHEMA,
    about: typeof obj.about === 'string' ? obj.about : '',
    sizes,
    toppingCodes,
    generalFacts,
    pizzas,
  };
  return { ok: true, data, errors: [], warnings, stats: computeStats(data) };
}

function readNullableText(v, where, err) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'string') return v;
  err(`${where} must be text or null.`);
  return null;
}

function readFacts(list, where, err, warn) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) { err(`${where} must be a list of { "q", "a" } pairs.`); return []; }
  const out = [];
  list.forEach((f, i) => {
    if (isObj(f) && isStr(f.q) && isStr(f.a)) out.push({ q: f.q, a: f.a });
    else warn(`${where} #${i + 1} was skipped because it needs both "q" and "a".`);
  });
  return out;
}

/** Counts for the "35 pizzas loaded" summary. */
export function computeStats(data) {
  const byRange = new Map();
  let flagged = 0;
  let layers = 0;
  for (const p of data.pizzas) {
    byRange.set(p.range, (byRange.get(p.range) || 0) + 1);
    for (const l of p.layers) {
      layers++;
      if (l.flag) flagged++;
    }
  }
  return {
    pizzas: data.pizzas.length,
    byRange: sortRanges([...byRange.keys()]).map((range) => ({ range, count: byRange.get(range) })),
    flagged,
    layers,
  };
}

/** Known ranges first (in menu order), anything else alphabetically after. */
export function sortRanges(ranges) {
  return [...ranges].sort((a, b) => {
    const ia = RANGE_ORDER.indexOf(a);
    const ib = RANGE_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.localeCompare(b);
  });
}

/** Ranges in the file: the usual ones first, then any others, then limited-time ones. */
export function rangesIn(data) {
  const all = sortRanges([...new Set(data.pizzas.map((p) => p.range))]);
  const limited = new Set(all.filter((r) => isLimitedRange(data, r)));
  return [...all.filter((r) => !limited.has(r)), ...all.filter((r) => limited.has(r))];
}

// ---------- limited-time pizzas ----------

export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Today's local date as "YYYY-MM-DD". */
export function isoToday(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const isLimited = (pizza) => !!pizza.limitedUntil;

/** A limited pizza is available up to and including its last day. */
export const hasEnded = (pizza, today = isoToday()) => !!pizza.limitedUntil && today > pizza.limitedUntil;

/** A range is limited when every pizza in it is. */
export function isLimitedRange(data, range) {
  const ps = data.pizzas.filter((p) => p.range === range);
  return ps.length > 0 && ps.every(isLimited);
}

/** The file without limited pizzas that have ended (what quizzes and notifications use). */
export function activeData(data, today = isoToday()) {
  if (!data.pizzas.some((p) => hasEnded(p, today))) return data;
  return { ...data, pizzas: data.pizzas.filter((p) => !hasEnded(p, today)) };
}

/** "2027-01-03" -> "3 Jan 2027". */
export function formatDay(iso) {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

/** "until 3 Jan 2027" / "ended 3 Jan 2027" for a limited range, else null. */
export function limitedLabel(data, range, today = isoToday()) {
  if (!isLimitedRange(data, range)) return null;
  const last = data.pizzas.filter((p) => p.range === range).map((p) => p.limitedUntil).sort().pop();
  return last < today ? `ended ${formatDay(last)}` : `until ${formatDay(last)}`;
}

/** Size keys that at least one pizza uses, in P S M L ONE order. */
export function sizesIn(data) {
  const used = new Set(data.pizzas.flatMap((p) => p.sizes));
  return data.sizes.map((s) => s.key).filter((k) => used.has(k));
}

export function sizeInfo(data, key) {
  return data.sizes.find((s) => s.key === key) || { key, name: key, slices: null };
}

/** "One size (Cheeky Little)" -> "One size". Used where space is tight. */
export function shortSizeName(data, key) {
  return sizeInfo(data, key).name.replace(/\s*\(.*\)\s*$/, '') || key;
}

/** Layer indices in build order (by seq, then file order). */
export function buildOrder(pizza) {
  return pizza.layers
    .map((l, i) => i)
    .sort((a, b) => (pizza.layers[a].seq - pizza.layers[b].seq) || (a - b));
}

/**
 * Group layers into numbered steps. Layers that share a seq (and stage) are one step.
 * Returns [{ n, seq, stage, items: [{ index, layer }] }].
 */
export function steps(pizza) {
  const out = [];
  for (const index of buildOrder(pizza)) {
    const layer = pizza.layers[index];
    const last = out[out.length - 1];
    if (last && last.seq === layer.seq && last.stage === layer.stage) last.items.push({ index, layer });
    else out.push({ n: out.length + 1, seq: layer.seq, stage: layer.stage, items: [{ index, layer }] });
  }
  return out;
}

export const normName = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Name without a trailing "(...)" note, e.g. "Cheese (Cd)" -> "cheese". */
export const baseName = (s) => normName(s).replace(/\s*\([^)]*\)\s*$/, '');

/** Two layers with the same signature look identical on a chip and are interchangeable. */
export function layerSig(layer) {
  return `${layer.code ?? ''}|${normName(layer.name)}`;
}

/** Layer name, with "(step N)" added if another layer on this pizza has the same name. */
export function layerTitle(pizza, index) {
  const layer = pizza.layers[index];
  const same = pizza.layers.filter((l) => normName(l.name) === normName(layer.name));
  if (same.length < 2) return layer.name;
  const st = steps(pizza).find((s) => s.items.some((it) => it.index === index));
  return `${layer.name} (step ${st ? st.n : index + 1})`;
}

/** Drizzles get a "before or after the bake?" question. */
export function isDrizzle(layer) {
  return layer.stage === 'postbake' || layer.unit === 'lines' || !!layer.lines || /drizzle/i.test(layer.name);
}

export function isExtraCheese(layer) {
  return /\bextra\b.*\bcheese\b/i.test(layer.name);
}

export function formatNum(n) {
  if (!isNum(n)) return '?';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export function unitWord(unit, n) {
  const one = n === 1;
  switch (unit) {
    case 'g': return 'g';
    case 'slices': return one ? 'slice' : 'slices';
    case 'pieces': return one ? 'piece' : 'pieces';
    case 'lines': return one ? 'line' : 'lines';
    default: return unit;
  }
}

/** 112 g -> "112g", 16 slices -> "16 slices", 1 piece -> "1 piece". */
export function formatAmount(n, unit) {
  return unit === 'g' ? `${formatNum(n)}g` : `${formatNum(n)} ${unitWord(unit, n)}`;
}

/** Extra bits shown after an amount: "· 2 per slice", "· 6 lines". */
export function amountExtras(layer, size) {
  const out = [];
  if (layer.perSlice && isNum(layer.perSlice[size])) out.push(`${formatNum(layer.perSlice[size])} per slice`);
  if (layer.lines && isNum(layer.lines[size])) out.push(formatAmount(layer.lines[size], 'lines'));
  return out;
}

/** Accepts "52.5", "52,5", " 52 g " and returns a number, or NaN. */
export function parseAmountInput(text) {
  const t = String(text ?? '').trim().replace(',', '.').replace(/\s*(g|grams?|slices?|pieces?|lines?)$/i, '');
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(t)) return NaN;
  return Number(t);
}

export function sameAmount(a, b) {
  return isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9;
}
