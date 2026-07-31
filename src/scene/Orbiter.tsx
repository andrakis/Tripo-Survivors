// The Orbiter, drawn: the level 9 unlock (DESIGN §6.3), a sphere circling the player.
//
// Instanced with a small capacity rather than one mesh, because `combat.orbiters` is a count and the
// late-game cycle could grant a second one without this file changing. `count` is that number, so
// before level 9 this draws nothing at all.
//
// Not in models/registry.ts, for the same reason bolts are not: the registry is the list of things a
// viewer would model, and this is a weapon effect wearing a sphere.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, TUNING } from '../config';
import { game } from '../game';

const dummy = new THREE.Object3D();

/** Room for the late-game to grant more than one without touching this file. */
const CAPACITY = 4;
/** Chest height, so it circles the character rather than sweeping their ankles. */
const FLY_Y = 0.9;

export function Orbiter() {
  const mesh = useRef<THREE.InstancedMesh>(null!);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(TUNING.ORBITER_HIT_R * 0.55, 1), []);
  // Unlit and the aura's colour: it is the same weapon system, and a lit sphere would dim on the far
  // side of its own orbit — reading as the thing losing power halfway round.
  const material = useMemo(() => new THREE.MeshBasicMaterial({ color: COLORS.AURA }), []);

  useLayoutEffect(() => {
    mesh.current.count = 0;
  }, []);

  useFrame(() => {
    const c = game.combat;
    const p = game.player;
    const m = mesh.current;
    const n = Math.min(c.orbiters, CAPACITY);

    for (let i = 0; i < n; i++) {
      // The SAME expression the sim uses to place its hit query (sim/combat.ts stepOrbiters). If
      // these two ever disagree, the sphere damages somewhere it visibly is not — so the angle is
      // derived from `orbiterPhase` here rather than being smoothed or interpolated.
      const a = c.orbiterPhase + (i / c.orbiters) * Math.PI * 2;
      dummy.position.set(
        p.x + Math.cos(a) * TUNING.ORBITER_R,
        FLY_Y,
        p.z + Math.sin(a) * TUNING.ORBITER_R,
      );
      dummy.rotation.y = a;
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    }

    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={mesh} args={[geometry, material, CAPACITY]} frustumCulled={false} />;
}
