// Progression tests: the XP curve, the automatic weapon unlocks, and the upgrade the player picks.
//
// The bar here is the same as everywhere else in sim/ — guard a specific way this could break, do
// not re-state the tuning table. So the tests assert the *effect* of an upgrade on the live fields
// the weapons actually read, and the pause/choice protocol that a level-up now runs.
//
// Same rules as the rest of sim/: no three, no WebGL, no mocks (ARCHITECTURE §2.1).

import { describe, expect, it } from 'vitest';
import { TIERS, TUNING } from '../config';
import { createCombat, DR_VALUE, DROP_STRIDE, stepCombat, type Combat } from './combat';
import { makeGrid, type Grid } from './grid';
import { createOrbs, spawnOrb, stepOrbs, type Orbs } from './orbs';
import { createPlayer, type Player } from './player';
import {
  AUTO_UNLOCKS,
  chooseUpgrade,
  createProgression,
  isPaused,
  rollOffer,
  stepProgression,
  UPGRADES,
  xpToNext,
  type Progression,
} from './progression';
import { buildSwarmGrid, createSwarm, ENEMY_STRIDE, E_HP, spawnEnemy, type Swarm } from './swarm';

const DT = 1 / 60;

interface World {
  player: Player;
  swarm: Swarm;
  grid: Grid;
  combat: Combat;
  orbs: Orbs;
  prog: Progression;
  time: number;
}

/** Everything game.ts wires, wired the same way. */
function world(): World {
  // The field names are the ones sim/progression.ts Loadout expects — the upgrade table writes
  // straight into these objects, exactly as it does into the game singleton.
  return {
    player: createPlayer(),
    swarm: createSwarm(),
    grid: makeGrid(),
    combat: createCombat(),
    orbs: createOrbs(),
    prog: createProgression(),
    time: 0,
  };
}

/**
 * Tick steps 5 and 7–10, at a fixed dt. The swarm is deliberately NOT stepped: every test below
 * places enemies where it wants them and asks what the weapons and the XP chain do about it, and a
 * moving crowd would make the answer depend on separation and flow.
 *
 * `pick` is what the harness does with an offer, standing in for the player. Passing -1 leaves the
 * choice open, which is how the pause itself gets tested.
 */
function tick(w: World, dt = DT, pick = 0): void {
  if (isPaused(w.prog)) {
    if (pick >= 0) chooseUpgrade(w.prog, w, pick, w.time);
    return; // the run is frozen while a choice is outstanding — game.ts short-circuits identically
  }
  w.time += dt;
  buildSwarmGrid(w.swarm, w.grid);
  stepCombat(w.combat, w.player, w.swarm, w.grid, dt);
  for (let i = 0; i < w.combat.nDrops; i++) {
    const b = i * DROP_STRIDE;
    spawnOrb(w.orbs, w.combat.drops[b], w.combat.drops[b + 1], w.combat.drops[b + DR_VALUE]);
  }
  stepProgression(w.prog, w, stepOrbs(w.orbs, w.player, dt), w.time, dt);
}

/** Grant XP through the ordinary path and return the level it produced. */
function grant(w: World, amount: number): number {
  stepProgression(w.prog, w, amount, w.time, 0);
  return w.prog.level;
}

/**
 * Walk a world up to `level` through the ordinary XP path, taking the upgrade whose id is `prefer`
 * whenever it is on offer and card 0 otherwise.
 *
 * It returns a TALLY of what was actually taken, because `prefer` is a preference and not a
 * guarantee: an offer is three cards out of seven, so a run that wants Damage every time does not
 * get it. A test that assumed otherwise would be asserting the shuffle, not the stacking.
 */
function climb(w: World, level: number, prefer?: string): Record<string, number> {
  const taken: Record<string, number> = {};
  let guard = 0;
  while (w.prog.level < level && guard++ < 400) {
    if (isPaused(w.prog)) {
      const offer = w.prog.offer!;
      const i = prefer ? offer.findIndex((u) => u.id === prefer) : 0;
      const pick = i >= 0 ? i : 0;
      taken[offer[pick].id] = (taken[offer[pick].id] ?? 0) + 1;
      chooseUpgrade(w.prog, w, pick, w.time);
    } else {
      grant(w, w.prog.need);
    }
  }
  return taken;
}

/** Total XP needed to REACH `level` from level 1. */
function cumulative(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpToNext(l);
  return sum;
}

