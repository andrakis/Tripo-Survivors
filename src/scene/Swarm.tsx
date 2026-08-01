// The swarm, drawn. One <instancedMesh> PER TIER — four meshes, not one, because the tiers carry
// different geometry (docs/ARCHITECTURE.md §7) and geometry is the thing a viewer replaces.
//
// Never one React element per enemy. Matrices are written imperatively in useFrame, bypassing React
// entirely; at 400 enemies routing positions through state would re-render the tree 60 times a
// second and the game would die (ARCHITECTURE §3).
//
// Death markers ride in these same meshes rather than getting their own. A death is that enemy's own
// silhouette punching out — it has to be the tier's geometry, and a viewer's imported model must get
// the same death without touching this file — so the natural home is the tier's existing mesh with
// the marker instances appended after the live ones.

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TIERS, TUNING } from '../config';
import { game } from '../game';
import { type ActorId } from '../models/registry';
import { getActor } from '../models/loader';
import { vatRow } from '../models/vat';
import type { VatClip } from '../models/vatCore';
import { E_FLASH, E_SEED, E_TIER, E_VX, E_VZ, E_X, E_Z, ENEMY_STRIDE } from '../sim/swarm';
import { D_AGE, D_TIER, D_X, D_Z, DEATH_STRIDE } from '../sim/combat';

/** Reused for every matrix compose. One Object3D for the whole swarm, not one per enemy. */
const dummy = new THREE.Object3D();
/** Likewise for colour — two allocations total, not two per instance per frame. */
const tint = new THREE.Color();

/** Instances per tier mesh. Deaths share the mesh, so they share its capacity. */
const CAPACITY = TUNING.MAX_ENEMIES + TUNING.MAX_DEATHS;

