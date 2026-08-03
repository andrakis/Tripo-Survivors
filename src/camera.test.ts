// The orbit camera's invariants (src/camera.ts, docs/ARCHITECTURE.md §9).
//
// All three cases here guard something whose failure looks like a rendering bug rather than like a
// maths mistake, which is the kind that costs an afternoon: a camera that jumps on a mode switch, a
// camera that ends up under the floor, and a camera that quietly forgets where it was pointed.

import { beforeEach, describe, expect, it } from 'vitest';
import { TUNING } from './config';
import { ORBIT_HOME, applyOrbitDrag, applyOrbitZoom, orbit, resetOrbit, useCamera } from './camera';

/** The spherical-to-cartesian the rig does every frame (scene/CameraRig.tsx). */
function offsetOf(s: { yaw: number; pitch: number; dist: number }): [number, number, number] {
  const cp = Math.cos(s.pitch);
  return [
    Math.sin(s.yaw) * cp * s.dist,
    Math.sin(s.pitch) * s.dist,
    Math.cos(s.yaw) * cp * s.dist,
  ];
}

beforeEach(() => {
  resetOrbit();
  useCamera.getState().setMode('follow');
});

describe('entering orbit mode does not move the camera', () => {
  it('puts the home pose exactly on CAM_OFFSET', () => {
    // The property a viewer actually experiences: press C and the picture does not jump, the
    // controls simply come alive. It holds because ORBIT_HOME is DERIVED from CAM_OFFSET rather
    // than written down beside it — this test is what stops someone "simplifying" that into two
    // hardcoded numbers that then drift the first time the fixed rig is retuned.
    const [x, y, z] = offsetOf(ORBIT_HOME);
    const [cx, cy, cz] = TUNING.CAM_OFFSET;
    expect(x).toBeCloseTo(cx, 6);
    expect(y).toBeCloseTo(cy, 6);
    expect(z).toBeCloseTo(cz, 6);
  });

  it('leaves the follow rig facing straight down -Z, so its input basis is a no-op', () => {
    // input.ts short-circuits a zero basis yaw to keep follow mode bit-for-bit what it was before
    // orbit existed. That shortcut is only correct while the home yaw is exactly 0.
    expect(Math.atan2(offsetOf(ORBIT_HOME)[0], offsetOf(ORBIT_HOME)[2])).toBe(0);
  });
});

describe('the orbit pose cannot reach a degenerate camera', () => {
  it('clamps pitch above the ground and below the pole however far you drag', () => {
    // Under the floor you see the arena through a one-sided plane; at the pole yaw stops meaning
    // anything and the view spins about a degenerate axis. Both read as the camera having broken.
    for (const drag of [-100000, -1000, 1000, 100000]) {
      resetOrbit();
      applyOrbitDrag(orbit, 0, drag);
      expect(orbit.pitch).toBeGreaterThanOrEqual(TUNING.ORBIT_PITCH_MIN);
      expect(orbit.pitch).toBeLessThanOrEqual(TUNING.ORBIT_PITCH_MAX);
      // And the camera is genuinely above the ground plane at the limit, not merely inside a range.
      expect(offsetOf(orbit)[1]).toBeGreaterThan(0);
    }
  });

  it('lets yaw run free, because a horizontal turn has no edge to hit', () => {
    applyOrbitDrag(orbit, 100000, 0);
    expect(Number.isFinite(orbit.yaw)).toBe(true);
    expect(Math.abs(orbit.yaw)).toBeGreaterThan(Math.PI * 2);
  });

  it('clamps zoom at both ends and moves by a constant FRACTION per notch', () => {
    resetOrbit();
    const start = orbit.dist;
    applyOrbitZoom(orbit, 1);
    const oneOut = orbit.dist / start;
    resetOrbit();
    applyOrbitZoom(orbit, -1);
    const oneIn = start / orbit.dist;
    // Multiplicative, so one notch covers the same proportion at 10 units as at 140 — an additive
    // step that feels right in the middle is a teleport at one end and invisible at the other.
    expect(oneOut).toBeCloseTo(oneIn, 10);

    resetOrbit();
    applyOrbitZoom(orbit, 500);
    expect(orbit.dist).toBe(TUNING.ORBIT_DIST_MAX);
    applyOrbitZoom(orbit, -500);
    expect(orbit.dist).toBe(TUNING.ORBIT_DIST_MIN);
  });
});

describe('toggling modes', () => {
  it('re-centres the pose on the way OUT, so the next entry is continuous again', () => {
    // Without this, a viewer who orbits behind their model, flips to follow and flips back finds
    // the camera behind the model with no memory of having put it there — and, because entering
    // orbit is supposed to be a no-op move, that shows up as a jump on a keypress that promised not
    // to move anything.
    useCamera.getState().setMode('orbit');
    applyOrbitDrag(orbit, 400, 60);
    applyOrbitZoom(orbit, 3);
    expect(orbit.yaw).not.toBe(ORBIT_HOME.yaw);

    useCamera.getState().toggleMode();
    expect(useCamera.getState().mode).toBe('follow');
    expect(orbit.yaw).toBe(ORBIT_HOME.yaw);
    expect(orbit.pitch).toBe(ORBIT_HOME.pitch);
    expect(orbit.dist).toBe(ORBIT_HOME.dist);
  });

  it('does not disturb the pose on the way IN', () => {
    useCamera.getState().toggleMode();
    expect(useCamera.getState().mode).toBe('orbit');
    expect(orbit.yaw).toBe(ORBIT_HOME.yaw);
  });
});
