// The player: one normalised input vector in; position, facing, HP and an i-frame timer out.
//
// No THREE import — see docs/ARCHITECTURE.md §2.1. This module does not know a camera exists, does
// not know where the input vector came from (keyboard or thumbstick — see src/input.ts), and does
// not know how it will be drawn. It is plain numbers, and it runs in node under vitest.

import { TUNING } from '../config';
import { clampToWorld, resolveObstacles } from './world';

export interface Player {
  x: number;
  z: number;
  /** Current velocity. Smoothed toward the input heading, so it lags it slightly. */
  vx: number;
  vz: number;
  /** Yaw in radians. 0 faces +Z, matching the model export contract (MODEL-PIPELINE §2). */
  facing: number;
  hp: number;
  maxHp: number;
  /** Seconds of invulnerability remaining. Also drives the blink in scene/Player.tsx. */
  iframe: number;
}

export function createPlayer(): Player {
  return {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    facing: 0,
    hp: TUNING.PLAYER_HP,
    maxHp: TUNING.PLAYER_HP,
    iframe: 0,
  };
}

/**
 * Advance the player one tick. `(ix, iz)` is the input vector, already normalised to a magnitude of
 * at most 1 by the producer — this function does not re-normalise, because a thumbstick at half
 * deflection is *supposed* to move at half speed.
 */
export function stepPlayer(p: Player, ix: number, iz: number, dt: number): void {
  p.iframe = Math.max(0, p.iframe - dt);

  // 1 - exp(-k*dt), not a raw lerp — the raw form makes responsiveness a function of framerate, and
  // control feel is the one thing in this milestone that must not change between a 60 Hz laptop and
  // a 144 Hz monitor. Same reasoning as the camera (ARCHITECTURE §9).
  const k = 1 - Math.exp(-TUNING.PLAYER_RESPONSE * dt);
  p.vx += (ix * TUNING.PLAYER_SPEED - p.vx) * k;
  p.vz += (iz * TUNING.PLAYER_SPEED - p.vz) * k;

  p.x += p.vx * dt;
  p.z += p.vz * dt;

  // Obstacles first, bounds second. The other order lets a prop sitting near the world edge push
  // the player back outside the bounds that were just enforced.
  [p.x, p.z] = resolveObstacles(p.x, p.z, TUNING.PLAYER_R);
  [p.x, p.z] = clampToWorld(p.x, p.z, TUNING.PLAYER_R);

  // Facing comes from INPUT, not from velocity, and is held when input goes to zero.
  //
  // From input, because velocity is smoothed: turning would visibly lag the key press, and from M3
  // the bolt fires along facing, so the lag would read as the gun being wrong rather than the model.
  // Held on release, because a player who stops to let the aura work should keep pointing where they
  // last aimed rather than snapping back to whatever angle the decaying velocity happens to hit.
  if (ix !== 0 || iz !== 0) p.facing = Math.atan2(ix, iz);
}

/**
 * Apply damage through the i-frame gate. Returns true if the hit actually landed, so a caller can
 * decide whether to play feedback (M3). A dead player takes no further hits.
 */
export function damagePlayer(p: Player, amount: number): boolean {
  if (p.iframe > 0 || p.hp <= 0) return false;
  p.hp = Math.max(0, p.hp - amount);
  p.iframe = TUNING.PLAYER_IFRAMES;
  return true;
}

export function isAlive(p: Player): boolean {
  return p.hp > 0;
}
