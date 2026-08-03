// Stage 2 of the model pipeline: load the GLBs named in the registry, validate them against the
// export contract, normalise them, and hand every renderer a geometry it can instance.
//
// **The fallback rule is the whole design** (docs/MODEL-PIPELINE.md §1). A missing file, a malformed
// export, a contract violation, a network failure — every one of them ends with the primitive on
// screen and a specific console warning, never a black screen and never a thrown error. A viewer who
// clones the repo and runs it sees a working game before touching an asset, and a viewer whose export
// is wrong sees a working game *plus a sentence telling them what is wrong with it*.
//
// That is also why this module resolves EVERY actor, not only the ones with a `url`: the resolved
// record is the single thing renderers read, so the primitive path and the GLB path cannot drift.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TUNING } from '../config';
import { ACTORS, type ActorId, type ActorModel } from './registry';
import { assembleVat, attachVatVertexIds, makeVatMaterial, type Vat } from './vat';
import type { ClipSpec, VatClip } from './vatCore';

// THE ANIMATION LOOKUP. Five slots, one whole preset library.
//
// The game plays exactly five things — `idle`, `walk`, `run`, `attack` (×3) and `die` — and picks
// between them from numbers the sim already keeps (scene/Swarm.tsx, MODEL-PIPELINE §6). Tripo's
// humanoid autorig, meanwhile, offers ~100 presets, and a viewer rigs their model with whatever
// subset they liked the look of. So each slot below carries the ENTIRE library as a priority-ordered
// fallback chain: the first name that exists in the GLB wins, and a model rigged with `flee_01` and
// no `run` still runs, one rigged with `slash` and no `box_01` still swings.
//
// Only the winner of each chain is baked, so a rig carrying all hundred presets costs six clips of
// VRAM, not a hundred — the chains are a lookup, not a bake list.
//
// Matching is case-insensitive SUBSTRING (that is what lets `run` cover Tripo's
// `Armature|preset:biped:run` untyped), so a family prefix covers its variants for free: `angry`
// takes `angry_01..03`, `run` takes `run_upstairs`, `flee` takes both flees. Prefixes are used
// wherever the variants are the same motion twice. The attacks are the exception and are listed one
// by one — see ATTACKS.

/**
 * Standing still: what an enemy does when it is too far from the player to be doing anything else.
 *
 * Ordered by how much of an idle survives the substitution — a true idle, then an idle with some
 * business in it, then in-place emotes (the hostile ones first, because a grunt that stands there
 * seething reads as an enemy and one that stands there singing reads as a bug), then the presets
 * where the body is busy with a prop the game knows nothing about, which are the last resort.
 */
const IDLE = [
  'idle', 'standing_relax', 'wait',
  'look_around', 'fold_arms', 'stretch', 'warm_up',
  'angry', 'frustrated', 'complain', 'freaky',
  'afraid', 'frightened', 'scared', 'depressed', 'cry', 'sob',
  'agree', 'bow', 'greet', 'wave_goodbye', 'clap', 'cheer', 'laugh', 'sing', 'dance',
  'hug', 'heart_pose',
  'sit', 'jump_rope', 'press-up', 'make_a_call', 'play_mobile_game', 'play_video_game',
] as const;

/** Moving, slowly. Anything whose gait reads as covering ground without hurrying. */
const WALK = [
  'walk', 'swagger', 'dribble', 'climb', 'swim', 'surf', 'turn',
] as const;

/**
 * Moving, fast. `run` already covers `run_upstairs`; `flee` covers both flees, and a fleeing enemy
 * is a running enemy with the head turned.
 *
 * `jump` is last because substring matching cannot tell it from `jump_rope` or `jump_down` — it is
 * only ever reached by a rig that has no run, no flee and no dive, and the spent-name rule in
 * `matchClips` keeps it off a `jump_down` that `die` would rather have.
 */
const RUN = [
  'run', 'flee', 'dive', 'flip', 'jump',
] as const;

/**
 * Swinging at the player. All three attack slots share this one chain, and `matchClips` spends a
 * name when it fills a slot, so they come away with three DIFFERENT clips: a full Tripo rig gets
 * `box_01`/`box_02`/`box_03` exactly as before, and a rig with `slash`, `chop` and `front_kick_01`
 * gets all three of those instead of three copies of the first.
 *
 * Which is why the numbered families are spelled out here rather than collapsed to a prefix: two
 * kicks are two combos worth having, where `angry_01` and `angry_02` are one idle twice.
 *
 * Ordered as: Tripo's actual punches, hand-named rigs, other melee, thrown/cast, tools swung like
 * weapons, sports throws, and finally the `hit_to_*` reactions — those are the body being hit
 * rather than hitting, but they are in-place combat contact, they only ever play inside the attack
 * aura, and a flinch at arm's length beats a T-pose.
 */
