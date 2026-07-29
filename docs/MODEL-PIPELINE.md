# TRIPO SURVIVORS — Model Pipeline

**This is the document the project exists for.** Everything else is scaffolding
around the question: *how do I get a model I generated in Tripo into a Three.js
game?*

It defines the contract a model must satisfy, the one file you change to use it,
and the staged path from "primitive cubes" to "animated crowd of 400".

---

## 1. The three stages

| Stage | What renders | Status |
|---|---|---|
| **1 — Primitives** | `THREE.BoxGeometry` etc., built in code | v1, ships now |
| **2 — Static GLTF** | Your Tripo `.glb`, instanced, unanimated | [ROADMAP M6](ROADMAP.md) |
| **3 — VAT** | Your `.glb`, animated, at full crowd count | M6, ported from Breach |

Each stage is a strict superset of the last, and **stage 1 is always the fallback**.
If a GLB is missing, fails to load, or violates the contract, the game logs a warning
and draws the primitive. A viewer who clones the repo and runs it sees a working game
before touching a single asset — and a viewer whose export is malformed sees a
*working game plus a specific console warning*, not a black screen.

That fallback rule is non-negotiable. It is the difference between a tutorial where
mistakes are recoverable and one where they aren't.

## 2. The seam: `src/models/registry.ts`

One file maps every logical actor in the game to how it is drawn. Nothing else in the
codebase knows what an actor looks like.

```ts
import * as THREE from 'three';

export interface ActorModel {
  /** Stage 1: the primitive that ships today, and the fallback forever after. */
  primitive: () => THREE.BufferGeometry;
  /** Stage 2: drop a GLB in public/models/ and name it here. That's the whole change. */
  url?: string;
  /** Uniform scale applied after import-normalisation (see §4). */
  scale: number;
  /** Lift so the model's feet sit at y = 0. */
  yOffset: number;
  /** Instance tint. Kept even with a textured model — it drives the hit flash. */
  tint: number;
}

export type ActorId = 'player' | 'grunt' | 'runner' | 'brute' | 'elite' | 'orb' | 'prop';

export const ACTORS: Record<ActorId, ActorModel> = {
  player: { primitive: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), scale: 1.0, yOffset: 0.0, tint: 0xffe9a8 },
  grunt:  { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8),      scale: 1.0, yOffset: 0.0, tint: 0x7fd15a },
  runner: { primitive: () => new THREE.ConeGeometry(0.35, 1.4, 6),      scale: 1.0, yOffset: 0.0, tint: 0x5ad1c8 },
  brute:  { primitive: () => new THREE.BoxGeometry(1.6, 2.0, 1.6),      scale: 1.0, yOffset: 0.0, tint: 0xd1585a },
  elite:  { primitive: () => new THREE.BoxGeometry(2.8, 3.6, 2.8),      scale: 1.0, yOffset: 0.0, tint: 0xc45ad1 },
  orb:    { primitive: () => new THREE.IcosahedronGeometry(0.22, 0),    scale: 1.0, yOffset: 0.3, tint: 0x8fe3ff },
  prop:   { primitive: () => new THREE.BoxGeometry(1, 1, 1),            scale: 1.0, yOffset: 0.0, tint: 0x6b6f7a },
};
```

**Using your own model is one line:**

```diff
-  grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8), scale: 1.0, yOffset: 0.0, tint: 0x7fd15a },
+  grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8), url: '/models/grunt.glb', scale: 1.0, yOffset: 0.0, tint: 0x7fd15a },
```

Drop `grunt.glb` in `public/models/`, add the `url`, reload. Nothing in `scene/`,
`sim/`, or `ui/` changes — that's the property the registry exists to guarantee, and
it should be verified whenever a renderer is touched.

## 3. The export contract

A GLB must satisfy all of these to be instanced. Tripo's default output satisfies
most of them already; the ones that need attention are marked ⚠.

| Requirement | Why |
|---|---|
| **Single mesh** | One `InstancedMesh` draws one geometry. A multi-mesh GLB would need one draw call per part per instance — the thing instancing exists to avoid. |
| **Single material** | Same reason. Merge in Blender if your export has several. |
| **Y-up** | Three.js convention. glTF is Y-up by spec, so this is usually free. |
| ⚠ **Feet at y ≈ 0** | The sim positions actors on the ground plane. A model authored around its centre sinks half-underground; correct it in Blender or with `yOffset`. |
| ⚠ **Facing +Z** | Facing is derived from movement, and the renderer rotates by `atan2` assuming the model looks down +Z. A model facing −Z runs backward — the most common and most confusing import bug. |
| **No Draco compression** | Keeps the loader path minimal (no decoder to configure). Breach *does* use Draco for its static structures, so it's a supported extension later — just not the default here. |
| **Reasonable triangle count** | See §5. |
| **Texture baked into the GLB** | Embedded, not referenced as external files. Tripo exports this way by default. |

### 3.1 Verifying an export

The `staticAsset404` Vite plugin ([ARCHITECTURE.md §1.1](ARCHITECTURE.md)) means a
wrong path gives you a clean 404 rather than a silent HTML-instead-of-GLB parse
error. Beyond that, the loader validates the contract at load time and warns
specifically:

```
[models] grunt.glb: 3 meshes found, expected 1 — falling back to primitive.
[models] grunt.glb: bounds min.y = -0.83, expected ≈ 0 — model will sink. Set yOffset or re-export.
[models] brute.glb: 184,022 triangles at 400 instances — see docs/MODEL-PIPELINE.md §5.
```

