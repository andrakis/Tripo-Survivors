// Vertex Animation Texture bake CORE — pure THREE maths, no DOM, no GPU, no fetch.
//
// Ported from Breach/src/render/vatCore.js. It CPU-skins each clip frame into object-space position
// and normal arrays, replicating the GPU skinning matrix per vertex so position and normal stay
// consistent. Because it deals only in numbers it runs anywhere: the browser worker imports it, and
// so does the unit test, which is the whole reason the tricky part of this pipeline is testable at
// all (src/models/vatCore.test.ts).
//
// **Why VAT at all?** Skeletal skinning costs CPU and a draw call *per instance*. It is the right
// answer for a handful of characters and it does not survive 400 — Breach measured the switch away
// from a skeletal pool at 30 → 88 fps. A VAT bakes every clip's per-vertex motion into a texture
// sampled in the vertex shader, so animation costs essentially nothing per instance and the whole
// crowd stays one instanced draw. The cost is VRAM proportional to `vertices × frames`, and notably
// NOT to instance count.
//
// **What was left behind in the port.** Breach's version also decimates via `meshoptimizer` for its
// far-LOD tiers. This project caps at 400 enemies of ~800 triangles and has no LOD ladder, so the
// dependency would buy nothing — MODEL-PIPELINE §5's budgets exist to keep it that way.

import * as THREE from 'three';

/** One clip's rows inside the stacked VAT texture. */
export interface VatClip {
  name: string;
  /** First row (texture Y) of this clip. */
  start: number;
  /** How many rows it occupies. */
  count: number;
  /** Loops seamlessly (no duplicate end frame) rather than holding a final pose. */
  loop: boolean;
}

export interface VatBake {
  vertexCount: number;
  fps: number;
  totalFrames: number;
  clips: VatClip[];
  /** (frame, vertex) → xyz1, row-major by frame. Length totalFrames × vertexCount × 4. */
  pos: Float32Array;
  /** Same layout, xyz0. */
  nrm: Float32Array;
}

/** What to bake, and how. `from`/`trim` cut a WINDOW out of a clip — see `planFrames`. */
export interface ClipSpec {
  /** Canonical name the runtime asks for: `idle`, `walk`, `run`, `attack`, `die`. */
  as: string;
  /**
   * Substring(s) matched case-insensitively against the GLB's clip names, first hit wins.
   *
   * A list because the same logical clip goes by different names per source: Tripo's autorig calls
   * its attacks `box_01`..`box_03` where a hand-named rig says `Attack` — one spec covers both.
   */
  match: string | readonly string[];
  loop: boolean;
  /**
   * A missing optional clip is silently skipped rather than reported. For the slots that are a
   * bonus when present — the second and third attack variants — not a gap when absent.
   */
  optional?: boolean;
  /** Seconds into the clip to start baking from. One-shots only. */
  from?: number;
  /** Seconds of the clip to bake, measured from `from`. Only ever shortens. One-shots only. */
  trim?: number;
}

/**
 * Heuristic used when no explicit spec is given: locomotion and idle loop, everything else is a
 * one-shot. Kept from the Breach port because it is the same judgement, and because a viewer baking
 * a model with unfamiliar clip names gets sensible behaviour without a config file.
 */
export function isLoopClip(name: string): boolean {
  return /run|walk|idle|loop|march|stand/i.test(name || '');
}

/**
 * Frames a clip gets, and the times to sample it at.
 *
 * A **loop** spans `[0, dur)` with no duplicate end frame — the runtime wraps back to frame 0, so
 * baking the final pose too would hold one frame twice and give the cycle a visible hitch.
 * A **one-shot** spans `[0, dur]` inclusive, because the last pose is exactly what it must hold.
 *
 * `from`/`trim` are therefore only offered for one-shots. Cutting a loop moves its end pose away
 * from its start pose, and the cycle pops once per revolution — which is worth stating because the
 * biggest clip in the real Tripo export is a 12-second idle and trimming it is the obvious wrong
 * idea.
 *
 * A window, not just a prefix, because of what the real `defeat` preset turned out to contain: 3
 * seconds of staggering, half a second of actually falling at t≈3, then 2 seconds of lying still. A
 * prefix trim bakes only the stagger and the "death" never falls over.
 */