const ATTACKS = [
  'box_01', 'box_02', 'box_03', 'attack',
  'slash', 'chop', 'front_kick_01', 'front_kick_02',
  'cast_a_spell', 'fire', 'shoot',
  'dig', 'shovel', 'lift_heavy',
  'pitch_baseball', 'basketball_shot', 'volleyball',
  'football_pass', 'football_catch', 'football_save',
  'hit_to_head', 'hit_to_body_01', 'hit_to_body_02', 'hit_to_stomach', 'hit_to_side',
] as const;

/**
 * Going down, once. `defeat` covers `defeat_02`; `die`/`death` cover hand-named rigs; `fall` and
 * `jump_down` are the presets that end with the body on the floor.
 *
 * A rig carrying both defeats gets whichever its exporter listed first — no substring tells them
 * apart, and they are the same beat.
 *
 * The window below is measured against `defeat` and only ever shortens, so a short `fall` that the
 * window would overrun is baked whole instead (see `planFrames` in vatCore.ts).
 */
const DIE = [
  'defeat', 'die', 'death', 'fall', 'jump_down',
] as const;

/**
 * The clips the game asks every animated actor for, and what it does with them.
 *
 * A missing slot is reported and skipped — the runtime falls back to another slot rather than
 * refusing to animate, so a model with only a run cycle still runs.
 */
export const CLIP_SPECS: ClipSpec[] = [
  { as: 'idle', match: IDLE, loop: true },
  { as: 'walk', match: WALK, loop: true },
  { as: 'run', match: RUN, loop: true },
  // Attacks. Baked as LOOPS even though the heuristic calls an attack a one-shot, because the
  // runtime plays them while an enemy stays in range — a crowd keeps punching, and a wrap-around
  // hitch on a 2-second combo is invisible where a clamped final pose (frozen mid-punch) would not
  // be. The variants are optional: a rig with one attack gets one, and nothing is reported missing.
  { as: 'attack', match: ATTACKS, loop: true },
  { as: 'attack2', match: ATTACKS, loop: true, optional: true },
  { as: 'attack3', match: ATTACKS, loop: true, optional: true },
  // The window skips `defeat`'s 3 s of staggering and bakes the fall itself — see VAT_DIE_FROM in
  // config.ts for the measurement behind the number.
  { as: 'die', match: DIE, loop: false, from: TUNING.VAT_DIE_FROM, trim: TUNING.VAT_DIE_TRIM },
];

/**
 * Triangle budgets from MODEL-PIPELINE §5, as `tris × instances`. Exceeding one is a **warning, not
 * a rejection** — it degrades framerate, it does not break, and Tripo's raw output is routinely
 * above the grunt figure. Decimation is a normal step in this pipeline, not a failure.
 */
const TRI_BUDGET: Record<ActorId, number> = {
  player: 50_000,
  grunt: 4_000,
  runner: 4_000,
  brute: 20_000,
  elite: 100_000,
  orb: 2_000,
  prop: 10_000,
};

/** What a renderer needs to draw one actor. Produced for every entry in ACTORS, always. */
export interface ResolvedActor extends ActorModel {
  id: ActorId;
  /**
   * Ready to instance: normalised to the registry's `height` and centred on the origin, so it drops
   * into the exact convention the primitives already use and `yOffset` keeps its meaning.
   */
  geometry: THREE.BufferGeometry;
  /** The GLB's own material, or null when the renderer should build its own for the primitive. */
  material: THREE.Material | null;
  /** True when a GLB loaded and brought a base-colour texture with it. */
  textured: boolean;
  /**
   * The baked Vertex Animation Texture, when `animated` was set and the bake succeeded.
   *
   * Null is the normal case and not a failure: a static import draws exactly as it did before M6b.
   * When it is present the renderer draws `vatMaterial` instead of `material` and writes an `aVatRow`
   * per instance — see scene/Swarm.tsx.
   */
  vat: Vat | null;
  vatMaterial: THREE.Material | null;
  /** True when the primitive is being drawn — either no `url`, or the GLB was rejected. */
  fallback: boolean;
  /** The registry's `yaw`, defaulted. Narrowed to non-optional so renderers can add it blindly. */
  yaw: number;
  /**
   * Per-instance colour at rest and at a full hit flash.
   *
   * These differ by path and they have to. An untextured primitive carries its tier tint in
   * `instanceColor` and flashes by lerping toward white. A textured model cannot: `instanceColor` is
   * MULTIPLIED into the material, so tinting it green would stain the texture green, and multiplying
   * by white does nothing at all. So a textured actor sits at white (the texture, untouched) and
   * flashes toward an over-bright colour, which multiplies to an actual brightening.
   */
  flashBase: THREE.Color;
  flashHot: THREE.Color;
}

