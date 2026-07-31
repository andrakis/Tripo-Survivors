# TRIPO SURVIVORS — Game Design Document

> A Survivors-like in 3D. You are one figure on an open field; everything else on
> that field is walking toward you. Attacks fire themselves — the only verbs are
> **where you stand** and **what you kill next**. Survive the ramp.

**Status:** v1 design, locked 2026-07-29. This document is the authority on what
the game *is*. [ARCHITECTURE.md](ARCHITECTURE.md) covers how it's built,
[MODEL-PIPELINE.md](MODEL-PIPELINE.md) the asset contract, [ART-STYLE.md](ART-STYLE.md)
the look, [ROADMAP.md](ROADMAP.md) the build order.

---

## 1. One-line pitch

Run, gather, level, and watch a crowd of hand-made monsters close in from every
direction — a five-minute Survivors run built so you can drop your own 3D models
into it in under a minute.

## 2. The hook, and the honest second purpose

The game is a genuine Survivors-like: the pleasure is the **power fantasy inversion**
— you start fragile and outnumbered, and end the run deleting a screen of enemies
per second without pressing an attack button once.

It is also, unapologetically, a **teaching vehicle for Tripo AI model import**. That
second purpose is not a footnote; it is a design constraint that shapes real decisions:

- The game must be **fun with placeholder cubes and cones**, so a viewer who imports
  nothing still has something working.
- It must be **immediately better with imported models**, so the tutorial payoff is
  visible in one screenshot.
- Every actor a viewer might want to replace — player, each enemy tier, the XP orb,
  the arena props — must be swappable from **one file**, with no other code touched.

Where the two purposes conflict, legibility wins. This is a demo that happens to be
a good game, not a good game we later documented.

## 3. Design pillars

1. **Position is the only skill.** No attack button, no aim, no dodge roll. The
   player's entire expression is movement: when to kite, when to cut through a gap,
   when to trade a hit to reach a cluster of orbs. Every system must reward or
   punish *where you are standing*, never *how fast you clicked*.

2. **The crowd is the threat, not any monster in it.** An individual enemy is never
   scary and never needs to be read. Danger is density, and the player reads it as a
   shape on the ground. This is why the swarm gets flow-field pathing and real
   separation rather than "run straight at the player" — a crowd that *flows*, splits
   around a rock, and re-merges behind it reads as a tide. One that stacks into a
   single line reads as a bug.

3. **The cast is swappable; the world is a stage.** The arena is deliberately plain —
   flat ground, a few chunky props, one light direction, heavy fog. Everything
   interesting on screen is a character. This makes imported models pop, and it means
   a viewer's model never has to match an art style it can't match.

4. **Escalation you can feel without a number.** The difficulty ramp is expressed as
   *more things, closer together, arriving sooner* — never a displayed multiplier. The
   player should notice they're in trouble because the ground went dark with bodies.

5. **Every system readable in one file.** No system may be so clever that explaining
   it takes longer than showing it. This is why the sim runs on the main thread and
   why enemy caps are low: a worker + transfer protocol is the *correct* engineering
   answer at 20,000 units and the *wrong* teaching answer at 400.

## 4. The loops

### 4.1 Micro — the kite loop (seconds)

```
   enemies converge  ->  you back away, aura grinds the front rank
        ^                              |
        |                              v
   orbs pull in   <-  they die, dropping XP orbs behind you
```

You are always walking backward into open ground while your aura kills what's
closest. The tension is that **the orbs drop where the enemies died** — behind you,
in the direction you're retreating *from*. Collecting is a deliberate risk: you must
turn back into the space you just abandoned, which the swarm is already refilling.

This is the whole game in ten seconds, and it works with one weapon and one enemy.

### 4.2 Meso — the level loop (30–60 seconds)

```
   kill -> orbs -> XP -> LEVEL UP -> new skill or stat -> kill faster -> ...
```

Level-ups come in two flavours (§6.3). **Weapon levels are automatic** — no pause, no
menu, just a toast, a flare and a screen-shake over an un-stopped fight. **Stat levels
offer three cards** and pause the run until one is taken.

