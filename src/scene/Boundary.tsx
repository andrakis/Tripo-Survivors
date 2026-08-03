// The edge of the world, made visible: a rampart around the play area, and hills beyond it.
//
// The sim has always clamped the player at ±HALF (sim/world.ts `clampToWorld`), and through M6 the
// only thing that said so was the line grid running out. Under the fixed camera you could live with
// that, because you almost never saw the edge — the view is 40 × 26 units in a 256 × 256 world. The
// orbit camera changes it: zoom out and you are looking straight at the place the world stops, so it
// had better look like a place that stops.
//
// Nothing here participates in the simulation. The wall is drawn exactly where the clamp already is
// (scene/boundaryLayout.ts, and the test beside it), so a player who walks into it is stopped by
// `clampToWorld` and not by any collision geometry. One authority for where the world ends, with the
// art following it rather than duplicating it.
//
// Four instanced draws for the whole boundary, matrices written ONCE — none of this ever moves, and
// writing static matrices every frame is the most common way an R3F scene wastes its budget.

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { COLORS } from '../config';
import { capPieces, hillPieces, merlonPieces, wallPieces, type Piece } from './boundaryLayout';

function Pieces({
  pieces,
  material,
  cone = false,
}: {
  pieces: Piece[];
  material: THREE.Material;
  cone?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);

  useLayoutEffect(() => {
    const mesh = ref.current;
    const m = new THREE.Object3D();
    pieces.forEach((p, i) => {
      m.position.set(p.x, p.y, p.z);
      m.scale.set(p.sx, p.sy, p.sz);
      m.rotation.set(0, p.ry, 0);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Static instances, so the lazily-computed bounding volume is safe to build now and keep. Doing
    // it here rather than leaving it lazy also sidesteps the frustum-culling failure where a mesh
    // whose matrices arrived after the first cull test keeps a stale, tiny bounding sphere.
    mesh.computeBoundingSphere();
  }, [pieces]);

  return (
    <instancedMesh ref={ref} args={[undefined, material, pieces.length]}>
      {cone ? (
        // Six-sided, flat-shaded: the facets ARE the read at this distance, and a smooth-shaded
        // low-poly cone in fog is an indistinct blob.
        <coneGeometry args={[0.5, 1, 6]} />
      ) : (
        <boxGeometry args={[1, 1, 1]} />
      )}
    </instancedMesh>
  );
}

export function Boundary() {
  const walls = useMemo(wallPieces, []);
  const caps = useMemo(capPieces, []);
  const merlons = useMemo(merlonPieces, []);
  const hills = useMemo(hillPieces, []);

  const wallMaterial = useMemo(() => new THREE.MeshLambertMaterial({ color: COLORS.WALL }), []);
  const capMaterial = useMemo(() => new THREE.MeshLambertMaterial({ color: COLORS.WALL_CAP }), []);
  const hillMaterial = useMemo(
    () => new THREE.MeshLambertMaterial({ color: COLORS.HILL, flatShading: true }),
    [],
  );

  useLayoutEffect(
    () => () => {
      wallMaterial.dispose();
      capMaterial.dispose();
      hillMaterial.dispose();
    },
    [wallMaterial, capMaterial, hillMaterial],
  );

  return (
    <group>
      <Pieces pieces={walls} material={wallMaterial} />
      <Pieces pieces={caps} material={capMaterial} />
      <Pieces pieces={merlons} material={capMaterial} />
      <Pieces pieces={hills} material={hillMaterial} cone />
    </group>
  );
}
