// Every tunable number in the game, in one file.
//
// CFG is structural (world size, grid resolution) — changing it changes what the arena IS.
// TUNING is balance — changing it changes how the game FEELS. Progression modifies TUNING-derived
// values at runtime (docs/DESIGN.md §6.3), so treat these as the level-1 baseline, not as constants.
//
// Numbers here come from docs/DESIGN.md; the swarm block is scaled from Breach's config.ts.

export const CFG = {
  // World spans -WORLD_X/2 .. WORLD_X/2 on X and likewise on Z. Square.
  WORLD_X: 256,
  WORLD_Z: 256,

  // Flow-field grid. Square cells (WORLD_X / GRID_W === WORLD_Z / GRID_H === 2), which is what
  // lets a single cells-per-world ratio serve both axes. Keep it that way.
  GRID_W: 128,
  GRID_H: 128,

  // What the camera shows, in world units (DESIGN §12). It follows from CAM_OFFSET and CAM_FOV, and
  // is restated here because the spawn director needs it and sim/ may not import a camera.
  VIEW_W: 40,
  VIEW_H: 26,
} as const;

export const HALF_X = CFG.WORLD_X / 2;
export const HALF_Z = CFG.WORLD_Z / 2;
export const CELLS_PER_WORLD = CFG.GRID_W / CFG.WORLD_X; // 0.5 — valid on both axes (square cells)

