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
const capFps = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*fps/);
  return m ? Number(m[1]) : null;
});
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
await teleport(-100, 80);
await mortal();
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
      auraR: g.combat.auraR,
      orbiters: g.combat.orbiters,
      knockback: g.combat.knockback,
      damageMul: g.combat.damageMul,
      speedMul: g.player.speedMul,
      hp: g.player.hp,
      maxHp: g.player.maxHp,
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
  'level 2 grew the aura and level 3 unlocked the Lance',
  levelled.auraR >= 4.0 && levelled.bolt === true,
  `auraR ${levelled.auraR}, lance ${levelled.bolt}`,
);

// The level-up itself: forced through the ordinary XP path (`__grantXp` is the call orb pickup
// makes) so the toast and the shake can be read without racing a fight.
await page.evaluate(() => {
  const g = window.__game;
  g.swarm.n = 0;
  g.orbs.n = 0;
  window.__grantXp(g.prog.need);
});
await page.waitForTimeout(120);
const toasted = await prog();
check(
  'a level-up raises the toast, names the unlock, and shakes the camera',
  toasted.text.includes(`LEVEL ${toasted.level}`) && toasted.shake > 0,
  `"${toasted.text.replace(/\s+/g, ' ').match(/LEVEL \d+ [^\n]{0,24}/)?.[0] ?? '(no toast)'}", shake ${toasted.shake.toFixed(2)}`,
);
await capture('level-up');

// The whole unlock table, in one jump: DESIGN §6.3 rows 4 through 12.
await page.evaluate(() => {
  const g = window.__game;
  let guard = 0;
  while (g.prog.level < 12 && guard++ < 40) window.__grantXp(g.prog.need);
});
await page.waitForTimeout(150);
const maxed = await prog();
check(
  'the full unlock table lands on the live fields the weapons read',
  maxed.level === 12 &&
    maxed.boltCount === 2 &&
    maxed.pierce === 3 &&
    maxed.orbiters === 1 &&
    maxed.knockback > 0 &&
    maxed.damageMul > 1.2 &&
    maxed.speedMul > 1.05 &&
    maxed.magnetR > 4,
  `lv12: ${maxed.boltCount} bolts, pierce ${maxed.pierce}, ${maxed.orbiters} orbiter, ` +
    `dmg ×${maxed.damageMul.toFixed(2)}, speed ×${maxed.speedMul.toFixed(2)}, magnet ${maxed.magnetR.toFixed(1)} u`,
);
check(
  'level 12 raises max HP and heals to full',
  maxed.maxHp === 125 && maxed.hp === maxed.maxHp,
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
const orbFps = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*fps/);
  return m ? Number(m[1]) : null;
});
check('holds 60 fps with a full orb field', orbFps !== null && orbFps >= 55, `${orbFps} fps`);

// Twelve levels of unlock modifiers, undone by replacing three objects. This is the check that
// `resetGame` does not have to remember each modifier one by one — the failure it guards is a second
// run of a session silently starting with the first run's stats.
await page.evaluate(() => window.__reset());
await page.waitForTimeout(300);
const unlevelled = await prog();
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
    unlevelled.orbs === 0,
  `lv ${unlevelled.level}, ${unlevelled.maxHp} max hp, lance ${unlevelled.bolt}, ${unlevelled.orbs} orbs`,
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
const combatFps = await page.evaluate(() => {
  const m = document.body.innerText.match(/(\d+)\s*fps/);
  return m ? Number(m[1]) : null;
});
check('holds 60 fps with combat at cap', combatFps !== null && combatFps >= 55, `${combatFps} fps`);

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
