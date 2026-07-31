// Player + input tests. Neither module imports three (ARCHITECTURE §2.1), so this runs in plain
// node with no WebGL, no canvas and no mocks — which is the entire reason for that rule.

import { describe, expect, it } from 'vitest';
import { TUNING, HALF_X } from '../config';
import { canDash, createPlayer, damagePlayer, isAlive, stepPlayer } from './player';
import { OBSTACLES, overlapsObstacle, resolveObstacles } from './world';
import { attachKeyboard, resetInput, sampleInput, setTouchVector } from '../input';

const DT = 1 / 60;

/** Run the player for `seconds` on a constant input, at the real tick rate. */
function drive(ix: number, iz: number, seconds: number, from?: { x: number; z: number }) {
  const p = createPlayer();
  if (from) {
    p.x = from.x;
    p.z = from.z;
  }
  for (let t = 0; t < seconds; t += DT) stepPlayer(p, ix, iz, DT);
  return p;
}

/** A lane clear of every prop, for tests that want movement without a collision in the way. */
const OPEN_LANE = { x: -HALF_X + 1, z: -80 };

describe('player movement', () => {
  it('approaches exactly PLAYER_SPEED and does not exceed it', () => {
    const p = drive(0, -1, 2);
    expect(Math.hypot(p.vx, p.vz)).toBeCloseTo(TUNING.PLAYER_SPEED, 3);
  });

  it('is framerate-independent: a 20 Hz tick lands where a 60 Hz tick does', () => {
    const fast = drive(1, 0, 1, OPEN_LANE);
    const slow = createPlayer();
    slow.x = OPEN_LANE.x;
    slow.z = OPEN_LANE.z;
    for (let t = 0; t < 1; t += 0.05) stepPlayer(slow, 1, 0, 0.05);

    // Only Euler integration error across the one-second acceleration ramp remains — under 2%. A
    // raw lerp(a, b, k) instead of 1 - exp(-k*dt) diverges by a factor of three on the same pair.
    const travelled = fast.x - OPEN_LANE.x;
    expect(Math.abs(slow.x - fast.x) / travelled).toBeLessThan(0.02);
  });

  it('does not travel faster on a normalised diagonal than on a cardinal', () => {
    const straight = drive(0, -1, 3);
    const d = Math.SQRT1_2;
    const diagonal = drive(d, -d, 3);
    const straightDist = Math.hypot(straight.x, straight.z);
    const diagonalDist = Math.hypot(diagonal.x, diagonal.z);
    expect(diagonalDist).toBeCloseTo(straightDist, 2);
  });

  it('honours partial deflection — a half-pushed thumbstick moves at half speed', () => {
    const full = drive(1, 0, 2);
    const half = drive(0.5, 0, 2);
    expect(half.vx).toBeCloseTo(full.vx / 2, 3);
  });
});

describe('player bounds and obstacles', () => {
  it('clamps at the world edge instead of leaving the arena', () => {
    // Down a prop-free lane, and long enough to cross the whole 256-unit world twice over — so a
    // clamp that leaked even slightly per tick would be obvious.
    const p = drive(1, 0, 80, OPEN_LANE);
    expect(p.x).toBeCloseTo(HALF_X - TUNING.PLAYER_R, 4);
  });

  it('is stopped by a prop rather than passing through it', () => {
    // Straight east out of the arena centre runs into the East Wall's west face, and stops there.
    const wall = OBSTACLES[3];
    const p = drive(1, 0, 40);
    expect(p.x).toBeCloseTo(wall.x - wall.hx - TUNING.PLAYER_R, 4);
  });

  it('never ends a tick inside a prop, from any approach angle', () => {
    const keep = OBSTACLES[0];
    for (let a = 0; a < 16; a++) {
      const th = (a / 16) * Math.PI * 2;
      const p = createPlayer();
      // Start well outside the Keep and walk straight into its centre.
      p.x = keep.x + Math.cos(th) * 20;
      p.z = keep.z + Math.sin(th) * 20;
      for (let t = 0; t < 6; t += DT) {
        stepPlayer(p, -Math.cos(th), -Math.sin(th), DT);
        expect(overlapsObstacle(p.x, p.z, TUNING.PLAYER_R - 1e-6)).toBe(false);
      }
    }
  });

  it('resolves on the axis of least penetration, preserving motion along a wall', () => {
    const wall = OBSTACLES[3]; // East Wall: hx 2.0, hz 20.0 — long on Z
    // Pressed into its west face, well away from the ends.
    const out = { x: 0, z: 0, dash: false };
    resolveObstacles(out, wall.x - wall.hx + 0.2, wall.z, 0.6);
    expect(out.x).toBeCloseTo(wall.x - wall.hx - 0.6, 6);
    expect(out.z).toBe(wall.z); // the tangential component is untouched — no sticking
  });
});

