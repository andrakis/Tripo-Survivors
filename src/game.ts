// The spine. All simulation state hangs off one object, and one `stepGame(dt)` advances it in the
// fixed order documented in docs/ARCHITECTURE.md §6. Read this file first.
//
// It is a module singleton rather than React state or a context, for the reason the whole
// architecture rests on: per-frame simulation data must never pass through React (ARCHITECTURE §3).
// Scene components import `game`, read its numbers in `useFrame`, and write matrices — no
// re-render, no prop drilling, no subscription.
//
// M1–M3 own steps 1–7 and 11–12. Steps 8–10 are commented in place so the order is established now
// and M4 slots into it rather than renegotiating it.

import { TUNING } from './config';
import { createPlayer, isAlive, stepPlayer, type Player } from './sim/player';
import { createFlow, maybeSolveFlow, type FlowField } from './sim/flow';
import { makeGrid, type Grid } from './sim/grid';
import { buildSwarmGrid, createSwarm, spawnEnemy, stepSwarm, type Swarm } from './sim/swarm';
import { createWaves, stepWaves, type Waves } from './sim/waves';
import {
  createCombat,
  DR_VALUE,
  DR_X,
  DR_Z,
  DROP_STRIDE,
  stepCombat,
  takeContact,
  type Combat,
} from './sim/combat';
import { createOrbs, mergeOrbs, spawnOrb, stepOrbs, type Orbs } from './sim/orbs';
import { createBoosts, stepBoosts, type Boosts } from './sim/boosts';
import {
  chooseUpgrade,
  createProgression,
  isPaused,
  stepProgression,
  type Progression,
} from './sim/progression';
import { overlapsObstacle } from './sim/world';
import { actorReport, getActor } from './models/loader';
import { sampleInput, type InputVector } from './input';
import { useUi, type OfferCard } from './store';

/** Longest tick the sim will take. A backgrounded tab hands back a multi-second dt on return, and
 *  without this clamp the first frame after that teleports everything through the geometry. */
const MAX_DT = 0.05;

export interface Game {
  /** Seconds of run time. Drives the spawn ramp and the HUD clock. */
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
  combat: Combat;
  /** Uncollected XP on the ground. */
  orbs: Orbs;
  /** Boost pickups on the field, and the timers for what is currently active. */
  boosts: Boosts;
  /** Level, XP curve, the weapon unlock table, and any outstanding upgrade choice. */
  prog: Progression;
  /** Run time of the last hit taken, or -1. Drives the HUD vignette (DESIGN §12 rule 4). */
  lastHitAt: number;
  /** Bumped by resetGame so run-scoped UI remounts instead of carrying the last run's state. */
  runId: number;
  /** Seconds since the last store push. */
  storeSince: number;
}

export function createGame(): Game {
  const g: Game = {
    time: 0,
    stepMs: 0,
    player: createPlayer(),
    input: { x: 0, z: 0, dash: false },
    flow: createFlow(),
    grid: makeGrid(),
    swarm: createSwarm(),
    waves: createWaves(),
    combat: createCombat(),
    orbs: createOrbs(),
    boosts: createBoosts(),
    prog: createProgression(),
    lastHitAt: -1,
    runId: 0,
    storeSince: 0,
  };
  // Solve once up front so the very first tick samples a real field rather than a zeroed one — an
  // enemy that spawns before the first solve would otherwise get a zero heading and stand still.
  maybeSolveFlow(g.flow, g.player.x, g.player.z, 1);
  // Publish once immediately, or the HUD renders "0 / 0 HP" for the 100 ms before the first
  // throttled push — a first frame that says the player is already dead.
  syncStore(g);
  return g;
}

/**
 * Restart, IN PLACE. Every scene component holds a reference to the `game` singleton and reads it
 * imperatively in useFrame, so handing back a fresh object would leave the whole renderer pointed at
 * the previous run. Sub-objects are replaced wholesale rather than zeroed field by field: a reset
 * that has to remember every field is a reset that will one day forget one.
 */