export function Swarm() {
  const meshes = useRef<THREE.InstancedMesh[]>([]);
  const counts = useRef(new Int32Array(TIERS.length));

  // Resolved actors, not raw registry entries: `getActor` hands back the imported GLB's geometry and
  // material when one loaded, and the primitive's when it did not (src/models/loader.ts). Swapping a
  // tier from a cube to a Tripo model changes nothing in this file — that is the property the
  // registry seam exists to guarantee (MODEL-PIPELINE §2).
  const actors = useMemo(() => TIERS.map((t) => getActor(t.actor as ActorId)), []);
  const geometries = useMemo(() => actors.map((a) => a.geometry), [actors]);
  const materials = useMemo(
    () =>
      actors.map(
        (a) =>
          // The VAT material when the actor baked one — it reads position and normal out of the
          // animation textures instead of the geometry (models/vat.ts).
          a.vatMaterial ??
          a.material ??
          // WHITE, not the tier tint: three multiplies instanceColor into material.color, so a tinted
          // material could only ever darken an instance. The hit flash has to go the other way, so
          // the tint moves into the per-instance colour and the material gets out of its way.
          new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      ),
    [actors],
  );

  /**
   * Per-instance VAT row, one float per drawn instance, for the tiers that animate.
   *
   * The shader needs to know which frame this enemy is on; everything that decides that — speed,
   * flash, the death timer — is sim data the loop below is already reading. So the clip choice lives
   * here in TypeScript rather than in GLSL, which is what ROADMAP M6b means by "no animation state
   * machine": there is no state, only a function of the numbers the sim already keeps.
   */
  const rows = useMemo(
    () =>
      actors.map((a) =>
        a.vat ? new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1) : null,
      ),
    [actors],
  );

  // The attack variants each actor actually baked (`attack`, `attack2`, `attack3` — Tripo's three
  // box presets, or however many a hand-made rig has). Resolved once; the loop below picks one per
  // enemy by seed, so the same enemy always throws the same combo instead of reshuffling per frame.
  const attackClips = useMemo(
    () =>
      actors.map((a) =>
        a.vat
          ? (['attack', 'attack2', 'attack3']
              .map((n) => a.vat!.byName.get(n))
              .filter(Boolean) as VatClip[])
          : [],
      ),
    [actors],
  );

  // Start at zero, or the first frame flashes CAPACITY stacked instances at the world origin before
  // any matrix has been written. The colour write is what allocates `instanceColor` — three creates
  // it lazily on the first setColorAt, and an instanced mesh that has never had one draws white.
  useLayoutEffect(() => {
    for (let t = 0; t < meshes.current.length; t++) {
      const m = meshes.current[t];
      if (!m) continue;
      for (let i = 0; i < CAPACITY; i++) m.setColorAt(i, actors[t].flashBase);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      // The row attribute has to live on the geometry the mesh actually draws, and it is instanced,
      // so it belongs here rather than on the shared resolved geometry.
      const row = rows[t];
      if (row) m.geometry.setAttribute('aVatRow', row);
      m.count = 0;
    }
  }, [actors, rows]);

  useFrame((state) => {
    const s = game.swarm;
    const d = s.data;
    const c = counts.current;
    c.fill(0);
    const now = state.clock.elapsedTime;

    for (let i = 0; i < s.n; i++) {
      const b = i * ENEMY_STRIDE;
      const tier = d[b + E_TIER];
      const mesh = meshes.current[tier];
      if (!mesh) continue;

      const actor = actors[tier];
      const seed = d[b + E_SEED];
      const vx = d[b + E_VX];
      const vz = d[b + E_VZ];

      // Per-enemy variation, all three channels keyed off the SAME seed the SoA has carried since
      // M2 (ART-STYLE "Motion and feedback"). Four hundred copies of one model in perfect lockstep
      // read as a rendering artifact, not as a crowd — and that costs nothing to fix because the
      // float is already there. Everything below is a pure function of (seed, time, speed), so no
      // new state exists, nothing drifts, and an enemy keeps the same body for its whole life.
      //
      // The BOB is skipped for an animated actor: its VAT clip is already moving the body, and the
      // seed is already offsetting that clip's phase (further down), so adding a sine on top would
      // be two idle animations fighting each other on the same model.
      const speed = Math.hypot(vx, vz);
      let y = actor.yOffset;
      if (!actor.vat) {
        // Scaled by how fast this enemy is actually moving, so a front rank jammed against the
        // player settles rather than jogging on the spot — the crowd that is killing you should
        // read as pressing in, not as marching in place.
        const gait = Math.min(1, speed / TIERS[tier].speed);
        y += actor.height * TUNING.BOB_AMP * gait *
          Math.sin(now * TUNING.BOB_HZ * Math.PI * 2 + seed * Math.PI * 2);
      }
      dummy.position.set(d[b + E_X], y, d[b + E_Z]);
      // Face the direction of travel, unconditionally. `dummy` is shared across the whole loop, so
      // a conditional write would leave an enemy wearing the PREVIOUS enemy's rotation — a
      // guard against heading jitter at near-zero speed has to store facing per enemy, and that
      // belongs in the SoA. An enemy is only ever near-zero when jammed inside a crowd that hides
      // it anyway.
      dummy.rotation.y =
        Math.atan2(vx, vz) + actor.yaw + (seed - 0.5) * 2 * TUNING.YAW_JITTER;
      // Scale jitter stays well inside the gap between tiers on purpose: DESIGN §12 rule 2 says the
      // tier reads from silhouette, and a grunt that can grow into a brute would break the one
      // channel that survives a viewer importing models we have never seen.
      dummy.scale.setScalar(actor.scale * (1 + (seed - 0.5) * 2 * TUNING.SCALE_JITTER));
      dummy.updateMatrix();

      const slot = c[tier]++;
      mesh.setMatrixAt(slot, dummy.matrix);
      // Hit flash: `flashBase` lerped toward `flashHot` by the decaying timer combat wrote. Which
      // pair those are depends on whether a texture loaded — see ResolvedActor in models/loader.ts.
      // Written every frame including at flash 0, because the slot an enemy occupies changes as the
      // population shifts — leaving a stale colour behind means a random enemy inherits somebody
      // else's flash and appears to be taking damage it isn't.
      const f = d[b + E_FLASH] / TUNING.FLASH_TIME;
      tint.copy(actor.flashBase).lerp(actor.flashHot, f > 0 ? Math.min(1, f) * TUNING.FLASH_MIX : 0);
      mesh.setColorAt(slot, tint);

      // Clip selection, straight off the sim's own numbers. No per-enemy animation state exists,
      // and none is needed:
      //   - within VAT_ATTACK_R of the player → an attack, chosen by seed so each enemy keeps its
      //     own combo. Distance beats speed, because an enemy pressed against the player is
      //     near-stationary — on speed alone it would play `idle` while killing you.
      //   - otherwise speed: a brute at 2.2 u/s walks and a grunt at 3.4 runs, untold.
      const row = rows[tier];
      if (row) {
        const vat = actor.vat!;
        const px = d[b + E_X] - game.player.x;
        const pz = d[b + E_Z] - game.player.z;
        const attacks = attackClips[tier];
        let clip: VatClip | undefined;
        if (attacks.length && px * px + pz * pz < TUNING.VAT_ATTACK_R * TUNING.VAT_ATTACK_R) {
          clip = attacks[(seed * attacks.length) | 0];
        } else {
          clip = vat.byName.get(
            speed < TUNING.VAT_IDLE_SPEED ? 'idle' : speed < TUNING.VAT_WALK_SPEED ? 'walk' : 'run',
          );
        }
        clip ??= vat.clips[0];
        // Phase offset from the per-enemy seed the SoA has carried since M2. Without it a crowd of
        // 400 shares one cycle and marches in perfect lockstep, which reads as a single organism.
        row.array[slot] = vatRow(clip, now * (TUNING.VAT_FPS / clip.count) + seed);
      }
    }

    // Death markers, appended after the live enemies of their tier.
    const cm = game.combat;
    for (let i = 0; i < cm.nd; i++) {
      const b = i * DEATH_STRIDE;
      const tier = cm.deaths[b + D_TIER];
      const mesh = meshes.current[tier];
      if (!mesh) continue;

      const actor = actors[tier];
      const t = Math.min(1, cm.deaths[b + D_AGE] / TUNING.DEATH_TIME);
      const row = rows[tier];
      const slot = c[tier]++;
      const dx = cm.deaths[b + D_X];
      const dz = cm.deaths[b + D_Z];
      // The marker has to keep the body's size and facing, and a death marker does not carry the
      // enemy's seed — the stride is a documented contract (ARCHITECTURE §5.1) and a fourth field
      // for a cosmetic is not worth widening it for. Hashing the fall POSITION gives a value that is
      // stable for the marker's whole life and uncorrelated with its neighbours, which is all the
      // jitter needs; without it every enemy visibly snaps back to the base scale as it dies.
      const seed = ((dx * 12.9898 + dz * 78.233) * 43758.5453) % 1;
      const jitter = 1 + (Math.abs(seed) - 0.5) * 2 * TUNING.SCALE_JITTER;
      const yaw = actor.yaw + (Math.abs(seed) - 0.5) * 2 * TUNING.YAW_JITTER;

      if (row) {
        // An animated actor DIES: the `die` clip plays once over the marker's life and holds its
        // last pose. No punch and no collapse — the model falls over on its own, and shrinking a
        // body that is already lying down would just make it vanish oddly.
        const vat = actor.vat!;
        const clip = vat.byName.get('die') ?? vat.clips[0];
        row.array[slot] = vatRow(clip, t);
        dummy.position.set(dx, actor.yOffset, dz);
        dummy.rotation.y = yaw;
        dummy.scale.setScalar(actor.scale * jitter);
      } else {
        // Punch out, then collapse. The sine swells the silhouette in the first half so the death
        // registers at the edge of vision, and (1 - t²) takes it away fast enough that a late-game
        // field of dying bodies never reads as a field of live ones. This is what a cube can do.
        const punch = (1 + 0.55 * Math.sin(Math.PI * t)) * (1 - t * t) * jitter;
        const flatten = 1 - t;
        dummy.position.set(dx, actor.yOffset * punch * flatten, dz);
        dummy.rotation.y = yaw;
        dummy.scale.set(actor.scale * punch, actor.scale * punch * flatten, actor.scale * punch);
      }
      dummy.updateMatrix();

      mesh.setMatrixAt(slot, dummy.matrix);
      // Brightest at the instant of death, fading back to the tier colour as it collapses. Held to
      // the same ceiling as the hit flash: a late-game field can have dozens of these at once, and
      // white ones would out-read the player exactly when the screen is busiest.
      tint.copy(actor.flashBase).lerp(actor.flashHot, TUNING.FLASH_MIX * (1 - t));
      mesh.setColorAt(slot, tint);
    }

    for (let t = 0; t < meshes.current.length; t++) {
      const mesh = meshes.current[t];
      if (!mesh) continue;
      mesh.count = c[t];
      mesh.instanceMatrix.needsUpdate = true;
      const row = rows[t];
      if (row) row.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      {TIERS.map((tier, t) => (
        <instancedMesh
          key={tier.actor}
          ref={(m) => {
            if (m) meshes.current[t] = m;
          }}
          args={[geometries[t], materials[t], CAPACITY]}
          // The instances move every frame, so the mesh's own bounding volume is meaningless and
          // frustum culling against it would pop the whole tier in and out.
          frustumCulled={false}
        />
      ))}
    </>
  );
}
