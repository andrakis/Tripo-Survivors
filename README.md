# TRIPO SURVIVORS

A Survivors-like in React + Three.js, built as the demo vehicle for **Tripo AI
model-import tutorials**.

You are one figure on an open field. Everything else on that field is walking toward
you. Attacks fire themselves — the only verbs are where you stand and what you kill
next. Survive the ramp.

It ships playable with primitive cubes and cones. Drop your own Tripo `.glb` into
`public/models/`, name it in one file, and the cubes become monsters.

> **Status: M3 (combat) done, 2026-07-30.** It is a game: the aura grinds the front
> rank, the Lance fires along the way you're moving, the crowd kills you, and the card
> offers you another run. What's missing is the reason to keep playing — XP,
> levels and the unlock table are M4. 400 enemies cost well under half a millisecond
> of tick at 60 fps. See [ROADMAP.md](docs/ROADMAP.md).

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

One of the three needed a real fix on the way down: Breach's central-difference flow
gradient points *uphill* behind a long obstacle, because the cell on the obstacle's side
was reached through a 40× cost skirt and its inflated distance swamps the subtraction.
Enemies oscillate between two cells forever. Flooring each side at zero — counting only
neighbours that are genuinely downhill — fixes it, and makes "the swarm can never stall"
a property you can prove rather than one you hope for.

## The two weapons

Neither has a button. The only verbs are where you stand and which way you last moved.

The **aura** is a ring on the ground that pulses damage twice a second — it rewards
staying close enough that the front rank is inside it, which is also close enough to
get hit. The **Lance** fires along your facing, and facing comes from movement, so it
rewards running *at* the crowd. The optimal line is to retreat while periodically
turning into the swarm to put a piercing bolt down its length.

The bolt's hit test is worth reading if you ever write one: the obvious "distance to the
swept segment" hits the same enemy on three consecutive ticks, which spends the whole
pierce budget on the first target and looks exactly like pierce being broken. Splitting
it — perpendicular distance to the bolt's infinite *line* decides whether, the foot
parameter decides when — gives one hit per enemy per bolt from the geometry alone. See
[ARCHITECTURE.md §4.5](docs/ARCHITECTURE.md).

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
| `npm run serve` | **build, then serve it on 4182** — minified, one bundle |
| `npm run preview` | serve whatever is already in `dist/`, without rebuilding |
| `npm run lint` | `tsc --noEmit` |
| `npm test` | vitest over `src/sim/`, plus the readability rules |
| `npm run verify` | drives the game in a **headed** browser and asserts against sim truth |
| `npm run balance` | plays the game headlessly with a bot for 5 simulated minutes and reports the curve |

`serve` is the one to use for a real look at the shipped game: `preview` on its own will
happily serve a stale `dist/` from an earlier build. Note that the production bundle
strips the `window.__game` debug seam (it is behind `import.meta.env.DEV`), so
`npm run verify` only works against `npm run dev`.

**Controls:** WASD or arrows on desktop, virtual thumbstick on touch — add `?touch=1`
to force the thumbstick on a desktop. Attacks are automatic. Space or Shift dashes, and
there is a dash button under the right thumb on touch. 1/2/3 takes an upgrade card at a
level-up. Enter or Space restarts from the game-over card. That's all of them.

## Stack

React 19 · React Three Fiber v9 · drei · three 0.185 · zustand 5 · TypeScript · Vite 8

The simulation runs on the **main thread** in plain TypeScript modules under
`src/sim/`, none of which import `three`. At 400 units the whole tick fits in about
2 ms, so a worker would buy nothing and cost the project its readability.
