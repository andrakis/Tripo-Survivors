// The ground texture, drawn in code rather than loaded from a file.
//
// Procedural for three reasons, in order of how much they matter here:
//
//   1. This repo is a tutorial about importing YOUR OWN art. A checked-in grass photo would be the
//      one asset in the project nobody can explain the provenance of, and the pipeline docs would
//      have to grow a "except the ground" clause.
//   2. It is tunable from config.ts like everything else, so the stage stays inside the value band
//      ART-STYLE enforces (src/readability.test.ts) instead of being whatever a JPEG happened to be.
//   3. It costs no download and no decode, and the whole thing is ~8 ms on a 256² canvas.
//
// The result is not photographic and is not trying to be. It is stippled noise at two tints that
// reads as ground cover in motion, which is all the camera distance in this game can resolve — and
// the single job the old grid was doing (making movement visible) it does better, because the
// detail is continuous rather than one line every eight units.

import * as THREE from 'three';
import { COLORS } from '../config';

/** How many world units one tile of the texture covers. Was the old grid's spacing, deliberately:
 *  it is the scale that read correctly for motion at this camera distance. */
export const GRASS_TILE = 8;

/**
 * Deterministic PRNG (mulberry32).
 *
 * The texture MUST be identical on every load. A `Math.random()` ground would mean a screenshot
 * taken to check a model import could never be compared against the last one, and the difference
 * would be noise nobody could attribute.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * Build the tiling grass texture, or null where there is no canvas to draw on.
 *
 * Returning null rather than throwing keeps this on the same degrade-don't-break ladder as the
 * model loader: a browser that cannot give us a 2D context still gets a playable game on a flat
 * ground colour, which is exactly what shipped through M6.
 */
export function makeGrassTexture(size = 256): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const rnd = mulberry32(0x5eed);

  g.fillStyle = css(COLORS.GROUND);
  g.fillRect(0, 0, size, size);

  // Low-frequency mottle first: broad patches of lighter and darker ground under the blades. Without
  // it the stipple below averages out to a flat colour at any distance and the ground goes back to
  // looking painted — the detail has to exist at more than one scale to survive perspective.
  for (let i = 0; i < 34; i++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = size * (0.08 + rnd() * 0.22);
    const light = rnd() < 0.5;
    // Drawn nine times, once per wrap offset, so a patch straddling an edge continues on the far
    // side. This is what makes the texture actually tile — a seam on a ground plane repeated 32
    // times across the arena is a grid of visible lines, which is precisely what we removed.
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const grad = g.createRadialGradient(
          cx + ox * size,
          cy + oy * size,
          0,
          cx + ox * size,
          cy + oy * size,
          r,
        );
        grad.addColorStop(0, `${css(light ? COLORS.GRASS_LIGHT : COLORS.GRASS_DARK)}55`);
        grad.addColorStop(1, `${css(light ? COLORS.GRASS_LIGHT : COLORS.GRASS_DARK)}00`);
        g.fillStyle = grad;
        g.beginPath();
        g.arc(cx + ox * size, cy + oy * size, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // Blades: short strokes at two tints, leaning at a shallow angle so the ground has a direction
  // rather than reading as television static.
  g.lineCap = 'round';
  const BLADES = 4200;
  for (let i = 0; i < BLADES; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 2 + rnd() * 4;
    const lean = (rnd() - 0.5) * 1.1;
    const light = rnd() < 0.42;
    g.strokeStyle = `${css(light ? COLORS.GRASS_LIGHT : COLORS.GRASS_DARK)}${light ? 'aa' : '88'}`;
    g.lineWidth = 0.8 + rnd() * 0.9;
    // Only duplicated where it can actually cross an edge — nine draws per blade would be 38k
    // strokes for a wrap that all but a few hundred of them never need.
    const near = x < len || y < len || x > size - len || y > size - len;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        if (!near && (ox !== 0 || oy !== 0)) continue;
        g.beginPath();
        g.moveTo(x + ox * size, y + oy * size);
        g.lineTo(x + ox * size + lean * len, y + oy * size - len);
        g.stroke();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
