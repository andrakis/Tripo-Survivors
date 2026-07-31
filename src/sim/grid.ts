// Counting-sort spatial grid. Ported from Breach/src/sim.worker.js:708-757.
//
// Two O(n) passes plus one O(cells) prefix sum lay every agent into a flat `agentIndex` array
// grouped by cell, with `cellStart` giving each cell's slice. A neighbour query is then a
// contiguous array walk with **zero allocation after warmup** — no Map, no per-tick garbage, no GC
// sawtooth halfway through a run.
//
// The builder is PARAMETRIC over `(positions, stride, count, cell)`, exactly as Breach has it, and
// that is the whole reason it earns its own module: one routine serves the enemies (cell ≈ SEP_R)
// and, from M3, the bolts and the orbs — and one population can scan another's grid, which is how
// the aura and the bolts get a broad-phase without a second data structure.
//
// Indices are 0..count-1 **as of build time**. A swap-remove during the same tick moves the last
// live agent down, so a consumer holding an older index guards it with `if (j >= n)` — see
// docs/ARCHITECTURE.md §5.
//
// No THREE import (ARCHITECTURE §2.1).

import { CFG, HALF_X, HALF_Z } from '../config';

export interface Grid {
  cell: number;
  gw: number;
  gh: number;
  ncells: number;
  /** Int32Array(ncells + 1): prefix-sum start offset per cell. Cell c is [cellStart[c], cellStart[c+1]). */
  cellStart: Int32Array;
  /** Int32Array(ncells): scratch — per-cell counts, then each cell's scatter write head. */
  cursor: Int32Array;
  /** Int32Array(cap): cached linear cell of each agent, so pass 2 doesn't recompute it. */
  cellId: Int32Array;
  /** Int32Array(cap): agent indices, grouped by cell. */
  agentIndex: Int32Array;
  cellAlloc: number;
  cap: number;
}

export function makeGrid(): Grid {
  return {
    cell: 1,
    gw: 0,
    gh: 0,
    ncells: 0,
    cellStart: new Int32Array(1),
    cursor: new Int32Array(0),
    cellId: new Int32Array(0),
    agentIndex: new Int32Array(0),
    cellAlloc: 0,
    cap: 0,
  };
}

/**
 * Rebuild `g` from `count` agents in `pos` (x at `i*stride`, z at `i*stride + 1`), bucketed into
 * cells of `cell` world units. Backing arrays are grown, never shrunk, so a steady-state run
 * allocates nothing at all.
 */
export function buildGrid(
  g: Grid,
  pos: Float32Array,
  stride: number,
  count: number,
  cell: number,
): void {
  // +2 cells of margin so an agent sitting exactly on the world edge — or a hair outside it,
  // between the integrate and the clamp — still lands in a real cell rather than being dropped.
  const gw = Math.ceil(CFG.WORLD_X / cell) + 2;
  const gh = Math.ceil(CFG.WORLD_Z / cell) + 2;
  const ncells = gw * gh;

  if (g.cellAlloc < ncells) {
    g.cellStart = new Int32Array(ncells + 1);
    g.cursor = new Int32Array(ncells);
    g.cellAlloc = ncells;
  }
  if (g.cap < count) {
    const cap = Math.max(count, g.cap * 2 || 512);
    g.agentIndex = new Int32Array(cap);
    g.cellId = new Int32Array(cap);
    g.cap = cap;
  }

  g.cell = cell;
  g.gw = gw;
  g.gh = gh;
  g.ncells = ncells;

  const { cellStart, cursor, cellId, agentIndex } = g;
  cursor.fill(0, 0, ncells);

  // pass 1: bin each agent (clamped into the grid) and count per cell.
  for (let i = 0; i < count; i++) {
    let cx = ((pos[i * stride] + HALF_X) / cell) | 0;
    let cz = ((pos[i * stride + 1] + HALF_Z) / cell) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= gw) cx = gw - 1;
    if (cz < 0) cz = 0;
    else if (cz >= gh) cz = gh - 1;
    const c = cz * gw + cx;
    cellId[i] = c;
    cursor[c]++;
  }

  // prefix sum -> cellStart, leaving cursor as each cell's write head.
  let acc = 0;
  for (let c = 0; c < ncells; c++) {
    cellStart[c] = acc;
    const n = cursor[c];
    cursor[c] = acc;
    acc += n;
  }
  cellStart[ncells] = acc;

  // pass 2: scatter indices into their cell's slice.
  for (let i = 0; i < count; i++) {
    const c = cellId[i];
    agentIndex[cursor[c]++] = i;
  }
}

