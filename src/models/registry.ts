// THE TUTORIAL SEAM. See docs/MODEL-PIPELINE.md.
//
// One table maps every logical actor to how it is drawn. Nothing else in the codebase knows what
// an actor looks like — so using your own model is one line here plus a file in public/models/,
// with no edit anywhere in scene/, sim/, or ui/.
//
// `url` is honoured from M6 onward; today only `primitive` is read. The primitive is not a
// placeholder to be deleted later — it stays forever as the fallback when a GLB is missing or
// violates the export contract, so a mistake degrades to a working game plus a console warning.

import * as THREE from 'three';
import { COLORS } from '../config';

export interface ActorModel {
  /** Stage 1: the primitive that ships today, and the fallback forever after. */
  primitive: () => THREE.BufferGeometry;
  /** Stage 2 (M6): drop a GLB in public/models/ and name it here. That is the whole change. */
  url?: string;
  /** Target height in world units. Imported models are normalised to this — see MODEL-PIPELINE §4. */
  height: number;
  /** Artistic scale multiplier applied after height normalisation. */
  scale: number;
  /** Lift so the model's feet sit at y = 0. */
  yOffset: number;
  /** Instance tint. Kept even with a textured model — it drives the hit flash. */
  tint: number;
}

export type ActorId = 'player' | 'grunt' | 'runner' | 'brute' | 'elite' | 'orb' | 'prop';

export const ACTORS: Record<ActorId, ActorModel> = {
  player: {
    primitive: () => new THREE.CapsuleGeometry(0.5, 0.9, 4, 12),
    height: 1.7,
    scale: 1.0,
    yOffset: 0.85,
    tint: COLORS.PLAYER,
  },
  grunt: {
    primitive: () => new THREE.BoxGeometry(0.8, 1.4, 0.8),
    height: 1.4,
    scale: 1.0,
    yOffset: 0.7,
    tint: COLORS.GRUNT,
  },
  runner: {
    primitive: () => new THREE.ConeGeometry(0.35, 1.5, 6),
    height: 1.5,
    scale: 1.0,
    yOffset: 0.75,
    tint: COLORS.RUNNER,
  },
  brute: {
    primitive: () => new THREE.BoxGeometry(1.6, 2.6, 1.6),
    height: 2.6,
    scale: 1.0,
    yOffset: 1.3,
    tint: COLORS.BRUTE,
  },
  elite: {
    primitive: () => new THREE.BoxGeometry(2.8, 4.5, 2.8),
    height: 4.5,
    scale: 1.0,
    yOffset: 2.25,
    tint: COLORS.ELITE,
  },
  orb: {
    primitive: () => new THREE.IcosahedronGeometry(0.22, 0),
    height: 0.45,
    scale: 1.0,
    yOffset: 0.35,
    tint: COLORS.ORB,
  },
  prop: {
    // Unit cube, scaled per-instance to each obstacle's half-extents (sim/world.ts).
    primitive: () => new THREE.BoxGeometry(1, 1, 1),
    height: 1,
    scale: 1.0,
    yOffset: 0,
    tint: COLORS.PROP,
  },
};
