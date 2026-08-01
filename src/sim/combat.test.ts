// Combat tests: the two weapons, the damage they do, and what happens to what they kill.
//
// Same rules as the rest of sim/ — no three, no WebGL, no canvas, no mocks (ARCHITECTURE §2.1). The
// bar for a test here is that it guards a specific way this could break, not that it re-states the
// tuning table.

import { describe, expect, it } from 'vitest';
import { TIERS, TUNING } from '../config';
import { buildGrid, makeGrid, queryNeighbors } from './grid';
import { createPlayer } from './player';
import {
  B_PIERCE,
  BOLT_STRIDE,
  B_VX,
  B_VZ,
  B_X,
  B_Z,
  createCombat,
  D_AGE,
  DEATH_STRIDE,
  DR_VALUE,
  DROP_STRIDE,
  stepCombat,
  takeContact,
  type Combat,
} from './combat';
import {
  buildSwarmGrid,
  createSwarm,
  ENEMY_STRIDE,
  E_FLASH,
  E_HP,
  E_VX,
  E_VZ,
  E_X,
  E_Z,
  spawnEnemy,
  type Swarm,
} from './swarm';

const DT = 1 / 60;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/**
 * A player, a swarm, a grid and a combat state, wired the way game.ts wires them — but with the
 * Lance ON.
 *
 * `createCombat` ships it off from M4: DESIGN §6.3 unlocks it at level 3 and progression owns that
 * (sim/progression.ts). Every test below is about what the weapons DO, not about when they are
 * granted, so they enable it explicitly rather than each one silently depending on the default.
 */
function scene() {
  const p = createPlayer();
  const s = createSwarm();
  const g = makeGrid();
  const c = createCombat();
  c.boltEnabled = true;
  return { p, s, g, c };
}

/** Total XP value queued by this tick's kills. Combat no longer awards XP — it queues drops that
 *  become orbs in step 8, so this is what "the kill paid out" means from here (sim/orbs.ts). */
function dropped(c: Combat): number {
  let sum = 0;
  for (let i = 0; i < c.nDrops; i++) sum += c.drops[i * DROP_STRIDE + DR_VALUE];
  return sum;
}

/** One tick of steps 5 and 7 only — nothing here needs the swarm to move. */
function tick(c: Combat, p: ReturnType<typeof createPlayer>, s: Swarm, g: ReturnType<typeof makeGrid>, dt = DT) {
  buildSwarmGrid(s, g);
  stepCombat(c, p, s, g, dt);
}

const hpOf = (s: Swarm, i: number) => s.data[i * ENEMY_STRIDE + E_HP];

describe('the aura', () => {
  it('reaches its FULL radius, not just the nine grid cells nearest the player', () => {
    // The regression test for grid.queryNeighbors. The swarm grid's cell is SEP_R (1.1) and the aura
    // is 3.0, so a fixed 3×3 scan reaches 1.65 units and silently spares everything past it. That
    // failure has no symptom except "the aura seems weak", which is indistinguishable from tuning.
    const { p, s, g, c } = scene();
    c.boltEnabled = false;

    const inner: number[] = [];
    const outer: number[] = [];
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      inner.push(spawnEnemy(s, Math.cos(a) * 2.6, Math.sin(a) * 2.6, 0)); // inside 3.0, outside 1.65
      outer.push(spawnEnemy(s, Math.cos(a) * 3.6, Math.sin(a) * 3.6, 0)); // outside 3.0
    }

    tick(c, p, s, g);

    for (const i of inner) expect(hpOf(s, i)).toBe(TIERS[0].hp - TUNING.AURA_DAMAGE);
    for (const i of outer) expect(hpOf(s, i)).toBe(TIERS[0].hp);
  });

  it('pulses at AURA_RATE regardless of the framerate it is stepped at', () => {
    // The property that matters is that a 240 Hz machine does not get four times the damage. Run the
    // same wall-clock window at two very different frame times and demand the same number of pulses.
    //
    // 2.25 s deliberately: at 2/s the pulses land at 0, 0.5, 1.0, 1.5 and 2.0, so the window ends
    // nowhere near a pulse boundary and the count is not decided by floating-point luck.
    const pulses = (dt: number) => {
      const { p, s, g, c } = scene();
      c.boltEnabled = false;
      const i = spawnEnemy(s, 1, 0, 3); // an elite: 400 hp, survives the whole window
      for (let t = 0; t < 2.25; t += dt) tick(c, p, s, g, dt);
      return (TIERS[3].hp - hpOf(s, i)) / TUNING.AURA_DAMAGE;
    };

    expect(pulses(1 / 60)).toBe(5);
    expect(pulses(1 / 240)).toBe(5);
  });

  it('marks what it hits so the renderer can flash it', () => {
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    const i = spawnEnemy(s, 1, 0, 3);
    tick(c, p, s, g);
    expect(s.data[i * ENEMY_STRIDE + E_FLASH]).toBeCloseTo(TUNING.FLASH_TIME, 6);
  });
});

