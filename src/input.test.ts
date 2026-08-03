// Camera-relative movement (src/input.ts `setInputBasisYaw`).
//
// This is the coupling that makes the orbit camera playable rather than merely available, and it is
// worth testing precisely because the bug it prevents is not a crash — it is a game whose controls
// feel inverted from certain angles, which a player reports as "the movement is wrong" and which
// takes a while to trace back to a sign in a rotation matrix.

import { beforeEach, describe, expect, it } from 'vitest';
import { resetInput, sampleInput, setInputBasisYaw, setTouchVector, type InputVector } from './input';

const out: InputVector = { x: 0, z: 0, dash: false };

function sampleWith(yaw: number, stickX: number, stickZ: number): InputVector {
  setInputBasisYaw(yaw);
  setTouchVector(stickX, stickZ);
  sampleInput(out);
  return out;
}

beforeEach(resetInput);

describe('screen space becomes world space', () => {
  it('is the identity under the fixed camera', () => {
    // Follow mode must be bit-for-bit what it was before orbit mode existed — the game is balanced
    // against it, and "the default camera changed slightly" is the least acceptable regression here.
    const v = sampleWith(0, 0.6, -0.8);
    expect(v.x).toBe(0.6);
    expect(v.z).toBe(-0.8);
  });

  it('sends screen-up away from the camera at every angle', () => {
    // The rule in one sentence: whatever the camera yaw, holding "up" walks the player away from
    // the camera. With the camera at yaw θ its offset direction is (sin θ, cos θ), so away-from-it
    // is the negative of that — and that is what "up" has to produce, or the controls read inverted.
    for (const yaw of [0, 0.4, Math.PI / 2, 2.2, Math.PI, -1.1, 5.9]) {
      const v = sampleWith(yaw, 0, -1);
      expect(v.x).toBeCloseTo(-Math.sin(yaw), 10);
      expect(v.z).toBeCloseTo(-Math.cos(yaw), 10);
    }
  });

  it('sends screen-right to the camera’s right at every angle', () => {
    // The other half of the basis. Derived independently of the code under test: the camera looks
    // along f = -(sin θ, cos θ), world up is +Y, so screen-right is f × up = (-cos θ, sin θ)... which
    // in the (x, z) plane is (cos θ, -sin θ). A sign error here swaps A and D at 90° and nowhere else,
    // which is exactly the kind of thing that survives a casual play test at the default angle.
    for (const yaw of [0, 0.7, Math.PI / 2, 3.0, -2.4]) {
      const v = sampleWith(yaw, 1, 0);
      expect(v.x).toBeCloseTo(Math.cos(yaw), 10);
      expect(v.z).toBeCloseTo(-Math.sin(yaw), 10);
    }
  });

  it('preserves magnitude, so a diagonal is not faster at some camera angles', () => {
    // A rotation cannot change length, which is what lets input.ts apply the basis AFTER normalising
    // rather than having to renormalise. If this ever fails, movement speed has become a function of
    // where the camera is pointed.
    const diag = Math.SQRT1_2;
    for (const yaw of [0, 0.3, 1.9, -2.7, 4.4]) {
      const v = sampleWith(yaw, diag, -diag);
      expect(Math.hypot(v.x, v.z)).toBeCloseTo(1, 10);
    }
  });

  it('rotates a half turn into an exact reversal', () => {
    const v = sampleWith(Math.PI, 0.5, -0.25);
    expect(v.x).toBeCloseTo(-0.5, 10);
    expect(v.z).toBeCloseTo(0.25, 10);
  });

  it('is reset by resetInput, so a test or a remount cannot inherit a rotated basis', () => {
    // Module state outlives any one component. A rig that unmounted mid-orbit would otherwise leave
    // the next run's movement permanently rotated by whatever angle the last one ended on.
    setInputBasisYaw(1.2);
    resetInput();
    setTouchVector(0.3, -0.9);
    sampleInput(out);
    expect(out.x).toBe(0.3);
    expect(out.z).toBe(-0.9);
  });
});
