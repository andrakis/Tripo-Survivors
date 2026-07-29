// The single tick. One `useFrame` for the entire simulation (docs/ARCHITECTURE.md §6).
//
// Order -1 so the sim runs before every renderer's `useFrame`: R3F sorts subscriptions by priority,
// so the camera and the player mesh in this same frame read numbers that are already current rather
// than one frame stale. A NEGATIVE priority only reorders — it is a POSITIVE one that would take
// over the render loop and leave the canvas blank.

import { useEffect, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import type * as THREE from 'three';
import { game, stepGame } from '../game';
import { attachKeyboard } from '../input';

const TICK_ORDER = -1;

export function GameLoop({ focus }: { focus: RefObject<THREE.Vector3> }) {
  useEffect(() => attachKeyboard(), []);

  useFrame((_, dt) => {
    stepGame(game, dt);
    // The camera follows a plain ref rather than the player object, so the follow target can be
    // anything later (a death-cam, a level-up push-out) without CameraRig learning what a player is.
    focus.current.set(game.player.x, 0, game.player.z);
  }, TICK_ORDER);

  return null;
}
