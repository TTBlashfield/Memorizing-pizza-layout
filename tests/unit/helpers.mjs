import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const DOCS = join(ROOT, 'docs');

export function fixtureText() {
  return readFileSync(join(ROOT, 'tests', 'fixtures', 'sample-builds.json'), 'utf8');
}
export function fixture() {
  return JSON.parse(fixtureText());
}
/** Fresh deep copy so tests can mutate freely. */
export const clone = (o) => JSON.parse(JSON.stringify(o));
