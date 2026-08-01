// Runtime VAT baker, in a Web Worker.
//
// The bake is a few hundred thousand vertex-skinning operations and it is *synchronous* — on the main
// thread it would freeze the tab for the best part of a second with the canvas already up. In here it
// blocks nothing, and the progress messages drive the load screen (index.html `#boot`).
//
// This is what makes the tutorial's story possible: we ship the ~3 MB GLB the viewer generated and
// build the ~13 MB animation texture in their browser at load, rather than asking them to run an
// offline bake step and commit the output. Ported from Breach/src/vat-bake.worker.js, minus its DRACO
// loader (the export contract rules Draco out — MODEL-PIPELINE §3).
//
// Protocol — main thread posts { url, fps, specs }; worker replies:
//   { type: 'progress', done, total }
//   { type: 'done', meta, pos, nrm }   (pos/nrm transferred, not copied)
//   { type: 'error', message }

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { bakeSkinnedMesh, matchClips, type ClipSpec } from './vatCore';

export interface VatBakeRequest {
  url: string;
  fps: number;
  specs: ClipSpec[];
}

/** `self` is typed as a Window in a DOM tsconfig; inside a module worker it is the worker scope. */
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<VatBakeRequest>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

ctx.onmessage = async (e: MessageEvent<VatBakeRequest>) => {
  const { url, fps, specs } = e.data || ({} as VatBakeRequest);
  try {
    if (!url) throw new Error('no url');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const buf = await res.arrayBuffer();
    const gltf = await new GLTFLoader().parseAsync(buf, '');

    gltf.scene.updateMatrixWorld(true);
    let mesh: THREE.SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    if (!mesh) throw new Error('no SkinnedMesh in the GLB — it is not rigged');

    const available = gltf.animations || [];
    if (!available.length) throw new Error('the GLB has no animation clips');

    const { entries, missing } = matchClips(available, specs);
    if (!entries.length) {
      throw new Error(
        `none of the requested clips matched. Wanted [${specs.map((s) => s.match).join(', ')}], ` +
          `the file has [${available.map((c) => c.name).join(', ')}]`,
      );
    }

    // Throttled to ~12/s. postMessage from inside the synchronous bake loop is fine — it queues to
    // the main thread, which paints the bar between frames.
    let lastPost = 0;
    const onFrame = (done: number, total: number) => {
      const t = Date.now();
      if (t - lastPost > 80 || done === total) {
        lastPost = t;
        ctx.postMessage({ type: 'progress', done, total });
      }
    };

    const out = bakeSkinnedMesh(mesh, entries, { fps, root: gltf.scene, onFrame });

    ctx.postMessage(
      {
        type: 'done',
        meta: {
          vertexCount: out.vertexCount,
          fps: out.fps,
          totalFrames: out.totalFrames,
          clips: out.clips,
          missing,
          sourceClips: available.map((c) => c.name),
        },
        pos: out.pos,
        nrm: out.nrm,
      },
      [out.pos.buffer, out.nrm.buffer],
    );
  } catch (err) {
    ctx.postMessage({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
