// The dialog's turntables: every actor, drawn as the game will draw it, in a thumbnail per row.
//
// The dialog could have described the models in text — and for the ones that loaded, text would
// almost do. It would not do for the ones that did NOT: "falling back to the primitive" means
// nothing until you see the green box standing in for your monster. So each row draws the same
// `ResolvedActor` the renderers read (models/loader.ts), fallback included.
//
// **One WebGL context, N scissored viewports.** The obvious build is a `<Canvas>` per row, and it
// works; this does not use it. A context per row means the count of live WebGL contexts is set by
// how many actors the registry happens to hold, which is a number this file does not control and a
// viewer is free to grow — and browsers cap contexts (Chrome at 16) by silently killing the oldest.
// One canvas, laid over the dialog and click-through, renders every actor into the rectangle of its
// row's tile each frame, and the cap stops being anybody's problem.
//
// The scenes are built imperatively rather than in JSX for the reason everything under scene/ is
// (ARCHITECTURE §2.2): once a positive-priority `useFrame` takes over the render loop, R3F is not
// reconciling this canvas anyway, and a scene per row expressed as components would be seven React
// trees standing in for seven `THREE.Scene`s.

import { useEffect, useMemo, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TUNING } from '../config';
import type { ResolvedActor } from '../models/loader';
import type { ActorId } from '../models/registry';
import { vatRow } from '../models/vat';

/** Turntable rate, rad/s. Slow enough to read a silhouette, fast enough to show the model's back. */
const SPIN = 0.6;

/** Framing slack above the model, so nothing clips at the top of its spin. */
const MARGIN = 1.35;

const FOV = 30;

/** The DOM tiles the previews are drawn into, by actor. */
export type Slots = RefObject<Map<ActorId, HTMLElement>>;

/**
 * The hole in the layout one preview draws into.
 *
 * A plain div: the rounded background is CSS, and the model is painted over it from the shared
 * canvas above. Registering the element rather than measuring it here is what lets the stage stay
 * one component while the rows stay ordinary DOM.
 */
export function PreviewTile({ id, slots, size }: { id: ActorId; slots: Slots; size: number }) {
  return (
    <div
      ref={(el) => {
        if (el) slots.current.set(id, el);
        else slots.current.delete(id);
      }}
      style={{ width: size, height: size, borderRadius: 6, background: '#141820', flexShrink: 0 }}
    />
  );
}

interface Stage {
  id: ActorId;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  tick: (t: number) => void;
  dispose: () => void;
}