describe('facing', () => {
  it('is the input heading, with 0 pointing at +Z', () => {
    const p = createPlayer();
    stepPlayer(p, 0, 1, DT);
    expect(p.facing).toBeCloseTo(0, 6);
    stepPlayer(p, 1, 0, DT);
    expect(p.facing).toBeCloseTo(Math.PI / 2, 6);
  });

  it('holds its last heading when the input goes to zero', () => {
    const p = createPlayer();
    stepPlayer(p, 1, 0, DT);
    const aimed = p.facing;
    for (let t = 0; t < 1; t += DT) stepPlayer(p, 0, 0, DT);
    expect(p.facing).toBe(aimed);
  });
});

describe('damage and i-frames', () => {
  it('gates a second hit inside the i-frame window, then allows one after', () => {
    const p = createPlayer();
    expect(damagePlayer(p, 10)).toBe(true);
    expect(damagePlayer(p, 10)).toBe(false);
    expect(p.hp).toBe(TUNING.PLAYER_HP - 10);

    for (let t = 0; t <= TUNING.PLAYER_IFRAMES; t += DT) stepPlayer(p, 0, 0, DT);
    expect(damagePlayer(p, 10)).toBe(true);
    expect(p.hp).toBe(TUNING.PLAYER_HP - 20);
  });

  it('floors HP at zero and stops accepting hits once dead', () => {
    const p = createPlayer();
    damagePlayer(p, 999);
    expect(p.hp).toBe(0);
    expect(isAlive(p)).toBe(false);
    p.iframe = 0;
    expect(damagePlayer(p, 1)).toBe(false);
  });
});

/** A stand-in for `window` — the keyboard producer only ever uses EventTarget's three methods. */
function fakeWindow() {
  const target = new EventTarget();
  return {
    target: target as unknown as Window,
    press: (code: string) => {
      const e = new Event('keydown', { cancelable: true }) as Event & { code: string };
      e.code = code;
      target.dispatchEvent(e);
    },
    /** A key-repeat keydown — what the OS delivers while a key is held down. */
    repeat: (code: string) => {
      const e = new Event('keydown') as Event & { code: string; repeat: boolean };
      e.code = code;
      e.repeat = true;
      target.dispatchEvent(e);
    },
    release: (code: string) => {
      const e = new Event('keyup') as Event & { code: string };
      e.code = code;
      target.dispatchEvent(e);
    },
    blur: () => target.dispatchEvent(new Event('blur')),
  };
}

describe('the dash', () => {
  /** Hold `(ix, iz)` for `seconds`, pressing dash on the first tick only — dash is an edge. */
  function dashDrive(ix: number, iz: number, seconds: number) {
    const p = createPlayer();
    p.x = OPEN_LANE.x + 40; // open ground, well clear of the world edge in every direction
    p.z = OPEN_LANE.z;
    let first = true;
    for (let t = 0; t < seconds; t += DT) {
      stepPlayer(p, ix, iz, DT, first);
      first = false;
    }
    return p;
  }

  it('covers far more ground than walking, in the time it lasts', () => {
    const walked = createPlayer();
    walked.x = OPEN_LANE.x + 40;
    walked.z = OPEN_LANE.z;
    const start = walked.x;
    for (let t = 0; t < TUNING.DASH_TIME; t += DT) stepPlayer(walked, 1, 0, DT);

    const dashed = dashDrive(1, 0, TUNING.DASH_TIME);
    expect(dashed.x - (OPEN_LANE.x + 40)).toBeGreaterThan((walked.x - start) * 2);
  });

  it('goes where the input points, and along facing from a standstill', () => {
    const moving = dashDrive(0, -1, TUNING.DASH_TIME);
    expect(moving.z).toBeLessThan(OPEN_LANE.z - 3);

    // No input: the dash has to go where the character is pointing, which is the only direction the
    // player can see. Facing +X here, so the dash must be +X.
    const still = createPlayer();
    still.x = OPEN_LANE.x + 40;
    still.z = OPEN_LANE.z;
    still.facing = Math.PI / 2;
    for (let t = 0; t < TUNING.DASH_TIME; t += DT) stepPlayer(still, 0, 0, DT, t === 0);
    expect(still.x).toBeGreaterThan(OPEN_LANE.x + 42);
  });

  it('grants i-frames that outlast the movement', () => {
    // The dash is an escape. One that drops you into contact damage on the frame it ends is a trap,
    // so DASH_IFRAMES is deliberately longer than DASH_TIME.
    const p = dashDrive(1, 0, TUNING.DASH_TIME);
    expect(p.dashTimer).toBe(0);
    expect(p.iframe).toBeGreaterThan(0);
    expect(damagePlayer(p, 10)).toBe(false);
  });

  it('is on a cooldown a held button cannot beat', () => {
    // Dash on EVERY tick for two seconds. The cooldown is 2.2 s, so exactly one dash may happen.
    const p = createPlayer();
    p.x = OPEN_LANE.x + 40;
    p.z = OPEN_LANE.z;
    const start = p.x;
    let dashes = 0;
    let wasDashing = false;
    for (let t = 0; t < 2; t += DT) {
      stepPlayer(p, 1, 0, DT, true);
      if (p.dashTimer > 0 && !wasDashing) dashes++;
      wasDashing = p.dashTimer > 0;
    }
    expect(dashes).toBe(1);
    expect(canDash(p)).toBe(false);
    // ...and it did not teleport across the arena: one dash plus two seconds of walking.
    expect(p.x - start).toBeLessThan(TUNING.PLAYER_SPEED * 2 + TUNING.DASH_SPEED * TUNING.DASH_TIME + 1);
  });

  it('comes back after the cooldown, and a shorter cooldown comes back sooner', () => {
    const p = createPlayer();
    stepPlayer(p, 1, 0, DT, true);
    expect(canDash(p)).toBe(false);
    for (let t = 0; t < p.dashCdMax + DT; t += DT) stepPlayer(p, 0, 0, DT);
    expect(canDash(p)).toBe(true);

    // The upgrade path: dashCdMax is a live field (sim/progression.ts), so shortening it is the
    // whole implementation of "Dash cooldown -20%".
    const quick = createPlayer();
    quick.dashCdMax *= 0.8;
    stepPlayer(quick, 1, 0, DT, true);
    expect(quick.dashCd).toBeCloseTo(TUNING.DASH_COOLDOWN * 0.8, 6);
  });

  it('is stopped by props and bounds like any other movement', () => {
    // The dash writes velocity directly, bypassing the input lerp — so this is the check that it
    // still goes through resolveObstacles and clampToWorld rather than around them.
    const p = createPlayer();
    p.x = HALF_X - TUNING.PLAYER_R - 0.5;
    p.z = 0;
    for (let t = 0; t < TUNING.DASH_TIME * 2; t += DT) stepPlayer(p, 1, 0, DT, t === 0);
    expect(p.x).toBeLessThanOrEqual(HALF_X - TUNING.PLAYER_R + 1e-6);
  });
});

