# TRIPO SURVIVORS — Art Style

The visual target, and the rules that keep it working when someone drops in art we
didn't make.

**Status:** v1.1, 2026-08-01 (M5's look pass). Refines [DESIGN.md §3 pillar 3](DESIGN.md)
and [§12 readability](DESIGN.md). Asset-side requirements live in
[MODEL-PIPELINE.md](MODEL-PIPELINE.md). Every rule below that can be checked
mechanically is checked in `src/readability.test.ts`, so the palette cannot drift back
without a red build.

---

## The governing constraint

Every other project in this family picks a look and enforces it across all assets.
**This one can't.** A viewer will import a model we have never seen — photoreal, toon,
chibi, whatever Tripo produced from whatever prompt they typed — and the game must
still look deliberate.

So the style is defined as a **frame around unknown content**, not a look for the
content itself:

> **The world is a stage — flat, dim, low-detail, low-saturation. The cast is the
> show — lit, saturated, and the only thing carrying detail.**

Any imported model, in any style, lands on a stage that flatters it. And the arena
never competes for attention with the thing the tutorial is trying to show off.

## Locked decisions

1. **Chunky low-poly primitives for everything we author.** Boxes, capsules, cones,
   icosahedra. No bevels, no rounded corners, no authored detail. Our own art is a
   placeholder by design and must never look precious enough that a viewer hesitates
   to replace it.

2. **Flat shading, one directional light, one ambient fill.** `MeshLambertMaterial`
   with `flatShading: true` for the world. No PBR, no metalness/roughness maps, no
   environment map, no shadow maps. Imported models keep their own materials — a
   photoreal Tripo export should look photoreal *standing on a flat-shaded stage*,
   and that contrast reads as intentional.

3. **Desaturated stage, saturated cast.** The ground, props, and fog sit in a narrow
   band of cool desaturated greys and blue-greens. All chroma budget is spent on
   actors, orbs, and the aura.

4. **Fog does the depth work.** **Linear** fog matched exactly to the ground colour,
   with its near plane placed just beyond the camera's own standoff from the player.
   Enemies fade *in* as they approach rather than popping at a frustum boundary — which
   also means the arena's edges never need to be modelled.

   > **Changed in M5, from exponential to linear.** Two reasons, and the first is the
   > important one. Exponential fog has no near plane, so the player sat permanently
   > ~23% blended into the fog colour — a standing tax on the one thing the palette's
   > first rule says must be the brightest pixel on screen. A near plane at 40 units,
   > against the rig's 36.8, leaves the player and the crowd fighting them exactly
   > unfogged.
   >
   > The second is that "tuned so the spawn ring is at the edge of visibility" cannot be
   > satisfied literally, and it took measuring to see why. The ring is one *ground*
   > distance (32.2 units) but many *camera* distances: with a fixed 45 degree rig the
   > near arc is 26.7 units away — closer to the camera than the player is — while the
   > far arc is 63.7. So the fade is aimed at the **far** arc, which is the direction the
   > player is usually retreating away from and has the most time to read; the near arc
   > is left to the bottom edge of the frame, which it is about to leave anyway.

5. **Fixed camera angle, fixed yaw.** ~45° down, no rotation, ever
   ([ARCHITECTURE.md §9](ARCHITECTURE.md)). Every model is therefore seen from
   exactly one angle band, so a viewer only has to make their model look good from
   three-quarter-above. That is a real gift to someone generating assets.

6. **No post-processing in v1.** No bloom, no SSAO, no colour grading. Emissive
   materials carry the glow. Bloom is the single most tempting addition and the
   fastest way to make an imported model look wrong.

## Palette

| Role | Colour | Notes |
|---|---|---|
| Ground (grass base) | `#2f3a2c` | Dusk green, desaturated; the texture's fill colour |
| Grass, dark stipple | `#232b21` | The shadow tint drawn over the base |
| Grass, light stipple | `#3f4d38` | The brightest pixel the ground can produce — held under the props |
| Ground, out-of-bounds band | `#1c2027` | Visibly darker so being cornered reads early |
| Props | `#4e535d` | Neutral grey, flat-shaded, no tint variation |
| Boundary wall | `#3f444b` | Under the props: it is the largest object in the world by area |
| Wall cap / merlons | `#4e535d` | One value step up, so the top edge reads as lit |
| Distant hills | `#232830` | Darker than the ground — "outside" must recede |
| Sky, zenith | `#161d2b` | Fades to the fog colour at the horizon |
| Fog | `#2f3a2c` | **Exactly** the ground colour — the horizon must vanish |
| Player | `#ffe9a8` | Warm, bright, highest value on screen |
| Grunt | `#7fd15a` | Green |
| Runner | `#5ad1c8` | Cyan, thin silhouette |
| Brute | `#bd6265` | Red, wide silhouette — desaturated, see below |
| Elite | `#b06ebb` | Violet, huge — desaturated, see below |
| XP orb | `#8fe3ff` | Emissive pale blue |
| Aura | `#ffd166` at 0.18 alpha | Additive ground disc, brightens on pulse |
| Bolt | `#ffe9a8` | Emissive, matches the player — reads as *yours* |
| Damage vignette | `#ff3b30` | Full-screen flash on player hit |

Three rules constrain any future addition to this table:

- **The player is always the highest-value pixel on screen.** If an imported model
  outshines them, its registry tint is wrong.
- **No enemy tier shares a hue.** Colour is the backup channel when an imported
  model's silhouette doesn't match the tier it was assigned to.
- **The bigger the tier, the less chroma it may spend.** Added in M5, because the first
  two rules were both satisfied and the frame was still wrong. Attention is *area ×
  chroma*, not value alone: a 4.5-unit elite at full saturation out-shouts a 1.7-unit
  player who is strictly brighter than it. The brute and the elite are therefore
  desaturated against their v1 values; the grunt and the runner keep all of theirs,
  because they are small and colour is the only channel they have.

M5 also darkened the props from `#6b6f7a` to `#4e535d`. At the old value they sat inside
the cast's own value range — luminance 111 against the brute's 114 — while covering
several times the screen area of any actor, so the first thing the eye found in a still
frame was a rock. The ladder the stage rule always described is ground < props < every
actor, and it is a real gap now rather than three points.

## Silhouette hierarchy

Colour is backup; **size and proportion are primary**, and both are enforced by the
loader's scale normalisation ([MODEL-PIPELINE.md §4](MODEL-PIPELINE.md)) regardless
of what the source model looks like.

```
   elite  ████████     4.5u tall, 2.8 wide     "route around this"
   brute  ████         2.6u tall, 1.6 wide     "this will reach you"
   runner ▐▌           2.1u tall, thin         "this is fast"
   player ▐▌           1.7u, bright            "you"
   grunt  ██           1.4u tall, 0.8 wide     "the mass"
```

The player is deliberately mid-height — not the biggest thing on screen — so an elite
entering the frame is immediately legible as a problem.

The ladder is **four rungs** since the first real runner import. It was three — the
runner at 1.5 was meant to be told from the grunt by width and hue, not size — but the
imported runner is a slim biped, and at 1.5 it *read* smaller than the squat grunt:
normalisation locks bounding heights, not perceived mass, and a 1.4-tall model that is
1.0 wide carries more screen area than a 1.5-tall one a third as deep. So size now
carries threat outright — grunt → runner → brute → elite — with the runner still the
thinnest thing on screen. Anything that scales an actor (M5's per-enemy jitter, an
imported model's normalisation) has to stay inside those gaps, which
`src/readability.test.ts` guards.

**Props are capped at 4.6 units.** The camera looks down at exactly 45 degrees, so a prop
of height *h* hides the ground for *h* units directly behind it. The 8-unit pillars M0
placed threw a six-unit blind spot each — about five ranks of enemies you could not see —
and the Pillar Ring was four of them in a cluster. The see-through pass M3 added answers
this for the *player*; nothing answers it for the crowd except shorter props.

## Motion and feedback

Feel comes almost entirely from motion, because the geometry is too simple to carry
it. Every effect below is cheap and framerate-independent.

| Event | Treatment |
|---|---|
| Enemy hit | Instance tint lerps to white, decays over 0.12 s (`flash` in the enemy SoA) |
| Enemy death | Scale-punch to 1.3× then collapse to 0 over 0.15 s |
| Aura pulse | Ring opacity 0.18 → 0.45, decays over 0.2 s |
| Bolt fired | Small forward camera nudge, 0.04 units |
| Orb pickup | Orb accelerates in, then a brief XP-bar flash |
| Level up | Screen-shake 0.25 s, toast card, full aura flare |
| Player hit | Red vignette, model blinks for the 0.6 s of i-frames |
| Level up | ...and the aura **burst**: the ring throws out past its own radius over 0.6 s, then eases back |
| Idle crowd | Per-enemy bob, scale jitter and a fixed yaw offset, all keyed off the `seed` field |

That last one matters more than its size suggests: 400 copies of one model moving in
perfect lockstep reads as a rendering artifact. A per-instance random phase costs one
float already in the data layout and makes the crowd look alive. The bob is skipped for
an *animated* actor — its VAT clip is already moving the body, and the same seed already
offsets that clip's phase, so a sine on top would be two idle animations fighting over
one model. The bob also scales with how fast the enemy is actually moving, so a front
rank jammed against the player settles instead of marching in place.

The burst row is M5's correction to a real bug: through M4 a level-up set the same
`auraFlare` field the aura writes twice a second, so the world-side half of the biggest
event in a run was pixel-for-pixel an ordinary pulse. It is a separate field now, it
lasts nearly three times as long, and it changes the ring's **shape** rather than only
its brightness — so the two stay distinguishable when a level-up lands on a pulse frame.

The damage vignette is **proportional** to the hit since M5. A runner's 4 and an elite's
30 drew the same flash, which told the player they were hurt but not that it was serious
— and which of those it is decides whether they keep kiting or run.

## Ground

Grassland, from a **procedurally generated** tiling texture (`src/scene/terrain.ts`) —
two tints of stipple over a dusk-green base, at an 8-unit repeat, with a low-frequency
mottle underneath so the detail survives perspective instead of averaging to a flat
colour in the distance.

It exists for one reason, and it is the same reason the thing it replaced existed: with
a featureless ground and a camera that follows the player exactly, **player movement is
invisible**. You see the world slide and nothing else. Through M6 the motion reference
was a faint 8-unit line grid; M7 swapped it for the texture, which does the same job
continuously rather than once every eight units, and does not put a sci-fi grid on a
field. The 8-unit scale carried over unchanged, because that was the scale that read
correctly at this camera distance.

Generated rather than shipped as an image on purpose: this repo is a tutorial about
importing *your own* art, and a checked-in grass photo would be the one asset in it
nobody can explain the provenance of. It is also why the ground can be held inside the
value band below — a JPEG is whatever it is, but a palette is testable.

The out-of-bounds band is a darker plane beyond the world edge, wide enough to see
before you hit the clamp.

## The boundary

`src/scene/Boundary.tsx`: a nine-unit rampart with a lit cap and battlements, ringed by
hill silhouettes beyond it. Four instanced draws, no simulation involvement.

The wall's inner face sits **exactly** on the world bound the sim clamps the player to,
so a cornered player's near edge touches the stone — this is asserted in
`src/scene/boundaryLayout.test.ts`, because a wall one unit off in either direction
reads as a bug in the movement code rather than in the scenery.

None of this was needed while the camera was fixed: the view is 40 × 26 units in a
256 × 256 world, so you almost never saw the edge. The orbit camera is what made the
place the world stops something a player can point at, and it had to look like a place
that stops. The hills exist so that looking outward shows a horizon rather than a void.

## Sky

A vertical gradient from the fog colour at the horizon to `#161d2b` at the zenith,
on a sphere that follows the camera.

It is **darker than the ground**, which is not how daylight works and is exactly right
here. The first rule below is that the player is the brightest thing on screen; a
daylit sky is a screenful of pixels brighter than the player, and no amount of tuning
the cast recovers from that. The palette has always been dusk — the sky is only where
that finally became visible, because the fixed camera pointed at the floor.

## UI

Diegetic-free and deliberately plain: the HUD is DOM, not in-world.

- **HP bar** — top-left, chunky, no numbers.
- **XP bar** — full-width strip along the bottom edge; level number at the left.
- **Run clock** — top-centre, monospace. The score.
- **Kill count** — small, under the clock.
- **Level-up toast** — centre, large, 1.5 s, name of the unlock only.
- **Game over card** — centre: time survived, level reached, kills, restart button.

Typeface: a heavy geometric sans for numbers, system-stack fallback. No web fonts —
partly for load time, and partly because font-loading is exactly what hangs
`page.screenshot()` in the headless verification path.

## What we are explicitly not doing

- **No bloom / post-processing** (see locked decision 6).
- **No shadow maps.** A flat-shaded stage with one light doesn't need them, and 400
  shadow casters is a real cost for a look we're not pursuing. A cheap blob-shadow
  decal under each actor is allowed if grounding feels weak.
- **No normal maps or PBR on our own assets.** Imported models may use whatever they
  ship with.
- **No skybox.** Fog to a flat colour; the camera angle means you never see a horizon.
- **No particle systems.** Deaths and pulses are handled by scale and colour on
  geometry that already exists.
