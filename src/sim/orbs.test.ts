// Orb tests: the magnet, the pickup, and the properties DESIGN §8 promises about a field of them.
//
// Same rules as the rest of sim/: no three, no WebGL, no mocks (ARCHITECTURE §2.1).

import { describe, expect, it } from 'vitest';
import { TUNING } from '../config';
import {
  createOrbs,
  latchAll,
  mergeOrbs,
  O_AGE,
  O_HOME,
  O_VALUE,
  O_X,
  O_Z,
  ORB_STRIDE,
  spawnOrb,
  stepOrbs,
} from './orbs';
import { createPlayer } from './player';

const DT = 1 / 60;

/** Run the field until every orb is banked or `limit` seconds pass. Returns seconds elapsed and XP. */
function drain(o: ReturnType<typeof createOrbs>, p: ReturnType<typeof createPlayer>, limit = 5) {
  let xp = 0;
  let t = 0;
  for (; t < limit && o.n > 0; t += DT) xp += stepOrbs(o, p, DT);
  return { t, xp };
}

describe('the magnet', () => {
  it('leaves an orb outside the radius exactly where it fell, forever', () => {
    // "Orbs never expire" is a mechanic, not an oversight (DESIGN §8): the field behind you is a
    // visible record of where you have been, and cashing it in is the comeback move. An orb that
    // decayed, drifted, or timed out would delete that.
    const o = createOrbs();
    const p = createPlayer();
    spawnOrb(o, 40, -25, 6);

    for (let t = 0; t < 120; t += DT) stepOrbs(o, p, DT); // two minutes of run time

    expect(o.n).toBe(1);
    expect(o.data[O_X]).toBe(40);
    expect(o.data[O_Z]).toBe(-25);
  });

  it('pulls in everything inside the radius and nothing outside it', () => {
    const o = createOrbs();
    const p = createPlayer();
    const r = o.magnetR;
    spawnOrb(o, r * 0.9, 0, 1); // in
    spawnOrb(o, 0, -r * 0.9, 1); // in
    spawnOrb(o, r * 1.4, 0, 1); // out

    const { xp } = drain(o, p, 3);

    expect(xp).toBe(2);
    expect(o.n).toBe(1);
    expect(o.data[O_X]).toBeCloseTo(r * 1.4, 6); // and the one left never moved
  });

  it('accelerates, so the pickup snaps instead of drifting', () => {
    // Time the two halves of the same journey. The speed is a function of position alone, so an orb
    // released at the rim covers the inner half under exactly the conditions an orb released at the
    // half-way point does — which makes these two numbers directly comparable, and makes "the pull
    // accelerates" a testable claim rather than a description of the formula.
    const p = createPlayer();
    const far = createOrbs();
    spawnOrb(far, far.magnetR * 0.99, 0, 1);
    const near = createOrbs();
    spawnOrb(near, near.magnetR * 0.5, 0, 1);

    const whole = drain(far, p).t;
    const inner = drain(near, p).t;
    const outer = whole - inner;

    expect(inner).toBeLessThan(outer * 0.75); // the second half takes well under the first
    expect(whole).toBeLessThan(0.5); // and the whole trip is a beat, not a journey
  });

  it('never overshoots the player, however fast the pull gets', () => {
    // At ORB_SPEED_MAX an orb covers half a unit per tick, which is more than the distance it has
    // left once it is close. The pickup test is against the STEP, not against a fixed radius — get
    // that wrong and a fast orb lands on the far side and comes back, orbiting the player.
    const o = createOrbs();
    const p = createPlayer();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      spawnOrb(o, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 1);
    }

    let crossed = 0;
    while (o.n > 0) {
      const before: number[] = [];
      for (let i = 0; i < o.n; i++) before.push(Math.hypot(o.data[i * ORB_STRIDE + O_X], o.data[i * ORB_STRIDE + O_Z]));
      stepOrbs(o, p, DT);
      for (let i = 0; i < o.n; i++) {
        const d = Math.hypot(o.data[i * ORB_STRIDE + O_X], o.data[i * ORB_STRIDE + O_Z]);
        if (d > Math.max(...before) + 1e-6) crossed++;
      }
    }
    expect(crossed).toBe(0);
  });

  it('reaches farther once level 10 has grown the radius', () => {
    const p = createPlayer();
    const base = createOrbs();
    const grown = createOrbs();
    grown.magnetR *= 1.5; // the level 10 unlock, applied by sim/progression.ts

    const at = TUNING.PICKUP_R * 1.3; // outside the base radius, inside the grown one
    spawnOrb(base, at, 0, 1);
    spawnOrb(grown, at, 0, 1);

    expect(drain(base, p, 2).xp).toBe(0);
    expect(drain(grown, p, 2).xp).toBe(1);
  });
});

