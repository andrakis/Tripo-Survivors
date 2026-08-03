# TRIPO SURVIVORS — Roadmap

Ordered to **get a playable loop in front of a camera fastest**, then make it a
game, then make it the tutorial. M0–M2 exist to prove the swarm works; M3–M4 make it
a game; M5 makes it look like one; M6 is the payload the project was built to deliver.

See [DESIGN.md](DESIGN.md) for the systems these milestones serve and
[ARCHITECTURE.md](ARCHITECTURE.md) for how they're built.

**Status:** M0–M6 done. M0/M1 2026-07-29, M2 and M3 2026-07-30, M4 and the M4a gameplay
pass 2026-07-31, **M5 2026-08-01**. **M6 shipped early and out of order** because a model
existed to import: M6a (static GLTF, 2026-07-31) and M6b (VAT animation, 2026-08-01) are
both code complete, with `grunt.glb` loaded, textured and animated in the game. The rest
of the cast is deliberately left as the tutorial's exercise — one registry line per model.

Every milestone on this roadmap is now closed except the two asset-blocked halves of M6.
**The first tutorial can be recorded.**

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

## Milestone 5 — Escalation + look ✅ done (2026-08-01)

- [x] `scripts/balance.ts` (`npm run balance`) — **a played run, without a player.** A bot
      drives `stepGame` at a fixed 60 Hz for five simulated minutes and reports when each
      level landed, how long it lived and what the field looked like on the way. Nothing
      else in this milestone could be settled honestly without it, and it is the one thing
      here that was not on the list. `game.ts`'s dev seam is now guarded on `window` as
      well as `DEV`, which is all it took to make the spine run in node.
- [x] The four tiers, their entry times and per-tier stats — carried over from M2, but
      **the runner's speed was wrong and had been since M0.** 5.2 against a player at 7.0,
      so the tier whose entire job is to be faster than you was slower. Now 7.6.
- [x] Per-enemy `seed`-keyed bob, scale jitter **and yaw offset**, all off the float the
      SoA has carried since M2. The bob is skipped for animated actors and scales with how
      fast the enemy is actually moving; death markers hash their fall position so a body
      does not change size at the moment it dies.
- [x] Palette pass: props darkened out of the cast's value range, the brute and the elite
      **desaturated** (not darkened — see below), every prop capped at 4.6 units, and the
      fog changed from exponential to **linear** with its near plane past the player.
- [x] Feedback pass: the level-up now has a real world-side signal (`combat.auraBurst`,
      a ring that throws past its own radius), and the damage vignette is proportional to
      the hit that caused it. `FLASH_MIX`, `DEATH_TIME`, the shake and the toast were all
      re-read against a full run and left alone — their M3/M4/M6b reasoning holds.
- [x] Balance pass, against 20 bot runs rather than arithmetic. Tier payouts roughly
      doubled and `XP_BASE` went 5 → 7; level 8 now lands around 1:55 and level 12 around
      3:40 against targets of 2:30 and 5:00, over two separate twenty-run samples.
- [x] `KNOCKBACK` and the Orbiter cadence re-checked on a fixed level-13 loadout. Both
      values stand, and both now have a measured margin in `config.ts` instead of a
      paper estimate.
- [x] Tests: 19 new vitest cases (153 total) — a whole new `src/readability.test.ts` that
      asserts the DESIGN §12 and ART-STYLE rules as rules, plus the aura burst and the
      recorded contact damage. `npm run verify` extended to **95 browser checks**.

**Done when:** a run is survivable for ~5 minutes by someone competent, escalation is
legible without reading a number, and a still frame looks like a game. **Verified** —
95/95 browser checks over three consecutive runs at a locked 60 fps, `lint`/`build`/`test`
clean, and 20 bot runs with 15 of them surviving the full five and a half minutes.

**This is the point the first tutorial can be recorded.** Everything after it is
about the models.

### What M5 learned

- **A bot that only avoids danger is not a player, and the difference is a REWARD.** The
  first version scored headings by threat alone, and the player moves at 7.0 against a
  grunt's 3.4 — so it simply left, and finished sixty seconds of play with zero kills. Real
  play is a shallow kite: you stay close enough that the front rank stays inside the aura,
  which means proximity has to *score positively* in a band, not merely score less badly.
  That single term is the difference between a script that measures the game and a script
  that measures its own timidity.
