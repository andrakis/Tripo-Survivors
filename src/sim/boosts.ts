// Boosts: the timed power-ups that appear on the field (DESIGN §6.4).
//
// They exist to break the run's monotonic pressure curve. Everything else in the game ramps — the
// spawn rate, the tiers, the player's own stats — and a run that only ramps has no shape. A boost is
// fifteen seconds where the arithmetic is different and the correct play changes: Quad Damage says
// go and stand in the crowd, Invincible says the same thing for a different reason, Magnet says stop
// fighting and cash in, and Bloodlust turns a losing fight into the way you heal.
//
// Two halves live here:
//   - a FIELD of uncollected pickups (an SoA, like every other population),
//   - a set of TIMERS for what is currently active.
//
// The timers write live fields on `combat` and `player` every tick, declaratively, rather than
// applying an effect on pickup and unwinding it on expiry. Nothing has to remember to undo itself,
// which is the same reason sim/progression.ts writes live fields instead of mutating TUNING.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import {
  BK_AKIMBO,
  BK_BLOODLUST,
  BK_INVINCIBLE,
  BK_MAGNET,
  BK_QUAD,
  BOOST_COUNT,
  BOOSTS,
  TUNING,
} from '../config';
import { latchAll, type Orbs } from './orbs';
import type { Combat } from './combat';
import type { Player } from './player';
import { clampToWorld, overlapsObstacle, type Vec2 } from './world';

export const BOOST_STRIDE = 4;
export const P_X = 0;
export const P_Z = 1;
/** Index into config's BOOSTS table. Order is identity there — see the comment on that table. */
export const P_KIND = 2;
/** Seconds on the ground. Renderer-only: the pop-in and the idle bob. */
export const P_AGE = 3;

export interface Boosts {
  /** Uncollected pickups lying on the field. */
  data: Float32Array;
  n: number;
  /** Seconds until the next one appears. */
  spawnTimer: number;
  /** Remaining seconds per kind, indexed by kind. Instant boosts never occupy a slot. */
  timers: Float32Array;
  /** Run time of the last pickup, or -1, and which kind it was. Drives the HUD toast — same
   *  keyed-on-a-value pattern as `lastHitAt` and `lastLevelAt`. */
  lastPickupAt: number;
  lastKind: number;
  /** LCG state. Owned here so a run's boost sequence is reproducible in a test. */
  rng: number;
}

export function createBoosts(): Boosts {
  return {
    data: new Float32Array(TUNING.MAX_BOOSTS * BOOST_STRIDE),
    n: 0,
    spawnTimer: TUNING.BOOST_FIRST,
    timers: new Float32Array(BOOST_COUNT),
    lastPickupAt: -1,
    lastKind: -1,
    rng: (Math.random() * 0xffffffff) >>> 0,
  };
}

/** 0..1. A plain LCG — this decides where a pickup lands, not anything a player could exploit. */
function rand(b: Boosts): number {
  b.rng = (b.rng * 1664525 + 1013904223) >>> 0;
  return b.rng / 4294967296;
}

export function isActive(b: Boosts, kind: number): boolean {
  return b.timers[kind] > 0;
}

/**
 * Put one pickup on the field, on a ring around the player and clear of the props.
 *
 * BOOST_R_MIN is inside the view's half-diagonal and BOOST_R_MAX is outside it, so about half of
 * them are visible the moment they land and the rest are a reason to look around. Rejection-sampled
 * against the obstacles for the same reason the spawn director is: a pickup inside the Keep is a
 * pickup the player can watch but never reach.
 */
export function spawnBoost(b: Boosts, px: number, pz: number, kind: number): boolean {
  if (b.n >= TUNING.MAX_BOOSTS) return false;
  const out: Vec2 = { x: 0, z: 0 };
  for (let attempt = 0; attempt < TUNING.BOOST_TRIES; attempt++) {
    const a = rand(b) * Math.PI * 2;
    const r = TUNING.BOOST_R_MIN + rand(b) * (TUNING.BOOST_R_MAX - TUNING.BOOST_R_MIN);
    clampToWorld(out, px + Math.cos(a) * r, pz + Math.sin(a) * r, TUNING.BOOST_PICKUP_R);
    if (overlapsObstacle(out.x, out.z, TUNING.BOOST_PICKUP_R)) continue;
    const o = b.n++ * BOOST_STRIDE;
    b.data[o + P_X] = out.x;
    b.data[o + P_Z] = out.z;
    b.data[o + P_KIND] = kind;
    b.data[o + P_AGE] = 0;
    return true;
  }
  return false; // every try landed in a prop; the next spawn tick will roll again
}

