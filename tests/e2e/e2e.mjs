// End-to-end pass at an iPhone viewport.
//   npm run e2e                       (uses the FAKE fixture)
//   BUILDS=/path/to/file.json npm run e2e   (any builds file, e.g. your real one, locally only)
//
// Uses Playwright's WebKit if it's installed, otherwise Chromium with iPhone emulation.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { serve } from '../../scripts/serve.mjs';
import { validateBuilds, buildOrder, formatAmount, formatNum, isExtraCheese } from '../../docs/js/data.js';

const require = createRequire(import.meta.url);
const { webkit, chromium, devices } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = join(ROOT, 'tests', 'e2e', 'screenshots');
const BUILDS_PATH = process.env.BUILDS || join(ROOT, 'tests', 'fixtures', 'sample-builds.json');
const USING_FIXTURE = !process.env.BUILDS;
const buildsText = readFileSync(BUILDS_PATH, 'utf8');
const data = validateBuilds(JSON.parse(buildsText)).data;
const pizza = (id) => data.pizzas.find((p) => p.id === id);
mkdirSync(SHOTS, { recursive: true });

let step = 0;
const log = (msg) => console.log(`  ${String(++step).padStart(2)}. ${msg}`);

// ---------- answer helpers (work out the right answer from the loaded file) ----------

function correctLabel(key) {
  const [kind, ...p] = key.split(':');
  switch (kind) {
    case 'portion': { const l = pizza(p[0]).layers[+p[2]]; return formatAmount(l.amounts[p[1]], l.unit); }
    case 'perslice': return `${formatNum(pizza(p[0]).layers[+p[2]].perSlice[p[1]])} per slice`;
    case 'lines': return formatAmount(pizza(p[0]).layers[+p[2]].lines[p[1]], 'lines');
    case 'slices': return `${formatNum(data.sizes.find((s) => s.key === p[0]).slices)} slices`;
    case 'stage': return pizza(p[0]).layers[+p[1]].stage === 'postbake' ? 'After the bake' : 'Before the bake';
    case 'code-topping': return data.toppingCodes[p.join(':')];
    case 'code-topping-rev': return p.join(':');
    case 'code-pizza': return pizza(p[0]).name;
    case 'code-pizza-rev': return pizza(p[0]).code;
    default: return null;
  }
}

const chipLabel = (l) => (l.code ? `${l.name} (${l.code})` : l.name);

async function doBuild(page, key, { wrong = false } = {}) {
  const [, pid, size] = key.split(':');
  const p = pizza(pid);
  let order = buildOrder(p);
  if (wrong && order.length > 2) order = [order[1], order[0], ...order.slice(2)];
  for (const i of order) {
    await page.locator('.palette').getByRole('button', { name: chipLabel(p.layers[i]), exact: true }).first().click();
  }
  await page.getByRole('button', { name: /^Check (order|toppings)$/ }).click();
  if (wrong && p.orderMatters) assert.ok(await page.locator('.tray-checked .mark-bad').count() > 0, 'wrong order is highlighted');
  await page.getByRole('button', { name: 'Next: portions' }).click();
  for (const i of buildOrder(p)) {
    const v = p.layers[i].amounts[size];
    await page.fill(`#amt-${i}`, wrong && i === buildOrder(p)[0] ? String(v + 1) : String(v).replace('.', wrong ? ',' : '.'));
  }
  await page.getByRole('button', { name: 'Check portions' }).click();
  if (wrong) {
    assert.ok(await page.locator('.layer-bad').count() > 0, 'wrong portion is highlighted in the reveal');
    assert.ok(await page.locator('.fb-wrong').count() === 1);
  } else {
    await page.locator('.fb-right').first().waitFor();
  }
}

