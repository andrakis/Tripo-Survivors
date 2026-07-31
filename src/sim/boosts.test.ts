// Boost tests: the field of pickups, and what each one actually changes (DESIGN §6.4).
//
// The important property, and the one most of these guard, is that a boost is a TIMER driving live
// fields — so it expires on its own, it never double-applies, and it never eats the permanent
// upgrades sitting in the field next to it.
//
// Same rules as the rest of sim/: no three, no WebGL, no mocks (ARCHITECTURE §2.1).

import { describe, expect, it } from 'vitest';
import {
  BK_AKIMBO,
  BK_BLOODLUST,
  BK_INVINCIBLE,
  BK_MAGNET,
  BK_QUAD,
  BOOSTS,
  TIERS,
  TUNING,
} from '../config';
import {
  BOOST_STRIDE,
  collectBoost,
  createBoosts,
  isActive,
  P_KIND,
  P_X,
  P_Z,
  spawnBoost,
  stepBoosts,
  type Boosts,
} from './boosts';
import { createCombat, stepCombat, type Combat } from './combat';
import { makeGrid, type Grid } from './grid';
import { createOrbs, spawnOrb, type Orbs } from './orbs';
import { createPlayer, type Player } from './player';
import { buildSwarmGrid, createSwarm, ENEMY_STRIDE, E_HP, spawnEnemy, type Swarm } from './swarm';
import { overlapsObstacle } from './world';

const DT = 1 / 60;

interface World {
  player: Player;
  combat: Combat;
  orbs: Orbs;
  boosts: Boosts;
  swarm: Swarm;
  grid: Grid;
  time: number;
}

function world(): World {
  return {
    player: createPlayer(),
    combat: createCombat(),
    orbs: createOrbs(),
    boosts: createBoosts(),
    swarm: createSwarm(),
    grid: makeGrid(),
    time: 0,
  };
}

/** Steps 8a and 7, in the order game.ts runs them. */
function tick(w: World, dt = DT): void {
  w.time += dt;
  stepBoosts(w.boosts, w.player, w.combat, w.orbs, w.time, dt);
  buildSwarmGrid(w.swarm, w.grid);
  stepCombat(w.combat, w.player, w.swarm, w.grid, dt);
}

/**
 * Give the player a boost the way walking over one would, and push the timers onto the live fields.
 *
 * Deliberately step 8a ONLY, not a whole tick: `stepCombat` fires the aura and the Lance on the
 * frame their timers hit zero, which for a fresh Combat is the very first one — so setting a boost
 * up with a full tick would spend a pulse and a volley before the test had measured anything.
 */
function take(w: World, kind: number): void {
  collectBoost(w.boosts, kind, w.orbs, w.time);
  stepBoosts(w.boosts, w.player, w.combat, w.orbs, w.time, 0);
}

describe('the field of pickups', () => {
  it('puts them within reach and never inside a prop', () => {
    const b = createBoosts();
    for (let i = 0; i < 400; i++) {
      b.n = 0;
      expect(spawnBoost(b, 0, 0, i % BOOSTS.length)).toBe(true);
      const x = b.data[P_X];
      const z = b.data[P_Z];
      const d = Math.hypot(x, z);
      expect(d).toBeGreaterThanOrEqual(TUNING.BOOST_R_MIN - 1e-6);
      expect(d).toBeLessThanOrEqual(TUNING.BOOST_R_MAX + 1e-6);
      // Rejection-sampled against the arena for the same reason the spawn director is: a pickup
      // inside the Keep is one the player can watch and never reach.
      expect(overlapsObstacle(x, z, TUNING.BOOST_PICKUP_R)).toBe(false);
    }
  });

  it('holds at MAX_BOOSTS', () => {
    const b = createBoosts();
    for (let i = 0; i < TUNING.MAX_BOOSTS + 5; i++) {
      expect(spawnBoost(b, 0, 0, 0)).toBe(i < TUNING.MAX_BOOSTS);
    }
    expect(b.n).toBe(TUNING.MAX_BOOSTS);
  });

  it('drops one on its own clock, and not before BOOST_FIRST', () => {
    const w = world();
    for (let t = 0; t < TUNING.BOOST_FIRST - 1; t += DT) tick(w);
    expect(w.boosts.n).toBe(0);
    for (let t = 0; t < 2; t += DT) tick(w);
    expect(w.boosts.n).toBe(1);
  });

  it('is picked up by walking over it, and only over it', () => {
    const w = world();
    spawnBoost(w.boosts, 0, 0, BK_QUAD);
    const x = w.boosts.data[P_X];
    const z = w.boosts.data[P_Z];

    tick(w);
    expect(w.boosts.n).toBe(1); // the player is 11+ units away

    w.player.x = x;
    w.player.z = z;
    tick(w);
    expect(w.boosts.n).toBe(0);
    expect(isActive(w.boosts, BK_QUAD)).toBe(true);
  });
});

