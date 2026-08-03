// The stage floor: textured grassland inside the play bounds, dark ground beyond them.
//
// Through M6 this was a flat plane plus an 8-unit line grid, and the grid was not decoration — with
// a featureless ground and a camera that follows the player exactly, movement is INVISIBLE. You see
// the world slide and nothing else. The grid was the motion reference that made running feel like
// running.
//
// M7 replaced it with a tiling grass texture at that same 8-unit scale (scene/terrain.ts), which
// does the same job continuously instead of once every eight units, and does not put a sci-fi grid
// on a field. The grid's second job — marking where the world ends — moved to something better
// suited to it, an actual wall you can see (scene/Boundary.tsx).

import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { CFG, COLORS } from '../config';
import { GRASS_TILE, makeGrassTexture } from './terrain';

export function Ground() {
  // Anisotropy matters more here than anywhere else in the scene: this is a plane seen at a 45°
  // grazing angle stretching to the fog, and without it the texture turns to shimmering mush at
  // exactly the distance the player is watching for incoming enemies. Capped at 8 — past that the
  // cost is real and the difference is not.
  const maxAnisotropy = useThree((s) => s.gl.capabilities.getMaxAnisotropy());

  const grass = useMemo(() => {
    const tex = makeGrassTexture();
    if (!tex) return null;
    tex.repeat.set(CFG.WORLD_X / GRASS_TILE, CFG.WORLD_Z / GRASS_TILE);
    tex.anisotropy = Math.min(8, maxAnisotropy);
    return tex;
  }, [maxAnisotropy]);

  // A CanvasTexture holds a GPU allocation that outlives the React tree unless somebody says so.
  useEffect(() => () => grass?.dispose(), [grass]);

  return (
    <group>
      {/* Out-of-bounds: a larger, darker plane underneath, reaching past the boundary wall so the
          world does not simply stop at it. The player is clamped at the world edge rather than
          falling off, so this exists to make "you are being cornered" legible a second before it is
          fatal — and, since M7, to give the far side of the wall something to stand on. */}
      <mesh rotation-x={-Math.PI / 2} position-y={-0.02}>
        <planeGeometry args={[CFG.WORLD_X * 2.5, CFG.WORLD_Z * 2.5]} />
        <meshLambertMaterial color={COLORS.OUT_OF_BOUNDS} />
      </mesh>

      {/* The play area. `map` falls back to a flat colour where no canvas was available, which keeps
          a machine that cannot give us a 2D context on the M6 ground rather than on no ground. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0}>
        <planeGeometry args={[CFG.WORLD_X, CFG.WORLD_Z]} />
        <meshLambertMaterial color={grass ? 0xffffff : COLORS.GROUND} map={grass} />
      </mesh>
    </group>
  );
}
