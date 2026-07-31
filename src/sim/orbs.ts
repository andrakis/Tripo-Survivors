// XP orbs: what a kill actually pays out (DESIGN §8).
//
// Kills do not award XP directly. Combat's reap queues a *drop* at the body's position (step 8 of
// docs/ARCHITECTURE.md §6), an orb is created there, and the XP is only banked when the player walks
// close enough to pull it in. That indirection is the mechanic, not bookkeeping: the field of
// uncollected orbs behind you is a visible record of where you have been, and cashing it in is the
// comeback move when a run goes badly. Orbs therefore never expire — they only ever MERGE.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { TUNING } from '../config';
import { buildGrid, makeGrid, type Grid } from './grid';
import type { Player } from './player';

export const ORB_STRIDE = 5;
export const O_X = 0;
export const O_Z = 1;
/** XP this orb is worth. Merged orbs carry the SUM of what went into them — no XP is ever lost. */
export const O_VALUE = 2;
/** Seconds since it dropped. Drives the renderer's pop-in, and merge eligibility. */
export const O_AGE = 3;
/**
 * 1 once this orb has come inside the magnet radius, and 0 before.
 *
 * It is a latch, never cleared. An orb that has visibly started moving toward the player must arrive
 * (DESIGN §8): once move speed is 10% up a few times, the character outruns the rim of their own
 * magnet, and an orb that chases and then gives up reads as the pickup being broken.
 */
export const O_HOME = 4;

export interface Orbs {
  data: Float32Array;
  /** Live count. Slots [0, n) are real; removal is swap-remove, as everywhere else (§5). */
  n: number;
  /**
   * Live magnet radius. A field rather than TUNING.PICKUP_R read directly, because a level-up can
   * grow it (DESIGN §6.3) — the same seam `combat.auraR` uses.
   */
  magnetR: number;
  /** Seconds until the next merge pass. */
  mergeTimer: number;
  /**
   * The merge pass's own broad-phase, at ORB_MERGE_CELL rather than the swarm's SEP_R.
   *
   * A second grid, which ARCHITECTURE §6 otherwise argues against — justified because it is built at
   * ORB_MERGE_HZ (twice a second) and not per tick, over a population the swarm grid is the wrong
   * resolution for. Merging at 1.1 units would consolidate almost nothing.
   */
  mergeGrid: Grid;
  /** Orbs banked in the last step. Read by the HUD; progression takes the return value instead. */
  gained: number;
}

export function createOrbs(): Orbs {
  return {
    data: new Float32Array(TUNING.MAX_ORBS * ORB_STRIDE),
    n: 0,
    magnetR: TUNING.PICKUP_R,
    // A full interval, not 0: the first pass belongs one cadence into the run like every other one.
    mergeTimer: 1 / TUNING.ORB_MERGE_HZ,
    mergeGrid: makeGrid(),
    gained: 0,
  };
}

/**
 * Drop one orb. Returns false at cap.
 *
 * At cap the NEW orb is dropped rather than an old one being evicted. Both choices lose XP; this one
 * loses it where the player is standing, which they can see, instead of silently deleting a pile
 * they were saving. With merging in play the field converges well below 2048, so this is a guard.
 */
