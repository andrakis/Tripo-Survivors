// The spawn director. DESIGN §7.2.
//
// Deliberately NOT a wave system: no banner, no gap between waves. Pressure is continuous and
// monotonic, and the only rhythm in a run is the one the player creates by clearing a side of the
// field. There is exactly one curve —
//
//     rate(t) = SPAWN_BASE + t / SPAWN_RAMP     enemies per second
//
// — which is ~1.5/s at the start, ~4.2/s at a minute, ~9.7/s at three. Everything else here is
// about WHERE they appear and WHICH tier they are.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { CFG, ELITE_TIER, TIERS, TUNING } from '../config';
import { spawnEnemy, type Swarm } from './swarm';
import { HALF_X, HALF_Z } from '../config';
import { overlapsObstacle } from './world';

/**
 * How far out enemies appear. The camera shows CFG.VIEW_W × VIEW_H, and the farthest visible point
 * is a CORNER, not an edge midpoint — so the ring has to clear the half-DIAGONAL or enemies pop
 * into existence in the corners of the screen, which is the one thing §7.2 forbids.
 */
export const SPAWN_R =
  Math.hypot(CFG.VIEW_W / 2, CFG.VIEW_H / 2) * TUNING.SPAWN_RING_MULT;

export interface Waves {
  /** Fractional enemies owed. Carried across ticks so a 1.5/s rate isn't rounded to 1/s at 60 fps. */
  budget: number;
  /** Elites are paced on their own clock rather than rolled for out of the budget. */
  eliteTimer: number;
}

export function createWaves(): Waves {
  return { budget: 0, eliteTimer: 0 };
}

export function spawnRate(time: number): number {
  return TUNING.SPAWN_BASE + time / TUNING.SPAWN_RAMP;
}

/**
 * Tier weight at time `t`. A tier ramps in over TIER_RAMP seconds from its entry time rather than
 * appearing at full strength, so the run never changes character between one second and the next;
 * and the grunt's weight decays as the others arrive, so the mass thins out into something more
 * dangerous instead of the field simply getting more crowded.
 *
 * Elite weight is always 0 — see the elite timer in stepWaves.
 */
export function tierWeight(tier: number, t: number): number {
  const spec = TIERS[tier];
  if (spec.weight <= 0 || t < spec.entersAt) return 0;
  const ramp = Math.min(1, (t - spec.entersAt) / TUNING.TIER_RAMP);
  if (tier !== 0) return spec.weight * ramp;
  // The grunt: full weight until the runner is due, then decaying toward a third of it.
  const since = Math.max(0, t - TIERS[1].entersAt);
  return spec.weight * (1 - (2 / 3) * Math.min(1, since / TUNING.GRUNT_DECAY));
}

function pickTier(t: number): number {
  let total = 0;
  for (let i = 0; i < TIERS.length; i++) total += tierWeight(i, t);
  if (total <= 0) return 0;
  let r = Math.random() * total;
  for (let i = 0; i < TIERS.length; i++) {
    r -= tierWeight(i, t);
    if (r <= 0) return i;
  }
  return 0;
}

/**
 * Place one enemy on the spawn ring around (px, pz), rejecting positions outside the arena or
 * inside a prop, and returning whether it landed.
 *
 * Rejection sampling with a hard try limit rather than a search: near the world edge, or with the
 * player backed against the East Wall, a chunk of the ring is genuinely unusable, and the honest
 * answer is "fewer enemies arrive from that side this tick". Looping until success would spend
 * unbounded time in the tick to hide a situation the player created deliberately.
 */
function spawnOnRing(s: Swarm, px: number, pz: number, tier: number): boolean {
  const margin = TUNING.UNIT_R + 1;
  for (let attempt = 0; attempt < TUNING.SPAWN_TRIES; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const x = px + Math.cos(a) * SPAWN_R;
    const z = pz + Math.sin(a) * SPAWN_R;
    if (x < -HALF_X + margin || x > HALF_X - margin) continue;
    if (z < -HALF_Z + margin || z > HALF_Z - margin) continue;
    if (overlapsObstacle(x, z, TUNING.UNIT_R)) continue;
    return spawnEnemy(s, x, z, tier) >= 0;
  }
  return false;
}

/**
 * Accrue the spawn budget and place what it buys.
 *
 * At MAX_ENEMIES the director simply stops — the budget is not banked, or clearing a field at
 * three minutes would dump a hundred enemies into one tick.
 */
export function stepWaves(
  w: Waves,
  s: Swarm,
  time: number,
  dt: number,
  px: number,
  pz: number,
): void {
  if (s.n >= TUNING.MAX_ENEMIES) {
    w.budget = 0;
    return;
  }

  w.budget += spawnRate(time) * dt;
  while (w.budget >= 1) {
    w.budget -= 1;
    if (!spawnOnRing(s, px, pz, pickTier(time))) break;
    if (s.n >= TUNING.MAX_ENEMIES) {
      w.budget = 0;
      break;
    }
  }

  if (time >= TIERS[ELITE_TIER].entersAt) {
    w.eliteTimer += dt;
    if (w.eliteTimer >= TUNING.ELITE_INTERVAL) {
      w.eliteTimer = 0;
      spawnOnRing(s, px, pz, ELITE_TIER);
    }
  }
}
