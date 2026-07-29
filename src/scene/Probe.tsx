// TEMPORARY (M0 only). A hard-coded moving target so the camera rig has something to follow and
// the arena has something to give it scale.
//
// M1 deletes this file and points `focus` at the real player. Nothing else changes — which is the
// point of routing the camera through a focus ref rather than at a player object directly.

import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ACTORS } from '../models/registry';

export function Probe({ focus }: { focus: RefObject<THREE.Vector3> }) {
  const ref = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => ACTORS.player.primitive(), []);
  const material = useMemo(
    () => new THREE.MeshLambertMaterial({ color: ACTORS.player.tint, flatShading: true }),
    [],
  );
  const t = useRef(0);

  useFrame((_, dt) => {
    t.current += dt;
    // A wide Lissajous figure, so the follow is exercised on both axes at different rates and at
    // varying speed — a plain circle would hide a stiffness that is wrong on only one axis.
    const x = Math.sin(t.current * 0.35) * 40;
    const z = Math.sin(t.current * 0.23) * 30;
    ref.current.position.set(x, ACTORS.player.yOffset, z);
    focus.current.set(x, 0, z);
  });

  return <mesh ref={ref} geometry={geometry} material={material} />;
}
