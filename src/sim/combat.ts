// Combat: the two weapons from DESIGN §6, the damage they do, and what dying looks like.
//
// Both weapons fire themselves — there is no attack input anywhere in this file, because there is no
// attack button in the game (DESIGN pillar 1). The player's entire influence on combat is *where
// they are standing* and *which way they last moved*, so everything here reads only `player.x/z` and
// `player.facing`.
//
// The two weapons deliberately pull in opposite directions:
//   AURA  — a ring on the player. Rewards standing near the crowd, which is dangerous.
//   BOLT  — fires along facing, and facing comes from movement. Rewards running AT the crowd.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { TIERS, TUNING } from '../config';
import { queryNeighbors, type Grid } from './grid';
import { damagePlayer, isAlive, type Player } from './player';
import {
  E_FLASH,
  E_HP,
  E_TIER,
  E_X,
  E_Z,
  ENEMY_STRIDE,
  killEnemy,
  type Swarm,
} from './swarm';

export const BOLT_STRIDE = 6;
export const B_X = 0;
export const B_Z = 1;
export const B_VX = 2;
export const B_VZ = 3;
/** Seconds of flight left. Set from BOLT_RANGE / BOLT_SPEED, so range is expressed once. */
export const B_LIFE = 4;
/** Enemies this bolt may still hit AFTER the one it is about to. 0 means the next hit consumes it. */
export const B_PIERCE = 5;

export const DEATH_STRIDE = 4;
export const D_X = 0;
export const D_Z = 1;
export const D_TIER = 2;
export const D_AGE = 3;

export interface Combat {
  /** Seconds until the next aura pulse. */
  auraTimer: number;
  /** Decaying 0..1 flare, written on each pulse. Renderer-only — nothing in the sim reads it. */
  auraFlare: number;
  /** Live aura radius. A field rather than a constant because M4's level 2 grows it (DESIGN §6.3). */
  auraR: number;
  boltTimer: number;
  /**
   * Whether the Lance is firing. DESIGN §6.3 unlocks it at level 3, but M3 has no progression yet
   * and a combat milestone that ships one of its two weapons is not a combat milestone. M4's
   * unlock table flips this to `false` at run start and back on at level 3.
   */
  boltEnabled: boolean;
  bolts: Float32Array;
  nb: number;
  /** Death markers: purely visual, but they live here because deciding when one exists is sim work. */
  deaths: Float32Array;
  nd: number;
  kills: number;
  /** Raw XP earned. M4's progression.ts consumes it; M3 only shows it on the game-over card. */
  xp: number;
  /**
   * Per-enemy "already hit by this swept segment" stamp. A bolt's per-tick movement is sampled at
   * several points along the segment and the sample discs overlap, so without this an enemy sitting
   * in the overlap takes the bolt's damage twice and eats two pierce charges.
   */
  stamp: Int32Array;
  stampId: number;
  /** queryNeighbors output buffer. Sized at the cap so a query can never silently truncate. */
  scratch: Int32Array;
}

export function createCombat(): Combat {
  return {
    auraTimer: 0,
    auraFlare: 0,
    auraR: TUNING.AURA_R,
    boltTimer: 0,
    boltEnabled: true,
    bolts: new Float32Array(TUNING.MAX_BOLTS * BOLT_STRIDE),
    nb: 0,
    deaths: new Float32Array(TUNING.MAX_DEATHS * DEATH_STRIDE),
    nd: 0,
    kills: 0,
    xp: 0,
    stamp: new Int32Array(TUNING.MAX_ENEMIES),
    stampId: 0,
    scratch: new Int32Array(TUNING.MAX_ENEMIES),
  };
}

/**
 * Apply damage to one enemy. Does NOT remove it — see `reap` below for why that is deferred.
 *
 * Already-dead enemies are skipped rather than damaged again: within one tick the aura and a bolt
 * can both land on the same body, and without this the second hit would count a second kill.
 */
