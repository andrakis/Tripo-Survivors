// The readability rules, as assertions. DESIGN §12 and docs/ART-STYLE.md.
//
// These are not tuning tests and they deliberately do not restate the palette. Every case here
// guards a RULE that has to survive somebody changing a colour, a prop height or a tier's scale —
// which is exactly what M5 spent its afternoon doing, and exactly the kind of change whose damage is
// invisible until a still frame looks wrong for a reason nobody can name.
//
// The rules are also the reason a viewer can import a model we have never seen and still get a
// legible game, so they outlive our own art.

import { describe, expect, it } from 'vitest';
import { CFG, COLORS, FOG_FAR, FOG_NEAR, TIERS, TUNING } from './config';
import { ACTORS, type ActorId } from './models/registry';
import { OBSTACLES } from './sim/world';
import { SPAWN_R } from './sim/waves';

/** Relative luminance, 0..255. The channel weights are Rec. 709 — what "brighter" means to an eye. */
function luminance(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Hue in degrees, 0..360. Undefined for a grey, which is why the callers below are all cast. */
function hue(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
}

/** Saturation, 0..1, in the HSV sense — how much chroma a colour is spending. */
function saturation(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

const CAST: ActorId[] = ['grunt', 'runner', 'brute', 'elite'];

describe('DESIGN §12 rule 1 — the player is the brightest thing on screen', () => {
  it('outranks every enemy tier in luminance', () => {
    const player = luminance(COLORS.PLAYER);
    for (const id of CAST) {
      expect(luminance(ACTORS[id].tint), `${id} is at least as bright as the player`).toBeLessThan(
        player,
      );
    }
  });

  it('keeps the stage dimmer than the cast and the ground dimmer still', () => {
    // The value ladder ART-STYLE describes, as an ordering rather than as numbers: ground < props <
    // every actor. Through M4 the props sat at 111 while the brute was 114 — technically ordered,
    // but by three points, across an object covering several times the screen area. M5 dropped the
    // prop to 83 and desaturated the two big tiers; this test is what stops that drifting back.
    const prop = luminance(COLORS.PROP);
    expect(luminance(COLORS.GROUND)).toBeLessThan(prop);
    expect(luminance(COLORS.OUT_OF_BOUNDS)).toBeLessThan(luminance(COLORS.GROUND));
    for (const id of CAST) {
      expect(luminance(ACTORS[id].tint), `${id} is dimmer than the props`).toBeGreaterThan(prop + 15);
    }
  });

  it('keeps every M7 stage addition inside the scenery value band', () => {
    // The grass, the boundary wall and the sky all arrived at once, and all three are enormous in
    // screen area — the ground is most of the frame, the wall is the tallest thing in the world, the
    // sky is the entire top half in orbit mode. Any one of them drifting bright would out-shout the
    // cast without ever looking wrong on its own, which is the exact failure the M5 prop pass fixed
    // and the reason this file exists.
    const prop = luminance(COLORS.PROP);
    const dimmestActor = Math.min(...CAST.map((id) => luminance(ACTORS[id].tint)));

    // GRASS_LIGHT is the brightest pixel the ground can produce anywhere, so it — not the base
    // colour — is what has to clear the props. Testing COLORS.GROUND alone would pass while the
    // texture stippled highlights straight through the ceiling.
    expect(luminance(COLORS.GRASS_LIGHT), 'the brightest grass out-values the props').toBeLessThan(prop);
    expect(luminance(COLORS.GRASS_DARK)).toBeLessThan(luminance(COLORS.GROUND));
    expect(luminance(COLORS.GROUND)).toBeLessThan(luminance(COLORS.GRASS_LIGHT));

    // The wall body is dimmer than the props it shares a palette with; its cap may reach them, since
    // a lit top edge is the whole reason the cap exists, but neither may reach the cast.
    expect(luminance(COLORS.WALL)).toBeLessThan(prop);
    expect(luminance(COLORS.WALL_CAP)).toBeLessThanOrEqual(prop);
    expect(luminance(COLORS.WALL_CAP)).toBeLessThan(dimmestActor);

    // Hills are BEYOND the wall and must recede: darker than the ground they sit behind, or the eye
    // reads the horizon as somewhere with more going on than the arena.
    expect(luminance(COLORS.HILL)).toBeLessThan(luminance(COLORS.GROUND));

    // A daylit sky is a screenful of pixels brighter than the player, and no tuning of the cast
    // recovers from that. Dusk is not a style choice here; it is what rule 1 costs.
    expect(luminance(COLORS.SKY_TOP)).toBeLessThan(luminance(COLORS.GROUND));
  });

  it('keeps the fog exactly on the ground colour, which three things now depend on', () => {
    // The horizon has to vanish rather than band. Since M7 this identity is load-bearing in a second
    // place too: the sky shader pins its lower half to FOG so the gradient meets the fogged ground
    // in the same value from every orbit angle (scene/Sky.tsx).
    expect(COLORS.FOG).toBe(COLORS.GROUND);
  });

  it('does not let the BIG tiers spend as much chroma as the small ones', () => {
    // Attention is area × chroma, not value alone, which is what the M4 palette got wrong: a 4.5-unit
    // elite at full saturation out-shouts a 1.7-unit player who is strictly brighter than it. Big
    // silhouettes carry themselves; the grunt and the runner have only colour, so they keep theirs.
    const small = Math.min(saturation(ACTORS.grunt.tint), saturation(ACTORS.runner.tint));
    for (const id of ['brute', 'elite'] as ActorId[]) {
      expect(saturation(ACTORS[id].tint), `${id} is as saturated as the small tiers`).toBeLessThan(
        small,
      );
    }
  });
});

describe('DESIGN §12 rule 2 — tier reads from silhouette and colour', () => {
  it('gives every tier its own hue, at least 40° from any other', () => {
    // Colour is the BACKUP channel for when an imported model's silhouette does not match the tier it
    // was assigned to. Two tiers sharing a hue would delete the backup silently.
    for (let i = 0; i < CAST.length; i++) {
      for (let j = i + 1; j < CAST.length; j++) {
        const d = Math.abs(hue(ACTORS[CAST[i]].tint) - hue(ACTORS[CAST[j]].tint));
        const sep = Math.min(d, 360 - d);
        expect(sep, `${CAST[i]} and ${CAST[j]} share a hue`).toBeGreaterThan(40);
      }
    }
  });

  it('keeps M5s per-enemy scale jitter well inside the gaps the height ladder actually carries', () => {
    // The jitter exists so 400 copies of one model do not read as one organism (ART-STYLE). It must
    // never be able to make one tier read as another, because height is the part of the silhouette
    // hierarchy that survives a viewer importing models we have never seen — the loader normalises
    // every import to it.
    //
    // The ladder became FOUR rungs when the first real runner import landed. At 1.5 the slim swift
    // model READ smaller than the squat 1.4 grunt — normalisation locks bounding heights, not
    // perceived mass — so the runner moved to 2.1 and size now carries threat outright:
    // grunt → runner → brute → elite. Every gap has to hold the jitter.
    const j = TUNING.SCALE_JITTER;
    const rungs = [ACTORS.grunt.height, ACTORS.runner.height, ACTORS.brute.height, ACTORS.elite.height];
    for (let i = 0; i + 1 < rungs.length; i++) {
      // The tallest an enemy on the lower rung can be, against the shortest on the one above it.
      expect(rungs[i] * (1 + j)).toBeLessThan(rungs[i + 1] * (1 - j));
    }
    // And a bob that could lift a body clear of the ground would break the same ladder from below.
    expect(TUNING.BOB_AMP).toBeLessThan(0.15);
  });
});

describe('the stage does not hide the crowd', () => {
  it('keeps every prop short enough to cast a blind spot under one rank deep', () => {
    // The camera looks down at exactly 45° (CAM_OFFSET is [0, y, y]), so a prop of height h hides the
    // ground for h units directly behind it, and hides a 1.7-unit character for h - 1.7. The 8-unit
    // pillars M0 placed threw a six-unit blind spot each — and separation stacks the swarm about
    // SEP_R apart, so that is five ranks of enemies you cannot see. M3's see-through pass answers
    // this for the player; nothing answers it for the crowd except shorter props.
    const [ox, oy, oz] = TUNING.CAM_OFFSET;
    expect(ox).toBe(0);
    expect(oy).toBe(oz); // the 45° the arithmetic below assumes

    const playerHeight = ACTORS.player.height;
    for (const o of OBSTACLES) {
      const blind = o.height - playerHeight;
      expect(blind, `a prop of height ${o.height} hides ${blind.toFixed(1)} units`).toBeLessThan(
        3 * TUNING.SEP_R,
      );
    }
  });
});

describe('the fog', () => {
  it('leaves the player completely unfogged', () => {
    // ART-STYLE's first palette rule is that the player is the brightest pixel, and exponential fog
    // has no near plane — under the exp² curve M0 shipped, the player sat permanently ~23% blended
    // into the fog colour. A linear fog whose near plane clears the camera's own standoff cannot.
    const [, y, z] = TUNING.CAM_OFFSET;
    const toPlayer = Math.hypot(y, z);
    expect(FOG_NEAR).toBeGreaterThan(toPlayer);
  });

  it('puts the far arc of the spawn ring inside the fade, with ground still visible past it', () => {
    // The geometry that makes "fog tuned so the spawn ring sits at the edge of visibility" impossible
    // to satisfy literally: the ring is one GROUND distance but many CAMERA distances. With the rig
    // at [0, 26, 26] the near arc is closer to the camera than the player is (26.7 against 36.8) and
    // the far arc is 63.7. So the fade is aimed at the far arc — the direction the player is usually
    // retreating away from, and has the most time to read.
    const [, y, z] = TUNING.CAM_OFFSET;
    const far = Math.hypot(y, SPAWN_R + z); // the arc walking in from the top of the screen
    const near = Math.hypot(y, SPAWN_R - z); // ...and the one behind the player
    expect(near).toBeLessThan(Math.hypot(y, z)); // closer than the player: nothing can fog this
    expect(far).toBeGreaterThan(FOG_NEAR);
    expect(far).toBeLessThan(FOG_FAR); // fading, not gone — enemies fade IN rather than pop
    expect(FOG_FAR - far).toBeGreaterThan(10); // and the horizon is not sitting on the ring
  });

  it('is exactly the ground colour, so the horizon vanishes rather than bands', () => {
    expect(COLORS.FOG).toBe(COLORS.GROUND);
  });
});

describe('escalation is legible without a number (DESIGN pillar 4)', () => {
  it('introduces the tiers in order, each worth more than the last', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].entersAt).toBeGreaterThan(TIERS[i - 1].entersAt);
      // XP is the one column that IS monotonic, and it has to be: it is the promise that a harder
      // thing pays better, and it is what makes fighting the new tier rather than kiting past it the
      // profitable line.
      expect(TIERS[i].xp).toBeGreaterThan(TIERS[i - 1].xp);
    }
  });

  it('does not make the runner a strictly bigger grunt', () => {
    // Worth pinning because the obvious reading of "escalation" is a monotonic HP column, and the
    // runner deliberately breaks it — 6 HP against a grunt's 10. It is a SIDESTEP, not a rung: it
    // arrives fragile and faster than the player, so the crowd stops being one problem with one
    // answer. Escalation you can feel (DESIGN pillar 4) is a change of kind here, not of magnitude.
    expect(TIERS[1].hp).toBeLessThan(TIERS[0].hp);
    expect(TIERS[1].contact).toBeLessThan(TIERS[0].contact);
    // The heavies are the rungs, and those ARE monotonic.
    expect(TIERS[2].hp).toBeGreaterThan(TIERS[0].hp);
    expect(TIERS[3].hp).toBeGreaterThan(TIERS[2].hp);
  });

  it('makes the runner genuinely faster than the player, which is its entire job', () => {
    // DESIGN §5 says the player "cannot outrun a runner", and that is the reason a player cannot
    // simply hold one direction for five minutes. Through M4 the runner was 5.2 against a player at
    // 7.0 — both documents described the tier correctly and the number matched neither of them. It
    // is not cosmetic: at 7.0 a straight line beats the entire game, and the first version of
    // scripts/balance.ts proved it by finishing a minute of play with zero kills.
    expect(TIERS[1].speed).toBeGreaterThan(TUNING.PLAYER_SPEED);
    // ...and everything else is slower, so a runner is the ONE thing you have to turn and face.
    for (const i of [0, 2, 3]) expect(TIERS[i].speed).toBeLessThan(TUNING.PLAYER_SPEED);
  });

  it('keeps the elite off the general spawn budget', () => {
    // A tier that costs 400 HP has to be paced, not rolled for (DESIGN §7.2).
    expect(TIERS[3].weight).toBe(0);
    expect(TUNING.ELITE_INTERVAL).toBeGreaterThan(0);
  });

  it('spawns outside the frustum corner, not the frustum edge', () => {
    // The farthest visible point is a corner, so a ring sized off the half-WIDTH would pop enemies
    // into the corners of the screen — the one thing DESIGN §7.2 forbids outright.
    expect(SPAWN_R).toBeGreaterThan(Math.hypot(CFG.VIEW_W / 2, CFG.VIEW_H / 2));
  });
});

describe('the Orbiter sweeps without gaps (DESIGN §6.3, level 9)', () => {
  it('hits often enough that its arc between hits is covered by its own hit radius', () => {
    // The cadence has a geometric floor, which is a better answer than a feel argument. Between two
    // hits the sphere travels ORBITER_SPIN / ORBITER_RATE radians, or that times ORBITER_R units of
    // arc, and it covers 2 × ORBITER_HIT_R. Below the floor the ring visibly leaks enemies.
    const arc = (TUNING.ORBITER_SPIN / TUNING.ORBITER_RATE) * TUNING.ORBITER_R;
    expect(arc).toBeLessThan(2 * TUNING.ORBITER_HIT_R);
  });

  it('sits inside the level-2 aura, so it is not a new range band to learn', () => {
    expect(TUNING.ORBITER_R).toBeLessThan(TUNING.AURA_R + 1.0);
  });
});