> **Why both, rather than one or the other?** The original design had no card picks at
> all: a modal stops the action, adds a UI system, and adds build-variance that makes
> the game harder to demo reproducibly. Two of those three held up. The third did not —
> a fixed table makes progression something that happens *to* the player, which is a
> strange thing for the demo vehicle of a systems tutorial to demonstrate, and a viewer
> following along has no build of their own to talk about.
>
> The split keeps what the fixed order was actually protecting. Every recording still
> hits the Lance at 3, Pierce at 5 and the Orbiter at 9 — the beats a tutorial scripts
> around — while the stat line is the player's. And the pause is confined to the one
> screen that asks a question.

### 4.3 Macro — the run (5–8 minutes)

```
  0:00  one enemy type, trickling in            you feel strong
  1:00  runners join; spawn rate doubles        you start moving constantly
  2:00  brutes join; the front rank stops dying instantly
  4:00  elites; the field is never empty        you are kiting full-time
  6:00+ overwhelming                            you die, and you know why
```

A run ends in death. There is no win state in v1 — the score is the clock, shown on
the game-over card next to level and kills.

## 5. The player

| Stat | Base | Notes |
|---|---|---|
| Max HP | 100 | The Max HP upgrade grants +25 and a full heal |
| Move speed | 7.0 u/s | Meaningfully faster than a grunt (3.4) and a brute (2.2); *slower* than a runner (5.2) |
| Collision radius | 0.6 | |
| Invulnerability after a hit | 0.6 s | Flash the model; prevents a crowd deleting you in one frame |
| Pickup radius | 3.0 u | Grows with the Magnet upgrade |

Speed tuning is the core balance lever. The player outruns the bulk of the swarm but
**cannot outrun a runner**, so runners are the reason you can't simply hold one
direction forever — they arrive first, alone, and force you to turn and clear them.

### 5.1 The dash

| | |
|---|---|
| Speed | 30 u/s |
| Duration | 0.16 s (~4.8 u of travel) |
| Cooldown | 2.2 s, shortened by an upgrade |
| I-frames | 0.22 s |
| Input | Space or Shift; a button on the right thumb on touch |

The one *discrete* action in a game whose only other verb is a direction. It exists
because position is the whole game and the character has exactly one speed: without a
dash, a bad position is a slow, legible, unrecoverable death, and the player watches it
happen for two seconds. The dash is the answer to "I am already surrounded".

Three details carry it:

- **It goes through, not away.** 4.8 units is a front rank's depth, not an escape
  across the arena — the correct use is *into* the gap, which keeps the player near the
  crowd where the aura works.
- **The i-frames outlast the movement** (0.22 vs 0.16 s). A dash that ends inside a
  crowd and immediately takes contact damage is a trap, and a trap on the button the
  player presses when panicking is the worst possible one.
- **It is an edge, not a held state.** Holding the key dashes once. Otherwise "hold
  the dash button" would be strictly better than tapping it, and a control the player
  is punished for using naturally is a bad control.

## 6. Weapons

Two weapons ship in v1, chosen because they teach opposite lessons about positioning.

### 6.1 Aura — "Field"

An always-on ring centred on the player that pulses damage into everything inside it.

| | |
|---|---|
| Radius | 3.0 u (+1.0 at level 2, +more later) |
| Damage | 6 per pulse |
| Pulse rate | 2 / s |
| Falloff | none — inside or outside |

The aura punishes standing still (things reach you) and rewards *shallow* kiting —
staying just close enough that the front rank stays inside the ring. It is the
weapon that makes the first thirty seconds playable and never becomes useless.

Visually it is a flat translucent disc on the ground that brightens on each pulse.
Ground-plane, not a sphere: the player must be able to see exactly what's inside it.

### 6.2 Bolt — "Lance"

An auto-firing projectile launched along the player's facing (which is their movement
direction) on a cadence.