export const TUNING = {
  // --- player (DESIGN §5) ---
  PLAYER_HP: 100,
  PLAYER_SPEED: 7.0, // faster than a grunt (3.4), SLOWER than a runner (5.2) — see DESIGN §5
  PLAYER_R: 0.6,
  PLAYER_RESPONSE: 30, // velocity lerp rate toward the input heading, as 1 - exp(-k*dt).
  // Not in DESIGN — it is a feel constant, found by driving the character (ROADMAP M1). High enough
  // that the character reads as instantly responsive, low enough that a hard reverse has weight
  // instead of teleporting the model through a 180. Below ~12 it feels like ice; above ~40 the
  // smoothing stops being perceptible and this may as well be a direct velocity assignment.
  PLAYER_IFRAMES: 0.6, // seconds of invulnerability after taking a hit
  PICKUP_R: 3.0, // XP orb magnet radius

  // --- dash (DESIGN §5.1) ---
  DASH_SPEED: 30, // ~4× walking, so the dash reads as a different verb rather than a sprint
  DASH_TIME: 0.16, // 4.8 units of travel: through a front rank, not across the arena
  DASH_COOLDOWN: 2.2, // the level-1 cooldown; a level-up stat shortens it
  DASH_IFRAMES: 0.22, // slightly longer than the dash itself, so arriving inside a crowd is survivable
  // — the dash is an escape, and one that drops you into contact damage on frame 10 is a trap.

  // --- swarm steering (ported from Breach/src/config.ts:105-131) ---
  // SEP and SEP_PUSH are BOTH required: the steering bias alone gets normalised away whenever the
  // flow heading dominates and the crowd collapses to a point. See ARCHITECTURE §4.3.
  SPEED: 4.0, // baseline; per-tier speeds override (DESIGN §7.1)
  SEP: 0.55, // separation weight (steering bias away from neighbours)
  SEP_R: 1.1, // separation radius — also the target spacing for the hard push
  SEP_PUSH: 0.35, // fraction of unit-unit overlap resolved POSITIONALLY per pair (half each side)
  SEP_PUSH_MAX: 0.25, // hard per-tick cap on the positional push. Without it a dense jam flings a
  // front-rank unit clean through an obstacle, past the MTV that would have caught a normal step.
  FLOW_W: 1.0, // flow-field steering weight
  STEER_RESPONSE: 6, // velocity lerp rate toward the desired heading
  UNIT_R: 0.5, // enemy collision radius (obstacle push-out)

  // --- flow field (ARCHITECTURE §4.2) ---
  FLOW_HZ: 10, // distance-field re-solves per second (plus an immediate re-solve on cell change)
  OBSTACLE_COST: 40, // per-cell cost added over an obstacle. EXPENSIVE, NOT IMPASSABLE — every cell
  // stays reachable, so the field has no zero-gradient dead zone where a unit can stall.

  // --- weapons (DESIGN §6) ---
  AURA_R: 3.0,
  AURA_DAMAGE: 6,
  AURA_RATE: 2, // pulses per second
  AURA_FLARE: 0.22, // seconds the ring stays bright after a pulse. Purely visual, but load-bearing:
  // the aura is silent and has no projectile, so the flare is the ONLY evidence it fired.
  BOLT_DAMAGE: 12,
  BOLT_SPEED: 26,
  BOLT_INTERVAL: 0.55, // seconds between shots
  BOLT_RANGE: 22,
  BOLT_PIERCE: 1, // enemies a bolt passes through
  BOLT_R: 0.25, // bolt collision radius, added to UNIT_R for the swept-segment test
  BOLT_SPREAD: (12 * Math.PI) / 180, // Twin Lance half-angle (DESIGN §6.3, level 7): ±12°

  // --- unlocks that arrive as whole mechanics (DESIGN §6.3) ---
  ORBITER_R: 2.4, // orbit radius. Inside the level-2 aura (4.0) on purpose: the Orbiter is a second
  // ring of damage the player already knows how to position, not a new range band to learn.
  ORBITER_SPIN: 2.6, // radians/sec
  ORBITER_HIT_R: 0.9, // damage radius around the sphere itself
  ORBITER_DAMAGE: 5,
  ORBITER_RATE: 5, // hits per second. Contact damage on a cadence rather than continuously — see
  // sim/combat.ts stepOrbiters for why a true contact test would need per-enemy state.
  KNOCKBACK: 7, // Concussion (level 11): outward velocity added to everything an aura pulse hits.
  // A velocity impulse, not a teleport: the swarm's steering lerp bleeds it off against the flow
  // heading at STEER_RESPONSE, so the net displacement is about 0.17 × this — ~1.2 units per pulse —
  // and it reads as a shove the crowd then walks back through.
  //
  // The size is load-bearing and was found by playing it. At 14 the shove outruns everything slower
  // than a runner: pushed 2.3 u twice a second, a brute (2.2 u/s) and an elite (1.8 u/s) can never
  // close, and level 11 quietly ends the run's difficulty curve. At 7 the fast crowd walks straight
  // back in and only the heavies are held off — which is what a defensive unlock should buy.

  // --- XP orbs (DESIGN §8) ---
  ORB_SPEED_MIN: 3.5, // magnet speed at the rim of the pickup radius...
  ORB_SPEED_MAX: 30, // ...and at the player. The gap is what makes a pickup snap rather than drift.
  ORB_TOUCH: 0.9, // distance at which an orb is banked
  ORB_POP: 0.25, // seconds an orb spends scaling up out of the body that dropped it
  ORB_HOME_MUL: 1.7, // a LATCHED orb's floor speed, as a multiple of the player's CURRENT speed.
  // Once an orb has started coming it never gives up (DESIGN §8), and "never gives up" has to be
  // measured against the player: at level 8+ the character outruns any fixed number, and an orb
  // that visibly chases and then falls behind is worse than one that never moved.

  // --- orb merging (DESIGN §8) ---
  ORB_MERGE_AT: 120, // field size at which merging starts. Below this the scattered field IS the
  // record of where you have been, and consolidating it early would delete the thing it is for.
  ORB_MERGE_AGE: 12, // seconds an orb must have lain uncollected before it can merge
  ORB_MERGE_CELL: 4.0, // orbs sharing a cell this size merge into one
  ORB_MERGE_HZ: 2, // merge passes per second

  // --- boosts (DESIGN §6.4) ---
  BOOST_FIRST: 25, // seconds before the first one appears
  BOOST_INTERVAL: 40, // mean seconds between boosts...
  BOOST_JITTER: 14, // ...± this, so they are not a metronome the player can plan around
  BOOST_R_MIN: 11, // spawn distance from the player. Inside the view's half-diagonal at the low end
  BOOST_R_MAX: 26, // (visible now) and outside it at the high end (worth going to find).
  BOOST_PICKUP_R: 1.3,
  BOOST_TRIES: 12, // rejection-sample attempts before giving up on this spawn
  MAX_BOOSTS: 6, // uncollected boosts on the field at once
  QUAD_MUL: 4, // Quad Damage: outbound damage multiplier while active
  AKIMBO_MUL: 2, // Guns Akimbo: bolts per volley multiplier while active
  BLOODLUST_HEAL: 1, // HP restored per kill while Bloodlust is active

  // --- level-up feedback (DESIGN §12 rule 4, applied to the good news) ---
  SHAKE_TIME: 0.35, // seconds a level-up shake takes to decay to nothing
  SHAKE_AMP: 0.55, // world units of camera displacement at full amplitude
  SHAKE_FREQ: 34, // rad/s. Fast enough to read as an impact rather than as a camera fault.

  // --- hit feedback (DESIGN §12 rule 4) ---
  FLASH_TIME: 0.12, // enemy hit-flash decay. Long enough to see at 60 fps, short enough that a crowd
  // under a sustained aura doesn't read as permanently white.
  FLASH_MIX: 0.45, // how far toward white a fresh hit takes the tier tint. NOT 1.0: the aura hits
  // everything in the ring on the same frame, so a full-white flash turns the entire crowd around
  // the player into one white mass a quarter of all frames — which hides the player inside it and
  // inverts the one rule the look rests on (DESIGN §12 rule 1). At 0.45 the hit still reads and the
  // tier colour still reads underneath it.
  DEATH_TIME: 0.85, // how long a death marker lives. Was 0.26 when the only death was a scale-punch
  // on a cube; an animated actor plays its `die` clip over this window instead, and a quarter of a
  // second is not enough of a fall to read as one. The punch curve is normalised over it either way,
  // so the primitive death slowed down too — which turns out to suit it. At the late-game kill rate
  // (~40/s) this is ~34 concurrent markers against MAX_DEATHS.
  MAX_DEATHS: 96, // concurrent death markers. At the late-game kill rate ~40/s × DEATH_TIME is ~11,
  // so this is slack for a level-up burst rather than a number that binds.

  // --- spawn director (DESIGN §7.2) ---
  SPAWN_BASE: 1.5, // enemies/sec at t=0
  SPAWN_RAMP: 22, // rate = SPAWN_BASE + t / SPAWN_RAMP
  SPAWN_RING_MULT: 1.35, // spawn radius as a multiple of the visible half-extent (always offscreen)
  SPAWN_TRIES: 8, // rejection-sample attempts per spawn before giving up for this tick
  TIER_RAMP: 30, // seconds for a tier to reach full weight after its entry time
  GRUNT_DECAY: 90, // seconds over which the grunt's share falls once other tiers are in play
  ELITE_INTERVAL: 45, // elites spawn on their OWN timer, not out of the general budget (DESIGN §7.2)

  // --- progression (DESIGN §8) ---
  XP_BASE: 5,
  XP_EXP: 1.45, // xpToNext(level) = ceil(XP_BASE * level ** XP_EXP)
  OFFER_COUNT: 3, // upgrades offered at a level-up the player chooses (DESIGN §6.3)

  // --- vertex animation (MODEL-PIPELINE §6) ---
  VAT_FPS: 24, // bake rate. Every frame costs vertexCount texels in two textures AND a slice of the
  // load-time bake, so this is the milestone's main cost dial. 24 is film rate and the crowd is
  // small on screen; 30 looked no different and cost 25% more of both.
  VAT_DIE_FROM: 2.7, // where in the `die` clip the bake starts. Tripo's 5.6 s `defeat` preset is 3 s
  // of staggering, the actual FALL at t≈2.9-3.4, then 2 s of lying still — measured from the Hip
  // rotation track, which swings from ~20° to 87° across exactly that window. Baking from 0 spends
  // the whole death marker on the stagger and no body ever hits the ground.
  VAT_DIE_TRIM: 1.0, // seconds of the clip to bake from VAT_DIE_FROM: the fall, plus enough of the
  // settle that the held final pose is genuinely flat. Safe to cut because a one-shot has no seam.
  VAT_IDLE_SPEED: 0.4, // below this an enemy plays `idle`...
  VAT_WALK_SPEED: 2.6, // ...below this, `walk`; above it, `run`. Between a grunt's 3.4 and a brute's
  // 2.2, so the two tiers move differently without either one being told which clip to use.
  VAT_ATTACK_R: 2.2, // within this of the player, an enemy plays an attack instead. Contact damage
  // reaches PLAYER_R + UNIT_R = 1.1 and separation stacks ranks ~1.1 apart, so 2.2 catches the rank
  // that is actually hurting you plus the one shoving in behind it — the crowd at the aura's edge
  // punches, the crowd further out still runs. Distance beats the speed thresholds on purpose: an
  // enemy pressed against the player is near-stationary, and before this existed it played `idle`
  // while killing you.

  // --- camera (ARCHITECTURE §9) ---
  CAM_OFFSET: [0, 26, 26] as const, // ~45° down, fixed world yaw, never rotates
  CAM_FOV: 45,
  CAM_STIFFNESS: 6, // used as 1 - exp(-k*dt), so it is framerate-independent

  // --- caps (ARCHITECTURE §5) ---
  MAX_ENEMIES: 400, // deliberately low; raise it to find your machine's ceiling
  MAX_BOLTS: 128,
  MAX_ORBS: 2048,

  STORE_HZ: 10, // how often per second sim state is pushed into the React store
} as const;

