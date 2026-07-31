// XP orbs, drawn. One instanced mesh over the whole field (docs/ARCHITECTURE.md §7).
//
// The orb IS a registry actor — a viewer replacing it with their own model is one of the more
// satisfying swaps in the tutorial, because it is the object the player looks at most — so geometry,
// scale and lift all come from models/registry.ts and nothing here knows what an orb looks like.
//
// DESIGN §12 rule 3 is the whole brief: orbs must read against the ground at ALL densities, and be
// small enough that a hundred of them do not hide the enemies standing on top of them. That is why
// they are unlit and small rather than bright and large — an emissive dot is legible in a pile
// without adding area to the screen.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ORB_GRADES, orbGrade, TUNING } from '../config';
import { game } from '../game';
import { ACTORS } from '../models/registry';
import { O_AGE, O_VALUE, O_X, O_Z, ORB_STRIDE } from '../sim/orbs';

const dummy = new THREE.Object3D();
const tint = new THREE.Color();

/** Radians/sec of idle spin, and the bob that makes a still orb read as a pickup rather than debris. */
const SPIN = 1.6;
const BOB = 0.09;
const BOB_RATE = 3.1;

export function Orbs() {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const actor = useMemo(() => ACTORS.orb, []);
  const geometry = useMemo(() => actor.primitive(), [actor]);
  const material = useMemo(
    // WHITE, with the grade colour in instanceColor: three MULTIPLIES the two, so a tinted material
    // could only ever darken an instance and the gold and magenta grades would never reach their
    // colour. Same reasoning as the swarm's material (ARCHITECTURE §7).
    () => new THREE.MeshBasicMaterial({ color: 0xffffff }),
    [],
  );

  // The colour write is what allocates `instanceColor` — three creates it lazily on the first
  // setColorAt, and a mesh that has never had one draws white forever.
  useLayoutEffect(() => {
    const m = mesh.current;
    for (let i = 0; i < TUNING.MAX_ORBS; i++) m.setColorAt(i, tint.set(actor.tint));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.count = 0;
  }, [actor]);

  useFrame(() => {
    const o = game.orbs;
    const d = o.data;
    const m = mesh.current;

    for (let i = 0; i < o.n; i++) {
      const b = i * ORB_STRIDE;
      const age = d[b + O_AGE];
      // Pop out of the body that dropped it: full scale is reached over ORB_POP, so a wave of deaths
      // reads as things falling apart rather than as a row of orbs blinking into existence.
      const pop = age < TUNING.ORB_POP ? age / TUNING.ORB_POP : 1;
      // Merged orbs are bigger and a different colour (DESIGN §8). Without that, a consolidated
      // field is a screen of identical dots that hides the fact one of them is worth forty.
      const grade = ORB_GRADES[orbGrade(d[b + O_VALUE])];
      const x = d[b + O_X];
      const z = d[b + O_Z];
      // Phase offset from POSITION, not from age or slot index. Every orb dropped by one aura pulse
      // shares an age, and a field bobbing in unison reads as a renderer bug; the slot index is
      // worse still, because a pickup swap-removes and the orb that inherits the slot would visibly
      // jump. Position is the only per-orb quantity that is both varied and stable.
      const phase = age * BOB_RATE + x * 0.7 + z * 0.9;
      dummy.position.set(x, actor.yOffset + Math.sin(phase) * BOB, z);
      dummy.rotation.set(0, age * SPIN + x, 0.4);
      dummy.scale.setScalar(actor.scale * grade.scale * pop);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, tint.set(grade.tint));
    }

    m.count = o.n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, TUNING.MAX_ORBS]}
      frustumCulled={false}
    />
  );
}
