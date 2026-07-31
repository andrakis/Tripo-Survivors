// The scene graph. One light direction, one ambient fill, fog, and the arena.
//
// Everything in scene/ reads state and writes matrices. No game logic lives here
// (docs/ARCHITECTURE.md §2.2).

import { useRef } from 'react';
import * as THREE from 'three';
import { COLORS, FOG_DENSITY } from '../config';
import { Ground } from './Ground';
import { Obstacles } from './Obstacles';
import { CameraRig } from './CameraRig';
import { GameLoop } from './GameLoop';
import { Player } from './Player';
import { Swarm } from './Swarm';
import { AuraRing } from './AuraRing';
import { Projectiles } from './Projectiles';

export function Scene() {
  // What the camera follows — written by GameLoop from the player's position each tick. Held as a
  // ref, not state, because it changes every frame — see the hot-path rule in ARCHITECTURE §3.
  const focus = useRef(new THREE.Vector3());

  return (
    <>
      {/* Fog is EXACTLY the ground colour so the horizon vanishes rather than banding, and it is
          what makes enemies fade in as they approach instead of popping at a frustum edge. */}
      <fogExp2 attach="fog" args={[COLORS.FOG, FOG_DENSITY]} />
      <color attach="background" args={[COLORS.FOG]} />

      {/* Flat-shaded stage, deliberately simple lighting: no PBR, no env map, no shadow maps.
          An imported model keeps its own materials and reads as the detailed thing on screen.
          Intensities are kept LOW on purpose: three r155+ is physically-lit, and the obvious
          "bright enough to see" values blow the grey props past the player in value — which
          breaks the one rule the whole look rests on (ART-STYLE: the player is the brightest
          pixel on screen). The stage is meant to be underexposed. */}
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 60, 25]} intensity={1.5} />

      <Ground />
      <Obstacles />

      {/* GameLoop is the one tick and runs at priority -1, so everything below reads fresh state. */}
      <GameLoop focus={focus} />
      {/* The aura is drawn before the cast so the transparent disc sorts behind the bodies standing
          in it — the player has to see what is inside the ring, not a wash over the top of it. */}
      <AuraRing />
      <Swarm />
      <Projectiles />
      <Player />
      <CameraRig focus={focus} />
    </>
  );
}