// The four enemy tiers, straight out of DESIGN §7.1. Order IS identity: an enemy's `tier` field is
// an index into this array, so inserting a tier in the middle renumbers the live swarm. Append only.
//
// `actor` names the models/registry.ts entry that draws the tier — the seam a viewer replaces.
export const TIERS = [
  { actor: 'grunt', hp: 10, speed: 3.4, contact: 6, xp: 1, entersAt: 0, weight: 10 },
  { actor: 'runner', hp: 6, speed: 5.2, contact: 4, xp: 2, entersAt: 60, weight: 6 },
  { actor: 'brute', hp: 60, speed: 2.2, contact: 18, xp: 6, entersAt: 120, weight: 5 },
  // Elite weight is 0 on purpose: it never comes out of the general spawn budget, it arrives on
  // ELITE_INTERVAL after `entersAt`. A tier this expensive has to be paced, not rolled for.
  { actor: 'elite', hp: 400, speed: 1.8, contact: 30, xp: 40, entersAt: 240, weight: 0 },
] as const;

export const TIER_COUNT = TIERS.length;
export const ELITE_TIER = 3;

/**
 * The boosts that spawn on the field (DESIGN §6.4).
 *
 * Order IS identity, exactly as with TIERS: a pickup's `kind` field is an index into this array, so
 * inserting one in the middle re-labels every boost already lying on the ground and every live
 * timer. Append only.
 *
 * `duration` 0 means the boost fires once and is over — there is nothing to time down, and the HUD
 * knows not to show a chip for it.
 */
