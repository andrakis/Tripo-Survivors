// A PLAYED RUN, without a player. `npx vite-node scripts/balance.ts` (npm run balance).
//
// ROADMAP M5's balance bullet says the "level 8 by 2:30, level 12 by 5:00" target needs a played run
// rather than arithmetic, and M4 could only check that the spawn curve and the XP curve were within
// an order of magnitude of each other. This is the missing half: a bot drives `stepGame` at a fixed
// 60 Hz for five simulated minutes and reports when each level landed, how long it lived, and what
// the field looked like on the way.
//
// It is NOT a test and it asserts nothing. Spawn angles, tier rolls and offer rolls are all
// Math.random, so every run differs; the script takes the median of several and prints the spread,
// which is the honest form of the claim. Tuning decisions in config.ts cite the numbers this prints.
//
// It runs in node because everything under sim/ is required to (ARCHITECTURE §2.1) and game.ts now
// guards its dev-only window seam, so the spine that orders them runs there too.

import { performance } from 'node:perf_hooks';
import { TIERS, TUNING } from '../src/config';
import { game, resetGame, stepGame } from '../src/game';
import { resetInput, setTouchVector, queueDash } from '../src/input';
import { chooseUpgrade, isPaused, stepProgression } from '../src/sim/progression';
import { canDash } from '../src/sim/player';
import { E_TIER, E_X, E_Z, ENEMY_STRIDE } from '../src/sim/swarm';
import { O_VALUE, O_X, O_Z, ORB_STRIDE } from '../src/sim/orbs';
import { DR_VALUE, DROP_STRIDE } from '../src/sim/combat';
import { HALF_X, HALF_Z } from '../src/config';
import { overlapsObstacle } from '../src/sim/world';

const DT = 1 / 60;
const RUN_SECONDS = Number(process.env.RUN_SECONDS ?? 330);
const RUNS = Number(process.env.RUNS ?? 5);

// --- the bot -------------------------------------------------------------------------------------
//
// Not an AI, and deliberately not an optimal one: it is a stand-in for "someone competent", which is
// the wording the acceptance criterion actually uses. It kites the way a person does — sample the
// directions you could go, and take the one that keeps the crowd at arm's length while walking over
// the most XP. Everything it knows, a player can see on screen.

/** Candidate headings per decision. 32 is 11° apart — finer than a keyboard's 8, coarser than aim. */
const HEADINGS = 32;
/**
 * Seconds of travel the bot scores a heading over — and, just as importantly, the horizon it
 * predicts the CROWD over. Scoring against where enemies are standing now rather than where they
 * will be is what a bad player does, and the bot did it too: it walked into the space a rank was
 * already closing on, got surrounded, and died at 0:35 in a game meant to last five minutes.
 * A second of lead is roughly what the camera gives a person (DESIGN §12).
 */
const LOOKAHEAD = 1.1;
/** Enemies further than this are somebody else's problem, and scoring them all is the script's cost. */
const THREAT_R = 18;
/** How much an orb's XP is worth against a grunt's contact damage. Found by watching the bot: below
 *  ~1.5 it kites forever and never banks anything; above ~4 it walks into brutes to pick up a 1. */
const ORB_WEIGHT = 2.4;
/**
 * What keeping one enemy inside the aura is worth. THE most important number here, and the first
 * version of this script did not have it: a bot that only avoids danger simply runs, and the player
 * moves at 7.0 against a grunt's 3.4, so it outran the entire game and finished sixty seconds with
 * **zero kills**. Real play is a shallow kite — you stay close enough that the front rank stays in
 * the ring — and that is a REWARD for proximity, not merely a weaker penalty.
 */
const GRAZE = Number(process.env.GRAZE ?? 1.8);
/**
 * What pointing the Lance down a line of enemies is worth. Facing comes from movement (DESIGN §6.2),
 * so the only way a player aims is by choosing which way to walk — and the design's stated optimal
 * line is "retreat, then periodically turn into the crowd". Without this term the bot fled with its
 * bolts firing into empty ground for the whole run, which is not what a competent player does with
 * the weapon the run is built around.
 */