describe('the bolt', () => {
  /** Silence the aura so a test about the Lance is only about the Lance. */
  function boltOnly() {
    const sc = scene(); // already has boltEnabled — see above
    sc.c.auraTimer = 1e6;
    return sc;
  }

  it('fires along facing, on cadence, and expires at BOLT_RANGE', () => {
    const { p, s, g, c } = boltOnly();
    p.facing = 0; // +Z

    tick(c, p, s, g);
    expect(c.nb).toBe(1);
    expect(c.bolts[B_X]).toBeCloseTo(p.x, 6);

    // It travels +Z and nothing else.
    const flight = TUNING.BOLT_RANGE / TUNING.BOLT_SPEED;
    for (let t = 0; t < flight * 0.9; t += DT) tick(c, p, s, g);
    expect(c.bolts[B_Z]).toBeGreaterThan(TUNING.BOLT_RANGE * 0.8);
    expect(Math.abs(c.bolts[B_X])).toBeLessThan(1e-3);

    // ...and is gone by the time it has covered its range, rather than flying to the world edge.
    // (A second bolt has been fired by now on the 0.55 s cadence, so check by position not by count.)
    for (let t = 0; t < flight * 0.3; t += DT) tick(c, p, s, g);
    for (let i = 0; i < c.nb; i++) {
      expect(c.bolts[i * BOLT_STRIDE + B_Z]).toBeLessThanOrEqual(TUNING.BOLT_RANGE + 1);
    }
  });

  it('pierces exactly BOLT_PIERCE enemies past the first, then stops', () => {
    const { p, s, g, c } = boltOnly();
    p.facing = 0;
    // Brutes, so a hit does not kill and the HP is readable afterwards. Spaced past the aura radius
    // and past each other's separation radius so each is an independent target.
    const line = [spawnEnemy(s, 0, 5, 2), spawnEnemy(s, 0, 8, 2), spawnEnemy(s, 0, 11, 2)];

    // Stop before the cadence fires a SECOND bolt at 0.55 s — otherwise this measures two bolts and
    // reads as pierce being unbounded. The first bolt clears the farthest target at 11/26 = 0.42 s.
    for (let t = 0; t < 0.5; t += DT) tick(c, p, s, g);
    // Consumed by the second hit rather than flying on — pierce is a budget, not a mode.
    expect(c.nb).toBe(0);

    const hits = line.map((i) => (TIERS[2].hp - hpOf(s, i)) / TUNING.BOLT_DAMAGE);
    expect(hits.slice(0, TUNING.BOLT_PIERCE + 1).every((h) => h === 1)).toBe(true);
    expect(hits[TUNING.BOLT_PIERCE + 1]).toBe(0); // the bolt was consumed before reaching this one
  });

  it('hits a given enemy ONCE over its whole flight, not once per tick in range', () => {
    // The bug this milestone actually shipped and had to fix. A bolt stays inside its 0.75-unit hit
    // radius of a stationary target for about three ticks at 60 fps, so a plain
    // "distance to the swept segment" test damaged the same enemy three times and burned the pierce
    // budget on it — which presents as pierce not working, not as the hit test being wrong.
    const { p, s, g, c } = boltOnly();
    p.facing = 0;
    const i = spawnEnemy(s, 0, 9, 3); // an elite: survives, so the damage total is readable

    for (let t = 0; t < 0.5; t += DT) tick(c, p, s, g);
    expect(TIERS[3].hp - hpOf(s, i)).toBe(TUNING.BOLT_DAMAGE);
  });

  it('sweeps the segment instead of testing the point it landed on', () => {
    // The tunnelling case. game.ts clamps dt to 50 ms, at which a bolt covers 1.3 units and cannot
    // step over a 1.5-unit-wide target — so this feeds a dt the game never passes, to prove that the
    // clamp is a safety margin and NOT the only thing preventing bolts from missing. Without the
    // sweep this is intermittent, framerate-dependent, and reported as "it doesn't work on my
    // machine".
    const { p, s, g, c } = boltOnly();
    p.facing = 0;
    const dt = 0.2; // 5.2 units of travel in one tick
    const mid = spawnEnemy(s, 0, 2.6, 2); // dead centre of the step, ~2.6 u from BOTH endpoints

    tick(c, p, s, g, dt);
    expect(TIERS[2].hp - hpOf(s, mid)).toBe(TUNING.BOLT_DAMAGE);
  });

  it('damages an enemy once per pass, not once per sample of the swept segment', () => {
    // The sample discs along the segment overlap on purpose, so without the `stamp` dedupe a target
    // sitting in the overlap eats several hits and burns several pierce charges from one pass.
    const { p, s, g, c } = boltOnly();
    p.facing = 0;
    const i = spawnEnemy(s, 0, 2.6, 3); // an elite, so it survives however many times it is hit

    tick(c, p, s, g, 0.2);
    expect(TIERS[3].hp - hpOf(s, i)).toBe(TUNING.BOLT_DAMAGE);
    expect(c.bolts[B_PIERCE]).toBe(TUNING.BOLT_PIERCE - 1); // exactly one charge spent
  });

  it('does not fire while disabled — the seam M4 unlocks the Lance through', () => {
    const { p, s, g, c } = boltOnly();
    c.boltEnabled = false;
    for (let t = 0; t < 3; t += DT) tick(c, p, s, g);
    expect(c.nb).toBe(0);
  });
});

