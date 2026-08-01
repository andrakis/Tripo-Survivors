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
| **1 — Primitives** | `THREE.BoxGeometry` etc., built in code | ships, and is the permanent fallback |
| **2 — Static GLTF** | Your Tripo `.glb`, instanced, unanimated | ✅ [M6a](ROADMAP.md), `src/models/loader.ts` |
| **3 — VAT** | Your `.glb`, animated, at full crowd count | M6b, ported from Breach |

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
  /** Target height in world units. Imported models are normalised to this (see §4). */
  height: number;
  /** Uniform scale applied after import-normalisation. */
  scale: number;
  /** Lift so the model's feet sit at y = 0. */
  yOffset: number;
  /** Extra yaw, for a model exported facing the wrong way. See §3. */
  yaw?: number;
  /** Instance tint. Drives the primitive's colour AND its hit flash — see below. */
  tint: number;
}

export type ActorId = 'player' | 'grunt' | 'runner' | 'brute' | 'elite' | 'orb' | 'prop';

export const ACTORS: Record<ActorId, ActorModel> = {
  player: { primitive: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 8), scale: 1.0, yOffset: 0.0, tint: 0xffe9a8 },
  grunt:  { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8),      scale: 1.0, yOffset: 0.0, tint: 0x7fd15a },
  runner: { primitive: () => new THREE.ConeGeometry(0.35, 1.4, 6),      scale: 1.0, yOffset: 0.0, tint: 0x5ad1c8 },
  brute:  { primitive: () => new THREE.BoxGeometry(1.6, 2.0, 1.6),      scale: 1.0, yOffset: 0.0, tint: 0xbd6265 },
  elite:  { primitive: () => new THREE.BoxGeometry(2.8, 3.6, 2.8),      scale: 1.0, yOffset: 0.0, tint: 0xb06ebb },
  orb:    { primitive: () => new THREE.IcosahedronGeometry(0.22, 0),    scale: 1.0, yOffset: 0.3, tint: 0x8fe3ff },
  prop:   { primitive: () => new THREE.BoxGeometry(1, 1, 1),            scale: 1.0, yOffset: 0.0, tint: 0x4e535d },
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

Renderers read a **resolved** actor (`getActor(id)` in `src/models/loader.ts`), never the
registry entry directly. That record carries the geometry and material to draw with —
the GLB's when one loaded, the primitive's when it did not — so the two paths cannot
drift apart in a renderer that only remembered to handle one of them.

### 2.1 The hit flash, textured vs not

One thing genuinely differs between the paths, and it is worth understanding because it
is the only place an imported model changes how the game *reads*.

Per-instance colour is **multiplied** into the material. An untextured primitive can
therefore carry its tier tint in `instanceColor` and flash by lerping toward white. A
textured model cannot: tinting it green would stain the texture green, and multiplying by
white does nothing at all. So a textured actor sits at white — its texture, untouched —
and flashes toward an **over-bright** colour, which multiplies to an actual brightening.

The practical consequence for [DESIGN §12](DESIGN.md) rule 2: once you import a tier, its
*colour* is your art's, not the palette's. Silhouette and the locked height table are what
keep the tier hierarchy readable after that.

## 3. The export contract

A GLB must satisfy all of these to be instanced. Tripo's default output satisfies
most of them already; the ones that need attention are marked ⚠.

| Requirement | Why |
|---|---|
| **Single mesh** | One `InstancedMesh` draws one geometry. A multi-mesh GLB would need one draw call per part per instance — the thing instancing exists to avoid. |
| **Single material** | Same reason. Merge in Blender if your export has several. |
| **Y-up** | Three.js convention. glTF is Y-up by spec, so this is usually free. |
| ⚠ **Facing +Z** | Facing is derived from movement, and the renderer rotates by `atan2` assuming the model looks down +Z. A model facing −Z runs backward — the most common and most confusing import bug, and **the only contract rule nothing can detect for you**. The escape hatch is `yaw: Math.PI` in the registry; re-exporting is the better fix. |
| **No Draco compression** | Keeps the loader path minimal (no decoder to configure). Breach *does* use Draco for its static structures, so it's a supported extension later — just not the default here. |
| **Reasonable triangle count** | See §5. |
| **Texture baked into the GLB** | Embedded, not referenced as external files. Tripo exports this way by default. |

**Two things the loader fixes rather than demands**, because both are free to correct and
both make a terrible first experience:

- **Placement.** The geometry is centred on import, so a model authored around its centre
  does not sink half-underground. An `info` line still reports it, because a pivot that
  isn't at the feet usually means the source file needs attention before it is rigged.
- **Metalness.** glTF's default `metallicFactor` is **1.0**, and this stage has no
  environment map for a metal surface to reflect — so a Tripo export that omits the factor
  renders as a **black silhouette**. This was the very first thing the real `grunt.glb` hit.
  The loader forces `metalness = 0` and says so.

### 3.1 Verifying an export

The `staticAsset404` Vite plugin ([ARCHITECTURE.md §1.1](ARCHITECTURE.md)) means a
wrong path gives you a clean 404 rather than a silent HTML-instead-of-GLB parse
error. Beyond that, the loader validates the contract at load time and warns
specifically:

