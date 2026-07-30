// The swarm, drawn. One <instancedMesh> PER TIER — four meshes, not one, because the tiers carry
// different geometry (docs/ARCHITECTURE.md §7) and geometry is the thing a viewer replaces.
//
// Never one React element per enemy. Matrices are written imperatively in useFrame, bypassing React
// entirely; at 400 enemies routing positions through state would re-render the tree 60 times a
// second and the game would die (ARCHITECTURE §3).

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TIERS, TUNING } from '../config';
import { game } from '../game';
import { ACTORS, type ActorId } from '../models/registry';
import { E_TIER, E_VX, E_VZ, E_X, E_Z, ENEMY_STRIDE } from '../sim/swarm';

/** Reused for every matrix compose. One Object3D for the whole swarm, not one per enemy. */
const dummy = new THREE.Object3D();

export function Swarm() {
  const meshes = useRef<THREE.InstancedMesh[]>([]);
  const counts = useRef(new Int32Array(TIERS.length));

  const actors = useMemo(() => TIERS.map((t) => ACTORS[t.actor as ActorId]), []);
  const geometries = useMemo(() => actors.map((a) => a.primitive()), [actors]);
  const materials = useMemo(
    () => actors.map((a) => new THREE.MeshLambertMaterial({ color: a.tint, flatShading: true })),
    [actors],
  );

  // Start at zero, or the first frame flashes 1,600 stacked instances at the world origin before
  // any matrix has been written.
  useLayoutEffect(() => {
    for (const m of meshes.current) if (m) m.count = 0;
  }, []);

  useFrame(() => {
    const s = game.swarm;
    const d = s.data;
    const c = counts.current;
    c.fill(0);

    for (let i = 0; i < s.n; i++) {
      const b = i * ENEMY_STRIDE;
      const tier = d[b + E_TIER];
      const mesh = meshes.current[tier];
      if (!mesh) continue;

      const actor = actors[tier];
      dummy.position.set(d[b + E_X], actor.yOffset, d[b + E_Z]);
      // Face the direction of travel, unconditionally. `dummy` is shared across the whole loop, so
      // a conditional write would leave an enemy wearing the PREVIOUS enemy's rotation — a
      // guard against heading jitter at near-zero speed has to store facing per enemy, and that
      // belongs in the SoA. An enemy is only ever near-zero when jammed inside a crowd that hides
      // it anyway; M5's per-enemy variation pass is where this gets revisited.
      const vx = d[b + E_VX];
      const vz = d[b + E_VZ];
      dummy.rotation.y = Math.atan2(vx, vz);
      dummy.scale.setScalar(actor.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(c[tier]++, dummy.matrix);
    }

    for (let t = 0; t < meshes.current.length; t++) {
      const mesh = meshes.current[t];
      if (!mesh) continue;
      mesh.count = c[t];
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      {TIERS.map((tier, t) => (
        <instancedMesh
          key={tier.actor}
          ref={(m) => {
            if (m) meshes.current[t] = m;
          }}
          args={[geometries[t], materials[t], TUNING.MAX_ENEMIES]}
          // The instances move every frame, so the mesh's own bounding volume is meaningless and
          // frustum culling against it would pop the whole tier in and out.
          frustumCulled={false}
        />
      ))}
    </>
  );
}