function hit(s: Swarm, i: number, amount: number): void {
  const b = i * ENEMY_STRIDE;
  if (s.data[b + E_HP] <= 0) return;
  s.data[b + E_HP] -= amount;
  s.data[b + E_FLASH] = TUNING.FLASH_TIME;
}

function addDeath(c: Combat, x: number, z: number, tier: number): void {
  if (c.nd >= TUNING.MAX_DEATHS) return; // a dropped marker is a missing puff, never a missing kill
  const b = c.nd++ * DEATH_STRIDE;
  c.deaths[b + D_X] = x;
  c.deaths[b + D_Z] = z;
  c.deaths[b + D_TIER] = tier;
  c.deaths[b + D_AGE] = 0;
}

/**
 * Remove everything that reached 0 HP, in ONE pass at the end of combat.
 *
 * Deferring removal is the whole reason the rest of this file is simple. Removal is swap-remove
 * (ARCHITECTURE §5), which moves a live enemy from the top of the array down into the dead one's
 * slot — so an index taken a moment ago now names a different enemy. If the aura killed as it went,
 * every later bolt in the same tick would be working from indices that had shifted underneath it,
 * and the spatial grid built in step 5 would be wrong *during* the phase that reads it hardest.
 *
 * Nothing is removed until every weapon has finished, so indices are stable throughout, and the one
 * consumer that runs after this (`takeContact`) guards with `if (j >= n)` as §5 requires.
 *
 * `i` deliberately does not advance on a kill: the slot now holds a different, unexamined enemy.
 */
function reap(c: Combat, s: Swarm): void {
  const d = s.data;
  for (let i = 0; i < s.n; ) {
    const b = i * ENEMY_STRIDE;
    if (d[b + E_HP] > 0) {
      i++;
      continue;
    }
    const tier = d[b + E_TIER];
    addDeath(c, d[b + E_X], d[b + E_Z], tier);
    c.kills++;
    c.xp += TIERS[tier].xp;
    killEnemy(s, i);
  }
}

/** One aura pulse: flat damage to everything inside the ring, no falloff (DESIGN §6.1). */
function pulseAura(c: Combat, p: Player, s: Swarm, g: Grid): void {
  c.auraFlare = 1;
  const n = queryNeighbors(g, s.data, ENEMY_STRIDE, s.n, p.x, p.z, c.auraR, c.scratch);
  for (let k = 0; k < n; k++) hit(s, c.scratch[k], TUNING.AURA_DAMAGE);
}

function fireBolt(c: Combat, p: Player): void {
  if (c.nb >= TUNING.MAX_BOLTS) return;
  const b = c.nb++ * BOLT_STRIDE;
  // facing is atan2(x, z) — 0 is +Z — so the heading is (sin, cos), not the usual (cos, sin).
  const dx = Math.sin(p.facing);
  const dz = Math.cos(p.facing);
  c.bolts[b + B_X] = p.x;
  c.bolts[b + B_Z] = p.z;
  c.bolts[b + B_VX] = dx * TUNING.BOLT_SPEED;
  c.bolts[b + B_VZ] = dz * TUNING.BOLT_SPEED;
  c.bolts[b + B_LIFE] = TUNING.BOLT_RANGE / TUNING.BOLT_SPEED;
  c.bolts[b + B_PIERCE] = TUNING.BOLT_PIERCE;
}

function removeBolt(c: Combat, i: number): void {
  const last = --c.nb;
  if (i === last) return;
  const to = i * BOLT_STRIDE;
  const from = last * BOLT_STRIDE;
  for (let k = 0; k < BOLT_STRIDE; k++) c.bolts[to + k] = c.bolts[from + k];
}

