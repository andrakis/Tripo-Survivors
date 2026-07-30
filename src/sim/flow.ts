// Flow field. Ported from Breach/src/sim.worker.js:1840-1972.
//
// A 128 × 128 grid over the 256 × 256 world (2-unit square cells), in two halves that run on
// completely different schedules:
//
//   the COST field    — built ONCE, in sim/world.ts. Nothing moves a prop.
//   the DISTANCE solve — re-run at FLOW_HZ, and immediately when the player changes cell.
//
// **That split is the one adaptation from Breach.** Breach's goal is a static castle, so it rebuilds
// both together whenever the wall changes. Ours is the moving player, which changes every frame — so
// the expensive, invariant half is hoisted out and only the seed and the flood re-run.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { CFG, TUNING } from '../config';
import { buildCostField, cellX, cellZ, type Vec2 } from './world';

const W = CFG.GRID_W;
const H = CFG.GRID_H;
const NCELLS = W * H;

/** Sentinel for "not yet labelled". Any real path cost is orders of magnitude below this. */
const UNREACHED = 1e9;

export interface FlowField {
  /** Per-cell step cost. Built once; never written again. */
  cost: Float32Array;
  /** Per-cell accumulated cost from the seed. Refilled by every solve. */
  dist: Float32Array;
  /** Per-cell unit direction, interleaved (x, z). This is what the swarm samples. */
  flow: Float32Array;
  /** SPFA work queue, used as a ring buffer. See solveFlow. */
  queue: Int32Array;
  /** Whether a cell is currently queued — the "label-correcting" half of SPFA. */
  queued: Uint8Array;
  /** The cell the last solve was seeded from, so a cell change can be detected. */
  seedCell: number;
  /** Seconds since the last solve. */
  since: number;
}

export function createFlow(): FlowField {
  return {
    cost: buildCostField(),
    dist: new Float32Array(NCELLS),
    flow: new Float32Array(NCELLS * 2),
    // At most one entry per cell can be in flight at a time (that is what `queued` guarantees), so
    // the ring never needs more than NCELLS slots. +1 keeps the full/empty cases distinguishable.
    queue: new Int32Array(NCELLS + 1),
    queued: new Uint8Array(NCELLS),
    seedCell: -1,
    since: 0,
  };
}

/**
 * Weighted label-correcting flood (SPFA) from the player's cell, then a gradient pass.
 *
 * Because obstacles are expensive rather than blocking (sim/world.ts), every cell is reachable and
 * the field is defined everywhere — there is no case where an enemy stands somewhere the solver
 * never labelled and stalls with nowhere to go.
 *
 * Breach pushes onto a growing JS array and lets duplicates through. We keep a `queued` flag and a
 * fixed ring buffer instead: same result, same complexity, but a run of any length allocates
 * nothing and the queue provably cannot outgrow the grid.
 */
export function solveFlow(f: FlowField, seedX: number, seedZ: number): void {
  const { cost, dist, queue, queued } = f;
  dist.fill(UNREACHED);
  queued.fill(0);

  const seed = cellZ(seedZ) * W + cellX(seedX);
  f.seedCell = seed;
  f.since = 0;

  dist[seed] = 0;
  queued[seed] = 1;

  const qcap = queue.length;
  queue[0] = seed;
  let head = 0;
  let tail = 1;

  while (head !== tail) {
    const ci = queue[head];
    head = head + 1 === qcap ? 0 : head + 1;
    queued[ci] = 0;

    const d = dist[ci];
    const cz = (ci / W) | 0;
    const cx = ci - cz * W;

    // 4-neighbour, not 8. A diagonal step costs the same as a cardinal one on an 8-neighbour flood,
    // which biases every long path toward diagonals; the central-difference gradient below recovers
    // continuous headings anyway, so there is nothing to buy here.
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || nx >= W || nz < 0 || nz >= H) continue;
      const ni = nz * W + nx;
      const nd = d + cost[ni];
      if (nd >= dist[ni]) continue;
      dist[ni] = nd;
      if (queued[ni]) continue; // already in flight — it will pick up the improved dist when popped
      queued[ni] = 1;
      queue[tail] = ni;
      tail = tail + 1 === qcap ? 0 : tail + 1;
    }
  }

  fillFlowFromDist(f);
}

