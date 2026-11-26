// Set a new app version everywhere it lives:  node scripts/bump-version.mjs 1.0.1
// A new version is what makes installed copies show "Update available, tap to refresh".
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(1);
}
const edit = (rel, re, to) => {
  const file = join(ROOT, rel);
  const text = readFileSync(file, 'utf8');
  if (!re.test(text)) throw new Error(`No version found in ${rel}`);
  writeFileSync(file, text.replace(re, to));
  console.log(`${rel} -> ${version}`);
};
edit('docs/js/version.js', /VERSION = '[^']+'/, `VERSION = '${version}'`);
edit('docs/sw.js', /const VERSION = '[^']+'/, `const VERSION = '${version}'`);
edit('package.json', /"version": "[^"]+"/, `"version": "${version}"`);