export const BOOSTS = [
  {
    id: 'magnet',
    label: 'MAGNET',
    detail: 'every orb on the map comes to you',
    duration: 0,
    tint: 0x8fe3ff,
  },
  {
    id: 'invincible',
    label: 'INVINCIBLE',
    detail: 'no damage',
    duration: 15,
    tint: 0xffe9a8,
  },
  {
    id: 'quad',
    label: 'QUAD DAMAGE',
    detail: '4× outbound damage',
    duration: 15,
    tint: 0xc45ad1,
  },
  {
    id: 'akimbo',
    label: 'GUNS AKIMBO',
    detail: 'double the bolts',
    duration: 15,
    tint: 0xffb347,
  },
  {
    id: 'bloodlust',
    label: 'BLOODLUST',
    detail: '+1 HP per kill',
    duration: 30,
    tint: 0xd1585a,
  },
] as const;

export const BOOST_COUNT = BOOSTS.length;
export const BK_MAGNET = 0;
export const BK_INVINCIBLE = 1;
export const BK_QUAD = 2;
export const BK_AKIMBO = 3;
export const BK_BLOODLUST = 4;

/**
 * Orb grades: how a merged orb reads (DESIGN §8). Highest `min` at or below the orb's value wins,
 * so this table is searched from the end and must stay ascending.
 *
 * The point of the colour is that a consolidated field still tells you where the money is. A screen
 * of identical cyan dots after a merge pass would hide the fact that one of them is worth forty.
 */
export const ORB_GRADES = [
  { min: 0, tint: 0x8fe3ff, scale: 1.0 },
  { min: 5, tint: 0x7fd15a, scale: 1.3 },
  { min: 25, tint: 0xffd166, scale: 1.6 },
  { min: 100, tint: 0xff7ad1, scale: 2.0 },
] as const;

/** Index into ORB_GRADES for a value. */
export function orbGrade(value: number): number {
  for (let i = ORB_GRADES.length - 1; i > 0; i--) if (value >= ORB_GRADES[i].min) return i;
  return 0;
}

// docs/ART-STYLE.md. The stage is desaturated and dim; all chroma is spent on the cast.
export const COLORS = {
  GROUND: 0x2a2f38,
  GRID: 0x3d4453,
  OUT_OF_BOUNDS: 0x1c2027,
  PROP: 0x6b6f7a,
  FOG: 0x2a2f38, // EXACTLY the ground colour — the horizon has to vanish, not band

  PLAYER: 0xffe9a8,
  GRUNT: 0x7fd15a,
  RUNNER: 0x5ad1c8,
  BRUTE: 0xd1585a,
  ELITE: 0xc45ad1,
  ORB: 0x8fe3ff,
  AURA: 0xffd166,
  BOLT: 0xffe9a8,
  DAMAGE: 0xff3b30,
} as const;

export const FOG_DENSITY = 0.016; // tuned so the spawn ring sits at the edge of visibility
