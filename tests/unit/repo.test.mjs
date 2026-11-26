// Guards for what gets published: complete offline cache, matching versions, install metadata,
// no external network calls, and never a builds file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, DOCS } from './helpers.mjs';

const read = (rel) => readFileSync(join(DOCS, rel), 'utf8');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(DOCS, full).split('\\').join('/')];
  });
}

function shellFiles() {
  const sw = read('sw.js');
  const block = /const SHELL_FILES = \[([\s\S]*?)\];/.exec(sw)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const NOT_CACHED = new Set(['sw.js', 'robots.txt', '.nojekyll', 'notify-schedule.json']);

test('every app file is in the offline cache list, and every listed file exists', () => {
  const listed = new Set(shellFiles());
  for (const f of walk(DOCS)) {
    if (NOT_CACHED.has(f)) continue;
    assert.ok(listed.has(f), `${f} is missing from SHELL_FILES in sw.js (it would break offline)`);
  }
  for (const f of listed) {
    if (f === './') continue;
    assert.ok(existsSync(join(DOCS, f)), `sw.js lists ${f} but it doesn't exist`);
  }
});

test('the service worker and app versions match', () => {
  const sw = /const VERSION = '([^']+)'/.exec(read('sw.js'))[1];
  const app = /VERSION = '([^']+)'/.exec(read('js/version.js'))[1];
  assert.equal(sw, app);
});

test('no builds file is ever published or committed', () => {
  for (const f of walk(DOCS)) {
    assert.ok(!/builds/i.test(f), `${f} must not be in docs/`);
    if (f.endsWith('.json')) assert.equal(f, 'notify-schedule.json', `unexpected JSON file ${f} in docs/`);
  }
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
  } catch { /* not a git checkout */ }
  for (const f of tracked) {
    if (/builds.*\.json$/i.test(f)) assert.equal(f, 'tests/fixtures/sample-builds.json', `${f} must not be committed`);
  }
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^builds\.json$/m);
});

test('the fixture is the fake one', () => {
  const fx = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'sample-builds.json'), 'utf8'));
  assert.match(fx.about, /FAKE/);
});

test('index.html: noindex, iOS install tags, manifest, CSP', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-status-bar-style" content="[^"]+">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Makeline">/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/);
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /Content-Security-Policy" content="default-src 'self'/);
});

test('robots.txt disallows everything', () => {
  assert.match(read('robots.txt'), /User-agent: \*\s+Disallow: \/\s*$/);
});

function pngSize(rel) {
  const b = readFileSync(join(DOCS, rel));
  assert.equal(b.toString('ascii', 1, 4), 'PNG', `${rel} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('manifest: standalone, relative start_url/scope for a sub-path, icons incl. maskable', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Makeline Trainer');
  assert.equal(m.short_name, 'Makeline');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.ok(m.theme_color && m.background_color);
  for (const [size, purpose] of [['192x192', 'any'], ['512x512', 'any'], ['192x192', 'maskable'], ['512x512', 'maskable']]) {
    const icon = m.icons.find((i) => i.sizes === size && i.purpose === purpose);
    assert.ok(icon, `${purpose} ${size} icon`);
    const [w, h] = pngSize(icon.src);
    assert.equal(`${w}x${h}`, size, icon.src);
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

test('no external network calls, fonts or CDNs in the app', () => {
  const allowed = [/^http:\/\/www\.w3\.org\/2000\/svg$/, /^https:\/\/github\.com\/?/];
  for (const f of walk(DOCS)) {
    if (!/\.(js|css|html|webmanifest)$/.test(f)) continue;
    for (const m of read(f).matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
      assert.ok(allowed.some((re) => re.test(m[0])), `${f} references ${m[0]}`);
    }
  }
  assert.ok(!/@import|url\(\s*['"]?https?:/.test(read('css/app.css')));
});

test('the VAPID public key looks right (uncompressed P-256 point)', () => {
  const key = /VAPID_PUBLIC_KEY = '([^']+)'/.exec(read('js/config.js'))[1];
  const bytes = Buffer.from(key, 'base64url');
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

test('push handler constants match the app', () => {
  const db = read('js/db.js');
  const push = read('sw-push.js');
  for (const [name, value] of [['DB_NAME', 'makeline'], ['STORE', 'kv'], ['SNAPSHOT_KEY', 'notify'], ['DATA_CACHE', 'makeline-data-v1'], ['SNAPSHOT_URL', '__notify.json']]) {
    assert.match(db, new RegExp(`export const ${name} = '${value.replace('.', '\\.')}'`));
    assert.match(push, new RegExp(`${name}: '${value.replace('.', '\\.')}'`));
  }
  assert.match(read('sw.js'), /importScripts\('sw-push\.js'\)/);
  assert.ok(!/^\s*(import|export)\s/m.test(push), 'sw-push.js must stay a classic script');
});

test('the notifier workflow runs hourly at :17 and can be run by hand', () => {
  const wf = readFileSync(join(ROOT, '.github', 'workflows', 'quiz-notify.yml'), 'utf8');
  assert.match(wf, /cron: '17 \* \* \* \*'/);
  assert.match(wf, /workflow_dispatch:/);
  assert.match(wf, /secrets\.VAPID_PRIVATE_KEY/);
  assert.match(wf, /secrets\.PUSH_SUBSCRIPTION/);
  assert.match(wf, /actions: write/);
});
