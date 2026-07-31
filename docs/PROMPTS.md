# TRIPO SURVIVORS — Model Prompts

Ready-to-paste Tripo prompts for the game's cast. Each is under 250 characters.

Tier reads (size, colour, role) come from [DESIGN.md §7.1](DESIGN.md) and the
silhouette hierarchy in [ART-STYLE.md](ART-STYLE.md). Import requirements are in
[MODEL-PIPELINE.md](MODEL-PIPELINE.md).

## Two things every prompt must keep

- **"facing forward"** — facing is derived from movement and the renderer rotates by
  `atan2` assuming the model looks down **+Z**. A model facing −Z runs backward; it is
  the most common import bug ([MODEL-PIPELINE.md §3](MODEL-PIPELINE.md)).
- **"A-pose"** — the enemy tiers get rigged in M5, and a dynamic action pose bakes
  badly.

Scale doesn't matter — the loader normalises every import to its tier's height.

---

## Grunt — the mass (1.4u tall, 0.8 wide, `#7fd15a` green)

```
Small hunched goblin scavenger, stubby limbs, oversized underbite jaw, mossy
green hide, patchy leather scraps. Single creature, upright A-pose, front
facing, symmetrical, chunky readable silhouette, game-ready, plain background.
```

```
Squat fungal imp with mushroom-cap head, thin arms, wide flat feet, sickly
green skin. One creature, standing A-pose, facing forward, simple bold
silhouette, low-poly game character, neutral background.
```

## Runner — thin and fast (1.5u tall, 0.7 wide, `#5ad1c8` cyan)

```
Gaunt sprinting ghoul, elongated legs, whip-thin torso, no arms below the
elbow, teal translucent skin, trailing frayed shroud. Single figure, upright
A-pose, facing forward, narrow silhouette, game-ready character.
```

```
Insectoid stalker on two long backward-jointed legs, needle limbs, smooth cyan
chitin, small eyeless head. One creature, standing A-pose, front facing, thin
tall silhouette, low-poly game asset, plain background.
```

## Brute — the wall (2.6u tall, 1.6 wide, `#d1585a` red)

```
Heavyset armored ogre, barrel chest, huge shoulders, tiny head sunk between
them, thick stone-slab arms, deep red scarred hide. Single figure, upright
A-pose, facing forward, very wide silhouette, game-ready character.
```

```
Bloated crimson flesh-golem, cracked hide leaking ember light, plated forearms,
squat pillar legs. One creature, standing A-pose, front facing, broad heavy
silhouette, low-poly game character, neutral background.
```

## Elite — route around it (4.5u tall, 2.8 wide, `#c45ad1` violet)

```
Towering violet warlord demon, crowned horns, four arms, hunched cathedral-like
back spines, tattered banner cloak. Single figure, upright A-pose, facing
forward, massive imposing silhouette, game-ready character, plain background.
```

```
Colossal amethyst crystal titan, faceted limbs, glowing fractured core in the
chest, no face. One creature, standing A-pose, front facing, enormous wide
silhouette, stylized low-poly game asset, neutral background.
```
