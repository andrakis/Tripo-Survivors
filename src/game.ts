// The spine. All simulation state hangs off one object, and one `stepGame(dt)` advances it in the
// fixed order documented in docs/ARCHITECTURE.md §6. Read this file first.
//
// It is a module singleton rather than React state or a context, for the reason the whole
// architecture rests on: per-frame simulation data must never pass through React (ARCHITECTURE §3).
// Scene components import `game`, read its numbers in `useFrame`, and write matrices — no
// re-render, no prop drilling, no subscription.
//
// M1–M2 own steps 1–6 of the tick. The remaining steps are commented in place so the order is
// established now and later milestones slot into it rather than renegotiating it.

import { createPlayer, stepPlayer, type Player } from './sim/player';
import { createFlow, maybeSolveFlow, type FlowField } from './sim/flow';
import { makeGrid, type Grid } from './sim/grid';
import { buildSwarmGrid, createSwarm, spawnEnemy, stepSwarm, type Swarm } from './sim/swarm';
import { createWaves, stepWaves, type Waves } from './sim/waves';
import { overlapsObstacle } from './sim/world';
import { sampleInput, type InputVector } from './input';

/** Longest tick the sim will take. A backgrounded tab hands back a multi-second dt on return, and
 *  without this clamp the first frame after that teleports everything through the geometry. */
const MAX_DT = 0.05;

export interface Game {
  /** Seconds of run time. Drives the spawn ramp (M2) and the HUD clock (M3). */
  time: number;
  /** Wall-clock cost of the last tick, in ms. ARCHITECTURE §11 budgets the whole tick at ~2 ms and
   *  nothing else measures it; two performance.now() calls a frame is a rounding error by comparison. */
  stepMs: number;
  player: Player;
  /** The tick's input vector. One object, rewritten in place, never allocated in the loop. */
  input: InputVector;
  flow: FlowField;
  /** The ONE broad-phase, rebuilt once per tick and read by every consumer below it. */
  grid: Grid;
  swarm: Swarm;
  waves: Waves;
}

export function createGame(): Game {
  const g: Game = {
    time: 0,
    stepMs: 0,
    player: createPlayer(),
    input: { x: 0, z: 0 },
    flow: createFlow(),
    grid: makeGrid(),
    swarm: createSwarm(),
    waves: createWaves(),
  };
  // Solve once up front so the very first tick samples a real field rather than a zeroed one — an
  // enemy that spawns before the first solve would otherwise get a zero heading and stand still.
  maybeSolveFlow(g.flow, g.player.x, g.player.z, 1);
  return g;
}

export function stepGame(g: Game, rawDt: number): void {
  const t0 = performance.now();
  const dt = Math.min(rawDt, MAX_DT);
  g.time += dt;

  const p = g.player;

  sampleInput(g.input); //                      1. keyboard + touch -> one normalised vector
  stepPlayer(p, g.input.x, g.input.z, dt); //   2. move, resolve, clamp, face
  maybeSolveFlow(g.flow, p.x, p.z, dt); //      3. cadence + player-cell-change; re-seed and solve
  stepWaves(g.waves, g.swarm, g.time, dt, p.x, p.z); // 4. budget -> ring spawns
  buildSwarmGrid(g.swarm, g.grid); //           5. ONE rebuild, from live positions
  stepSwarm(g.swarm, g.grid, g.flow, dt); //    6. flow + separation + obstacles + integrate

  //  7. combat.step()       8. orbs.spawn()   9. orbs.step()   10. progression.step() -- M3/M4
  // 11. player.takeContact()  12. syncStore()                                         -- M3

  g.stepMs = performance.now() - t0;
}

/** The one live game. */
export const game = createGame();

// Debug seam, dev builds only: scripts/drive.mjs reads sim truth through this rather than trying to
// infer the player's position from pixels. Stripped from the production bundle by the DEV guard.
//
// `__spawn` is here because the interesting swarm behaviour lives at a crowd size the spawn ramp
// takes minutes to reach, and a verification run that has to wait four minutes to look at 400
// enemies is a verification run nobody will execute. It is also how you find your own machine's
// ceiling by hand: `__spawn(2000, 0)` in the console.
if (import.meta.env.DEV) {
  const w = window as unknown as {
    __game: Game;
    __spawn: (count: number, tier?: number, radius?: number) => number;
    __overlapsProp: (x: number, z: number, r: number) => boolean;
  };
  w.__game = game;
  // Exposed so the verification script can ask the arena itself whether a point is inside a prop,
  // rather than keeping its own copy of the 14 boxes that would silently drift out of date.
  w.__overlapsProp = overlapsObstacle;
  w.__spawn = (count, tier = 0, radius = 30) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = radius * (0.7 + 0.3 * ((i * 7919) % 100) / 100);
      spawnEnemy(game.swarm, game.player.x + Math.cos(a) * r, game.player.z + Math.sin(a) * r, tier);
    }
    return game.swarm.n;
  };
}
