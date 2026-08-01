# TRIPO SURVIVORS — Roadmap

Ordered to **get a playable loop in front of a camera fastest**, then make it a
game, then make it the tutorial. M0–M2 exist to prove the swarm works; M3–M4 make it
a game; M5 makes it look like one; M6 is the payload the project was built to deliver.

See [DESIGN.md](DESIGN.md) for the systems these milestones serve and
[ARCHITECTURE.md](ARCHITECTURE.md) for how they're built.

**Status:** M0–M4 done (M0/M1 2026-07-29, M2 and M3 2026-07-30, M4 and the M4a gameplay
pass 2026-07-31). **M6a shipped early** (2026-07-31) because a model existed to import —
the loader is complete and `grunt.glb` is in the game; the rest of the cast is one
registry line each once the models exist. M5 (escalation + look) is next.

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
zero console errors. The 60 fps half was left open because headless here runs under
SwiftShader software rendering (~25 fps at 1280×800) — **closed during M1**: the
headed `npm run verify` run reports a locked **60 fps** on GPU hardware.

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

## Milestone 1 — Player + controls ✅ done (2026-07-29)

**Why here:** the control feel gates every balance decision after it. Speed values in
[DESIGN.md §5](DESIGN.md) are guesses until someone drives the character.

- [x] `sim/player.ts` — one normalised input vector in; position, facing, HP,
      i-frame timer out. **No THREE import** ([ARCHITECTURE.md §2.1](ARCHITECTURE.md)).
- [x] `game.ts` — the spine arrives here rather than in M2, because the moment there
      are two things to advance (input, player) the tick order from
      [ARCHITECTURE §6](ARCHITECTURE.md) needs somewhere to live. Steps 3–12 are
      commented in place so later milestones slot in rather than renegotiate.
- [x] Keyboard producer (`src/input.ts`): WASD/arrows, normalised so diagonals aren't
      faster, keyed on `event.code` so the WASD *cluster* survives AZERTY, and cleared
      on `blur` so alt-tab doesn't leave the character running.
- [x] `ui/TouchControls.tsx` — virtual thumbstick, left half of screen, writing the
      *same* vector. Gated on `(pointer: coarse)` plus a `?touch=1` override.
      Floating origin, knob moved by writing `transform` on a ref rather than through
      React state.
- [x] `scene/Player.tsx` — reads `models/registry.ts` for geometry/scale/offset.
- [x] `scene/GameLoop.tsx` — the single tick, at `useFrame` priority **-1**.
- [x] World-bounds clamp; out-of-bounds ground band visible.
- [x] `sim/world.ts` — `resolveObstacles`, a least-penetration MTV. In scope because
      [DESIGN §9](DESIGN.md) has the player collide with props, and M2's swarm reuses
      the same resolve against a grid lookup.
- [x] `scripts/drive.mjs` (`npm run verify`) — 16 assertions driven through a **headed**
      browser against sim truth via a dev-only `window.__game`.
- [x] Tests: 17 vitest cases over movement, bounds, obstacles, facing, i-frames and the
      input producers.

**Done when:** keyboard and touch drive the character identically, movement feels
good against the grid, and the character is visibly a registry entry — swapping its
primitive changes what you see with no other edit. **All verified** — 16/16 browser
checks at a locked 60 fps on GPU hardware, `lint`/`build`/`test` clean.

### What M1 learned

- **`PLAYER_RESPONSE` is a real tunable, and it isn't in DESIGN.** Direct velocity
  assignment makes a hard reverse teleport the model through a 180°; anything below
  ~12 feels like ice. 20, as `1 - exp(-k·dt)` so it survives a 144 Hz display.
- **Facing must come from input, not velocity.** Velocity is smoothed, so deriving
  facing from it lags the key press — and from M3 the Lance fires along facing, where
  that lag reads as the weapon being broken rather than the model turning slowly.
  Facing is also *held* on release, so stopping to let the aura work doesn't snap the
  character back to whatever angle the decaying velocity happened to land on.
- **Obstacles have to resolve on the axis of least penetration.** Any other axis kills
  the tangential component and the player sticks to the East Wall instead of sliding
  along it.
- **Props fully occlude the player.** An 8-unit pillar from a 45° camera hides a
  1.7-unit character completely, which breaks [DESIGN §12](DESIGN.md) rule 1 outright.
  Not fixed here — it is a look problem, and it belongs in **M5**'s readability pass
  (shorter props, or the player drawn on top through a depth-test-off pass).

