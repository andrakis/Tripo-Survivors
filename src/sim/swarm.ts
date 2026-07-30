// The swarm. Ported from Breach/src/sim.worker.js:3712-3900 (the per-agent movement loop), with
// the morale, corpse-terrain and wall-grinding terms stripped out.
//
// Struct-of-arrays, stride 8 (docs/ARCHITECTURE.md §5.1), allocated once at MAX_ENEMIES and never
// grown. Removal is swap-remove, so live enemies always occupy exactly [0, n) and `mesh.count = n`
// is always right.
//
// No THREE import (ARCHITECTURE §2.1).

import { HALF_X, HALF_Z, TIERS, TUNING } from '../config';
import { buildGrid, type Grid } from './grid';
import { sampleFlow, type FlowField } from './flow';
import { clampToWorld, resolveObstacles, type Vec2 } from './world';

export const ENEMY_STRIDE = 8;

/** Field offsets into the SoA, so no loop below indexes with a bare magic number. */
export const E_X = 0;
export const E_Z = 1;
export const E_VX = 2;
export const E_VZ = 3;
export const E_HP = 4;
export const E_TIER = 5;
/** Decaying hit-flash timer. Written by combat (M3), read only by the renderer. */
export const E_FLASH = 6;
/** Per-enemy random constant for visual variation — bob phase, scale jitter (M5). */
export const E_SEED = 7;

export interface Swarm {
  data: Float32Array;
  /** Live count. Slots [0, n) are alive; everything above is stale. */
  n: number;
}

export function createSwarm(): Swarm {
  return { data: new Float32Array(TUNING.MAX_ENEMIES * ENEMY_STRIDE), n: 0 };
}

/** Spawn one enemy of `tier`. Returns its index, or -1 if the field is at cap. */
export function spawnEnemy(s: Swarm, x: number, z: number, tier: number): number {
  if (s.n >= TUNING.MAX_ENEMIES) return -1;
  const i = s.n++;
  const b = i * ENEMY_STRIDE;
  const d = s.data;
  d[b + E_X] = x;
  d[b + E_Z] = z;
  d[b + E_VX] = 0;
  d[b + E_VZ] = 0;
  d[b + E_HP] = TIERS[tier].hp;
  d[b + E_TIER] = tier;
  d[b + E_FLASH] = 0;
  d[b + E_SEED] = Math.random();
  return i;
}

/**
 * Swap-remove: copy the last live slot over `i`, then shrink. O(1), and it keeps [0, n) densely
 * packed so there is no hole for an instance-count bug to live in (ARCHITECTURE §5).
 *
 * A caller iterating the population must NOT advance past `i` after killing it — the slot now holds
 * a different, unprocessed enemy.
 */
export function killEnemy(s: Swarm, i: number): void {
  const last = --s.n;
  if (i === last) return;
  const d = s.data;
  const to = i * ENEMY_STRIDE;
  const from = last * ENEMY_STRIDE;
  for (let k = 0; k < ENEMY_STRIDE; k++) d[to + k] = d[from + k];
}

/** Rebuild the shared broad-phase over the live swarm. One build per tick, read by every consumer. */
export function buildSwarmGrid(s: Swarm, g: Grid): void {
  buildGrid(g, s.data, ENEMY_STRIDE, s.n, TUNING.SEP_R);
}

// Module-level scratch — the step loop allocates nothing.
const flowDir: Vec2 = { x: 0, z: 0 };
const pos: Vec2 = { x: 0, z: 0 };

/**
 * Advance every enemy one tick. `g` must already be built from this swarm's live positions.
 *
 * The ordering below is load-bearing; see ARCHITECTURE §4.3 for the two failure modes it exists to
 * prevent, both learned the expensive way in Breach.
 */
