// Boost pickups, drawn (DESIGN §6.4). One instanced mesh over all kinds, tinted per instance.
//
// The readability brief is the opposite of the orbs' one. An orb has to disappear into a field of a
// hundred others; a boost has to be findable from across the arena, because half of them land
// outside the view and the player has to *decide* to go and get one. So: bright, unlit, well off the
// ground, spinning, and with a ground ring under it so it still reads when a prop hides the body.
//
// Not in models/registry.ts. The registry is the list of things a viewer would model, and these are
// five coloured shapes that mean five rules changing — closer to the aura ring than to a character.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BOOSTS, TUNING } from '../config';
import { game } from '../game';
import { BOOST_STRIDE, P_AGE, P_KIND, P_X, P_Z } from '../sim/boosts';

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

/** Floating height, and how far it bobs either side of it. Well clear of the crowd's heads. */
const FLY_Y = 1.5;
const BOB = 0.28;
const BOB_RATE = 2.0;
const SPIN = 1.9;

export function Boosts() {
  const body = useRef<THREE.InstancedMesh>(null!);
  const ring = useRef<THREE.InstancedMesh>(null!);

  const geometry = useMemo(() => new THREE.OctahedronGeometry(0.62, 0), []);
  const ringGeometry = useMemo(() => new THREE.RingGeometry(0.85, 1.15, 24), []);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff }), []);
  const ringMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    [],
  );

  // Zero first, or the first frame stacks MAX_BOOSTS untinted instances at the origin. The colour
  // write is also what allocates `instanceColor` — three creates it lazily on the first setColorAt.
  useLayoutEffect(() => {
    for (const m of [body.current, ring.current]) {
      for (let i = 0; i < TUNING.MAX_BOOSTS; i++) m.setColorAt(i, tint.set(0xffffff));
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.count = 0;
    }
  }, []);

  useFrame(() => {
    const b = game.boosts;
    const d = b.data;

    for (let i = 0; i < b.n; i++) {
      const base = i * BOOST_STRIDE;
      const kind = d[base + P_KIND];
      const age = d[base + P_AGE];
      const x = d[base + P_X];
      const z = d[base + P_Z];
      // Pop out of the ground on arrival, so a boost landing on screen announces itself rather than
      // appearing between two frames as though it had always been there.
      const pop = Math.min(1, age / 0.35);

      dummy.position.set(x, FLY_Y + Math.sin(age * BOB_RATE) * BOB, z);
      dummy.rotation.set(0.4, age * SPIN, 0);
      dummy.scale.setScalar(pop);
      dummy.updateMatrix();
      body.current.setMatrixAt(i, dummy.matrix);

      // The ground ring is what makes a boost findable behind a prop: the body can be occluded, but
      // a flat disc at the base of an 8-unit block is still visible from a 45° camera.
      dummy.position.set(x, 0.03, z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar(pop * (1 + 0.08 * Math.sin(age * 4)));
      dummy.updateMatrix();
      ring.current.setMatrixAt(i, dummy.matrix);

      tint.set(BOOSTS[kind].tint);
      body.current.setColorAt(i, tint);
      ring.current.setColorAt(i, tint);
    }

    for (const m of [body.current, ring.current]) {
      m.count = b.n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh
        ref={ring}
        args={[ringGeometry, ringMaterial, TUNING.MAX_BOOSTS]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={body}
        args={[geometry, material, TUNING.MAX_BOOSTS]}
        frustumCulled={false}
      />
    </>
  );
}
