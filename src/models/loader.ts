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
import { matchClips, projectVatBytes, type ClipSpec, type VatClip } from './vatCore';

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

/**
 * How an actor resolved. `fallback` says the primitive is being drawn; this says WHY, which is the
 * difference between a console line nobody reads and a startup dialog that tells a viewer their
 * file is in the wrong place (ui/ModelPicker.tsx).
 *
 * - `loaded` — the GLB is on screen.
 * - `unset` — no `url` in the registry. Not a failure: the primitive is the shipped art until
 *   somebody names a file.
 * - `missing` — a `url` is configured and the server answered 404. THE case this reports for:
 *   a viewer's file is misnamed or in the wrong folder, and every other symptom is silence.
 * - `rejected` — it was there and could not be used: unreachable, corrupt, or in breach of the
 *   export contract (MODEL-PIPELINE §3). `note` carries the specific sentence.
 */
export type ActorStatus = 'loaded' | 'unset' | 'missing' | 'rejected';

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
  status: ActorStatus;
  /**
   * One sentence about `status`, in the words the console already uses. Empty when a GLB loaded
   * with nothing worth saying about it.
   *
   * The same string goes to the console and to the dialog on purpose: a viewer who reads either one
   * has read the other, and there is no second wording to keep in step.
   */
  note: string;
  /** What actually loaded: the registry's URL, or an uploaded file's name. Empty if nothing did. */
  source: string;
  /** True when `source` is a file the viewer picked this session rather than one the server ships. */
  uploaded: boolean;
  /** Triangles in the drawn geometry — the number MODEL-PIPELINE §5 budgets, or 0 for a primitive. */
  tris: number;
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
    status: model.url ? 'rejected' : 'unset',
    note: model.url
      ? ''
      : `no model configured — drop a .glb in public/models/ and name it in src/models/registry.ts, ` +
        `or upload one here to try it out.`,
    source: '',
    uploaded: false,
    tris: 0,
    flashBase: new THREE.Color(model.tint),
    flashHot: new THREE.Color(0xffffff),
  };
}

/** `[models] grunt.glb: ...` — the file first, so a viewer knows which of their exports is at fault. */
function say(level: 'warn' | 'info', label: string, message: string): void {
  const line = `[models] ${label.split('/').pop()}: ${message}`;
  if (level === 'warn') console.warn(line);
  else console.info(line);
}

/**
 * The primitive, plus the reason it is being drawn — warned once and recorded once.
 *
 * Every early return in `loadOne` comes through here, so a failure can never reach the screen
 * without also reaching the dialog: the console line and `note` are the same string by construction.
 */
function fellBack(id: ActorId, label: string, status: ActorStatus, note: string): ResolvedActor {
  say('warn', label, note);
  return { ...primitiveActor(id), status, note, source: label };
}

/**
 * The HTTP status behind a failed load, or null if the request never got an answer at all.
 *
 * Run ONLY on the failure path, so the happy path still costs exactly one request. It exists to
 * separate the one failure a viewer can act on — "your file is not at that URL" — from the several
 * that need a different sentence, because GLTFLoader reports all of them the same way.
 */