const BOLT_ALIGN = 0.55;
/** Inside this the bot is about to eat contact damage, and it weighs that far above any pickup. */
const TOUCH_R = 1.7;
/** Beyond this an enemy exerts no pressure at all — see the score loop for why that matters. */
const PRESSURE_R = 9;
/**
 * The stand-off the bot holds, as a distance INSIDE the aura's rim rather than an absolute number.
 *
 * Absolute was a trap and cost an afternoon. The graze reward only counts enemies between the
 * stand-off and the rim, so a stand-off of 2.9 against a level-1 aura of 3.0 leaves a band a tenth
 * of a unit wide — the bot then cannot be rewarded for grinding anything, settles into a wide orbit
 * with the crowd six units away, and clears 12% of the field over five minutes. Read as a balance
 * result that would have been completely wrong. As an offset it also grows with every Aura pick,
 * which is what a player does with the extra radius.
 */
const KEEP_INSET = Number(process.env.KEEP_INSET ?? 0.8);
/**
 * Ticks between decisions. A bot that re-picks a heading 60 times a second dithers between two
 * near-equal candidates and travels nowhere — and no human plays at that rate. 6 ticks is 10 Hz.
 */
const DECIDE_EVERY = 6;

/** Upgrade preference, best first. A player chasing the level-12 target takes offence, not defence. */
const PICK_ORDER = ['damage', 'aura', 'rate', 'magnet', 'speed', 'hp', 'dash'];
/** ...unless they are hurt, in which case Max HP is also a free full heal and everybody takes it. */
const PANIC_HP = 0.5;

interface Sample {
  t: number;
  enemies: number;
  orbs: number;
  hp: number;
  level: number;
  nearest: number;
}

interface RunResult {
  /** Run time at which each level was reached, indexed by level. Sparse below 2. */
  levelAt: number[];
  diedAt: number;
  kills: number;
  level: number;
  samples: Sample[];
  /** Ticks in which contact damage landed, over ticks lived — the pressure the player is under. */
  hitRate: number;
  /** XP that hit the ground this run, against XP actually banked. The gap is the field left behind. */
  dropped: number;
  banked: number;
  /** Enemies that spawned, against enemies killed. The gap is the crowd that is still walking. */
  spawned: number;
  /**
   * How close the HEAVIES actually got: the closest a brute or elite came all run, and the mean of
   * that distance over the run. This is the measurement M4's Concussion note needed and did not
   * have — "a brute can never close" is a claim about a distance, and hits-per-second cannot answer
   * it, because a shove that holds the heavies off also lets the player stand in the light crowd
   * for longer and take MORE small hits.
   */
  heavyMin: number;
  heavyMean: number;
}

function chooseOffer(): void {
  const offer = game.prog.offer;
  if (!offer) return;
  const hurt = game.player.hp / game.player.maxHp < PANIC_HP;
  if (hurt) {
    const heal = offer.findIndex((u) => u.id === 'hp');
    if (heal >= 0) {
      chooseUpgrade(game.prog, game, heal, game.time);
      return;
    }
  }
  let best = 0;
  let bestRank = Infinity;
  for (let i = 0; i < offer.length; i++) {
    const rank = PICK_ORDER.indexOf(offer[i].id);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = i;
    }
  }
  chooseUpgrade(game.prog, game, best, game.time);
}

