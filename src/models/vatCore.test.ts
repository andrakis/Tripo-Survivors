// VAT bake tests.
//
// The bake is the one genuinely tricky piece of the model pipeline — a CPU reimplementation of GPU
// skinning that has to agree with the shader it feeds — and it is testable *only* because vatCore.ts
// deals in numbers rather than in a canvas. That is the same property the `sim/` purity rule buys
// everywhere else (ARCHITECTURE §2.1), applied one folder over.
//
// Everything below is built from a hand-made two-bone skeleton, so the expected answers are known by
// construction rather than by re-running the code and pasting what it printed.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { bakeSkinnedMesh, isLoopClip, matchClips, projectVatBytes, type ClipSpec } from './vatCore';

/**
 * A skinned strip: 4 vertices in a vertical line, rigged to two bones. The lower pair is fully
 * weighted to bone 0 (which never moves) and the upper pair to bone 1, so a clip that rotates bone 1
 * moves exactly half the mesh — an arrangement where "did the skinning work" has an arithmetic
 * answer rather than a visual one.
 */
function rig() {
  const positions = new Float32Array([
    -0.5, 0, 0,
    0.5, 0, 0,
    -0.5, 2, 0,
    0.5, 2, 0,
  ]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const skinIndex = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const skinWeight = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));

  // Named, because the tracks below address them by name. The `.bones[i]` form three also supports
  // only resolves when the mixer root IS the SkinnedMesh, and the real bake passes `gltf.scene`.
  const root = new THREE.Bone();
  root.name = 'boneRoot';
  const tip = new THREE.Bone();
  tip.name = 'boneTip';
  tip.position.y = 2;
  root.add(tip);

  const skeleton = new THREE.Skeleton([root, tip]);
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(skeleton);
  mesh.updateMatrixWorld(true);

  const scene = new THREE.Group();
  scene.add(mesh);
  return { mesh, scene, tip };
}

/** A clip that holds bone 1 still for `duration` seconds. */
function stillClip(name: string, duration: number) {
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack('boneTip.quaternion', [0, duration], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

/**
 * A clip that swings bone 1 through 90° about Z over `duration`.
 *
 * The two upper vertices sit exactly ON the tip bone's origin (0, 2, 0), offset only in X — so this
 * rotation PIVOTS them about that point rather than swinging them down. (-0.5, 2) lands on (0, 1.5)
 * and (0.5, 2) on (0, 2.5), which is what the position tests below check for.
 */
function swingClip(name: string, duration: number) {
  const half = Math.SQRT1_2;
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack(
      'boneTip.quaternion',
      [0, duration],
      [0, 0, 0, 1, 0, 0, half, half],
    ),
  ]);
}

/** The same 90°, about X — which is the axis that actually reorients a +Z normal. */
function swingXClip(name: string, duration: number) {
  const half = Math.SQRT1_2;
  return new THREE.AnimationClip(name, duration, [
    new THREE.QuaternionKeyframeTrack(
      'boneTip.quaternion',
      [0, duration],
      [0, 0, 0, 1, half, 0, 0, half],
    ),
  ]);
}

const posOf = (b: ReturnType<typeof bakeSkinnedMesh>, frame: number, v: number) => {
  const o = (frame * b.vertexCount + v) * 4;
  return new THREE.Vector3(b.pos[o], b.pos[o + 1], b.pos[o + 2]);
};