/** Linear cell index for a world position under `g`'s current binning. */
export function cellOf(g: Grid, x: number, z: number): number {
  let cx = ((x + HALF_X) / g.cell) | 0;
  let cz = ((z + HALF_Z) / g.cell) | 0;
  if (cx < 0) cx = 0;
  else if (cx >= g.gw) cx = g.gw - 1;
  if (cz < 0) cz = 0;
  else if (cz >= g.gh) cz = g.gh - 1;
  return cz * g.gw + cx;
}

/**
 * Collect every agent within `radius` of `(x, z)` into `out`, returning how many were written.
 * `out` is caller-owned and never grown — anything past its length is dropped.
 *
 * **The ring scanned is sized from `radius`**, `ceil(radius / cell)` cells out, rather than being
 * fixed at 3×3. A fixed 3×3 is only correct for `radius <= cell`, and the aura's 3.0 against the
 * swarm grid's 1.1-unit cell is exactly the case that breaks it — it would silently return the
 * fraction of the crowd standing in the nine cells nearest the player and look like the aura simply
 * doing less damage than the table says.
 *
 * The alternative was a second grid built at a bigger cell, which is what the parametric builder
 * makes cheap. It isn't worth it: this keeps ONE structure for all four consumers (ARCHITECTURE §6),
 * and the scan is O((2r+1)²) cells over a grid that is mostly empty. A second grid only starts to
 * pay when a query radius is many multiples of the cell AND runs every tick.
 *
 * The swarm does NOT use this: it needs the two separation accumulators from the same walk, so it
 * inlines the scan. This is for consumers that just want the neighbour set — the aura and contact
 * damage — and for the tests that check the grid against a brute-force O(n²) scan.
 */
export function queryNeighbors(
  g: Grid,
  pos: Float32Array,
  stride: number,
  count: number,
  x: number,
  z: number,
  radius: number,
  out: Int32Array,
): number {
  let cx = ((x + HALF_X) / g.cell) | 0;
  let cz = ((z + HALF_Z) / g.cell) | 0;
  if (cx < 0) cx = 0;
  else if (cx >= g.gw) cx = g.gw - 1;
  if (cz < 0) cz = 0;
  else if (cz >= g.gh) cz = g.gh - 1;

  const r2 = radius * radius;
  const reach = Math.max(1, Math.ceil(radius / g.cell));
  let n = 0;

  for (let oz = -reach; oz <= reach; oz++) {
    const ccz = cz + oz;
    if (ccz < 0 || ccz >= g.gh) continue;
    const rowBase = ccz * g.gw;
    for (let ox = -reach; ox <= reach; ox++) {
      const ccx = cx + ox;
      if (ccx < 0 || ccx >= g.gw) continue;
      const c = rowBase + ccx;
      const end = g.cellStart[c + 1];
      for (let p = g.cellStart[c]; p < end; p++) {
        const j = g.agentIndex[p];
        if (j >= count) continue; // stale index from a swap-remove earlier this tick
        const dx = pos[j * stride] - x;
        const dz = pos[j * stride + 1] - z;
        if (dx * dx + dz * dz > r2) continue;
        if (n >= out.length) return n;
        out[n++] = j;
      }
    }
  }

  return n;
}