describe('the XP curve', () => {
  it('matches the table in DESIGN §8', () => {
    // These are the FORMULA's values. DESIGN §8's printed table was a few points high from level 5
    // up (53/106/191 against 52/102/184) — the formula is the specification and the table was the
    // approximation of it, so the table was corrected rather than the curve.
    expect(xpToNext(1)).toBe(5);
    expect(xpToNext(2)).toBe(14);
    expect(xpToNext(3)).toBe(25);
    expect(xpToNext(4)).toBe(38);
    expect(xpToNext(5)).toBe(52);
    expect(xpToNext(8)).toBe(102);
    expect(xpToNext(12)).toBe(184);
    // ...and the cumulative column, which is what the "level 8 by 2:30" target is actually against.
    expect(cumulative(8)).toBe(287);
    expect(cumulative(12)).toBe(813);
  });

  it('banks XP toward the next level and never loses the remainder', () => {
    const w = world();
    grant(w, 4);
    expect(w.prog.level).toBe(1);
    expect(w.prog.xp).toBe(4);

    grant(w, 3); // 7 total: 5 spends on level 2, 2 carries
    expect(w.prog.level).toBe(2);
    expect(w.prog.xp).toBe(2);
    expect(w.prog.need).toBe(xpToNext(2));
    expect(w.prog.totalXp).toBe(7);
  });
});

describe('the level-up protocol', () => {
  it('pauses on a level that offers a choice, and resumes when one is taken', () => {
    const w = world();
    expect(isPaused(w.prog)).toBe(false);

    grant(w, xpToNext(1)); // level 2: a choice level
    expect(w.prog.level).toBe(2);
    expect(isPaused(w.prog)).toBe(true);
    expect(w.prog.offer!.length).toBeGreaterThan(1);

    expect(chooseUpgrade(w.prog, w, 0, 0)).toBe(true);
    expect(isPaused(w.prog)).toBe(false);
    expect(w.prog.lastUnlock).toBeTruthy();
  });

  it('grants a weapon level automatically, with no pause at all', () => {
    // The odd levels 3-11 are the run's power spine (DESIGN §6.3). A player who could decline the
    // Lance would have a run with no Lance, so these are news rather than a decision.
    const w = world();
    climb(w, 3);
    expect(w.prog.level).toBe(3);
    expect(isPaused(w.prog)).toBe(false);
    expect(w.combat.boltEnabled).toBe(true);
    expect(w.prog.lastUnlock).toBe(AUTO_UNLOCKS[3].label);
  });

  it('does not skip a level banked behind an outstanding choice', () => {
    // 100 XP at level 1 crosses levels 2, 3 and 4 at once. The choice at level 2 must not swallow
    // the Lance at 3 or the second choice at 4 — the loop stops at the offer and picks up after it.
    const w = world();
    grant(w, 100);
    expect(w.prog.level).toBe(2);
    expect(isPaused(w.prog)).toBe(true);

    chooseUpgrade(w.prog, w, 0, 0);
    // Level 3 is automatic, so resolving the choice runs straight through it and stops at 4's offer.
    expect(w.prog.level).toBe(4);
    expect(w.combat.boltEnabled).toBe(true);
    expect(isPaused(w.prog)).toBe(true);

    chooseUpgrade(w.prog, w, 0, 0);
    expect(isPaused(w.prog)).toBe(false);
    expect(w.prog.totalXp).toBe(100);
  });

  it('never pauses on an empty offer', () => {
    // The deadlock guard. `isPaused` is `offer !== null`, so a zero-length offer would freeze the
    // sim with nothing on screen to click — unrecoverable, and silent. Simulated by making every
    // upgrade unavailable, which today's pool cannot do on its own.
    const w = world();
    const saved = UPGRADES.map((u) => u.available);
    UPGRADES.forEach((u) => (u.available = () => false));
    try {
      grant(w, xpToNext(1));
      expect(w.prog.level).toBe(2);
      expect(isPaused(w.prog)).toBe(false);
      expect(w.prog.lastLevelAt).toBeGreaterThanOrEqual(0); // and it still announced the level
    } finally {
      UPGRADES.forEach((u, i) => (u.available = saved[i]));
    }
  });

  it('ignores an out-of-range pick rather than quietly applying the first card', () => {
    // This is wired straight to a keypress. Treating `4` as card 1 would spend a level-up on
    // something the player did not read.
    const w = world();
    grant(w, xpToNext(1));
    expect(chooseUpgrade(w.prog, w, 9, 0)).toBe(false);
    expect(chooseUpgrade(w.prog, w, -1, 0)).toBe(false);
    expect(isPaused(w.prog)).toBe(true);
  });

  it('offers distinct upgrades, and nothing that would be a dead card', () => {
    const w = world();
    for (let roll = 0; roll < 200; roll++) {
      const offer = rollOffer(w.prog, w);
      expect(offer.length).toBe(TUNING.OFFER_COUNT);
      expect(new Set(offer.map((u) => u.id)).size).toBe(offer.length);
      // Fire rate before the Lance exists would be an upgrade to a weapon that is not firing.
      expect(offer.some((u) => u.id === 'rate')).toBe(false);
    }

    w.combat.boltEnabled = true;
    let sawRate = false;
    for (let roll = 0; roll < 200; roll++) {
      if (rollOffer(w.prog, w).some((u) => u.id === 'rate')) sawRate = true;
    }
    expect(sawRate).toBe(true);
  });

  it('reaches every upgrade in the pool across enough rolls', () => {
    // A shuffle that quietly favoured the head of the pool would make the last two entries almost
    // unreachable, which is invisible in play and fatal to the point of having a choice.
    const w = world();
    w.combat.boltEnabled = true;
    const seen = new Set<string>();
    for (let roll = 0; roll < 500; roll++) {
      for (const u of rollOffer(w.prog, w)) seen.add(u.id);
    }
    expect(seen.size).toBe(UPGRADES.length);
  });
});