function removePickup(b: Boosts, i: number): void {
  const last = --b.n;
  if (i === last) return;
  const to = i * BOOST_STRIDE;
  const from = last * BOOST_STRIDE;
  for (let k = 0; k < BOOST_STRIDE; k++) b.data[to + k] = b.data[from + k];
}

/**
 * Collect one boost. Instant kinds fire here and leave no timer; timed kinds start (or RESTART)
 * theirs.
 *
 * Restart rather than extend: picking up a second Quad Damage at 3 seconds left gives fifteen, not
 * eighteen. Stacking durations lets a player bank an unbroken multiplier across a whole run, and the
 * point of a boost is that it ends.
 */
export function collectBoost(b: Boosts, kind: number, o: Orbs, time: number): void {
  b.lastPickupAt = time;
  b.lastKind = kind;
  if (kind === BK_MAGNET) {
    latchAll(o);
    return;
  }
  b.timers[kind] = BOOSTS[kind].duration;
}

/**
 * Push the active timers onto the live fields the weapons and the player actually read.
 *
 * Runs EVERY tick, including when nothing is active — which is what makes expiry free. The
 * alternative (apply on pickup, undo on expiry) has to get the undo right for every combination of
 * overlapping boosts, and gets it wrong the first time a second Quad Damage is collected while the
 * first is still running.
 *
 * Note these are *boost* fields, kept separate from the progression multipliers they sit alongside
 * (`combat.damageMul`, `combat.boltCount`): a run's permanent upgrades must survive a boost
 * expiring, so the two can never share a slot.
 */
function applyBoosts(b: Boosts, p: Player, c: Combat): void {
  c.boostMul = isActive(b, BK_QUAD) ? TUNING.QUAD_MUL : 1;
  c.boltCountMul = isActive(b, BK_AKIMBO) ? TUNING.AKIMBO_MUL : 1;
  c.lifesteal = isActive(b, BK_BLOODLUST) ? TUNING.BLOODLUST_HEAL : 0;
  // Written rather than max()'d with what is there: this IS the authority on boost invulnerability,
  // and taking the larger of the two would leave a stale value pinned forever after one pickup.
  p.invincible = b.timers[BK_INVINCIBLE];
}

/**
 * Tick step 8a: age the field, run the spawn clock, collect anything underfoot, apply the timers.
 *
 * Returns the kind collected this tick, or -1. The caller uses it for feedback only — everything
 * mechanical has already happened by the time it returns.
 */
export function stepBoosts(
  b: Boosts,
  p: Player,
  c: Combat,
  o: Orbs,
  time: number,
  dt: number,
): number {
  for (let k = 0; k < BOOST_COUNT; k++) {
    if (b.timers[k] > 0) b.timers[k] = Math.max(0, b.timers[k] - dt);
  }

  b.spawnTimer -= dt;
  if (b.spawnTimer <= 0) {
    // Jittered rather than fixed, so boosts are not a metronome a player can plan a run around.
    b.spawnTimer += TUNING.BOOST_INTERVAL + (rand(b) * 2 - 1) * TUNING.BOOST_JITTER;
    if (b.spawnTimer <= 0) b.spawnTimer = TUNING.BOOST_INTERVAL;
    spawnBoost(b, p.x, p.z, Math.floor(rand(b) * BOOST_COUNT) % BOOST_COUNT);
  }

  let collected = -1;
  const reach = TUNING.BOOST_PICKUP_R + TUNING.PLAYER_R;
  const reach2 = reach * reach;
  for (let i = 0; i < b.n; ) {
    const base = i * BOOST_STRIDE;
    b.data[base + P_AGE] += dt;
    const dx = b.data[base + P_X] - p.x;
    const dz = b.data[base + P_Z] - p.z;
    if (dx * dx + dz * dz <= reach2) {
      collected = b.data[base + P_KIND];
      collectBoost(b, collected, o, time);
      removePickup(b, i); // no i++ — the slot now holds a different, unexamined pickup
      continue;
    }
    i++;
  }

  applyBoosts(b, p, c);
  return collected;
}
