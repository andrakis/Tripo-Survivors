// XP orbs: what a kill actually pays out (DESIGN §8).
//
// Kills do not award XP directly. Combat's reap queues a *drop* at the body's position (step 8 of
// docs/ARCHITECTURE.md §6), an orb is created there, and the XP is only banked when the player walks
// close enough to pull it in. That indirection is the mechanic, not bookkeeping: the field of
// uncollected orbs behind you is a visible record of where you have been, and cashing it in is the
// comeback move when a run goes badly. Orbs therefore never expire.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { TUNING } from '../config';
import type { Player } from './player';

export const ORB_STRIDE = 4;
export const O_X = 0;
export const O_Z = 1;
/** XP this orb is worth — the tier's `xp` at the moment it died. */
export const O_VALUE = 2;
/** Seconds since it dropped. Renderer-only: the pop-in and the idle pulse. */
export const O_AGE = 3;

export interface Orbs {
  data: Float32Array;
  /** Live count. Slots [0, n) are real; removal is swap-remove, as everywhere else (§5). */
  n: number;
  /**
   * Live magnet radius. A field rather than TUNING.PICKUP_R read directly, because level 10 grows it
   * by 50% (DESIGN §6.3) — the same seam `combat.auraR` uses for level 2.
   */
  magnetR: number;
  /** Orbs banked this tick, and their total value. Read by progression (step 10) for the level-up. */
  gained: number;
}

export function createOrbs(): Orbs {
  return {
    data: new Float32Array(TUNING.MAX_ORBS * ORB_STRIDE),
    n: 0,
    magnetR: TUNING.PICKUP_R,
    gained: 0,
  };
}

/**
 * Drop one orb. Returns false at cap.
 *
 * At cap the NEW orb is dropped rather than an old one being evicted. Both choices lose XP; this one
 * loses it where the player is standing, which they can see, instead of silently deleting a pile
 * they were saving. 2048 is far enough above any real field that this is a guard, not a policy.
 */
export function spawnOrb(o: Orbs, x: number, z: number, value: number): boolean {
  if (o.n >= TUNING.MAX_ORBS) return false;
  const b = o.n++ * ORB_STRIDE;
  o.data[b + O_X] = x;
  o.data[b + O_Z] = z;
  o.data[b + O_VALUE] = value;
  o.data[b + O_AGE] = 0;
  return true;
}

function removeOrb(o: Orbs, i: number): void {
  const last = --o.n;
  if (i === last) return;
  const to = i * ORB_STRIDE;
  const from = last * ORB_STRIDE;
  for (let k = 0; k < ORB_STRIDE; k++) o.data[to + k] = o.data[from + k];
}

/**
 * Tick step 9: magnet, then pickup. Returns the XP banked this tick.
 *
 * **The acceleration is positional, not integrated.** An orb inside the magnet radius moves at a
 * speed interpolated from its own distance to the player — slow at the rim, ORB_SPEED_MAX at the
 * player — so the pull accelerates without the orb carrying a velocity. That is what keeps the
 * stride at the 4 fields ARCHITECTURE §5.1 documents, and it also means an orb can never overshoot,
 * orbit, or oscillate around the player the way an integrated spring does when the magnet radius
 * grows by 50% at level 10.
 *
 * There is no spatial grid here. Orbs are only ever tested against ONE point, so the query is O(n)
 * over the whole field either way, and a grid would cost a rebuild of up to 2048 entries per tick to
 * accelerate a loop that is already a flat array walk.
 */
export function stepOrbs(o: Orbs, p: Player, dt: number): number {
  const d = o.data;
  const r = o.magnetR;
  const r2 = r * r;
  const { ORB_SPEED_MIN, ORB_SPEED_MAX, ORB_TOUCH } = TUNING;
  let gained = 0;

  for (let i = 0; i < o.n; ) {
    const b = i * ORB_STRIDE;
    d[b + O_AGE] += dt;

    const dx = p.x - d[b + O_X];
    const dz = p.z - d[b + O_Z];
    const dist2 = dx * dx + dz * dz;

    if (dist2 > r2) {
      i++;
      continue;
    }

    const dist = Math.sqrt(dist2) || 1e-6;
    // 1 at the player, 0 at the rim, squared so the last unit is the fast one.
    const t = 1 - dist / r;
    const speed = ORB_SPEED_MIN + (ORB_SPEED_MAX - ORB_SPEED_MIN) * t * t;
    const step = speed * dt;

    // Bank it if this tick's step would reach the player, rather than moving it and picking it up
    // next tick — at ORB_SPEED_MAX a step is half a unit, and the "arrived" test has to be against
    // the step, not against a fixed radius, or a fast orb lands on the far side and comes back.
    if (dist <= step + ORB_TOUCH) {
      gained += d[b + O_VALUE];
      removeOrb(o, i); // no i++ — the slot now holds a different, unexamined orb
      continue;
    }

    const inv = step / dist;
    d[b + O_X] += dx * inv;
    d[b + O_Z] += dz * inv;
    i++;
  }

  o.gained = gained;
  return gained;
}
