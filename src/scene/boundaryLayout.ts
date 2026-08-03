// Where the boundary's pieces go. Pure arithmetic, no THREE, no React — so the one property that
// actually matters about this art can be asserted in a unit test (src/scene/boundaryLayout.test.ts):
// the wall's inner face is exactly where the simulation clamps the player, and not a unit off.
//
// That is worth a test rather than an eyeball because the failure is silent and awful in both
// directions. A wall inside the clamp means the player walks visibly INTO stone and stops in front
// of it for no reason the picture explains. A wall outside it means they stop in mid-field with the
// wall still a stride away, which reads as the game being stuck.

import { CFG, HALF_X, HALF_Z } from '../config';

/** A box instance: centre, extents, and a yaw. Unit-cube geometry, so `s*` IS the world size. */
export interface Piece {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  ry: number;
}

/** Wall dimensions, in world units. Tall enough to read as impassable from across the arena, short
 *  enough that from the fixed camera's 45° it never throws a blind spot over a rank of enemies —
 *  the same rule that caps the props at 4.6 (see readability.test.ts) applies at the edge, where a
 *  wall of this height only ever hides ground that is already out of play. */
export const WALL_H = 9;
export const WALL_T = 2.4;
const CAP_H = 0.6;
/** Merlons every this many units along the top. The rhythm is what gives the wall a scale: a
 *  featureless bar tells you nothing about how far away it is or how fast you are moving past it. */
const MERLON_SPACING = 16;
const MERLON_W = 2.6;
const MERLON_H = 1.7;

const HILL_COUNT = 52;
/** Hill standoff, as a multiple of the world half-extent, measured the way the ARENA is measured —
 *  see `hillPieces`. Starts outside the wall and stops well inside the camera's far plane. */
const HILL_R_MIN = 1.15;
const HILL_R_MAX = 1.8;

/** Deterministic, for the same reason the grass texture is (scene/terrain.ts): scenery must not
 *  change between two screenshots taken to compare a model import. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The four wall segments.
 *
 * Each spans its full side PLUS both corners, so the ring closes without a gap at the joins. Four
 * overlapping boxes is deliberately cheaper and more robust than mitring four exact pieces: the
 * overlap is inside the stone where nothing can see it, and no rounding error can open a seam a
 * player would notice from the one angle that shows it.
 */
export function wallPieces(): Piece[] {
  const outX = HALF_X + WALL_T / 2;
  const outZ = HALF_Z + WALL_T / 2;
  const spanX = CFG.WORLD_X + WALL_T * 2;
  const spanZ = CFG.WORLD_Z + WALL_T * 2;
  return [
    { x: 0, y: WALL_H / 2, z: -outZ, sx: spanX, sy: WALL_H, sz: WALL_T, ry: 0 },
    { x: 0, y: WALL_H / 2, z: outZ, sx: spanX, sy: WALL_H, sz: WALL_T, ry: 0 },
    { x: -outX, y: WALL_H / 2, z: 0, sx: WALL_T, sy: WALL_H, sz: spanZ, ry: 0 },
    { x: outX, y: WALL_H / 2, z: 0, sx: WALL_T, sy: WALL_H, sz: spanZ, ry: 0 },
  ];
}

/**
 * A lighter cap along the top edge, slightly proud of the wall on both faces.
 *
 * One value step is all it takes to stop a nine-unit wall reading as a flat shape cut out of the
 * fog: it gives the top a lit edge, so the eye reads a solid object with a top surface rather than
 * a silhouette. The overhang is what catches the light — a cap flush with the wall is invisible.
 */
export function capPieces(): Piece[] {
  const outX = HALF_X + WALL_T / 2;
  const outZ = HALF_Z + WALL_T / 2;
  const spanX = CFG.WORLD_X + WALL_T * 2 + 0.6;
  const spanZ = CFG.WORLD_Z + WALL_T * 2 + 0.6;
  const t = WALL_T + 0.6;
  const y = WALL_H + CAP_H / 2;
  return [
    { x: 0, y, z: -outZ, sx: spanX, sy: CAP_H, sz: t, ry: 0 },
    { x: 0, y, z: outZ, sx: spanX, sy: CAP_H, sz: t, ry: 0 },
    { x: -outX, y, z: 0, sx: t, sy: CAP_H, sz: spanZ, ry: 0 },
    { x: outX, y, z: 0, sx: t, sy: CAP_H, sz: spanZ, ry: 0 },
  ];
}

/** Battlements along the top of each side. */
export function merlonPieces(): Piece[] {
  const perSide = Math.floor(CFG.WORLD_X / MERLON_SPACING) + 1;
  const outX = HALF_X + WALL_T / 2;
  const outZ = HALF_Z + WALL_T / 2;
  const y = WALL_H + CAP_H + MERLON_H / 2;
  const depth = WALL_T + 0.9;
  const out: Piece[] = [];
  for (let side = 0; side < 4; side++) {
    for (let n = 0; n < perSide; n++) {
      const along = -HALF_X + n * MERLON_SPACING;
      if (side === 0) out.push({ x: along, y, z: -outZ, sx: MERLON_W, sy: MERLON_H, sz: depth, ry: 0 });
      else if (side === 1) out.push({ x: along, y, z: outZ, sx: MERLON_W, sy: MERLON_H, sz: depth, ry: 0 });
      else if (side === 2) out.push({ x: -outX, y, z: along, sx: depth, sy: MERLON_H, sz: MERLON_W, ry: 0 });
      else out.push({ x: outX, y, z: along, sx: depth, sy: MERLON_H, sz: MERLON_W, ry: 0 });
    }
  }
  return out;
}

/**
 * The hill ring: silhouettes outside the wall, so that looking outward in orbit mode shows a horizon
 * rather than a void, and the arena reads as a place inside a landscape rather than a floating slab.
 *
 * Cone instances, sunk below the ground plane so no base edge is ever visible as a hard circle
 * sitting on the floor — what should read is a landform, not fifty-two traffic cones.
 */
export function hillPieces(): Piece[] {
  const rnd = mulberry32(0x1115);
  const out: Piece[] = [];
  for (let i = 0; i < HILL_COUNT; i++) {
    // Evenly spaced with a jittered angle rather than a random one: fifty-two random angles leave
    // visible clumps and a visible gap, and a gap in a horizon ring reads as missing geometry.
    const angle = (i / HILL_COUNT) * Math.PI * 2 + (rnd() - 0.5) * 0.16;
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    // Pushed out along the ray until its CHEBYSHEV distance — max(|x|, |z|), the metric the square
    // arena is actually measured in — reaches the standoff. A circular ring is the obvious thing to
    // write here and it is wrong: a circle of radius r passes within r/√2 of the origin on the
    // diagonals, so every hill near a corner ends up standing INSIDE a square playfield. The unit
    // test caught exactly that, at 115 units inside a 130-unit bound.
    const standoff = HALF_X * (HILL_R_MIN + rnd() * (HILL_R_MAX - HILL_R_MIN));
    const scale = standoff / Math.max(Math.abs(dx), Math.abs(dz));
    const height = 9 + rnd() * 21;
    const width = 22 + rnd() * 34;
    out.push({
      x: dx * scale,
      y: height / 2 - 3,
      z: dz * scale,
      sx: width,
      sy: height,
      sz: width,
      ry: rnd() * Math.PI,
    });
  }
  return out;
}