describe('what each boost does', () => {
  it('Quad Damage multiplies outbound damage, and gives it back when it expires', () => {
    const w = world();
    const i = spawnEnemy(w.swarm, 1, 0, 3); // an elite: survives to be measured
    take(w, BK_QUAD);

    const before = w.swarm.data[i * ENEMY_STRIDE + E_HP];
    tick(w); // the aura pulses on the first tick
    expect(before - w.swarm.data[i * ENEMY_STRIDE + E_HP]).toBe(
      TUNING.AURA_DAMAGE * TUNING.QUAD_MUL,
    );

    for (let t = 0; t < BOOSTS[BK_QUAD].duration + 0.1; t += DT) tick(w);
    expect(w.combat.boostMul).toBe(1);
  });

  it('Quad Damage does not consume the run\'s permanent damage upgrades', () => {
    // The failure this guards: folding the boost into `damageMul` would mean the first Quad Damage
    // to expire also deletes every Damage +25% the player has taken.
    const w = world();
    w.combat.damageMul = 1.25;
    take(w, BK_QUAD);
    for (let t = 0; t < BOOSTS[BK_QUAD].duration + 0.1; t += DT) tick(w);
    expect(w.combat.damageMul).toBe(1.25);
    expect(w.combat.boostMul).toBe(1);
  });

  it('Guns Akimbo doubles the volley without touching the Twin Lance unlock', () => {
    const w = world();
    w.combat.boltEnabled = true;
    w.combat.boltCount = 2; // Twin Lance already taken

    take(w, BK_AKIMBO);
    w.combat.boltTimer = 0.0001;
    tick(w);
    expect(w.combat.nb).toBe(2 * TUNING.AKIMBO_MUL);

    for (let t = 0; t < BOOSTS[BK_AKIMBO].duration + 0.1; t += DT) tick(w);
    expect(w.combat.boltCount).toBe(2); // the unlock survived the boost
    expect(w.combat.boltCountMul).toBe(1);
  });

  it('Invincible refuses damage for its whole duration and not a tick longer', () => {
    const w = world();
    take(w, BK_INVINCIBLE);
    expect(w.player.invincible).toBeCloseTo(BOOSTS[BK_INVINCIBLE].duration, 6);

    // Halfway through: still untouchable.
    for (let t = 0; t < BOOSTS[BK_INVINCIBLE].duration / 2; t += DT) tick(w);
    spawnEnemy(w.swarm, 0.2, 0, 2);
    buildSwarmGrid(w.swarm, w.grid);
    expect(w.player.invincible).toBeGreaterThan(0);
    expect(w.player.hp).toBe(TUNING.PLAYER_HP);

    for (let t = 0; t < BOOSTS[BK_INVINCIBLE].duration; t += DT) tick(w);
    expect(w.player.invincible).toBe(0);
  });

  it('Bloodlust heals per kill, capped at max HP', () => {
    const w = world();
    w.player.hp = 40;
    take(w, BK_BLOODLUST);
    for (let i = 0; i < 12; i++) spawnEnemy(w.swarm, 1 + (i % 4) * 0.3, (i / 4) * 0.3, 0);
    const started = w.swarm.n;

    for (let t = 0; t < 1.2; t += DT) tick(w);
    const killed = started - w.swarm.n;
    expect(killed).toBeGreaterThan(0);
    expect(w.player.hp).toBe(40 + killed * TUNING.BLOODLUST_HEAL);

    // It cannot push past the maximum, however many things die.
    w.player.hp = w.player.maxHp;
    for (let i = 0; i < 20; i++) spawnEnemy(w.swarm, 1 + (i % 5) * 0.3, (i / 5) * 0.3, 0);
    for (let t = 0; t < 1.2; t += DT) tick(w);
    expect(w.player.hp).toBe(w.player.maxHp);
  });

  it('Bloodlust heals nothing once it has expired', () => {
    const w = world();
    take(w, BK_BLOODLUST);
    for (let t = 0; t < BOOSTS[BK_BLOODLUST].duration + 0.1; t += DT) tick(w);
    expect(w.combat.lifesteal).toBe(0);

    w.player.hp = 40;
    for (let i = 0; i < 8; i++) spawnEnemy(w.swarm, 1 + (i % 4) * 0.3, (i / 4) * 0.3, 0);
    for (let t = 0; t < 1.2; t += DT) tick(w);
    expect(w.swarm.n).toBeLessThan(8); // things did die
    expect(w.player.hp).toBe(40);
  });

  it('Magnet latches the whole map and leaves no timer behind', () => {
    const w = world();
    for (let i = 0; i < 40; i++) spawnOrb(w.orbs, 30 + i, -50, TIERS[0].xp);
    take(w, BK_MAGNET);

    expect(isActive(w.boosts, BK_MAGNET)).toBe(false); // instant: nothing to time down
    for (let i = 0; i < w.orbs.n; i++) expect(w.orbs.data[i * 5 + 4]).toBe(1); // O_HOME
  });
});

