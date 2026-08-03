// The startup dialog's wording, tested.
//
// This is not a style check. Every case below is a viewer stuck at a different point of the import
// workflow, and the assertion is that the row sends them to the right place: a 404 to their
// filename, a rejected export to Blender, an unconfigured slot to the registry. Getting that wrong
// is the difference between "the tutorial works" and "the tutorial silently drew a green box".

import { describe, expect, it } from 'vitest';
import { shapeName, summarise, type RowInput } from './modelRows';

const BASE: RowInput = {
  id: 'grunt',
  url: '/models/grunt.glb',
  status: 'loaded',
  source: '/models/grunt.glb',
  uploaded: false,
  note: '',
  tris: 807,
  textured: true,
  clips: ['idle', 'walk', 'run', 'attack', 'attack2', 'attack3', 'die'],
  vatMB: 16.8,
  shape: 'BoxGeometry',
  height: 1.4,
};

const row = (over: Partial<RowInput>) => summarise({ ...BASE, ...over });

describe('the model dialog says the right thing about', () => {
  it('a model that loaded and animated', () => {
    const r = row({});
    expect(r.chip).toBe('LOADED');
    expect(r.tone).toBe('ok');
    expect(r.source).toBe('/models/grunt.glb');
    expect(r.facts).toEqual(['807 tris', 'textured', '7 clips', '16.8 MB VAT']);
    expect(r.note).toBe('');
  });

  it('a URL that 404s — naming the URL, because that is the thing to go and fix', () => {
    // The case the whole dialog exists for. A misnamed file is invisible otherwise: the game runs,
    // the box is green, and nothing on screen mentions grunt.glb.
    const r = row({
      status: 'missing',
      source: '/models/grunt.glb',
      note: '/models/grunt.glb was not found (404) — drawing the fallback shape instead.',
    });
    expect(r.chip).toBe('NOT FOUND');
    expect(r.tone).toBe('bad');
    expect(r.note).toContain('/models/grunt.glb');
    expect(r.note).toContain('not found');
    // And it says what is on screen instead, so the box in the preview is explained rather than
    // being one more thing that looks broken.
    expect(r.source).toBe('box fallback');
  });

  it('a URL that 404s with no note recorded — still naming the URL', () => {
    // Belt and braces: the sentence is built from the registry URL if the loader never supplied one.
    expect(row({ status: 'missing', note: '', source: '' }).note).toContain('/models/grunt.glb');
  });

  it('an export that loaded and broke the contract', () => {
    const r = row({
      status: 'rejected',
      note: '3 meshes found, expected 1 — falling back to the primitive. One InstancedMesh draws one geometry;',
    });
    expect(r.chip).toBe('UNUSABLE');
    expect(r.tone).toBe('bad');
    expect(r.note).toContain('3 meshes');
  });

  it('a slot with no model configured — which is not a failure', () => {
    const r = row({
      id: 'brute',
      url: undefined,
      status: 'unset',
      source: '',
      note: 'no model configured — drop a .glb in public/models/ and name it in src/models/registry.ts, or upload one here to try it out.',
      shape: 'BoxGeometry',
      height: 2.6,
    });
    // Muted, not red: the primitive is the shipped art until somebody names a file, and shouting
    // about six of them on first load would bury the one row that is actually wrong.
    expect(r.tone).toBe('muted');
    expect(r.chip).toBe('NO MODEL');
    expect(r.note).toContain('registry.ts');
  });

  it('a file the viewer just uploaded', () => {
    const r = row({ uploaded: true, source: 'my-grunt.glb' });
    expect(r.chip).toBe('YOURS');
    // Session-only is stated where the upload is, not in a help page nobody opens.
    expect(r.source).toContain('this tab only');
  });

  it('a working model that is worth a word anyway', () => {
    // Over the triangle budget is a note on a LOADED model (MODEL-PIPELINE §5 makes it a warning,
    // not a rejection), so it has to be visible without being red.
    const r = row({ note: '48,000 triangles, over the 4,000 ceiling' });
    expect(r.tone).toBe('warn');
    expect(r.chip).toBe('LOADED');
    expect(r.facts).toContain('807 tris');
  });

  it('a rigged upload too heavy to animate', () => {
    // Animation is automatic from M6c, so the only reason a rigged model stays still is that its
    // VAT would not fit. The row has to say that, and say which dial to turn — otherwise it reads
    // as the bake silently failing.
    const r = row({
      uploaded: true,
      source: 'rigged.glb',
      clips: [],
      note: 'rigged, but its VAT would be 312 MB — over the 64 MB ceiling, so it stays static. Decimate the mesh (the cost is per vertex per frame) or export fewer clips.',
    });
    expect(r.facts).toContain('static');
    expect(r.tone).toBe('warn');
    expect(r.note).toContain('Decimate');
  });
});

describe('the fallback shapes are named', () => {
  it('by what they look like, not by their three.js class', () => {
    expect(shapeName('CapsuleGeometry')).toBe('capsule');
    expect(shapeName('ConeGeometry')).toBe('cone');
    expect(shapeName('IcosahedronGeometry')).toBe('icosahedron');
  });

  it('and an unknown one degrades to something readable rather than to nothing', () => {
    expect(shapeName('TorusKnotGeometry')).toBe('torusknot');
    expect(shapeName('')).toBe('primitive');
  });
});