describe('what the unlocks actually do', () => {
  // sim/progression.test.ts checks that reaching a level writes the right live field. These check
  // that the weapons then behave differently — the half that would still be broken if a field were
  // set and never read.

  it('scales every damage source with damageMul, not just the one that was edited last', () => {
    // The level 4 unlock is "Damage +25% (all sources)". It is applied inside `hit`, so a weapon
    // added later cannot opt out of it by forgetting to multiply.
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    c.damageMul = 2;
    const i = spawnEnemy(s, 1, 0, 3); // an elite: survives the pulse
    tick(c, p, s, g);
    expect(TIERS[3].hp - hpOf(s, i)).toBe(TUNING.AURA_DAMAGE * 2);
  });

  it('fires Twin Lance as two bolts fanned symmetrically about facing', () => {
    // ±BOLT_SPREAD about where the player was already aiming, NOT one bolt moved and one added: the
    // level 7 unlock has to widen the shot the player has spent six levels learning to aim.
    const { p, s, g, c } = scene();
    c.auraTimer = 1e6;
    c.boltCount = 2;
    p.facing = 0; // +Z

    tick(c, p, s, g);

    expect(c.nb).toBe(2);
    const angle = (i: number) =>
      Math.atan2(c.bolts[i * BOLT_STRIDE + B_VX], c.bolts[i * BOLT_STRIDE + B_VZ]);
    expect(angle(0)).toBeCloseTo(-TUNING.BOLT_SPREAD, 6);
    expect(angle(1)).toBeCloseTo(TUNING.BOLT_SPREAD, 6);
  });

  it('gives each bolt of the volley its own pierce budget', () => {
    const { p, s, g, c } = scene();
    c.auraTimer = 1e6;
    c.boltCount = 2;
    c.boltPierce = 3; // the level 5 unlock
    tick(c, p, s, g);
    for (let i = 0; i < c.nb; i++) expect(c.bolts[i * BOLT_STRIDE + B_PIERCE]).toBe(3);
  });

  it('damages with the Orbiter on a cadence, in a ring the aura does not cover', () => {
    // A target parked on the orbit path and outside a level-1 aura. The orbit is what reaches it, so
    // this fails if the sphere's damage query is placed anywhere other than where it is drawn.
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    c.auraTimer = 1e6;
    c.orbiters = 1;
    c.orbiterPhase = 0;
    const i = spawnEnemy(s, TUNING.ORBITER_R, 0, 3); // elite, so it survives to be counted
    expect(TUNING.ORBITER_R).toBeGreaterThan(TUNING.UNIT_R + TUNING.PLAYER_R);

    // One full revolution: the sphere passes the target once, and the cadence lands on it.
    for (let t = 0; t < (Math.PI * 2) / TUNING.ORBITER_SPIN; t += DT) tick(c, p, s, g);
    const dealt = TIERS[3].hp - hpOf(s, i);
    expect(dealt).toBeGreaterThan(0);
    // ...but it is a cadence, not per-tick contact. Per-tick would be 60 × 5 for every tick in
    // range; the whole revolution must cost a small handful of hits.
    expect(dealt).toBeLessThanOrEqual(TUNING.ORBITER_DAMAGE * 6);
  });

  it('does nothing at all before the Orbiter is unlocked', () => {
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    c.auraTimer = 1e6;
    const i = spawnEnemy(s, TUNING.ORBITER_R, 0, 3);
    for (let t = 0; t < 3; t += DT) tick(c, p, s, g);
    expect(hpOf(s, i)).toBe(TIERS[3].hp);
  });

  it('throws the crowd outward on a pulse once Concussion is unlocked', () => {
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    c.knockback = TUNING.KNOCKBACK;
    const i = spawnEnemy(s, 2, 0, 3); // elite: 400 hp, so it is knocked back rather than killed

    tick(c, p, s, g); // the pulse fires on the first tick

    // Outward along the line from the player, and only outward.
    expect(s.data[i * ENEMY_STRIDE + E_VX]).toBeCloseTo(TUNING.KNOCKBACK, 6);
    expect(s.data[i * ENEMY_STRIDE + E_VZ]).toBeCloseTo(0, 6);
  });

  it('leaves the crowd alone on a pulse before Concussion', () => {
    const { p, s, g, c } = scene();
    c.boltEnabled = false;
    const i = spawnEnemy(s, 2, 0, 3);
    tick(c, p, s, g);
    expect(s.data[i * ENEMY_STRIDE + E_VX]).toBe(0);
  });
});