export function stepSwarm(s: Swarm, g: Grid, f: FlowField, dt: number): void {
  const d = s.data;
  const n = s.n;
  const { SEP, SEP_R, SEP_PUSH, SEP_PUSH_MAX, FLOW_W, STEER_RESPONSE, UNIT_R } = TUNING;
  const sepR2 = SEP_R * SEP_R;
  const { gw, gh, cell, cellStart, agentIndex } = g;

  for (let i = 0; i < n; i++) {
    const b = i * ENEMY_STRIDE;
    let x = d[b + E_X];
    let z = d[b + E_Z];
    let vx = d[b + E_VX];
    let vz = d[b + E_VZ];

    if (d[b + E_FLASH] > 0) d[b + E_FLASH] = Math.max(0, d[b + E_FLASH] - dt);

    // 1. flow-field desired direction.
    sampleFlow(f, x, z, flowDir);
    let dx = flowDir.x * FLOW_W;
    let dz = flowDir.z * FLOW_W;

    // 2. one 3×3 neighbourhood scan, accumulating TWO separate things:
    //      sx, sz — a steering bias, blended with the flow heading BEFORE normalisation;
    //      px, pz — a hard positional push, a per-pair MTV where this enemy resolves HALF the
    //               overlap and the neighbour resolves the other half on its own turn, so the pair
    //               settles at exactly SEP_R.
    //    Both are required. The steering bias alone is normalised in alongside the flow heading, so
    //    the moment the pull toward the player dominates, separation is mathematically washed out
    //    and the entire swarm converges to a single point. The positional push cannot be normalised
    //    away, and it is the only reason the crowd stays spread.
    let cx = ((x + HALF_X) / cell) | 0;
    let cz = ((z + HALF_Z) / cell) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= gw) cx = gw - 1;
    if (cz < 0) cz = 0;
    else if (cz >= gh) cz = gh - 1;

    let sx = 0;
    let sz = 0;
    let px = 0;
    let pz = 0;

    for (let oz = -1; oz <= 1; oz++) {
      const ccz = cz + oz;
      if (ccz < 0 || ccz >= gh) continue;
      const rowBase = ccz * gw;
      for (let ox = -1; ox <= 1; ox++) {
        const ccx = cx + ox;
        if (ccx < 0 || ccx >= gw) continue;
        const c = rowBase + ccx;
        const end = cellStart[c + 1];
        for (let p = cellStart[c]; p < end; p++) {
          const j = agentIndex[p];
          if (j === i || j >= n) continue; // self, or a slot vacated by a swap-remove this tick
          const jb = j * ENEMY_STRIDE;
          const ddx = x - d[jb + E_X];
          const ddz = z - d[jb + E_Z];
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 <= 0 || d2 >= sepR2) continue;
          const dist = Math.sqrt(d2);
          const inv = 1 / dist;
          sx += ddx * inv;
          sz += ddz * inv;
          const overlap = (SEP_R - dist) * SEP_PUSH;
          px += ddx * inv * overlap;
          pz += ddz * inv * overlap;
        }
      }
    }

    dx += sx * SEP;
    dz += sz * SEP;

    // 3. integrate: normalise the steering sum, lerp velocity toward desired * speed, advance.
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const speed = TIERS[d[b + E_TIER]].speed;
    const k = Math.min(1, dt * STEER_RESPONSE);
    vx += (dx * speed - vx) * k;
    vz += (dz * speed - vz) * k;
    x += vx * dt;
    z += vz * dt;

    // 4. the positional push, CLAMPED. It is a sum over every neighbour, so in a dense jam an
    //    unclamped push flings a front-rank enemy a long way in one tick — straight through an
    //    obstacle, past the MTV below that would have caught a normal-sized step. The cap also stops
    //    the spacing equilibrium overshooting and flickering.
    const pl2 = px * px + pz * pz;
    if (pl2 > SEP_PUSH_MAX * SEP_PUSH_MAX) {
      const scale = SEP_PUSH_MAX / Math.sqrt(pl2);
      px *= scale;
      pz *= scale;
    }
    x += px;
    z += pz;

    // 5 & 6. obstacles, then bounds — structures and the arena edge get the final say, after every
    //        force above has had its turn.
    resolveObstacles(pos, x, z, UNIT_R);
    clampToWorld(pos, pos.x, pos.z, UNIT_R);

    d[b + E_X] = pos.x;
    d[b + E_Z] = pos.z;
    d[b + E_VX] = vx;
    d[b + E_VZ] = vz;
  }
}