describe('the latch', () => {
  it('keeps coming even when the player outruns the magnet', () => {
    // The bug this exists for: a few Move Speed picks and the character is faster than an orb at the
    // rim, so an orb that visibly started coming falls out of the radius and stops dead. Once an orb
    // has started, it arrives.
    const o = createOrbs();
    const p = createPlayer();
    p.speedMul = 1.6; // 11.2 u/s, comfortably faster than ORB_SPEED_MIN
    spawnOrb(o, 1.5, 0, 3);

    stepOrbs(o, p, DT);
    expect(o.data[O_HOME]).toBe(1); // latched on the first tick, inside the radius

    // Now run away from it, far past the magnet radius, for a second.
    let banked = 0;
    for (let t = 0; t < 1.4; t += DT) {
      p.x += TUNING.PLAYER_SPEED * p.speedMul * DT;
      banked += stepOrbs(o, p, DT);
    }
    expect(banked).toBe(3); // it caught up
    expect(o.n).toBe(0);
  });

  it('does not latch an orb the player never came near', () => {
    const o = createOrbs();
    const p = createPlayer();
    spawnOrb(o, 30, 0, 1);
    for (let t = 0; t < 1; t += DT) stepOrbs(o, p, DT);
    expect(o.data[O_HOME]).toBe(0);
    expect(o.data[O_X]).toBe(30);
  });

  it('brings in the whole map when the Magnet boost latches it', () => {
    // DESIGN §6.4. Implemented as "set the latch every orb already has" rather than as a temporary
    // infinite radius, so the pull, the acceleration and the arrival are the ones the player knows.
    const o = createOrbs();
    const p = createPlayer();
    let expected = 0;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r = 20 + (i % 7) * 8; // out to 68 units — most of the arena, none of it in range
      spawnOrb(o, Math.cos(a) * r, Math.sin(a) * r, 1 + (i % 4));
      expected += 1 + (i % 4);
    }
    stepOrbs(o, p, DT);
    expect(o.n).toBe(60); // nothing was in range on its own

    expect(latchAll(o)).toBe(60);
    let banked = 0;
    for (let t = 0; t < 12 && o.n > 0; t += DT) banked += stepOrbs(o, p, DT);
    expect(o.n).toBe(0);
    expect(banked).toBe(expected);
  });
});