/** Pick this tick's heading, and dash if something is about to touch us. Writes the input vector. */
function driveBot(): number {
  const p = game.player;
  const s = game.swarm;
  const o = game.orbs;
  const speed = TUNING.PLAYER_SPEED * p.speedMul;
  const reach = speed * LOOKAHEAD;

  // Gather once, score many times. A linear scan over the swarm beats a grid query here because the
  // bot looks at a radius the grid would walk most of anyway, and this is not the game's hot loop.
  const auraR2 = game.combat.auraR * game.combat.auraR;
  // Aggression is a function of health, which is the single change that made the bot survive a full
  // run without going passive. A fixed weight gives you one of two bots: one that hugs the front
  // rank, out-kills everything and dies at 0:45, or one that kites forever and banks nothing. A
  // person does neither — they push while healthy and give ground while hurt, and the run's shape
  // comes from oscillating between the two. Invincible removes the reason to be careful at all.
  const health = p.invincible > 0 ? 1.6 : Math.max(0.15, p.hp / p.maxHp);
  const graze = GRAZE * health;
  const keepR = Math.max(TOUCH_R + 0.3, game.combat.auraR - KEEP_INSET);
  const ex: number[] = [];
  const ez: number[] = [];
  const ec: number[] = [];
  const ev: number[] = [];
  let nearest = Infinity;
  for (let i = 0; i < s.n; i++) {
    const b = i * ENEMY_STRIDE;
    const dx = s.data[b + E_X] - p.x;
    const dz = s.data[b + E_Z] - p.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > THREAT_R * THREAT_R) continue;
    if (d2 < nearest) nearest = d2;
    const tier = TIERS[s.data[b + E_TIER]];
    // Where it will BE, not where it is: everything in the swarm walks at the player, so a straight
    // lead along the current bearing is a good enough prediction and costs one normalise.
    const d = Math.sqrt(d2) || 1;
    const lead = Math.min(d - 0.2, tier.speed * LOOKAHEAD);
    ex.push(s.data[b + E_X] - (dx / d) * lead);
    ez.push(s.data[b + E_Z] - (dz / d) * lead);
    ec.push(tier.contact);
    ev.push(tier.xp);
  }
  nearest = Math.sqrt(nearest);

  const ox: number[] = [];
  const oz: number[] = [];
  const ov: number[] = [];
  for (let i = 0; i < o.n; i++) {
    const b = i * ORB_STRIDE;
    const dx = o.data[b + O_X] - p.x;
    const dz = o.data[b + O_Z] - p.z;
    if (dx * dx + dz * dz > 26 * 26) continue;
    ox.push(o.data[b + O_X]);
    oz.push(o.data[b + O_Z]);
    ov.push(o.data[b + O_VALUE]);
  }

  let bestScore = -Infinity;
  let bestX = 0;
  let bestZ = 0;
  for (let h = 0; h < HEADINGS; h++) {
    const a = (h / HEADINGS) * Math.PI * 2;
    const hx = Math.sin(a);
    const hz = Math.cos(a);
    const tx = p.x + hx * reach;
    const tz = p.z + hz * reach;

    // Walls and props are a heavy PENALTY, not a rejection. Rejecting them looks equivalent and is
    // not: backed into the Pillar Ring every candidate can be rejected at once, and a bot with no
    // best heading writes a zero input vector and stands perfectly still inside a crowd. That single
    // line was most of the early deaths, and it was measuring the script, not the game.
    let score = 0;
    if (Math.abs(tx) > HALF_X - 6 || Math.abs(tz) > HALF_Z - 6) score -= 400;
    if (overlapsObstacle(tx, tz, TUNING.PLAYER_R + 1.0)) score -= 400;
    let grazed = 0;
    for (let i = 0; i < ex.length; i++) {
      const dx = tx - ex[i];
      const dz = tz - ez[i];
      const d2 = dx * dx + dz * dz;
      // Three bands, which is how a player actually reads the crowd: touching (never), near enough
      // to be ground down by the aura (good — this is where XP comes from), and closing (bad).
      if (d2 < TOUCH_R * TOUCH_R) score -= 12 * ec[i];
      else if (d2 < keepR * keepR) score -= 3 * ec[i];
      else if (d2 < PRESSURE_R * PRESSURE_R) score -= ec[i] / (d2 + 1);
      // ...and nothing at all beyond PRESSURE_R. Summing a 1/d² term over the whole THREAT_R disc
      // looks harmless and is not: at the 400 cap the tail of two hundred distant enemies outweighs
      // the graze reward outright, and the bot spends the back half of the run sprinting in circles
      // with the nearest enemy fourteen units away and sixteen percent of the field cleared. Nobody
      // plays that way, because nobody can see a threat gradient from a crowd that far off.
      // Grazing is the OUTER half of the ring only, never the whole disc. Rewarding the whole disc
      // parks the bot with the front rank a body's width from contact, where separation jitter alone
      // walks somebody into it — which is how it lost half its HP in the first thirty seconds
      // against a crowd of thirty. A player keeps the rank at the RIM.
      // Only the front rank is worth anything, hence the cap: uncapped, a bot inside a ring of twenty
      // grunts scores its own encirclement as the best square on the board and stands there dying.
      if (d2 > keepR * keepR && d2 < auraR2) grazed += Math.sqrt(Math.min(6, ev[i]));
    }
    score += graze * Math.min(grazed, 8);

    // Bolt alignment: how much of the crowd this heading would fire THROUGH. Measured from the
    // player's own position, not the lookahead one, because that is where the shot leaves from.
    if (game.combat.boltEnabled) {
      let lined = 0;
      for (let i = 0; i < ex.length; i++) {
        const dx = ex[i] - p.x;
        const dz = ez[i] - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1 || d > TUNING.BOLT_RANGE) continue;
        if ((dx * hx + dz * hz) / d > 0.96) lined++; // within ~16° of the heading
      }
      score += BOLT_ALIGN * Math.min(lined, 6);
    }
    for (let i = 0; i < ox.length; i++) {
      const dx = tx - ox[i];
      const dz = tz - oz[i];
      score += (ORB_WEIGHT * ov[i]) / (dx * dx + dz * dz + 4);
    }
    // A faint pull toward the middle. Without it the bot drifts to a rim it is allowed to stand on
    // and spends the run with a third of the arena behind it, which flatters its survival.
    score -= 0.0006 * (tx * tx + tz * tz);

    if (score > bestScore) {
      bestScore = score;
      bestX = hx;
      bestZ = hz;
    }
  }

  setTouchVector(bestX, bestZ);
  // Dash the moment something is inside a body's width of contact and the cooldown is up. This is
  // the panic button DESIGN §5.1 describes, used the way it is described.
  if (nearest < 1.8 && canDash(p)) queueDash();
  return nearest;
}

