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
import { ACTORS, type ActorId, type ActorModel } from './registry';

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
function normalise(geometry: THREE.BufferGeometry, target: number, url: string): boolean {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return false;

  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(centre);

  if (!(size.y > 1e-6) || !Number.isFinite(size.y)) {
    say('warn', url, `height measured ${size.y.toFixed(4)} — no vertical extent, falling back to the primitive.`);
    return false;
  }

  if (Math.abs(box.min.y) > size.y * 0.05) {
    say(
      'info',
      url,
      `bounds min.y = ${box.min.y.toFixed(3)} rather than ≈ 0 — the model is not authored feet-on-floor. ` +
        `Corrected on import, but re-exporting with the pivot at the feet will save you trouble when you rig it.`,
    );
  }

  const k = target / size.y;
  geometry.translate(-centre.x, -centre.y, -centre.z);
  geometry.scale(k, k, k);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return true;
}

/**
 * Load and validate one GLB. Resolves to a ResolvedActor either way — the GLB's on success, the
 * primitive's on any failure at all.
 */
async function loadOne(id: ActorId, loader: GLTFLoader): Promise<ResolvedActor> {
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

  if (!normalise(geometry, model.height, url)) return primitive;

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

  return {
    ...model,
    id,
    yaw: model.yaw ?? 0,
    geometry,
    material,
    textured,
    fallback: false,
    // A textured model keeps its own colours and brightens on a hit; an untextured one wears the
    // tier tint. See the field docs on ResolvedActor.
    flashBase: new THREE.Color(textured ? 0xffffff : model.tint),
    flashHot: new THREE.Color(textured ? HOT : 1, textured ? HOT : 1, textured ? HOT : 1),
  };
}

/**
 * Resolve every actor, loading in parallel. Called once, before the app renders.
 *
 * It never rejects. An unhandled rejection here would leave the page blank, which is the one outcome
 * MODEL-PIPELINE §1 rules out — the whole point is that a broken asset costs you a model, not a game.
 */
export async function loadActors(): Promise<void> {
  const loader = new GLTFLoader();
  const ids = Object.keys(ACTORS) as ActorId[];

  await Promise.all(
    ids.map(async (id) => {
      if (!ACTORS[id].url) {
        resolved.set(id, primitiveActor(id));
        return;
      }
      try {
        resolved.set(id, await loadOne(id, loader));
      } catch (err) {
        console.warn(`[models] ${id}: unexpected error while resolving — falling back to the primitive.`, err);
        resolved.set(id, primitiveActor(id));
      }
    }),
  );
}

/** Dev-only summary, so the verification harness can assert on what actually resolved. */
export function actorReport(): Record<string, { fallback: boolean; textured: boolean; url?: string }> {
  const out: Record<string, { fallback: boolean; textured: boolean; url?: string }> = {};
  for (const [id, a] of resolved) out[id] = { fallback: a.fallback, textured: a.textured, url: a.url };
  return out;
}