## Milestone 2 — The swarm ✅ done (2026-07-30)

**Why this is the real milestone:** it is the technically hard part and the visual
hook. Everything before it is scaffolding; everything after it is game design.

- [x] `sim/grid.ts` — counting-sort spatial grid, parametric over
      `(positions, stride, count, cell)`. Ported from
      [Breach:708-757](../../Breach/src/sim.worker.js#L708-L757). Plus
      `queryNeighbors`, which the aura and the bolt broad-phase use in M3.
- [x] `sim/world.ts` — obstacle list; stamps the static flow cost field; owns the
      world↔cell mapping.
- [x] `sim/flow.ts` — cached cost field + SPFA distance solve + gradient. Ported from
      [Breach:1840-1972](../../Breach/src/sim.worker.js#L1840-L1972), re-seeded on the
      player at `FLOW_HZ` 10 and on player-cell change. **The gradient is a one-sided
      downhill difference, not Breach's plain central difference** — see below.
- [x] `sim/swarm.ts` — SoA (stride 8), flow + **dual** separation (steering bias *and*
      clamped positional MTV) + obstacle MTV + integrate. Ported from
      [Breach:3790-3900](../../Breach/src/sim.worker.js#L3790).
- [x] Swap-remove kill; `MAX_ENEMIES = 400`.
- [x] `sim/waves.ts` — ring-spawn outside the frustum, `SPAWN_BASE + t/SPAWN_RAMP`,
      time-ramped tier weights, elites on their own timer.
- [x] `config.ts` — the `TIERS` table from [DESIGN §7.1](DESIGN.md).
- [x] `scene/Swarm.tsx` — one `<instancedMesh>` per tier, `frustumCulled={false}`,
      `count = 0` in `useLayoutEffect`, matrices written imperatively.
- [x] Tests: 17 new vitest cases — flow routes around a wall · grid query matches
      brute-force O(n²) · separation reaches and holds equilibrium · swap-remove keeps
      `[0, n)` intact · the spawn director's curve, gating, ring and cap.
- [x] `npm run verify` extended to 26 browser checks, including the routing case.

**Done when:** the crowd flows around a pillar and re-merges behind it, arrives as a
spread front rather than a line or a blob, and the tests above pass. **All verified**
— `shots/swarm-routing.png` is a 36-strong rank split into two streams around the
Keep's corners, 36/36 of which then reached the player behind it. At the 400 cap the
whole tick costs **0.10 ms** against ARCHITECTURE §11's 2 ms budget, at 60 fps.

### What M2 learned

- **Breach's central-difference gradient points UPHILL behind a long prop, and the
  swarm oscillates in place.** This cost most of the milestone. A cell tucked behind
  the East Wall is reached cheaply around the end; its neighbour on the wall side was
  reached *through* the 40× skirt and carries a wildly inflated distance. That
  inflated term dominates `dL - dR`, so the vector points at the **higher** of the two
  neighbours, and the next cell points back — a two-cell trap. Breach never sees it
  because its walls are meant to be ground through, so nothing lingers in that valley.
  Fix: count only neighbours that are genuinely lower than the centre cell. Same
  direction as the central difference on smooth ground, so the diagonal continuity
  that the whole formula exists for is untouched. It also turns *"no cell has a zero
  gradient"* into a **guarantee**: SPFA relaxes with strictly positive cost, so every
  labelled cell has a predecessor of strictly lower distance, so every non-seed cell
  has a lower 4-neighbour. The swarm provably cannot stall.
- **A flow-traced path can never converge closer than one cell diagonal.** The
  direction is constant across a 2-unit cell, so a tracer circles the seed cell rather
  than reaching the seed point. Not a bug — in the game that last 3 units is covered
  by separation and body radius — but it makes any test that asserts "arrived" need a
  cell-sized tolerance, and the first version of that test looked like a pathing bug.
- **`resolveObstacles`/`clampToWorld` had to become out-param writes.** Returning a
  fresh `[x, z]` per call was invisible for one player; at 400 enemies × 2 calls ×
  60 fps it is 48,000 tuples a second straight into the GC.
- **"Verify against sim truth" only works if the harness doesn't create the state it
  measures.** Two browser checks failed on situations the *script* had produced —
  teleporting the player across the arena leaves a swarm scattered relative to where
  they now are. Both had to be rewritten as controlled experiments (clear the field
  first; place the rank deliberately) before they measured the game at all.

## Milestone 3 — Combat ✅ done (2026-07-30)

**Why here:** first point at which it is a game rather than a simulation.

- [x] `sim/combat.ts` — aura pulse (2/s, radius 3.0, 6 dmg) using the enemy grid as
      its broad-phase; bolts (stride 6) fired along facing on a 0.55 s cadence,
      swept-segment vs the grid, pierce counter. Removal is **deferred to one reap
      pass** at the end of the step, so indices stay stable while every weapon reads
      them — see below.
- [x] `sim/grid.ts` — `queryNeighbors` now sizes its scan ring from the query radius
      instead of a fixed 3×3. The aura is 3.0 against a 1.1-unit cell; the old form
      reached 1.65 and would have silently spared two thirds of the ring.
- [x] Enemy HP, `flash` hit response, death → scale-punch (a small marker population
      drawn through the tier's own instanced mesh, so an imported model dies as
      itself with no edit in `scene/`).
- [x] Contact damage to the player — **worst** touching enemy, not the first the cell
      walk reaches — 0.6 s i-frames, red vignette.
- [x] `scene/AuraRing.tsx`, `scene/Projectiles.tsx`.
- [x] `ui/GameOver.tsx` — time, level, kills, restart on click or Enter/Space.
      `resetGame` mutates the singleton in place; every scene component holds a
      reference to it.
- [x] `store.ts` + `ui/Hud.tsx` — HP, run clock and kills, synced at 10 Hz.
- [x] Tests: 19 new vitest cases — aura radius and cadence · bolt pierce, sweep and
      hit-once-per-flight · kill/XP accounting under both weapons at once · contact
      damage and the i-frame gate · the grid at a radius bigger than its cell.
- [x] `npm run verify` extended to 46 browser checks, including the full death →
      card → restart path.

**Done when:** a full run is playable start to death, and dying feels like a
consequence of position rather than a surprise. **All verified** — 46/46 browser
checks at a locked 60 fps, `lint`/`build`/`test` clean. `shots/combat.png` is the
aura grinding an arriving front with bolts in flight; `shots/game-over.png` is the
card over a frozen field. The whole tick with combat at the 400 cap costs
**0.10–0.40 ms** against the 2 ms budget.

### What M3 learned

- **A swept-segment hit test still hits the same enemy three times.** The bolt covers
  0.43 units a tick and its hit radius is 0.75, so an enemy sits inside the swept
  segment for about three consecutive ticks — and a plain "distance to the segment"
  test fires on every one of them. It presents as *pierce not working*: the first
  target eats the whole budget and the bolt dies before reaching the second. The fix
  is to split the test — perpendicular distance to the bolt's infinite **line**
  decides *whether* it can ever hit, and the foot parameter `t ∈ (0, 1]` decides
  *when*. Because `t` falls by exactly 1.0 per tick (the segments tile the line),
  precisely one tick of the flight qualifies. One hit per enemy per bolt, from the
  geometry, with no per-bolt hit list to carry.
- **Kill lazily, in one pass, at the end.** Swap-remove moves a live enemy into the
  dead one's slot, so an index taken a moment ago names somebody else. If the aura
  removed as it went, every bolt later in the same tick would be reading a table that
  had shifted underneath it — and the shared grid would be wrong *during* the phase
  that reads it hardest. Deferring is what keeps the rest of `combat.ts` boring.
- **A full-white hit flash inverts the whole look.** The aura hits everything in the
  ring on the same frame, so flashing to white turned the crowd around the player
  into a single white mass for a quarter of all frames — hiding the player inside it,
  which is [DESIGN §12](DESIGN.md) rule 1 exactly backwards. `FLASH_MIX` caps it at
  0.45; the hit still reads and the tier colour survives underneath.
- **The player needed the see-through pass a milestone early.** M1 logged prop
  occlusion for M5. M3 made it unarguable — at any real crowd density the player is
  simply not on screen, and a game whose only verb is "where you stand" cannot have
  frames where you can't see where you're standing. `scene/Player.tsx` now draws a
  second unlit silhouette with `depthTest: false` at `renderOrder` 999.
- **The M2 browser checks had to be disarmed.** They track specific enemy indices
  across a 14-second window, which was safe only while nothing could die. Three of
  them failed the moment combat shipped — the same "the harness is measuring itself"
  trap M2 hit, arriving from the opposite direction. Pathing checks now silence both
  weapons first, using the same `boltEnabled` field M4's unlock table writes.
- **A flaky M2 unit test, found and fixed in passing.** "Brings in later tiers" culled
  the field with `killEnemy(s, 0)`, which swap-removes the *newest* arrival into slot
  0 and freezes slots 1..49 as the opening seconds of the run forever. The surviving
  population was therefore all grunts plus whatever landed in slot 0, and the test
  turned on one coin flip — it failed about a quarter of the time, on M2's own code.
  It now records tiers as they are spawned.

## Milestone 4 — XP + progression ✅ done (2026-07-31)

- [x] `sim/orbs.ts` — drop at death position (stride 4), magnet with acceleration
      inside `PICKUP_R`, never expire, `MAX_ORBS = 2048`. The acceleration is
      **positional** — speed interpolated from the orb's own distance — which is what
      keeps the stride at the 4 fields [ARCHITECTURE §5.1](ARCHITECTURE.md) documents
      and makes overshoot impossible.
- [x] `sim/progression.ts` — `xpToNext = ceil(5 * level^1.45)`, the ordered unlock
      table from [DESIGN.md §6.3](DESIGN.md) as `{ label, apply(loadout) }` rows, plus
      the level 13+ repeating cycle. Unlocks write **live fields** (`combat.auraR`,
      `combat.boltInterval`, `player.speedMul`, `orbs.magnetR`), never `TUNING`.
- [x] Combat gained the live fields the table needs: `damageMul` (applied inside
      `hit`, so a weapon added later cannot opt out of it), `boltCount` + spread,
      `boltPierce`, `boltInterval`, `orbiters`, `knockback`. `createCombat` now ships
      `boltEnabled: false` — level 3 is what turns it on.
- [x] Kills no longer award XP. Reap queues a **drop** (`x, z, value`); step 8 turns
      the queue into orbs; step 9 banks them on pickup. A kill you never walk back to
      is worth nothing ([DESIGN §8](DESIGN.md)).
- [x] `scene/Orbs.tsx` — instanced, unlit, `age`-popped scale, bob phased off
      position. `scene/Orbiter.tsx` — the level 9 sphere, drawn from the same
      `orbiterPhase` the damage query uses.
- [x] `ui/LevelUp.tsx` — toast, keyed on `lastLevelAt`. No modal, no pause. The
      world-side half is the camera shake (`scene/CameraRig.tsx`, off a decaying
      `prog.shake`) and the aura flare, set by `stepProgression` itself.
- [x] XP bar in the HUD: a full-width strip on the top edge, deliberately unlike the
      HP bar in the corner.
- [x] Tests: 25 new vitest cases — the XP curve against DESIGN §8 · every unlock's
      effect on the live field a weapon reads · the Twin Lance fan, Orbiter cadence
      and Concussion impulse · orb magnet, overshoot, cap and swap-remove · a scripted
      kill sequence yielding a deterministic level and unlock set.
- [x] `npm run verify` extended to 60 browser checks, including the orb-on-the-ground
      path and the full level 12 unlock set.

**Done when:** a normal run reaches **level 8 by ~2:30** and **level 12 by ~5:00**,
so the whole unlock table is seen in one run. **Verified** — 60/60 browser checks at a
locked 60 fps, `lint`/`build`/`test` clean. The tick costs **0.20 ms** with 2000 orbs
*and* 400 enemies live, against ARCHITECTURE §11's 2 ms. `shots/level-up.png` is the
toast over an un-paused field. The XP/spawn arithmetic clears level 8 by 2:30 with
room to spare (`sim/progression.test.ts`); **tightening that against a real played run
is M5's balance pass**, which is where it was always scoped.

### M4a — the gameplay pass ✅ done (2026-07-31)

Five changes off the back of playing M4, three of them fixing something that was wrong
rather than adding something that was missing.

- [x] **Level-ups became a choice.** Every non-weapon level offers three upgrades from a
      repeatable pool and pauses until one is taken (`ui/LevelUpChoice.tsx`, 1/2/3 or a
      click). The weapon unlocks at 3, 5, 7, 9 and 11 stay automatic and unchoosable —
      see [DESIGN §6.3](DESIGN.md) for the split and why it is not all-or-nothing. This
      **reverses a §11 non-goal**; that entry is now struck through with the reasoning.
- [x] **Boosts** (`sim/boosts.ts`, `scene/Boosts.tsx`): Magnet, Invincible, Quad Damage,
      Guns Akimbo and Bloodlust, spawning on a jittered ~40 s clock 11–26 units from the
      player. Timers push onto live fields every tick, so expiry is free and two
      overlapping boosts cannot undo each other.
- [x] **Orbs latch.** Entering the magnet radius sets a flag that is never cleared, and a
      latched orb is floored at 1.7× the player's *current* speed. This was a real bug: a
      few Move Speed picks and the character outran the rim of their own magnet, so orbs
      visibly chased and then stopped.
- [x] **Orbs merge.** Past 120 on the field, ignored orbs older than 12 s sharing a
      4-unit cell consolidate into one worth the sum, twice a second, and grade up
      through four colours by value. No XP is lost.
- [x] **Dash** on a 2.2 s cooldown (Space/Shift, or a right-thumb button on touch), with
      i-frames that outlast the movement. `DASH` meter in the HUD; the cooldown is one of
      the upgrades in the pool.
- [x] Tests: 40 new vitest cases (118 total) — the pause/choice protocol, offer
      distinctness and reachability, every upgrade's effect, each boost's effect and its
      expiry, the latch under a fleeing player, merge conservation and its three gates,
      dash distance/cooldown/i-frames/collision, and the dash input edge.
- [x] `npm run verify` extended to 77 browser checks.

**Verified** — 77/77 browser checks over three consecutive runs at a locked 60 fps,
`lint`/`build`/`test` clean. The tick still costs **0.30 ms** with 2000 orbs and 400
enemies live. New evidence: `shots/level-up-choice.png` (three cards over a frozen
field), `shots/boost.png`, `shots/orb-merge.png`.

### What M4a learned

- **A verification script that levels up now also *pauses*.** From this milestone a
  choice level freezes the run, and almost every check in `drive.mjs` kills things — so
  the first level-up would stop the world and everything after it would be measuring a
  corpse. Fixed with a page-side interval that answers offers through `__choose`, the
  same call the card's own button makes, switched off around the checks that are about
  the card. This is the fourth time the harness has had to be taught not to disturb what
  it measures, and the first time the sim stopping was the disturbance.
- **An HP check cannot also be levelling up.** `standing in a crowd costs HP` failed one
  run in five with `100 -> 125`: the player *gained* health, because the auto-picker took
  Max HP mid-window and that card heals to full. Any check that is a difference between
  two HP readings now runs with XP frozen (magnet radius zeroed — ordinary sim state, the
  same field the Magnet upgrade writes). Worth stating plainly: the choice system made
  several previously-deterministic checks probabilistic, and the failures surface as one
  bad run in several rather than as a red build.
- **A random offer breaks any check that asserts a specific stat.** Three of M4's
  browser checks asserted the old fixed table's outcomes and had to be rewritten around
  what is still deterministic: the weapon spine, and *pick accounting* — every upgrade
  leaves a signature on its live field, so six choice levels must reconstruct to exactly
  six applications. That check immediately earned its place by failing at five, because
  the first version of the arithmetic forgot the Fire rate card existed.
- **The orb latch was invisible until Move Speed stacked.** At level 1 the magnet is
  strictly faster than the player and nothing is wrong. The bug only exists after a few
  +10% picks, which is exactly the regime a play session reaches and a unit test does
  not — the fix is floored against `p.speedMul` rather than a constant precisely so it
  cannot come back at level 30.
- **Merging had to be gated three ways, and each gate is protecting a different thing.**
  Field size (the early scattered trail *is* the record of where you have been), age (an
  orb must have been genuinely ignored, or orbs jump sideways in front of a player who
  is still fighting), and not-latched (an orb already on its way is nobody's to move).
  The first version had only the size gate and orbs teleported out from under the player.
- **Boost effects must not share a field with permanent upgrades.** Folding Quad Damage
  into `combat.damageMul` is the obvious implementation and it is wrong: the first boost
  to expire resets the multiplier and silently deletes every Damage pick the player has
  taken. Separate fields, multiplied at the single point where damage is applied.

### What M4 learned

- **The printed XP table in DESIGN §8 did not match its own formula.** Levels 5, 8 and
  12 read 53 / 106 / 191 against the formula's 52 / 102 / 184. Harmless in isolation,
  but the cumulative column is what the "level 8 by 2:30" target is judged against, and
  a target derived from numbers the game does not use is not a target. The formula is
  the specification; the table is now its output, and a test asserts both.
- **Concussion's first number ended the difficulty curve.** A velocity impulse decays
  against the steering lerp at `STEER_RESPONSE`, so the displacement it buys is about
  `0.17 × KNOCKBACK` — at 14 that is 2.3 units, twice a second. A brute (2.2 u/s) and
  an elite (1.8 u/s) can then *never* close, and level 11 quietly made the player
  untouchable. It showed up as the M3 death check failing: the harness could no longer
  kill a level-12 character with fourteen brutes standing on them. At 7 the fast crowd
  walks straight back in and only the heavies are held off, which is what a defensive
  unlock should buy.
- **A verification script that levels up stops testing what it used to.** The M3
  checks assumed a fixed loadout, and by section 12 the player had earned four levels
  off the crowds those checks kill — a wider aura, 25% more damage. The death path in
  particular had to be pinned to a *fresh* run, because "does contact damage beat
  i-frames" cannot be asked of a character whose aura is holding the crowd off. Same
  trap as M2's and M3's, from a third direction: the harness now changes the game as a
  side effect of exercising it.
- **The unlock table wants to be data, and the restart is why.** Twelve levels of
  modifiers are undone by replacing three objects (`combat`, `player`, `orbs`) — there
  is nothing to unwind — but only because every row writes a live field instead of
  mutating `TUNING`. Both the unit tests and a browser check assert that `TUNING` still
  holds its config.ts values after a level-12 run, since the failure mode is a *second*
  run of a session silently starting with the first one's stats.
- **XP through orbs is a real mechanic, not indirection.** Routing it through a pickup
  is what makes the field behind you worth something and what makes a far-flung kill
  free of charge. It also moved `xp` off `combat` entirely — combat now queues a drop
  and knows nothing about orbs, which is what kept step 8 a five-line loop in
  [game.ts](../src/game.ts) rather than a dependency.

## Milestone 5 — Escalation + look ⬜ not started

- [ ] The four tiers with their entry times and per-tier stats
      ([DESIGN.md §7.1](DESIGN.md)); elites on their own timer.
- [ ] Per-enemy `seed`-keyed bob and scale jitter so the crowd isn't in lockstep.
- [ ] Palette pass against [ART-STYLE.md](ART-STYLE.md); fog tuned so the spawn ring
      sits at the edge of visibility. **Two known offences against
      [DESIGN §12](DESIGN.md) rule 1 are waiting here:** the brutes are large and
      saturated enough to out-read the player, and the props are 8-unit blocks in a
      value range that competes with the cast. M3 already took the third — the
      player's see-through pass — because an invisible player made the milestone's own
      acceptance criterion unjudgeable.
- [ ] Feedback pass: a second look at everything M3 and M4 shipped (death punch, aura
      flare, hit vignette, `FLASH_MIX`, the level-up shake and toast) once there is a
      full run to tune against.
- [ ] Balance pass on the spawn curve against the XP curve. M4 checked only that the
      two are within an order of magnitude of each other; the "level 8 by 2:30, level
      12 by 5:00" target needs a played run, not arithmetic.
- [ ] A second look at `KNOCKBACK` and the Orbiter's cadence against a real late run —
      both were sized against the swarm's speeds on paper (see *What M4 learned*).

**Done when:** a run is survivable for ~5 minutes by someone competent, escalation is
legible without reading a number, and a still frame looks like a game.

**This is the point the first tutorial can be recorded.** Everything after it is
about the models.

## Milestone 6 — The tutorial payload ⬜ not started

Split into two independently shippable halves.

### 6a — Static GLTF ✅ code done (2026-07-31) · cast blocked on assets

- [x] `src/models/loader.ts` — `GLTFLoader`, contract validation with specific warnings,
      height normalisation, and **primitive fallback on every failure path**
      ([MODEL-PIPELINE.md §3](MODEL-PIPELINE.md)). Resolves *every* actor, not just the
      ones with a `url`, so the primitive and GLB paths cannot drift.
- [x] Registry `url` honoured by every renderer. `Swarm`, `Player`, `Orbs` and
      `Obstacles` now read `getActor(id)` instead of building geometry themselves;
      importing an actor is one line in `registry.ts` and nothing else.
- [x] `yaw` added to the registry — the escape hatch for the one contract rule nothing
      can detect, a model exported facing −Z.
- [x] Load gate: `main.tsx` resolves models before the first render, behind a
      `LOADING MODELS` splash in `index.html`. No cubes-turn-into-monsters pop.
- [x] `public/models/README.md` — the contract where a viewer will actually look.
- [x] `npm run verify` extended to 84 browser checks, including a run with the GLB
      request **aborted** to prove the fallback path end to end.
- [ ] **The full cast — blocked on assets.** Only `grunt.glb` exists in `public/models/`.
      The player, runner, brute, elite, orb and prop entries have no `url` and draw their
      primitives; each is one line once a model exists.

**Done when:** the game runs entirely on generated models, and deleting any one GLB
degrades to its primitive with a clear console warning rather than breaking. **The second
half is verified** — the browser run aborts the GLB request and asserts the game still
comes up, on primitives, with a named warning and no page error. The first half needs the
other six models.

### What M6a learned

- **The first real Tripo export rendered as a black silhouette, and the cause is a spec
  default.** glTF's `metallicFactor` defaults to **1.0**, the file omits it, and this
  stage deliberately has no environment map — so a fully-metallic surface has nothing to
  reflect and shades to black. The loader forces `metalness = 0` and logs it. This is the
  single highest-value thing in the milestone for the tutorial: it is invisible in Blender,
  invisible in every glTF viewer that ships an HDRI, and universal to Tripo output.
- **Tripo's output is rigged even when you only want a static mesh.** `grunt.glb` carries
  a skeleton, 16 clips and `JOINTS_0`/`WEIGHTS_0`. Stage 2 takes the bind-pose geometry and
  strips the skin attributes; the rig is exactly what M6b will bake into a VAT, so nothing
  is wasted — but the loader has to accept a `SkinnedMesh` where it was looking for a
  `Mesh`, which is not obvious until it silently finds zero meshes and falls back.
- **A textured import changes what per-instance colour can mean.** `instanceColor` is
  multiplied into the material: it can tint an untextured primitive, but it can only
  *darken* a texture, and the hit flash needs to go the other way. Textured actors now sit
  at white and flash toward an over-bright colour. The knock-on is a design one — once a
  tier is imported, its colour belongs to the art, and DESIGN §12 rule 2 rests on
  silhouette and the locked height table alone.
- **The model swap cost the facing pip.** It is authored at +Z in the player's group space,
  so it is both redundant against a model with a readable front and actively wrong the
  moment `yaw` turns a backward export around — it would swing with the correction. Now
  rendered only on the primitive.
- **A one-off shader compile read as a framerate regression.** `holds 60 fps at cap`
  started failing about one run in three at 54 fps. It was not sustained cost: 400
  imported models benchmark at a flat 60 (median, min *and* max, over four runs). The
  harness was reading a **single** 0.5 s `FpsMeter` bucket 2.5 s after 400 instances first
  appear, and a `MeshStandardMaterial` with three textures compiles a bigger program than
  a Lambert box — the transient lands inside one bucket. All four fps checks now take the
  median of three. Worth stating because the instinct was to go optimise something, and
  the measurement was wrong rather than the game.
- **A module singleton and HMR do not mix, and the symptom was a ghost.** Editing anything
  under `sim/` re-evaluated `game.ts` and built a NEW singleton while React Fast Refresh
  kept the live component tree holding the old one. The visible result was the level-up
  card sitting there with clicks doing nothing, because `ui/LevelUpChoice` was mutating one
  `game` and `GameLoop` was stepping another. `game.ts` now accepts its own hot update and
  immediately invalidates, forcing a full reload. Cost: a reload per sim edit. Worth it.

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

Deliberately out of scope; listed so they aren't re-proposed. Meta-progression between
runs · sound · multiplayer or netcode · a worker or GPU simulation path · a second
arena · bosses.

**Card-draft level-ups came off this list in M4a** and shipped — for stat upgrades, with
the weapon unlocks left on their fixed schedule. [DESIGN §6.3](DESIGN.md) records what
changed and which half of the original argument held up.

Rationale for the rest is in [DESIGN.md §11](DESIGN.md). The scaling story (worker →
GPU residency) is fully worked out in [Breach](../../Breach/docs/ROADMAP.md) and this
repo deliberately does not retell it.
