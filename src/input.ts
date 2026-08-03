// Input: two producers, one vector. See docs/ARCHITECTURE.md §8.
//
// Keyboard and the virtual thumbstick (ui/TouchControls.tsx) both feed this module, and the tick
// reads exactly one normalised `{x, z}` out of it. sim/player.ts never learns which one moved it,
// which is why there is only one movement code path to balance and to debug.
//
// This lives at src/ rather than src/sim/ deliberately: it touches `window`, and everything under
// sim/ has to stay runnable in plain node (ARCHITECTURE §2.1).

export interface InputVector {
  x: number;
  z: number;
  /**
   * True on exactly ONE tick per press of the dash key.
   *
   * An edge rather than a held flag, because the dash is a discrete action on a cooldown: a held
   * button that re-fired the instant the cooldown expired would make "hold space" strictly better
   * than tapping it, which is a control the player is punished for using naturally.
   */
  dash: boolean;
}

/**
 * Physical key positions, keyed by `KeyboardEvent.code`, NOT by `.key`.
 *
 * `.code` is the physical key, so the WASD cluster stays the WASD cluster on AZERTY and Dvorak. It
 * also means the mapping is immune to a held modifier changing `.key` mid-press — a `keyup` whose
 * `.key` no longer matches the `keydown` is the classic way a character gets stuck running.
 *
 * These are SCREEN directions, with screen-up as -Z. Under the fixed camera that is also a world
 * direction, because the rig never rotates (DESIGN §12); under the M7 orbit camera it is not, and
 * `sampleInput` rotates the result into world space — see `setInputBasisYaw`.
 */
const KEY_MAP: Record<string, readonly [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** The dash keys. Space is the primary; Shift is there for players whose thumb is already on it. */
const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight']);

const held = new Set<string>();
const touch = { x: 0, z: 0 };
/** Set by a producer, cleared by the tick that consumes it — see `InputVector.dash`. */
let dashQueued = false;
/** The camera yaw the screen-space input is rotated by. See `setInputBasisYaw`. */
let basisYaw = 0;

/**
 * Tell input which way the camera is facing, in radians of world yaw.
 *
 * Both producers speak SCREEN space — "up" for the keyboard, "up-left" for a thumbstick — and the
 * sim wants world space. Under the fixed camera the two coincide and this stays 0, which is why the
 * game shipped six milestones without it. The orbit camera (src/camera.ts) breaks the coincidence:
 * with the camera swung round behind the player, holding W under the old mapping walks them
 * *toward the screen*, and every player reads that as the controls being inverted rather than as a
 * camera convention.
 *
 * Rotating here rather than in sim/player.ts is deliberate. It keeps the basis change in the module
 * that already owns "what did the human ask for", leaves exactly one movement code path for both
 * producers, and means the sim still receives a plain world-space unit vector and remains runnable
 * in node with no camera at all (ARCHITECTURE §2.1).
 *
 * scene/CameraRig.tsx is the only caller, and it passes the yaw of the camera it just RENDERED —
 * not the one requested — so the controls can never disagree with the picture, even mid-transition.
 */
export function setInputBasisYaw(yaw: number): void {
  basisYaw = yaw;
}

/** Queue a dash from anywhere. The touch button (ui/TouchControls.tsx) is the other caller. */
export function queueDash(): void {
  dashQueued = true;
}

/** Attach the keyboard producer to `window`. Returns the detach function, for an effect cleanup. */
export function attachKeyboard(target: Window = window): () => void {
  const onDown = (e: KeyboardEvent) => {
    if (DASH_KEYS.has(e.code)) {
      // `repeat` guard: holding the key must not machine-gun a queued dash on every OS key-repeat,
      // which would spend the cooldown the instant it came back for as long as the key was down.
      if (!e.repeat) dashQueued = true;
      // Space scrolls the page, and on a full-screen canvas that reads as the game jumping.
      e.preventDefault();
      return;
    }
    if (!(e.code in KEY_MAP)) return;
    held.add(e.code);
    // Arrows scroll the page, and on a full-screen canvas that shows up as the whole game sliding.
    e.preventDefault();
  };
  const onUp = (e: KeyboardEvent) => {
    held.delete(e.code);
  };
  // Alt-tabbing away mid-run never delivers the keyup, so without this the character keeps running
  // in a direction the player is no longer holding — for the rest of the run.
  const onBlur = () => {
    held.clear();
    dashQueued = false;
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
    held.clear();
  };
}

/** The touch producer. `(x, z)` is already deflection-scaled to a magnitude of at most 1. */
export function setTouchVector(x: number, z: number): void {
  touch.x = x;
  touch.z = z;
}

/**
 * Rotate a screen-space vector into world space by the current basis yaw, in place.
 *
 * A rotation preserves magnitude, so this can be applied AFTER normalisation without undoing it —
 * a diagonal stays exactly as fast as a cardinal at every camera angle.
 */
function toWorld(out: InputVector, x: number, z: number): void {
  if (basisYaw === 0) {
    // The fixed camera's case, and the default. Skipped rather than multiplied by an identity so
    // follow mode is bit-for-bit what it was before orbit mode existed.
    out.x = x;
    out.z = z;
    return;
  }
  const s = Math.sin(basisYaw);
  const c = Math.cos(basisYaw);
  out.x = x * c + z * s;
  out.z = -x * s + z * c;
}

/**
 * Resolve both producers into `out`, in WORLD space. Allocation-free: the tick owns the destination.
 *
 * Keyboard wins while any movement key is held — blending the two would let a thumbstick left over
 * from a stale pointer quietly bias keyboard movement, and nobody is using both at once anyway.
 */
export function sampleInput(out: InputVector): void {
  // Consumed here and nowhere else, so exactly one tick ever sees a given press.
  out.dash = dashQueued;
  dashQueued = false;

  let x = 0;
  let z = 0;
  for (const code of held) {
    const m = KEY_MAP[code];
    if (m) {
      x += m[0];
      z += m[1];
    }
  }

  const len = Math.hypot(x, z);
  if (len > 0) {
    // Normalise so a diagonal isn't 1.41× faster than a cardinal. Opposing keys cancel to zero and
    // fall through to the touch vector, which is the behaviour you want: holding A+D means "stop".
    if (len > 1) {
      x /= len;
      z /= len;
    }
    toWorld(out, x, z);
    return;
  }

  toWorld(out, touch.x, touch.z);
}

/** Test seam: drop all held keys, centre the stick, forget any queued dash, face the camera home. */
export function resetInput(): void {
  held.clear();
  touch.x = 0;
  touch.z = 0;
  dashQueued = false;
  basisYaw = 0;
}
