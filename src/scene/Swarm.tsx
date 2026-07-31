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
import { ACTORS, type ActorId } from '../models/registry';
import { E_FLASH, E_TIER, E_VX, E_VZ, E_X, E_Z, ENEMY_STRIDE } from '../sim/swarm';
import { D_AGE, D_TIER, D_X, D_Z, DEATH_STRIDE } from '../sim/combat';

/** Reused for every matrix compose. One Object3D for the whole swarm, not one per enemy. */
const dummy = new THREE.Object3D();
/** Likewise for colour — two allocations total, not two per instance per frame. */
const tint = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/** Instances per tier mesh. Deaths share the mesh, so they share its capacity. */
const CAPACITY = TUNING.MAX_ENEMIES + TUNING.MAX_DEATHS;

export function Swarm() {
  const meshes = useRef<THREE.InstancedMesh[]>([]);
  const counts = useRef(new Int32Array(TIERS.length));

  const actors = useMemo(() => TIERS.map((t) => ACTORS[t.actor as ActorId]), []);
  const geometries = useMemo(() => actors.map((a) => a.primitive()), [actors]);
  const materials = useMemo(
    () =>
      actors.map(
        () =>
          // WHITE, not the tier tint: three multiplies instanceColor into material.color, so a tinted
          // material could only ever darken an instance. The hit flash has to go the other way, so
          // the tint moves into the per-instance colour and the material gets out of its way.
          new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
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
      tint.set(actors[t].tint);
      for (let i = 0; i < CAPACITY; i++) m.setColorAt(i, tint);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.count = 0;
    }
  }, [actors]);

  useFrame(() => {
    const s = game.swarm;
    const d = s.data;
    const c = counts.current;
    c.fill(0);

    for (let i = 0; i < s.n; i++) {
      const b = i * ENEMY_STRIDE;
      const tier = d[b + E_TIER];
      const mesh = meshes.current[tier];
      if (!mesh) continue;

      const actor = actors[tier];
      dummy.position.set(d[b + E_X], actor.yOffset, d[b + E_Z]);
      // Face the direction of travel, unconditionally. `dummy` is shared across the whole loop, so
      // a conditional write would leave an enemy wearing the PREVIOUS enemy's rotation — a
      // guard against heading jitter at near-zero speed has to store facing per enemy, and that
      // belongs in the SoA. An enemy is only ever near-zero when jammed inside a crowd that hides
      // it anyway; M5's per-enemy variation pass is where this gets revisited.
      const vx = d[b + E_VX];
      const vz = d[b + E_VZ];
      dummy.rotation.y = Math.atan2(vx, vz);
      dummy.scale.setScalar(actor.scale);
      dummy.updateMatrix();

      const slot = c[tier]++;
      mesh.setMatrixAt(slot, dummy.matrix);
      // Hit flash: the tier tint lerped toward white by the decaying timer combat wrote. Written
      // every frame including at flash 0, because the slot an enemy occupies changes as the
      // population shifts — leaving a stale colour behind means a random enemy inherits somebody
      // else's flash and appears to be taking damage it isn't.
      const f = d[b + E_FLASH] / TUNING.FLASH_TIME;
      tint.set(actor.tint).lerp(WHITE, f > 0 ? Math.min(1, f) * TUNING.FLASH_MIX : 0);
      mesh.setColorAt(slot, tint);
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
      // Punch out, then collapse. The sine swells the silhouette in the first half so the death
      // registers at the edge of vision, and (1 - t²) takes it away fast enough that a late-game
      // field of dying bodies never reads as a field of live ones.
      const punch = (1 + 0.55 * Math.sin(Math.PI * t)) * (1 - t * t);
      const flatten = 1 - t;
      dummy.position.set(cm.deaths[b + D_X], actor.yOffset * punch * flatten, cm.deaths[b + D_Z]);
      dummy.rotation.y = 0;
      dummy.scale.set(actor.scale * punch, actor.scale * punch * flatten, actor.scale * punch);
      dummy.updateMatrix();

      const slot = c[tier]++;
      mesh.setMatrixAt(slot, dummy.matrix);
      // Brightest at the instant of death, fading back to the tier colour as it collapses. Held to
      // the same ceiling as the hit flash: a late-game field can have dozens of these at once, and
      // white ones would out-read the player exactly when the screen is busiest.
      tint.set(actor.tint).lerp(WHITE, TUNING.FLASH_MIX * (1 - t));
      mesh.setColorAt(slot, tint);
    }

    for (let t = 0; t < meshes.current.length; t++) {
      const mesh = meshes.current[t];
      if (!mesh) continue;
      mesh.count = c[t];
      mesh.instanceMatrix.needsUpdate = true;
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