describe('the bake', () => {
  it('lays clips out end to end, and reports where each one starts', () => {
    const { mesh, scene } = rig();
    const out = bakeSkinnedMesh(
      mesh,
      [
        { clip: stillClip('a', 1), as: 'idle', loop: true },
        { clip: stillClip('b', 0.5), as: 'die', loop: false },
      ],
      { fps: 10, root: scene },
    );

    // A loop spans [0, dur) — 10 frames at 10 fps. A one-shot spans [0, dur] inclusive, so 5 + 1.
    expect(out.clips[0]).toMatchObject({ name: 'idle', start: 0, count: 10, loop: true });
    expect(out.clips[1]).toMatchObject({ name: 'die', start: 10, count: 6, loop: false });
    expect(out.totalFrames).toBe(16);
    expect(out.pos.length).toBe(16 * 4 * 4);
  });

  it('gives a loop no duplicate end frame, so the cycle has no hitch', () => {
    // The one thing that makes a baked loop look wrong: if frame N-1 is the same pose as frame 0,
    // the cycle stalls for one frame every revolution. A loop is baked over [0, dur) precisely so
    // that wrapping back to 0 continues the motion.
    const { mesh, scene } = rig();
    const out = bakeSkinnedMesh(mesh, [{ clip: swingClip('run', 1), as: 'run', loop: true }], {
      fps: 8,
      root: scene,
    });

    const first = posOf(out, 0, 2);
    const last = posOf(out, out.clips[0].count - 1, 2);
    expect(first.distanceTo(last)).toBeGreaterThan(0.1);
  });

  it('holds a one-shot on its final pose', () => {
    const { mesh, scene } = rig();
    const out = bakeSkinnedMesh(mesh, [{ clip: swingClip('die', 1), as: 'die', loop: false }], {
      fps: 8,
      root: scene,
    });

    // Exact, not approximate: a 90° pivot about (0, 2, 0) takes (-0.5, 2) to (0, 1.5).
    const end = posOf(out, out.clips[0].count - 1, 2);
    expect(end.x).toBeCloseTo(0, 5);
    expect(end.y).toBeCloseTo(1.5, 5);
    expect(posOf(out, out.clips[0].count - 1, 3).y).toBeCloseTo(2.5, 5);

    // ...and it HOLDS there. Sampling a one-shot at t == duration must clamp to the final pose
    // rather than wrapping to frame 0, which is the difference between a corpse and a body that
    // snaps upright the instant it finishes dying.
    const beforeEnd = posOf(out, out.clips[0].count - 2, 2);
    expect(beforeEnd.distanceTo(end)).toBeLessThan(0.2);
  });

  it('skins: the bone that never moves leaves its vertices exactly where they were', () => {
    // This is the arithmetic check that the bindInverse × skin × bind chain is the right way round.
    // Get it wrong and everything still animates — just in the wrong space, which reads as a model
    // that explodes or turns inside out rather than as an obviously broken matrix.
    const { mesh, scene } = rig();
    const out = bakeSkinnedMesh(mesh, [{ clip: swingClip('run', 1), as: 'run', loop: false }], {
      fps: 4,
      root: scene,
    });

    for (let f = 0; f < out.totalFrames; f++) {
      expect(posOf(out, f, 0).x).toBeCloseTo(-0.5, 5);
      expect(posOf(out, f, 0).y).toBeCloseTo(0, 5);
      expect(posOf(out, f, 1).x).toBeCloseTo(0.5, 5);
    }
    // ...and the bone that DOES move actually moved something: a 90° pivot about (0, 2, 0) carries
    // (-0.5, 2) through an arc of exactly hypot(0.5, 0.5).
    expect(posOf(out, 0, 2).distanceTo(posOf(out, out.totalFrames - 1, 2))).toBeCloseTo(
      Math.hypot(0.5, 0.5),
      5,
    );
  });

  it('rotates normals with the pose, and keeps them unit length', () => {
    // Position-only VATs are a classic shortcut and they light wrongly: an arm that swings 90° keeps
    // facing the camera. The normal has to travel through the same matrix.
    // About X, because the source normals are +Z and a rotation about Z would leave them alone —
    // a position-only bake would pass such a test and still light the model wrongly.
    const { mesh, scene } = rig();
    const out = bakeSkinnedMesh(mesh, [{ clip: swingXClip('run', 1), as: 'run', loop: false }], {
      fps: 4,
      root: scene,
    });

    const nrmOf = (f: number, v: number) => {
      const o = (f * out.vertexCount + v) * 4;
      return new THREE.Vector3(out.nrm[o], out.nrm[o + 1], out.nrm[o + 2]);
    };

    for (let f = 0; f < out.totalFrames; f++) {
      for (let v = 0; v < out.vertexCount; v++) expect(nrmOf(f, v).length()).toBeCloseTo(1, 5);
    }
    // The still bone's vertices keep their +Z normal...
    expect(nrmOf(out.totalFrames - 1, 0).z).toBeCloseTo(1, 5);
    // ...and the rotated ones end up pointing along -Y, exactly 90° round.
    const moved = nrmOf(out.totalFrames - 1, 2);
    expect(moved.y).toBeCloseTo(-1, 5);
    expect(moved.z).toBeCloseTo(0, 5);
  });

  it('cuts a WINDOW out of a one-shot: `from` skips the head, `trim` caps the length', () => {
    // The semantics the real defeat clip forced: 3 s of staggering before a half-second fall means
    // the useful part of a clip is not a prefix. `from`+`trim` bake the middle.
    const { mesh, scene } = rig();
    const full = bakeSkinnedMesh(mesh, [{ clip: swingClip('die', 4), as: 'die', loop: false }], {
      fps: 10,
      root: scene,
    });
    const windowed = bakeSkinnedMesh(
      mesh,
      [{ clip: swingClip('die', 4), as: 'die', loop: false, from: 1, trim: 1 }],
      { fps: 10, root: scene },
    );

    expect(full.clips[0].count).toBe(41);
    expect(windowed.clips[0].count).toBe(11);
    // The window's frame 0 is the FULL bake's t=1 s pose (frame 10 of 40 at 10 fps), not the start.
    expect(posOf(windowed, 0, 2).distanceTo(posOf(full, 10, 2))).toBeCloseTo(0, 6);
    // ...and its last frame is the full bake's t=2 s pose: half way through the swing, held there.
    expect(posOf(windowed, 10, 2).distanceTo(posOf(full, 20, 2))).toBeCloseTo(0, 6);
  });

  it('pins runaway root motion back to the bind pose, leaving rotations alone', () => {
    // Tripo's locomotion presets translate the Hip bone metres across the floor. The lock catches a
    // bone whose translation strays far from bind and pins it, so the crowd animates ON THE SPOT —
    // and unweighted `neutral_bone` vertices stop tearing away from the body (the spikes bug).
    const { mesh, scene } = rig();
    const duration = 1;
    // Walk the TIP bone 5 units sideways while also rotating — the lock must kill the walk and
    // keep the rotation.
    const half = Math.SQRT1_2;
    const clip = new THREE.AnimationClip('run', duration, [
      new THREE.VectorKeyframeTrack('boneTip.position', [0, duration], [0, 2, 0, 5, 2, 0]),
      new THREE.QuaternionKeyframeTrack('boneTip.quaternion', [0, duration], [0, 0, 0, 1, 0, 0, half, half]),
    ]);
    const out = bakeSkinnedMesh(mesh, [{ clip, as: 'run', loop: true }], { fps: 8, root: scene });

    for (let f = 0; f < out.totalFrames; f++) {
      // No vertex ever leaves the neighbourhood of the model — the 5-unit walk is gone...
      for (let v = 0; v < out.vertexCount; v++) {
        expect(Math.abs(posOf(out, f, v).x), `frame ${f} vertex ${v}`).toBeLessThan(1.2);
      }
    }
    // ...but the rotation survived: the moved vertices still travel through their arc.
    expect(posOf(out, 0, 2).distanceTo(posOf(out, out.totalFrames - 1, 2))).toBeGreaterThan(0.3);
  });

  it('reports progress once per frame, ending exactly on the total', () => {
    const { mesh, scene } = rig();
    const seen: number[] = [];
    const out = bakeSkinnedMesh(mesh, [{ clip: stillClip('idle', 1), as: 'idle', loop: true }], {
      fps: 6,
      root: scene,
      onFrame: (done, total) => {
        expect(total).toBe(6);
        seen.push(done);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.totalFrames).toBe(6);
  });

  it('refuses a mesh that is not skinned rather than baking nonsense', () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
    expect(() => bakeSkinnedMesh(mesh, [{ clip: stillClip('idle', 1), as: 'idle', loop: true }], {})).toThrow(
      /skinIndex/,
    );
  });
});

describe('clip matching', () => {
  const named = (n: string) => new THREE.AnimationClip(n, 1, []);

  it('matches Tripo\'s prefixed names by substring, and takes each slot once', () => {
    // The real export names every clip `Armature|preset:biped:run` AND `Armature|Armature|...`,
    // so the same animation appears twice. Baking both would double the cost of the milestone.
    const available = [
      named('Armature|Armature|preset:biped:run'),
      named('Armature|preset:biped:run'),
      named('Armature|preset:biped:idle'),
    ];
    const specs: ClipSpec[] = [
      { as: 'idle', match: 'idle', loop: true },
      { as: 'run', match: 'run', loop: true },
    ];
    const { entries, missing } = matchClips(available, specs);

    expect(missing).toEqual([]);
    expect(entries.map((e) => e.as)).toEqual(['idle', 'run']);
    expect(entries.filter((e) => e.as === 'run')).toHaveLength(1);
  });

  it('names what it could not find instead of silently substituting', () => {
    const { entries, missing } = matchClips([named('Run')], [
      { as: 'run', match: 'run', loop: true },
      { as: 'die', match: 'defeat', loop: false },
    ]);
    expect(entries.map((e) => e.as)).toEqual(['run']);
    expect(missing).toEqual(['die']);
  });

  it('tries alternate names in order, so one spec covers Tripo and hand-named rigs', () => {
    // Tripo calls its attacks `box_01..03`; a hand-made rig says `Attack`. Same logical clip.
    const tripo = matchClips([named('Armature|preset:biped:box_01')], [
      { as: 'attack', match: ['box_01', 'attack'], loop: true },
    ]);
    const handmade = matchClips([named('Attack_Heavy')], [
      { as: 'attack', match: ['box_01', 'attack'], loop: true },
    ]);
    expect(tripo.entries[0]?.clip.name).toContain('box_01');
    expect(handmade.entries[0]?.clip.name).toBe('Attack_Heavy');
    expect(tripo.missing).toEqual([]);
    expect(handmade.missing).toEqual([]);
  });

  it('spends a name, so specs sharing one chain take different clips', () => {
    // How the three attack slots each get their own combo out of a single fallback chain (see
    // CLIP_SPECS in loader.ts). The duplicated export is the trap: `box_01` exists twice, so
    // spending the clip object alone would hand slot two the other copy of slot one's punch.
    const chain = ['box_01', 'box_02', 'slash'];
    const { entries } = matchClips(
      [
        named('Armature|Armature|preset:biped:box_01'),
        named('Armature|preset:biped:box_01'),
        named('Armature|preset:biped:slash'),
      ],
      [
        { as: 'attack', match: chain, loop: true },
        { as: 'attack2', match: chain, loop: true, optional: true },
        { as: 'attack3', match: chain, loop: true, optional: true },
      ],
    );

    expect(entries.map((e) => e.as)).toEqual(['attack', 'attack2']);
    expect(entries[0].clip.name).toContain('box_01');
    expect(entries[1].clip.name).toContain('slash'); // not the second copy of box_01
  });

  it('skips a missing OPTIONAL clip silently — a bonus when present, not a gap when absent', () => {
    // The second and third attack variants: a rig with one attack should not be nagged about the
    // other two, but a rig missing `die` outright should still be told.
    const { entries, missing } = matchClips([named('Attack'), named('defeat_03')], [
      { as: 'attack', match: ['box_01', 'attack'], loop: true },
      { as: 'attack2', match: ['box_02'], loop: true, optional: true },
      { as: 'attack3', match: ['box_03'], loop: true, optional: true },
      { as: 'die', match: ['defeat', 'die'], loop: false },
    ]);
    expect(entries.map((e) => e.as)).toEqual(['attack', 'die']);
    expect(missing).toEqual([]);
  });

  it('ignores a bake window that falls past the end of the clip', () => {
    // The die window (from 2.7 s) is measured against Tripo's 5.6 s defeat preset. A hand-authored
    // 1 s die clip matched by the same spec must play WHOLE, not freeze on its final frame.
    const { mesh, scene } = rig();
    const short = bakeSkinnedMesh(
      mesh,
      [{ clip: swingClip('die', 1), as: 'die', loop: false, from: 2.7, trim: 1.0 }],
      { fps: 8, root: scene },
    );
    expect(short.clips[0].count).toBe(9); // the full 1 s at 8 fps, one-shot: 8 + 1
    // ...and it starts at the clip's beginning, not at some clamped tail.
    expect(posOf(short, 0, 2).y).toBeCloseTo(2, 4);
  });

  it('prices a bake before running it, so a model too big to animate never allocates', () => {
    // The guard that replaced `animated: true` (M6c). Two RGBA-float textures of vertexCount ×
    // frames — the projection has to agree with what `assembleVat` reports afterwards, or the
    // ceiling in config.ts is measuring something other than what gets allocated.
    const entries = [
      { clip: stillClip('idle', 1), loop: true },
      { clip: stillClip('die', 0.5), loop: false },
    ];
    // At 10 fps: a 1 s loop is 10 frames, a 0.5 s one-shot is 6 (5 + the held final pose).
    expect(projectVatBytes(100, entries, 10)).toBe(100 * 16 * 32);

    // Linear in both, which is what makes decimation and clip count the two dials the warning names.
    expect(projectVatBytes(200, entries, 10)).toBe(2 * projectVatBytes(100, entries, 10));
    expect(projectVatBytes(100, entries.slice(0, 1), 10)).toBeLessThan(projectVatBytes(100, entries, 10));

    // A rig with no clips costs nothing, rather than costing one texture of zero height.
    expect(projectVatBytes(100, [], 10)).toBe(0);
  });

  it('projects exactly what the bake then allocates', () => {
    // Belt and braces: the projection is arithmetic on durations, the bake is a real pass over the
    // vertices, and the ceiling is only meaningful if they agree.
    const { mesh, scene } = rig();
    const entries = [{ clip: swingClip('run', 1), as: 'run', loop: true }];
    const out = bakeSkinnedMesh(mesh, entries, { fps: 8, root: scene });
    expect(projectVatBytes(out.vertexCount, entries, 8)).toBe(out.vertexCount * out.totalFrames * 32);
  });

  it('classifies unfamiliar clip names sensibly', () => {
    for (const n of ['Run', 'walk_fwd', 'Idle_01', 'march', 'StandLoop']) {
      expect(isLoopClip(n), n).toBe(true);
    }
    for (const n of ['defeat_03', 'Attack', 'die', 'fall', 'box_01']) {
      expect(isLoopClip(n), n).toBe(false);
    }
  });
});
