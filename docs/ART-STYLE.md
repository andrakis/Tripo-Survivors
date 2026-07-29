# TRIPO SURVIVORS — Art Style

The visual target, and the rules that keep it working when someone drops in art we
didn't make.

**Status:** v1, 2026-07-29. Refines [DESIGN.md §3 pillar 3](DESIGN.md) and
[§12 readability](DESIGN.md). Asset-side requirements live in
[MODEL-PIPELINE.md](MODEL-PIPELINE.md).

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

4. **Fog does the depth work.** Exponential fog matched exactly to the ground colour,
   tuned so the spawn ring is at the edge of visibility. Enemies fade *in* as they
   approach rather than popping at a frustum boundary — which also means the arena's
   edges never need to be modelled.

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
| Ground | `#2a2f38` | Cool near-black; the darkest thing on screen |
| Ground grid | `#3d4453` | Faint 8-unit lines — motion reference, not decoration |
| Ground, out-of-bounds band | `#1c2027` | Visibly darker so being cornered reads early |
| Props | `#6b6f7a` | Neutral grey, flat-shaded, no tint variation |
| Fog | `#2a2f38` | **Exactly** the ground colour — the horizon must vanish |
| Player | `#ffe9a8` | Warm, bright, highest value on screen |
| Grunt | `#7fd15a` | Green |
| Runner | `#5ad1c8` | Cyan, thin silhouette |
| Brute | `#d1585a` | Red, wide silhouette |
| Elite | `#c45ad1` | Violet, huge |
| XP orb | `#8fe3ff` | Emissive pale blue |
| Aura | `#ffd166` at 0.18 alpha | Additive ground disc, brightens on pulse |
| Bolt | `#ffe9a8` | Emissive, matches the player — reads as *yours* |
| Damage vignette | `#ff3b30` | Full-screen flash on player hit |

Two rules constrain any future addition to this table:

- **The player is always the highest-value pixel on screen.** If an imported model
  outshines them, its registry tint is wrong.
- **No enemy tier shares a hue.** Colour is the backup channel when an imported
  model's silhouette doesn't match the tier it was assigned to.

## Silhouette hierarchy

Colour is backup; **size and proportion are primary**, and both are enforced by the
loader's scale normalisation ([MODEL-PIPELINE.md §4](MODEL-PIPELINE.md)) regardless
of what the source model looks like.

```
   elite  ████████     4.5u tall, 2.8 wide     "route around this"
   brute  ████         2.6u tall, 1.6 wide     "this will reach you"
   grunt  ██           1.4u tall, 0.8 wide     "the mass"
   runner ▐            1.5u tall, 0.7 wide     "this is fast"
   player ▐▌           1.7u, bright            "you"
```

The player is deliberately mid-height — not the biggest thing on screen — so an elite
entering the frame is immediately legible as a problem.

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
| Idle crowd | Per-enemy bob and slight scale jitter keyed off the `seed` field |

That last one matters more than its size suggests: 400 copies of one model moving in
perfect lockstep reads as a rendering artifact. A per-instance random phase costs one
float already in the data layout and makes the crowd look alive.

## Ground

A single plane with a shader-free grid: an 8-unit grid drawn into the ground texture,
or a large `GridHelper` under a transparent plane. It exists for one reason — with a
featureless ground and a camera that follows the player exactly, **player movement is
invisible**. The grid is the motion reference that makes running feel like running.

The out-of-bounds band is a darker ring at the world edge, wide enough to see before
you hit the clamp.

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
