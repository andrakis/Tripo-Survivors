// Arena props: one InstancedMesh, matrices written ONCE.
//
// These never move, so the matrix write belongs in useLayoutEffect, not useFrame — writing static
// matrices every frame is the most common way an R3F scene quietly wastes its budget.

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OBSTACLES } from '../sim/world';
import { getActor } from '../models/loader';

export function Obstacles() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  // Props are the one actor scaled per instance rather than to a fixed height, so an imported prop
  // is normalised to a unit height by the loader and then stretched to each obstacle's extents
  // below — exactly as the unit-cube primitive is (MODEL-PIPELINE §4).
  const actor = useMemo(() => getActor('prop'), []);
  const geometry = actor.geometry;
  const material = useMemo(
    () => actor.material ?? new THREE.MeshLambertMaterial({ color: actor.tint, flatShading: true }),
    [actor],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    const m = new THREE.Object3D();
    OBSTACLES.forEach((o, i) => {
      // The prop primitive is a unit cube, so scale IS the obstacle's extent. Sitting the box on
      // the ground (y = height/2) keeps every actor's feet-at-zero convention consistent.
      m.position.set(o.x, o.height / 2, o.z);
      m.scale.set(o.hx * 2, o.height, o.hz * 2);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.count = OBSTACLES.length;
    mesh.instanceMatrix.needsUpdate = true;
    // Static instances, so the lazily-computed bounding volume is safe to build now and keep.
    mesh.computeBoundingSphere();
  }, []);

  return <instancedMesh ref={ref} args={[geometry, material, OBSTACLES.length]} />;
}