describe('the Invincible boost', () => {
  it('refuses damage outright, and stops when it runs out', () => {
    const p = createPlayer();
    p.invincible = 0.5;
    expect(damagePlayer(p, 30)).toBe(false);
    expect(p.hp).toBe(TUNING.PLAYER_HP);
    // ...and unlike an i-frame, taking a swing at it does not start a new window.
    expect(p.iframe).toBe(0);

    for (let t = 0; t < 0.55; t += DT) stepPlayer(p, 0, 0, DT);
    expect(p.invincible).toBe(0);
    expect(damagePlayer(p, 30)).toBe(true);
  });
});

describe('input', () => {
  it('normalises a diagonal so it is not 1.41x faster than a cardinal', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    w.press('KeyW');
    w.press('KeyD');
    sampleInput(out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1, 6);

    detach();
  });

  it('cancels opposing keys to a dead stop', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    w.press('KeyA');
    w.press('KeyD');
    sampleInput(out);
    expect(out).toEqual({ x: 0, z: 0, dash: false });

    detach();
  });

  it('treats arrows and WASD as the same producer', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const wasd = { x: 0, z: 0, dash: false };
    const arrows = { x: 0, z: 0, dash: false };

    w.press('KeyW');
    sampleInput(wasd);
    w.release('KeyW');
    w.press('ArrowUp');
    sampleInput(arrows);

    expect(arrows).toEqual(wasd);
    expect(wasd.z).toBe(-1); // screen-up is -Z
    detach();
  });

  it('drops every held key on blur, so alt-tab does not leave the player running', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    w.press('KeyW');
    w.blur();
    sampleInput(out);
    expect(out).toEqual({ x: 0, z: 0, dash: false });

    detach();
  });

  it('reports a dash on exactly ONE tick per press', () => {
    // The producer consumes the press. A held key that re-fired every tick would spend the dash the
    // instant its cooldown expired, making "hold space" strictly better than tapping it.
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    w.press('Space');
    sampleInput(out);
    expect(out.dash).toBe(true);
    sampleInput(out);
    expect(out.dash).toBe(false);

    detach();
    resetInput();
  });

  it('ignores OS key-repeat, and forgets a queued dash on blur', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    w.repeat('Space');
    sampleInput(out);
    expect(out.dash).toBe(false);

    w.press('Space');
    w.blur();
    sampleInput(out);
    expect(out.dash).toBe(false);

    detach();
    resetInput();
  });

  it('falls through to the thumbstick only while no key is held', () => {
    resetInput();
    const w = fakeWindow();
    const detach = attachKeyboard(w.target);
    const out = { x: 0, z: 0, dash: false };

    setTouchVector(0.5, -0.5);
    sampleInput(out);
    expect(out).toEqual({ x: 0.5, z: -0.5, dash: false });

    w.press('KeyD');
    sampleInput(out);
    expect(out).toEqual({ x: 1, z: 0, dash: false });

    detach();
    resetInput();
  });
});
