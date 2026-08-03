// Headless render check: load the game, watch for console errors, capture a screenshot.
//
//   node scripts/shot.mjs [url] [outfile] [seconds]
//
// Capture goes through RAW CDP Page.captureScreenshot, NOT page.screenshot() — the latter waits on
// font loading and hangs in this environment. Note that headless runs under software rendering, so
// the framerate it reports is a genuine signal: a sudden collapse there is usually an
// instance-count bug, not a slow machine (docs/ARCHITECTURE.md §10).

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const url = process.argv[2] ?? 'http://localhost:5182/';
const out = process.argv[3] ?? 'shots/arena.png';
const seconds = Number(process.argv[4] ?? 4);

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded' });
// The model dialog is the first screen from M6c and the game's canvas does not exist until START is
// pressed (src/App.tsx), so this shot has to walk through it. `canvas[data-game]` is the game's own
// canvas — the dialog draws turntables of its own, and waiting on any canvas would capture it.
await page.waitForSelector('[data-model-start]', { timeout: 20000 });
await page.click('[data-model-start]');
await page.waitForSelector('canvas[data-game]', { timeout: 20000 });

// Let the scene settle and the camera finish its approach before sampling anything.
await page.waitForTimeout(seconds * 1000);

const probe = await page.evaluate(() => {
  const c = document.querySelector('canvas[data-game]');
  const fps = document.body.innerText.match(/(\d+)\s*fps/);
  return { w: c?.width ?? 0, h: c?.height ?? 0, fps: fps ? Number(fps[1]) : null };
});

const cdp = await page.context().newCDPSession(page);
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(data, 'base64'));

await browser.close();

console.log(`canvas ${probe.w}x${probe.h}  fps ${probe.fps ?? '?'}  ->  ${out}`);
if (errors.length) {
  console.error(`\n${errors.length} console error(s):`);
  for (const e of errors.slice(0, 10)) console.error(`  ${e}`);
  process.exit(1);
}
console.log('no console errors');