export function resetGame(g: Game): void {
  const runId = g.runId + 1;
  g.time = 0;
  g.stepMs = 0;
  g.player = createPlayer();
  g.input.x = 0;
  g.input.z = 0;
  g.input.dash = false;
  g.swarm = createSwarm();
  g.waves = createWaves();
  // Replacing these is also what undoes a run's worth of upgrade modifiers — every one of them is a
  // write to a live field on `combat`, `player` or `orbs`, and nothing has to be unwound. The same
  // goes for the boost timers: a fresh Boosts has none running, so nothing can leak across a run.
  g.combat = createCombat();
  g.orbs = createOrbs();
  g.boosts = createBoosts();
  g.prog = createProgression();
  g.lastHitAt = -1;
  g.runId = runId;
  g.storeSince = 0;
  // The flow field is kept — its expensive half is the cost field, which never changes — but it must
  // be re-seeded on the respawned player before anything samples it.
  maybeSolveFlow(g.flow, g.player.x, g.player.z, 1);
  syncStore(g);
}

/** Rebuilt only when the offer identity changes, so the choice card does not remount every push. */
const NO_OFFERS: readonly OfferCard[] = [];
let offerCache: { from: unknown; cards: readonly OfferCard[] } = { from: null, cards: NO_OFFERS };

function offerCards(g: Game): readonly OfferCard[] {
  const offer = g.prog.offer;
  if (!offer) return NO_OFFERS;
  if (offerCache.from !== offer) {
    offerCache = { from: offer, cards: offer.map((u) => ({ id: u.id, label: u.label, detail: u.detail })) };
  }
  return offerCache.cards;
}

function syncStore(g: Game): void {
  const b = g.boosts;
  useUi.getState().sync({
    hp: g.player.hp,
    maxHp: g.player.maxHp,
    time: g.time,
    kills: g.combat.kills,
    xp: g.prog.xp,
    xpNeed: g.prog.need,
    totalXp: g.prog.totalXp,
    level: g.prog.level,
    lastLevelAt: g.prog.lastLevelAt,
    unlock: g.prog.lastUnlock,
    offers: offerCards(g),
    // A plain array copy rather than the live Float32Array: zustand compares by reference and the
    // sim's buffer is mutated in place, so handing it over would push a value the HUD never re-reads.
    boostTimers: Array.from(b.timers),
    lastBoostAt: b.lastPickupAt,
    lastBoostKind: b.lastKind,
    dashCd: g.player.dashCd,
    dashCdMax: g.player.dashCdMax,
    dead: !isAlive(g.player),
    lastHitAt: g.lastHitAt,
    runId: g.runId,
  });
}

export function stepGame(g: Game, rawDt: number): void {
  const t0 = performance.now();
  const dt = Math.min(rawDt, MAX_DT);

  const p = g.player;

  // Death freezes the field. The run is over and the card is up (DESIGN §4.3), and a crowd that
  // keeps grinding over the body behind the card is both distracting and a claim that the run is
  // still happening. The clock stops here too, so the score on the card is the score you earned.
  //
  // No store push on this path: step 12 below already forced one on the frame the player died, and
  // nothing can change while the field is frozen. Re-pushing would re-render the card 60 times a
  // second to display numbers that are, by definition, final.
  if (!isAlive(p)) {
    g.stepMs = performance.now() - t0;
    return;
  }

  // An outstanding upgrade choice freezes the field the same way death does (DESIGN §6.3). It is the
  // only pause in the game: three cards is a decision, and asking for one while a crowd closes in
  // would make the choice a reflex test rather than a choice. Input is still SAMPLED, so a dash
  // queued the instant before the level-up is not silently swallowed by the pause.
  if (isPaused(g.prog)) {
    g.stepMs = performance.now() - t0;
    return;
  }

  g.time += dt;

  sampleInput(g.input); //                      1. keyboard + touch -> one normalised vector
  stepPlayer(p, g.input.x, g.input.z, dt, g.input.dash); // 2. dash or move, resolve, clamp, face
  maybeSolveFlow(g.flow, p.x, p.z, dt); //      3. cadence + player-cell-change; re-seed and solve
  stepWaves(g.waves, g.swarm, g.time, dt, p.x, p.z); // 4. budget -> ring spawns
  buildSwarmGrid(g.swarm, g.grid); //           5. ONE rebuild, from live positions
  stepSwarm(g.swarm, g.grid, g.flow, dt); //    6. flow + separation + obstacles + integrate
  stepCombat(g.combat, p, g.swarm, g.grid, dt); // 7. aura pulse; bolts; damage; reap the dead

  // 8. this tick's kills become orbs on the ground. Queued by combat's reap rather than dropped from
  //    inside it, so combat never learns that orbs exist (ARCHITECTURE §6).
  for (let i = 0; i < g.combat.nDrops; i++) {
    const b = i * DROP_STRIDE;
    spawnOrb(g.orbs, g.combat.drops[b + DR_X], g.combat.drops[b + DR_Z], g.combat.drops[b + DR_VALUE]);
  }

  // 8a. boosts: age the field, run the spawn clock, collect anything underfoot, push the active
  //     timers onto combat and the player. Before the orbs step, because the Magnet boost latches
  //     the whole field and the orbs it latched should start moving on the tick you picked it up.
  stepBoosts(g.boosts, p, g.combat, g.orbs, g.time, dt);

  mergeOrbs(g.orbs, dt); //                      8b. consolidate a big field of old orbs (2 Hz)
  const gained = stepOrbs(g.orbs, p, dt); //     9. magnet + pickup -> banked XP
  const levelled = stepProgression(g.prog, g, gained, g.time, dt); // 10. level-ups and offers

  if (takeContact(g.combat, p, g.swarm, g.grid)) g.lastHitAt = g.time; // 11. contact, i-frame gated

  // 12. syncStore, throttled. Death and a level-up are both pushed immediately rather than waiting
  //     up to 100 ms for the next slot — they are the two state changes the player is watching for,
  //     and a toast that keys on `lastLevelAt` should not arrive after the shake it belongs to.
  g.storeSince += dt;
  if (g.storeSince >= 1 / TUNING.STORE_HZ || levelled || !isAlive(p)) {
    g.storeSince = 0;
    syncStore(g);
  }

  g.stepMs = performance.now() - t0;
}