| | |
|---|---|
| Damage | 12 |
| Speed | 26 u/s |
| Cadence | 0.55 s |
| Range | 22 u |
| Pierce | 1 enemy (+2 at level 5) |

The bolt rewards *facing* — and since facing comes from movement, it rewards
**running toward danger**, the exact opposite of the aura. That tension is the point:
the optimal line is to retreat while periodically turning into the crowd to land a
piercing bolt down its length.

### 6.3 Levelling: a fixed weapon spine, a chosen stat line

A level-up is one of two things, and the level number decides which.

**Odd levels 3–11 grant a weapon, automatically and in order.** These are the
capability unlocks and they are the run's power spine. They are not choosable: a player
who could decline the Lance would have a run with no Lance, and the reason level 3
feels different from level 4 in *every* run is that this table never varies.

| Level | Unlock |
|---|---|
| 3 | **Lance** — the bolt begins firing |
| 5 | **Pierce** — bolts pass through 2 more enemies |
| 7 | **Twin Lance** — a second bolt at ±12° |
| 9 | **Orbiter** — a sphere circles the player, damaging on contact |
| 11 | **Concussion** — aura pulses knock enemies back |

**Every other level offers a choice of three**, drawn from the pool below, and the run
**pauses** until one is taken. This is the only pause in the game and the only screen
with a decision on it. It pauses because it asks a question, and asking one while a
crowd closes in makes it a reflex test rather than a choice — everything else in the
game (the toast, the flare, the shake) is designed specifically *not* to interrupt.

| Upgrade | Effect |
|---|---|
| Aura radius | **+1.0** |
| Damage | **+25%**, all sources |
| Fire rate | **+20%** — offered only once the Lance exists |
| Move speed | **+10%** |
| Max HP | **+25** and heal to full |
| Magnet radius | **+50%** |
| Dash cooldown | **−20%** |

Every entry is repeatable and there is no "taken" state, so a level 40 run still has
three real cards to read. The offer is three distinct entries; stacking is plain
multiplication on a live field, so two Damage picks are ×1.25 twice with no special
case.

> **This replaces the fixed table v1 shipped with, and reverses the §11 non-goal.** The
> fixed order was chosen to keep the run legible and the code small; in play it made the
> whole progression system something that happened *to* the player, which is a strange
> thing for the demo vehicle of a systems tutorial to demonstrate. The compromise is
> above: the spine stays fixed so runs stay comparable, the stats become the build.
> Weapon unlocks joining the pool is the obvious next step and the code is shaped for it
> — `AUTO_UNLOCKS` and `UPGRADES` are the same type.

### 6.4 Boosts

Pickups that spawn on the field on a jittered timer (~40 s ± 14, first at 25 s) and lie
there until collected. They land 11–26 units from the player: the near end is on screen
the moment it appears, the far end is a reason to look around.

| Boost | Effect | Duration |
|---|---|---|
| **Magnet** | every XP orb on the map starts coming to you | instant |
| **Invincible** | no damage at all | 15 s |
| **Quad Damage** | ×4 outbound damage | 15 s |
| **Guns Akimbo** | double the bolts per volley | 15 s |
| **Bloodlust** | +1 HP per kill | 30 s |

They exist to break the run's monotonic pressure curve. Everything else ramps — the
spawn rate, the tiers, the player's own stats — and a run that only ramps has no shape.
A boost is fifteen seconds where the arithmetic is different and the correct play
changes: Quad Damage says go and stand in the crowd, Invincible says the same for a
different reason, Magnet says stop fighting and cash in, and Bloodlust turns a losing
fight into the way you heal.

Rules that follow from that:

- **Duration restarts, it does not stack.** A second Quad Damage at three seconds left
  gives fifteen, not eighteen. Stacking lets a player bank an unbroken multiplier across
  a run, and the point of a boost is that it ends.
- **Boosts and upgrades never share a field.** A boost expires; a run's permanent
  upgrades must not. Quad Damage multiplies a separate `boostMul`, so the first one to
  run out cannot take the player's Damage picks with it.
