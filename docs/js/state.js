// Derived app state shared by the screens: current data, filters and quiz items (memoised).
import { getData, getSettings } from './store.js';
import { buildItems, effectiveFilters } from './questions.js';
import { rangesIn, sizesIn } from './data.js';

let memo = { data: null, fkey: '', items: [], all: [] };

export function filters() {
  const data = getData();
  return data ? effectiveFilters(data, getSettings()) : { ranges: [], sizes: [] };
}

function refresh() {
  const data = getData();
  const f = filters();
  const fkey = JSON.stringify(f);
  if (memo.data === data && memo.fkey === fkey) return memo;
  memo = {
    data,
    fkey,
    items: data ? buildItems(data, f) : [],
    all: data ? buildItems(data, { ranges: rangesIn(data), sizes: sizesIn(data) }) : [],
  };
  return memo;
}

/** Items for the current range/size filters. */
export const items = () => refresh().items;
/** Every item in the file, ignoring filters (deep links can point anywhere). */
export const allItems = () => refresh().all;

/** Hooks the app sets so screens can ask for side effects without importing app.js. */
export const hooks = {
  afterAnswer: () => {},
  dataChanged: () => {},
  settingsChanged: () => {},
};
