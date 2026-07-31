// The aura, drawn. A flat disc on the ground, not a sphere (DESIGN §6.1).
//
// That choice is the whole design of this component: the aura is the weapon the player positions
// against, so they have to be able to see *exactly* what is inside it. A sphere hides the enemies
// standing in the middle of it and its silhouette against the ground is a lie — the edge you can see
// is not the edge that does damage.
//
// No game logic here (docs/ARCHITECTURE.md §2.2): the radius and the pulse phase are both read
// straight off `game.combat`.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../config';
import { game } from '../game';

/** Lifted off the ground plane. Enough to beat z-fighting at this camera distance, low enough that
 *  the disc still reads as lying ON the floor rather than hovering over it. */
const LIFT = 0.02;

/** Opacity of the fill at rest and at the instant of a pulse. */
const FILL_MIN = 0.05;
const FILL_MAX = 0.16;
const RIM_MIN = 0.3;
const RIM_MAX = 0.85;

export function AuraRing() {
  const group = useRef<THREE.Group>(null!);
  const fill = useRef<THREE.MeshBasicMaterial>(null!);
  const rim = useRef<THREE.MeshBasicMaterial>(null!);

  useFrame(() => {
    const c = game.combat;
    const p = game.player;
    // Unit geometry scaled to the live radius, so M4 growing the aura is a number changing in the
    // sim and nothing at all changing here.
    group.current.position.set(p.x, LIFT, p.z);
    group.current.scale.setScalar(c.auraR);

    const f = c.auraFlare;
    fill.current.opacity = FILL_MIN + (FILL_MAX - FILL_MIN) * f;
    rim.current.opacity = RIM_MIN + (RIM_MAX - RIM_MIN) * f;
  });

  return (
    <group ref={group}>
      {/* Both meshes are unlit and write no depth: they are a readout, not an object in the world,
          and a lit translucent disc would darken on the side away from the key light — making the
          aura look weaker in a direction where it is not. */}
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial
          ref={fill}
          color={COLORS.AURA}
          transparent
          opacity={FILL_MIN}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.94, 1, 48]} />
        <meshBasicMaterial
          ref={rim}
          color={COLORS.AURA}
          transparent
          opacity={RIM_MIN}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
