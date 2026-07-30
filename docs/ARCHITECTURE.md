# TRIPO SURVIVORS — Architecture

How the game is built. [DESIGN.md](DESIGN.md) is the authority on *what* it is;
this document is the authority on *how*, and on the rules that keep it that way.

**Status:** v1 architecture, locked 2026-07-29.

---

## 1. Stack

React 19 · React Three Fiber v9 · drei · three 0.185 · zustand 5 · TypeScript · Vite 8.

Deliberately identical to [Breach](../../Breach)'s stack so the two repos stay
legible side by side — this project is Breach's swarm core distilled, and a reader
who knows one should recognise the other.

Dev server on **5182**, preview on **4182** (free across the sibling repos).

### 1.1 The one non-obvious build setting

Vite's SPA fallback serves `index.html` for any unmatched GET, including a typo'd
asset path. A viewer who drops `goblin.glb` in the wrong folder would get a **200
that isn't a GLB**, and the loader's error would be a parse failure a hundred lines
from the real mistake. So we port Breach's `staticAsset404` plugin
([Breach/vite.config.js:9-27](../../Breach/vite.config.js#L9-L27)): anything under
`/models/` that doesn't exist on disk returns a real 404.

For a project whose entire purpose is "put your file here", this is the single
highest-value twenty lines in the build config.

We do **not** copy Breach's COOP/COEP headers — there's no SharedArrayBuffer here.

## 2. The shape of the codebase

```
src/
  config.ts            CFG (world/grid dims) + TUNING (every tunable number). One file, ~150 lines.
  game.ts              owns ALL simulation state; one step(dt). The spine — read this first.
  input.ts             keyboard + thumbstick -> one normalised vector. Touches `window`, so NOT in sim/.
  sim/                 pure TypeScript. No THREE import anywhere in this folder.
    grid.ts              counting-sort spatial grid            (ported from Breach)
    flow.ts              cost field + SPFA solve + gradient     (ported from Breach)
    world.ts             arena bounds, obstacle list, cost-field stamping
    player.ts            input -> velocity -> position; facing; HP; i-frames
    swarm.ts             enemy SoA + step                       (ported from Breach)
    waves.ts             spawn director
    combat.ts            aura pulses, bolts, damage resolution
    orbs.ts              XP orbs, magnet, pickup
    progression.ts       XP curve, level-ups, unlock table, stat modifiers
  models/registry.ts   THE TUTORIAL SEAM — see MODEL-PIPELINE.md
  store.ts             zustand: human-rate UI state ONLY
  scene/               R3F components. Read state, write matrices. No game logic.
    Scene · Ground · Obstacles · Swarm · Player · Projectiles · Orbs · AuraRing · CameraRig · FpsMeter
    GameLoop             the ONE useFrame that runs game.step(), at priority -1 (§6)
  ui/                  Hud · LevelUp · TouchControls · GameOver
```

### 2.1 The `sim/` purity rule

**Nothing in `sim/` may import `three`.** Not for `Vector3`, not for `MathUtils`.

This is enforced socially (and by a lint test) for three reasons: those modules stay
unit-testable in plain node with no WebGL; the algorithms stay portable into a worker
or another engine later; and — the reason that matters here — a viewer reading
`swarm.ts` to learn how crowd steering works shouldn't have to know a rendering
library to follow it.

Positions are `Float32Array`s of scalars. Maths is `Math.hypot` and friends.

### 2.2 The `scene/` rule, inverted

Nothing in `scene/` may contain game logic. A scene component's entire job is:
read the sim's arrays, write instance matrices, done. If you find yourself deciding
something in `useFrame`, it belongs in `sim/`.

## 3. State, and where it is allowed to live

Three tiers, and confusing them is the classic way to make an R3F game slow.

| Tier | Lives in | Written | Read | Example |
|---|---|---|---|---|
| **Hot** | `Float32Array` in the sim modules | every tick | every frame, imperatively | enemy positions |
| **Warm** | plain fields on the `game` object | every tick | every frame, imperatively | player position, facing, aura radius |
| **Cool** | zustand `store.ts` | throttled to **10 Hz** | React components | HP, XP, level, kills, run clock |

**The rule: per-frame simulation data never passes through React state.** Routing
400 enemy positions through `useState` re-renders the tree 60 times a second and the
game dies. Instance matrices are written imperatively in `useFrame`, bypassing React
entirely — the pattern is copied from
[Breach/src/scene/Swarm.tsx](../../Breach/src/scene/Swarm.tsx), and its rationale is
stated at the top of [Breach/src/store.ts](../../Breach/src/store.ts#L1-L11).

The 10 Hz store sync is a single `syncStore()` at the end of `game.step()`, gated on
an accumulator. HP bars and XP bars updating at 10 Hz is indistinguishable from 60,
and it keeps the React tree almost completely idle during play.

## 4. The three algorithms ported from Breach

Breach's `sim.worker.js` is 4,649 lines and entangled with GPU residency, morale
fields, corpse terrain and a siege economy. We take three ideas out of it and
re-implement them clean. Read the cited ranges; do not copy the file.

### 4.1 Counting-sort spatial grid — `sim/grid.ts`

Source: [Breach/src/sim.worker.js:708-757](../../Breach/src/sim.worker.js#L708-L757).

Two O(n) passes plus one O(cells) prefix sum lay every agent into a flat
`agentIndex` array grouped by cell, with `cellStart` giving each cell's slice. A
neighbour query becomes a contiguous array walk with **zero allocation after warmup**
— no `Map`, no per-tick garbage, no GC sawtooth.

```
buildGrid(g, positions, stride, count, cellSize)
  pass 1:  bin each agent, count per cell
  prefix:  counts -> start offsets (cursor left as each cell's write head)
  pass 2:  scatter agent indices into their cell's slice
```

Keep it **parametric over `(positions, stride, count, cell)`** exactly as Breach has
it. One routine then serves enemies (cell ≈ `SEP_R`), bolts, and orbs, and one
population can scan another's grid — which is how the aura and the bolts do their
broad-phase without a second data structure.

Rebuilt once per tick from live positions. Consumers guard stale indices with
`if (j >= N)` — see §5.

### 4.2 Flow field — `sim/flow.ts`

Source: [Breach/src/sim.worker.js:1840-1972](../../Breach/src/sim.worker.js#L1840-L1972).

A **128 × 128** grid over the 256 × 256 world (2-unit square cells). Two halves:

**The cost field — built once, cached.** Base cost 1 per cell, plus `OBSTACLE_COST`
stamped over each prop's footprint and a one-cell skirt. Obstacles are **expensive,
not impassable** — this is the load-bearing property. Every cell stays reachable, so
the distance field has no zero-gradient dead zone, and there is no case where an
enemy stalls because it is standing somewhere the solver never labelled. A crowd
presses around a rock because going through costs more, not because a wall stopped it.

**The distance solve — re-run on a cadence.** A weighted label-correcting flood
(SPFA) from the seed cell:

```
q = [seedCell];  dist[seed] = 0
while q:
    ci = q.shift()
    for each 4-neighbour ni:
        nd = dist[ci] + cost[ni]
        if nd < dist[ni]:  dist[ni] = nd;  q.push(ni)
```

Then `fillFlowFromDist` converts distance to a per-cell direction with a **one-sided
downhill difference** per axis — not "step to the lowest 4-neighbour", and not Breach's
plain central difference either:

```
down(n) = max(0, dist[centre] - dist[n])     # 0 if n is uphill
fx = down(right) - down(left)
fz = down(up)    - down(down)                # normalise; steepest single step if degenerate
```

**Never snap to the lowest neighbour.** It quantises every heading to 8 directions and
the crowd visibly marches in axis-aligned columns — the most recognisable "this is a
grid" artifact there is. A difference-based gradient gives a continuous direction and
the crowd slides in at any angle.

**And this is where we diverge from Breach**, which uses `fx = dL - dR` with no
floor ([Breach:1972](../../Breach/src/sim.worker.js#L1972)). That form points *uphill*
in exactly the situation this game is built around. A cell tucked behind a long prop is
reached cheaply around the prop's end; its neighbour on the prop side was reached
*through* the `OBSTACLE_COST` skirt and carries a hugely inflated distance. The
inflated term dominates the subtraction, so the vector points at the **higher** of the
two neighbours — and the cell it points into points straight back. Enemies entering
that two-cell trap oscillate forever. Breach never sees it because its walls exist to
be ground through, so nothing lingers in that valley.

Flooring each side at zero fixes it for free. On smooth ground it gives the same
*direction* as the central difference (a linear ramp yields `-a` rather than `-2a`, and
the vector is normalised anyway), so the diagonal continuity the formula exists for is
fully preserved.

It also upgrades "no cell has a zero gradient" from a hope to a **guarantee**. SPFA
relaxes `dist[n] = dist[c] + cost[n]` with strictly positive cost, so every labelled
cell has a predecessor of strictly lower distance — therefore every non-seed cell has
at least one lower 4-neighbour, therefore at least one axis is non-zero. **The swarm
provably cannot stall anywhere on the field.**

One consequence worth knowing before you write a test against this: because the
direction is constant across a cell, a traced path circles the seed *cell* and can
never converge closer than one cell diagonal (~2.83 units) to the seed *point*. In the
game that last stretch is covered by separation and body radius, not by the field.

**The one adaptation from Breach.** Breach's goal is a static castle; ours is the
**moving player**. So the two halves are split: cost is built once at world
construction, and only the seed + solve re-runs — at `FLOW_HZ` (10 Hz), and
immediately whenever the player crosses into a new cell.

At ~16k cells a solve is well under a millisecond, and enemies sampling a field up to
100 ms stale is invisible: a stale field points at where the player was up to 0.1 s
ago, which at 7 u/s is 0.7 units — less than an enemy's own separation radius. The
last few metres of approach are dominated by separation and local steering anyway.

### 4.3 Agent step — `sim/swarm.ts`

Source: [Breach/src/sim.worker.js:3712-3760](../../Breach/src/sim.worker.js#L3712-L3760).

Per enemy, per tick:

1. **Sample the flow field** at the enemy's cell → desired direction, weighted `FLOW_W`.
2. **Scan the 3×3 neighbourhood** in the spatial grid and accumulate **two separate
   things** from each neighbour inside `SEP_R`:
   - `sx, sz` — a **steering bias** away from the neighbour, blended with the flow
     heading before normalisation;
   - `px, pz` — a **hard positional push**, a per-pair MTV where each unit resolves
     *half* the overlap (the neighbour resolves the other half on its own turn, so the
     pair settles at exactly `SEP_R`).
3. **Integrate**: normalise the steering sum, lerp velocity toward `desired * SPEED`
   at `STEER_RESPONSE`, advance position.
4. **Apply the positional push, clamped** to `SEP_PUSH_MAX` per tick.
5. **Resolve obstacles**: 3×3 block-grid lookup, MTV push-out on the axis of least
   penetration, resolving **every** overlapping obstacle in the neighbourhood.
6. **Clamp to world bounds.**

> **The two mistakes this ordering exists to prevent.** Both are load-bearing and both
> were learned the expensive way in Breach.
>
> **Steering-only separation collapses the crowd.** The steering bias gets normalised
> in alongside the flow heading — so the moment the flow toward the player dominates,
> separation is mathematically washed out and the entire swarm converges into one
> dense point. The positional push cannot be normalised away, which is the only reason
> the crowd stays spread. You need both; either alone is visibly wrong.
>
> **An unclamped push tunnels through geometry.** The push is a *sum* over all
> neighbours, so in a dense jam a front-rank unit gets flung a large distance in one
> tick — straight through an obstacle, past the MTV test that would have caught a
> normal-sized step. `SEP_PUSH_MAX` keeps the displacement well under the collision
> reach so the obstacle pass always gets its say. It also stops the spacing
> equilibrium from overshooting and flickering.

Starting tuning, taken from [Breach/src/config.ts:105-131](../../Breach/src/config.ts#L105-L131):

| | | | |
|---|---|---|---|
| `SPEED` 4.0 | `SEP` 0.55 | `SEP_R` 1.1 | `SEP_PUSH` 0.35 |
| `SEP_PUSH_MAX` 0.25 | `FLOW_W` 1.0 | `STEER_RESPONSE` 6 | `UNIT_R` 0.5 |

Per-tier speed overrides come from the tier table in [DESIGN.md §7.1](DESIGN.md).

### 4.4 Explicitly not ported

Morale / threat / support fields · corpse-and-debris terrain · the siege economy ·
defenders and the garrison melee · mega units · every GPU path (`gpuAgents`,
`gpuNav`, `gpuFields`) · the worker bridge and frame protocol · VAT rendering
(deferred to M6, see [MODEL-PIPELINE.md](MODEL-PIPELINE.md)).

## 5. Entity lifetime: swap-remove

Every population — enemies, bolts, orbs — is a struct-of-arrays with a live count `N`,
and removal is **swap-remove**: copy slot `last` over slot `i`, decrement `N`.

```ts
function kill(i: number) {
  const last = --N;
  if (i !== last) copySlot(last, i);
}
```

Consumers holding an index from earlier in the tick guard it with `if (j >= N)`,
exactly as Breach does.

> **Why not a free-stack allocator.** Because a descending free-stack has already
> cost this family of repos real debugging time — twice. In Derez's `walls.ts` and
> Reflow's `traces.ts`, the allocator handed out the *top* of the free stack, so the
> first-ever placement jumped straight to full instance capacity. Invisible on a GPU
> that shrugs off the extra instances, and an ~8× framerate collapse under software
> rendering, which is exactly where the headless verification runs.
>
> Swap-remove keeps live entities densely packed in `[0, N)`, so `mesh.count = N` is
> always exactly right and there is no gap for that class of bug to live in.

Buffers are allocated once at their cap (`MAX_ENEMIES` 400, `MAX_BOLTS` 128,
`MAX_ORBS` 2048) and never grow. At cap, spawning is simply skipped.

### 5.1 Data layouts

| Array | Stride | Fields |
|---|---|---|
| `enemies` | 8 | `x, z, vx, vz, hp, tier, flash, seed` |
| `bolts` | 6 | `x, z, vx, vz, life, pierceLeft` |
| `orbs` | 4 | `x, z, value, age` |

`seed` is a per-enemy random constant used for visual variation (bob phase, slight
scale jitter) so a crowd of identical models doesn't move in lockstep. `flash` is a
decaying hit-flash timer read only by the renderer.

## 6. The tick

`game.step(dt)` runs exactly this order, every frame, from a single `useFrame` in
[scene/GameLoop.tsx](../src/scene/GameLoop.tsx). `dt` is clamped to 50 ms so a
background tab doesn't teleport the swarm on return.

That `useFrame` takes priority **-1**, so R3F sorts it ahead of every renderer's and
the same frame's matrix writes read state that is already current. A *negative*
priority only reorders; a positive one would take over the render loop and leave the
canvas blank.

```
 1. input.sample()          keyboard + touch -> one normalised vector
 2. player.step(dt)         move, clamp to bounds, update facing
 3. flow.maybeSolve()       cadence + player-cell-change check; re-seed and solve
 4. waves.step(dt)          spawn budget -> ring spawns
 5. grid.build(enemies)     one rebuild, reused by every consumer below
 6. swarm.step(dt)          flow + separation + obstacles + integrate
 7. combat.step(dt)         aura pulse; bolt spawn; bolt advance + hit resolution
 8. deaths -> orbs.spawn()  kills drop orbs at the death position
 9. orbs.step(dt)           magnet, pickup -> xp
10. progression.step()      level-ups, apply unlocks
11. player.takeContact()    contact damage from the enemy grid, i-frame gate
12. syncStore()             throttled to 10 Hz
```

Ordering notes that matter: the grid is built **once** (step 5) and read by the
swarm, the aura, the bolts, and contact damage — four consumers, one structure.
Contact damage resolves *after* movement so an enemy that was pushed into the player
this tick deals its damage this tick rather than next.

**Fixed vs variable timestep:** variable, with the 50 ms clamp. The sim has no
stiff constraint solver and nothing here needs determinism across machines (no
netcode, no replays). If either becomes a requirement, a fixed 60 Hz accumulator
drops in at step 0 without touching any subsystem.

## 7. Rendering

One `<instancedMesh>` per population. The pattern, for each:

```tsx
useLayoutEffect(() => { ref.current.count = 0 }, [])   // don't flash a pile at the origin
useFrame(() => {
  const mesh = ref.current
  mesh.count = sim.N
  for (let i = 0; i < sim.N; i++) { /* write matrix, write colour */ }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
})
```

with `frustumCulled={false}` on the mesh — the instances move every frame and the
mesh's own bounding volume is meaningless.

> **InstancedMesh bounding-sphere gotcha.** `InstancedMesh` computes its bounding
> sphere lazily and caches it. If anything ever raycasts against one of these meshes
> before the first frame of matrices lands, the cached sphere is wrong *forever* and
> picking silently misses for the rest of the session. v1 has no instance picking, so
> this is dormant — but if hover-highlight or click-targeting is ever added, null the
> `boundingSphere` after the first matrix write.

Per-population notes:

- **Swarm** — geometry and scale come from `models/registry.ts` per tier. Four tiers
  means four instanced meshes, not one, since they carry different geometry. Colour
  per instance = tier tint lerped toward white by `flash`.
- **Player** — a single mesh, not instanced; the only actor the camera gets close to.
- **Orbs** — one instanced mesh, emissive material, scale pulsed by `age`.
- **Obstacles** — static; matrices written once in `useLayoutEffect`, never in
  `useFrame`.
- **AuraRing** — a single ground-plane ring mesh; radius and opacity driven from the
  aura's live radius and pulse phase.

## 8. Input

`sim/player.ts` consumes one normalised `{x, z}` vector per tick, and does not care
where it came from. Two producers write it:

- **Keyboard** — WASD/arrows, a `keydown`/`keyup` set on `window`, resolved to a
  vector and normalised (so diagonals aren't faster).
- **Touch** — `ui/TouchControls.tsx`, a virtual thumbstick on `pointerdown` /
  `pointermove` / `pointerup` in the left half of the screen, writing the same
  normalised vector. Shown when `matchMedia('(pointer: coarse)')` matches, plus a
  URL-flag override (`?touch=1`) so it can be demonstrated on desktop.

No existing virtual-joystick implementation exists in any sibling repo — this is
written fresh, and it is deliberately about 60 lines.

Movement is camera-relative, but since camera yaw is world-fixed
([DESIGN.md §12](DESIGN.md)) the transform is a constant rotation, not a per-frame
basis computation.

## 9. Camera

`scene/CameraRig.tsx`: target = `player.position + CAM_OFFSET`, where `CAM_OFFSET`
is a fixed vector giving ~45° of downward pitch and a fixed world yaw. Position is
smoothed with a critically-damped follow:

```ts
const k = 1 - Math.exp(-CAM_STIFFNESS * dt)   // frame-rate independent
cam.position.lerp(target, k)
```

`1 - exp(-k·dt)` rather than a raw `lerp(a, b, 0.1)` — the raw form makes the
camera's stiffness a function of framerate, which is subtly wrong on a 144 Hz display
and badly wrong at 20 fps.

The camera never rotates and never collides with obstacles. It is a fixed offset with
lag, and that is the entire system.

## 10. Testing

**Unit tests (vitest) over `sim/`.** These modules take no THREE dependency (§2.1),
so they run in plain node with no WebGL, no canvas, no mocks:

- **Flow field** — with a wall obstacle between seed and a probe cell: the traced path
  routes *around* it, is longer than the straight-line distance, every cell is
  reachable, and no cell has a zero gradient.
- **Spatial grid** — for randomised populations, the neighbours returned by a 3×3 grid
  query are exactly the set found by a brute-force O(n²) scan.
- **Separation equilibrium** — N units seeded on a single point spread to `≥ SEP_R`
  apart within a bounded number of ticks and *stay* there (catches both the collapse
  and the flicker/overshoot failure modes from §4.3).
- **Swap-remove** — after a randomised sequence of spawns and kills, live entities
  occupy exactly `[0, N)` and no live entity was lost or duplicated.
- **Progression** — a scripted kill sequence produces a deterministic level and
  unlock set.

**Browser check.** Playwright (already installed, no sudo needed). Two scripts:

- `scripts/shot.mjs` (`npm run shot`) — headless render check. Canvas renders, zero
  console errors, one screenshot.
- `scripts/drive.mjs` (`npm run verify`) — **headed**, and the one that matters. It
  drives real key and pointer events and asserts against **simulation truth**, read
  through a dev-only `window.__game` seam ([src/game.ts](../src/game.ts)), rather
  than inferring anything from pixels: that checks the whole input path actually
  reaches the sim, which is what a screenshot cannot tell you. It also runs the touch
  path in a phone-sized viewport with `?touch=1`.

  The same seam exposes `__spawn(count, tier, radius)` — the interesting swarm
  behaviour lives at a crowd size the spawn ramp takes minutes to reach, and a
  verification run nobody will wait four minutes for is a verification run nobody
  executes — and `__overlapsProp`, so the script asks the arena itself whether a point
  is inside a prop instead of keeping a copy of the 14 boxes that would drift.

  > **The trap this class of test falls into.** Two of these checks initially failed on
  > state the *script* had created, not the game: teleporting the player across the
  > arena leaves a swarm scattered relative to where they now are, which is not
  > something the real game can produce. Anything asserting about the swarm has to
  > clear the field and set the situation up deliberately first, or it is measuring the
  > harness.

Capture in both goes through **raw CDP `Page.captureScreenshot`** — `page.screenshot()`
hangs on font-wait in this environment. In headed mode, clip the capture to the
emulated viewport; Chromium's window is larger than the page and an unclipped shot is
padded with dead space.

Headless runs under SwiftShader software rendering, so its framerate is a genuine
signal for *instance-count* bugs (§5) but useless as an absolute — anything about
frame budget has to be read from the headed run.

**Manual.** `npm run dev` on 5182: a full run to death on desktop, then the same in a
touch-emulated viewport.

## 11. Performance budget

At `MAX_ENEMIES = 400` the per-tick cost is roughly:

| Work | Cost |
|---|---|
| Grid rebuild | 400 × 2 passes — negligible |
| Flow solve | ~16k cells, 10 Hz — <1 ms amortised |
| Swarm step | 400 × ~9 neighbours — the dominant term, still ~0.2 ms |
| Combat | 400 aura tests + ~8 bolts × grid query |
| Matrix writes | ~400 + orbs |

**Measured** (M2, headed run on GPU hardware, 400 enemies): **0.10 ms**. `game.stepMs`
carries the last tick's cost and `npm run verify` asserts it against the 2 ms budget, so
this number stops being a claim and starts being a regression test.

The whole tick is comfortably inside 2 ms on a modern laptop, which is the point:
**there is no performance reason for a worker at this scale**, and adding one would
cost the project its readability for nothing. The scaling story (worker, then GPU
residency) already exists, fully worked out, in Breach — this repo deliberately does
not retell it.

`MAX_ENEMIES` is a single config constant. Raising it is the intended way for a
viewer to find their own machine's ceiling.
