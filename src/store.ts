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
  xp: number;
  /** Fixed at 1 until M4's progression.ts drives it. The game-over card already reads it. */
  level: number;
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
  level: 1,
  dead: false,
  lastHitAt: -1,
  runId: 0,
};

export const useUi = create<UiStore>((set) => ({
  ...EMPTY,
  sync: (s) => set(s),
}));
