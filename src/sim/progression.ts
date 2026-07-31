// Progression: the XP curve, and the ordered unlock table from docs/DESIGN.md §6.3.
//
// There is no card draft and no choice (DESIGN §11) — level-ups apply a fixed table, in order. That
// is a deliberate design decision and it is also what makes this file three dozen lines: a run's
// build is a function of its level and nothing else, so nothing here needs a random source, a
// pause, or a modal.
//
// **Unlocks are writes to live fields, never to TUNING.** `combat.auraR`, `combat.boltInterval`,
// `player.speedMul` and `orbs.magnetR` all exist so that the level-1 baseline in config.ts stays a
// readable balance table rather than becoming mutable global state. A restart therefore undoes every
// modifier by replacing those three objects (see game.ts `resetGame`), with nothing to unwind.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { TUNING } from '../config';
import type { Combat } from './combat';
import type { Orbs } from './orbs';
import type { Player } from './player';

/** Everything an unlock is allowed to modify. Typed as the three sim objects rather than as `Game`,
 *  which would make this module import the spine that imports it. */
export interface Loadout {
  player: Player;
  combat: Combat;
  orbs: Orbs;
}

export interface Unlock {
  /** What the level-up toast says. Short — it is read at a glance during a fight, not studied. */
  label: string;
  apply: (l: Loadout) => void;
}

/**
 * DESIGN §6.3, in order, starting at LEVEL 2. Index `i` is the unlock granted on reaching level
 * `i + 2`. Odd levels add capability, even levels add numbers, so no two consecutive levels feel the
 * same — which is the whole reason the table is hand-ordered rather than generated.
 */
export const UNLOCKS: Unlock[] = [
  { label: 'Aura radius +1.0', apply: (l) => void (l.combat.auraR += 1.0) }, //          2
  { label: 'NEW — Lance', apply: (l) => void (l.combat.boltEnabled = true) }, //         3
  { label: 'Damage +25%', apply: (l) => void (l.combat.damageMul *= 1.25) }, //          4
  { label: 'NEW — Pierce +2', apply: (l) => void (l.combat.boltPierce += 2) }, //        5
  { label: 'Fire rate +20%', apply: (l) => void (l.combat.boltInterval /= 1.2) }, //     6
  { label: 'NEW — Twin Lance', apply: (l) => void (l.combat.boltCount += 1) }, //        7
  { label: 'Move speed +10%', apply: (l) => void (l.player.speedMul *= 1.1) }, //        8
  { label: 'NEW — Orbiter', apply: (l) => void (l.combat.orbiters += 1) }, //            9
  { label: 'Magnet radius +50%', apply: (l) => void (l.orbs.magnetR *= 1.5) }, //       10
  { label: 'NEW — Concussion', apply: (l) => void (l.combat.knockback = TUNING.KNOCKBACK) }, // 11
  {
    label: 'Max HP +25', //                                                             12
    apply: (l) => {
      l.player.maxHp += 25;
      l.player.hp = l.player.maxHp; // "and heal to full" — the table's one moment of relief
    },
  },
];

/**
 * Level 13 and up: a repeating four-step cycle at +10% each, so a long run keeps paying out without
 * the table having to be infinite. The cycle deliberately excludes the "NEW" mechanics — a second
 * Orbiter every four levels would eventually out-damage both weapons and turn the endgame into a
 * passive.
 */
const LATE: Unlock[] = [
  { label: 'Damage +10%', apply: (l) => void (l.combat.damageMul *= TUNING.LATE_STEP) },
  { label: 'Fire rate +10%', apply: (l) => void (l.combat.boltInterval /= TUNING.LATE_STEP) },
  { label: 'Aura radius +10%', apply: (l) => void (l.combat.auraR *= TUNING.LATE_STEP) },
  { label: 'Move speed +10%', apply: (l) => void (l.player.speedMul *= TUNING.LATE_STEP) },
];

/** The unlock granted on reaching `level`. Defined for every level >= 2, forever. */
export function unlockFor(level: number): Unlock {
  const i = level - 2;
  return i < UNLOCKS.length ? UNLOCKS[i] : LATE[(i - UNLOCKS.length) % LATE.length];
}

/** DESIGN §8: xpToNext(level) = ceil(5 * level^1.45). Level 1 needs 5, level 12 needs 191. */
export function xpToNext(level: number): number {
  return Math.ceil(TUNING.XP_BASE * level ** TUNING.XP_EXP);
}

export interface Progression {
  level: number;
  /** XP banked toward the NEXT level. Resets on each level-up — the HUD bar reads it directly. */
  xp: number;
  /** xpToNext(level), cached so neither the HUD nor the step loop recomputes a pow every frame. */
  need: number;
  /** Every XP point ever banked this run. The score line on the game-over card. */
  totalXp: number;
  /** Run time of the last level-up, or -1. The toast keys on this VALUE, so two level-ups in quick
   *  succession play two animations instead of merging into one — same reasoning as `lastHitAt`. */
  lastLevelAt: number;
  /** The most recent unlock's label, for that toast. */
  lastUnlock: string;
  /** Decaying 0..1 screen-shake amplitude. Renderer-only; scene/CameraRig.tsx is the only reader. */
  shake: number;
}

export function createProgression(): Progression {
  return {
    level: 1,
    xp: 0,
    need: xpToNext(1),
    totalXp: 0,
    lastLevelAt: -1,
    lastUnlock: '',
    shake: 0,
  };
}

/**
 * Tick step 10. `gained` is the XP orbs banked this tick (step 9).
 *
 * The level-up is a `while`, not an `if`: one Elite orb is worth 40 XP, which is more than three
 * early levels, and a player who walks into a pile of saved orbs is entitled to every level in it.
 * Each pass through applies its own unlock, so nothing is skipped when several land at once — only
 * the toast collapses, showing the last one.
 */
export function stepProgression(
  pr: Progression,
  l: Loadout,
  gained: number,
  time: number,
  dt: number,
): boolean {
  pr.shake = Math.max(0, pr.shake - dt / TUNING.SHAKE_TIME);
  if (gained <= 0) return false;

  pr.xp += gained;
  pr.totalXp += gained;
  if (pr.xp < pr.need) return false;

  while (pr.xp >= pr.need) {
    pr.xp -= pr.need;
    pr.level++;
    const unlock = unlockFor(pr.level);
    unlock.apply(l);
    pr.need = xpToNext(pr.level);
    pr.lastUnlock = unlock.label;
  }

  pr.lastLevelAt = time;
  pr.shake = 1;
  // Flare the aura on the same frame. It is the one weapon that is always on screen and always
  // silent, so it is the cheapest place to say "something just changed about your character" in the
  // world rather than in the HUD — and it costs one assignment (DESIGN §12 rule 4, inverted).
  l.combat.auraFlare = 1;
  return true;
}
