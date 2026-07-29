// Arena props: one InstancedMesh, matrices written ONCE.
//
// These never move, so the matrix write belongs in useLayoutEffect, not useFrame — writing static
// matrices every frame is the most common way an R3F scene quietly wastes its budget.

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OBSTACLES } from '../sim/world';
import { ACTORS } from '../models/registry';

export function Obstacles() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const geometry = useMemo(() => ACTORS.prop.primitive(), []);
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ color: ACTORS.prop.tint, flatShading: true }),
    [],
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
