// The spine. All simulation state hangs off one object, and one `stepGame(dt)` advances it in the
// fixed order documented in docs/ARCHITECTURE.md §6. Read this file first.
//
// It is a module singleton rather than React state or a context, for the reason the whole
// architecture rests on: per-frame simulation data must never pass through React (ARCHITECTURE §3).
// Scene components import `game`, read its numbers in `useFrame`, and write matrices — no
// re-render, no prop drilling, no subscription.
//
// M1 owns steps 1–2 of the tick. The remaining steps are commented in place so the order is
// established now and later milestones slot into it rather than renegotiating it.

import { createPlayer, stepPlayer, type Player } from './sim/player';
import { sampleInput, type InputVector } from './input';

/** Longest tick the sim will take. A backgrounded tab hands back a multi-second dt on return, and
 *  without this clamp the first frame after that teleports everything through the geometry. */
const MAX_DT = 0.05;

export interface Game {
  /** Seconds of run time. Drives the spawn ramp (M2) and the HUD clock (M3). */
  time: number;
  player: Player;
  /** The tick's input vector. One object, rewritten in place, never allocated in the loop. */
  input: InputVector;
}

export function createGame(): Game {
  return {
    time: 0,
    player: createPlayer(),
    input: { x: 0, z: 0 },
  };
}

export function stepGame(g: Game, rawDt: number): void {
  const dt = Math.min(rawDt, MAX_DT);
  g.time += dt;

  sampleInput(g.input); //           1. keyboard + touch -> one normalised vector
  stepPlayer(g.player, g.input.x, g.input.z, dt); // 2. move, resolve, clamp, face

  //  3. flow.maybeSolve()   4. waves.step()   5. grid.build()   6. swarm.step()      -- M2
  //  7. combat.step()       8. orbs.spawn()   9. orbs.step()   10. progression.step() -- M3/M4
  // 11. player.takeContact()  12. syncStore()                                         -- M3
}

/** The one live game. */
export const game = createGame();

// Debug seam, dev builds only: scripts/drive.mjs reads sim truth through this rather than trying to
// infer the player's position from pixels. Stripped from the production bundle by the DEV guard.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Game }).__game = game;
}