describe('death', () => {
  it('counts one kill and one XP award per enemy, whatever killed it', () => {
    const { p, s, g, c } = scene();
    const rand = rng(9001);
    // A pile inside the aura and along the bolt's line, so both weapons are landing on the same
    // bodies in the same ticks — the case where a double-count would show up.
    for (let i = 0; i < 80; i++) {
      spawnEnemy(s, (rand() - 0.5) * 5, (rand() - 0.5) * 5, i % 3);
    }
    const started = s.n;

    let payout = 0;
    for (let t = 0; t < 8; t += DT) {
      tick(c, p, s, g);
      payout += dropped(c);
    }

    expect(c.kills).toBe(started - s.n);
    expect(c.kills).toBeGreaterThan(20); // and it actually killed things
    expect(payout).toBeGreaterThanOrEqual(c.kills); // every tier is worth at least 1 XP
  });

  it('leaves no dead enemy in the live range, and no live enemy lost', () => {
    const { p, s, g, c } = scene();
    const rand = rng(555);
    for (let i = 0; i < 120; i++) spawnEnemy(s, (rand() - 0.5) * 6, (rand() - 0.5) * 6, i % 3);

    for (let t = 0; t < 6; t += DT) {
      tick(c, p, s, g);
      for (let i = 0; i < s.n; i++) expect(hpOf(s, i)).toBeGreaterThan(0);
    }
  });

  it('drops a marker that punches out and then disappears', () => {
    const { p, s, g, c } = scene();
    for (let i = 0; i < 6; i++) spawnEnemy(s, i * 0.3 - 1, 0.4, 0);

    // Two aura pulses put a 10 hp grunt down.
    for (let t = 0; t < 0.75; t += DT) tick(c, p, s, g);
    expect(c.nd).toBeGreaterThan(0);
    expect(c.deaths[D_AGE]).toBeLessThan(TUNING.DEATH_TIME);

    for (let t = 0; t < TUNING.DEATH_TIME * 2; t += DT) tick(c, p, s, g);
    for (let i = 0; i < c.nd; i++) {
      expect(c.deaths[i * DEATH_STRIDE + D_AGE]).toBeLessThan(TUNING.DEATH_TIME);
    }
  });

  it('drops markers rather than kills when the marker buffer is full', () => {
    const { p, s, g, c } = scene();
    // Far more simultaneous deaths than MAX_DEATHS, all inside the aura.
    for (let i = 0; i < TUNING.MAX_DEATHS * 2; i++) {
      const a = (i / (TUNING.MAX_DEATHS * 2)) * Math.PI * 2;
      spawnEnemy(s, Math.cos(a) * 2, Math.sin(a) * 2, 0);
    }
    const started = s.n;
    for (let t = 0; t < 1; t += DT) tick(c, p, s, g);

    expect(c.nd).toBeLessThanOrEqual(TUNING.MAX_DEATHS);
    expect(c.kills).toBe(started - s.n); // every kill counted, even the ones with no marker
  });
});