describe('timers', () => {
  it('restarts a duration rather than stacking it', () => {
    // Stacking would let a player bank an unbroken multiplier across a whole run, and the point of
    // a boost is that it ends.
    const w = world();
    take(w, BK_QUAD);
    for (let t = 0; t < 10; t += DT) tick(w);
    const midway = w.boosts.timers[BK_QUAD];
    expect(midway).toBeLessThan(BOOSTS[BK_QUAD].duration);

    take(w, BK_QUAD);
    expect(w.boosts.timers[BK_QUAD]).toBe(BOOSTS[BK_QUAD].duration);
  });

  it('runs two boosts at once without either one clearing the other', () => {
    const w = world();
    take(w, BK_QUAD);
    take(w, BK_AKIMBO);
    expect(w.combat.boostMul).toBe(TUNING.QUAD_MUL);
    expect(w.combat.boltCountMul).toBe(TUNING.AKIMBO_MUL);
    expect(isActive(w.boosts, BK_QUAD)).toBe(true);
    expect(isActive(w.boosts, BK_AKIMBO)).toBe(true);
  });

  it('records the pickup so the HUD can announce it', () => {
    const w = world();
    w.time = 12.5;
    take(w, BK_BLOODLUST);
    expect(w.boosts.lastPickupAt).toBe(12.5);
    expect(w.boosts.lastKind).toBe(BK_BLOODLUST);
  });

  it('leaves every live field at its default when nothing is active', () => {
    const w = world();
    for (let t = 0; t < 1; t += DT) tick(w);
    expect(w.combat.boostMul).toBe(1);
    expect(w.combat.boltCountMul).toBe(1);
    expect(w.combat.lifesteal).toBe(0);
    expect(w.player.invincible).toBe(0);
    expect(w.boosts.data.length).toBe(TUNING.MAX_BOOSTS * BOOST_STRIDE);
    expect(w.boosts.data[P_KIND]).toBe(0);
  });
});