function window(duration: number, loop: boolean, from?: number, trim?: number): { start: number; span: number } {
  if (loop) return { start: 0, span: duration };
  // A window that falls past the end of the clip is ignored, not clamped to its last frame: the
  // numbers are measured against one source (Tripo's 5.6 s defeat preset), and a hand-authored 1 s
  // `die` matched by the same spec should play whole rather than freeze on its final pose.
  const start = from && from < duration ? from : 0;
  const span = Math.min(trim ?? duration, duration - start);
  return { start, span };
}

function planFrames(duration: number, fps: number, loop: boolean, from?: number, trim?: number): number {
  const { span } = window(duration, loop, from, trim);
  if (span === 0) return 1; // a single-pose clip
  const base = Math.max(1, Math.round(span * fps));
  return loop ? base : base + 1;
}

/** The sample time for frame `f` of a plan, matching `planFrames`. */
function sampleTime(f: number, count: number, w: { start: number; span: number }, loop: boolean): number {
  if (count === 1) return w.start;
  return w.start + (loop ? (f / count) * w.span : (f / (count - 1)) * w.span);
}

/**
 * Bake a SkinnedMesh and its clips into VAT arrays.
 *
 * `onFrame(done, total)` fires after every baked frame. The loop is synchronous, but a worker can
 * still `postMessage` from inside it, which is how the load screen gets a progress bar.
 */
export function bakeSkinnedMesh(
  mesh: THREE.SkinnedMesh,
  entries: { clip: THREE.AnimationClip; as: string; loop: boolean; from?: number; trim?: number }[],
  opts: { fps?: number; root?: THREE.Object3D | null; onFrame?: ((d: number, t: number) => void) | null } = {},
): VatBake {
  const { fps = 24, root = null, onFrame = null } = opts;
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  const nrmAttr = geo.attributes.normal;
  const skinIndex = geo.attributes.skinIndex;
  const skinWeight = geo.attributes.skinWeight;
  if (!skinIndex || !skinWeight) throw new Error('geometry has no skinIndex/skinWeight — not a skinned mesh');
  if (!nrmAttr) throw new Error('geometry has no normals — cannot bake lighting-correct frames');
  const vertexCount = posAttr.count;

  const plan = entries.map((e) => ({
    ...e,
    count: planFrames(e.clip.duration, fps, e.loop, e.from, e.trim),
    window: window(e.clip.duration, e.loop, e.from, e.trim),
  }));

  let totalFrames = 0;
  const clips: VatClip[] = plan.map((p) => {
    const meta = { name: p.as, start: totalFrames, count: p.count, loop: p.loop };
    totalFrames += p.count;
    return meta;
  });

  const pos = new Float32Array(totalFrames * vertexCount * 4);
  const nrm = new Float32Array(totalFrames * vertexCount * 4);

  const sceneRoot = root || mesh;
  const mixer = new THREE.AnimationMixer(sceneRoot);

  // --- root-motion lock ---------------------------------------------------------------------
  //
  // Tripo's locomotion presets are authored WITH root motion: the real grunt's `run` clip walks its
  // Hip bone 2.31 units on a model 0.865 units tall, and `walk` 1.19. In a game whose simulation owns
  // every position that is simply wrong — the animation would carry the character away from the spot
  // the sim put it on.
  //
  // Worse, it does not merely translate the model. Blender's exporter parks any unweighted vertex on
  // a `neutral_bone` outside the hip hierarchy; those vertices stay put while the rest of the body
  // travels, and the mesh tears into spikes. That is what a run cycle looked like before this block
  // existed, and it reads as a broken *shader* rather than as an authoring convention.
  //
  // So: a bone whose animated translation strays more than `maxDrift` from its bind pose is pinned
  // back. Rotations are untouched, which is where all the actual motion of a biped lives. The test is
  // per-bone and proportional to the model, so ordinary authored translation (a jaw, a slide) passes
  // through and only the root's travel is caught.
  const bones = mesh.skeleton.bones;
  const bindPos = bones.map((b) => b.position.clone());
  geo.computeBoundingBox();
  const modelHeight = geo.boundingBox ? geo.boundingBox.max.y - geo.boundingBox.min.y : 1;
  const maxDrift = Math.max(1e-4, modelHeight * 0.15);

  // Reusable scratch — the bake loop allocates nothing.
  const bind = mesh.bindMatrix!;
  const bindInv = mesh.bindMatrixInverse!;
  const offset = new THREE.Matrix4();
  const skinMat = new THREE.Matrix4();
  const full = new THREE.Matrix4();
  const nMat = new THREE.Matrix3();
  const acc = new Float32Array(16);
  const vp = new THREE.Vector3();
  const vn = new THREE.Vector3();

  let globalFrame = 0;
  for (const p of plan) {
    const action = mixer.clipAction(p.clip);
    mixer.stopAllAction();
    // LoopOnce + clamp, so sampling at t === duration holds the final pose instead of wrapping to 0.
    action.reset();
    action.setLoop(THREE.LoopOnce, 0);
    action.clampWhenFinished = true;
    action.play();

    for (let f = 0; f < p.count; f++) {
      mixer.setTime(sampleTime(f, p.count, p.window, p.loop)); // absolute re-evaluation from t=0
      // The root-motion lock, applied after the mixer poses the bones and before matrices bake.
      for (let bi = 0; bi < bones.length; bi++) {
        if (bones[bi].position.distanceTo(bindPos[bi]) > maxDrift) bones[bi].position.copy(bindPos[bi]);
      }
      sceneRoot.updateMatrixWorld(true);
      mesh.skeleton.update();
      const bm = mesh.skeleton.boneMatrices; // Float32Array, 16 per bone
      if (!bm) throw new Error('skeleton has no bone matrices — the rig did not bind');

      for (let v = 0; v < vertexCount; v++) {
        acc.fill(0);
        for (let k = 0; k < 4; k++) {
          const w = skinWeight.getComponent(v, k);
          if (w === 0) continue;
          const bi = skinIndex.getComponent(v, k);
          offset.fromArray(bm, bi * 16);
          const e = offset.elements;
          for (let j = 0; j < 16; j++) acc[j] += e[j] * w;
        }
        skinMat.fromArray(acc as unknown as number[]);
        full.copy(bindInv).multiply(skinMat).multiply(bind);

        vp.fromBufferAttribute(posAttr, v).applyMatrix4(full);
        nMat.getNormalMatrix(full);
        vn.fromBufferAttribute(nrmAttr, v).applyMatrix3(nMat).normalize();

        const o = (globalFrame * vertexCount + v) * 4;
        pos[o] = vp.x;
        pos[o + 1] = vp.y;
        pos[o + 2] = vp.z;
        pos[o + 3] = 1;
        nrm[o] = vn.x;
        nrm[o + 1] = vn.y;
        nrm[o + 2] = vn.z;
        nrm[o + 3] = 0;
      }
      globalFrame++;
      if (onFrame) onFrame(globalFrame, totalFrames);
    }
    action.stop();
  }

  return { vertexCount, fps, totalFrames, clips, pos, nrm };
}

