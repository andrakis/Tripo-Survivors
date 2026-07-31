// The COOL state tier (docs/ARCHITECTURE.md §3): everything React is allowed to see.
//
// Nothing per-frame goes in here. The sim pushes a snapshot at STORE_HZ (10 Hz) from the end of
// game.step(), and that is the only writer. A HP bar updating 10 times a second is indistinguishable
// from one updating 60 times, and it keeps the React tree essentially idle during play — the whole
// reason the game can spend its frame budget on 400 enemies instead of on reconciliation.
//
// The rationale in full is at the top of Breach/src/store.ts, which this mirrors.

import { create } from 'zustand';

export interface UiState {
  hp: number;
  maxHp: number;
  /** Run clock in seconds. */
  time: number;
  kills: number;
  /** XP banked toward the next level, and what that level costs. Together they are the HUD bar. */
  xp: number;
  xpNeed: number;
  /** Every XP point banked this run — the game-over card's score line, not the bar. */
  totalXp: number;
  level: number;
  /**
   * Run time of the last level-up, or -1, and the unlock it granted. Same pattern as `lastHitAt`:
   * the toast is keyed on the VALUE, so two level-ups in quick succession play two animations
   * instead of the second one landing invisibly inside the first one's fade.
   */
  lastLevelAt: number;
  unlock: string;
  dead: boolean;
  /**
   * Run time at which the player last took a hit. The HUD keys its vignette off this VALUE rather
   * than off a boolean, so two hits in quick succession restart the flash instead of merging into
   * one — DESIGN §12 rule 4 is that damage is never missable.
   */
  lastHitAt: number;
  /** Increments on each reset, so the game-over card and any run-scoped UI remount cleanly. */
  runId: number;
}

export interface UiStore extends UiState {
  sync: (s: UiState) => void;
}

const EMPTY: UiState = {
  hp: 0,
  maxHp: 0,
  time: 0,
  kills: 0,
  xp: 0,
  xpNeed: 5,
  totalXp: 0,
  level: 1,
  lastLevelAt: -1,
  unlock: '',
  dead: false,
  lastHitAt: -1,
  runId: 0,
};

export const useUi = create<UiStore>((set) => ({
  ...EMPTY,
  sync: (s) => set(s),
}));
