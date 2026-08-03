// What the startup dialog says about one actor — as a pure function, away from React and THREE.
//
// The dialog is the first thing a viewer sees and, for anyone whose file did not load, the ONLY
// thing that tells them why: the console line has always been there and has always been missed. So
// the wording is the feature, and a pure function is the only way to test wording without a GPU.
//
// It reads a plain record rather than a `ResolvedActor` so the test does not need three.js, and so
// this file cannot quietly grow a dependency on a live geometry.

import type { ActorStatus } from '../models/loader';

/** How loudly to say it. `bad` is a failure, `warn` is a working model with something worth
 *  reading, `muted` is a deliberate absence, `ok` is nothing to report. */
export type Tone = 'ok' | 'warn' | 'bad' | 'muted';

export interface RowInput {
  id: string;
  /** The registry's configured URL, if it has one. */
  url?: string;
  status: ActorStatus;
  /** What actually loaded — the URL, or an uploaded file's name. */
  source: string;
  uploaded: boolean;
  note: string;
  tris: number;
  textured: boolean;
  /** Baked VAT clip names, empty when the actor is static. */
  clips: string[];
  vatMB: number;
  /** `THREE.BufferGeometry.type` of the primitive, for naming the fallback shape. */
  shape: string;
  height: number;
}

export interface RowView {
  /** Short status word, top right of the row. */
  chip: string;
  tone: Tone;
  /** Where the art on screen came from. Always says something — "nothing" is a sentence too. */
  source: string;
  /** Facts about what is drawn, joined with · by the caller. */
  facts: string[];
  /** The one sentence worth reading, or ''. Rendered in `tone`. */
  note: string;
}

/** `CapsuleGeometry` → `capsule`. The primitives are the fallback forever, so they deserve a name. */
export function shapeName(type: string): string {
  const known: Record<string, string> = {
    CapsuleGeometry: 'capsule',
    BoxGeometry: 'box',
    ConeGeometry: 'cone',
    IcosahedronGeometry: 'icosahedron',
  };
  return known[type] ?? (type.replace(/Geometry$/, '').toLowerCase() || 'primitive');
}

/**
 * The row, in words.
 *
 * The four statuses get four genuinely different sentences, because they send a viewer to four
 * different places: `missing` to their filename, `rejected` to their exporter, `unset` to the
 * registry, and `loaded` to the game.
 */
export function summarise(a: RowInput): RowView {
  const shape = `${shapeName(a.shape)} fallback`;

  if (a.status === 'loaded') {
    const facts = [`${a.tris.toLocaleString()} tris`, a.textured ? 'textured' : 'untextured'];
    if (a.clips.length) facts.push(`${a.clips.length} clips`, `${a.vatMB.toFixed(1)} MB VAT`);
    else facts.push('static');
    return {
      chip: a.uploaded ? 'YOURS' : 'LOADED',
      tone: a.note ? 'warn' : 'ok',
      source: a.uploaded ? `${a.source} — uploaded, this tab only` : a.source,
      facts,
      note: a.note,
    };
  }

  // Everything below is drawing the primitive. Saying WHICH primitive matters: it is what the
  // viewer is looking at in the preview, and "the cone is the runner" is the fastest way to
  // understand that the fallback is a working part of the game and not a broken model.
  if (a.status === 'missing') {
    return {
      chip: 'NOT FOUND',
      tone: 'bad',
      source: shape,
      facts: [`${a.height} u tall`],
      note: a.note || `${a.url ?? a.source} was not found (404) — drawing the fallback shape instead.`,
    };
  }

  if (a.status === 'rejected') {
    return {
      chip: a.uploaded ? 'REJECTED' : 'UNUSABLE',
      tone: 'bad',
      source: shape,
      facts: [`${a.height} u tall`],
      note: a.note || `${a.source} could not be used — drawing the fallback shape instead.`,
    };
  }

  return {
    chip: 'NO MODEL',
    tone: 'muted',
    source: shape,
    facts: [`${a.height} u tall`],
    note: a.note,
  };
}
