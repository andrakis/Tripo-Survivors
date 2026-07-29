// The arena: bounds and the static obstacle list.
//
// No THREE import — see docs/ARCHITECTURE.md §2.1. Obstacles are axis-aligned boxes because the
// swarm resolves them with an axis-of-least-penetration MTV (M2), which wants an AABB and nothing
// fancier. `height` is purely visual.
//
// M2 adds the flow cost-field stamping here; today this is data plus two helpers.

import { CFG, HALF_X, HALF_Z } from '../config';

export interface Obstacle {
  /** centre on X */
  x: number;
  /** centre on Z */
  z: number;
  /** half-extent on X */
  hx: number;
  /** half-extent on Z */
  hz: number;
  /** visual height; the sim is 2D and ignores this */
  height: number;
}

// Hand-placed, not scattered randomly — the arena needs memorable geography (docs/DESIGN.md §9).
// Each of these earns its place by shaping the swarm's path: the Keep splits an approach from the
// north, the East Wall forces a real detour rather than a step aside, and the Pillar Ring is a
// kiting playground. They are also the third model slot a tutorial can fill.
export const OBSTACLES: readonly Obstacle[] = [
  { x: 0, z: -34, hx: 5.0, hz: 5.0, height: 6.0 }, // the Keep — central landmark
  { x: -18, z: -26, hx: 2.5, hz: 2.5, height: 3.5 }, // its two outbuildings
  { x: 18, z: -26, hx: 2.5, hz: 2.5, height: 3.5 },
  { x: 62, z: -8, hx: 2.0, hz: 20.0, height: 4.5 }, // East Wall — long enough to be a real detour
  { x: 48, z: 44, hx: 3.5, hz: 3.5, height: 7.0 }, // Southeast Tower
  { x: -52, z: 30, hx: 2.2, hz: 2.2, height: 8.0 }, // Pillar Ring — good kiting geometry
  { x: -34, z: 42, hx: 2.2, hz: 2.2, height: 8.0 },
  { x: -46, z: 56, hx: 2.2, hz: 2.2, height: 8.0 },
  { x: -66, z: 46, hx: 2.2, hz: 2.2, height: 8.0 },
  { x: -74, z: -22, hx: 4.0, hz: 4.0, height: 5.0 }, // West Rubble
  { x: -58, z: -40, hx: 2.5, hz: 2.5, height: 3.5 },
  { x: 24, z: 66, hx: 12.0, hz: 2.0, height: 4.0 }, // South Wall
  { x: 84, z: -56, hx: 3.0, hz: 3.0, height: 6.0 }, // Northeast Outlier
  { x: -12, z: 58, hx: 3.0, hz: 3.0, height: 4.5 },
];

/** Clamp a point inside the arena, leaving `radius` of margin. Mutates nothing; returns the pair. */
export function clampToWorld(x: number, z: number, radius: number): [number, number] {
  const mx = HALF_X - radius;
  const mz = HALF_Z - radius;
  return [Math.min(mx, Math.max(-mx, x)), Math.min(mz, Math.max(-mz, z))];
}

/** True if (x, z) is inside any obstacle expanded by `radius`. Linear scan — 14 boxes. */
export function overlapsObstacle(x: number, z: number, radius: number): boolean {
  for (const o of OBSTACLES) {
    if (Math.abs(x - o.x) < o.hx + radius && Math.abs(z - o.z) < o.hz + radius) return true;
  }
  return false;
}

/**
 * Push a circle of `radius` out of every obstacle it overlaps, along the **axis of least
 * penetration** (a minimum-translation-vector resolve). Returns the corrected pair.
 *
 * Least-penetration is what makes a prop feel like a wall you slide along rather than a magnet: a
 * body pressed into the long face of the East Wall is pushed straight back out of that face, and
 * its motion along the wall survives untouched. Picking any other axis would kill the tangential
 * component and the player would stick.
 *
 * Every overlapping obstacle is resolved, not just the first — props sit close enough (the Pillar
 * Ring) that a single-obstacle resolve can push a body straight into its neighbour.
 *
 * The swarm reuses this shape in M2 (ARCHITECTURE §4.3 step 5), but against a 3×3 grid lookup
 * rather than this 14-box linear scan.
 */
export function resolveObstacles(x: number, z: number, radius: number): [number, number] {
  for (const o of OBSTACLES) {
    const dx = x - o.x;
    const penX = o.hx + radius - Math.abs(dx);
    if (penX <= 0) continue;
    const dz = z - o.z;
    const penZ = o.hz + radius - Math.abs(dz);
    if (penZ <= 0) continue;
    // Exactly on an axis (dx === 0) is degenerate; break the tie toward +, which is stable because
    // the body only ever arrives there with velocity that will carry it clear next tick anyway.
    if (penX < penZ) x += dx >= 0 ? penX : -penX;
    else z += dz >= 0 ? penZ : -penZ;
  }
  return [x, z];
}

export const WORLD_SIZE = { x: CFG.WORLD_X, z: CFG.WORLD_Z } as const;