/** How far past white a textured model goes at a full hit flash. Above 1 on purpose — see above. */
const HOT = 2.4;

const resolved = new Map<ActorId, ResolvedActor>();

/** The resolved record for `id`. Safe before `loadActors()` — it falls back to the primitive. */
export function getActor(id: ActorId): ResolvedActor {
  const hit = resolved.get(id);
  if (hit) return hit;
  const made = primitiveActor(id);
  resolved.set(id, made);
  return made;
}

function primitiveActor(id: ActorId): ResolvedActor {
  const model = ACTORS[id];
  return {
    ...model,
    id,
    yaw: model.yaw ?? 0,
    geometry: model.primitive(),
    material: null,
    textured: false,
    vat: null,
    vatMaterial: null,
    fallback: true,
    flashBase: new THREE.Color(model.tint),
    flashHot: new THREE.Color(0xffffff),
  };
}

/** `[models] grunt.glb: ...` — the file first, so a viewer knows which of their exports is at fault. */
function say(level: 'warn' | 'info', url: string, message: string): void {
  const line = `[models] ${url.split('/').pop()}: ${message}`;
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * Collect the drawable meshes in a loaded scene.
 *
 * A SkinnedMesh counts: Tripo's autorig output is skinned even when the clips are irrelevant, and at
 * this stage we want its bind-pose geometry. The rig itself is stage 3's business (M6b).
 */
function meshesIn(root: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh);
  });
  return found;
}

/**
 * Bring a GLB's geometry into the convention the primitives already use: scaled so its **height** is
 * the registry's `height`, and centred on the origin.
 *
 * Height, not longest axis (MODEL-PIPELINE §4): a model holding a weapon out sideways has a wide
 * bounding box, and normalising on the longest axis would shrink the character to make room for the
 * sword. Locking heights is also what keeps DESIGN §12 rule 2 — tier reads from silhouette — true of
 * art we have never seen.
 *
 * Centring is done here rather than demanded of the exporter because it is free and unambiguous, and
 * because "my model is half underground" is a bad first experience. The source's own placement is
 * still reported, since a model authored around its centre usually means the pivot is wrong in the
 * source file and the viewer will want to know before they rig it.
 */
function normalise(geometry: THREE.BufferGeometry, target: number, url: string): THREE.Matrix4 | null {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return null;

  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  if (!(size.y > 1e-6) || !Number.isFinite(size.y)) {
    say('warn', url, `height measured ${size.y.toFixed(4)} — no vertical extent, falling back to the primitive.`);
    return null;
  }

  if (Math.abs(box.min.y) > size.y * 0.05) {
    say(
      'info',
      url,
      `bounds min.y = ${box.min.y.toFixed(3)} rather than ≈ 0 — the model is not authored feet-on-floor. ` +
        `Corrected on import, but re-exporting with the pivot at the feet will save you trouble when you rig it.`,
    );
  }

  // Returned as a matrix as well as applied, because the VAT path has to reproduce EXACTLY this
  // transform on its baked frames (models/vat.ts `assembleVat`). If the two ever disagree the model
  // changes size the instant it starts animating.
  const k = target / size.y;
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(k, k, k);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return new THREE.Matrix4().makeScale(k, k, k).multiply(
    new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z),
  );
}

/**
 * Load and validate one GLB. Resolves to a ResolvedActor either way — the GLB's on success, the
 * primitive's on any failure at all.
 */
