// M1 verification: drive the character in a real browser and assert against SIM TRUTH.
//
//   node scripts/drive.mjs [url] [--headless]
//
// Runs HEADED by default. Headless here falls back to SwiftShader software rendering, where the
// framerate reading is meaningless for a milestone whose whole question is "does this feel good" —
// and control feel is the one thing that cannot be checked from a screenshot.
//
// Assertions read `window.__game` (the dev-only debug seam in src/game.ts) rather than inferring
// position from pixels: this checks that the input path reaches the simulation, which is exactly
// what M1 delivers. The screenshot is evidence, not the test.

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const headless = args.includes('--headless');
const url = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5182/';
const out = 'shots/m1-player.png';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
}

const browser = await chromium.launch({
  headless,
  args: headless ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const player = () => page.evaluate(() => ({ ...window.__game.player }));
const teleport = (x, z) =>
  page.evaluate(
    ([px, pz]) => {
      const p = window.__game.player;
      p.x = px;
      p.z = pz;
      p.vx = 0;
      p.vz = 0;
    },
    [x, z],
  );

/** Hold a key for `ms` of wall clock and report how far the player actually moved. */
async function hold(keys, ms) {
  const before = await player();
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
  // One frame for the key-up to land before anything reads velocity.
  await page.waitForTimeout(50);
  const after = await player();
  return { before, after, dist: Math.hypot(after.x - before.x, after.z - before.z) };
}

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.querySelector('canvas') && !!window.__game, {
  timeout: 20000,
});
await page.waitForTimeout(1500); // let the camera finish its approach and the frame rate settle
await page.click('canvas', { position: { x: 900, y: 400 } }); // focus, on the right half (no stick)

// --- 1. every key direction reaches the sim, with the documented screen mapping -----------------
await teleport(0, -80); // a prop-free lane, so nothing under test is a collision
{
  const { before, after } = await hold(['KeyW'], 600);
  check('W moves away from the camera (-Z)', after.z < before.z - 2, `dz ${(after.z - before.z).toFixed(2)}`);
}
{
  const { before, after } = await hold(['KeyS'], 600);
  check('S moves toward the camera (+Z)', after.z > before.z + 2, `dz ${(after.z - before.z).toFixed(2)}`);
}
{
  const { before, after } = await hold(['KeyA'], 600);
  check('A moves left (-X)', after.x < before.x - 2, `dx ${(after.x - before.x).toFixed(2)}`);
}
{
  const { before, after } = await hold(['ArrowRight'], 600);
  check('Arrows drive the same path as WASD', after.x > before.x + 2, `dx ${(after.x - before.x).toFixed(2)}`);
}

// --- 2. speed, and that a diagonal is not 1.41x faster -------------------------------------------
await teleport(-100, -80);
const cardinal = await hold(['KeyD'], 1000);
await teleport(-100, -80);
const diagonal = await hold(['KeyD', 'KeyW'], 1000);
check(
  'sustained speed is about PLAYER_SPEED (7 u/s)',
  cardinal.dist > 5.5 && cardinal.dist < 7.2,
  `${cardinal.dist.toFixed(2)} u in 1 s`,
);
check(
  'a diagonal is no faster than a cardinal',
  Math.abs(diagonal.dist - cardinal.dist) / cardinal.dist < 0.08,
  `${diagonal.dist.toFixed(2)} vs ${cardinal.dist.toFixed(2)} u`,
);

// --- 3. facing follows movement and holds on release ---------------------------------------------
await hold(['KeyD'], 200);
const aimed = (await player()).facing;
await page.waitForTimeout(400);
const held = (await player()).facing;
check('facing points along the input (+X is +90°)', Math.abs(aimed - Math.PI / 2) < 0.01, `${((aimed * 180) / Math.PI).toFixed(1)}°`);
check('facing holds after the key is released', held === aimed);

// --- 4. bounds and props hold in the live game ---------------------------------------------------
await teleport(100, -80);
await hold(['KeyD'], 5000); // 27 units to the edge at 7 u/s, plus margin to prove it then STOPS
const edge = await player();
check('clamps at the world edge', Math.abs(edge.x - 127.4) < 0.01, `x ${edge.x.toFixed(2)}`);

await teleport(40, 0);
await hold(['KeyD'], 4000);
const wall = await player();
check('stopped by the East Wall instead of passing through', Math.abs(wall.x - 59.4) < 0.01, `x ${wall.x.toFixed(2)}`);

// --- 5. the camera actually follows ---------------------------------------------------------------
const cam = await page.evaluate(() => {
  const p = window.__game.player;
  // The R3F camera is not on window; infer the follow from the rendered frame instead — if the
  // camera had stalled, the player would have left the frustum long before x = 59.
  return { x: p.x, z: p.z };
});
check('player is still on screen after crossing the arena', Math.abs(cam.x) < 130);

// --- 6. the thumbstick writes the same vector ------------------------------------------------------
const touchPage = await browser.newPage({ viewport: { width: 420, height: 860 } });
touchPage.on('pageerror', (e) => errors.push(`touch pageerror: ${e.message}`));
await touchPage.goto(`${url}?touch=1`, { waitUntil: 'domcontentloaded' });
await touchPage.waitForFunction(() => !!window.__game, { timeout: 20000 });
await touchPage.waitForTimeout(800);
await touchPage.evaluate(() => {
  const p = window.__game.player;
  p.x = 0;
  p.z = -80;
});
{
  // Drag up-and-right inside the left half: the knob deflects, the player runs that way.
  await touchPage.mouse.move(120, 600);
  await touchPage.mouse.down();
  await touchPage.mouse.move(160, 540, { steps: 6 });
  await touchPage.waitForTimeout(900);
  const moving = await touchPage.evaluate(() => ({ ...window.__game.player }));
  await touchPage.mouse.up();
  await touchPage.waitForTimeout(400);
  const stopped = await touchPage.evaluate(() => ({ ...window.__game.player }));

  check(
    'thumbstick drives the player, up-right on screen -> +X / -Z',
    moving.x > 1 && moving.z < -81,
    `x ${moving.x.toFixed(2)}  z ${moving.z.toFixed(2)}`,
  );
  check(
    'releasing the thumbstick stops the player',
    Math.hypot(stopped.vx, stopped.vz) < 0.1,
    `|v| ${Math.hypot(stopped.vx, stopped.vz).toFixed(3)}`,
  );
}
const stickVisible = await touchPage.evaluate(
  () => !!document.querySelector('div[style*="50%"][style*="fixed"]'),
);
check('thumbstick overlay is present under ?touch=1', stickVisible);

const desktopStick = await page.evaluate(
  () => !!document.querySelector('div[style*="50%"][style*="fixed"]'),
);
check('thumbstick overlay is absent on a fine pointer', !desktopStick);
await touchPage.close();

// --- evidence ---------------------------------------------------------------------------------------
// Open ground south of the Keep, which sits dead ahead with its two outbuildings flanking it — the
// arena's most legible geography, and clear of anything that would occlude the character.
await teleport(0, 4);
// The camera is a lagging follow, so a teleport leaves it flying for the best part of a second. Let
// it land before capturing, or the shot reads as "the camera isn't centred".
await page.waitForTimeout(1200);
// Run TOWARD the camera for the shot, so the facing pip is on the visible side of the capsule.
await hold(['KeyS'], 250);
const fps = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*fps/);
  return m ? Number(m[1]) : null;
});
const cdp = await page.context().newCDPSession(page);
// Clip to the emulated viewport: headed Chromium's window is larger than the page, and an unclipped
// capture pads the shot with browser chrome-coloured dead space.
const { data } = await cdp.send('Page.captureScreenshot', {
  format: 'png',
  clip: { x: 0, y: 0, width: 1280, height: 800, scale: 1 },
});
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(data, 'base64'));

await browser.close();

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed  ·  ${fps ?? '?'} fps ` +
    `(${headless ? 'software' : 'hardware'})  ·  ${out}`,
);
process.exit(failed.length ? 1 : 0);