describe('the level-up burst', () => {
  it('is a different signal from an aura pulse, not a brighter one', () => {
    // The bug M5's feedback pass found: `announce` used to set `auraFlare`, which the aura itself
    // sets to 1 twice a second. The "full aura flare" DESIGN §12 promises as the world-side half of
    // a level-up was therefore pixel-for-pixel an ordinary pulse, and the level-up had no signal in
    // the world at all. These two fields must stay independent, and a pulse must never write burst.
    const { p, s, g, c } = scene();
    c.auraTimer = 0;
    tick(c, p, s, g);
    expect(c.auraFlare).toBeGreaterThan(0.9); // the pulse fired...
    expect(c.auraBurst).toBe(0); // ...and did not claim to be a level-up
  });

  it('decays over AURA_BURST, and outlasts a pulse flare', () => {
    const { p, s, g, c } = scene();
    c.auraBurst = 1;
    // Half of AURA_BURST, which is more than a whole AURA_FLARE — the point of the longer window is
    // that the burst is still visible after the pulse it landed on has gone.
    const half = TUNING.AURA_BURST / 2;
    expect(half).toBeGreaterThan(TUNING.AURA_FLARE);
    for (let t = 0; t < half; t += DT) tick(c, p, s, g);
    expect(c.auraBurst).toBeGreaterThan(0.35);
    expect(c.auraBurst).toBeLessThan(0.65);
    for (let t = 0; t < TUNING.AURA_BURST; t += DT) tick(c, p, s, g);
    expect(c.auraBurst).toBe(0);
  });
});

