// Progression: the XP curve, the weapon unlocks, and the upgrade the PLAYER picks at every other
// level (docs/DESIGN.md §6.3).
//
// A level-up is one of two things, and which one is decided by the level number:
//
//   - **Odd levels 3–11 grant a weapon**, automatically and in a fixed order. These are the
//     capability unlocks — the Lance, Pierce, Twin Lance, the Orbiter, Concussion — and they are the
//     spine of the run's power curve. They arrive as news, with a toast, and the game does not stop.
//   - **Every other level offers a CHOICE** of OFFER_COUNT stat upgrades, and the run pauses until
//     one is taken. This is the only pause in the game, and it is the only screen with a decision on
//     it.
//
// The split is deliberate and it is what "we'll tie weapon unlocks into this later" leaves room for:
// the pool below is a list of `Upgrade` values, the auto table is a list of the same type, and
// merging them is deleting one branch in `stepProgression`.
//
// **Upgrades write live fields, never TUNING.** `combat.auraR`, `combat.boltInterval`,
// `player.speedMul`, `player.dashCdMax` and `orbs.magnetR` all exist so the level-1 baseline in
// config.ts stays a readable balance table rather than becoming mutable global state. A restart
// therefore undoes every modifier by replacing three objects (game.ts `resetGame`), with nothing to
// unwind.
//
// No THREE import (docs/ARCHITECTURE.md §2.1).

import { TUNING } from '../config';
import type { Combat } from './combat';
import type { Orbs } from './orbs';
import type { Player } from './player';

/** Everything an upgrade is allowed to modify. Typed as the three sim objects rather than as `Game`,
 *  which would make this module import the spine that imports it. */
export interface Loadout {
  player: Player;
  combat: Combat;
  orbs: Orbs;
}

export interface Upgrade {
  /** Stable id. The store carries this to the UI, and a test names an upgrade by it. */
  id: string;
  /** What the card's heading says. */
  label: string;
  /** One line under it. The player is reading this mid-run with a crowd on screen. */
  detail: string;
  apply: (l: Loadout) => void;
  /** Offered only when this returns true. Absent means always. */
  available?: (l: Loadout) => boolean;
}

/**
 * The weapon unlocks, by the level that grants them. DESIGN §6.3's odd rows.
 *
 * Automatic, in order, and unchoosable on purpose: they are what makes level 3 feel different from
 * level 4 in every run, and a player who could decline the Lance would have a run with no Lance.
 */
export const AUTO_UNLOCKS: Record<number, Upgrade> = {
  3: {
    id: 'lance',
    label: 'NEW — Lance',
    detail: 'a bolt fires along your facing',
    apply: (l) => void (l.combat.boltEnabled = true),
  },
  5: {
    id: 'pierce',
    label: 'NEW — Pierce',
    detail: 'bolts pass through 2 more enemies',
    apply: (l) => void (l.combat.boltPierce += 2),
  },
  7: {
    id: 'twin',
    label: 'NEW — Twin Lance',
    detail: 'a second bolt at ±12°',
    apply: (l) => void (l.combat.boltCount += 1),
  },
  9: {
    id: 'orbiter',
    label: 'NEW — Orbiter',
    detail: 'a sphere circles you, damaging on contact',
    apply: (l) => void (l.combat.orbiters += 1),
  },
  11: {
    id: 'concussion',
    label: 'NEW — Concussion',
    detail: 'aura pulses knock enemies back',
    apply: (l) => void (l.combat.knockback = TUNING.KNOCKBACK),
  },
};

/**
 * The choice pool. Every entry is repeatable — there is no "taken" state to track and no way to
 * exhaust the pool, so a level 40 run still has three real cards to read.
 *
 * All of them are multiplicative or additive on a live field, which is what makes stacking them
 * safe: two Damage picks are ×1.25 twice, not a special case.
 */
export const UPGRADES: Upgrade[] = [
  {
    id: 'aura',
    label: 'Aura radius +1.0',
    detail: 'the ring reaches further',
    apply: (l) => void (l.combat.auraR += 1.0),
  },
  {
    id: 'damage',
    label: 'Damage +25%',
    detail: 'all sources',
    apply: (l) => void (l.combat.damageMul *= 1.25),
  },
  {
    id: 'rate',
    label: 'Fire rate +20%',
    detail: 'the Lance fires more often',
    apply: (l) => void (l.combat.boltInterval /= 1.2),
    // Offering this before level 3 would be a dead card — the Lance is not firing at any rate yet.
    available: (l) => l.combat.boltEnabled,
  },
  {
    id: 'speed',
    label: 'Move speed +10%',
    detail: 'outrun more of the crowd',
    apply: (l) => void (l.player.speedMul *= 1.1),
  },
  {
    id: 'hp',
    label: 'Max HP +25',
    detail: 'and heal to full',
    apply: (l) => {
      l.player.maxHp += 25;
      l.player.hp = l.player.maxHp;
    },
  },
  {
    id: 'magnet',
    label: 'Magnet radius +50%',
    detail: 'orbs come from further out',
    apply: (l) => void (l.orbs.magnetR *= 1.5),
  },
  {
    id: 'dash',
    label: 'Dash cooldown −20%',
    detail: 'escape more often',
    apply: (l) => void (l.player.dashCdMax *= 0.8),
  },
];

