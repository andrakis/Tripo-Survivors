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
  E_VX,
  E_VZ,
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

/** One queued XP drop: where a body fell and what it was worth. Consumed by orbs, step 8. */
export const DROP_STRIDE = 3;
export const DR_X = 0;
export const DR_Z = 1;
export const DR_VALUE = 2;

export interface Combat {
  /** Seconds until the next aura pulse. */
  auraTimer: number;
  /** Decaying 0..1 flare, written on each pulse. Renderer-only — nothing in the sim reads it. */
  auraFlare: number;
  /**
   * Decaying 0..1 BURST, written only by a level-up. Renderer-only, and separate from `auraFlare`
   * for a reason M5's feedback pass found by looking at a run: `announce` set the ordinary pulse
   * flare, which the aura already sets twice a second, so the "full aura flare" DESIGN §12 promises
   * as the world-side half of a level-up was pixel-for-pixel an ordinary pulse. The event that
   * changes your character had no signal in the world at all — only a toast, in the HUD, which is
   * exactly where a player mid-fight is not looking.
   */
  auraBurst: number;
  /**
   * Contact damage the last landed hit did, for the renderer. An elite hits for 30 and a runner for
   * 4, and until M5 the vignette was identical for both — which makes the one channel DESIGN §12
   * rule 4 reserves for "you are being hurt" say nothing about how badly.
   */
  lastContact: number;
  /** Live aura radius. Level 2 grows it, level 13+ scales it (DESIGN §6.3). */
  auraR: number;
  boltTimer: number;
  /**
   * Whether the Lance is firing. Off at run start; the level 3 unlock turns it on (DESIGN §6.3).
   *
   * M3 shipped it `true` because a combat milestone with one of its two weapons is not a combat
   * milestone. M4 owns the progression that gates it, so the default flips here.
   */
  boltEnabled: boolean;
  /** Live fire interval, aura radius's opposite number: level 6 and the late cycle shorten it. */
  boltInterval: number;
  /** Live pierce budget per bolt. Level 5 adds 2. */
  boltPierce: number;
  /** Bolts per shot, fanned over ±BOLT_SPREAD. 1 until Twin Lance at level 7. */
  boltCount: number;
  /** Multiplier on every damage source in this file. Raised permanently by upgrades. */
  damageMul: number;
  /**
   * The BOOST damage multiplier — Quad Damage (DESIGN §6.4) — kept in its own field rather than
   * folded into `damageMul`. A boost has to expire; a run's permanent upgrades must not. Sharing a
   * slot means the first Quad Damage to run out takes the level 4 unlock with it.
   */
  boostMul: number;
  /** Volley size multiplier from Guns Akimbo. Same separation, same reason, as `boostMul`. */
  boltCountMul: number;
  /** HP restored per kill while Bloodlust is running. 0 otherwise. */
  lifesteal: number;
  /** Orbiting spheres circling the player. 0 until level 9. */
  orbiters: number;
  /** Orbit phase in radians. Advances whether or not any orbiter exists, so unlocking one at level 9
   *  does not start it from a fixed angle every run. */
  orbiterPhase: number;
  /** Seconds until the next orbiter damage tick. */
  orbiterTimer: number;
  /** Outward impulse an aura pulse applies to what it hits. 0 until Concussion at level 11. */
  knockback: number;
  bolts: Float32Array;
  nb: number;
  /** Death markers: purely visual, but they live here because deciding when one exists is sim work. */
  deaths: Float32Array;
  nd: number;
  kills: number;
  /**
   * XP drops queued by this tick's reap, drained by orbs in step 8 and reset here every tick.
   *
   * A queue rather than combat calling `spawnOrb` directly, because the tick order in
   * ARCHITECTURE §6 has combat at step 7 and orb spawning at step 8 — and because it keeps this file
   * from knowing that orbs exist. Bounded by MAX_ENEMIES: a tick cannot kill more than it has.
   */
  drops: Float32Array;
  nDrops: number;
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

/**
 * A fresh, LEVEL 1 combat state. Every live field here is the baseline the unlock table in
 * sim/progression.ts modifies, which is also why `resetGame` replaces this object wholesale rather
 * than zeroing it: a restart has to undo twelve levels of modifiers, and a reset that has to
 * remember every one of them is a reset that will one day forget one.
 */
export function createCombat(): Combat {
  return {
    auraTimer: 0,
    auraFlare: 0,
    auraBurst: 0,
    lastContact: 0,
    auraR: TUNING.AURA_R,
    boltTimer: 0,
    boltEnabled: false,
    boltInterval: TUNING.BOLT_INTERVAL,
    boltPierce: TUNING.BOLT_PIERCE,
    boltCount: 1,
    damageMul: 1,
    boostMul: 1,
    boltCountMul: 1,
    lifesteal: 0,
    orbiters: 0,
    orbiterPhase: Math.random() * Math.PI * 2,
    orbiterTimer: 0,
    knockback: 0,
    bolts: new Float32Array(TUNING.MAX_BOLTS * BOLT_STRIDE),
    nb: 0,
    deaths: new Float32Array(TUNING.MAX_DEATHS * DEATH_STRIDE),
    nd: 0,
    kills: 0,
    drops: new Float32Array(TUNING.MAX_ENEMIES * DROP_STRIDE),
    nDrops: 0,
    stamp: new Int32Array(TUNING.MAX_ENEMIES),
    stampId: 0,
    scratch: new Int32Array(TUNING.MAX_ENEMIES),
  };
}

/**
 * Apply damage to one enemy. Does NOT remove it — see `reap` below for why that is deferred.
 *
 * `base` is the weapon's number straight out of TUNING; both the permanent `damageMul` the upgrades
 * have built up and the temporary `boostMul` from Quad Damage are applied HERE rather than at each
 * call site, so a weapon added later cannot accidentally opt out of either by forgetting to multiply.
 *
 * Already-dead enemies are skipped rather than damaged again: within one tick the aura and a bolt
 * can both land on the same body, and without this the second hit would count a second kill.
 */
function hit(c: Combat, s: Swarm, i: number, base: number): void {
  const b = i * ENEMY_STRIDE;
  if (s.data[b + E_HP] <= 0) return;
  s.data[b + E_HP] -= base * c.damageMul * c.boostMul;
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
 *
 * Bloodlust heals from here rather than from a kill counter the caller reads afterwards, because
 * this is the only place that knows a *specific* enemy died — and capping at `maxHp` per kill rather
 * than once per tick is what keeps the heal honest when a Quad-Damage pulse kills thirty at once.
 */
function reap(c: Combat, p: Player, s: Swarm): void {
  const d = s.data;
  for (let i = 0; i < s.n; ) {
    const b = i * ENEMY_STRIDE;
    if (d[b + E_HP] > 0) {
      i++;
      continue;
    }
    const tier = d[b + E_TIER];
    const x = d[b + E_X];
    const z = d[b + E_Z];
    addDeath(c, x, z, tier);
    c.kills++;
    // The XP is not awarded here — it is queued as a drop, and only banked if the player walks over
    // the orb it becomes (DESIGN §8). Killing something at the far end of the arena earns nothing
    // until you go and get it.
    const db = c.nDrops++ * DROP_STRIDE;
    c.drops[db + DR_X] = x;
    c.drops[db + DR_Z] = z;
    c.drops[db + DR_VALUE] = TIERS[tier].xp;
    if (c.lifesteal > 0 && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + c.lifesteal);
    killEnemy(s, i);
  }
}

/**
 * One aura pulse: flat damage to everything inside the ring, no falloff (DESIGN §6.1), plus the
 * Concussion knockback once level 11 has set it.
 *
 * The knockback is added to VELOCITY rather than to position. A positional shove would push a front
 * rank straight through a prop — the same failure the swarm's separation push is clamped to avoid
 * (sim/swarm.ts step 4) — while an impulse is spent through the ordinary steering lerp, which means
 * obstacles and bounds still get their say on the way out.
 */
function pulseAura(c: Combat, p: Player, s: Swarm, g: Grid): void {
  c.auraFlare = 1;
  const d = s.data;
  const n = queryNeighbors(g, d, ENEMY_STRIDE, s.n, p.x, p.z, c.auraR, c.scratch);
  for (let k = 0; k < n; k++) {
    const e = c.scratch[k];
    hit(c, s, e, TUNING.AURA_DAMAGE);
    if (c.knockback <= 0) continue;
    const b = e * ENEMY_STRIDE;
    const dx = d[b + E_X] - p.x;
    const dz = d[b + E_Z] - p.z;
    // An enemy standing exactly on the player has no outward direction; leave it to separation.
    const len = Math.hypot(dx, dz);
    if (len <= 1e-4) continue;
    d[b + E_VX] += (dx / len) * c.knockback;
    d[b + E_VZ] += (dz / len) * c.knockback;
  }
}

/**
 * The Orbiter (level 9): spheres circling the player, damaging what they pass through.
 *
 * The damage is a **cadence**, not a contact test. A true contact test needs to remember which
 * enemies each sphere is currently inside, or it lands every tick and a single orbiter does 300 dps;
 * remembering it needs a per-enemy field, and the SoA's stride is a documented contract
 * (ARCHITECTURE §5.1) that a second weapon's bookkeeping does not get to widen. On a 5/s cadence the
 * sphere sweeps its arc between hits and everything it passed gets caught by the next one, which is
 * the same trade the aura already makes and nobody can see the difference.
 */
function stepOrbiters(c: Combat, p: Player, s: Swarm, g: Grid, dt: number): void {
  c.orbiterPhase = (c.orbiterPhase + TUNING.ORBITER_SPIN * dt) % (Math.PI * 2);
  c.orbiterTimer -= dt;
  if (c.orbiterTimer > 0) return;
  c.orbiterTimer += 1 / TUNING.ORBITER_RATE;
  if (c.orbiterTimer <= 0) c.orbiterTimer = 1 / TUNING.ORBITER_RATE;
  if (c.orbiters <= 0) return;

  for (let k = 0; k < c.orbiters; k++) {
    const a = c.orbiterPhase + (k / c.orbiters) * Math.PI * 2;
    const ox = p.x + Math.cos(a) * TUNING.ORBITER_R;
    const oz = p.z + Math.sin(a) * TUNING.ORBITER_R;
    const n = queryNeighbors(g, s.data, ENEMY_STRIDE, s.n, ox, oz, TUNING.ORBITER_HIT_R, c.scratch);
    for (let q = 0; q < n; q++) hit(c, s, c.scratch[q], TUNING.ORBITER_DAMAGE);
  }
}

/**
 * Fire one volley: `boltCount` bolts fanned symmetrically over ±BOLT_SPREAD about facing.
 *
 * A single bolt gets angle 0 rather than an edge of the fan, so Twin Lance (level 7) widens the
 * shot around where the player was already aiming instead of moving the shot they had learned.
 */
function fireBolt(c: Combat, p: Player): void {
  const count = c.boltCount * c.boltCountMul;
  for (let k = 0; k < count; k++) {
    if (c.nb >= TUNING.MAX_BOLTS) return;
    const spread = count > 1 ? (-1 + (2 * k) / (count - 1)) * TUNING.BOLT_SPREAD : 0;
    const a = p.facing + spread;
    const b = c.nb++ * BOLT_STRIDE;
    // facing is atan2(x, z) — 0 is +Z — so the heading is (sin, cos), not the usual (cos, sin).
    c.bolts[b + B_X] = p.x;
    c.bolts[b + B_Z] = p.z;
    c.bolts[b + B_VX] = Math.sin(a) * TUNING.BOLT_SPEED;
    c.bolts[b + B_VZ] = Math.cos(a) * TUNING.BOLT_SPEED;
    c.bolts[b + B_LIFE] = TUNING.BOLT_RANGE / TUNING.BOLT_SPEED;
    c.bolts[b + B_PIERCE] = c.boltPierce;
  }
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
        hit(c, s, e, TUNING.BOLT_DAMAGE);
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
  c.auraBurst = Math.max(0, c.auraBurst - dt / TUNING.AURA_BURST);
  // Last tick's drops were consumed by step 8. Clearing at the START rather than after the drain
  // means the queue is exactly "what died this tick" for anything that looks at it, including a
  // debugger stopped anywhere in the frame.
  c.nDrops = 0;

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
    c.boltTimer += c.boltInterval;
    if (c.boltTimer <= 0) c.boltTimer = c.boltInterval;
    if (alive && c.boltEnabled) fireBolt(c, p);
  }

  if (alive) stepOrbiters(c, p, s, g, dt);

  stepBolts(c, s, g, dt);
  reap(c, p, s);
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

  if (worst <= 0) return false;
  if (!damagePlayer(p, worst)) return false;
  c.lastContact = worst;
  return true;
}
