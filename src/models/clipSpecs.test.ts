// The animation lookup, tested against the actual Tripo humanoid preset library.
//
// vatCore.test.ts proves the MATCHER works. This file proves the TABLE is right: that every preset
// a viewer could have rigged their model with lands in one of the game's five slots, that a full
// export still resolves to exactly the clips it did before the table grew, and that a partial
// export — the case the fallback chains exist for — animates instead of degrading to a static mesh.
//
// The list below is Tripo's published humanoid preset set, verbatim. It is the input the table is
// written against, so it belongs in the tests as data rather than as a comment that can rot.

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CLIP_SPECS } from './loader';
import { matchClips } from './vatCore';

const TRIPO_PRESETS = [
  'box_01', 'box_02', 'box_03', 'defeat_02', 'fall', 'idle', 'run', 'walk',
  'afraid', 'agree', 'angry_01', 'angry_02', 'angry_03', 'basketball_shot', 'bow',
  'cast_a_spell', 'cheer', 'chop', 'clap', 'climb', 'complain_01', 'complain_02',
  'crossover_dribble', 'cry', 'dance_01', 'dance_02', 'dance_03', 'dance_04', 'dance_05',
  'dance_06', 'defeat', 'depressed', 'dig', 'dive', 'dribble', 'fire', 'flee_01', 'flee_02',
  'flip', 'fold_arms', 'football_catch', 'football_save', 'football_pass', 'freaky',
  'frightened', 'front_kick_01', 'front_kick_02', 'frustrated_01', 'frustrated_02',
  'greet_01', 'greet_02', 'greet_03', 'greet_04', 'heart_pose', 'hit_to_body_01',
  'hit_to_body_02', 'hit_to_head', 'hit_to_side', 'hit_to_stomach', 'hug', 'jump_down',
  'jump', 'jump_rope_01', 'jump_rope_02', 'laugh_01', 'laugh_02', 'lift_heavy',
  'look_around', 'make_a_call_01', 'make_a_call_02', 'pitch_baseball', 'play_mobile_game',
  'play_video_game', 'press-up', 'run_upstairs', 'scared_01', 'scared_02', 'stretch',
  'shoot', 'shovel', 'sing_01', 'sing_02', 'sing_03', 'sing_04', 'sit', 'slash', 'sob',
  'standing_relax', 'surf', 'swagger', 'swim', 'turn', 'volleyball', 'wait', 'warm_up',
  'wave_goodbye_01', 'wave_goodbye_02',
];

/** Tripo's real export name for a preset, both copies of it. */
function tripo(preset: string): THREE.AnimationClip[] {
  return [
    new THREE.AnimationClip(`Armature|preset:biped:${preset}`, 1, []),
    new THREE.AnimationClip(`Armature|Armature|preset:biped:${preset}`, 1, []),
  ];
}

/** The slot each of `presets` fills, when a rig ships exactly those presets. */
function slots(presets: string[]): Record<string, string> {
  const { entries } = matchClips(presets.flatMap(tripo), CLIP_SPECS);
  return Object.fromEntries(entries.map((e) => [e.as, e.clip.name.split(':').pop()!]));
}

/**
 * Which CATEGORIES' chains can match `name` at all, ignoring what else is in the rig. The three
 * attack slots share one chain and count as one category — competing for a clip is what they are
 * for.
 */
function chainsMatching(name: string): string[] {
  const hit = CLIP_SPECS.filter((spec) => {
    const alternates = Array.isArray(spec.match) ? spec.match : [spec.match];
    return alternates.some((m) => name.includes(m));
  });
  return [...new Set(hit.map((s) => s.as.replace(/\d+$/, '')))];
}