async function probe(url: string): Promise<number | null> {
  try {
    return (await fetch(url, { method: 'HEAD' })).status;
  } catch {
    return null;
  }
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
 *
 * `url` is passed rather than read from the registry so the SAME pipeline serves an uploaded file
 * (`overrideActor`): a viewer's own model is validated, normalised, budgeted and baked by exactly
 * the code their file will meet when they put it in public/models/, and nothing can pass here and
 * fail there. `label` is what the viewer should be told the file is called — a blob: URL is not it.
 */
async function loadOne(
  id: ActorId,
  url: string,
  label: string,
  loader: GLTFLoader,
  onProgress: (frac: number) => void,
): Promise<ResolvedActor> {
  const model = ACTORS[id];
  const uploaded = url.startsWith('blob:');

  let gltf;
  try {
    gltf = await loader.loadAsync(url);
  } catch (err) {
    // Covers the 404 the staticAsset404 plugin gives a wrong path (ARCHITECTURE §1.1), a corrupt
    // file, and a Draco-compressed one (no decoder is configured — MODEL-PIPELINE §3). Which of
    // those it was is worth one extra request to find out: "the file is not there" and "the file is
    // there and unusable" send a viewer to opposite ends of their workflow.
    const code = uploaded ? null : await probe(url);
    const why = (err as Error)?.message ?? String(err);
    return code === 404
      ? fellBack(id, label, 'missing', `${label} was not found (404) — drawing the fallback shape instead.`)
      : fellBack(id, label, 'rejected', `failed to load (${why}) — falling back to the primitive.`);
  }

  const meshes = meshesIn(gltf.scene);
  if (meshes.length !== 1) {
    return fellBack(
      id,
      label,
      'rejected',
      `${meshes.length} meshes found, expected 1 — falling back to the primitive. ` +
        `One InstancedMesh draws one geometry; join the parts in Blender (Ctrl+J) and re-export.`,
    );
  }

  const mesh = meshes[0];
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.length !== 1) {
    return fellBack(
      id,
      label,
      'rejected',
      `${materials.length} materials on one mesh, expected 1 — falling back to the primitive. ` +
        `Merge the materials in Blender and re-export.`,
    );
  }

  gltf.scene.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  // Skin attributes are dead weight for a static instanced draw — stage 3 re-reads them from the
  // source GLB when it bakes the VAT, so nothing is lost by dropping them here.
  geometry.deleteAttribute('skinIndex');
  geometry.deleteAttribute('skinWeight');
  if (!geometry.getAttribute('normal')) {
    say('info', label, 'no normals in the export — computing them, which will look faceted.');
    geometry.computeVertexNormals();
  }

  const norm = normalise(geometry, model.height, label);
  if (!norm) {
    return fellBack(
      id,
      label,
      'rejected',
      'no vertical extent to normalise against — falling back to the primitive.',
    );
  }

  const index = geometry.getIndex();
  const tris = (index ? index.count : geometry.getAttribute('position').count) / 3;
  // A budget miss is a NOTE on a working model, not a rejection (MODEL-PIPELINE §5) — so it is the
  // one thing a `loaded` actor carries a `note` for, and the dialog shows it in the same amber it
  // shows every other thing worth reading rather than the red it shows a failure.
  const over =
    tris > TRI_BUDGET[id]
      ? `${Math.round(tris).toLocaleString()} triangles, over the ${TRI_BUDGET[id].toLocaleString()} ceiling ` +
        `for '${id}' — see docs/MODEL-PIPELINE.md §5. It will still run; decimate if the framerate drops.`
      : '';
  if (over) say('warn', label, over);

  const material = (materials[0] as THREE.Material).clone();
  const std = material as THREE.MeshStandardMaterial;
  // The stage has no environment map (scene/Scene.tsx: one directional, one ambient, deliberately
  // non-PBR). A metallic surface with nothing to reflect renders BLACK — and since glTF's default
  // metallicFactor is 1.0, a Tripo export that omits the factor lands exactly there. This is the
  // single most common "my imported model is a silhouette" failure, so it is corrected rather than
  // reported: dielectric is right for this look, and the texture still supplies all the detail.
  if (std.isMeshStandardMaterial && std.metalness > 0) {
    say('info', label, `metalness ${std.metalness} forced to 0 — the stage has no environment map to reflect.`);
    std.metalness = 0;
  }

  const textured = !!(std as THREE.MeshStandardMaterial).map;
  say(
    'info',
    label,
    `loaded for '${id}' — ${Math.round(tris).toLocaleString()} tris, normalised to ${model.height} u tall` +
      `${textured ? ', textured' : ''}.`,
  );

  // THE RIG DECIDES, not the registry (MODEL-PIPELINE §6). A GLB with a skeleton is baked and
  // animates; one without stays static. There is no line to add and none to forget — which is the
  // whole point, because the viewer arriving here has just finished rigging a model in Tripo and
  // "why is my animated character standing still" is the worst possible next question.
  //
  // `animated: false` in the registry is the one override, for an actor deliberately kept static.
  const rigged = (mesh as THREE.SkinnedMesh).isSkinnedMesh === true;
  const clips = rigged ? matchClips(gltf.animations, CLIP_SPECS).entries : [];
  const projected = projectVatBytes(geometry.attributes.position.count, clips, TUNING.VAT_FPS);
  const ceiling = TUNING.VAT_MB_CEILING * 1024 * 1024;

  // Priced BEFORE the bake, from the clip durations already in the file. Now that nobody opts in,
  // nobody has judged whether the model in front of the loader is affordable — and a VAT is two
  // float textures of vertexCount × frames, so an undecimated character reaches hundreds of
  // megabytes and takes the tab with it. Refusing is a rung on the same ladder as everything else
  // here: too big to animate costs you the animation, not the game.
  const tooBig =
    projected > ceiling
      ? `rigged, but its VAT would be ${(projected / 1024 / 1024).toFixed(0)} MB — over the ` +
        `${TUNING.VAT_MB_CEILING} MB ceiling, so it stays static. Decimate the mesh (the cost is ` +
        `per vertex per frame) or export fewer clips.`
      : '';
  if (tooBig) say('warn', label, tooBig);

  const baked =
    rigged && model.animated !== false && !tooBig
      ? await bakeVat(id, url, label, geometry, material, norm.clone().multiply(mesh.matrixWorld), onProgress)
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
    status: 'loaded',
    note: over || tooBig,
    source: label,
    uploaded,
    tris: Math.round(tris),
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
  label: string,
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
        label,
        `VAT baked ${meta.vertexCount} vertices but the draw geometry has ` +
          `${geometry.attributes.position.count} — staying static.`,
      );
      return null;
    }
    if (meta.missing.length) {
      say('info', label, `no clip matched [${meta.missing.join(', ')}] — those slots fall back to another.`);
    }

    const vat = assembleVat({ ...meta, pos, nrm }, transform);
    attachVatVertexIds(geometry);
    say(
      'info',
      label,
      `animated: ${meta.clips.map((c) => `${c.name}×${c.count}`).join(' ')} = ${vat.totalFrames} frames, ` +
        `${(vat.bytes / 1024 / 1024).toFixed(1)} MB of VAT.`,
    );
    return { vat, vatMaterial: makeVatMaterial(material, vat) };
  } catch (err) {
    say('warn', label, `VAT bake failed (${(err as Error)?.message ?? err}) — the model stays static.`);
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
        // Only the bake reports progress, so by the time this fires that is what is happening —
        // and whether it would has not been knowable from the registry since M6c.
        publish(`baking ${id}`);
      };
      const url = ACTORS[id].url!;
      try {
        resolved.set(id, await loadOne(id, url, url, loader, step));
      } catch (err) {
        console.warn(`[models] ${id}: unexpected error while resolving — falling back to the primitive.`, err);
        resolved.set(id, { ...primitiveActor(id), note: 'unexpected error while resolving — see the console.' });
      }
      share.set(id, 1);
      publish('ready');
    }),
  );
}

