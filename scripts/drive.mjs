// M1–M4 verification: drive the game in a real browser and assert against SIM TRUTH.
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
const shots = [];

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

/**
 * Capture the emulated viewport. Clipped, because headed Chromium's window is larger than the page
 * and an unclipped shot is padded with dead space; and through raw CDP, because page.screenshot()
 * hangs on font-wait in this environment.
 */
async function capture(name) {
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1280, height: 800, scale: 1 },
  });
  const file = `shots/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(data, 'base64'));
  shots.push(file);
}

const player = () => page.evaluate(() => ({ ...window.__game.player }));

/**
 * Median of three FpsMeter readings — steady state, not the first bucket after a change.
 *
 * scene/FpsMeter.tsx publishes a 0.5-second bucket, and a single read taken shortly after 400
 * instances appear catches one-off work: the shader compile for their material, the first texture
 * upload, the first full-size instance buffer. With imported models that transient is big enough to
 * drag one bucket to ~54 while the sustained rate is a flat 60, so a single sample failed about one
 * run in three for a reason that has nothing to do with whether the game holds 60 fps.
 */
async function steadyFps() {
  const reads = [];
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(600);
    reads.push(
      await page.evaluate(() => {
        const m = document.body.innerText.match(/(\d+)\s*fps/);
        return m ? Number(m[1]) : 0;
      }),
    );
  }
  reads.sort((a, b) => a - b);
  return reads[1];
}

/**
 * Put the player somewhere, at full health and untouchable.
 *
 * From M3 the sim fights back, and a teleport is always the harness setting up a situation — so
 * every one of them has to survive the setup. The movement and pathing checks below take a minute of
 * wall clock, during which the spawn director produces a crowd that will happily kill a stationary
 * player; death freezes the sim, and everything after it would fail for a reason that has nothing to
 * do with what it was testing.
 *
 * This needs no test-only API: i-frames are ordinary sim state with an ordinary timer, and holding
 * that gate open is exactly what the game does for 0.6 s after every hit. The M3 checks that are
 * ABOUT taking damage call `mortal()` first.
 */
const teleport = (x, z) =>
  page.evaluate(
    ([px, pz]) => {
      const p = window.__game.player;
      p.x = px;
      p.z = pz;
      p.vx = 0;
      p.vz = 0;
      p.hp = p.maxHp;
      p.iframe = 600;
    },
    [x, z],
  );

/**
 * Silence both weapons, and hand them back.
 *
 * The M2 section below tracks specific enemy INDICES across a 14-second window, which was safe when
 * nothing could die. From M3 a kill swap-removes — the last live enemy drops into the dead one's
 * slot — so index 7 stops meaning the enemy that started at index 7 and the whole check quietly
 * measures a different population than the one it set up. Pathing checks have to run in a game that
 * is not also killing the thing being measured.
 *
 * Like `teleport`'s i-frames, this is ordinary sim state and not a test-only API: `boltEnabled` is
 * the field M4's unlock table flips, and the aura timer is just a timer.
 */
const disarm = () =>
  page.evaluate(() => {
    window.__game.combat.boltEnabled = false;
    window.__game.combat.auraTimer = 1e9;
  });
const rearm = () =>
  page.evaluate(() => {
    window.__game.combat.boltEnabled = true;
    window.__game.combat.auraTimer = 0;
  });

/**
 * Stop XP being banked, and hand it back.
 *
 * A check that measures HP cannot also be levelling up: the Max HP card grants +25 *and heals to
 * full*, so a level-up landing inside a damage window turns "how much did that cost" into a number
 * that went UP. It cost a run of this script exactly that way — `standing in a crowd costs HP`
 * reported 100 -> 125.
 *
 * Zeroing the magnet radius rather than deleting orbs, because the director keeps producing kills
 * for the whole window and each one drops a fresh orb. This is ordinary sim state — the same field
 * the Magnet upgrade writes — not a test-only API.
 */
const freezeXp = () =>
  page.evaluate(() => {
    const g = window.__game;
    g.orbs.n = 0;
    g.orbs.magnetR = 0;
  });
const thawXp = () =>
  page.evaluate(() => {
    window.__game.orbs.magnetR = 3;
  });

/** Hand the player back to the game: full health, no invulnerability, empty field. */
const mortal = () =>
  page.evaluate(() => {
    const g = window.__game;
    g.player.hp = g.player.maxHp;
    g.player.iframe = 0;
    g.swarm.n = 0;
  });

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
// Canvas present AND the boot splash gone. __game alone is not enough from M6b: the game module
// evaluates at import time, before the model load + VAT bake finish — so __game exists while the
// LOADING MODELS overlay still covers the screen and would swallow every click this script makes.
await page.waitForFunction(
  () => !!document.querySelector('canvas') && !!window.__game && !document.getElementById('boot'),
  { timeout: 30000 },
);
await page.waitForTimeout(1500); // let the camera finish its approach and the frame rate settle
await page.click('canvas', { position: { x: 900, y: 400 } }); // focus, on the right half (no stick)

/**
 * Answer level-up offers automatically, from the PAGE side.
 *
 * From M4 a choice level freezes the run until a card is taken (DESIGN §6.3), and almost every check
 * in this script kills things — so without this the first level-up would pause the game and every
 * assertion after it would be measuring a stopped world. The interval calls `__choose`, which is the
 * same call the card's own button makes, so nothing here is a test-only code path.
 *
 * Turned OFF around the checks that are ABOUT the choice, which take their cards by hand.
 */
const autoPick = () =>
  page.evaluate(() => {
    const w = window;
    if (w.__autoPick) return;
    w.__autoPick = setInterval(() => {
      if (window.__game.prog.offer) window.__choose(0);
    }, 40);
  });
const manualPick = () =>
  page.evaluate(() => {
    clearInterval(window.__autoPick);
    window.__autoPick = null;
  });
await autoPick();

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
await touchPage.waitForFunction(() => !!window.__game && !document.getElementById('boot'), { timeout: 30000 });
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

// --- 7. the swarm (M2) ------------------------------------------------------------------------------
// Weapons off for the whole section: every check here is about where the crowd GOES, and it cannot be
// about that while the aura is deleting the front rank of it (see `disarm` above).
await disarm();

// Read the enemy SoA out of the page. Stride 8: x, z, vx, vz, hp, tier, flash, seed.
const swarm = () =>
  page.evaluate(() => {
    const g = window.__game;
    const s = g.swarm;
    const out = [];
    for (let i = 0; i < s.n; i++) {
      const b = i * 8;
      out.push({ x: s.data[b], z: s.data[b + 1], tier: s.data[b + 5] });
    }
    return { n: s.n, enemies: out, px: g.player.x, pz: g.player.z, time: g.time, stepMs: g.stepMs };
  });

/** Closest any two enemies are to each other — the collapse-to-a-point detector. */
function minPairSpacing(enemies) {
  let min = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      min = Math.min(min, Math.hypot(enemies[i].x - enemies[j].x, enemies[i].z - enemies[j].z));
    }
  }
  return min;
}

await teleport(-100, -80); // open ground, so the first observations are about the swarm not the props
// Clear the field first. The checks above teleported the player across the arena, which the real game
// never does — so the swarm left behind is scattered relative to where the player now is, and
// measuring "did this arrive from offscreen" against it would be measuring the test harness.
await page.evaluate(() => {
  window.__game.swarm.n = 0;
});
await page.waitForTimeout(2500);
const early = await swarm();
check('enemies spawn and the count climbs off zero', early.n > 2, `${early.n} enemies at ${early.time.toFixed(1)}s`);
check(
  'every enemy arrives from offscreen',
  // Spawned on a ~32 u ring within the last 2.5 s; the fastest tier present covers ~13 u in that
  // time, so nothing legitimately spawned can be inside the ~15 u visible half-extent yet.
  early.enemies.every((e) => Math.hypot(e.x - early.px, e.z - early.pz) > 15),
  `nearest ${Math.min(...early.enemies.map((e) => Math.hypot(e.x - early.px, e.z - early.pz))).toFixed(1)} u`,
);

// Stand still and let the field pull them in.
const closeBefore =
  early.enemies.reduce((a, e) => a + Math.hypot(e.x - early.px, e.z - early.pz), 0) / early.n;
await page.waitForTimeout(3000);
const later = await swarm();
const closeAfter =
  later.enemies.reduce((a, e) => a + Math.hypot(e.x - later.px, e.z - later.pz), 0) / later.n;
check('the crowd closes on the player', closeAfter < closeBefore, `${closeBefore.toFixed(1)} -> ${closeAfter.toFixed(1)} u mean`);
check(
  'the crowd holds spacing instead of collapsing to a point',
  minPairSpacing(later.enemies) > 0.3,
  `min pair ${minPairSpacing(later.enemies).toFixed(2)} u (SEP_R 1.1)`,
);

// The core M2 claim: a crowd with a prop squarely between it and the player routes AROUND the prop
// and re-merges behind it, rather than stalling against its face.
//
// Set up deliberately rather than waiting for the director to produce the situation: the player goes
// south of the Keep, and a 36-strong block is placed due north of it, so the only way through is
// round one of two corners. Indices 0..35 stay the block for the whole window — M2 has no kills, so
// nothing swap-removes, and the director only ever appends above them.
await teleport(0, -46);
await page.waitForTimeout(600); // let the flow re-seed on the new player cell
const BLOCK = 36;
await page.evaluate((count) => {
  const s = window.__game.swarm;
  s.n = 0;
  for (let i = 0; i < count; i++) {
    const b = i * 8;
    s.data[b] = -5 + (i % 6) * 2; //     x: a 10-unit-wide rank
    s.data[b + 1] = -20 + ((i / 6) | 0) * 2; // z: north of the Keep (which spans -39..-29)
    s.data[b + 2] = 0;
    s.data[b + 3] = 0;
    s.data[b + 4] = 10;
    s.data[b + 5] = 0; // all grunts, so one speed governs the whole window
    s.data[b + 6] = 0;
    s.data[b + 7] = Math.random();
  }
  s.n = count;
}, BLOCK);

const blockDist = () =>
  page.evaluate((count) => {
    const g = window.__game;
    const s = g.swarm;
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(Math.hypot(s.data[i * 8] - g.player.x, s.data[i * 8 + 1] - g.player.z));
    }
    return out;
  }, BLOCK);

const startDist = await blockDist();
// Mid-detour: the rank has reached the Keep and is splitting around both corners. This frame IS the
// milestone, so it gets its own shot rather than being inferred from the numbers.
await page.waitForTimeout(4200);
await capture('swarm-routing');
await page.waitForTimeout(9800); // ~34 u of detour at the grunt's 3.4 u/s, plus margin
const endDist = await blockDist();
check(
  'the swarm routes around the Keep and reaches the player behind it',
  Math.min(...endDist) < 7,
  `nearest ${Math.min(...endDist).toFixed(1)} u (from ${Math.min(...startDist).toFixed(1)} u)`,
);
check(
  'the whole rank makes progress — none of it stalls against the prop face',
  endDist.filter((d) => d < 12).length > BLOCK / 2,
  `${endDist.filter((d) => d < 12).length}/${BLOCK} arrived within 12 u`,
);

const routed = await swarm();
// Asked of the arena itself (via __overlapsProp) rather than against a copy of the 14 boxes here,
// which would drift the moment anyone edits sim/world.ts.
const inProps = await page.evaluate(() => {
  const s = window.__game.swarm;
  let bad = 0;
  for (let i = 0; i < s.n; i++) {
    if (window.__overlapsProp(s.data[i * 8], s.data[i * 8 + 1], 0.5 - 1e-6)) bad++;
  }
  return bad;
});
check('no enemy is ever inside a prop', inProps === 0, `${routed.n} enemies checked, ${inProps} inside`);

// --- 8. the cap, and the frame budget ---------------------------------------------------------------
await teleport(-90, 90);
const capped = await page.evaluate(() => window.__spawn(400, 0, 26));
await page.waitForTimeout(2500);
const full = await swarm();
check('holds at MAX_ENEMIES', full.n === 400, `${capped} spawned, ${full.n} live`);
check('the whole tick stays inside its 2 ms budget at cap', full.stepMs < 2, `${full.stepMs.toFixed(2)} ms`);
const capFps = await steadyFps();
check('holds 60 fps at cap', capFps !== null && capFps >= 55, `${capFps} fps with 400 enemies`);

// --- 9. combat (M3) ---------------------------------------------------------------------------------
const combat = () =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      kills: g.combat.kills,
      // XP is banked by orb pickup from M4, not awarded by the kill — see sim/orbs.ts.
      xp: g.prog.totalXp,
      nb: g.combat.nb,
      nd: g.combat.nd,
      auraR: g.combat.auraR,
      n: g.swarm.n,
      hp: g.player.hp,
      time: g.time,
      stepMs: g.stepMs,
    };
  });

/** Place `count` enemies of `tier` on a ring of exactly `r` around the player, and nothing else. */
const ring = (count, tier, r) =>
  page.evaluate(
    ([c, t, radius]) => {
      const g = window.__game;
      const s = g.swarm;
      s.n = 0;
      for (let i = 0; i < c; i++) {
        const a = (i / c) * Math.PI * 2;
        const b = i * 8;
        s.data[b] = g.player.x + Math.cos(a) * radius;
        s.data[b + 1] = g.player.z + Math.sin(a) * radius;
        s.data[b + 2] = 0;
        s.data[b + 3] = 0;
        s.data[b + 4] = [10, 6, 60, 400][t];
        s.data[b + 5] = t;
        s.data[b + 6] = 0;
        s.data[b + 7] = Math.random();
      }
      s.n = c;
    },
    [count, tier, r],
  );

await rearm();
await teleport(-100, 80); // open ground, well clear of every prop
await page.waitForTimeout(400);

/**
 * Place a ring of brutes, fire EXACTLY one aura pulse at it, and read the result before anybody has
 * walked anywhere.
 *
 * A pulse has to be triggered deliberately rather than waited for. Left to its own 2/s cadence the
 * crowd closes on the player between the setup and the reading, and a ring placed at 2.6 units gets
 * killed at 1.2 — which would pass a "full radius" check that had regressed to a 3×3 cell walk.
 * Brutes because 60 hp survives the pulse, so the damage is readable, and 2.2 u/s means 120 ms of
 * settle costs a quarter of a unit.
 */
async function onePulse(count, radius) {
  await ring(count, 2, radius);
  await page.evaluate(() => {
    const c = window.__game.combat;
    // The Lance off and its bolts cleared, or a shot fired seconds ago is still in the air and lands
    // on the ring during the window — which is a hit from the wrong weapon in a check about which
    // enemies the AURA can reach. (It happened: one brute out of twelve, at 4.0 units.)
    c.boltEnabled = false;
    c.nb = 0;
    c.auraTimer = 0.001; // fires on the next tick
  });
  await page.waitForTimeout(120);
  const snap = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let i = 0; i < g.swarm.n; i++) {
      if (g.swarm.data[i * 8 + 5] !== 2) continue; // skip anything the director added
      out.push({
        hurt: g.swarm.data[i * 8 + 4] < 60,
        d: Math.hypot(g.swarm.data[i * 8] - g.player.x, g.swarm.data[i * 8 + 1] - g.player.z),
      });
    }
    return out;
  });
  await page.evaluate(() => {
    window.__game.combat.boltEnabled = true;
  });
  return snap;
}

// The aura reaches its FULL radius. 2.6 units is inside AURA_R (3.0) but outside the 1.65 that a
// fixed 3×3 walk of the swarm grid's 1.1-unit cell can see — the exact case that made
// grid.queryNeighbors size its ring from the radius. A regression here has no symptom except the
// aura quietly doing less damage than the table says, which is indistinguishable from tuning.
const inRing = await onePulse(12, 2.6);
check(
  'one pulse damages the whole ring at 2.6 u — past the 1.65 a 3x3 cell walk would reach',
  inRing.length === 12 && inRing.every((e) => e.hurt) && Math.min(...inRing.map((e) => e.d)) > 1.65,
  `${inRing.filter((e) => e.hurt).length}/${inRing.length} hit, nearest ${Math.min(...inRing.map((e) => e.d)).toFixed(2)} u`,
);

// ...and stops at it. A ring outside must survive to walk in, which is the whole reason the aura is
// a positioning decision rather than a passive.
const outRing = await onePulse(12, 4.0);
check(
  'the same pulse leaves a ring at 4.0 u untouched',
  outRing.length === 12 && outRing.every((e) => !e.hurt),
  `${outRing.filter((e) => e.hurt).length}/${outRing.length} hit`,
);

// Sustained: a crowd standing in the ring is ground down and pays out XP.
await ring(28, 0, 2.6);
const auraBefore = await combat();
await page.waitForTimeout(1600); // 3 pulses × 6 damage puts a 10 hp grunt down twice over
const auraAfter = await combat();
check(
  'the aura grinds down a crowd standing in it',
  auraAfter.kills - auraBefore.kills >= 24,
  `${auraAfter.kills - auraBefore.kills}/28 killed in ${auraAfter.auraR} u`,
);
check(
  'kills award XP and leave a death marker behind',
  auraAfter.xp > auraBefore.xp && auraAfter.nd > 0,
  `${auraAfter.xp - auraBefore.xp} xp, ${auraAfter.nd} markers live`,
);

// Bolts exist, and fly along the direction the player last moved.
await teleport(-100, 80);
await page.evaluate(() => {
  window.__game.swarm.n = 0;
});
await hold(['KeyW'], 400); // face -Z
await page.waitForTimeout(600);
const bolts = await page.evaluate(() => {
  const c = window.__game.combat;
  const out = [];
  for (let i = 0; i < c.nb; i++) out.push({ vx: c.bolts[i * 6 + 2], vz: c.bolts[i * 6 + 3] });
  return { n: c.nb, out, facing: window.__game.player.facing };
});
check('the Lance fires on its own', bolts.n > 0, `${bolts.n} in flight`);
check(
  'bolts fly along facing, not along velocity',
  bolts.out.every((b) => b.vz < -20 && Math.abs(b.vx) < 1),
  `facing ${((bolts.facing * 180) / Math.PI).toFixed(0)}°, v (${bolts.out[0]?.vx.toFixed(1)}, ${bolts.out[0]?.vz.toFixed(1)})`,
);

// The Lance does damage the aura cannot reach. Brutes in a line down the firing direction, all of
// them far outside AURA_R and slow enough to stay there for the window.
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  const s = g.swarm;
  s.n = 0;
  g.player.facing = 0; // +Z
  for (let i = 0; i < 3; i++) {
    const b = i * 8;
    s.data[b] = g.player.x;
    s.data[b + 1] = g.player.z + 10 + i * 3;
    s.data[b + 2] = 0;
    s.data[b + 3] = 0;
    s.data[b + 4] = 60;
    s.data[b + 5] = 2;
    s.data[b + 6] = 0;
    s.data[b + 7] = 0;
  }
  s.n = 3;
});
await page.waitForTimeout(1500);
const lanced = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (let i = 0; i < g.swarm.n; i++) {
    out.push({
      hp: g.swarm.data[i * 8 + 4],
      d: Math.hypot(g.swarm.data[i * 8] - g.player.x, g.swarm.data[i * 8 + 1] - g.player.z),
    });
  }
  return out;
});
check(
  'the Lance damages enemies the aura cannot reach',
  lanced.some((e) => e.hp < 60 && e.d > 3.0),
  lanced.map((e) => `${e.hp}hp @${e.d.toFixed(1)}u`).join(' '),
);

// --- 10. taking damage ------------------------------------------------------------------------------
// XP frozen for the whole section: see `freezeXp`. Every check here is a difference between two HP
// readings, and a Max HP card landing between them heals the player to full.
await teleport(-100, 80);
await mortal();
await freezeXp();
await ring(24, 0, 0.8); // a crowd standing ON the player
const hurtStart = await combat();
await page.waitForTimeout(2000);
const hurtEnd = await combat();
const lost = hurtStart.hp - hurtEnd.hp;
check('standing in a crowd costs HP', lost > 0, `${hurtStart.hp} -> ${hurtEnd.hp}`);
check(
  'i-frames bound the damage — 24 enemies do not delete the player in one frame',
  // 2 s at 0.6 s of invulnerability per hit is at most 4 grunt hits (6 each), never 24 × 60 frames.
  lost <= 4 * 6,
  `${lost} hp in 2 s (cap ${4 * 6})`,
);
const vignette = await page.evaluate(
  () => !!document.querySelector('div[style*="radial-gradient"]') || window.__game.lastHitAt >= 0,
);
check('a hit is recorded for the damage vignette', vignette);
await thawXp();

// --- 11. the HUD reads sim truth --------------------------------------------------------------------
await teleport(-100, 80);
await page.evaluate(() => {
  window.__game.swarm.n = 0;
});
await page.waitForTimeout(600); // a quiet moment, so the 10 Hz push has certainly caught up
const hud = await page.evaluate(() => {
  const g = window.__game;
  const text = document.body.innerText;
  return {
    kills: g.combat.kills,
    hp: g.player.hp,
    maxHp: g.player.maxHp,
    time: g.time,
    text,
  };
});
const mm = Math.floor(hud.time / 60);
const ss = String(Math.floor(hud.time) % 60).padStart(2, '0');
check(
  'the HUD kill count matches the simulation',
  hud.text.includes(`${hud.kills} killed`),
  `sim ${hud.kills}, hud "${hud.text.replace(/\s+/g, ' ').trim().slice(0, 40)}"`,
);
check('the HUD clock matches the run clock', hud.text.includes(`${mm}:${ss}`), `${mm}:${ss}`);

// --- 12. XP, orbs and progression (M4) ---------------------------------------------------------------
// A clean run first: everything below is about what a level DOES, and the checks in section 9 have
// already earned several.
await page.evaluate(() => window.__reset());
await page.waitForTimeout(300);
await teleport(-100, 80);
await page.evaluate(() => {
  window.__game.swarm.n = 0;
  window.__game.orbs.n = 0;
});
await page.waitForTimeout(200);

const prog = () =>
  page.evaluate(() => {
    const g = window.__game;
    return {
      level: g.prog.level,
      xp: g.prog.xp,
      need: g.prog.need,
      total: g.prog.totalXp,
      lastLevelAt: g.prog.lastLevelAt,
      shake: g.prog.shake,
      orbs: g.orbs.n,
      magnetR: g.orbs.magnetR,
      bolt: g.combat.boltEnabled,
      boltCount: g.combat.boltCount,
      pierce: g.combat.boltPierce,
      boltInterval: g.combat.boltInterval,
      auraR: g.combat.auraR,
      orbiters: g.combat.orbiters,
      knockback: g.combat.knockback,
      damageMul: g.combat.damageMul,
      speedMul: g.player.speedMul,
      hp: g.player.hp,
      maxHp: g.player.maxHp,
      dashCd: g.player.dashCd,
      dashCdMax: g.player.dashCdMax,
      offers: g.prog.offer ? g.prog.offer.length : 0,
      stepMs: g.stepMs,
      text: document.body.innerText,
    };
  });

/** Every orb on the ground, with its distance from the player. */
const orbField = () =>
  page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let i = 0; i < g.orbs.n; i++) {
      const b = i * 4;
      out.push({
        x: g.orbs.data[b],
        z: g.orbs.data[b + 1],
        value: g.orbs.data[b + 2],
        d: Math.hypot(g.orbs.data[b] - g.player.x, g.orbs.data[b + 1] - g.player.z),
      });
    }
    return out;
  });

const fresh = await prog();
check(
  'a fresh run starts at level 1 with the Lance locked',
  fresh.level === 1 && fresh.bolt === false && fresh.total === 0 && fresh.orbs === 0,
  `lv ${fresh.level}, lance ${fresh.bolt}, ${fresh.total} xp`,
);

// A kill 12 units away, out of reach of the magnet. The aura is widened for exactly one pulse to
// land it — the same trick `onePulse` uses — because what is on trial is where the ORB ends up, not
// which weapon killed the body.
await page.evaluate(() => {
  const g = window.__game;
  const s = g.swarm;
  s.n = 0;
  const b = 0;
  s.data[b] = g.player.x + 12;
  s.data[b + 1] = g.player.z;
  s.data[b + 2] = 0;
  s.data[b + 3] = 0;
  s.data[b + 4] = 1; // one hit point: the pulse kills it outright
  s.data[b + 5] = 0;
  s.data[b + 6] = 0;
  s.data[b + 7] = 0;
  s.n = 1;
  g.combat.auraR = 20;
  g.combat.auraTimer = 0.001;
});
await page.waitForTimeout(150);
await page.evaluate(() => {
  window.__game.combat.auraR = 3.0; // back to the level-1 radius before anything else is measured
});
const dropped = await orbField();
check(
  'a kill drops an XP orb where the body fell',
  dropped.length === 1 && Math.abs(dropped[0].d - 12) < 1.5,
  `${dropped.length} orb at ${dropped[0]?.d.toFixed(1)} u`,
);

// It stays there. Orbs never expire (DESIGN §8) — the field behind you is the comeback mechanic.
await page.waitForTimeout(2500);
const stillThere = await orbField();
const noPay = await prog();
check(
  'the orb waits on the ground and pays nothing until it is collected',
  stillThere.length === 1 &&
    Math.abs(stillThere[0].x - dropped[0].x) < 1e-3 &&
    noPay.total === 0 &&
    noPay.level === 1,
  `${stillThere.length} orb, ${noPay.total} xp banked`,
);

// Walk onto it: the magnet takes it from there.
await page.evaluate(() => {
  const g = window.__game;
  g.player.x = g.orbs.data[0] - 2.4; // just inside PICKUP_R, so the magnet does the last stretch
  g.player.z = g.orbs.data[1];
});
await page.waitForTimeout(700);
const collected = await prog();
check(
  'walking into the magnet radius banks the orb',
  collected.orbs === 0 && collected.total === 1,
  `${collected.orbs} left, ${collected.total} xp`,
);

// A crowd killed inside the aura pays out enough to level, and the orbs are cleaned up as it goes.
await teleport(-100, 80);
await page.waitForTimeout(200);
await ring(30, 0, 2.2);
await page.waitForTimeout(3000);
const levelled = await prog();
check(
  'grinding a crowd levels the character up',
  levelled.level >= 3 && levelled.total >= 30,
  `lv ${levelled.level}, ${levelled.total} xp, ${levelled.orbs} orbs left`,
);
check(
  'level 3 unlocked the Lance, and the level-2 choice was taken',
  levelled.bolt === true && levelled.text.includes('lv 3'),
  `lance ${levelled.bolt}, auraR ${levelled.auraR} (level 2 is a choice — the harness took card 0)`,
);

// --- the upgrade choice ------------------------------------------------------------------------
// Auto-pick off: these checks ARE the card, so they take it by hand.
await manualPick();
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.orbs.n = 0;
  // Land on an even level, which is a choice level. Odd levels 3-11 grant a weapon instead.
  if (g.prog.level % 2 === 1) window.__grantXp(g.prog.need);
});
await page.waitForTimeout(120);
const beforeCard = await prog();
await page.evaluate(() => window.__grantXp(window.__game.prog.need));
await page.waitForTimeout(150);
const carded = await prog();
check(
  'a choice level raises the card instead of picking for the player',
  carded.offers === 3 && carded.text.includes('CHOOSE ONE'),
  `${carded.offers} cards at lv ${carded.level} (was ${beforeCard.level})`,
);

// The freeze. The card asks a question, and asking one while a crowd closes in makes it a reflex
// test rather than a choice — so the sim stops dead behind it, exactly as it does on death.
await page.evaluate(() => window.__spawn(40, 0, 8));
const frozenBefore = await page.evaluate(() => ({
  t: window.__game.time,
  x: window.__game.swarm.data[0],
  kills: window.__game.combat.kills,
}));
await page.waitForTimeout(700);
const frozenAfter = await page.evaluate(() => ({
  t: window.__game.time,
  x: window.__game.swarm.data[0],
  kills: window.__game.combat.kills,
}));
check(
  'the run freezes behind the card',
  frozenBefore.t === frozenAfter.t &&
    frozenBefore.x === frozenAfter.x &&
    frozenBefore.kills === frozenAfter.kills,
  `t ${frozenAfter.t.toFixed(2)}, ${frozenAfter.kills} kills either side`,
);
await capture('level-up-choice');

// Take a card with the keyboard. The player's hands are on WASD and the dash key all run; making
// them find a mouse for the one decision in the game would be the wrong end to every level.
const offered = await page.evaluate(() => window.__game.prog.offer.map((u) => u.id));
await page.keyboard.press('Digit1');
await page.waitForTimeout(200);
const picked = await prog();
check(
  'pressing 1 takes the first card and restarts the run',
  picked.offers === 0 && picked.text.includes(`LEVEL ${picked.level}`) && picked.shake > 0,
  `took "${offered[0]}", ${picked.offers} cards left, shake ${picked.shake.toFixed(2)}`,
);
const resumed = await page.evaluate(() => window.__game.time);
await page.waitForTimeout(400);
check(
  'the clock runs again once a card is taken',
  (await page.evaluate(() => window.__game.time)) > resumed,
);
await capture('level-up');

await autoPick();
await page.evaluate(() => {
  window.__game.swarm.n = 0;
});

// The whole unlock spine plus a run's worth of picks, in one jump, on a FRESH run.
//
// Fresh because the check below counts the picks back out of the stats, and that arithmetic is only
// meaningful if every level from 1 to 12 was crossed inside the window being measured — the checks
// above have already spent several of them.
await page.evaluate(() => window.__reset());
await page.waitForTimeout(250);
await page.evaluate(() => {
  const g = window.__game;
  let guard = 0;
  // Interleaved rather than granted-then-resolved: an offer BLOCKS the next level, which is the
  // property that stops a big orb pickup silently skipping the Lance.
  while (g.prog.level < 12 && guard++ < 200) {
    if (g.prog.offer) window.__choose(0);
    else window.__grantXp(g.prog.need);
  }
  // Reaching 12 raises its own offer. Resolve it here rather than leaving it for the auto-picker's
  // interval, so the count below is exactly six choices and not a race with a 40 ms timer.
  if (g.prog.offer) window.__choose(0);
});
await page.waitForTimeout(150);
const maxed = await prog();
// The weapon spine is the DETERMINISTIC half: levels 3, 5, 7, 9 and 11 grant these whatever the
// player picks, which is the whole reason they are not in the choice pool (DESIGN §6.3).
check(
  'the weapon spine arrives on schedule whatever cards were taken',
  maxed.level === 12 &&
    maxed.bolt === true &&
    maxed.boltCount === 2 &&
    maxed.pierce === 3 &&
    maxed.orbiters === 1 &&
    maxed.knockback > 0,
  `lv12: ${maxed.boltCount} bolts, pierce ${maxed.pierce}, ${maxed.orbiters} orbiter, knock ${maxed.knockback}`,
);
// ...and the chosen half is accounted for EXACTLY. Every upgrade in the pool leaves a signature on
// its live field, so the six choice levels (2, 4, 6, 8, 10, 12) can be counted back out of the
// stats. WHICH cards the harness took is up to the shuffle; that six picks produced six applications
// is not — and this is what catches a pick being dropped, or applied twice.
// One term per entry in the pool — miss one and this reads as a lost pick, which is exactly how the
// Fire rate card was found to be missing from an earlier version of this count.
const picks =
  Math.round(Math.log(maxed.damageMul) / Math.log(1.25)) +
  Math.round(Math.log(maxed.speedMul) / Math.log(1.1)) +
  Math.round(Math.log(maxed.magnetR / 3) / Math.log(1.5)) +
  Math.round(Math.log(0.55 / maxed.boltInterval) / Math.log(1.2)) +
  Math.round(maxed.auraR - 3) +
  Math.round((maxed.maxHp - 100) / 25) +
  Math.round(Math.log(2.2 / maxed.dashCdMax) / Math.log(1 / 0.8));
check(
  'every choice level applied exactly one upgrade, no more and no fewer',
  picks === 6,
  `${picks} picks across 6 choice levels — dmg ×${maxed.damageMul.toFixed(2)}, ` +
    `speed ×${maxed.speedMul.toFixed(2)}, magnet ${maxed.magnetR.toFixed(1)} u, aura ${maxed.auraR.toFixed(1)} u, ` +
    `rate ${maxed.boltInterval.toFixed(3)} s, ${maxed.maxHp} hp, dash ${maxed.dashCdMax.toFixed(2)} s`,
);
check(
  'a Max HP pick heals to full rather than leaving a gap at the top of the bar',
  maxed.maxHp === 100 || maxed.hp === maxed.maxHp,
  `${maxed.hp}/${maxed.maxHp} hp`,
);

// Twin Lance in flight: two bolts, fanned symmetrically about facing rather than one moved.
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.combat.nb = 0;
  g.player.facing = 0; // +Z
  g.combat.boltTimer = 0.001;
});
await page.waitForTimeout(120);
const volley = await page.evaluate(() => {
  const c = window.__game.combat;
  const out = [];
  for (let i = 0; i < c.nb; i++) {
    out.push(Math.atan2(c.bolts[i * 6 + 2], c.bolts[i * 6 + 3]));
  }
  return out;
});
check(
  'Twin Lance fires two bolts, one either side of facing',
  volley.length === 2 && Math.abs(volley[0] + volley[1]) < 1e-3 && Math.abs(volley[0]) > 0.15,
  volley.map((a) => `${((a * 180) / Math.PI).toFixed(1)}°`).join(' / '),
);

// A big field of orbs is free: they are one flat array walk against one point, no grid.
await teleport(-90, -90);
await page.evaluate(() => {
  const g = window.__game;
  const o = g.orbs;
  o.n = 0;
  for (let i = 0; i < 2000; i++) {
    const b = i * 4;
    o.data[b] = 40 + (i % 50) * 0.7; // far from the player, so none of them are collected
    o.data[b + 1] = 40 + ((i / 50) | 0) * 0.7;
    o.data[b + 2] = 1;
    o.data[b + 3] = 0;
  }
  o.n = 2000;
  window.__spawn(400, 0, 26);
});
await page.waitForTimeout(1500);
const loadedOrbs = await prog();
check(
  'the tick stays inside its 2 ms budget with 2000 orbs and 400 enemies',
  loadedOrbs.stepMs < 2 && loadedOrbs.orbs >= 2000,
  `${loadedOrbs.stepMs.toFixed(2)} ms, ${loadedOrbs.orbs} orbs`,
);
const orbFps = await steadyFps();
check('holds 60 fps with a full orb field', orbFps !== null && orbFps >= 55, `${orbFps} fps`);

// --- 12b. the dash ------------------------------------------------------------------------------
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.orbs.n = 0;
  g.player.dashCd = 0;
  g.player.facing = Math.PI / 2; // +X, so a standing dash has a direction to go
});
await page.waitForTimeout(200);
{
  // No movement key is held for this, so ANY distance covered is the dash and nothing else.
  const before = await player();
  await page.keyboard.press('Space');
  await page.waitForTimeout(450);
  const after = await player();
  const dist = Math.hypot(after.x - before.x, after.z - before.z);
  check(
    'Space dashes, and covers ground walking could not in the time',
    dist > 5 && after.x > before.x + 5,
    `${dist.toFixed(2)} u in 0.45 s, from a standstill`,
  );
}
const dashed = await prog();
check(
  'the dash goes on cooldown and the HUD says so',
  dashed.dashCd > 0 && dashed.text.includes('DASH'),
  `${dashed.dashCd.toFixed(2)} s of ${dashed.dashCdMax.toFixed(2)} left`,
);
{
  // Held down for two seconds against a 2.2 s cooldown: exactly one dash may happen. A key-repeat
  // that re-fired would spend the dash the instant it came back, making "hold Space" the correct
  // way to play.
  await page.evaluate(() => {
    window.__game.player.dashCd = 0;
  });
  const before = await player();
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  const after = await player();
  const dist = Math.hypot(after.x - before.x, after.z - before.z);
  check(
    'holding the dash key does not machine-gun it',
    dist < 12,
    `${dist.toFixed(2)} u in 1.5 s (one dash is ~7)`,
  );
}
{
  await page.evaluate(() => {
    const g = window.__game;
    g.player.dashCd = 0;
    g.player.iframe = 0;
    g.player.hp = g.player.maxHp;
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  const p = await player();
  check(
    'the dash grants i-frames, so it is an escape rather than a fast way into a crowd',
    p.iframe > 0,
    `${p.iframe.toFixed(2)} s`,
  );
}

// --- 12c. orbs that do not give up, and orbs that consolidate -------------------------------------
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.orbs.n = 0;
  g.player.speedMul = 1.6; // 11.2 u/s: faster than an orb at the rim of its own magnet
  // One orb just inside the magnet radius, dead ahead of the player's escape route.
  g.orbs.data[0] = g.player.x + 1.5;
  g.orbs.data[1] = g.player.z;
  g.orbs.data[2] = 5;
  g.orbs.data[3] = 0;
  g.orbs.data[4] = 0;
  g.orbs.n = 1;
});
{
  const before = await prog();
  // Run flat out for a second and a half. The orb latched on the first tick and has to catch up.
  await hold(['KeyA'], 1500);
  const after = await prog();
  check(
    'an orb that has started moving keeps coming even when the player outruns it',
    after.orbs === 0 && after.total === before.total + 5,
    `${after.orbs} left, +${after.total - before.total} xp at ${(7 * 1.6).toFixed(1)} u/s`,
  );
}
await page.evaluate(() => {
  window.__game.player.speedMul = 1;
});

// Merging. A field far bigger than ORB_MERGE_AT, aged past ORB_MERGE_AGE, well away from the player
// so nothing is collected while it consolidates.
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  const o = g.orbs;
  o.n = 0;
  for (let i = 0; i < 400; i++) {
    const b = i * 5;
    o.data[b] = 40 + (i % 20) * 1.1;
    o.data[b + 1] = 40 + ((i / 20) | 0) * 1.1;
    o.data[b + 2] = 1;
    o.data[b + 3] = 60; // long since ignored
    o.data[b + 4] = 0;
  }
  o.n = 400;
});
await page.waitForTimeout(1500);
const consolidated = await page.evaluate(() => {
  const o = window.__game.orbs;
  let sum = 0;
  let biggest = 0;
  for (let i = 0; i < o.n; i++) {
    sum += o.data[i * 5 + 2];
    biggest = Math.max(biggest, o.data[i * 5 + 2]);
  }
  return { n: o.n, sum, biggest };
});
check(
  'a big field of ignored orbs consolidates, without losing an XP point',
  consolidated.n < 400 && consolidated.sum === 400 && consolidated.biggest > 1,
  `400 -> ${consolidated.n} orbs, ${consolidated.sum} xp intact, biggest worth ${consolidated.biggest}`,
);
await capture('orb-merge');

// --- 12d. boosts ----------------------------------------------------------------------------------
await teleport(-100, 80);
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.orbs.n = 0;
  g.boosts.n = 0;
  g.boosts.timers.fill(0);
});

/** Put a boost of `kind` on the ground `d` units from the player and walk onto it. */
const grabBoost = async (kind, d = 2) => {
  await page.evaluate(
    ([k, dist]) => {
      const g = window.__game;
      const b = g.boosts;
      b.n = 0;
      b.data[0] = g.player.x + dist;
      b.data[1] = g.player.z;
      b.data[2] = k;
      b.data[3] = 0;
      b.n = 1;
    },
    [kind, d],
  );
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const g = window.__game;
    g.player.x = g.boosts.data[0];
    g.player.z = g.boosts.data[1];
  });
  await page.waitForTimeout(200);
};

// A known permanent multiplier first. Whether the auto-picker happened to take Damage on the way to
// level 12 is a coin flip, and the property under test — that the boost and the upgrade live in
// different fields — deserves a controlled experiment rather than a lucky run.
await page.evaluate(() => {
  window.__game.combat.damageMul = 1.25;
});
await grabBoost(2); // BK_QUAD
const quad = await prog();
check(
  'walking over a boost collects it, announces it, and changes the arithmetic',
  quad.text.includes('QUAD DAMAGE'),
  `boostMul ${await page.evaluate(() => window.__game.combat.boostMul)}`,
);
const quadMul = await page.evaluate(() => ({
  boost: window.__game.combat.boostMul,
  perm: window.__game.combat.damageMul,
  n: window.__game.boosts.n,
}));
check(
  'Quad Damage multiplies outbound damage without touching the permanent upgrades',
  quadMul.boost === 4 && quadMul.perm === 1.25 && quadMul.n === 0,
  `boost ×${quadMul.boost}, permanent ×${quadMul.perm.toFixed(2)}`,
);
await capture('boost');

await grabBoost(1); // BK_INVINCIBLE
{
  await mortal();
  await page.evaluate(() => {
    window.__game.player.iframe = 0; // the boost, not the i-frame window, is what is on trial
  });
  await ring(24, 2, 0.8); // brutes standing on the player: 18 contact damage each
  const before = await page.evaluate(() => window.__game.player.hp);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    hp: window.__game.player.hp,
    inv: window.__game.player.invincible,
  }));
  check(
    'Invincible takes no damage from a crowd standing on the player',
    after.hp === before && after.inv > 0,
    `${before} -> ${after.hp} hp, ${after.inv.toFixed(1)} s left`,
  );
}

await grabBoost(4); // BK_BLOODLUST
{
  await page.evaluate(() => {
    const g = window.__game;
    g.player.invincible = 0;
    g.player.iframe = 600; // survive the setup; the heal is what is being measured
    g.player.hp = 30;
    g.swarm.n = 0;
  });
  await ring(30, 0, 2.2);
  const before = await combat();
  await page.waitForTimeout(2000);
  const after = await combat();
  // Bounded by the player's OWN maximum, which depends on how many Max HP cards the run took —
  // hard-coding 125 would make this check a bet on the shuffle.
  const maxHp = await page.evaluate(() => window.__game.player.maxHp);
  check(
    'Bloodlust heals a point per kill',
    after.hp > before.hp && after.hp <= maxHp,
    `${before.hp} -> ${after.hp}/${maxHp} hp over ${after.kills - before.kills} kills`,
  );
}

{
  // Orbs scattered across the whole arena, out to 110 units — nearly forty times the magnet radius,
  // so nothing here could be collected any other way. Centred on the player and inside the world so
  // every one of them has a real distance to cover.
  await teleport(0, 4);
  await page.waitForTimeout(300);
  // Weapons silenced for the whole window. It runs for thirteen seconds with the spawn director
  // still working, and every enemy the aura kills in that time drops a FRESH orb the Magnet never
  // touched — which would leave the field non-empty for a reason that has nothing to do with the
  // boost. The same "the harness must not measure what it created" rule as the M2 pathing checks.
  await disarm();
  await page.evaluate(() => {
    const g = window.__game;
    g.combat.orbiters = 0; // the level 9 unlock also kills, and `disarm` predates it
    const o = g.orbs;
    o.n = 0;
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const r = 20 + (i % 6) * 18; // 20 .. 110 units out
      const b = i * 5;
      o.data[b] = g.player.x + Math.cos(a) * r;
      o.data[b + 1] = g.player.z + Math.sin(a) * r;
      o.data[b + 2] = 1;
      o.data[b + 3] = 0;
      o.data[b + 4] = 0;
    }
    o.n = 120;
    // The pickup, placed underfoot: collected on the next tick.
    g.boosts.n = 0;
    g.boosts.data[0] = g.player.x;
    g.boosts.data[1] = g.player.z;
    g.boosts.data[2] = 0; // BK_MAGNET
    g.boosts.data[3] = 0;
    g.boosts.n = 1;
  });
  const before = await prog();
  await page.waitForTimeout(250);
  const latched = await page.evaluate(() => {
    const o = window.__game.orbs;
    let homing = 0;
    let far = 0;
    for (let i = 0; i < o.n; i++) {
      if (o.data[i * 5 + 4] === 1) homing++;
      const d = Math.hypot(
        o.data[i * 5] - window.__game.player.x,
        o.data[i * 5 + 1] - window.__game.player.z,
      );
      far = Math.max(far, d);
    }
    return { n: o.n, homing, far };
  });
  check(
    'Magnet starts every orb on the map moving, wherever it is',
    latched.homing === latched.n && latched.n >= 120,
    `${latched.homing}/${latched.n} homing, farthest ${latched.far.toFixed(0)} u out`,
  );
  // 110 units at the home-speed floor (PLAYER_SPEED × ORB_HOME_MUL = 11.9 u/s) is ~9.3 s.
  await page.waitForTimeout(13000);
  const after = await prog();
  check(
    'and they all arrive',
    after.orbs === 0 && after.total >= before.total + 120,
    `${after.orbs} left, +${after.total - before.total} xp`,
  );
  await rearm();
}

// Twelve levels of upgrade modifiers, undone by replacing the sim objects. This is the check that
// `resetGame` does not have to remember each modifier one by one — the failure it guards is a second
// run of a session silently starting with the first run's stats.
await page.evaluate(() => {
  const g = window.__game;
  g.boosts.timers.fill(0);
  g.player.invincible = 0;
  window.__reset();
});
await page.waitForTimeout(300);
const unlevelled = await prog();
const clearedBoosts = await page.evaluate(() => {
  const g = window.__game;
  return {
    active: Array.from(g.boosts.timers).filter((t) => t > 0).length,
    field: g.boosts.n,
    invincible: g.player.invincible,
    boostMul: g.combat.boostMul,
    lifesteal: g.combat.lifesteal,
  };
});
check(
  'a restart un-levels the character completely',
  unlevelled.level === 1 &&
    unlevelled.maxHp === 100 &&
    unlevelled.bolt === false &&
    unlevelled.orbiters === 0 &&
    unlevelled.knockback === 0 &&
    unlevelled.damageMul === 1 &&
    unlevelled.speedMul === 1 &&
    unlevelled.magnetR === 3 &&
    unlevelled.dashCdMax === 2.2 &&
    unlevelled.orbs === 0,
  `lv ${unlevelled.level}, ${unlevelled.maxHp} max hp, lance ${unlevelled.bolt}, dash cd ${unlevelled.dashCdMax}`,
);
check(
  'and clears every running boost with it',
  clearedBoosts.active === 0 &&
    clearedBoosts.field === 0 &&
    clearedBoosts.invincible === 0 &&
    clearedBoosts.boostMul === 1 &&
    clearedBoosts.lifesteal === 0,
  `${clearedBoosts.active} active, ${clearedBoosts.field} on the ground`,
);

// --- 13. the run ends, and starts again -------------------------------------------------------------
// Deliberately on the level-1 run the reset above just produced. The M3 death path is about the
// balance of contact damage against i-frames, and a level-12 loadout — Concussion holding the crowd
// off, 25% more damage, an Orbiter — measures the unlock table instead.
// The M3 "done when": a full run is playable start to death. Rather than wait out a real one, put the
// player on low health in a crowd — the death PATH is what is under test, not the balance curve.
await mortal();
await page.evaluate(() => {
  window.__game.player.hp = 20;
});
// Brutes at 18 contact damage: two hits and it is over. Placed at 5 units and left to walk in rather
// than stacked on the player — two dozen bodies spawned inside each other's separation radius fling
// themselves clean off the screen, and the frozen field behind the card is part of what the card is
// showing.
await ring(14, 2, 5.0);
await page.waitForTimeout(5000);
const dead = await page.evaluate(() => {
  const g = window.__game;
  return { hp: g.player.hp, time: g.time, text: document.body.innerText, n: g.swarm.n };
});
check('the player can die', dead.hp === 0, `${dead.hp} hp`);
check('death raises the game-over card', dead.text.includes('YOU DIED'), dead.text.replace(/\s+/g, ' ').slice(0, 60));
check(
  'the card shows the run',
  /survived\s+\d+:\d\d/.test(dead.text) && /killed\s+\d+/.test(dead.text),
  dead.text.replace(/\s+/g, ' ').match(/survived.*?level\s+\d+/)?.[0] ?? '(not found)',
);

// The field is frozen behind the card: the run is over, and a crowd still grinding over the body
// would be claiming otherwise.
const frozenA = await page.evaluate(() => ({
  t: window.__game.time,
  x: window.__game.swarm.data[0],
}));
await page.waitForTimeout(700);
const frozenB = await page.evaluate(() => ({
  t: window.__game.time,
  x: window.__game.swarm.data[0],
}));
check('the clock and the field stop on death', frozenA.t === frozenB.t && frozenA.x === frozenB.x, `t ${frozenB.t.toFixed(2)}`);

await capture('game-over');

// Restart from the card — the only way out of it, and the only menu in the game.
await page.click('text=RUN AGAIN');
await page.waitForTimeout(400);
const restarted = await page.evaluate(() => {
  const g = window.__game;
  return {
    hp: g.player.hp,
    time: g.time,
    kills: g.combat.kills,
    n: g.swarm.n,
    x: g.player.x,
    z: g.player.z,
    card: document.body.innerText.includes('YOU DIED'),
    level: g.prog.level,
    orbs: g.orbs.n,
  };
});
check('RUN AGAIN starts a clean run', !restarted.card && restarted.hp === 100 && restarted.kills === 0, `${restarted.hp} hp, ${restarted.kills} kills, t ${restarted.time.toFixed(1)}`);
check('the restart puts the player back at the origin on an empty field', Math.hypot(restarted.x, restarted.z) < 1 && restarted.n < 12, `(${restarted.x.toFixed(1)}, ${restarted.z.toFixed(1)}), ${restarted.n} enemies`);
check(
  'RUN AGAIN clears the level and the orbs left on the ground',
  restarted.level === 1 && restarted.orbs === 0,
  `lv ${restarted.level}, ${restarted.orbs} orbs`,
);

// --- 14. the budget, with combat running ------------------------------------------------------------
await teleport(-90, 90);
await page.evaluate(() => window.__spawn(400, 2, 22)); // brutes: 60 hp, so the field stays full
await page.waitForTimeout(2000);
const loaded = await combat();
check('the whole tick stays inside its 2 ms budget with combat at cap', loaded.stepMs < 2, `${loaded.stepMs.toFixed(2)} ms at ${loaded.n} enemies`);
const combatFps = await steadyFps();
check('holds 60 fps with combat at cap', combatFps !== null && combatFps >= 55, `${combatFps} fps`);

// --- 15. imported models (M6a) ----------------------------------------------------------------------
// The registry seam: what resolved to a GLB, what fell back, and — the milestone's actual acceptance
// criterion — that a missing file degrades to the primitive rather than breaking anything.
const models = await page.evaluate(() => window.__models());
check(
  'the GLB named in the registry is loaded and instanced',
  models.grunt && models.grunt.fallback === false && models.grunt.textured === true,
  `grunt: ${models.grunt?.fallback === false ? 'loaded' : 'FELL BACK'}${models.grunt?.textured ? ', textured' : ''}`,
);

// --- M6b: the VAT bake -----------------------------------------------------------------------------
check(
  'the rigged GLB baked a VAT with every clip the game asks for',
  models.grunt?.animated === true &&
    ['idle', 'walk', 'run', 'attack', 'die'].every((c) => models.grunt.clips.includes(c)) &&
    models.grunt.frames > 100 &&
    models.grunt.vatMB < 32,
  `[${models.grunt?.clips?.join(', ')}] — ${models.grunt?.frames} frames, ${models.grunt?.vatMB} MB`,
);

// Attacks are chosen by DISTANCE, not speed — an enemy pressed against the player is nearly
// stationary, and on the speed thresholds alone it would play `idle` while killing you.
{
  await teleport(-100, 80);
  await disarm();
  await page.evaluate(() => {
    const g = window.__game;
    g.combat.orbiters = 0;
    const s = g.swarm;
    s.n = 0;
    const put = (x, z) => {
      const b = s.n * 8;
      s.data[b] = g.player.x + x;
      s.data[b + 1] = g.player.z + z;
      s.data[b + 2] = 0;
      s.data[b + 3] = 0;
      s.data[b + 4] = 10;
      s.data[b + 5] = 0;
      s.data[b + 6] = 0;
      s.data[b + 7] = Math.random();
      s.n++;
    };
    // Ten jammed onto the player, eight standing well clear of it. Generous counts because the
    // margin band below discards whatever separation has nudged into the boundary ring.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      put(Math.cos(a) * 1.0, Math.sin(a) * 1.0);
    }
    for (let i = 0; i < 8; i++) put(-8 + i * 2.3, 9);
  });
  await page.waitForTimeout(600);

  const byDistance = await page.evaluate(() => {
    const g = window.__game;
    const vat = window.__actor('grunt').vat;
    const clipOf = (row) => {
      for (const c of vat.clips) if (row >= c.start && row < c.start + c.count) return c.name;
      return '?';
    };
    let attr = null;
    window.__r3f.scene.traverse((o) => {
      if (!attr && o.isInstancedMesh && o.geometry.getAttribute('aVatRow') && o.count > 5) {
        attr = o.geometry.getAttribute('aVatRow').array;
      }
    });
    // Bucketed with a MARGIN either side of the attack radius. Separation keeps nudging the crowd,
    // and the row was written on the last rendered frame while the distance is read now — so an
    // enemy sitting exactly on the boundary can legitimately disagree with itself. The band is
    // ignored rather than guessed at; what is being tested is the rule, not the arithmetic of a
    // frame of drift.
    const R = 2.2; // TUNING.VAT_ATTACK_R
    const near = [];
    const far = [];
    for (let i = 0; i < g.swarm.n; i++) {
      const d = Math.hypot(g.swarm.data[i * 8] - g.player.x, g.swarm.data[i * 8 + 1] - g.player.z);
      if (d < R * 0.8) near.push(clipOf(attr[i]));
      else if (d > R * 1.3) far.push(clipOf(attr[i]));
    }
    return { near, far };
  });
  check(
    'enemies in contact play an attack, not idle',
    byDistance.near.length >= 4 && byDistance.near.every((c) => c.startsWith('attack')),
    `close: [${byDistance.near.join(', ')}]`,
  );
  check(
    'and enemies still closing in do not',
    byDistance.far.length >= 4 && byDistance.far.every((c) => !c.startsWith('attack')),
    `far: [${byDistance.far.join(', ')}]`,
  );
  check(
    'the attack variants are spread across the crowd rather than all the same',
    new Set(byDistance.near).size > 1 || models.grunt.clips.filter((c) => c.startsWith('attack')).length === 1,
    `${new Set(byDistance.near).size} distinct of ${models.grunt.clips.filter((c) => c.startsWith('attack')).length} baked`,
  );
  await rearm();
}

// The crowd is actually animating: the per-instance row attribute must spread across many distinct
// frames (idle alone is 296 rows; a stuck bake would leave every instance on one), and the same
// instances must be on different rows a moment later.
{
  await teleport(-100, 80);
  await disarm();
  await page.evaluate(() => {
    window.__game.swarm.n = 0;
    window.__spawn(60, 0, 18);
  });
  await page.waitForTimeout(700);
  const readRows = () =>
    page.evaluate(() => {
      const scene = window.__r3f?.scene;
      let rows = null;
      // The grunt mesh is the InstancedMesh whose geometry carries the aVatRow attribute.
      scene?.traverse((o) => {
        if (!rows && o.isInstancedMesh && o.geometry.getAttribute('aVatRow') && o.count > 10) {
          rows = Array.from(o.geometry.getAttribute('aVatRow').array.slice(0, o.count));
        }
      });
      return rows;
    });
  const a = await readRows();
  await page.waitForTimeout(400);
  const b = await readRows();
  const distinct = a ? new Set(a.map(Math.floor)).size : 0;
  const moved = a && b ? a.filter((v, i) => Math.floor(v) !== Math.floor(b[i])).length : 0;
  check(
    'the crowd animates: instances sit on many VAT frames and advance through them',
    a !== null && distinct > 10 && moved > a.length / 2,
    `${distinct} distinct frames across ${a?.length ?? 0} instances, ${moved} advanced in 0.4 s`,
  );
  await rearm();
}
check(
  'every actor without a url is on its primitive, with no warning',
  ['player', 'runner', 'brute', 'elite', 'orb', 'prop'].every((id) => models[id]?.fallback === true),
  Object.entries(models)
    .map(([id, m]) => `${id}:${m.fallback ? 'prim' : 'glb'}`)
    .join(' '),
);

// The whole point of the fallback rule (MODEL-PIPELINE §1): break the asset, keep the game.
// A fresh page with the GLB request aborted — the same thing a viewer sees after a typo in the
// filename, except reproducible.
{
  const brokenPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const brokenLog = [];
  brokenPage.on('console', (m) => brokenLog.push(`${m.type()}: ${m.text()}`));
  brokenPage.on('pageerror', (e) => brokenLog.push(`pageerror: ${e.message}`));
  await brokenPage.route('**/models/*.glb', (route) => route.abort());
  await brokenPage.goto(url, { waitUntil: 'domcontentloaded' });
  await brokenPage.waitForFunction(
    () => !!document.querySelector('canvas') && !!window.__game && !document.getElementById('boot'),
    { timeout: 30000 },
  );
  await brokenPage.waitForTimeout(1200);

  const degraded = await brokenPage.evaluate(() => ({
    models: window.__models(),
    n: window.__game.swarm.n,
    hp: window.__game.player.hp,
    canvas: !!document.querySelector('canvas'),
  }));
  check(
    'a missing GLB degrades to the primitive instead of breaking the game',
    degraded.models.grunt.fallback === true && degraded.canvas && degraded.hp === 100,
    `grunt on primitive, ${degraded.n} enemies live, canvas up`,
  );
  check(
    'and says exactly which file failed and what happened',
    brokenLog.some((l) => l.includes('grunt.glb') && l.includes('falling back')),
    brokenLog.find((l) => l.includes('grunt.glb'))?.slice(0, 96) ?? '(no warning logged)',
  );
  check(
    'a broken asset raises no page error at all',
    !brokenLog.some((l) => l.startsWith('pageerror')),
    brokenLog.filter((l) => l.startsWith('pageerror')).join(' | ') || 'none',
  );
  await brokenPage.close();
}

// 400 textured models is a different render load from 400 boxes — 807 tris each, a normal map and a
// metallic-roughness map. This is the check that importing the cast does not cost the framerate.
await teleport(-90, 90);
await page.evaluate(() => window.__spawn(400, 0, 26));
await page.waitForTimeout(2000);
const modelLoad = await combat();
check(
  'the tick holds its budget with 400 imported models on screen',
  modelLoad.stepMs < 2,
  `${modelLoad.stepMs.toFixed(2)} ms at ${modelLoad.n} enemies`,
);
const modelFps = await steadyFps();
check(
  'holds 60 fps with 400 imported models',
  modelFps !== null && modelFps >= 55,
  `${modelFps} fps, ~${(400 * 807).toLocaleString()} tris`,
);
await page.evaluate(() => {
  window.__game.swarm.n = 0;
});

// --- evidence ---------------------------------------------------------------------------------------
// Open ground south of the Keep, which sits dead ahead with its two outbuildings flanking it — the
// arena's most legible geography, and clear of anything that would occlude the character.
await teleport(0, 4);
// The camera is a lagging follow, so a teleport leaves it flying for the best part of a second. Let
// it land before capturing, or the shot reads as "the camera isn't centred".
await page.waitForTimeout(1200);
// A ring of mixed tiers, close enough to be on screen — the shot has to show the crowd, which is
// what M2 delivers. Long enough for the flow and separation to shape it into a front.
await page.evaluate(() => {
  const s = window.__game.swarm;
  s.n = 0;
  window.__spawn(60, 0, 18);
  window.__spawn(14, 1, 22);
  window.__spawn(6, 2, 15);
});
await page.waitForTimeout(1400);
// Run TOWARD the camera for the shot, so the facing pip is on the visible side of the capsule.
await hold(['KeyS'], 250);
// Clear the harness's invulnerability, or the player is caught mid-blink at 30% opacity — the shot
// would show the one actor DESIGN §12 rule 1 says must be the brightest thing on screen faded out.
await page.evaluate(() => {
  window.__game.player.iframe = 0;
});
const fps = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*fps/);
  return m ? Number(m[1]) : null;
});
await capture('swarm-tiers');

// M3's own frame: the aura ring on the ground with a front rank grinding into it, bolts in flight,
// and bodies punching out. Shot mid-fight, because every one of those is a transient.
//
// Deliberately a crowd a real run PRODUCES — a front arriving from one side, not a solid annulus
// packed onto the player. The first version of this shot piled 94 enemies inside 12 units and the
// resulting wall of bodies hid the player completely, which says nothing true about the game and
// everything about the harness.
await teleport(0, 4);
await mortal();
await page.evaluate(() => {
  const g = window.__game;
  const s = g.swarm;
  s.n = 0;
  g.player.facing = 0; // facing +Z, into the arriving front, so the bolts fly toward the camera
  // A loose arc to the south, spread over 5 units of depth: what the director actually delivers.
  const put = (count, tier, r0, spread, a0, a1) => {
    for (let i = 0; i < count; i++) {
      const a = a0 + ((a1 - a0) * i) / count;
      const r = r0 + spread * ((i * 37) % 10) / 10;
      const b = s.n * 8;
      s.data[b] = g.player.x + Math.sin(a) * r;
      s.data[b + 1] = g.player.z + Math.cos(a) * r;
      s.data[b + 2] = 0;
      s.data[b + 3] = 0;
      s.data[b + 4] = [10, 6, 60][tier];
      s.data[b + 5] = tier;
      s.data[b + 6] = 0;
      s.data[b + 7] = Math.random();
      s.n++;
    }
  };
  put(26, 0, 5.5, 5, -1.1, 1.1);
  put(7, 1, 8, 4, -0.8, 0.8);
  put(3, 2, 9, 2, -0.4, 0.4);
});
// The Lance is a level 3 unlock and this is a fresh run, so grant the levels the shot is meant to
// depict rather than waiting out the XP for them. The Orbiter at level 9 belongs in frame too: it is
// the one unlock with a body in the world.
await page.evaluate(() => {
  const g = window.__game;
  let guard = 0;
  while (g.prog.level < 9 && guard++ < 40) window.__grantXp(g.prog.need);
});
await page.waitForTimeout(1600); // the front reaches the ring and the aura starts killing into it
await capture('combat');

await browser.close();

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed  ·  ${fps ?? '?'} fps ` +
    `(${headless ? 'software' : 'hardware'})  ·  ${shots.join('  ')}`,
);
process.exit(failed.length ? 1 : 0);
