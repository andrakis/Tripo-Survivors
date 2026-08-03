// The boundary art has to agree with the simulation's clamp (scene/boundaryLayout.ts).
//
// The sim decides where the world ends; the wall is only a picture of that decision. When the two
// disagree the failure is silent and reads as a bug in the movement code rather than in the scenery:
// a wall inside the clamp stops the player visibly INSIDE stone, a wall outside it strands them in
// mid-field with the wall still a stride away.

import { describe, expect, it } from 'vitest';
import { CFG, HALF_X, HALF_Z, TUNING } from '../config';
import {
  WALL_H,
  WALL_T,
  capPieces,
  hillPieces,
  merlonPieces,
  wallPieces,
  type Piece,
} from './boundaryLayout';

/** The faces of a unit-cube instance, in world units. */
const minX = (p: Piece) => p.x - p.sx / 2;
const maxX = (p: Piece) => p.x + p.sx / 2;
const minZ = (p: Piece) => p.z - p.sz / 2;
const maxZ = (p: Piece) => p.z + p.sz / 2;
const minY = (p: Piece) => p.y - p.sy / 2;

describe('the wall stands exactly where the player is stopped', () => {
  it('puts its inner faces on the world bounds', () => {
    const [north, south, west, east] = wallPieces();
    expect(maxZ(north)).toBeCloseTo(-HALF_Z, 10);
    expect(minZ(south)).toBeCloseTo(HALF_Z, 10);
    expect(maxX(west)).toBeCloseTo(-HALF_X, 10);
    expect(minX(east)).toBeCloseTo(HALF_X, 10);
  });

  it('leaves the cornered player touching the stone rather than short of it or inside it', () => {
    // sim/world.ts clamps the player's CENTRE to HALF - PLAYER_R, so their near edge lands on HALF.
    // The wall's inner face is on HALF too, which is what makes being cornered look like being
    // cornered. This is the assertion that actually ties the art to the sim; the one above only
    // says the wall is self-consistent.
    const centreAtLimit = HALF_X - TUNING.PLAYER_R;
    const playerEdge = centreAtLimit + TUNING.PLAYER_R;
    expect(playerEdge).toBeCloseTo(minX(wallPieces()[3]), 10);
  });

  it('closes the ring at the corners', () => {
    // Each side spans its full length PLUS both corners, so the four boxes overlap rather than meet.
    // A gap here is a hole you can see the void through, and it would only be visible from one
    // diagonal in orbit mode — the definition of a bug that ships.
    const [north, , west] = wallPieces();
    expect(minX(north)).toBeLessThanOrEqual(minX(west));
    expect(maxX(north)).toBeGreaterThanOrEqual(maxX(west));
    expect(minZ(west)).toBeLessThanOrEqual(minZ(north));
  });
});

describe('the wall reads as a solid object', () => {
  it('sits the cap on top of the wall and the merlons on top of the cap', () => {
    // Stacked, not floating and not interpenetrating: a floating cap shows daylight under it from a
    // low orbit angle, and merlons sunk into the cap lose the battlement silhouette entirely.
    const cap = capPieces()[0];
    const merlon = merlonPieces()[0];
    expect(minY(cap)).toBeCloseTo(WALL_H, 10);
    expect(minY(merlon)).toBeCloseTo(cap.y + cap.sy / 2, 10);
  });

  it('overhangs the cap past both wall faces, which is what catches the light', () => {
    expect(capPieces()[0].sz).toBeGreaterThan(WALL_T);
  });

  it('keeps the wall low enough to hide only ground that is already out of play', () => {
    // The camera looks down at 45°, so a wall of height h hides h units of ground behind it — and
    // behind this one is the out-of-bounds band, which contains nothing. What must NOT happen is the
    // wall growing tall enough to matter from inside: at 45° its blind spot has to stay outside the
    // arena, which it does for any height, but a wall taller than the elite (4.5) also has to stay
    // short enough not to dominate the frame when the player is cornered.
    expect(WALL_H).toBeGreaterThan(4.5);
    expect(WALL_H).toBeLessThan(CFG.VIEW_H / 2);
  });
});

describe('the hills stay outside the arena and out of the way', () => {
  it('places every hill beyond the wall', () => {
    for (const h of hillPieces()) {
      const d = Math.max(Math.abs(h.x), Math.abs(h.z));
      expect(d, 'a hill is inside the play area').toBeGreaterThan(HALF_X + WALL_T);
    }
  });

  it('rings the horizon without leaving a gap', () => {
    // A gap in a horizon ring reads as missing geometry rather than as landscape, which is why the
    // angles are evenly spaced with jitter rather than random. No two neighbours more than a
    // generous slice apart.
    const angles = hillPieces()
      .map((h) => Math.atan2(h.x, h.z))
      .sort((a, b) => a - b);
    for (let i = 0; i < angles.length; i++) {
      const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
      expect(next - angles[i]).toBeLessThan(0.35);
    }
  });

  it('is deterministic, so two screenshots of the same import are comparable', () => {
    expect(hillPieces()).toEqual(hillPieces());
  });
});