- **The last three seconds flash**, on the model and on the HUD chip. A boost ending is
  something the player should see coming, not discover by taking a hit.

## 7. The swarm

### 7.1 Tiers

| Tier | HP | Speed | Contact dmg | XP | Enters at | Read |
|---|---|---|---|---|---|---|
| **Grunt** | 10 | 3.4 | 6 | 1 | 0:00 | The mass. Dies to one aura pulse plus change. |
| **Runner** | 6 | 5.2 | 4 | 2 | 1:00 | Fragile, faster than you. Arrives alone and early. |
| **Brute** | 60 | 2.2 | 18 | 6 | 2:00 | Slow wall of HP. Survives to reach you; punishes standing. |
| **Elite** | 400 | 1.8 | 30 | 40 | 4:00 | Rare. A moving hazard you route around, not through. |

Four tiers is the ceiling for v1 — one per shape a viewer might want to model, and
few enough that the tutorial can show importing all of them.

### 7.2 The spawn director

Enemies spawn on a ring **just outside the camera frustum** (radius ~1.35× the
visible half-extent) at a uniformly random angle, so they always walk *in* from
offscreen and never pop into existence in view.

```
spawnRate(t) = SPAWN_BASE + t / SPAWN_RAMP        # enemies per second
```

with `SPAWN_BASE = 1.5 /s` and `SPAWN_RAMP = 22 s` — so ~1.5/s at the start,
~4.2/s at 1 minute, ~9.7/s at 3 minutes. Tier weights shift over the same clock, and
elites spawn on their own slow timer rather than from the general budget.

A hard cap of **`MAX_ENEMIES = 400`** stops the sim from growing without bound; once
the field is at cap the director simply stops spawning until kills free slots.
The cap is deliberately low — see pillar 5 — and is a config constant a viewer can
raise to watch their own machine's limit.

> **Deliberately not a wave system.** No "Wave 7 incoming" banner, no gaps between
> waves. Pressure is continuous and monotonic; the only rhythm is the one the player
> creates by clearing a side of the field.

### 7.3 How the swarm moves

Every enemy samples a shared **flow field** that points downhill toward the player,
adds a **separation** force from its neighbours, and gets pushed out of obstacles.
The field treats obstacles as *expensive to cross, not impossible*, which is what
makes a crowd split around a rock and re-merge on the far side instead of forming a
stalled clump against it.

This is ported from Breach (see [ARCHITECTURE.md §4](ARCHITECTURE.md)) and is the
single most important thing separating this from a "everyone drives at the player"
prototype. It is also the reason the arena has obstacles at all.

## 8. Progression

```
xpToNext(level) = ceil(5 * level ^ 1.45)
```

| Level | XP for next | Cumulative |
|---|---|---|
| 1 | 5 | 5 |
| 2 | 14 | 19 |
| 3 | 25 | 44 |
| 4 | 38 | 82 |
| 5 | 52 | 134 |
| 8 | 102 | 389 |
| 12 | 184 | 997 |

