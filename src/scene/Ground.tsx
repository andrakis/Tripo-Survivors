// The stage: a flat plane, a grid, and a darker band beyond the play bounds.
//
// The grid is not decoration. With a featureless ground and a camera that follows the player
// exactly, player movement is INVISIBLE — you'd see the world slide and nothing else. The 8-unit
// grid is the motion reference that makes running feel like running (docs/ART-STYLE.md).
//
// Built explicitly rather than with THREE.GridHelper: the helper bakes per-vertex colours and its
// own material settings, which fought the fog and the flat palette here. Fifteen lines of
// LineSegments is less code than working around it, and it spans exactly the play area — so the
// grid's edge IS the world boundary, doing double duty as the out-of-bounds warning.

import { useMemo } from 'react';
import * as THREE from 'three';
import { CFG, COLORS, HALF_X, HALF_Z } from '../config';

const GRID_SPACING = 8;

// One short segment PER CELL, not one 256-unit line per row and column.
//
// Fog depth is interpolated between a segment's two endpoints, never recomputed along it. A grid
// line spanning the whole world runs from far behind the camera to well beyond the fog, so both
// its endpoints are "very far" — and the interpolated fog depth stays very far along the entire
// segment, including the stretch passing right next to the player. The result is a grid that is
// fully fogged out exactly where you need to see it, which reads as "the grid isn't rendering"
// rather than as a fog bug. Short segments keep the interpolation honest.
//
// Costs ~4k vertices, uploaded once, never touched again.
function buildGrid(): THREE.BufferGeometry {
  const v: number[] = [];
  for (let x = -HALF_X; x <= HALF_X; x += GRID_SPACING) {
    for (let z = -HALF_Z; z < HALF_Z; z += GRID_SPACING) v.push(x, 0, z, x, 0, z + GRID_SPACING);
  }
  for (let z = -HALF_Z; z <= HALF_Z; z += GRID_SPACING) {
    for (let x = -HALF_X; x < HALF_X; x += GRID_SPACING) v.push(x, 0, z, x + GRID_SPACING, 0, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

export function Ground() {
  const gridGeometry = useMemo(buildGrid, []);
  const gridMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: COLORS.GRID, fog: true }),
    [],
  );

  return (
    <group>
      {/* Out-of-bounds: a larger, darker plane underneath. The player is clamped at the world edge
          rather than falling off, so this band exists to make "you are being cornered" legible a
          second before it is fatal. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <planeGeometry args={[CFG.WORLD_X * 2.5, CFG.WORLD_Z * 2.5]} />
        <meshLambertMaterial color={COLORS.OUT_OF_BOUNDS} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[CFG.WORLD_X, CFG.WORLD_Z]} />
        <meshLambertMaterial color={COLORS.GROUND} />
      </mesh>

      <lineSegments geometry={gridGeometry} material={gridMaterial} position-y={0.02} />
    </group>
  );
}
