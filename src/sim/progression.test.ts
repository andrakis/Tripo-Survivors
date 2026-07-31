// Progression tests: the XP curve, and that the unlock table in DESIGN §6.3 is the one that runs.
//
// The bar here is the same as everywhere else in sim/ — guard a specific way this could break, do
// not re-state the tuning table. So the level-by-level test asserts the *effect* of each unlock on
// the live fields the weapons actually read, not that a table has twelve rows.
//
// Same rules as the rest of sim/: no three, no WebGL, no mocks (ARCHITECTURE §2.1).

import { describe, expect, it } from 'vitest';
import { TIERS, TUNING } from '../config';
import { createCombat, DR_VALUE, DROP_STRIDE, stepCombat, type Combat } from './combat';
import { makeGrid, type Grid } from './grid';
import { createOrbs, spawnOrb, stepOrbs, type Orbs } from './orbs';
import { createPlayer, type Player } from './player';
import {
  createProgression,
  stepProgression,
  unlockFor,
  UNLOCKS,
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
  // The field names are the ones sim/progression.ts Loadout expects — the unlock table writes
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
 */
function tick(w: World, dt = DT): void {
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

  it('grants EVERY level a single big pickup crosses, not just the last one', () => {
    // An elite orb is worth 40 XP — more than the first three levels put together. If the level-up
    // were an `if` rather than a `while`, a player who walked into a saved pile would jump to the
    // right level with the intervening unlocks silently skipped, and the Lance would never arrive.
    const w = world();
    // 40 XP buys level 2 (5) and level 3 (14) and leaves 21 against level 4's 25.
    expect(grant(w, 40)).toBe(3);
    expect(w.prog.xp).toBe(21);
    expect(w.combat.auraR).toBe(TUNING.AURA_R + 1.0); // level 2 applied...
    expect(w.combat.boltEnabled).toBe(true); //          ...and level 3, not only the last one
  });
});

describe('the unlock table', () => {
  /** Walk a fresh world up to `level` one level at a time, through the ordinary XP path. */
  function at(level: number): World {
    const w = world();
    while (w.prog.level < level) grant(w, w.prog.need);
    expect(w.prog.level).toBe(level);
    return w;
  }

  it('applies DESIGN §6.3 in order, one distinct effect per level', () => {
    expect(at(2).combat.auraR).toBe(TUNING.AURA_R + 1.0);
    expect(at(3).combat.boltEnabled).toBe(true);
    expect(at(4).combat.damageMul).toBeCloseTo(1.25, 10);
    expect(at(5).combat.boltPierce).toBe(TUNING.BOLT_PIERCE + 2);
    expect(at(6).combat.boltInterval).toBeCloseTo(TUNING.BOLT_INTERVAL / 1.2, 10);
    expect(at(7).combat.boltCount).toBe(2);
    expect(at(8).player.speedMul).toBeCloseTo(1.1, 10);
    expect(at(9).combat.orbiters).toBe(1);
    expect(at(10).orbs.magnetR).toBeCloseTo(TUNING.PICKUP_R * 1.5, 10);
    expect(at(11).combat.knockback).toBe(TUNING.KNOCKBACK);

    const twelve = at(12);
    expect(twelve.player.maxHp).toBe(TUNING.PLAYER_HP + 25);
    expect(twelve.player.hp).toBe(twelve.player.maxHp); // "and heal to full"
  });

  it('starts a run with NOTHING unlocked — the Lance included', () => {
    // The M3 default was `boltEnabled: true`, because a combat milestone with one weapon is not a
    // combat milestone. Now that there is a level 3 to unlock it, shipping it on would make the
    // single most legible unlock in the table invisible.
    const c = createCombat();
    expect(c.boltEnabled).toBe(false);
    expect(c.boltCount).toBe(1);
    expect(c.damageMul).toBe(1);
    expect(c.orbiters).toBe(0);
    expect(c.knockback).toBe(0);
    expect(createPlayer().speedMul).toBe(1);
    expect(createOrbs().magnetR).toBe(TUNING.PICKUP_R);
  });

  it('leaves TUNING alone — a run modifies live fields, never the balance table', () => {
    // The failure this guards is subtle and permanent: an unlock that wrote into TUNING would
    // survive `resetGame`, and the second run of a session would silently start at the first run's
    // final stats. Every scale factor is checked against the number config.ts still holds.
    const w = at(12);
    expect(TUNING.AURA_R).toBe(3.0);
    expect(TUNING.BOLT_INTERVAL).toBe(0.55);
    expect(TUNING.BOLT_PIERCE).toBe(1);
    expect(TUNING.PICKUP_R).toBe(3.0);
    expect(TUNING.PLAYER_HP).toBe(100);
    expect(w.combat.auraR).not.toBe(TUNING.AURA_R); // and the run really did diverge from it
  });

  it('keeps paying out past the end of the table, without granting a second Orbiter', () => {
    // Levels 13+ cycle damage / fire rate / aura radius / move speed at +10%. The NEW mechanics are
    // excluded on purpose: an Orbiter every four levels eventually out-damages both weapons and the
    // endgame becomes a passive.
    const w = at(12 + 8); // levels 13..20: exactly two full turns of the four-step cycle
    expect(w.combat.orbiters).toBe(1);
    expect(w.combat.boltCount).toBe(2);
    // Two turns of the cycle is +10% twice on each of the four stats.
    expect(w.combat.damageMul).toBeCloseTo(1.25 * TUNING.LATE_STEP ** 2, 10);
    expect(w.player.speedMul).toBeCloseTo(1.1 * TUNING.LATE_STEP ** 2, 10);
    // ...and a label exists for every level, so the toast is never blank.
    for (let l = 2; l < 40; l++) expect(unlockFor(l).label.length).toBeGreaterThan(0);
    expect(unlockFor(2)).toBe(UNLOCKS[0]);
  });
});