Naming the file, the measured value, the expected value, and the fix. A tutorial
viewer hitting one of these should not need to ask anyone what it means.

## 4. Scale normalisation

Generated models arrive at wildly inconsistent sizes — Tripo has no idea your grunt
is meant to be 1.2 units tall. On load the model's bounding box is measured and a
uniform scale applied to bring its **height** to the tier's target, then `scale` in
the registry multiplies that as an artistic override.

| Actor | Target height (world units) |
|---|---|
| Player | 1.7 |
| Grunt | 1.4 |
| Runner | 1.5 (tall and thin) |
| Brute | 2.6 |
| Elite | 4.5 |
| Orb | 0.45 |
| Prop | measured per instance, 3–8 |

Normalising on height rather than on the longest axis is deliberate: a model with a
weapon held out sideways has a wide bounding box, and longest-axis normalisation
would shrink the character to make room for the sword.

This matters more than it sounds. [DESIGN.md §12](DESIGN.md) requires enemy tier to
read from silhouette at a glance, and a viewer's four imported models will differ in
proportion, colour, and detail — but if the *heights* are locked to the table above,
the tier hierarchy survives any art.

## 5. Polygon budget

The relevant number is `triangles × instances`, and the caps are generous because
`MAX_ENEMIES` is only 400.

| Actor | Instances | Recommended tris | Ceiling |
|---|---|---|---|
| Grunt / Runner | up to ~350 | ≤ 1,500 | 4,000 |
| Brute | up to ~40 | ≤ 6,000 | 20,000 |
| Elite | up to ~4 | ≤ 30,000 | 100,000 |
| Player | 1 | ≤ 50,000 | — |
| Prop | ~14 | ≤ 3,000 | 10,000 |

Tripo's raw output is typically well above the grunt figure, so **decimation is a
normal step, not a failure**. Blender's Decimate modifier is the manual route; Breach
uses `meshoptimizer`'s simplifier programmatically
([Breach/src/render/vatCore.js](../../Breach/src/render/vatCore.js), `decimateSkinnedGeometry`),
and the same approach is available here if we want a build-time decimation step.

Note the ceilings are soft — exceeding them degrades framerate, it doesn't break.
The loader warns and keeps going.

## 6. Stage 3 — animation (VAT)

Deferred to M6, but the shape of it is already settled because Breach has shipped it.

**Why not skeletal animation?** Per-instance skeletal skinning costs CPU and a draw
call *per instance*. It's the right answer for a handful of high-poly characters; it
does not survive 400, let alone Breach's 20,000. Breach measured the switch away from
a skeletal pool as SIM 30 → SIM 88 fps.

**Vertex Animation Textures** bake each clip's per-vertex motion into a texture
sampled in the vertex shader. Animation then costs essentially nothing per instance —
no bones, no per-frame CPU work, one instanced draw for the whole crowd. Clip choice
is driven per-instance from data the sim already has (speed → run/idle, a death timer
→ die/dead), so there is no animation state machine to write.

The cost is VRAM proportional to `vertices × frames` — *not* to instance count.

**Runtime baking.** Breach ships the ~1–4 MB source `.glb` and bakes the VAT
**in-browser at load** in a worker, rather than shipping a ~100 MB texture. The bake
core is environment-agnostic so the offline CLI and the browser worker produce
byte-identical output:

- [Breach/src/render/vatCore.js](../../Breach/src/render/vatCore.js) — the pure-maths bake
- [Breach/src/vat-bake.worker.js](../../Breach/src/vat-bake.worker.js) — the browser wrapper
- [Breach/docs/ANIMATED-MODELS-PLAN.md](../../Breach/docs/ANIMATED-MODELS-PLAN.md) — the full spec

For this project that means the animated-model tutorial can be *"export a rigged GLB
from Tripo with its autorig clips, put it in `public/models/`, name it in the
registry"* — with the bake invisible behind a load screen. Which is exactly the story
worth telling.

**Extra contract requirements at stage 3:** the GLB must be rigged (Tripo's bipedal
autorig is the intended source), carry named clips, and be exported **texture-free and
uncompressed** for the baker. Clip names are matched by substring — `run`, `walk`,
`idle`, `attack`, `die` — the same heuristic Breach's `isLoopClip` uses.

## 7. Folder layout

```
public/
  models/
    README.md          the contract, restated where a viewer will actually look
    player.glb         <- your files go here
    grunt.glb
    ...
```

`public/models/README.md` is a short standalone copy of §3 — because someone
navigating to the folder to drop a file is exactly the person who needs the contract,
and they will not have read this document.

Assets are **committed to the repo**. Breach keeps art in a separate gitignored
`modelsrc/` because it has hundreds of megabytes of it; this project has under ten
files and needs `git clone && npm i && npm run dev` to produce a complete, textured
game with no asset step. Different constraints, different answer.

## 8. Tutorial checkpoints

The stages map onto natural tutorial episodes, each independently demoable:

1. **"It runs"** — clone, `npm run dev`, play a run with primitives.
2. **"One model"** — generate a monster in Tripo, export, drop in, one registry line.
   The single highest-value moment in the series: cubes become a monster.
3. **"The whole cast"** — four tiers plus the player, covering scale normalisation
   and the facing/feet gotchas (§3), which is where real viewers will get stuck.
4. **"Props"** — arena obstacles; introduces instancing a second population.
5. **"It moves"** — rigged export, VAT bake, an animated crowd of 400.

Each checkpoint is a working game. None of them requires the next one to exist.
