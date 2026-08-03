// THE TUTORIAL SEAM. See docs/MODEL-PIPELINE.md.
//
// One table maps every logical actor to how it is drawn. Nothing else in the codebase knows what
// an actor looks like — so using your own model is one line here plus a file in public/models/,
// with no edit anywhere in scene/, sim/, or ui/.
//
// `url` is honoured from M6a onward. The primitive is not a placeholder to be deleted later — it
// stays forever as the fallback when a GLB is missing or violates the export contract, so a mistake
// degrades to a working game plus a console warning (src/models/loader.ts).

import * as THREE from 'three';
import { COLORS } from '../config';

export interface ActorModel {
  /** Stage 1: the primitive that ships today, and the fallback forever after. */
  primitive: () => THREE.BufferGeometry;
  /** Stage 2 (M6a): drop a GLB in public/models/ and name it here. That is the whole change. */
  url?: string;
  /** Target height in world units. Imported models are normalised to this — see MODEL-PIPELINE §4. */
  height: number;
  /** Artistic scale multiplier applied after height normalisation. */
  scale: number;
  /** Lift so the model's feet sit at y = 0. */
  yOffset: number;
  /**
   * Extra yaw in radians, added to the facing every renderer derives from movement.
   *
   * The escape hatch for MODEL-PIPELINE §3's "facing +Z" requirement — the most common and most
   * confusing import bug, because a model exported facing −Z runs backward and nothing else looks
   * wrong. `Math.PI` turns one around without opening Blender. Re-exporting is still the better fix;
   * this is here so a viewer is never blocked on doing it.
   */
  yaw?: number;
  /**
   * Stage 3: bake this actor's clips into a Vertex Animation Texture and animate the crowd.
   *
   * **Leave it out.** Since M6c the loader decides: a GLB with a skeleton is baked and animates, one
   * without stays static. A viewer who has just rigged a model in Tripo drops it in — or uploads it
   * from the startup dialog — and it moves, with no line here and nothing to know about.
   *
   * Set it to `false` to force an actor to stay static. The escape hatch, not the switch: a VAT costs
   * vertexCount × frames of texture, so a very heavy model is worth refusing on purpose rather than
   * paying for. The loader also refuses one over TUNING.VAT_MB_CEILING on its own.
   *
   * `true` is accepted and means the same as leaving it out — a rig is still required, because there
   * is nothing to bake without one.
   *
   * The clip names are matched case-insensitively as SUBSTRINGS, which is what lets the table cover
   * `Armature|preset:biped:run` without the viewer having to type it. See MODEL-PIPELINE §6.
   */
  animated?: boolean;
  /**
   * Instance tint: the primitive's colour, and the base its hit flash lerps from.
   *
   * A TEXTURED import ignores it — per-instance colour multiplies into the material, so tinting a
   * texture would stain it. Those flash from white toward an over-bright colour instead. See
   * `ResolvedActor` in src/models/loader.ts and MODEL-PIPELINE §2.1.
   */
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
    // THE ONE LINE. Delete it (or rename the file) and the grunt is a green box again, with a
    // warning in the console — nothing else in the codebase changes either way.
    url: '/models/grunt.glb',
    // THERE IS NO SECOND LINE. This GLB carries Tripo's autorig and its preset clips, and the loader
    // bakes them into a VAT at load because it found a skeleton — not because anything here asked
    // (MODEL-PIPELINE §6). `idle`, `walk`, `run` and `defeat` are only the first choice: every preset
    // Tripo offers is sorted into one of the game's five slots, so a rig built from any other subset
    // animates too (CLIP_SPECS in models/loader.ts).
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