/**
 * Advance every bolt and resolve what it passed through — a **swept segment** test, not a point test
 * at the new position.
 *
 * A bolt covers `BOLT_SPEED × dt` in a tick: 0.43 units at 60 fps, but 1.3 at the 50 ms dt clamp, and
 * more than an enemy's diameter either way at the low end of a bad frame. A point test would let a
 * bolt step straight over a grunt, and the failure would be intermittent and framerate-dependent —
 * the worst possible bug to be handed by a viewer's "it doesn't work on my machine".
 *
 * **The narrow phase is a distance to the bolt's infinite LINE, gated on where along it the foot of
 * the perpendicular falls.** The obvious version — distance to the segment, clamped at its ends — is
 * wrong, and wrong in a way that looks like the pierce budget being ignored: a bolt stays within its
 * 0.75-unit hit radius of the same enemy for about three consecutive ticks at 60 fps, so it hits that
 * one enemy three times and is consumed before it ever reaches the second.
 *
 * Splitting the test fixes it exactly, with no per-bolt hit list to carry. The perpendicular distance
 * to the line is the same on every tick, so it alone decides *whether* this bolt can ever hit this
 * enemy; the foot parameter `t` decides *when*. And `t` falls by exactly 1.0 each tick — the segments
 * tile the line end to end — so precisely one tick of the bolt's life has `t ∈ (0, 1]`. One hit per
 * enemy per bolt, guaranteed by the geometry rather than by bookkeeping.
 *
 * The broad phase still samples the segment at intervals of one grid cell and unions the results, and
 * those sample discs overlap, so hits within a single tick still need the `stamp` dedupe.
 */
function stepBolts(c: Combat, s: Swarm, g: Grid, dt: number): void {
  const bolts = c.bolts;
  const d = s.data;
  const hitR = TUNING.UNIT_R + TUNING.BOLT_R;
  const hitR2 = hitR * hitR;

  for (let i = 0; i < c.nb; ) {
    const b = i * BOLT_STRIDE;
    const x0 = bolts[b + B_X];
    const z0 = bolts[b + B_Z];
    const dx = bolts[b + B_VX] * dt;
    const dz = bolts[b + B_VZ] * dt;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);

    let dead = false;
    const id = ++c.stampId;

    // One sample per grid cell of travel, placed at segment midpoints, with the query radius grown
    // by half a step so the sample discs cover the whole segment with no gap between them.
    const samples = Math.max(1, Math.ceil(len / g.cell));
    const queryR = hitR + len / samples / 2;

    for (let k = 0; k < samples && !dead; k++) {
      const t = (k + 0.5) / samples;
      const sx = x0 + dx * t;
      const sz = z0 + dz * t;
      const found = queryNeighbors(g, d, ENEMY_STRIDE, s.n, sx, sz, queryR, c.scratch);

      for (let q = 0; q < found; q++) {
        const e = c.scratch[q];
        if (c.stamp[e] === id) continue;
        const eb = e * ENEMY_STRIDE;
        if (d[eb + E_HP] <= 0) continue;

        const ex = d[eb + E_X];
        const ez = d[eb + E_Z];
        // Where along THIS tick's segment the enemy's perpendicular lands. Outside (0, 1] means
        // another tick of this bolt's flight owns the hit — either it already did, or it will.
        const along = len2 > 0 ? ((ex - x0) * dx + (ez - z0) * dz) / len2 : 0;
        if (along <= 0 || along > 1) continue;
        const qx = ex - (x0 + dx * along);
        const qz = ez - (z0 + dz * along);
        if (qx * qx + qz * qz > hitR2) continue;

        c.stamp[e] = id;
        hit(s, e, TUNING.BOLT_DAMAGE);
        // Hits within a single tick are resolved in grid order rather than in order along the
        // segment. At 0.43 units of travel a bolt almost never meets two enemies in one tick, and
        // when it does they are inside each other's separation radius, so ordering them buys a
        // distinction nobody can see.
        if (bolts[b + B_PIERCE] <= 0) {
          dead = true;
          break;
        }
        bolts[b + B_PIERCE] -= 1;
      }
    }

    bolts[b + B_X] = x0 + dx;
    bolts[b + B_Z] = z0 + dz;
    bolts[b + B_LIFE] -= dt;
    if (dead || bolts[b + B_LIFE] <= 0) removeBolt(c, i);
    else i++;
  }
}