/** Build one actor's private scene: lights, a turntable, and whatever the loader resolved. */
function makeStage(actor: ResolvedActor): Stage {
  const scene = new THREE.Scene();
  // The stage's own lighting, values included (scene/Scene.tsx). A model that reads as too dark here
  // reads as too dark in the game, which is information rather than a bug in the dialog.
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(40, 60, 25);
  scene.add(key);

  const turntable = new THREE.Group();
  scene.add(turntable);

  const owned: { dispose: () => void }[] = [];
  let step: (t: number) => void = () => {};

  if (actor.vat && actor.vatMaterial) {
    // One VAT instance, playing its idle. Worth the extra lines: a viewer who has just uploaded a
    // rigged model wants to know the bake found their clips, and the honest answer to that is the
    // model moving — a clip count next to a statue is the report a broken bake would give too.
    const mesh = new THREE.InstancedMesh(actor.geometry, actor.vatMaterial, 1);
    // The instances of the real swarm move every frame and this one is a pose sampled out of a
    // texture; neither describes the bind-pose bounds three would cull against.
    mesh.frustumCulled = false;
    mesh.setMatrixAt(0, new THREE.Matrix4().makeScale(actor.scale, actor.scale, actor.scale));
    mesh.instanceMatrix.needsUpdate = true;
    const row = new THREE.InstancedBufferAttribute(new Float32Array(1), 1);
    // Each actor owns its own geometry, so this cannot collide with another row — and it cannot
    // collide with the game either, which sets a swarm-sized `aVatRow` of its own at mount and
    // never exists at the same time as this dialog (App.tsx).
    actor.geometry.setAttribute('aVatRow', row);
    turntable.add(mesh);

    // `idle` for choice, `clips[0]` for certainty: a rig with no idle still has to move.
    const clip = actor.vat.byName.get('idle') ?? actor.vat.clips[0];
    if (clip) {
      step = (t) => {
        row.array[0] = vatRow(clip, (t * TUNING.VAT_FPS) / clip.count);
        row.needsUpdate = true;
      };
    }
    owned.push(mesh);
  } else {
    // The primitive has no material of its own — every renderer builds one, and this is the
    // preview's. Lambert and flat-shaded to match scene/Player.tsx, so a fallback shape looks here
    // exactly like the thing about to appear on the field.
    const material =
      actor.material ?? new THREE.MeshLambertMaterial({ color: actor.tint, flatShading: true });
    if (!actor.material) owned.push(material);
    const mesh = new THREE.Mesh(actor.geometry, material);
    mesh.scale.setScalar(actor.scale);
    turntable.add(mesh);
  }

  // Frame on the registry's height, so the elite's 4.5 units and the orb's 0.45 fill the same box.
  // Reading the cast by silhouette is the point of the row; reading it by scale is not, and at this
  // size a to-scale orb would be three pixels.
  const dist = (actor.height / 2 / Math.tan((FOV / 2) * (Math.PI / 180))) * MARGIN;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  camera.position.set(dist * 0.45, actor.height * 0.18, dist);
  camera.lookAt(0, 0, 0);

  return {
    id: actor.id,
    scene,
    camera,
    tick: (t) => {
      turntable.rotation.y = t * SPIN;
      step(t);
    },
    // Only what this stage made. The geometry and the GLB's material belong to the loader, which
    // frees them when an actor is replaced (`retire` in models/loader.ts) — disposing them here
    // would take the game's model down with the preview.
    dispose: () => owned.forEach((o) => o.dispose()),
  };
}

function Previews({
  actors,
  slots,
  scroller,
}: {
  actors: ResolvedActor[];
  slots: Slots;
  scroller: RefObject<HTMLElement | null>;
}) {
  const { gl, size } = useThree();
  const stages = useMemo(() => actors.map(makeStage), [actors]);
  useEffect(() => () => stages.forEach((s) => s.dispose()), [stages]);

  // Priority 1 takes the render loop off R3F: this canvas has seven cameras and seven scenes, and
  // there is no single automatic render that would be right.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    gl.clear();
    gl.setScissorTest(true);

    // The rows scroll inside the dialog, so a tile half-way out of the list must be half-drawn.
    // VIEWPORT is the whole tile (it sets the projection, and a clipped one would squash the model);
    // SCISSOR is the part still inside the scroller. That split is the entire trick.
    const bounds = scroller.current?.getBoundingClientRect();

    for (const stage of stages) {
      const el = slots.current.get(stage.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;

      const top = bounds ? Math.max(r.top, bounds.top) : r.top;
      const bottom = bounds ? Math.min(r.bottom, bounds.bottom) : r.bottom;
      if (bottom - top < 1) continue;

      stage.tick(t);
      stage.camera.aspect = r.width / r.height;
      stage.camera.updateProjectionMatrix();
      // GL's origin is bottom-left; the DOM's is top-left.
      gl.setViewport(r.left, size.height - r.bottom, r.width, r.height);
      gl.setScissor(r.left, size.height - bottom, r.width, bottom - top);
      gl.render(stage.scene, stage.camera);
    }
    gl.setScissorTest(false);
  }, 1);

  return null;
}

/**
 * The shared canvas. Laid over the dialog and click-through, so the rows underneath keep their
 * buttons and their scrolling and this draws into the gaps they leave.
 */
export function PreviewStage({
  actors,
  slots,
  scroller,
}: {
  actors: ResolvedActor[];
  slots: Slots;
  scroller: RefObject<HTMLElement | null>;
}) {
  return (
    <Canvas
      style={{ position: 'fixed', inset: 0, zIndex: 31, pointerEvents: 'none' }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      // The cameras are per-stage; this one is never used and only exists because R3F wants a default.
      camera={{ position: [0, 0, 5] }}
    >
      <Previews actors={actors} slots={slots} scroller={scroller} />
    </Canvas>
  );
}