- **Aggression has to be a function of health, or you get one of two useless bots.** At a
  fixed weight the bot either hugs the front rank, out-kills everything and dies at 0:45,
  or kites forever and banks nothing. A person does neither — they push while healthy and
  give ground while hurt — and scaling the graze reward by `hp / maxHp` produced the first
  bot that both survived five minutes and levelled.
- **The stand-off had to be relative to the aura, and absolute cost an afternoon.** The
  graze reward counts enemies between the stand-off and the ring's rim, so a stand-off of
  2.9 against a level-1 aura of 3.0 leaves a band a tenth of a unit wide. The bot could
  then never be rewarded for grinding anything, settled into a wide orbit with the crowd
  six units out, and cleared 12% of the field in five minutes — which reads exactly like a
  balance result and is not one. Every number in a measuring instrument is a place a wrong
  answer can hide.
- **Rejecting a candidate heading is not the same as penalising it.** Props and walls were
  hard rejections, which looks equivalent until the bot is backed into the Pillar Ring and
  *every* candidate is rejected at once — at which point it writes a zero input vector and
  stands perfectly still inside a crowd. That one line was most of the early deaths.
- **The run is a snowball, and the ceiling was never the problem.** Handed a level-13
  loadout at t=0 the bot cleared 82% of the field at 4.9 kills a second and levelled every
  fifteen seconds; on the level-1 kit it cleared 20% at 0.31 and stayed there. So "level 12
  by 5:00" was not failing because the weapons were weak, it was failing because nothing
  crossed the threshold — and the fix belonged at the bottom of the curve. Worth stating
  because the instinct is to buff the weapons, and the measurement says the opposite.
- **The runner was slower than the player for four milestones, and both documents said
  otherwise.** DESIGN §5 and `PLAYER_SPEED`'s own comment each described a tier "faster
  than you"; `TIERS` gave it 5.2 against 7.0. Nobody noticed because nobody had held a
  single direction for a minute — the bot did it on its first run and got zero kills. A
  number that contradicts the two places that document it is invisible to review and
  obvious to a machine that plays.
- **The palette offence was chroma, not value.** The player was already the brightest thing
  on screen by luminance, so the rule as written was satisfied while the frame was still
  wrong. Attention is *area × chroma*: a 4.5-unit elite at full saturation out-shouts a
  1.7-unit character brighter than it. The fix is desaturating the big tiers and leaving
  the small ones alone, and ART-STYLE gained a third palette rule saying so.
- **"Fog tuned so the spawn ring sits at the edge of visibility" is geometrically
  impossible, and it took measuring to see it.** The ring is one *ground* distance and many
  *camera* distances: with the fixed 45° rig its near arc is 26.7 units from the camera —
  closer than the player, at 36.8 — and its far arc is 63.7. No distance fog covers that.
  The M0 brief was wrong rather than the tuning, and the useful half of the discovery was
  the other thing exponential fog was doing: with no near plane, the player was permanently
  ~23% blended into the fog colour, quietly taxing the one pixel the whole look rests on.
- **A level-up's world-side signal was invisible, and the code looked completely correct.**
  `announce` set `combat.auraFlare` — which is exactly what "flare the aura" should do,
  except the aura sets that same field to 1 twice a second, so the biggest event in the run
  rendered as an ordinary pulse. A signal that shares a channel with a metronome is not a
  signal. It needed its own field, a longer decay, and a different *shape*.
- **Two of the new readability tests failed on their first run, and both times the test was
  wrong.** The height ladder is three rungs and not four — the grunt and the runner are
  seven percent apart and are separated by width and hue, not size — and the tier table's
  HP column is deliberately non-monotonic, because the runner is a sidestep rather than a
  rung. Writing the rules down as assertions is what forced both to be stated at all.
- **The verification harness disturbed its own measurement for the sixth and seventh
  time.** A crowd of 60 was read twice to prove the bob moves, matching the mesh whose
  instance count equalled `swarm.n` — but the spawn director appends between two reads, so
  the second read found a different mesh and the check reported "nothing moved". And the
  aura ring was found by geometry *type*, which matched some other ring in the scene and
  reported a constant 0.33× forever. Both failed in the direction that looks like a broken
  feature, which is the expensive direction.