describe('the animation lookup', () => {
  it('has a home for every humanoid preset Tripo offers', () => {
    // The point of the table: a viewer rigs their model with whatever presets they liked, and the
    // game finds a use for all of them rather than for the seven it was originally written against.
    const homeless = TRIPO_PRESETS.filter((p) => chainsMatching(p).length === 0);
    expect(homeless).toEqual([]);
  });

  it('sends each preset to one category, bar the jump family', () => {
    // Substring matching cannot tell `jump` from `jump_rope_01` or `jump_down`, and those three
    // belong in three different slots. It is the one overlap in the table, it is deliberate, and
    // the two tests below show the spent-name rule resolving it. Anything ELSE showing up here is
    // a table bug: two slots quietly competing for the same clip.
    const shared = TRIPO_PRESETS.filter((p) => chainsMatching(p).length > 1);
    expect(shared.sort()).toEqual(['jump_down', 'jump_rope_01', 'jump_rope_02']);
  });

  it('resolves a full export to the same seven clips it always did', () => {
    // The regression that matters: the table grew from 7 names to ~100, and the model the game
    // actually ships with must bake exactly what it baked before.
    expect(slots(TRIPO_PRESETS)).toEqual({
      idle: 'idle',
      walk: 'walk',
      run: 'run',
      attack: 'box_01',
      attack2: 'box_02',
      attack3: 'box_03',
      // `defeat` or `defeat_02`, whichever the exporter listed first — nothing distinguishes them
      // by substring, and they are the same beat. See DIE in loader.ts.
      die: expect.stringMatching(/^defeat/),
    });
  });

  it('picks the same clips out of the real grunt.glb as it always did', () => {
    // The shipped asset's actual clip list, read out of public/models/grunt.glb. It carries
    // `fall` as well as `defeat_03` — and `fall` is in the die chain too, so this is also the
    // check that a chain's ORDER holds: the real death wins, the fallback stays a fallback.
    const grunt = ['box_01', 'box_02', 'box_03', 'defeat_03', 'fall', 'idle', 'run', 'walk'];
    expect(slots(grunt)).toEqual({
      idle: 'idle',
      walk: 'walk',
      run: 'run',
      attack: 'box_01',
      attack2: 'box_02',
      attack3: 'box_03',
      die: 'defeat_03',
    });
  });

  it('animates a rig that shipped none of the seven', () => {
    // A viewer picks presets by the look of them, not by our slot names. Every one of these is a
    // fallback, and the result is a complete animation set out of a rig with no idle, no walk, no
    // run, no box and no defeat.
    expect(slots(['standing_relax', 'swagger', 'flee_01', 'slash', 'chop', 'front_kick_01', 'fall']))
      .toEqual({
        idle: 'standing_relax',
        walk: 'swagger',
        run: 'flee_01',
        attack: 'slash',
        attack2: 'chop',
        attack3: 'front_kick_01',
        die: 'fall',
      });
  });

  it('gives the three attack slots three different combos, never the same one thrice', () => {
    // All three share one chain — without the spent-name rule they would each take its first hit,
    // and a crowd would throw one punch in three copies.
    const three = slots(['pitch_baseball', 'volleyball', 'hit_to_head']);
    expect(new Set([three.attack, three.attack2, three.attack3]).size).toBe(3);

    // And a rig with a single attack fills one slot and reports nothing missing for the other two.
    const { entries, missing } = matchClips(tripo('box_01'), CLIP_SPECS);
    expect(entries.filter((e) => e.as.startsWith('attack'))).toHaveLength(1);
    expect(missing).not.toContain('attack2');
  });

  it('keeps the jump family off each other\'s slots', () => {
    // `jump_rope` is an idle and `jump` is locomotion, and the run chain's `jump` matches both. A
    // rig with only the skipping rope must not end up sprinting on the spot with it.
    expect(slots(['jump_rope_01', 'jump_rope_02'])).toEqual({ idle: 'jump_rope_01' });
    expect(slots(['jump', 'jump_rope_01'])).toEqual({ idle: 'jump_rope_01', run: 'jump' });
  });

  it('still says which slot is empty when a rig has nothing for it', () => {
    // The chains make a miss rarer, not silent — a rig with no death animation of any kind is
    // still worth a console line, because the death marker is what the miss will look like.
    const { missing } = matchClips(tripo('idle'), CLIP_SPECS);
    expect(missing).toEqual(['walk', 'run', 'attack', 'die']);
  });
});
