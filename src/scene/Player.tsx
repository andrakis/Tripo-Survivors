// The player, drawn. Geometry, scale, lift and tint all come from models/registry.ts — swapping the
// `player` entry there changes what you see with no edit in this file. That is the whole point of
// the seam (docs/MODEL-PIPELINE.md).
//
// A single mesh, not instanced: there is one of them, and it is the only actor the camera ever gets
// close to (ARCHITECTURE §7).

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { game } from '../game';
import { getActor } from '../models/loader';

/** Blink rate during i-frames, in visible flashes per second. */
const BLINK_HZ = 10;

/** How strongly the see-through pass shows. Enough to find yourself in a crowd, not so much that it
 *  flattens the lit model when nothing is in front of you. */
const GHOST = 0.45;

export function Player() {
  const group = useRef<THREE.Group>(null!);
  const shell = useRef<THREE.Mesh>(null!);
  // The imported GLB's geometry and material when one loaded, the primitive's otherwise — see
  // src/models/loader.ts. Swapping the player for a Tripo model is one line in the registry.
  const actor = useMemo(() => getActor('player'), []);
  const geometry = actor.geometry;
  const material = useMemo(() => {
    const m =
      (actor.material as THREE.MeshLambertMaterial | null)?.clone() ??
      new THREE.MeshLambertMaterial({ color: actor.tint, flatShading: true });
    // Only ever below 1 during i-frames, but the flag has to be set at construction: flipping
    // `transparent` at runtime forces a shader recompile mid-hit, which is a visible hitch at the
    // exact moment the player is trying to read what just happened to them.
    m.transparent = true;
    return m;
  }, [actor]);

  /**
   * The see-through pass: the same silhouette again, unlit, with the depth test off and drawn last.
   *
   * DESIGN §12 rule 1 says the player is always the brightest, highest-contrast thing on screen, and
   * without this they simply are not. A 1.7-unit character is completely hidden by an 8-unit pillar
   * from a 45° camera, and — the case this milestone made unavoidable — by the crowd standing inside
   * their own aura. A game whose only verb is "where you stand" cannot have frames where you can't
   * see where you're standing.
   *
   * The roadmap schedules readability for M5 and this is one of its items pulled forward, because it
   * stops being cosmetic the moment there is a fight to lose.
   */
  const ghost = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: actor.tint,
        transparent: true,
        opacity: GHOST,
        depthTest: false,
        depthWrite: false,
      }),
    [actor],
  );

  /** The Invincible boost's shell. Transparent, unlit, and only ever visible while it is running. */
  const shellMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        side: THREE.BackSide, // inside-out, so it reads as a bubble around the player rather than
        // as a blob over them — the one actor that must never be obscured is the one inside it.
      }),
    [],
  );

  useFrame((state) => {
    const p = game.player;
    const g = group.current;
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.facing + actor.yaw;
    // Square-wave blink rather than a fade: the point is to be unmissable, and a fade at 0.6 s
    // reads as a lighting change (DESIGN §12 rule 4).
    const blink = p.iframe > 0 && Math.floor(p.iframe * BLINK_HZ * 2) % 2 === 1;
    material.opacity = blink ? 0.3 : 1;
    ghost.opacity = blink ? 0.15 : GHOST;

    // The shell breathes, and flickers over the last two seconds so the boost's expiry is something
    // the player sees coming rather than something they discover by taking a hit.
    const inv = p.invincible;
    shell.current.visible = inv > 0;
    if (inv > 0) {
      const t = state.clock.elapsedTime;
      const warn = inv < 2 ? 0.45 + 0.55 * Math.abs(Math.sin(t * 9)) : 1;
      shellMaterial.opacity = (0.13 + 0.05 * Math.sin(t * 3)) * warn;
      shell.current.scale.setScalar(1 + 0.03 * Math.sin(t * 3));
    }
  });

  return (
    <group ref={group}>
      <mesh geometry={geometry} material={material} position-y={actor.yOffset} scale={actor.scale} />
      {/* renderOrder past everything else: with depthTest off, whatever draws after this would
          otherwise paint straight over it and undo the point. */}
      <mesh
        geometry={geometry}
        material={ghost}
        position-y={actor.yOffset}
        scale={actor.scale}
        renderOrder={999}
      />

      {/* Facing pip, ONLY on the primitive. The capsule is radially symmetric, so without this the
          player's heading — which from M3 is the direction the Lance fires — is literally invisible.
          An imported model has a readable front of its own, and the pip would also be wrong the
          moment `yaw` is used to turn a backward export around: it is authored at +Z in group space
          and would swing with the correction. MODEL-PIPELINE §2 always had it coming out at M6. */}
      {actor.fallback && (
        <mesh material={material} position={[0, 0.2, 0.7]}>
          <boxGeometry args={[0.26, 0.16, 0.5]} />
        </mesh>
      )}

      <mesh ref={shell} material={shellMaterial} position-y={0.9} visible={false}>
        <sphereGeometry args={[1.35, 20, 14]} />
      </mesh>
    </group>
  );
}