/** Answer whatever question is showing. Returns the key answered. */
async function answer(page, { wrong = false } = {}) {
  const quiz = page.locator('.quiz');
  const key = await quiz.getAttribute('data-key');
  const kind = await quiz.getAttribute('data-kind');
  if (kind === 'mc') {
    const right = correctLabel(key);
    const opts = page.locator('.opt');
    if (right && !wrong) await opts.filter({ hasText: new RegExp(`^${right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
    else if (right && wrong) await opts.filter({ hasNotText: right }).first().click();
    else await opts.first().click();
    await page.locator('.feedback').waitFor();
    if (right) {
      assert.equal(await page.locator('.opt-right').innerText(), right, `${key}: the right answer is marked`);
      if (wrong) assert.equal(await page.locator('.fb-answer').innerText(), right, 'the correct answer is shown after a miss');
    }
  } else if (kind === 'flip') {
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: wrong ? 'Missed it' : 'Got it' }).click();
  } else if (kind === 'flash') {
    await page.getByRole('button', { name: 'Show build' }).click();
    await page.locator('.flash-back .build').waitFor();
    await page.getByRole('button', { name: wrong ? 'Missed it' : 'Got it' }).click();
  } else if (kind === 'multi') {
    if (!wrong) {
      for (const p of data.pizzas.filter((x) => x.layers.some((l) => isExtraCheese(l)))) {
        const chip = page.locator('.pick', { hasText: p.name });
        if (await chip.count()) await chip.first().click();
      }
    }
    await page.getByRole('button', { name: 'Check' }).click();
    if (!wrong) await page.locator('.fb-right').waitFor();
    await page.locator('.feedback').waitFor();
  } else if (kind === 'build') {
    await doBuild(page, key, { wrong });
  } else {
    throw new Error(`unknown question kind ${kind}`);
  }
  const visible = await page.locator('.content').innerText();
  assert.ok(!/\b(null|undefined|NaN)\b/.test(visible), `${key}: "null/undefined/NaN" shown on screen`);
  // Move on (some kinds advance by themselves).
  const next = page.locator('.foot').getByRole('button', { name: /^(Next|Finish)$/ });
  if (await next.count()) await next.click();
  return key;
}

/** Play until the summary. `wrongFirst` misses the first question once. */
async function playSession(page, { wrongFirst = false, max = 120 } = {}) {
  let n = 0;
  const seen = [];
  while (n++ < max) {
    await page.locator('.quiz, .summary, .card h2').first().waitFor();
    if (await page.locator('.summary').count()) return seen;
    const handle = await page.$('.quiz');
    if (!handle) throw new Error(`no question on screen: ${await page.locator('.content').innerText()}`);
    seen.push(await answer(page, { wrong: wrongFirst && n === 1 }));
    await page.waitForFunction((el) => !el.isConnected, handle);
  }
  throw new Error('session never finished');
}

// ---------- the run ----------

const failures = [];
async function run() {
  let swVersion = null;
  const srv = await serve({
    base: '/Makeline-Test/',
    transform: (path, text) => (swVersion && (path === 'sw.js' || path === 'js/version.js') ? text.replace(/'1\.\d+\.\d+'/, `'${swVersion}'`) : text),
  });
  let browserType = webkit;
  let browser;
  try {
    browser = await webkit.launch();
  } catch {
    browserType = chromium;
    // Full Chromium (not the headless shell) so notifications can be tested.
    browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
  }
  console.log(`E2E on ${browserType.name()} (iPhone 13 viewport), builds: ${USING_FIXTURE ? 'FAKE fixture' : 'custom file'}`);
  const { defaultBrowserType, ...iphone } = devices['iPhone 13'];
  const context = await browser.newContext({ ...iphone, acceptDownloads: true });
  if (browserType === chromium) await context.grantPermissions(['notifications'], { origin: new URL(srv.url).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

  try {
    await page.goto(srv.url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'service worker controls the page');
    await page.getByRole('link', { name: 'Load builds' }).waitFor();
    await shot('01-welcome');
    log('welcome screen, service worker active');

    // Load screen: bad input first, then the file with an empty MIME type (as iOS often sends).
    await page.goto(`${srv.url}#/load`);
    await page.getByText('Or paste the JSON instead').click();
    await page.fill('.paste', '{"schema":"something/v2"}');
    await page.getByRole('button', { name: 'Load pasted text' }).click();
    await page.locator('.card.error').getByText('makeline-builds/v1').waitFor();
    await page.fill('.paste', '{ not json');
    await page.getByRole('button', { name: 'Load pasted text' }).click();
    await page.locator('.card.error').getByText("isn't valid JSON").waitFor();
    log('friendly errors for wrong schema and bad JSON');
    await page.setInputFiles('#builds-file', { name: 'builds.json', mimeType: '', buffer: Buffer.from(buildsText) });
    await page.locator('.card.success').getByText(`${data.pizzas.length} pizza`).waitFor();
    await shot('02-loaded');
    log(`loaded builds.json with an empty MIME type: "${await page.locator('.card.success h3').innerText()}"`);
    await page.setInputFiles('#builds-file', { name: 'builds.json', mimeType: 'text/plain', buffer: Buffer.from(buildsText) });
    await page.locator('.card.success').waitFor();
    log('also accepts text/plain');

    await page.getByRole('link', { name: 'Start practising' }).click();
    await page.locator('.tiles').waitFor();
    await shot('03-home');
    log('home shows due / streak / accuracy');

    // Filters persist.
    const firstSize = page.locator('.chip-size').first();
    await firstSize.click();
    assert.equal(await firstSize.getAttribute('aria-pressed'), 'false');
    await page.waitForTimeout(400); // let the IndexedDB write land
    await page.reload();
    await page.locator('.chip-size').first().waitFor();
    assert.equal(await page.locator('.chip-size').first().getAttribute('aria-pressed'), 'false', 'size filter remembered after reload');
    await page.locator('.chip-size').first().click();
    log('filter chips remember choices');

    // One round of every mode.
    await page.goto(`${srv.url}#/quiz/flash`);
    await page.locator('.flashcard').waitFor();
    await shot('04-flash-front');
    await page.getByRole('button', { name: 'Show build' }).click();
    await shot('05-flash-back');
    await page.getByRole('button', { name: 'Got it' }).click();
    let seen = await playSession(page);
    log(`Flashcards: ${seen.length + 1} cards, summary "${await page.locator('.score-n').innerText()}"`);

    await page.goto(`${srv.url}#/quiz/build`);
    await page.locator('.palette').waitFor();
    await shot('06-build-pick');
    seen = await playSession(page, { wrongFirst: true });
    assert.equal(seen.filter((k) => k === seen[0]).length >= 2, true, 'a missed build comes back in the same session');
    await shot('07-build-summary');
    log(`Build it: ${seen.length} rounds incl. a deliberate miss that came back`);

    await page.goto(`${srv.url}#/quiz/portions`);
    await page.locator('.opt').first().waitFor();
    await shot('08-portions');
    seen = await playSession(page, { wrongFirst: true });
    log(`Quick-fire portions: ${seen.length} questions, miss shown with the right answer`);

    await page.goto(`${srv.url}#/quiz/codes`);
    seen = await playSession(page);
    assert.ok(seen.some((k) => k.startsWith('code-topping')) || seen.some((k) => k.startsWith('code-pizza')));
    log(`Codes: ${seen.length} questions (${[...new Set(seen.map((k) => k.split(':')[0]))].join(', ')})`);

    await page.goto(`${srv.url}#/quiz/rules`);
    seen = await playSession(page);
    log(`Placement & rules: ${seen.length} questions (${[...new Set(seen.map((k) => k.split(':')[0]))].join(', ')})`);

    await page.goto(`${srv.url}#/quiz/weak`);
    await page.locator('.quiz').waitFor();
    seen = await playSession(page);
    log(`Weak spots: ${seen.length} questions`);

    await page.goto(`${srv.url}#/quiz/due`);
    seen = await playSession(page);
    log(`Due session: ${seen.length} questions`);

    // Deep link from a notification, then "3 more?".
    const someLayer = data.pizzas[0];
    const deepKey = `portion:${someLayer.id}:${someLayer.sizes[someLayer.sizes.length - 1]}:0`;
    await page.goto(`${srv.url}#/q/${encodeURIComponent(deepKey)}`);
    await page.locator(`.quiz[data-key="${deepKey}"]`).waitFor();
    await shot('09-deeplink');
    await answer(page);
    await page.getByRole('button', { name: '3 more?' }).click();
    seen = await playSession(page);
    assert.ok(seen.length >= 3, '3 more questions');
    log(`deep link #/q/${deepKey} opened that question; "3 more?" gave ${seen.length}`);

    // Browse + pizza page.
    await page.goto(`${srv.url}#/browse`);
    const target = data.pizzas.find((p) => p.layers.some((l) => l.flag)) || data.pizzas[0];
    await page.fill('.search', target.code);
    await page.locator('.row', { hasText: target.name }).first().click();
    await page.locator('.pizza-name').waitFor();
    assert.equal(await page.locator('.seg-btn').count(), target.sizes.length > 1 ? target.sizes.length : 0, 'only that pizza\'s sizes');
    if (target.layers.some((l) => l.flag)) assert.ok(await page.locator('.flag').count() > 0, 'flags shown');
    await shot('10-pizza');
    const withPost = data.pizzas.find((p) => p.layers.some((l) => l.stage === 'postbake'));
    if (withPost) {
      await page.goto(`${srv.url}#/pizza/${withPost.id}`);
      await page.getByRole('heading', { name: 'After the bake' }).waitFor();
      const sizes = withPost.sizes;
      await page.locator(`.seg-${sizes[sizes.length - 1]}`).click();
      const layer = withPost.layers.find((l) => l.perSlice || l.lines);
      if (layer) assert.ok((await page.locator('.layer-extra').allInnerTexts()).some((t) => /per slice|lines/.test(t)));
      await shot('11-pizza-afterbake');
    }
    log('browse search → pizza page with size switcher, flags and "After the bake"');

    // Settings: count, notifications status, export.
    await page.goto(`${srv.url}#/settings`);
    await page.getByText(`${data.pizzas.length} pizza`).first().waitFor();
    await page.locator('#notifications .checklist').waitFor();
    assert.ok(await page.getByText('Add to Home Screen first').count() > 0, 'Safari tab shows "Add to Home Screen first"');
    await shot('12-settings');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export progress' }).click()]);
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.schema, 'makeline-progress/v1');
    assert.ok(Object.keys(exported.progress).length > 10);
    log(`settings: count shown, "Add to Home Screen first" in a Safari tab, progress exported (${Object.keys(exported.progress).length} keys)`);

    // Notification queue on the device, and the real push code path.
    const snap = await page.evaluate(() => new Promise((res, rej) => {
      const r = indexedDB.open('makeline', 1);
      r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('notify'); g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error); };
      r.onerror = () => rej(r.error);
    }));
    assert.ok(snap && snap.hasData && snap.entries.length > 0, 'notification queue saved in IndexedDB');
    assert.ok(snap.entries.every((e) => e.key && e.title && e.body));
    const cached = await page.evaluate(async () => { const c = await caches.open('makeline-data-v1'); const r = await c.match(new URL('__notify.json', document.baseURI).href); return r ? (await r.json()).entries.length : 0; });
    assert.ok(cached > 0, 'backup copy in Cache Storage');
    log(`notification queue: ${snap.entries.length} questions in IndexedDB (+ Cache Storage backup), e.g. "${snap.entries[0].title}: ${snap.entries[0].body}"`);
    if (browserType === chromium) {
      const shown = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        reg.active.postMessage({ type: 'TEST_PUSH', kind: 'quiz' });
        for (let i = 0; i < 40; i++) {
          const list = await reg.getNotifications({ tag: 'quiz' });
          if (list.length) return { title: list[0].title, body: list[0].body, url: list[0].data && list[0].data.url };
          await new Promise((r) => setTimeout(r, 100));
        }
        return null;
      });
      assert.ok(shown, 'service worker showed a notification');
      assert.equal(shown.title, snap.entries[0].title);
      assert.equal(shown.url, `./#/q/${encodeURIComponent(snap.entries[0].key)}`);
      log(`push handler showed "${shown.title}" → ${shown.url}`);
    }

    // Offline: reload and the app still opens with the data.
    await context.setOffline(true);
    await page.goto(`${srv.url}#/`);
    await page.reload();
    await page.locator('.tiles').waitFor();
    await page.goto(`${srv.url}#/browse`);
    assert.equal(await page.locator('.row').count(), data.pizzas.length, 'all pizzas there offline');
    await page.goto(`${srv.url}#/q/${encodeURIComponent(deepKey)}`);
    await page.locator('.quiz').waitFor();
    await shot('13-offline');
    log('offline reload: app opens, data and deep links still work');
    await context.setOffline(false);

    // Update: a new version → banner → tap → new version running.
    swVersion = '1.0.99';
    await page.goto(`${srv.url}#/settings`);
    await page.getByRole('button', { name: 'Check for updates' }).click();
    await page.locator('#update').waitFor({ timeout: 15000 });
    await shot('14-update-banner');
    await Promise.all([page.waitForEvent('load'), page.locator('#update').click()]);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    const v = await page.evaluate(() => new Promise((res) => {
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'VERSION') res(e.data.version); });
      navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
    }));
    assert.equal(v, '1.0.99');
    const keys = await page.evaluate(() => caches.keys());
    assert.ok(!keys.includes('makeline-shell-1.0.0'), 'old cache cleaned up');
    assert.ok(keys.includes('makeline-data-v1'), 'device data cache kept');
    assert.ok(await page.getByText(`${data.pizzas.length} pizza`).count() > 0, 'data survived the update');
    log('"Update available" banner → tap → new version active, old cache removed, data kept');

    assert.deepEqual(errors, [], 'no console errors');
    log('no console errors');
  } catch (e) {
    failures.push(e);
    await shot('FAILURE').catch(() => {});
    console.error(e);
    if (errors.length) console.error('console errors:', errors);
  } finally {
    await browser.close();
    await srv.close();
  }
}

await run();
if (failures.length) {
  console.error('\nE2E FAILED');
  process.exit(1);
}
console.log(`\nE2E passed. Screenshots in ${SHOTS}`);
