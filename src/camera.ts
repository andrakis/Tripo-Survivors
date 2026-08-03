// Camera modes, and the orbit rig's state. See docs/ARCHITECTURE.md §9.
//
// M7 added a SECOND camera. The original — a fixed offset with lag, never rotating — is still the
// default and still the one the game is balanced around, because a fixed world yaw is what makes
// "W" a constant world direction and what keeps every model inside one angle band. Orbit mode
// gives that up deliberately, for the two things it buys:
//
//   - a viewer can walk around their own import and look at it from any side, which is the whole
//     point of a model-import tutorial and is impossible from a locked three-quarter view;
//   - zooming out reveals the arena and its boundary, which the fixed rig never shows.
//
// The costs are real and are not bugs: movement becomes camera-relative (see `setInputBasisYaw` in
// input.ts), and on a touchscreen the drag that orbits competes with the thumb that moves. Follow
// mode remains the default everywhere for exactly that reason.
//
// This module holds no THREE types and touches no scene. It is the shared vocabulary between the
// rig that reads it (scene/CameraRig.tsx) and the button that flips it (ui/CameraToggle.tsx).

import { create } from 'zustand';
import { TUNING } from './config';

export type CameraMode = 'follow' | 'orbit';

/**
 * Orbit's starting pose, derived from `CAM_OFFSET` rather than written down again.
 *
 * That derivation is load-bearing, not tidiness: it makes the orbit rig's home pose EXACTLY the
 * fixed rig's pose, so entering orbit mode moves the camera by nothing at all. A viewer presses C
 * and the picture does not jump — the controls simply come alive. Re-deriving also means retuning
 * CAM_OFFSET can never silently desync the two modes.
 */
const [OX, OY, OZ] = TUNING.CAM_OFFSET;
export const ORBIT_HOME = {
  yaw: Math.atan2(OX, OZ), // 0 — camera on +Z, the fixed rig's world yaw
  pitch: Math.atan2(OY, Math.hypot(OX, OZ)), // 45°
  dist: Math.hypot(OX, OY, OZ), // 36.8
} as const;

export interface OrbitState {
  /** Radians, measured the same way `CAM_OFFSET` is: 0 puts the camera on +Z looking toward -Z. */
  yaw: number;
  /** Radians above the ground plane. Clamped so the camera never reaches the ground or the zenith. */
  pitch: number;
  /** Camera distance from the follow point. */
  dist: number;
}

/**
 * The live orbit pose. HOT state (ARCHITECTURE §3): mutated by pointer handlers at input rate and
 * read by the rig every frame, so it is a plain mutable object rather than store state. Nothing
 * re-renders when it changes and nothing should.
 */
export const orbit: OrbitState = { ...ORBIT_HOME };

export function resetOrbit(): void {
  Object.assign(orbit, ORBIT_HOME);
}

/**
 * Apply a drag, in pixels, to an orbit pose. Pure, so the clamping is testable without a DOM.
 *
 * Pitch is clamped ABOVE the horizon and below the zenith, which removes two whole classes of
 * broken-looking frame for free: the camera can never drop under the ground plane and see the
 * arena from below through a one-sided floor, and it can never reach straight down, where yaw
 * becomes meaningless and the view spins around a degenerate pole.
 *
 * Drag down lowers the camera toward the horizon; drag up raises it toward top-down. Stated because
 * both conventions are in the wild and the only wrong answer is an undocumented one.
 */
export function applyOrbitDrag(s: OrbitState, dx: number, dy: number): void {
  s.yaw -= dx * TUNING.ORBIT_SENS;
  s.pitch = clamp(s.pitch - dy * TUNING.ORBIT_SENS, TUNING.ORBIT_PITCH_MIN, TUNING.ORBIT_PITCH_MAX);
}

/**
 * Zoom by `notches` wheel detents (positive = away). Multiplicative, so one notch covers the same
 * FRACTION of the current distance at every range — an additive step that feels right at 40 units
 * is either imperceptible or a teleport at the ends of a 10-to-140 range.
 */
export function applyOrbitZoom(s: OrbitState, notches: number): void {
  s.dist = clamp(
    s.dist * Math.pow(TUNING.ORBIT_ZOOM_STEP, notches),
    TUNING.ORBIT_DIST_MIN,
    TUNING.ORBIT_DIST_MAX,
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface CameraStore {
  mode: CameraMode;
  setMode: (m: CameraMode) => void;
  toggleMode: () => void;
}

/**
 * The mode itself is COOL state: it changes when a human presses a key, not every frame, and the
 * HUD has to re-render when it does. Kept in its own tiny store rather than in `store.ts` because
 * that one is overwritten wholesale by the sim's 10 Hz snapshot — a camera mode living there would
 * be reset by the next tick.
 */
export const useCamera = create<CameraStore>((set) => ({
  mode: 'follow',
  setMode: (mode) => set({ mode }),
  toggleMode: () =>
    set((s) => {
      // Leaving orbit returns the pose to home, so the NEXT entry is continuous again (see
      // ORBIT_HOME). Without it, a viewer who orbited behind their model, switched to follow and
      // switched back would find the camera behind the model with no memory of having put it there.
      if (s.mode === 'orbit') resetOrbit();
      return { mode: s.mode === 'orbit' ? 'follow' : 'orbit' };
    }),
}));

/** Read the mode outside React (the rig's frame callback). */
export function cameraMode(): CameraMode {
  return useCamera.getState().mode;
}

/**
 * Attach orbit controls to the canvas, plus the mode hotkey. Returns the detach function.
 *
 * Pointer drag orbits, wheel zooms, `C` toggles the mode and `R` re-centres the orbit. The drag
 * listener lives on the CANVAS rather than on window so that dragging a HUD control — the touch
 * thumbstick above all — never also swings the camera. The hotkeys are on window, because a key
 * press has no position and the canvas is not focusable.
 *
 * Handlers no-op in follow mode instead of being attached and detached per mode: a mid-drag mode
 * flip would otherwise leave a captured pointer with nothing listening to release it.
 */
export function attachCameraControls(canvas: HTMLElement, target: Window = window): () => void {
  let dragging: number | null = null;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (cameraMode() !== 'orbit' || dragging !== null) return;
    dragging = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (dragging !== e.pointerId) return;
    applyOrbitDrag(orbit, e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
  };

  const onPointerUp = (e: PointerEvent) => {
    if (dragging !== e.pointerId) return;
    dragging = null;
    // May already be released if the pointer left the window; releasing twice throws.
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    if (cameraMode() !== 'orbit') return;
    // deltaMode 1 is lines, 2 is pages; both report far smaller numbers than the pixel mode most
    // mice send, so normalising here keeps one wheel notch worth one notch across browsers.
    const notches = e.deltaMode === 0 ? e.deltaY / 100 : e.deltaY;
    applyOrbitZoom(orbit, notches);
    // Otherwise the page scrolls behind a full-screen canvas, which reads as the game lurching.
    e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (e.code === 'KeyC') useCamera.getState().toggleMode();
    else if (e.code === 'KeyR' && cameraMode() === 'orbit') resetOrbit();
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    target.removeEventListener('keydown', onKeyDown);
  };
}