function runOnce(): RunResult {
  resetGame(game);
  resetInput();
  // Diagnostic seam: hand the run a loadout up front to separate "the weapons are slow" from "the
  // curve is slow". GRANT_XP=1000 starts at roughly level 12 with everything unlocked, so the kill
  // rate it reports is the game's ceiling rather than the bot's climb.
  const grant = Number(process.env.GRANT_XP ?? 0);
  if (grant > 0) {
    stepProgression(game.prog, game, grant, 0, 0);
    while (isPaused(game.prog)) chooseOffer();
  }
  // Single-lever overrides, applied AFTER the grant so they win over whatever the unlock table set.
  // These are how the Concussion and Orbiter re-checks in ROADMAP M5 are run: hold a late loadout
  // fixed, move one number, and read the difference off the same bot.
  if (process.env.KNOCKBACK !== undefined) game.combat.knockback = Number(process.env.KNOCKBACK);
  if (process.env.ORBITERS !== undefined) game.combat.orbiters = Number(process.env.ORBITERS);
  if (process.env.ORBITER_RATE !== undefined) {
    (TUNING as { ORBITER_RATE: number }).ORBITER_RATE = Number(process.env.ORBITER_RATE);
  }
  const levelAt: number[] = [];
  const samples: Sample[] = [];
  let lastLevel = 1;
  let hits = 0;
  let ticks = 0;
  let lastHitAt = -1;
  let lastNearest = Infinity;
  let dropped = 0;
  let spawned = 0;
  let heavyMin = Infinity;
  let heavySum = 0;
  let heavyN = 0;

  const steps = Math.ceil(RUN_SECONDS / DT);
  for (let k = 0; k < steps; k++) {
    if (isPaused(game.prog)) {
      chooseOffer();
      continue;
    }
    if (game.player.hp <= 0) break;

    const nearest = k % DECIDE_EVERY === 0 ? driveBot() : lastNearest;
    lastNearest = nearest;
    const before = game.swarm.n;
    const killedBefore = game.combat.kills;
    stepGame(game, DT);
    ticks++;
    spawned += game.swarm.n - before + (game.combat.kills - killedBefore);
    for (let i = 0; i < game.combat.nDrops; i++) dropped += game.combat.drops[i * DROP_STRIDE + DR_VALUE];

    if (game.lastHitAt !== lastHitAt) {
      lastHitAt = game.lastHitAt;
      hits++;
    }
    while (lastLevel < game.prog.level) {
      lastLevel++;
      levelAt[lastLevel] = game.time;
    }
    if (k % 10 === 0) {
      let near = Infinity;
      for (let i = 0; i < game.swarm.n; i++) {
        const b = i * ENEMY_STRIDE;
        if (game.swarm.data[b + E_TIER] < 2) continue; // brutes and elites only
        const dx = game.swarm.data[b + E_X] - game.player.x;
        const dz = game.swarm.data[b + E_Z] - game.player.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < near) near = d2;
      }
      if (Number.isFinite(near)) {
        const d = Math.sqrt(near);
        if (d < heavyMin) heavyMin = d;
        heavySum += d;
        heavyN++;
      }
    }
    if (k % 30 === 0) {
      samples.push({
        t: game.time,
        enemies: game.swarm.n,
        orbs: game.orbs.n,
        hp: game.player.hp,
        level: game.prog.level,
        nearest,
      });
    }
  }

  return {
    levelAt,
    diedAt: game.player.hp <= 0 ? game.time : -1,
    kills: game.combat.kills,
    level: game.prog.level,
    samples,
    hitRate: ticks > 0 ? hits / ticks : 0,
    dropped,
    banked: game.prog.totalXp,
    spawned,
    heavyMin,
    heavyMean: heavyN > 0 ? heavySum / heavyN : NaN,
  };
}