/** The one live game. */
export const game = createGame();

// Force a FULL RELOAD when this module — or anything under sim/ that reaches it — is hot-updated.
//
// `game` is a module singleton and every scene component captures it. A hot update re-evaluates this
// file and builds a NEW singleton, while React Fast Refresh keeps the existing component tree alive
// holding the old one. The two halves of the game then diverge silently, and the symptom is
// bewildering: the level-up card sits there and clicking a card does nothing, because the UI is
// mutating one `game` and `GameLoop` is stepping another.
//
// Accepting here and immediately invalidating is Vite's documented way to say "this module cannot be
// hot-swapped" — the update stops propagating at this file and the page reloads instead. It costs a
// reload per sim edit during development, which is the correct price for never debugging a ghost.
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}

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
    __reset: () => void;
    __spawn: (count: number, tier?: number, radius?: number) => number;
    __overlapsProp: (x: number, z: number, r: number) => boolean;
    __grantXp: (amount: number) => number;
    __choose: (index: number) => boolean;
    __models: () => Record<string, unknown>;
    __actor: (id: string) => unknown;
  };
  w.__game = game;
  // Levels 2..12 are minutes of real play apart by design, and a verification run that has to earn
  // them is a verification run nobody executes. This is the SAME call orb pickup makes — it grants
  // XP and lets the ordinary unlock table decide what that means — not a "set level" backdoor.
  w.__grantXp = (amount) => {
    stepProgression(game.prog, game, amount, game.time, 0);
    syncStore(game); // the sim is frozen the moment an offer appears, so nothing else would publish it
    return game.prog.level;
  };
  // The same call the choice card makes. Exposed so a verification run can take a card without
  // finding and clicking one, and so it can auto-resolve offers during checks that are about
  // something else entirely.
  w.__choose = (index) => {
    const ok = chooseUpgrade(game.prog, game, index, game.time);
    if (ok) syncStore(game);
    return ok;
  };
  // Exposed so the verification script can ask the arena itself whether a point is inside a prop,
  // rather than keeping its own copy of the 14 boxes that would silently drift out of date.
  w.__overlapsProp = overlapsObstacle;
  // Which actors resolved to a GLB and which fell back to their primitive. The verification run
  // asserts on this rather than trying to tell a monster from a cube in a screenshot.
  w.__models = actorReport;
  w.__actor = getActor as unknown as (id: string) => unknown;
  w.__reset = () => resetGame(game);
  w.__spawn = (count, tier = 0, radius = 30) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = radius * (0.7 + (0.3 * ((i * 7919) % 100)) / 100);
      spawnEnemy(game.swarm, game.player.x + Math.cos(a) * r, game.player.z + Math.sin(a) * r, tier);
    }
    return game.swarm.n;
  };
}