## Milestone 6 — The tutorial payload ✅ code done · cast blocked on assets

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

### 6b — VAT animation ✅ code done (2026-08-01) · cast blocked on assets

- [x] `src/models/vatCore.ts` — the bake core, ported from
      [Breach](../../Breach/src/render/vatCore.js) into typed, testable form (12 vitest
      cases over a hand-built two-bone rig with arithmetic answers). Minus Breach's
      meshoptimizer decimation: 400 × 807 tris needs no LOD ladder.
- [x] `src/models/vat-bake.worker.ts` — the runtime bake, in a worker, driving the
      `LOADING MODELS` splash (~1 s for the grunt). `src/models/vat.ts` — textures +
      GLSL injection via `onBeforeCompile`; **not** a port, Breach's runtime is
      WebGPU/TSL and this one is WebGL.
- [x] Clip selection from sim data, exactly as scoped: **distance to the player →
      `attack`** (variant chosen by the enemy's seed), then speed → idle/walk/run
      thresholds (a brute walks, a grunt runs, no per-tier config), death-marker age →
      `die`. One instanced float per enemy. No animation state machine.
- [x] `animated: true` in the registry is the whole opt-in. Fallback ladder: VAT →
      static GLB → primitive, each rung with its own console line.
- [x] `npm run verify` extended to 89 checks, including that instances spread across
      many VAT frames *and advance through them*, and that a crowd in contact plays
      attacks while the crowd behind it does not — read off the live `aVatRow`
      attribute through a new dev-only `__r3f` seam.
- [ ] **Rigged exports for the other tiers — blocked on assets**, deliberately: the
      remaining cast is the tutorial's exercise for the viewer. Each was `url` +
      `animated: true` in the registry once the model existed — since M6c it is `url`
      alone, or nothing at all if the viewer only wants to try it from the dialog.

**Done when:** 400 animated enemies run at 60 fps and the bake is invisible to the
player. **Both verified** — 60 fps at cap over three consecutive 86/86 runs, and the
bake reports progress into the splash rather than freezing it.

### What M6b learned

- **Tripo's locomotion presets ship root motion, and it presents as a broken shader.**
  The grunt's `run` walks its Hip bone 2.31 units — 2.7× the model's height — while the
  vertices Blender parked on a `neutral_bone` stay put, so the mesh tore into radiating
  spikes. Diagnosed by bisection: constant VAT rows rendered perfectly (so not the
  shader, not the texture, not the transform), run-clip rows alone broke (so the baked
  data), and reading the Hip translation track out of the GLB found the 2.31. Fix: the
  baker pins any bone whose translation strays >15% of model height from bind; rotations
  pass through. Locked in as a unit test with a translating-and-rotating clip.
- **The `defeat` preset is 5.6 s of which only 0.5 s is the fall** (t≈2.9–3.4, measured
  from the Hip rotation track: 20°→87° across that window, flat after). A prefix trim
  baked only the stagger and no body ever hit the ground. Clip specs take a
  `from`/`trim` **window** now, and the die clip is baked from 2.7 s for 1.0 s.
- **`DEATH_TIME` was tuned for a scale-punch, not a fall.** 0.26 s reads fine on a cube
  punching out; a body falling over in a quarter of a second reads as a glitch. Now
  0.85 s, which also slowed the primitive punch — an improvement there too.
- **`window.__game` exists before the game is playable.** The module evaluates at import
  time, so the harness's readiness checks passed while the `LOADING MODELS` splash still
  covered the screen — and the thumbstick check dragged against the overlay. Every
  readiness wait now also requires the splash to be gone. Fifth entry in the
  harness-disturbs-the-measurement series.
- **"Clip selection from speed" was not enough, and the gap was invisible in the code.**
  The first pass wired idle/walk/run/die and looked right — but an enemy jammed against
  the player is held nearly stationary by separation, so the crowd actually killing you
  stood there playing `idle`. Attacks have to be selected on **distance**, tested before
  speed. Worth recording because the milestone's own wording ("speed → run/idle, death
  timer → die/dead") describes exactly the version that was wrong, and the three attack
  presets were sitting unused in the GLB the whole time.
- **The M6a normalisation matrix earned its keep.** Baked frames are transformed by
  exactly the matrix the static path bakes into its geometry, so the model cannot change
  size on its first animated frame — that invariant cost one returned value in M6a and
  removed a whole class of bug here.

### 6c — the model dialog, and animation without a flag ✅ done (2026-08-03)

The milestone that came out of using M6a/M6b rather than out of planning them: every
report the loader produced went to the **console**, and a viewer following a tutorial
does not open the console. A misnamed file — the likeliest mistake in the whole pipeline
— presented as a green box and nothing else.

- [x] `src/ui/ModelPicker.tsx` — the startup screen: every actor in the registry, what it
      resolved to, and a file picker per row. The same `ResolvedActor` records the
      renderers read, so the dialog and the game cannot disagree about what loaded.
- [x] Four statuses, four different sentences: `loaded`, `missing` (**404**, named),
      `rejected` (the contract breach, in the loader's own words), `unset` (no `url` —
      not a failure). `missing` is separated from `rejected` by one `HEAD` request made
      only after a load has already failed, so the happy path costs nothing.
- [x] `src/ui/ModelPreview.tsx` — every row draws its model on a turntable, fallback
      included, with a baked VAT playing its idle. One WebGL context, scissored into the
      rows' rectangles.
- [x] Uploads run through `loadOne` — the same function, not a copy — so a file that
      works in the dialog works in `public/models/`. Object URLs, revoked on replace,
      with REVERT to go back to what the server ships. Session-scoped by choice: the demo
      is "try your model", not "install your model".
- [x] **`animated: true` deleted from the registry.** A rigged GLB animates because it is
      rigged, in both paths — the tutorial spends an episode rigging a model in Tripo, and
      the result has to drop straight into the dialog and move. `animated: false` remains
      as an escape hatch for an actor deliberately kept static.
- [x] `TUNING.VAT_MB_CEILING` (64 MB) and `projectVatBytes` — the guard the flag used to
      be. Nobody opts in now, so nobody has judged whether a file is affordable; the bake
      is priced from the clip durations before it runs, and a model over the ceiling stays
      static with a line naming the two dials (decimate, or fewer clips).
- [x] A **gate**, not an overlay (`src/App.tsx`): the game canvas does not mount until
      START. That is what keeps swapping a model safe, since every renderer reads its
      geometry once at mount and holds it imperatively.
- [x] `src/ui/modelRows.test.ts` — the wording, as assertions. The dialog is the only
      place a viewer is told their file 404'd, so what it says is the feature.
- [x] `npm run verify` walks the dialog like a viewer — waits for it, counts its rows,
      clicks START — rather than bypassing it with a flag.

**Done when:** a viewer can tell, without opening the console, which of their models
loaded and which did not — and can try one without editing a file. Both done.

### What M6c learned

- **"A canvas exists" stopped meaning "the game is running."** The dialog draws
  turntables, so every readiness wait in the harness matched the wrong canvas and the
  first run clicked START into a page that was still the dialog. The game's canvas now
  carries `data-game`. Sixth entry in the harness-disturbs-the-measurement series, and
  the second one caused by something appearing *before* the game.
- **A `<Canvas>` that cannot get a WebGL context throws, and takes the React tree with
  it.** Pre-existing — the game's canvas has always done this — but the dialog inherits
  it, which means the screen built to explain failures is itself blank on a machine with
  no WebGL. Not fixed here; worth an error boundary if the tutorial ever ships to an
  audience that might hit it.
- **Never diagnose from one measurement.** Seven per-row canvases failed to get contexts
  under `scripts/shot.mjs`, which looked exactly like the browser's context cap; the
  single-canvas rewrite failed identically, and so did the **unmodified** baseline. The
  box simply has no headless WebGL. The rewrite was kept on its own merits — the context
  count should not be set by how many actors the registry grows to — but the reason
  written in the file first was fiction, and it took one control run to find that out.
- **The `animated` flag was the wrong shape, and the dialog is what exposed it.** Only
  `grunt` carried it, so a rigged model uploaded to any other slot loaded perfectly and
  stood still. The first fix was a hint in the row telling the viewer which line to add —
  which preserved consistency between the dialog and `public/models/` and was still
  wrong, because the tutorial spends an episode on rigging and the payoff cannot be a
  config file. Auto-baking anything skinned in **both** paths keeps the consistency and
  deletes the question.
- **Removing an opt-in means adding a guard.** The flag was also, accidentally, the place
  someone decided a model was worth its VRAM. A VAT is two float textures of
  vertexCount × frames — the grunt costs 17 MB, a character at the elite's triangle
  ceiling would cost ~950 MB — so making the bake automatic without pricing it first
  would have turned "I rigged a heavy model" into a dead tab. The projection is arithmetic
  on clip durations the file already carries, and a unit test asserts it agrees with what
  the bake then allocates.

---

## M7 — the second camera, and a stage worth looking at

**Shipped.** An optional free-orbit camera, and a ground that is no longer a plane with a
grid on it.

The two arrived together because each one exposed the other. A free camera pointed at the
M6 stage shows you a flat colour and a line grid receding into fog — the fixed 45° rig was
hiding how little was there. And a textured ground with a boundary wall is wasted on a
camera that never looks at either.

- **Orbit camera** (`src/camera.ts`, `scene/CameraRig.tsx`) — drag to orbit, wheel to zoom,
  `C` to toggle, `R` to re-centre, plus a HUD button because a hotkey nobody was told about
  is not a feature. Follow mode stays the default.
- **Camera-relative movement** (`input.ts` `setInputBasisYaw`) — the coupling that makes the
  orbit camera playable rather than merely present.
- **Grassland ground** (`scene/terrain.ts`) — a procedurally generated tiling texture at the
  old grid's 8-unit scale. No checked-in image.
- **Boundary** (`scene/Boundary.tsx`, `scene/boundaryLayout.ts`) — a rampart on the world
  bound with hills beyond it, four instanced draws.
- **Sky** (`scene/Sky.tsx`) — a gradient sphere, so looking at the horizon shows a sky
  rather than a background fill.

### What this milestone got right, and what it nearly got wrong

- **The home pose is derived, not restated.** Orbit's starting yaw/pitch/distance are
  computed from `CAM_OFFSET`, so entering orbit mode moves the camera by exactly nothing.
  Writing those three numbers down beside it would have worked identically on the day and
  drifted the first time the fixed rig was retuned — the failure being a camera that jumps
  on a keypress that promised not to move anything. There is a test for it.
- **A new camera is a new fog problem.** `FOG_NEAR` was only ever allowed to be a constant
  because the fixed rig's distance is a constant. Zoom out to 60 units against a hardcoded
  near plane of 40 and the *player* fades into the fog — breaking readability rule 1 at
  precisely the moment you zoomed out to look at them. Fog near now tracks the camera
  distance, which turned out to be the same change that makes zooming out reveal the
  boundary rather than pushing a wall of fog along in front of you.
- **The circle-in-a-square bug, caught by a test rather than by an eye.** Hills were placed
  on a ring of radius 1.15 × the world half-extent, which sounds outside a 256 × 256 arena
  and is not: a circle passes within r/√2 of the origin on the diagonals, so every hill near
  a corner stood *inside* the playfield, 115 units into a 130-unit bound. Placement now uses
  the Chebyshev metric the square arena is actually measured in. Nothing about the code
  looked wrong; the assertion is what found it.
- **Art that duplicates a sim constant will drift from it.** The wall is drawn where
  `clampToWorld` already stops the player, and `boundaryLayout.test.ts` asserts the inner
  face lands on the bound with the player's radius accounted for. A wall a unit inside the
  clamp stops the player visibly *inside* stone; a unit outside and they stop in mid-field
  with the wall still a stride away. Both read as movement bugs, not scenery bugs.
- **The grid was load-bearing, and its replacement had to inherit the job.** With a
  featureless ground and a camera locked to the player, movement is invisible. The grass
  texture kept the grid's 8-unit scale precisely because that was the number that read
  correctly at this camera distance — the texture is the new motion reference, not a
  decoration laid over the old one.
- **Verification without a GPU.** This box still has no usable headless WebGL, so none of
  this was checked by looking at it. What *was* checked, by driving the real game under
  Playwright and reading the live scene graph: entering orbit leaves the offset at
  `(0, 26, 26)`; a 220 px drag yields exactly 75.6° of yaw; zoom clamps at 140 with fog
  following to `[148, 253]`; exiting returns every value to the follow-mode constants; and
  holding W with the camera at −75.6° moves the player along the away-from-camera heading
  with an alignment of 1.000. Pixels remain unverified and are the user's to check.

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
