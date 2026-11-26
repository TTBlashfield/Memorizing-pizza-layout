// Draws the app icon (an original pizza slice) and renders every PNG size the PWA needs.
//   node scripts/make-icons.mjs
// Uses the Playwright Chromium that's available in the dev environment.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'icons');

/** The slice, drawn in a 512 box and kept inside the central safe zone so it also works masked. */
function slice() {
  return `
  <g>
    <!-- crust -->
    <path d="M118 170 Q256 92 394 170 L380 196 Q256 128 132 196 Z" fill="#e8a54b"/>
    <path d="M118 170 Q256 92 394 170" fill="none" stroke="#b86b1f" stroke-width="10" stroke-linecap="round"/>
    <!-- cheese -->
    <path d="M132 192 Q256 124 380 192 L262 420 Q256 432 250 420 Z" fill="#ffd25e"/>
    <path d="M132 192 Q256 124 380 192 L262 420 Q256 432 250 420 Z" fill="none" stroke="#e9a93a" stroke-width="8" stroke-linejoin="round"/>
    <!-- toppings -->
    <circle cx="215" cy="215" r="27" fill="#c8372d"/><circle cx="215" cy="215" r="27" fill="none" stroke="#9e2a22" stroke-width="5"/>
    <circle cx="304" cy="226" r="24" fill="#c8372d"/><circle cx="304" cy="226" r="24" fill="none" stroke="#9e2a22" stroke-width="5"/>
    <circle cx="258" cy="300" r="22" fill="#c8372d"/><circle cx="258" cy="300" r="22" fill="none" stroke="#9e2a22" stroke-width="5"/>
    <path d="M190 262 l16 -9 l7 15 z" fill="#3f8f3a"/>
    <path d="M300 268 l14 6 l-9 13 z" fill="#3f8f3a"/>
    <path d="M247 360 l12 -4 l1 14 z" fill="#3f8f3a"/>
  </g>`;
}

function svg({ rounded, transparent }) {
  const bg = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b4441b"/><stop offset="1" stop-color="#8a2f10"/></linearGradient>`;
  const rect = transparent && rounded
    ? '<rect x="0" y="0" width="512" height="512" rx="112" fill="url(#bg)"/>'
    : '<rect x="0" y="0" width="512" height="512" fill="url(#bg)"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs>${bg}</defs>${rect}${slice()}</svg>`;
}

mkdirSync(OUT, { recursive: true });
// Scalable favicon / welcome art (rounded, transparent corners).
writeFileSync(join(OUT, 'icon.svg'), svg({ rounded: true, transparent: true }) + '\n');

const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const jobs = [
  // "any" icons: rounded corners, transparent outside.
  { file: 'icon-192.png', size: 192, rounded: true, transparent: true },
  { file: 'icon-512.png', size: 512, rounded: true, transparent: true },
  // maskable: full bleed, artwork inside the safe zone.
  { file: 'maskable-192.png', size: 192, rounded: false, transparent: false },
  { file: 'maskable-512.png', size: 512, rounded: false, transparent: false },
  // iOS rounds the corners itself and dislikes transparency.
  { file: 'apple-touch-icon.png', size: 180, rounded: false, transparent: false },
];
for (const j of jobs) {
  await page.setViewportSize({ width: j.size, height: j.size });
  const markup = svg(j).replace('width="512" height="512"', `width="${j.size}" height="${j.size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`);
  await page.screenshot({ path: join(OUT, j.file), omitBackground: j.transparent, clip: { x: 0, y: 0, width: j.size, height: j.size } });
  console.log('wrote', j.file);
}
await browser.close();