```
[models] grunt.glb: loaded for 'grunt' — 807 tris, normalised to 1.4 u tall, textured.
[models] grunt.glb: metalness 1 forced to 0 — the stage has no environment map to reflect.
[models] grunt.glb: 3 meshes found, expected 1 — falling back to the primitive. One
         InstancedMesh draws one geometry; join the parts in Blender (Ctrl+J) and re-export.
[models] brute.glb: 184,022 triangles, over the 20,000 ceiling for 'brute' — see
         docs/MODEL-PIPELINE.md §5. It will still run; decimate if the framerate drops.
```

Naming the file, the measured value, the expected value, and the fix. A tutorial
viewer hitting one of these should not need to ask anyone what it means. `warn` means you
are looking at a primitive; `info` means it loaded and something was adjusted.

## 4. Scale normalisation

Generated models arrive at wildly inconsistent sizes — Tripo has no idea your grunt
is meant to be 1.4 units tall. On load the model's bounding box is measured, a uniform
scale applied to bring its **height** to the tier's target, and the geometry centred on
the origin so it lands in the same convention the primitives already use (which is what
keeps `yOffset` meaning one thing for both paths). `scale` in the registry then multiplies
that as an artistic override.

| Actor | Target height (world units) |
|---|---|
| Player | 1.7 |
| Grunt | 1.4 |
| Runner | 1.5 (tall and thin) |
| Brute | 2.6 |
| Elite | 4.5 |
| Orb | 0.45 |
| Prop | 1.0, then stretched to each obstacle's extents per instance |

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

## 6. Stage 3 — animation (VAT) — ✅ shipped (M6b)

**Turning it on is one more line.** A rigged GLB with Tripo's autorig clips, plus:

```diff
  grunt: { primitive: ..., url: '/models/grunt.glb',
+          animated: true,
           height: 1.4, scale: 1.0, yOffset: 0.7, tint: COLORS.GRUNT },
```

At load, a Web Worker bakes the clips into Vertex Animation Textures behind the
`LOADING MODELS` splash (~1 second for the real grunt), and the crowd animates. If the
GLB has no skeleton, or no clip matches, the actor stays on its static mesh with a
console line saying why — the same degrade-don't-break ladder as everything else:
**VAT → static GLB → primitive.**

**Why not skeletal animation?** Per-instance skeletal skinning costs CPU and a draw
call *per instance*. It's the right answer for a handful of high-poly characters; it
does not survive 400, let alone Breach's 20,000. Breach measured the switch away from
a skeletal pool as SIM 30 → SIM 88 fps.

**Vertex Animation Textures** bake each clip's per-vertex motion into a texture
sampled in the vertex shader (`src/models/vatCore.ts`, ported from Breach's bake core;
`src/models/vat.ts`, the WebGL runtime). Animation then costs essentially nothing per
instance — no bones, no per-frame CPU work, one instanced draw for the whole crowd.
The cost is VRAM proportional to `vertices × frames` — *not* to instance count. The
real grunt bakes 593 frames at 24 fps into ~17 MB.

**Clip choice is sim data, not a state machine.** Each instance carries one float —
its current VAT row — written per frame by `scene/Swarm.tsx` from numbers the sim
already keeps:

| Condition | Clip |
|---|---|
| within `VAT_ATTACK_R` (2.2 u) of the player | `attack` (variant by seed) |
| speed < 0.4 u/s | `idle` |
| speed < 2.6 u/s | `walk` |
| otherwise | `run` |
| death marker | `die`, once over its lifetime, holding the final pose |

**Distance is tested before speed, and that ordering is the whole point.** An enemy
pressed against the player is jammed by separation and barely moving, so on the speed
thresholds alone it plays `idle` — standing perfectly still while killing you. Contact
damage reaches 1.1 u and ranks stack ~1.1 u apart, so 2.2 u catches the rank actually
hurting you plus the one shoving in behind it; the crowd at the aura's edge punches
while the crowd beyond it still runs.

Attack **variants** are picked by the enemy's `seed` — the per-enemy random the SoA has
carried since M2 — so each one keeps its own combo instead of reshuffling every frame,
and a wall of enemies isn't throwing the same punch in unison.

**Clips the bake asks for:** `idle`, `walk`, `run` (loops), `attack` ×3 (loops — they
play for as long as an enemy stays in range, and a wrap-around on a 2-second combo is
invisible where a clamped final pose frozen mid-punch would not be), and `defeat`/`die`
(one-shot). Each spec can list **alternate names**, tried in order, so one table covers
Tripo's `box_01` and a hand-authored `Attack`. The second and third attack variants are
marked optional: a rig with one attack gets one, with nothing reported missing.
Duplicates (Tripo exports every clip twice) are taken once.

### 6.1 Two things Tripo's autorig output *will* do, and what happens

- **Locomotion clips carry root motion.** The grunt's `run` translates its Hip bone
  2.3 units — 2.7× the model's own height — across the floor. In a game where the sim
  owns every position that is wrong twice over: the animation would carry the body away
  from where the game says it stands, and the vertices Blender parked on a
  `neutral_bone` *don't* travel, so the mesh tears into spikes. The baker pins any bone
  whose translation strays more than 15% of model height from its bind pose; rotations
  — where a biped's actual motion lives — pass through untouched. The crowd runs on
  the spot, and the sim does the moving.
- **The `defeat` preset is mostly not dying.** 5.6 seconds: three of staggering, half a
  second of actually falling at t≈3, two of lying still. Baked whole, a death marker's
  0.85 s window shows only the stagger and no body ever hits the ground. The clip spec
  takes a **window** (`from`/`trim`), and the registry bakes `defeat` from 2.7 s for
  1.0 s: the fall, ending flat.

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
