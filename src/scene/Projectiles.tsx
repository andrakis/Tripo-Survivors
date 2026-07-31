// Bolts, drawn. One instanced mesh over the whole bolt population (docs/ARCHITECTURE.md §7).
//
// Deliberately NOT in models/registry.ts. The registry is the seam for things a viewer would model —
// characters, props, the orb. A bolt is a 30-centimetre streak that exists for under a second; it is
// a visual effect wearing a mesh, and putting it in the registry would pad the tutorial's "here is
// everything you can replace" list with an entry nobody wants to replace.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, TUNING } from '../config';
import { game } from '../game';
import { B_VX, B_VZ, B_X, B_Z, BOLT_STRIDE } from '../sim/combat';

const dummy = new THREE.Object3D();

/** Chest height on a 1.7-unit player, so the bolt leaves the character rather than the floor. */
const FLY_Y = 0.9;

export function Projectiles() {
  const mesh = useRef<THREE.InstancedMesh>(null!);

  // Long on Z because the export contract's forward is +Z (MODEL-PIPELINE §2) and the rotation below
  // is the same atan2(vx, vz) every other actor uses. One convention, everywhere.
  const geometry = useMemo(() => new THREE.BoxGeometry(0.14, 0.14, 0.9), []);
  const material = useMemo(
    // Unlit: a bolt is light, and a lit one dims when it flies away from the key light — which reads
    // as the shot losing power halfway to the target.
    () => new THREE.MeshBasicMaterial({ color: COLORS.BOLT }),
    [],
  );

  useLayoutEffect(() => {
    mesh.current.count = 0;
  }, []);

  useFrame(() => {
    const c = game.combat;
    const m = mesh.current;
    for (let i = 0; i < c.nb; i++) {
      const b = i * BOLT_STRIDE;
      dummy.position.set(c.bolts[b + B_X], FLY_Y, c.bolts[b + B_Z]);
      dummy.rotation.y = Math.atan2(c.bolts[b + B_VX], c.bolts[b + B_VZ]);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }
    m.count = c.nb;
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, TUNING.MAX_BOLTS]}
      frustumCulled={false}
    />
  );
}