// --- reporting -----------------------------------------------------------------------------------

function median(xs: number[]): number {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  return v[(v.length / 2) | 0];
}

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '  —  ';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function levelAtTime(r: RunResult, t: number): number {
  let lv = 1;
  for (let l = 2; l < r.levelAt.length; l++) if (r.levelAt[l] !== undefined && r.levelAt[l] <= t) lv = l;
  return lv;
}

const t0 = performance.now();
const results: RunResult[] = [];
for (let i = 0; i < RUNS; i++) results.push(runOnce());
const wall = (performance.now() - t0) / 1000;

console.log(`\n${RUNS} bot runs × ${RUN_SECONDS}s simulated at ${(1 / DT) | 0} Hz (${wall.toFixed(1)}s wall)\n`);

console.log('  level reached, by the clock');
for (const t of [60, 90, 150, 210, 300]) {
  const lv = results.map((r) => levelAtTime(r, t));
  console.log(
    `    ${clock(t)}   median L${median(lv)}   runs [${lv.join(', ')}]`,
  );
}

console.log('\n  when each level landed (median across runs)');
const maxLevel = Math.max(...results.map((r) => r.level));
for (let l = 2; l <= maxLevel; l++) {
  const ts = results.map((r) => r.levelAt[l] ?? NaN);
  const got = ts.filter(Number.isFinite).length;
  const target = l === 8 ? '   ← target 2:30' : l === 12 ? '   ← target 5:00' : '';
  console.log(
    `    L${String(l).padStart(2)}  ${clock(median(ts))}   (${got}/${RUNS} runs reached it)${target}`,
  );
}

console.log('\n  the run itself');
console.log(`    died at        median ${clock(median(results.map((r) => (r.diedAt < 0 ? Infinity : r.diedAt))))}   survived-to-end: ${results.filter((r) => r.diedAt < 0).length}/${RUNS}`);
console.log(`    kills          median ${median(results.map((r) => r.kills))}`);
console.log(`    final level    median L${median(results.map((r) => r.level))}`);
console.log(`    hits taken/s   median ${(median(results.map((r) => r.hitRate)) / DT).toFixed(2)}`);
console.log(`    spawned        median ${median(results.map((r) => r.spawned))}   killed ${median(results.map((r) => r.kills))}   (${(100 * median(results.map((r) => r.kills / Math.max(1, r.spawned)))).toFixed(0)}% of the field cleared)`);
console.log(`    heavies        closest a brute/elite got: median ${median(results.map((r) => r.heavyMin)).toFixed(2)}u   mean stand-off ${median(results.map((r) => r.heavyMean)).toFixed(1)}u`);
console.log(`    XP dropped     median ${median(results.map((r) => r.dropped))}   banked ${median(results.map((r) => r.banked))}   (${(100 * median(results.map((r) => r.banked / Math.max(1, r.dropped)))).toFixed(0)}% collected)`);

console.log('\n  field over time (run 1): enemies / orbs / hp / nearest enemy');
for (const s of results[0].samples) {
  if (Math.round(s.t) % 30 !== 0 || Math.abs(s.t - Math.round(s.t)) > DT * 16) continue;
  console.log(
    `    ${clock(s.t)}  L${String(s.level).padStart(2)}  ${String(s.enemies).padStart(3)} enemies  ${String(s.orbs).padStart(4)} orbs  ${String(Math.round(s.hp)).padStart(3)} hp  nearest ${s.nearest.toFixed(1)}`,
  );
}
console.log('');