/**
 * Match a GLB's clips against the requested specs.
 *
 * Case-insensitive substring, first match wins, and **duplicates are dropped** — Tripo's autorig
 * export ships every clip twice (`Armature|preset:biped:run` and `Armature|Armature|preset:biped:run`
 * in the real grunt), and baking both would double the cost of the milestone for nothing.
 *
 * Returns the matched entries plus the names of any specs that found nothing, so the caller can say
 * which clip is missing rather than silently animating a corpse with a run cycle.
 */
export function matchClips(
  available: THREE.AnimationClip[],
  specs: ClipSpec[],
): {
  entries: { clip: THREE.AnimationClip; as: string; loop: boolean; from?: number; trim?: number }[];
  missing: string[];
} {
  const entries: { clip: THREE.AnimationClip; as: string; loop: boolean; from?: number; trim?: number }[] = [];
  const missing: string[] = [];
  for (const spec of specs) {
    const alternates = Array.isArray(spec.match) ? spec.match : [spec.match];
    let found: THREE.AnimationClip | undefined;
    for (const m of alternates) {
      found = available.find((c) => c.name.toLowerCase().includes(m.toLowerCase()));
      if (found) break;
    }
    if (!found) {
      if (!spec.optional) missing.push(spec.as);
      continue;
    }
    entries.push({ clip: found, as: spec.as, loop: spec.loop, from: spec.from, trim: spec.trim });
  }
  return { entries, missing };
}