/** Every actor the registry defines, in the order the picker lists them. */
export const ACTOR_IDS = Object.keys(ACTORS) as ActorId[];

/** Object URLs handed out for uploads, so each actor's previous one can be revoked. */
const objectUrls = new Map<ActorId, string>();

/**
 * Free the GPU memory behind a record nothing will draw again.
 *
 * A re-upload of an animated actor strands two float textures — 17 MB for the real grunt — and a
 * viewer trying three models on the same slot would strand fifty. Everything here is owned by the
 * record: `loadOne` clones the geometry and material out of the glTF, and the VAT textures are
 * built from arrays that exist nowhere else.
 */
function retire(a: ResolvedActor): void {
  a.geometry.dispose();
  a.material?.dispose();
  a.vatMaterial?.dispose();
  a.vat?.posTex.dispose();
  a.vat?.nrmTex.dispose();
}

/**
 * Replace one actor with a file the viewer picked, through the same pipeline the server path uses.
 *
 * Only ever called from the startup dialog, which is why this can be as simple as it is: no renderer
 * is mounted yet, so nothing is holding the record being replaced and no geometry is hot-swapped
 * under a live scene (the invariant main.tsx exists to protect).
 *
 * Never rejects — a bad upload lands on the primitive with a `note`, exactly as a bad file in
 * public/models/ does.
 */
export async function overrideActor(
  id: ActorId,
  file: File,
  onProgress?: (frac: number) => void,
): Promise<ResolvedActor> {
  const previous = resolved.get(id);
  const stale = objectUrls.get(id);
  const url = URL.createObjectURL(file);
  objectUrls.set(id, url);

  let next: ResolvedActor;
  try {
    next = await loadOne(id, url, file.name, new GLTFLoader(), onProgress ?? (() => {}));
  } catch (err) {
    console.warn(`[models] ${file.name}: unexpected error while resolving — falling back to the primitive.`, err);
    next = { ...primitiveActor(id), status: 'rejected', source: file.name, uploaded: true, note: String(err) };
  }
  // `uploaded` is set here rather than inferred inside loadOne's failure paths, so a rejected upload
  // still reads as the viewer's file rather than as the server's.
  next = { ...next, uploaded: true, source: file.name };
  resolved.set(id, next);

  if (stale) URL.revokeObjectURL(stale);
  // Deferred one turn of the event loop: the caller is about to re-render with `next`, and disposing
  // the old geometry before that commit lands would blank a preview that is still drawing it.
  if (previous) setTimeout(() => retire(previous), 0);
  return next;
}

/**
 * Put an actor back to what the server ships, undoing an upload.
 *
 * The pair to `overrideActor`, and it exists so a mis-picked file is not a dead end: without it the
 * only way back is a reload, which throws away every OTHER model the viewer had set up. Same
 * pipeline again, so the reverted record is byte-for-byte what boot produced.
 */
export async function revertActor(id: ActorId, onProgress?: (frac: number) => void): Promise<ResolvedActor> {
  const previous = resolved.get(id);
  const stale = objectUrls.get(id);
  const url = ACTORS[id].url;

  let next: ResolvedActor;
  if (!url) {
    next = primitiveActor(id);
  } else {
    try {
      next = await loadOne(id, url, url, new GLTFLoader(), onProgress ?? (() => {}));
    } catch (err) {
      console.warn(`[models] ${id}: unexpected error while reverting — falling back to the primitive.`, err);
      next = { ...primitiveActor(id), note: 'unexpected error while reverting — see the console.' };
    }
  }
  resolved.set(id, next);

  objectUrls.delete(id);
  if (stale) URL.revokeObjectURL(stale);
  if (previous) setTimeout(() => retire(previous), 0);
  return next;
}

export interface ActorReport {
  fallback: boolean;
  textured: boolean;
  url?: string;
  status: ActorStatus;
  source: string;
  uploaded: boolean;
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
      status: a.status,
      source: a.source,
      uploaded: a.uploaded,
      animated: !!a.vat,
      clips: a.vat ? a.vat.clips.map((c) => c.name) : [],
      frames: a.vat ? a.vat.totalFrames : 0,
      vatMB: a.vat ? Number((a.vat.bytes / 1024 / 1024).toFixed(2)) : 0,
    };
  }
  return out;
}