function stepDeaths(c: Combat, dt: number): void {
  for (let i = 0; i < c.nd; ) {
    const b = i * DEATH_STRIDE;
    c.deaths[b + D_AGE] += dt;
    if (c.deaths[b + D_AGE] >= TUNING.DEATH_TIME) {
      const last = --c.nd;
      if (i !== last) {
        const from = last * DEATH_STRIDE;
        for (let k = 0; k < DEATH_STRIDE; k++) c.deaths[b + k] = c.deaths[from + k];
      }
    } else i++;
  }
}

/**
 * Tick step 7: fire both weapons, resolve their damage, then remove the dead.
 *
 * `g` must be the enemy grid built in step 5, and must not have been rebuilt since — every index
 * this function touches came out of it.
 */
export function stepCombat(c: Combat, p: Player, s: Swarm, g: Grid, dt: number): void {
  c.auraFlare = Math.max(0, c.auraFlare - dt / TUNING.AURA_FLARE);

  const alive = isAlive(p);

  c.auraTimer -= dt;
  if (c.auraTimer <= 0) {
    // Re-arm by ADDING the interval rather than assigning it, so the fractional remainder carries
    // and the pulse rate is exactly AURA_RATE instead of drifting slower by up to one frame a pulse.
    c.auraTimer += 1 / TUNING.AURA_RATE;
    if (c.auraTimer <= 0) c.auraTimer = 1 / TUNING.AURA_RATE; // a long stall must not bank pulses
    if (alive) pulseAura(c, p, s, g);
  }

  c.boltTimer -= dt;
  if (c.boltTimer <= 0) {
    c.boltTimer += TUNING.BOLT_INTERVAL;
    if (c.boltTimer <= 0) c.boltTimer = TUNING.BOLT_INTERVAL;
    if (alive && c.boltEnabled) fireBolt(c, p);
  }

  stepBolts(c, s, g, dt);
  reap(c, s);
  stepDeaths(c, dt);
}

/**
 * Tick step 11: contact damage, after everything has moved, so an enemy pushed into the player this
 * tick hurts this tick rather than next.
 *
 * The **worst** touching enemy sets the damage, not the first one the cell walk happens to reach.
 * One i-frame window should cost what walking into a brute costs; picking arbitrarily would make the
 * same collision hurt differently depending on array order, which is exactly the kind of thing a
 * player reads as the game being unfair.
 *
 * Returns true if a hit landed, so the caller can drive feedback (DESIGN §12 rule 4).
 *
 * The grid is up to one tick stale here: `reap` swap-removed during step 7, so a surviving enemy may
 * have moved into a dead one's slot and now be binned under the wrong cell. The cost is that a
 * single contact can be missed for one frame, against a 0.6 s i-frame window — and anything actually
 * touching the player is still touching next tick. Rebuilding the grid to close that would double
 * the tick's only O(n) structure for a frame nobody can perceive.
 */
export function takeContact(c: Combat, p: Player, s: Swarm, g: Grid): boolean {
  if (!isAlive(p) || p.iframe > 0) return false;

  const reach = TUNING.PLAYER_R + TUNING.UNIT_R;
  const n = queryNeighbors(g, s.data, ENEMY_STRIDE, s.n, p.x, p.z, reach, c.scratch);

  let worst = 0;
  for (let k = 0; k < n; k++) {
    const contact = TIERS[s.data[c.scratch[k] * ENEMY_STRIDE + E_TIER]].contact;
    if (contact > worst) worst = contact;
  }

  return worst > 0 && damagePlayer(p, worst);
}