async function loadOne(
  id: ActorId,
  loader: GLTFLoader,
  onProgress: (frac: number) => void,
): Promise<ResolvedActor> {
  const model = ACTORS[id];
  const url = model.url!;
  const primitive = primitiveActor(id);

  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    // Covers the 404 the staticAsset404 plugin gives a wrong path (ARCHITECTURE §1.1), a corrupt
    // file, and a Draco-compressed one (no decoder is configured — MODEL-PIPELINE §3).
    say('warn', url, `failed to load (${(err as Error)?.message ?? err}) — falling back to the primitive.`);
    return primitive;
  }

  const meshes = meshesIn(gltf.scene);
  if (meshes.length !== 1) {
    say(
      'warn',
      url,
      `${meshes.length} meshes found, expected 1 — falling back to the primitive. ` +
        `One InstancedMesh draws one geometry; join the parts in Blender (Ctrl+J) and re-export.`,
    );
    return primitive;
  }

  const mesh = meshes[0];
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length !== 1) {
    say(
      'warn',
      url,
      `${materials.length} materials on one mesh, expected 1 — falling back to the primitive. ` +
        `Merge the materials in Blender and re-export.`,
    );
    return primitive;
  }

  gltf.scene.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  // Skin attributes are dead weight for a static instanced draw — stage 3 re-reads them from the
  // source GLB when it bakes the VAT, so nothing is lost by dropping them here.
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  if (!geometry.getAttribute('normal')) {
    say('info', url, 'no normals in the export — computing them, which will look faceted.');
    geometry.computeVertexNormals();
  }

  const norm = normalise(geometry, model.height, url);
  if (!norm) return primitive;

  const index = geometry.getIndex();
  const tris = (index ? index.count : geometry.getAttribute('position').count) / 3;
  if (tris > TRI_BUDGET[id]) {
    say(
      'warn',
      url,
      `${Math.round(tris).toLocaleString()} triangles, over the ${TRI_BUDGET[id].toLocaleString()} ceiling ` +
        `for '${id}' — see docs/MODEL-PIPELINE.md §5. It will still run; decimate if the framerate drops.`,
    );
  }

  const material = (materials[0] as THREE.Material).clone();
  const std = material as THREE.MeshStandardMaterial;
  // The stage has no environment map (scene/Scene.tsx: one directional, one ambient, deliberately
  // non-PBR). A metallic surface with nothing to reflect renders BLACK — and since glTF's default
  // metallicFactor is 1.0, a Tripo export that omits the factor lands exactly there. This is the
  // single most common "my imported model is a silhouette" failure, so it is corrected rather than
  // reported: dielectric is right for this look, and the texture still supplies all the detail.
  if (std.isMeshStandardMaterial && std.metalness > 0) {
    say('info', url, `metalness ${std.metalness} forced to 0 — the stage has no environment map to reflect.`);
    std.metalness = 0;
  }

  const textured = !!(std as THREE.MeshStandardMaterial).map;
  say(
    'info',
    url,
    `loaded for '${id}' — ${Math.round(tris).toLocaleString()} tris, normalised to ${model.height} u tall` +
      `${textured ? ', textured' : ''}.`,
  );

  const rigged = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  const animated =
    model.animated && !rigged
      ? (say('warn', url, 'marked `animated` but the GLB has no skeleton — staying static.'), false)
      : !!model.animated;

  const baked = animated
    ? await bakeVat(id, url, geometry, material, norm.clone().multiply(mesh.matrixWorld), onProgress)
    : null;

  return {
    ...model,
    id,
    yaw: model.yaw ?? 0,
    geometry,
    material,
    textured,
    vat: baked?.vat ?? null,
    vatMaterial: baked?.vatMaterial ?? null,
    fallback: false,
    // A textured model keeps its own colours and brightens on a hit; an untextured one wears the
    // tier tint. See the field docs on ResolvedActor.
    flashBase: new THREE.Color(textured ? 0xffffff : model.tint),
    flashHot: new THREE.Color(textured ? HOT : 1, textured ? HOT : 1, textured ? HOT : 1),
  };
}

/**
 * Run the VAT bake for one actor in a worker, and assemble the result.
 *
 * Returns null on ANY failure, which leaves the actor on its static mesh — the same
 * degrade-don't-break rule the whole module runs on, one rung further up the ladder: VAT falls back
 * to static GLB, static GLB falls back to primitive.
 *
 * `transform` must be the same world × normalisation matrix baked into the static geometry, or the
 * model changes size the instant it starts animating.
 */