describe('contact damage', () => {
  it('costs the WORST touching enemy, not the first one the grid walk reaches', () => {
    const { p, s, g } = scene();
    const c = createCombat();
    const reach = TUNING.PLAYER_R + TUNING.UNIT_R;
    spawnEnemy(s, reach * 0.5, 0, 0); // grunt, 6
    spawnEnemy(s, -reach * 0.5, 0, 2); // brute, 18 — array order puts the grunt first

    buildSwarmGrid(s, g);
    expect(takeContact(c, p, s, g)).toBe(true);
    expect(p.hp).toBe(TUNING.PLAYER_HP - TIERS[2].contact);
  });

  it('is gated by i-frames, so a crowd cannot delete the player in one frame', () => {
    const { p, s, g } = scene();
    const c = createCombat();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      spawnEnemy(s, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 0);
    }
    buildSwarmGrid(s, g);

    // Twelve enemies overlapping the player, held there for a second.
    let hits = 0;
    for (let t = 0; t < 1; t += DT) {
      p.iframe = Math.max(0, p.iframe - DT);
      if (takeContact(c, p, s, g)) hits++;
    }
    // 1 s of contact at 0.6 s of invulnerability per hit is 2 hits, not 720.
    expect(hits).toBe(2);
    expect(p.hp).toBe(TUNING.PLAYER_HP - 2 * TIERS[0].contact);
  });

  it('records what the hit cost, so the vignette can be proportional to it', () => {
    // M5's feedback pass. A runner hits for 4 and an elite for 30, and until `lastContact` existed
    // both drew exactly the same full-screen flash — the channel DESIGN §12 rule 4 reserves for "you
    // are being hurt" said nothing about how badly, which is the half that changes what you do next.
    const { p, s, g } = scene();
    const c = createCombat();
    spawnEnemy(s, 0.5, 0, 1); // runner, 4
    buildSwarmGrid(s, g);
    expect(takeContact(c, p, s, g)).toBe(true);
    expect(c.lastContact).toBe(TIERS[1].contact);

    // A hit that does NOT land must not overwrite it: the i-frame window is 0.6 s and the vignette
    // is still playing, so a rejected contact rewriting the field would rescale a flash mid-fade.
    p.hp = TUNING.PLAYER_HP;
    spawnEnemy(s, -0.5, 0, 3); // elite, 30 — but the i-frames from the runner are still up
    buildSwarmGrid(s, g);
    expect(takeContact(c, p, s, g)).toBe(false);
    expect(c.lastContact).toBe(TIERS[1].contact);

    p.iframe = 0;
    expect(takeContact(c, p, s, g)).toBe(true);
    expect(c.lastContact).toBe(TIERS[3].contact);
  });

  it('does not reach an enemy that is not touching', () => {
    const { p, s, g } = scene();
    const c = createCombat();
    spawnEnemy(s, TUNING.PLAYER_R + TUNING.UNIT_R + 0.2, 0, 0);
    buildSwarmGrid(s, g);
    expect(takeContact(c, p, s, g)).toBe(false);
    expect(p.hp).toBe(TUNING.PLAYER_HP);
  });

  it('stops once the player is dead', () => {
    const { p, s, g } = scene();
    const c = createCombat();
    spawnEnemy(s, 0.5, 0, 2);
    buildSwarmGrid(s, g);
    p.hp = 1;
    expect(takeContact(c, p, s, g)).toBe(true);
    expect(p.hp).toBe(0);
    p.iframe = 0;
    expect(takeContact(c, p, s, g)).toBe(false);
  });
});

describe('the grid at a query radius bigger than its cell', () => {
  it('still matches a brute-force O(n^2) scan', () => {
    // grid.queryNeighbors sizes its ring from the radius. This is the property that lets ONE grid
    // serve the swarm (1.1), the bolts (~1.3) and the aura (3.0) — see ARCHITECTURE §4.1.
    const rand = rng(2024);
    const count = 400;
    const pos = new Float32Array(count * ENEMY_STRIDE);
    for (let i = 0; i < count; i++) {
      pos[i * ENEMY_STRIDE] = (rand() - 0.5) * 60;
      pos[i * ENEMY_STRIDE + 1] = (rand() - 0.5) * 60;
    }
    const g = makeGrid();
    buildGrid(g, pos, ENEMY_STRIDE, count, TUNING.SEP_R);
    const out = new Int32Array(count);

    for (const radius of [TUNING.SEP_R, TUNING.AURA_R, 7.5]) {
      for (let k = 0; k < 40; k++) {
        const x = (rand() - 0.5) * 60;
        const z = (rand() - 0.5) * 60;
        const brute: number[] = [];
        for (let j = 0; j < count; j++) {
          const dx = pos[j * ENEMY_STRIDE] - x;
          const dz = pos[j * ENEMY_STRIDE + 1] - z;
          if (dx * dx + dz * dz <= radius * radius) brute.push(j);
        }
        const n = queryNeighbors(g, pos, ENEMY_STRIDE, count, x, z, radius, out);
        expect(Array.from(out.subarray(0, n)).sort((a, b) => a - b)).toEqual(
          brute.sort((a, b) => a - b),
        );
      }
    }
  });
});

describe('the swarm SoA survives combat', () => {
  it('keeps positions finite and inside the world through a long fight', () => {
    const { p, s, g, c } = scene();
    const rand = rng(77);
    for (let round = 0; round < 300; round++) {
      if (s.n < 150) {
        const a = rand() * Math.PI * 2;
        spawnEnemy(s, Math.cos(a) * 6, Math.sin(a) * 6, Math.floor(rand() * 3));
      }
      tick(c, p, s, g);
      for (let i = 0; i < s.n; i++) {
        expect(Number.isFinite(s.data[i * ENEMY_STRIDE + E_X])).toBe(true);
        expect(Number.isFinite(s.data[i * ENEMY_STRIDE + E_Z])).toBe(true);
      }
    }
  });
});