describe('merging', () => {
  /** `count` orbs packed into one merge cell, already old enough to be eligible. */
  function stale(count: number, x = 40, z = 40) {
    const o = createOrbs();
    for (let i = 0; i < count; i++) {
      spawnOrb(o, x + (i % 3) * 0.4, z + ((i / 3) | 0) * 0.4, 1);
      o.data[i * ORB_STRIDE + O_AGE] = TUNING.ORB_MERGE_AGE + 1;
    }
    return o;
  }

  it('does nothing until the field is big enough to be a problem', () => {
    // Below ORB_MERGE_AT the scattered field IS the record of where you have been (DESIGN §8).
    // Merging early would delete the thing it exists for.
    const o = stale(TUNING.ORB_MERGE_AT - 1);
    const before = o.n;
    expect(mergeOrbs(o, 10)).toBe(0);
    expect(o.n).toBe(before);
  });

  it('consolidates a big old field without losing a single XP point', () => {
    const o = stale(TUNING.ORB_MERGE_AT + 40);
    const total = o.n; // every orb is worth 1
    expect(mergeOrbs(o, 10)).toBeGreaterThan(0);
    expect(o.n).toBeLessThan(total);

    let sum = 0;
    for (let i = 0; i < o.n; i++) sum += o.data[i * ORB_STRIDE + O_VALUE];
    expect(sum).toBe(total);
  });

  it('leaves fresh orbs and orbs already on their way alone', () => {
    const o = stale(TUNING.ORB_MERGE_AT + 20);
    // A young one and a latched one, both sitting in the same cell as the stale pile.
    const young = o.n;
    spawnOrb(o, 40, 40, 7);
    const latched = o.n;
    spawnOrb(o, 40.2, 40, 9);
    o.data[latched * ORB_STRIDE + O_AGE] = TUNING.ORB_MERGE_AGE + 5;
    o.data[latched * ORB_STRIDE + O_HOME] = 1;

    mergeOrbs(o, 10);

    // Both survive intact and at their own value. Merging the trail behind a player who is still
    // fighting would make orbs jump sideways in front of them.
    const values: number[] = [];
    for (let i = 0; i < o.n; i++) values.push(o.data[i * ORB_STRIDE + O_VALUE]);
    expect(values).toContain(7);
    expect(values).toContain(9);
    expect(young).toBeGreaterThan(0);
  });

  it('runs on its own clock, not once per tick', () => {
    const o = stale(TUNING.ORB_MERGE_AT + 40);
    // A single frame is nowhere near the 0.5 s cadence, so the first tick must do nothing.
    expect(mergeOrbs(o, DT)).toBe(0);
    for (let t = 0; t < 1 / TUNING.ORB_MERGE_HZ; t += DT) mergeOrbs(o, DT);
    expect(o.n).toBeLessThan(TUNING.ORB_MERGE_AT + 40);
  });

  it('leaves a merged orb collectable, at its combined value', () => {
    // One tight cluster inside the magnet radius, so the whole pile lands in a single merge cell and
    // becomes one big orb — which then has to be worth exactly what went into it when picked up.
    const o = createOrbs();
    const total = TUNING.ORB_MERGE_AT + 40;
    for (let i = 0; i < total; i++) {
      spawnOrb(o, 2 + ((i % 4) - 1.5) * 0.3, ((((i / 4) | 0) % 4) - 1.5) * 0.3, 1);
      o.data[i * ORB_STRIDE + O_AGE] = TUNING.ORB_MERGE_AGE + 1;
    }
    mergeOrbs(o, 10);
    expect(o.n).toBeLessThan(4);

    const p = createPlayer();
    let banked = 0;
    for (let t = 0; t < 4 && o.n > 0; t += DT) banked += stepOrbs(o, p, DT);
    expect(banked).toBe(total);
  });
});

describe('the field', () => {
  it('banks each orb exactly once, at its own value', () => {
    const o = createOrbs();
    const p = createPlayer();
    let expected = 0;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const value = 1 + (i % 6); // a mix of tiers
      spawnOrb(o, Math.cos(a) * 2, Math.sin(a) * 2, value);
      expected += value;
    }

    const { xp } = drain(o, p);

    expect(xp).toBe(expected);
    expect(o.n).toBe(0);
  });

  it('holds at MAX_ORBS rather than growing its buffer', () => {
    const o = createOrbs();
    for (let i = 0; i < TUNING.MAX_ORBS + 50; i++) {
      const ok = spawnOrb(o, (i % 100) - 50, 60, 1);
      expect(ok).toBe(i < TUNING.MAX_ORBS);
    }
    expect(o.n).toBe(TUNING.MAX_ORBS);
    expect(o.data.length).toBe(TUNING.MAX_ORBS * ORB_STRIDE);
  });

  it('keeps [0, n) intact when an orb in the middle is picked up', () => {
    // Swap-remove during the same walk that is iterating (ARCHITECTURE §5). If the loop advanced
    // past a collected slot, the orb moved down into it would be skipped this tick — and with a
    // whole field collapsing onto the player at once, skipped repeatedly.
    const o = createOrbs();
    const p = createPlayer();
    spawnOrb(o, 20, 0, 99); // far: must survive
    spawnOrb(o, 0.2, 0, 1); // on the player: banked immediately
    spawnOrb(o, 0.2, 0.1, 2); // also on the player — and it is the LAST slot, the one that moves

    const xp = stepOrbs(o, p, DT);

    expect(xp).toBe(3);
    expect(o.n).toBe(1);
    expect(o.data[O_VALUE]).toBe(99); // the survivor, not a stale copy of something collected
    expect(o.data[O_X]).toBe(20);
  });
});