/** DESIGN §8: xpToNext(level) = ceil(5 * level^1.45). Level 1 needs 5, level 12 needs 184. */
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
   *  succession play two animations instead of the second landing inside the first one's fade. */
  lastLevelAt: number;
  /** The most recent unlock or upgrade's label, for that toast. */
  lastUnlock: string;
  /** Decaying 0..1 screen-shake amplitude. Renderer-only; scene/CameraRig.tsx is the only reader. */
  shake: number;
  /**
   * The upgrades on offer, or null. **Non-null means the run is paused** — `stepGame` short-circuits
   * on it exactly as it does on death, so nothing moves behind the card while the player reads three
   * sentences with a crowd on screen.
   */
  offer: Upgrade[] | null;
  /** LCG state for rolling offers. Owned here so a scripted run is reproducible. */
  rng: number;
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
    offer: null,
    rng: (Math.random() * 0xffffffff) >>> 0,
  };
}

function rand(pr: Progression): number {
  pr.rng = (pr.rng * 1664525 + 1013904223) >>> 0;
  return pr.rng / 4294967296;
}

/** True while a choice is outstanding. The one thing that pauses a run other than dying. */
export function isPaused(pr: Progression): boolean {
  return pr.offer !== null;
}

/**
 * Roll OFFER_COUNT distinct available upgrades.
 *
 * Partial Fisher-Yates over a scratch list of indices: distinct without a "have I already picked
 * this" scan, and uniform, which a reject-and-retry loop over a pool with unavailable entries is not.
 * If fewer than OFFER_COUNT are available (only possible very early, before the Lance) the offer is
 * simply shorter — a padded-out third card would have to repeat one of the other two.
 */
export function rollOffer(pr: Progression, l: Loadout): Upgrade[] {
  const pool: Upgrade[] = [];
  for (const u of UPGRADES) if (!u.available || u.available(l)) pool.push(u);

  const want = Math.min(TUNING.OFFER_COUNT, pool.length);
  for (let i = 0; i < want; i++) {
    const j = i + Math.floor(rand(pr) * (pool.length - i));
    const t = pool[i];
    pool[i] = pool[j];
    pool[j] = t;
  }
  return pool.slice(0, want);
}

/** Toast + shake + aura flare, the three halves of "something just changed about your character". */
function announce(pr: Progression, l: Loadout, label: string, time: number): void {
  pr.lastUnlock = label;
  pr.lastLevelAt = time;
  pr.shake = 1;
  // The aura is the one weapon that is always on screen and always silent, so it is the cheapest
  // place to say this in the world rather than in the HUD (DESIGN §12 rule 4, inverted).
  l.combat.auraFlare = 1;
}

/**
 * Tick step 10. `gained` is the XP orbs banked this tick (step 9).
 *
 * The level-up is a `while`, not an `if`: one Elite orb is worth 40 XP, which is more than three
 * early levels, and a player who walks into a pile of saved orbs is entitled to every level in it.
 * The loop STOPS the moment a level needs a choice, though — the remaining levels stay banked in
 * `xp` and resolve after `chooseUpgrade`, so no unlock is ever skipped and no choice is ever
 * silently made for the player.
 *
 * Returns true if anything happened, so the caller can force a store push.
 */
export function stepProgression(
  pr: Progression,
  l: Loadout,
  gained: number,
  time: number,
  dt: number,
): boolean {
  pr.shake = Math.max(0, pr.shake - dt / TUNING.SHAKE_TIME);
  if (gained > 0) {
    pr.xp += gained;
    pr.totalXp += gained;
  }
  return resolveLevels(pr, l, time);
}

function resolveLevels(pr: Progression, l: Loadout, time: number): boolean {
  let any = false;
  while (pr.offer === null && pr.xp >= pr.need) {
    pr.xp -= pr.need;
    pr.level++;
    pr.need = xpToNext(pr.level);
    any = true;

    const auto = AUTO_UNLOCKS[pr.level];
    if (auto) {
      auto.apply(l);
      announce(pr, l, auto.label, time);
      continue;
    }

    const offer = rollOffer(pr, l);
    // An empty offer would be a DEADLOCK, not a missing feature: `isPaused` is `offer !== null`, so
    // a zero-length offer freezes the sim while ui/LevelUpChoice.tsx renders nothing to click. It
    // cannot happen with today's pool (every entry but Fire rate is unconditional), but the failure
    // is unrecoverable and silent, and the guard is one line.
    if (offer.length === 0) {
      announce(pr, l, 'Level up', time);
      continue;
    }
    pr.offer = offer; // pauses the run until chooseUpgrade clears it
  }
  return any;
}

/**
 * Take the `index`-th card. Applies it, clears the pause, and then resolves any levels that were
 * banked behind the choice — which may immediately raise the next offer.
 *
 * Out-of-range indices are ignored rather than clamped: this is called straight from a keypress and
 * from a click, and silently applying card 1 because someone hit `4` is worse than doing nothing.
 */
export function chooseUpgrade(pr: Progression, l: Loadout, index: number, time: number): boolean {
  const offer = pr.offer;
  if (!offer || index < 0 || index >= offer.length) return false;
  const picked = offer[index];
  pr.offer = null;
  picked.apply(l);
  announce(pr, l, picked.label, time);
  resolveLevels(pr, l, time);
  return true;
}
