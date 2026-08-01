// VAT runtime: turn baked arrays into GPU textures, and patch a material to read them.
//
// The bake core (vatCore.ts) is a direct port of Breach's. **This file is not** — Breach's runtime is
// WebGPU and builds its vertex stage out of TSL nodes, and this project is plain WebGL through R3F.
// So the sampling is GLSL injected into a stock three material via `onBeforeCompile`.
//
// Two deliberate simplifications over the Breach original, both earned by this game being smaller:
//
//   - **No clip-table texture.** Breach picks the clip in the shader from instance velocity. Here the
//     row is chosen on the CPU and handed over as one instanced float. `scene/Swarm.tsx` is already
//     writing a matrix per enemy per frame; one more attribute is free, and it keeps clip selection
//     as readable TypeScript next to the sim data that drives it — which is exactly what ROADMAP M6b
//     asks for ("driven from existing sim data. No animation state machine").
//   - **UV sampling, not `texelFetch`.** With NearestFilter and texel-centre UVs the result is
//     identical, and it makes no assumption about which GLSL version three compiled the material to.

import * as THREE from 'three';
import type { VatClip } from './vatCore';

export interface Vat {
  /** Per-(vertex, frame) skinned position and normal. Sampled in the vertex shader. */
  posTex: THREE.DataTexture;
  nrmTex: THREE.DataTexture;
  vertexCount: number;
  totalFrames: number;
  clips: VatClip[];
  byName: Map<string, VatClip>;
  /** Approximate GPU cost of the two textures, for the console line and the HUD. */
  bytes: number;
}

export interface BakedArrays {
  vertexCount: number;
  totalFrames: number;
  clips: VatClip[];
  pos: Float32Array;
  nrm: Float32Array;
}

/**
 * Build the runtime VAT from baked arrays.
 *
 * `transform` is applied to every baked position, and its normal matrix to every baked normal. It
 * carries the mesh's world matrix and the same height-normalisation the static path bakes into its
 * geometry (models/loader.ts) — **both paths must agree or the model changes size the instant it
 * starts animating.** Doing it here, once, over the whole array is cheaper and far easier to reason
 * about than carrying a second scale through the shader.
 */
export function assembleVat(baked: BakedArrays, transform: THREE.Matrix4): Vat {
  const { vertexCount, totalFrames, clips, pos, nrm } = baked;

  const nMat = new THREE.Matrix3().getNormalMatrix(transform);
  const v = new THREE.Vector3();
  for (let i = 0; i < totalFrames * vertexCount; i++) {
    const o = i * 4;
    v.set(pos[o], pos[o + 1], pos[o + 2]).applyMatrix4(transform);
    pos[o] = v.x;
    pos[o + 1] = v.y;
    pos[o + 2] = v.z;
    v.set(nrm[o], nrm[o + 1], nrm[o + 2]).applyMatrix3(nMat).normalize();
    nrm[o] = v.x;
    nrm[o + 1] = v.y;
    nrm[o + 2] = v.z;
  }

  const mkTex = (buf: Float32Array) => {
    const t = new THREE.DataTexture(buf, vertexCount, totalFrames, THREE.RGBAFormat, THREE.FloatType);
    // NEAREST because a VAT row is a frame, not a gradient: filtering between rows would blend two
    // poses, and filtering between columns would blend two unrelated vertices.
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };

  const byName = new Map<string, VatClip>();
  for (const c of clips) byName.set(c.name, c);

  return {
    posTex: mkTex(pos),
    nrmTex: mkTex(nrm),
    vertexCount,
    totalFrames,
    clips,
    byName,
    bytes: vertexCount * totalFrames * 4 * 4 * 2, // 4 channels × 4 bytes × 2 textures
  };
}

/**
 * Patch a material so its vertices come from the VAT instead of from the geometry.
 *
 * The material is cloned first: the static path may still be drawing the same source material for
 * another actor, and `onBeforeCompile` is per-material state.
 *
 * `aVatRow` is an **instanced** attribute — one row index per enemy, written every frame by the
 * renderer. `aVatVert` is a per-vertex attribute holding the vertex's own index. That could be
 * `gl_VertexID` instead, but only in GLSL ES 3.00; a 4-byte-per-vertex attribute costs 3.8 KB for
 * this model and works whatever three decides to compile.
 */
export function makeVatMaterial(base: THREE.Material, vat: Vat): THREE.Material {
  const mat = base.clone();

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.vatPos = { value: vat.posTex };
    shader.uniforms.vatNrm = { value: vat.nrmTex };
    shader.uniforms.vatSize = { value: new THREE.Vector2(vat.vertexCount, vat.totalFrames) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform sampler2D vatPos;
        uniform sampler2D vatNrm;
        uniform vec2 vatSize;
        attribute float aVatVert;
        attribute float aVatRow;
        // Texel CENTRE of (vertex, frame). With NearestFilter this is an exact fetch; the +0.5 is
        // what keeps it exact rather than landing on a boundary and rounding unpredictably.
        vec2 vatUv() { return (vec2(aVatVert, aVatRow) + 0.5) / vatSize; }
        `,
      )
      // Position and normal are REPLACED, not offset: the baked frame is the whole pose, in the same
      // object space the bind-pose geometry occupies. Instancing still applies afterwards — three
      // multiplies `instanceMatrix` in <project_vertex>, downstream of both of these.
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `vec3 objectNormal = texture2D( vatNrm, vatUv() ).xyz;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `vec3 transformed = texture2D( vatPos, vatUv() ).xyz;`,
      );
  };

  // Changing onBeforeCompile after a material has been used requires a new program key, or three
  // reuses the cached un-patched program.
  mat.customProgramCacheKey = () => `vat-${vat.vertexCount}x${vat.totalFrames}`;
  mat.needsUpdate = true;
  return mat;
}

/**
 * Attach the per-vertex index attribute the shader needs. Idempotent, and safe to call on a geometry
 * that is also used by the static path — it only ever adds.
 */
export function attachVatVertexIds(geometry: THREE.BufferGeometry): void {
  if (geometry.getAttribute('aVatVert')) return;
  const n = geometry.attributes.position.count;
  const ids = new Float32Array(n);
  for (let i = 0; i < n; i++) ids[i] = i;
  geometry.setAttribute('aVatVert', new THREE.BufferAttribute(ids, 1));
}

/**
 * The texture row for `clip` at normalised progress `phase`.
 *
 * A **loop** wraps: `phase` is taken mod 1, and the clip's rows tile end to end with no duplicated
 * final frame, so the cycle is seamless. A **one-shot** clamps to its last row and holds there,
 * which is what makes "die" end as a body on the ground rather than snapping upright.
 */
export function vatRow(clip: VatClip, phase: number): number {
  if (clip.count <= 1) return clip.start;
  if (clip.loop) {
    const p = phase - Math.floor(phase);
    return clip.start + Math.min(clip.count - 1, (p * clip.count) | 0);
  }
  const p = phase < 0 ? 0 : phase > 1 ? 1 : phase;
  return clip.start + Math.min(clip.count - 1, (p * (clip.count - 1) + 0.5) | 0);
}