async function bakeVat(
  id: ActorId,
  url: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  transform: THREE.Matrix4,
  onProgress: (frac: number) => void,
): Promise<{ vat: Vat; vatMaterial: THREE.Material } | null> {
  const worker = new Worker(new URL('./vat-bake.worker.ts', import.meta.url), { type: 'module' });
  try {
    const baked = await new Promise<{
      meta: { vertexCount: number; totalFrames: number; clips: VatClip[]; missing: string[]; sourceClips: string[] };
      pos: Float32Array;
      nrm: Float32Array;
    }>((resolve, reject) => {
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.done / m.total);
        else if (m.type === 'done') resolve(m);
        else if (m.type === 'error') reject(new Error(m.message));
      };
      worker.onerror = (ev) => reject(new Error(ev.message || 'vat bake worker failed'));
      worker.postMessage({ url, fps: TUNING.VAT_FPS, specs: CLIP_SPECS });
    });

    const { meta, pos, nrm } = baked;
    // The worker baked from the same GLB this actor's draw geometry came from, so a mismatch means
    // the two picked different meshes — the VAT rows would address the wrong vertices and the model
    // would render as an exploded cloud. Refuse rather than draw that.
    if (meta.vertexCount !== geometry.attributes.position.count) {
      say(
        'warn',
        url,
        `VAT baked ${meta.vertexCount} vertices but the draw geometry has ` +
          `${geometry.attributes.position.count} — staying static.`,
      );
      return null;
    }
    if (meta.missing.length) {
      say('info', url, `no clip matched [${meta.missing.join(', ')}] — those slots fall back to another.`);
    }

    const vat = assembleVat({ ...meta, pos, nrm }, transform);
    attachVatVertexIds(geometry);
    say(
      'info',
      url,
      `animated: ${meta.clips.map((c) => `${c.name}×${c.count}`).join(' ')} = ${vat.totalFrames} frames, ` +
        `${(vat.bytes / 1024 / 1024).toFixed(1)} MB of VAT.`,
    );
    return { vat, vatMaterial: makeVatMaterial(material, vat) };
  } catch (err) {
    say('warn', url, `VAT bake failed (${(err as Error)?.message ?? err}) — the model stays static.`);
    return null;
  } finally {
    worker.terminate();
    void id;
  }
}

/**
 * Resolve every actor, loading in parallel. Called once, before the app renders.
 *
 * It never rejects. An unhandled rejection here would leave the page blank, which is the one outcome
 * MODEL-PIPELINE §1 rules out — the whole point is that a broken asset costs you a model, not a game.
 */
export async function loadActors(onProgress?: (frac: number, label: string) => void): Promise<void> {
  const loader = new GLTFLoader();
  const ids = Object.keys(ACTORS) as ActorId[];

  // Progress is reported per actor and averaged, so one slow bake does not make the bar jump to 100%
  // and sit there. Only actors that actually do work contribute.
  const working = ids.filter((id) => ACTORS[id].url);
  const share = new Map<ActorId, number>(working.map((id) => [id, 0]));
  const publish = (label: string) => {
    if (!onProgress || !working.length) return;
    let sum = 0;
    for (const v of share.values()) sum += v;
    onProgress(sum / working.length, label);
  };
  publish('loading models');

  await Promise.all(
    ids.map(async (id) => {
      if (!ACTORS[id].url) {
        resolved.set(id, primitiveActor(id));
        return;
      }
      const step = (frac: number) => {
        share.set(id, Math.min(1, frac));
        publish(ACTORS[id].animated ? `baking ${id}` : `loading ${id}`);
      };
      try {
        resolved.set(id, await loadOne(id, loader, step));
      } catch (err) {
        console.warn(`[models] ${id}: unexpected error while resolving — falling back to the primitive.`, err);
        resolved.set(id, primitiveActor(id));
      }
      share.set(id, 1);
      publish('ready');
    }),
  );
}

export interface ActorReport {
  fallback: boolean;
  textured: boolean;
  url?: string;
  animated: boolean;
  clips: string[];
  frames: number;
  vatMB: number;
}

/** Dev-only summary, so the verification harness can assert on what actually resolved. */
export function actorReport(): Record<string, ActorReport> {
  const out: Record<string, ActorReport> = {};
  for (const [id, a] of resolved) {
    out[id] = {
      fallback: a.fallback,
      textured: a.textured,
      url: a.url,
      animated: !!a.vat,
      clips: a.vat ? a.vat.clips.map((c) => c.name) : [],
      frames: a.vat ? a.vat.totalFrames : 0,
      vatMB: a.vat ? Number((a.vat.bytes / 1024 / 1024).toFixed(2)) : 0,
    };
  }
  return out;
}