describe('a scripted run', () => {
  it('turns a fixed kill sequence into a deterministic level and unlock set', () => {
    // The M4 acceptance test. 30 grunts standing inside the aura, nothing else: no spawn director,
    // no swarm movement, no randomness anywhere in the chain. Two pulses kill each (10 hp, 6
    // damage), each drops a 1 XP orb at 2.0 units — inside the magnet radius — so the whole 30 XP is
    // banked, and 30 XP is exactly levels 2 and 3 with 11 left over toward level 4 (5 + 14 = 19).
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
    expect(w.prog.lastUnlock).toBe('NEW — Lance');

    // The unlock set that level implies, read off the fields the weapons use.
    expect(w.combat.auraR).toBe(TUNING.AURA_R + 1.0);
    expect(w.combat.boltEnabled).toBe(true);
    expect(w.combat.damageMul).toBe(1); // level 4 not reached
  });

  it('pays nothing for a kill whose orb is never collected', () => {
    // The whole point of routing XP through orbs (DESIGN §8): a kill at the far end of the arena is
    // worth nothing until you go and get it. If this ever passes with `xp > 0`, kills are awarding
    // XP directly again and the pickup is decoration.
    const w = world();
    const far = spawnEnemy(w.swarm, 40, 40, 0);
    w.swarm.data[far * ENEMY_STRIDE + E_HP] = 1;
    w.combat.auraR = 100; // reach it without moving the player, so the ORB's distance is what is on trial

    for (let t = 0; t < 2; t += DT) tick(w);

    expect(w.combat.kills).toBe(1);
    expect(w.orbs.n).toBe(1); // it dropped...
    expect(w.prog.totalXp).toBe(0); // ...and it is still lying there
    expect(w.prog.level).toBe(1);
  });

  it('reaches level 8 well inside the XP a normal run produces by 2:30', () => {
    // DESIGN §8 targets level 8 by ~2:30. The spawn director's rate is SPAWN_BASE + t/SPAWN_RAMP, so
    // by 150 s it has released the integral below — and level 8 costs 424. This does NOT claim the
    // balance is right (that is M5's pass against a real run); it guards the much cruder property
    // that the curve and the spawn ramp are within an order of magnitude of each other, which is the
    // kind of thing a stray edit to XP_EXP breaks silently.
    const t = 150;
    const spawned = TUNING.SPAWN_BASE * t + (t * t) / (2 * TUNING.SPAWN_RAMP);
    expect(spawned * TIERS[0].xp).toBeGreaterThan(cumulative(8));
    expect(spawned * TIERS[0].xp).toBeLessThan(cumulative(14)); // and not so cheap it laps the table
  });
});
