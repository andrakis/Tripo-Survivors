# TRIPO SURVIVORS

A Survivors-like in React + Three.js, built as the demo vehicle for **Tripo AI
model-import tutorials**.

You are one figure on an open field. Everything else on that field is walking toward
you. Attacks fire themselves — the only verbs are where you stand and what you kill
next. Survive the ramp.

It ships playable with primitive cubes and cones. Drop your own Tripo `.glb` into
`public/models/`, name it in one file, and the cubes become monsters.

> **Status: M1 (player + controls) done, 2026-07-29.** You can drive the character
> around the arena; the swarm arrives in M2. See [ROADMAP.md](docs/ROADMAP.md).

---

## Why this exists

Two purposes, and the second one shapes the first:

1. A genuine Survivors-like — the power-fantasy inversion where you start fragile and
   end the run deleting a screen of enemies per second.
2. A **teaching vehicle for importing 3D models**. Every actor a viewer might want to
   replace is swappable from a single file, and the game must be fun *before* they
   import anything, so a mistake is always recoverable.

Where the two conflict, legibility wins. This is a demo that happens to be a good
game, not a good game we documented afterwards.

## Docs

| | |
|---|---|
| [DESIGN.md](docs/DESIGN.md) | What the game is — loops, weapons, enemy tiers, progression, controls |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it's built — module layout, the tick, the ported algorithms, testing |
| [MODEL-PIPELINE.md](docs/MODEL-PIPELINE.md) | **The one that matters** — the export contract and how to use your own models |
| [ART-STYLE.md](docs/ART-STYLE.md) | The look, and why it's designed to frame art we didn't make |
| [ROADMAP.md](docs/ROADMAP.md) | Build order, M0 → M6, with checkboxes |

## The swarm

The crowd doesn't drive straight at you. It samples a shared **flow field** that
treats obstacles as expensive rather than impassable, so it splits around a pillar
and re-merges behind it, and it holds spacing through a **dual separation** model
(steering bias *plus* a clamped positional push) so it never collapses into a single
point.

That core is ported down from [Breach](../Breach), a 20,000-unit siege RTS in the
same family of repos — three focused algorithms lifted out of a 4,600-line worker and
re-implemented clean, running entirely on the CPU at a 400-unit cap. See
[ARCHITECTURE.md §4](docs/ARCHITECTURE.md).

## Using your own models

The whole change is one line in [`src/models/registry.ts`](src/models/registry.ts):

```diff
-  grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8), scale: 1.0, ... },
+  grunt: { primitive: () => new THREE.BoxGeometry(0.8, 1.2, 0.8), url: '/models/grunt.glb', scale: 1.0, ... },
```

Drop `grunt.glb` in `public/models/`, reload. Models are height-normalised on load, so
the enemy tier hierarchy survives whatever proportions your export has. If the file
is missing or violates the contract, the game logs a specific warning and draws the
primitive — it never breaks.

Full contract and the two gotchas that catch everyone (feet at y≈0, facing +Z) are in
[MODEL-PIPELINE.md](docs/MODEL-PIPELINE.md).

## Running it

```bash
npm install
npm run dev        # http://localhost:5182
```

| | |
|---|---|
| `npm run dev` | dev server on 5182 |
| `npm run build` | typecheck + production build |
| `npm run preview` | serve the build on 4182 |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | vitest over `src/sim/` |
| `npm run verify` | drives the game in a **headed** browser and asserts against sim truth |

**Controls:** WASD or arrows on desktop, virtual thumbstick on touch — add `?touch=1`
to force the thumbstick on a desktop. Attacks are automatic. That's all of them.

## Stack

React 19 · React Three Fiber v9 · drei · three 0.185 · zustand 5 · TypeScript · Vite 8

The simulation runs on the **main thread** in plain TypeScript modules under
`src/sim/`, none of which import `three`. At 400 units the whole tick fits in about
2 ms, so a worker would buy nothing and cost the project its readability.
