// Swarm tests: the grid, the flow field, separation equilibrium, and swap-remove.
//
// These are the four properties from docs/ARCHITECTURE.md §10, and each one guards a specific
// failure that Breach actually shipped at some point. None of these modules import three, so this
// all runs in plain node — no WebGL, no canvas, no mocks (§2.1).

import { describe, expect, it } from 'vitest';
import { CFG, TIERS, TUNING } from '../config';
import { buildGrid, makeGrid, queryNeighbors } from './grid';
import { createFlow, distanceAt, maybeSolveFlow, sampleFlow, solveFlow } from './flow';
import {
  ENEMY_STRIDE,
  E_TIER,
  E_X,
  E_Z,
  buildSwarmGrid,
  createSwarm,
  killEnemy,
  spawnEnemy,
  stepSwarm,
} from './swarm';
import { OBSTACLES, cellX, cellZ, overlapsObstacle } from './world';
import { SPAWN_R, createWaves, spawnRate, stepWaves, tierWeight } from './waves';

const DT = 1 / 60;

/** Deterministic LCG — a seeded generator so a failure is reproducible, unlike Math.random. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

describe('spatial grid', () => {
  it('returns exactly what a brute-force O(n^2) scan returns', () => {
    const rand = rng(12345);
    const count = 500;
    const stride = 4;
    const pos = new Float32Array(count * stride);
    for (let i = 0; i < count; i++) {
      pos[i * stride] = (rand() - 0.5) * CFG.WORLD_X;
      pos[i * stride + 1] = (rand() - 0.5) * CFG.WORLD_Z;
    }

    const cell = TUNING.SEP_R;
    const g = makeGrid();
    buildGrid(g, pos, stride, count, cell);

    const out = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const x = pos[i * stride];
      const z = pos[i * stride + 1];

      const brute: number[] = [];
      for (let j = 0; j < count; j++) {
        const dx = pos[j * stride] - x;
        const dz = pos[j * stride + 1] - z;
        if (dx * dx + dz * dz <= cell * cell) brute.push(j);
      }

      const n = queryNeighbors(g, pos, stride, count, x, z, cell, out);
      expect(Array.from(out.subarray(0, n)).sort((a, b) => a - b)).toEqual(
        brute.sort((a, b) => a - b),
      );
    }
  });

  it('bins every agent exactly once, including one sitting on the world edge', () => {
    const stride = 2;
    const pos = new Float32Array([0, 0, CFG.WORLD_X / 2, CFG.WORLD_Z / 2, -CFG.WORLD_X / 2, -CFG.WORLD_Z / 2]);
    const g = makeGrid();
    buildGrid(g, pos, stride, 3, TUNING.SEP_R);
    expect(g.cellStart[g.ncells]).toBe(3);
    expect(Array.from(g.agentIndex.subarray(0, 3)).sort()).toEqual([0, 1, 2]);
  });
});

describe('flow field', () => {
  const f = createFlow();

  it('leaves every cell reachable — obstacles are expensive, not impassable', () => {
    solveFlow(f, 0, 0);
    let unreached = 0;
    for (let i = 0; i < f.dist.length; i++) if (f.dist[i] >= 1e9) unreached++;
    expect(unreached).toBe(0);
  });

  it('has no zero-gradient cell outside the seed', () => {
    solveFlow(f, 0, 0);
    const seed = cellZ(0) * CFG.GRID_W + cellX(0);
    let degenerate = 0;
    for (let i = 0; i < f.dist.length; i++) {
      if (i === seed) continue;
      if (f.flow[i * 2] === 0 && f.flow[i * 2 + 1] === 0) degenerate++;
    }
    expect(degenerate).toBe(0);
  });

  it('costs more to reach a point behind a wall than an equally distant point in the open', () => {
    const wall = OBSTACLES[3]; // East Wall, hx 2.0 hz 20.0 — a real barrier, not a step aside
    solveFlow(f, wall.x - 12, wall.z); // seed on the west side, level with the wall's middle

    const behind = distanceAt(f, wall.x + 12, wall.z); // straight through the wall
    const open = distanceAt(f, wall.x - 36, wall.z); // same 24 units away, clear ground
    expect(behind).toBeGreaterThan(open);
  });

  it('routes a traced path AROUND a wall rather than through it', () => {
    const wall = OBSTACLES[3];
    solveFlow(f, wall.x - 12, wall.z);

    // Walk downhill from behind the wall and see where the gradient takes us.
    //
    // "Arrived" has to be a cell-sized tolerance, not a point. The direction is constant across a
    // 2-unit cell, so a tracer circles the seed cell rather than converging on the seed POINT — it
    // can never get closer than a cell diagonal (2.83). In the game that last stretch is covered by
    // separation and the enemy's own body radius, not by the field.
    const ARRIVED = 3.5;
    const dir = { x: 0, z: 0 };
    let x = wall.x + 8;
    let z = wall.z;
    let travelled = 0;
    let insideWall = 0;
    for (let step = 0; step < 4000; step++) {
      sampleFlow(f, x, z, dir);
      x += dir.x * 0.25;
      z += dir.z * 0.25;
      travelled += 0.25;
      if (Math.abs(x - wall.x) < wall.hx && Math.abs(z - wall.z) < wall.hz) insideWall++;
      if (Math.hypot(x - (wall.x - 12), z - wall.z) < ARRIVED) break;
    }

    expect(Math.hypot(x - (wall.x - 12), z - wall.z)).toBeLessThan(ARRIVED); // it arrived
    expect(insideWall).toBe(0); // and never crossed the wall's footprint
    // Strictly longer than the 20-unit straight line: it went round the end of a 40-unit wall.
    expect(travelled).toBeGreaterThan(40);
  });

  it('re-solves on the cadence and immediately on a player cell change', () => {
    const g = createFlow();
    solveFlow(g, 0, 0);

    // Well inside the same 2-unit cell, and well inside the 100 ms cadence: no re-solve.
    expect(maybeSolveFlow(g, 0.5, 0, DT)).toBe(false);
    // Four cells over, same tick budget: re-solve immediately.
    expect(maybeSolveFlow(g, 8, 0, DT)).toBe(true);
    // Standing still, but past 1 / FLOW_HZ: re-solve on cadence.
    expect(maybeSolveFlow(g, 8, 0, 1 / TUNING.FLOW_HZ)).toBe(true);
  });
});

describe('separation', () => {
  it('spreads a pile stacked on one point and then HOLDS the spacing', () => {
    const s = createSwarm();
    const grid = makeGrid();
    const f = createFlow();
    // Seed far from any prop, and solve toward the pile itself so flow is not pulling them apart —
    // this must be separation doing the work, nothing else.
    solveFlow(f, -100, 90);

    const rand = rng(7);
    for (let i = 0; i < 60; i++) {
      // A hair of jitter, or every pair is exactly coincident and every separation vector is 0/0.
      spawnEnemy(s, -100 + (rand() - 0.5) * 0.05, 90 + (rand() - 0.5) * 0.05, 0);
    }

    const minSpacing = () => {
      let min = Infinity;
      for (let i = 0; i < s.n; i++) {
        for (let j = i + 1; j < s.n; j++) {
          const dx = s.data[i * ENEMY_STRIDE + E_X] - s.data[j * ENEMY_STRIDE + E_X];
          const dz = s.data[i * ENEMY_STRIDE + E_Z] - s.data[j * ENEMY_STRIDE + E_Z];
          min = Math.min(min, Math.hypot(dx, dz));
        }
      }
      return min;
    };

    for (let t = 0; t < 4; t += DT) {
      buildSwarmGrid(s, grid);
      stepSwarm(s, grid, f, DT);
    }
    const settled = minSpacing();
    // They will not all reach a full SEP_R — the flow keeps pulling them together — but the crowd
    // must have real extent. The failure this catches is total collapse to one point.
    expect(settled).toBeGreaterThan(TUNING.SEP_R * 0.5);

    // ...and stay there. The other failure mode is an overshooting push that flickers.
    for (let t = 0; t < 4; t += DT) {
      buildSwarmGrid(s, grid);
      stepSwarm(s, grid, f, DT);
    }
    expect(Math.abs(minSpacing() - settled)).toBeLessThan(TUNING.SEP_R * 0.35);
  });

  it('never moves an enemy further than the push cap in one tick', () => {
    const s = createSwarm();
    const grid = makeGrid();
    const f = createFlow();
    solveFlow(f, -100, 90);

    const rand = rng(99);
    for (let i = 0; i < 120; i++) {
      spawnEnemy(s, -100 + (rand() - 0.5) * 0.4, 90 + (rand() - 0.5) * 0.4, 0);
    }

    // The dense-jam case: the cap is what stops a front-rank enemy being flung through a prop.
    const before = Float32Array.from(s.data.subarray(0, s.n * ENEMY_STRIDE));
    buildSwarmGrid(s, grid);
    stepSwarm(s, grid, f, DT);

    const maxSpeed = Math.max(...TIERS.map((t) => t.speed));
    const limit = TUNING.SEP_PUSH_MAX + maxSpeed * DT + 1e-4;
    for (let i = 0; i < s.n; i++) {
      const dx = s.data[i * ENEMY_STRIDE + E_X] - before[i * ENEMY_STRIDE + E_X];
      const dz = s.data[i * ENEMY_STRIDE + E_Z] - before[i * ENEMY_STRIDE + E_Z];
      expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(limit);
    }
  });

  it('keeps every enemy out of props and inside the arena', () => {
    const s = createSwarm();
    const grid = makeGrid();
    const f = createFlow();
    const keep = OBSTACLES[0];
    solveFlow(f, keep.x, keep.z); // pull the crowd straight at a prop

    const rand = rng(4242);
    for (let i = 0; i < 200; i++) {
      const a = rand() * Math.PI * 2;
      spawnEnemy(s, keep.x + Math.cos(a) * 18, keep.z + Math.sin(a) * 18, (i % 3) as number);
    }

    for (let t = 0; t < 12; t += DT) {
      buildSwarmGrid(s, grid);
      stepSwarm(s, grid, f, DT);
      for (let i = 0; i < s.n; i++) {
        const x = s.data[i * ENEMY_STRIDE + E_X];
        const z = s.data[i * ENEMY_STRIDE + E_Z];
        expect(overlapsObstacle(x, z, TUNING.UNIT_R - 1e-6)).toBe(false);
        expect(Math.abs(x)).toBeLessThanOrEqual(CFG.WORLD_X / 2);
        expect(Math.abs(z)).toBeLessThanOrEqual(CFG.WORLD_Z / 2);
      }
    }
  });
});

describe('swap-remove', () => {
  it('keeps live entities packed in [0, n) with none lost or duplicated', () => {
    const s = createSwarm();
    const rand = rng(31337);

    // Tag each enemy with a unique value in an otherwise-unused slot so identity survives the moves.
    const tag = (i: number) => s.data[i * ENEMY_STRIDE + E_X];
    const live = new Set<number>();
    let next = 1;

    for (let round = 0; round < 400; round++) {
      if (s.n === 0 || rand() < 0.6) {
        const id = next++;
        if (spawnEnemy(s, id, 0, 0) >= 0) live.add(id);
      } else {
        const i = Math.floor(rand() * s.n);
        live.delete(tag(i));
        killEnemy(s, i);
      }

      const seen = new Set<number>();
      for (let i = 0; i < s.n; i++) {
        expect(seen.has(tag(i))).toBe(false); // no duplicates
        seen.add(tag(i));
      }
      expect(seen.size).toBe(s.n);
      expect(seen).toEqual(live); // nothing lost, nothing resurrected
    }
  });

  it('stops spawning at MAX_ENEMIES instead of growing the buffer', () => {
    const s = createSwarm();
    for (let i = 0; i < TUNING.MAX_ENEMIES + 50; i++) spawnEnemy(s, 0, 0, 0);
    expect(s.n).toBe(TUNING.MAX_ENEMIES);
    expect(spawnEnemy(s, 0, 0, 0)).toBe(-1);
    expect(s.data.length).toBe(TUNING.MAX_ENEMIES * ENEMY_STRIDE);
  });
});

describe('spawn director', () => {
  it('follows the documented rate curve', () => {
    expect(spawnRate(0)).toBeCloseTo(1.5, 3);
    expect(spawnRate(60)).toBeCloseTo(4.2, 1);
    expect(spawnRate(180)).toBeCloseTo(9.7, 1);
  });

  it('gates each tier behind its entry time and ramps it in', () => {
    for (let t = 0; t < TIERS.length; t++) {
      expect(tierWeight(t, TIERS[t].entersAt - 1)).toBe(0);
    }
    expect(tierWeight(1, 60)).toBe(0); // runner: zero AT its entry, ramping from there
    expect(tierWeight(1, 60 + TUNING.TIER_RAMP)).toBeCloseTo(TIERS[1].weight, 5);
    expect(tierWeight(3, 9999)).toBe(0); // elites never come out of the general budget
  });

  it('spawns offscreen, inside the arena, and never inside a prop', () => {
    const s = createSwarm();
    const w = createWaves();
    // Backed into a corner beside the East Wall — the case where much of the ring is unusable.
    const px = 58;
    const pz = -8;
    for (let t = 0; t < 20; t += DT) stepWaves(w, s, t, DT, px, pz);

    expect(s.n).toBeGreaterThan(20);
    for (let i = 0; i < s.n; i++) {
      const x = s.data[i * ENEMY_STRIDE + E_X];
      const z = s.data[i * ENEMY_STRIDE + E_Z];
      expect(overlapsObstacle(x, z, TUNING.UNIT_R)).toBe(false);
      expect(Math.abs(x)).toBeLessThan(CFG.WORLD_X / 2);
      expect(Math.abs(z)).toBeLessThan(CFG.WORLD_Z / 2);
      // Offscreen: the ring clears the visible half-diagonal (DESIGN §7.2).
      expect(Math.hypot(x - px, z - pz)).toBeGreaterThan(Math.hypot(CFG.VIEW_W / 2, CFG.VIEW_H / 2) - 0.01);
      expect(Math.hypot(x - px, z - pz)).toBeCloseTo(SPAWN_R, 3);
    }
  });

  it('brings in later tiers as the run goes on', () => {
    const s = createSwarm();
    const w = createWaves();
    for (let t = 0; t < 200; t += DT) {
      stepWaves(w, s, t, DT, 0, 0);
      // Keep the field clear so the cap never throttles the director.
      while (s.n > 50) killEnemy(s, 0);
    }
    const tiers = new Set<number>();
    for (let i = 0; i < s.n; i++) tiers.add(s.data[i * ENEMY_STRIDE + E_TIER]);
    expect(tiers.size).toBeGreaterThan(1);
  });

  it('holds at the cap rather than banking a budget that dumps on the next kill', () => {
    const s = createSwarm();
    const w = createWaves();
    for (let t = 0; t < 400; t += DT) stepWaves(w, s, t, DT, 0, 0);
    expect(s.n).toBe(TUNING.MAX_ENEMIES);
    expect(w.budget).toBe(0);
  });
});
