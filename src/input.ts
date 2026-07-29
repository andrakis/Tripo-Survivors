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
}

/**
 * Physical key positions, keyed by `KeyboardEvent.code`, NOT by `.key`.
 *
 * `.code` is the physical key, so the WASD cluster stays the WASD cluster on AZERTY and Dvorak. It
 * also means the mapping is immune to a held modifier changing `.key` mid-press — a `keyup` whose
 * `.key` no longer matches the `keydown` is the classic way a character gets stuck running.
 *
 * Screen-up is -Z: the camera sits at +Z looking at the origin with a fixed world yaw (DESIGN §12),
 * so camera-relative movement is a constant identity mapping rather than a per-frame basis change.
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

const held = new Set<string>();
const touch: InputVector = { x: 0, z: 0 };

/** Attach the keyboard producer to `window`. Returns the detach function, for an effect cleanup. */
export function attachKeyboard(target: Window = window): () => void {
  const onDown = (e: KeyboardEvent) => {
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
  const onBlur = () => held.clear();

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
 * Resolve both producers into `out`. Allocation-free: the tick owns the destination object.
 *
 * Keyboard wins while any movement key is held — blending the two would let a thumbstick left over
 * from a stale pointer quietly bias keyboard movement, and nobody is using both at once anyway.
 */
export function sampleInput(out: InputVector): void {
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
    out.x = x;
    out.z = z;
    return;
  }

  out.x = touch.x;
  out.z = touch.z;
}

/** Test seam: drop all held keys and centre the stick. */
export function resetInput(): void {
  held.clear();
  touch.x = 0;
  touch.z = 0;
}
