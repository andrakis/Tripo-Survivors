# Put your models here

This folder is the whole asset step. Drop a `.glb` in, name it in one file, reload.

```diff
  // src/models/registry.ts
- grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.4, 0.8),
+ grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.4, 0.8),
+          url: '/models/grunt.glb',
           height: 1.4, scale: 1.0, yOffset: 0.7, tint: COLORS.GRUNT },
```

Nothing under `src/scene/`, `src/sim/` or `src/ui/` changes. That is the property the
registry exists to guarantee.

**Nothing here can break the game.** If a file is missing, malformed, or breaks a rule
below, the actor falls back to its primitive cube and the console tells you exactly what
was wrong. You never get a black screen — you get a working game and a sentence.

---

## The contract

| Requirement | Why | If you break it |
|---|---|---|
| **One mesh** | One `InstancedMesh` draws one geometry. Several meshes means one draw call per part *per instance* — the thing instancing exists to avoid. | Falls back. Join the parts in Blender (`Ctrl+J`). |
| **One material** | Same reason. | Falls back. Merge the materials. |
| **Facing +Z** | Facing comes from movement, and the renderer rotates by `atan2` assuming the model looks down +Z. | **Nothing warns.** Your model runs backward — see below. |
| **No Draco compression** | No decoder is configured. | Falls back with a load error. Re-export uncompressed. |
| **Texture embedded** | External texture files won't be found. Tripo exports embedded by default. | Model loads untextured. |
| Y-up | glTF is Y-up by spec, so this is usually free. | Model lies on its side. |

Two things you do **not** need to get right, because the loader fixes them:

- **Size.** Models are scaled on import so their *height* matches the target below. Tripo
  has no idea how tall your grunt is meant to be.
- **Position / pivot.** The model is centred on import, so a mesh authored around its
  centre does not sink into the floor. You'll see an `info` line if yours wasn't
  feet-on-floor, because it's worth fixing before you rig it.

### Target heights

| Actor | Height (world units) |
|---|---|
| `player` | 1.7 |
| `grunt` | 1.4 |
| `runner` | 1.5 (tall and thin) |
| `brute` | 2.6 |
| `elite` | 4.5 |
| `orb` | 0.45 |
| `prop` | 1.0, then stretched per obstacle |

Heights are locked so enemy tier still reads from silhouette at a glance no matter whose
art is in the game. Use `scale` in the registry as an artistic override.

### Triangle budgets

The number that matters is `triangles × instances`. These are **soft ceilings** — going
over warns and keeps running, it just costs framerate.

| Actor | Instances | Ceiling |
|---|---|---|
| `grunt` / `runner` | up to ~350 | 4,000 |
| `brute` | up to ~40 | 20,000 |
| `elite` | up to ~4 | 100,000 |
| `player` | 1 | 50,000 |
| `prop` | ~14 | 10,000 |

Tripo's raw output is often well above the grunt figure. **Decimating is a normal step,
not a failure** — Blender's Decimate modifier is the usual route.

---

## "My model runs backward"

The most common import problem, and the only one nothing can detect for you: a model
exported facing −Z walks away from the player it is chasing, and everything else looks
fine.

One line, no Blender:

```ts
grunt: { ..., url: '/models/grunt.glb', yaw: Math.PI },
```

Re-exporting facing +Z is the better fix. `yaw` is there so you are never blocked on it.

## "My model is a black silhouette"

Already handled. glTF's default `metallicFactor` is **1.0**, and this game has no
environment map for a metal surface to reflect — so a metallic export renders black. The
loader forces `metalness = 0` and logs an `info` line saying so.

## Reading the console

Every message names your file first:

```
[models] grunt.glb: loaded for 'grunt' — 807 tris, normalised to 1.4 u tall, textured.
[models] grunt.glb: 3 meshes found, expected 1 — falling back to the primitive. …
[models] brute.glb: 184,022 triangles, over the 20,000 ceiling for 'brute' — …
```

`warn` means you're seeing a cube. `info` means it loaded and something was adjusted.

---

The long version, including the animation pipeline that comes next, is in
[docs/MODEL-PIPELINE.md](../../docs/MODEL-PIPELINE.md).