The **Cumulative** column is the total XP spent by the time that row's level-up is
paid for — so reaching level 8 costs the level 7 row, 287. (These were a few points
high in the first draft; the formula is the specification and the table is now the
formula's output, checked in `sim/progression.test.ts`.)

Tuned against the spawn curve so a competent run hits **level 8 around 2:30** and
**level 12 around 5:00** — i.e. the full unlock table is seen in a normal run, which
matters because the table *is* the tutorial's demonstration of a progression system.

**XP orbs** drop at the death position, are worth their tier's XP, and are pulled
toward the player once inside the magnet radius (accelerating, so a pickup feels
like a snap rather than a drift). Orbs never expire — the field of uncollected orbs
behind you is a visible record of where you've been, and cashing it in is the
comeback mechanic when a run goes badly.

**An orb that has started coming always arrives.** Entering the magnet radius sets a
latch that is never cleared, and a latched orb moves at least 1.7× the player's *current*
speed. Without the latch, a few Move Speed picks make the character faster than an orb
at the rim of their own magnet: it visibly chases, falls behind, drops out of range and
stops. An orb that gives up reads as the pickup being broken, not as a speed stat
working.

**Orbs merge as they age.** Once the field passes 120, uncollected orbs older than 12
seconds that share a 4-unit cell consolidate into one carrying the sum of their values,
twice a second. No XP is ever lost — a merged orb is worth exactly what went into it —
and merged orbs are larger and a different colour by value (cyan → green → gold →
magenta), so a consolidated field still tells you where the money is.

Three conditions gate the merge, and each protects something: the field-size threshold
keeps the early scattered trail intact (it *is* the record of where you've been, and
consolidating it early deletes the thing it's for), the age requirement means an orb
must have been genuinely ignored rather than jumping sideways in front of a player
who's still fighting, and orbs already on their way are nobody's to move.

## 9. The arena

A single flat **256 × 256** unit ground plane, bounded — the player is clamped at the
edge rather than falling off, and the edge is visible as a change in ground colour so
being cornered is legible before it's fatal.

Scattered across it: **~14 static props** (rock clusters, pillars, ruined blocks),
each 3–8 units across, placed by hand rather than randomly so the arena has
memorable geography. They serve three purposes at once:

1. **They make pathing visible.** Watching a crowd part around a pillar is the
   clearest possible demonstration that the flow field is real.
2. **They are tactical.** Kiting a slow brute around a pillar is free damage.
3. **They are the third model slot** a tutorial can fill — props are the easiest
   thing to generate in Tripo and the easiest to instance.

Props do not block the player, only shape the swarm's path — the player collides
with them but at their scale can round any of them without losing more than a step.

## 10. Controls

| Input | Desktop | Touch |
|---|---|---|
| Move | WASD / arrows | Virtual thumbstick, left half of screen |
| Attack | — automatic — | — automatic — |
| Facing | derived from movement direction | derived from movement direction |

Movement is **camera-relative**: W is "away from the camera", which with a
world-fixed camera yaw means W is always the same world direction. Touch and keyboard
write the same normalised input vector, so there is exactly one movement code path.

No pause, no menu, no options screen in v1. A run starts on load and restarts from
the game-over card.

## 11. Non-goals for v1

Listed so they don't get argued twice:

- ~~**No card-draft level-ups** — fixed table instead.~~ **Reversed.** A three-card
  choice at every non-weapon level shipped after v1; see §6.3 for what changed and why.
  The weapon spine stayed fixed, which is the half of the original argument that held up.
- **No meta-progression** between runs. Each run starts identical; this is a demo,
  and a demo that requires 40 minutes of unlocks to look good is a bad demo.
- **No sound.** Deferred entirely; it's orthogonal to the model-import story.
- **No multiplayer, no netcode.** Explicitly not this project.
- **No animated models in v1** — static primitives now, GLTF then VAT later
  ([ROADMAP.md](ROADMAP.md) M6).
- **No worker/GPU simulation.** The CPU path at 400 units is the whole point.

Post-v1 candidates, in rough priority: weapon unlocks joining the choice pool (§6.3), a
boss at 5:00, sound, and a second arena.

## 12. Readability rules

The camera is a third-person follow at a fixed ~45° downward angle and fixed world
yaw, trailing the player with critically-damped smoothing. It shows roughly 40 × 26
world units — enough that a spawn ring sits comfortably offscreen and the player can
see a threat with about a second and a half to react.

Non-negotiables, in priority order, for anything that appears on screen:

1. **The player is always the brightest, highest-contrast thing.** If an imported
   enemy model is brighter, the model registry's tint is wrong, not the design.
2. **Enemy tier reads from silhouette and colour at a glance** — grunt small, runner
   thin, brute wide, elite huge — because a viewer's imported models will differ in
   everything *except* the size we scale them to.
3. **Orbs read against the ground at all densities** — emissive, and small enough
   that a hundred of them don't hide the enemies standing on top of them.
4. **Damage to the player is unmissable** — full-screen vignette flash plus the
   i-frame blink. The one thing a player must never say is "when did I lose that HP?"