export function spawnOrb(o: Orbs, x: number, z: number, value: number): boolean {
  if (o.n >= TUNING.MAX_ORBS) return false;
  const b = o.n++ * ORB_STRIDE;
  o.data[b + O_X] = x;
  o.data[b + O_Z] = z;
  o.data[b + O_VALUE] = value;
  o.data[b + O_AGE] = 0;
  o.data[b + O_HOME] = 0;
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
 * Latch every orb on the map, wherever it is — the Magnet boost (DESIGN §6.4).
 *
 * Deliberately implemented as "set the latch every orb already has" rather than as a temporary
 * infinite radius: the pull, the acceleration and the arrival are then exactly the ones the player
 * has seen a thousand times, just from further away. A separate global-magnet code path would be a
 * second way for an orb to travel, and the first one to disagree with the other about overshoot.
 */
export function latchAll(o: Orbs): number {
  const d = o.data;
  for (let i = 0; i < o.n; i++) d[i * ORB_STRIDE + O_HOME] = 1;
  return o.n;
}

/**
 * Consolidate a big field of old orbs: everything eligible that shares a merge cell becomes one orb
 * carrying the sum of their values (DESIGN §8).
 *
 * Three conditions gate it, and each one is protecting something:
 *   - `n >= ORB_MERGE_AT` — below that the scattered field IS the record of where you have been, and
 *     consolidating it early deletes the thing it exists for. Merging is a cost control.
 *   - `age >= ORB_MERGE_AGE` — an orb must have been *ignored*. Merging the trail behind a player
 *     who is still fighting would make orbs jump sideways in front of them.
 *   - not latched — an orb already on its way is nobody's to move.
 *
 * Two phases, because the cell walk holds grid indices: phase 1 sums into the first eligible orb of
 * each cell and zeroes the rest, phase 2 swap-removes the zeroes. Doing both at once would shuffle
 * live orbs into slots the walk has already passed.
 */
export function mergeOrbs(o: Orbs, dt: number): number {
  o.mergeTimer -= dt;
  if (o.mergeTimer > 0) return 0;
  o.mergeTimer += 1 / TUNING.ORB_MERGE_HZ;
  if (o.mergeTimer <= 0) o.mergeTimer = 1 / TUNING.ORB_MERGE_HZ;
  if (o.n < TUNING.ORB_MERGE_AT) return 0;

  const d = o.data;
  buildGrid(o.mergeGrid, d, ORB_STRIDE, o.n, TUNING.ORB_MERGE_CELL);
  const { cellStart, agentIndex, ncells } = o.mergeGrid;
  let merged = 0;

  for (let c = 0; c < ncells; c++) {
    const end = cellStart[c + 1];
    let head = -1;
    let eaten = 0;
    for (let p = cellStart[c]; p < end; p++) {
      const i = agentIndex[p];
      const b = i * ORB_STRIDE;
      if (d[b + O_HOME] !== 0 || d[b + O_AGE] < TUNING.ORB_MERGE_AGE) continue;
      if (head < 0) {
        head = b;
        continue;
      }
      d[head + O_VALUE] += d[b + O_VALUE];
      d[b + O_VALUE] = 0; // marked; phase 2 collects it
      eaten++;
    }
    // The survivor's age is reset so a merged orb pops on screen the way a fresh one does. Without
    // it a cell's worth of dots would vanish and one already-idle orb would silently change colour.
    if (eaten > 0) {
      d[head + O_AGE] = 0;
      merged += eaten;
    }
  }

  if (merged === 0) return 0;
  for (let i = 0; i < o.n; ) {
    if (d[i * ORB_STRIDE + O_VALUE] <= 0) removeOrb(o, i);
    else i++;
  }
  return merged;
}

/**
 * Tick step 9: magnet, then pickup. Returns the XP banked this tick.
 *
 * **The acceleration is positional, not integrated.** An orb inside the magnet radius moves at a
 * speed interpolated from its own distance to the player — slow at the rim, ORB_SPEED_MAX at the
 * player — so the pull accelerates without the orb carrying a velocity. That is what keeps the
 * stride down to the fields ARCHITECTURE §5.1 documents, and it also means an orb can never
 * overshoot, orbit, or oscillate around the player the way an integrated spring does when the
 * magnet radius grows.
 *
 * **A latched orb is additionally floored at ORB_HOME_MUL × the player's current speed**, because
 * the positional curve alone tops out at ORB_SPEED_MAX only *at* the player: an orb at the rim moves
 * at ORB_SPEED_MIN, which a character with a few move-speed upgrades simply outruns. The floor is
 * relative to `p.speedMul` rather than a constant for exactly that reason.
 *
 * There is no spatial grid here. Orbs are only ever tested against ONE point, so the query is O(n)
 * over the whole field either way, and a grid would cost a rebuild of the entire field per tick to
 * accelerate a loop that is already a flat array walk.
 */
export function stepOrbs(o: Orbs, p: Player, dt: number): number {
  const d = o.data;
  const r = o.magnetR;
  const r2 = r * r;
  const { ORB_SPEED_MIN, ORB_SPEED_MAX, ORB_TOUCH, PLAYER_SPEED, ORB_HOME_MUL } = TUNING;
  const homeFloor = PLAYER_SPEED * p.speedMul * ORB_HOME_MUL;
  let gained = 0;

  for (let i = 0; i < o.n; ) {
    const b = i * ORB_STRIDE;
    d[b + O_AGE] += dt;

    const dx = p.x - d[b + O_X];
    const dz = p.z - d[b + O_Z];
    const dist2 = dx * dx + dz * dz;

    if (dist2 <= r2) d[b + O_HOME] = 1; // the latch, set once and never cleared
    if (d[b + O_HOME] === 0) {
      i++;
      continue;
    }

    const dist = Math.sqrt(dist2) || 1e-6;
    // 1 at the player, 0 at the rim and beyond, squared so the last unit is the fast one.
    const t = Math.max(0, 1 - dist / r);
    const speed = Math.max(ORB_SPEED_MIN + (ORB_SPEED_MAX - ORB_SPEED_MIN) * t * t, homeFloor);
    const step = speed * dt;

    // Bank it if this tick's step would reach the player, rather than moving it and picking it up
    // next tick — at these speeds a step is most of a unit, and the "arrived" test has to be against
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
