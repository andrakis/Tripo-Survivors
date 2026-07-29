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
} as const;

export const HALF_X = CFG.WORLD_X / 2;
export const HALF_Z = CFG.WORLD_Z / 2;
export const CELLS_PER_WORLD = CFG.GRID_W / CFG.WORLD_X; // 0.5 — valid on both axes (square cells)

export const TUNING = {
  // --- player (DESIGN §5) ---
  PLAYER_HP: 100,
  PLAYER_SPEED: 7.0, // faster than a grunt (3.4), SLOWER than a runner (5.2) — see DESIGN §5
  PLAYER_R: 0.6,
  PLAYER_IFRAMES: 0.6, // seconds of invulnerability after taking a hit
  PICKUP_R: 3.0, // XP orb magnet radius

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
  BOLT_DAMAGE: 12,
  BOLT_SPEED: 26,
  BOLT_INTERVAL: 0.55, // seconds between shots
  BOLT_RANGE: 22,
  BOLT_PIERCE: 1, // enemies a bolt passes through

  // --- spawn director (DESIGN §7.2) ---
  SPAWN_BASE: 1.5, // enemies/sec at t=0
  SPAWN_RAMP: 22, // rate = SPAWN_BASE + t / SPAWN_RAMP
  SPAWN_RING_MULT: 1.35, // spawn radius as a multiple of the visible half-extent (always offscreen)

  // --- progression (DESIGN §8) ---
  XP_BASE: 5,
  XP_EXP: 1.45, // xpToNext(level) = ceil(XP_BASE * level ** XP_EXP)

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