/**
 * Distance field -> per-cell unit direction, by a **one-sided downhill difference** per axis.
 *
 * The two things this is NOT, and why:
 *
 * **Not "step to the lowest 4-neighbour".** That quantises every heading to 8 directions and the
 * crowd visibly marches in axis-aligned columns — the single most recognisable "this is a grid"
 * artifact there is. We need a continuous direction so the crowd slides in at any angle.
 *
 * **Not Breach's plain central difference** (`fx = dL - dR`), which is where this diverges from
 * [Breach:1972](../../../Breach/src/sim.worker.js#L1972) — and it diverges because the plain form
 * points *uphill* here. A cell tucked behind a long prop is reached the cheap way, around the end;
 * its neighbour on the prop side was reached through the 40× skirt and carries a hugely inflated
 * distance. That inflated term dominates `dL - dR`, so the vector points at the *higher* of the two
 * — and the next cell over points back, giving a two-cell oscillation an enemy jitters in forever.
 * Breach never sees it because its walls are meant to be ground through, so nothing sits in that
 * valley for long.
 *
 * Counting only the neighbours that are genuinely LOWER than this cell fixes it and costs nothing:
 * on smooth ground the result is the same direction as the central difference (a linear ramp gives
 * `-a` instead of `-2a`, and it is normalised anyway), so diagonal continuity survives intact.
 *
 * It also makes "no cell has a zero gradient" a guarantee rather than a hope. SPFA relaxes
 * `dist[n] = dist[c] + cost[n]` with strictly positive cost, so every labelled cell has a
 * predecessor with strictly lower distance — meaning every non-seed cell has at least one lower
 * 4-neighbour, so at least one axis is non-zero. The swarm cannot stall anywhere.
 */
function fillFlowFromDist(f: FlowField): void {
  const { dist, flow } = f;

  for (let z = 0; z < H; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const dC = dist[i];
      const dL = x > 0 ? dist[i - 1] : dC;
      const dR = x < W - 1 ? dist[i + 1] : dC;
      const dD = z > 0 ? dist[i - W] : dC;
      const dU = z < H - 1 ? dist[i + W] : dC;

      // How far downhill each side is, floored at zero: an uphill neighbour contributes nothing
      // rather than pushing the vector away from it.
      let fx = (dR < dC ? dC - dR : 0) - (dL < dC ? dC - dL : 0);
      let fz = (dU < dC ? dC - dU : 0) - (dD < dC ? dC - dD : 0);
      const fl = Math.hypot(fx, fz);

      if (fl > 1e-4) {
        fx /= fl;
        fz /= fl;
      } else {
        // Degenerate (a flat cell, or the seed itself): fall back to the steepest single step so
        // the vector is still defined. Zero only at the seed, where standing still is correct.
        let bestX = 0;
        let bestZ = 0;
        let best = dC;
        if (dR < best) {
          best = dR;
          bestX = 1;
          bestZ = 0;
        }
        if (dL < best) {
          best = dL;
          bestX = -1;
          bestZ = 0;
        }
        if (dU < best) {
          best = dU;
          bestX = 0;
          bestZ = 1;
        }
        if (dD < best) {
          bestX = 0;
          bestZ = -1;
        }
        fx = bestX;
        fz = bestZ;
      }

      flow[i * 2] = fx;
      flow[i * 2 + 1] = fz;
    }
  }
}

/**
 * Re-solve if the cadence is due or the player has crossed into a new cell. Returns whether it did.
 *
 * A field up to 100 ms stale is invisible: it points at where the player was 0.1 s ago, which at
 * 7 u/s is 0.7 units — less than an enemy's own separation radius, and the last few metres of an
 * approach are dominated by separation and local steering anyway. The cell-change trigger is what
 * keeps that bound honest while the player is running.
 */
export function maybeSolveFlow(f: FlowField, seedX: number, seedZ: number, dt: number): boolean {
  f.since += dt;
  const cell = cellZ(seedZ) * W + cellX(seedX);
  if (f.since < 1 / TUNING.FLOW_HZ && cell === f.seedCell) return false;
  solveFlow(f, seedX, seedZ);
  return true;
}

/** Sample the field at a world position, writing the unit direction into `out`. */
export function sampleFlow(f: FlowField, x: number, z: number, out: Vec2): void {
  const i = (cellZ(z) * W + cellX(x)) * 2;
  out.x = f.flow[i];
  out.z = f.flow[i + 1];
}

/** Accumulated path cost from the seed to a world position. Tests and debugging only. */
export function distanceAt(f: FlowField, x: number, z: number): number {
  return f.dist[cellZ(z) * W + cellX(x)];
}