describe('what the upgrades do', () => {
  it('applies the picked upgrade to the live field its weapon reads', () => {
    const cases: [string, (w: World) => unknown, unknown][] = [
      ['aura', (w) => w.combat.auraR, TUNING.AURA_R + 1.0],
      ['damage', (w) => w.combat.damageMul, 1.25],
      ['speed', (w) => w.player.speedMul, 1.1],
      ['magnet', (w) => w.orbs.magnetR, TUNING.PICKUP_R * 1.5],
      ['hp', (w) => w.player.maxHp, TUNING.PLAYER_HP + 25],
      ['dash', (w) => w.player.dashCdMax, TUNING.DASH_COOLDOWN * 0.8],
    ];

    for (const [id, read, expected] of cases) {
      const w = world();
      UPGRADES.find((u) => u.id === id)!.apply(w);
      expect(read(w), id).toBeCloseTo(expected as number, 10);
    }
  });

  it('stacks a repeated pick rather than capping it', () => {
    // Levels 2, 4, 6, 8, 10 and 12 are choices; a run that takes Damage whenever it is offered gets
    // it some of the time, and the multiplier has to be exactly 1.25 to that power.
    const w = world();
    const taken = climb(w, 13, 'damage');
    expect(taken.damage).toBeGreaterThan(0);
    expect(w.combat.damageMul).toBeCloseTo(1.25 ** taken.damage, 8);
    // No cap, no clamp: the same number reached by applying it directly that many times.
    const direct = world();
    for (let i = 0; i < taken.damage; i++) UPGRADES.find((u) => u.id === 'damage')!.apply(direct);
    expect(direct.combat.damageMul).toBeCloseTo(w.combat.damageMul, 8);
  });

  it('grants the weapon spine on its fixed schedule whatever the player picks', () => {
    const w = world();
    const taken = climb(w, 11, 'hp');
    expect(w.combat.boltEnabled).toBe(true);
    expect(w.combat.boltPierce).toBe(TUNING.BOLT_PIERCE + 2);
    expect(w.combat.boltCount).toBe(2);
    expect(w.combat.orbiters).toBe(1);
    expect(w.combat.knockback).toBe(TUNING.KNOCKBACK);
    // ...and "heal to full" left the player at whatever maximum their picks built.
    expect(w.player.maxHp).toBe(TUNING.PLAYER_HP + 25 * (taken.hp ?? 0));
    if (taken.hp) expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('starts a run with NOTHING unlocked — the Lance included', () => {
    const c = createCombat();
    expect(c.boltEnabled).toBe(false);
    expect(c.boltCount).toBe(1);
    expect(c.damageMul).toBe(1);
    expect(c.orbiters).toBe(0);
    expect(c.knockback).toBe(0);
    expect(createPlayer().speedMul).toBe(1);
    expect(createPlayer().dashCdMax).toBe(TUNING.DASH_COOLDOWN);
    expect(createOrbs().magnetR).toBe(TUNING.PICKUP_R);
  });

  it('leaves TUNING alone — a run modifies live fields, never the balance table', () => {
    // The failure this guards is subtle and permanent: an upgrade that wrote into TUNING would
    // survive `resetGame`, and the second run of a session would silently start at the first run's
    // final stats. Every scale factor is checked against the number config.ts still holds.
    const w = world();
    climb(w, 12);
    expect(TUNING.AURA_R).toBe(3.0);
    expect(TUNING.BOLT_INTERVAL).toBe(0.55);
    expect(TUNING.BOLT_PIERCE).toBe(1);
    expect(TUNING.PICKUP_R).toBe(3.0);
    expect(TUNING.PLAYER_HP).toBe(100);
    expect(TUNING.DASH_COOLDOWN).toBe(2.2);
    expect(w.prog.level).toBe(12);
  });

  it('keeps offering real cards long past the end of the weapon table', () => {
    // Level 30 is even, so reaching it raises an offer — and that offer must still be a full hand of
    // distinct upgrades. The pool is entirely repeatable for exactly this reason: there is no
    // "taken" state to exhaust, so a long run never runs out of cards to read.
    const w = world();
    climb(w, 30);
    expect(w.prog.level).toBe(30);
    expect(isPaused(w.prog)).toBe(true);
    expect(w.prog.offer!.length).toBe(TUNING.OFFER_COUNT);
    expect(new Set(w.prog.offer!.map((u) => u.id)).size).toBe(TUNING.OFFER_COUNT);
    // The NEW mechanics are granted once each, not on a cycle — the pool must never hand one out.
    expect(w.combat.orbiters).toBe(1);
    expect(w.combat.boltCount).toBe(2);
  });
});

describe('a scripted run', () => {
  it('turns a fixed kill sequence into a deterministic level and unlock set', () => {
    // The acceptance test. 30 grunts standing inside the aura, nothing else: no spawn director, no
    // swarm movement, no randomness in the chain except which cards are offered — and the harness
    // always takes card 0, so even that is pinned. Two pulses kill each (10 hp, 6 damage), each
    // drops a 1 XP orb at 2.0 units — inside the magnet radius — so the whole 30 XP is banked, and
    // 30 XP is exactly levels 2 and 3 with 11 left over toward level 4 (5 + 14 = 19).
    const w = world();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      spawnEnemy(w.swarm, Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
    }

    for (let t = 0; t < 3; t += DT) tick(w);

    expect(w.swarm.n).toBe(0);
    expect(w.combat.kills).toBe(30);
    expect(w.orbs.n).toBe(0); // every orb collected
    expect(w.prog.totalXp).toBe(30);
    expect(w.prog.level).toBe(3);
    expect(w.prog.xp).toBe(30 - 5 - 14);
    expect(w.prog.need).toBe(xpToNext(3));
    expect(w.prog.lastUnlock).toBe(AUTO_UNLOCKS[3].label);

    // Level 2 was a choice and the harness took it; level 3 granted the Lance.
    expect(w.combat.boltEnabled).toBe(true);
    expect(isPaused(w.prog)).toBe(false);
  });

  it('stops the world at a choice and does not restart it until one is taken', () => {
    const w = world();
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      spawnEnemy(w.swarm, Math.cos(a) * 2.0, Math.sin(a) * 2.0, 0);
    }
    // pick = -1: never answer the card.
    for (let t = 0; t < 3; t += DT) tick(w, DT, -1);

    expect(isPaused(w.prog)).toBe(true);
    expect(w.prog.level).toBe(2);
    const frozenTime = w.time;
    const survivors = w.swarm.n;
    for (let t = 0; t < 1; t += DT) tick(w, DT, -1);
    expect(w.time).toBe(frozenTime);
    expect(w.swarm.n).toBe(survivors);
  });

  it('pays nothing for a kill whose orb is never collected', () => {
    // The whole point of routing XP through orbs (DESIGN §8): a kill at the far end of the arena is
    // worth nothing until you go and get it. If this ever passes with `xp > 0`, kills are awarding
    // XP directly again and the pickup is decoration.
    const w = world();
    const far = spawnEnemy(w.swarm, 40, 40, 0);
    w.swarm.data[far * ENEMY_STRIDE + E_HP] = 1;
    w.combat.auraR = 100; // reach it without moving the player, so the ORB's distance is on trial

    for (let t = 0; t < 2; t += DT) tick(w);

    expect(w.combat.kills).toBe(1);
    expect(w.orbs.n).toBe(1); // it dropped...
    expect(w.prog.totalXp).toBe(0); // ...and it is still lying there
    expect(w.prog.level).toBe(1);
  });

  it('reaches level 8 well inside the XP a normal run produces by 2:30', () => {
    // DESIGN §8 targets level 8 by ~2:30. The spawn director's rate is SPAWN_BASE + t/SPAWN_RAMP, so
    // by 150 s it has released the integral below — and level 8 costs 287. This does NOT claim the
    // balance is right (that is M5's pass against a real run); it guards the much cruder property
    // that the curve and the spawn ramp are within an order of magnitude of each other, which is the
    // kind of thing a stray edit to XP_EXP breaks silently.
    const t = 150;
    const spawned = TUNING.SPAWN_BASE * t + (t * t) / (2 * TUNING.SPAWN_RAMP);
    expect(spawned * TIERS[0].xp).toBeGreaterThan(cumulative(8));
    expect(spawned * TIERS[0].xp).toBeLessThan(cumulative(14)); // and not so cheap it laps the table
  });
});
