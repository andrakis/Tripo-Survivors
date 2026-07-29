# TRIPO SURVIVORS — Roadmap

Ordered to **get a playable loop in front of a camera fastest**, then make it a
game, then make it the tutorial. M0–M2 exist to prove the swarm works; M3–M4 make it
a game; M5 makes it look like one; M6 is the payload the project was built to deliver.

See [DESIGN.md](DESIGN.md) for the systems these milestones serve and
[ARCHITECTURE.md](ARCHITECTURE.md) for how they're built.

**Status:** M0 done 2026-07-29. M1 (player + controls) is next.

---

## Milestone 0 — Scaffold + arena ✅ done (2026-07-29)

**Why first:** every later milestone needs somewhere to run. Keep it small — this is
half a day, not a week.

- [x] `git init`; `package.json` (React 19 · R3F v9 · drei · three 0.185 · zustand 5 ·
      TS · Vite 8), `tsconfig.json` copied from [Breach](../../Breach/tsconfig.json).
      Playwright is pinned to **1.61.0** exactly, matching the browser build already in
      the local cache — `^1.61.0` resolves to 1.62 and demands a fresh download.
- [x] `vite.config.js` — dev **5182**, preview **4182**, plus the `staticAsset404`
      plugin ported from [Breach](../../Breach/vite.config.js#L9-L27). No COOP/COEP.
- [x] `src/config.ts` — `CFG` (world 256×256, grid 128×128), plus the full `TUNING`
      and `COLORS` tables. Written out in full rather than stubbed: the numbers all
      come from DESIGN.md and later milestones just read them.
- [x] `src/sim/world.ts` — the 14 obstacles as data, with `clampToWorld` /
      `overlapsObstacle`. No THREE import (ARCHITECTURE §2.1) — M2 adds cost stamping.
- [x] `src/models/registry.ts` — the full `ACTORS` table with primitives (stage 1).
- [x] `App.tsx` → R3F `<Canvas>` → `scene/Scene.tsx`; ground plane with the 8-unit
      grid, fog matched to ground colour, one directional + one ambient light.
- [x] `scene/Obstacles.tsx` — 14 hand-placed props, matrices written once in
      `useLayoutEffect`.
- [x] `scene/CameraRig.tsx` — fixed offset, fixed yaw, `1 - exp(-k·dt)` smoothing.
      Rotation is set once and never touched; `lookAt` per frame sways as the smoothed
      position lags.
- [x] `scene/FpsMeter.tsx`, `scene/Probe.tsx` (temporary — M1 deletes it).
- [x] `scripts/shot.mjs` — headless render check via raw CDP capture.
- [x] `npm run lint` clean; `npm run build` clean.

**Done when:** `npm run dev` shows the arena at a locked 60 fps and the camera
follows a hard-coded moving target smoothly. **Verified** for rendering, follow, and
zero console errors; the 60 fps half is **not** verified — headless here runs under
SwiftShader software rendering (~25 fps at 1280×800), so framerate needs a look on
real GPU hardware.

### Two things M0 cost more than expected

Both are the kind of bug that reads as "the feature isn't implemented":

- **Fogged long lines vanish.** Fog depth is interpolated between a line segment's
  endpoints, never recomputed along it. A grid line spanning the whole world has both
  endpoints far away, so the interpolated fog depth stays "far" along its entire
  length — including the stretch right next to the player. Half the grid was fully
  fogged out exactly where it mattered and looked like it wasn't rendering at all.
  Fix: emit **one short segment per cell** (`scene/Ground.tsx`), ~4k verts, uploaded
  once.
- **Physically-lit defaults blow out the stage.** three r155+ is physically lit, and
  the intensities that make the arena "bright enough to see" push the grey props past
  the player in value — breaking the one rule the whole look rests on. The stage is
  meant to be underexposed: ambient 0.55, directional 1.5.

## Milestone 1 — Player + controls ⬜ not started

**Why here:** the control feel gates every balance decision after it. Speed values in
[DESIGN.md §5](DESIGN.md) are guesses until someone drives the character.

- [ ] `sim/player.ts` — one normalised input vector in; position, facing, HP,
      i-frame timer out. **No THREE import** ([ARCHITECTURE.md §2.1](ARCHITECTURE.md)).
- [ ] Keyboard producer: WASD/arrows, normalised so diagonals aren't faster.
- [ ] `ui/TouchControls.tsx` — virtual thumbstick, left half of screen, writing the
      *same* vector. Gated on `(pointer: coarse)` plus a `?touch=1` override.
      Nothing to reuse in the sibling repos; ~60 lines, written fresh.
- [ ] `scene/Player.tsx` — reads `models/registry.ts` for geometry/scale/offset.
- [ ] `models/registry.ts` — the full `ACTORS` table with primitives (stage 1).
- [ ] World-bounds clamp; out-of-bounds ground band visible.

**Done when:** keyboard and touch drive the character identically, movement feels
good against the grid, and the character is visibly a registry entry — swapping its
primitive changes what you see with no other edit.

## Milestone 2 — The swarm ⬜ not started

**Why this is the real milestone:** it is the technically hard part and the visual
hook. Everything before it is scaffolding; everything after it is game design.

- [ ] `sim/grid.ts` — counting-sort spatial grid, parametric over
      `(positions, stride, count, cell)`. Ported from
      [Breach:708-757](../../Breach/src/sim.worker.js#L708-L757).
- [ ] `sim/world.ts` — obstacle list; stamps the static flow cost field.
- [ ] `sim/flow.ts` — cached cost field + SPFA distance solve + **central-difference**
      gradient. Ported from [Breach:1840-1972](../../Breach/src/sim.worker.js#L1840-L1972),
      re-seeded on the player at `FLOW_HZ` 10 and on player-cell change.
- [ ] `sim/swarm.ts` — SoA (stride 8), flow + **dual** separation (steering bias *and*
      clamped positional MTV) + obstacle MTV + integrate. Ported from
      [Breach:3712-3760](../../Breach/src/sim.worker.js#L3712-L3760).
- [ ] Swap-remove kill; `MAX_ENEMIES = 400`.
- [ ] `sim/waves.ts` — ring-spawn outside the frustum, `SPAWN_BASE + t/SPAWN_RAMP`.
- [ ] `scene/Swarm.tsx` — one `<instancedMesh>` per tier, `frustumCulled={false}`,
      `count = 0` in `useLayoutEffect`, matrices written imperatively.
- [ ] Tests: flow routes around a wall · grid query matches brute-force O(n²) ·
      separation reaches and holds equilibrium · swap-remove keeps `[0, N)` intact.

**Done when:** the crowd flows around a pillar and re-merges behind it, arrives as a
spread front rather than a line or a blob, and the tests above pass. Verify with a
headless screenshot — and treat a framerate collapse under software rendering as an
instance-count bug until proven otherwise.

## Milestone 3 — Combat ⬜ not started

**Why here:** first point at which it is a game rather than a simulation.

- [ ] `sim/combat.ts` — aura pulse (2/s, radius 3.0, 6 dmg) using the enemy grid as
      its broad-phase; bolts (stride 6) fired along facing on a 0.55 s cadence,
      swept-segment vs the grid, pierce counter.
- [ ] Enemy HP, `flash` hit response, death → scale-punch.
- [ ] Contact damage to the player, 0.6 s i-frames, red vignette.
- [ ] `scene/AuraRing.tsx`, `scene/Projectiles.tsx`.
- [ ] `ui/GameOver.tsx` — time, level, kills, restart.
- [ ] `store.ts` + `ui/Hud.tsx` — HP and run clock, synced at 10 Hz.

**Done when:** a full run is playable start to death, and dying feels like a
consequence of position rather than a surprise.

## Milestone 4 — XP + progression ⬜ not started

- [ ] `sim/orbs.ts` — drop at death position (stride 4), magnet with acceleration
      inside `PICKUP_R`, never expire, `MAX_ORBS = 2048`.
- [ ] `sim/progression.ts` — `xpToNext = ceil(5 * level^1.45)`, the ordered unlock
      table from [DESIGN.md §6.3](DESIGN.md), stat modifiers applied to live tuning.
- [ ] `scene/Orbs.tsx` — instanced, emissive, `age`-pulsed scale.
- [ ] `ui/LevelUp.tsx` — toast + screen-shake + aura flare. No modal, no pause.
- [ ] XP bar in the HUD.
- [ ] Test: a scripted kill sequence yields a deterministic level and unlock set.

**Done when:** a normal run reaches **level 8 by ~2:30** and **level 12 by ~5:00**,
so the whole unlock table is seen in one run.

## Milestone 5 — Escalation + look ⬜ not started

- [ ] The four tiers with their entry times and per-tier stats
      ([DESIGN.md §7.1](DESIGN.md)); elites on their own timer.
- [ ] Per-enemy `seed`-keyed bob and scale jitter so the crowd isn't in lockstep.
- [ ] Palette pass against [ART-STYLE.md](ART-STYLE.md); fog tuned so the spawn ring
      sits at the edge of visibility.
- [ ] Feedback pass: death punch, aura pulse, bolt nudge, level-up shake, hit vignette.
- [ ] Balance pass on the spawn curve against the XP curve.

**Done when:** a run is survivable for ~5 minutes by someone competent, escalation is
legible without reading a number, and a still frame looks like a game.

**This is the point the first tutorial can be recorded.** Everything after it is
about the models.

## Milestone 6 — The tutorial payload ⬜ not started

Split into two independently shippable halves.

### 6a — Static GLTF

- [ ] Loader: `GLTFLoader`, contract validation with specific warnings, height-based
      scale normalisation, **primitive fallback on any failure**
      ([MODEL-PIPELINE.md §3](MODEL-PIPELINE.md)).
- [ ] Registry `url` field honoured by every renderer with no other change — verify
      by swapping one actor and diffing.
- [ ] `public/models/README.md` — the export contract where a viewer will find it.
- [ ] Generate and import the full cast: player, four enemy tiers, orb, props.

**Done when:** the game runs entirely on generated models, and deleting any one GLB
degrades to its primitive with a clear console warning rather than breaking.

### 6b — VAT animation

- [ ] Port [vatCore.js](../../Breach/src/render/vatCore.js) +
      [vat-bake.worker.js](../../Breach/src/vat-bake.worker.js); runtime bake behind
      a load screen.
- [ ] Clip selection driven from existing sim data (speed → run/idle, death timer →
      die/dead). No animation state machine.
- [ ] Rigged Tripo exports for the enemy tiers.

**Done when:** 400 animated enemies run at 60 fps and the bake is invisible to the
player.

---

## Not on this roadmap

Deliberately out of scope; listed so they aren't re-proposed. Card-draft level-ups ·
meta-progression between runs · sound · multiplayer or netcode · a worker or GPU
simulation path · a second arena · bosses.

Rationale for each is in [DESIGN.md §11](DESIGN.md). The scaling story (worker →
GPU residency) is fully worked out in [Breach](../../Breach/docs/ROADMAP.md) and this
repo deliberately does not retell it.
